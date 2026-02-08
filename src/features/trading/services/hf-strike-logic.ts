// src/features/trading/services/hf-strike-logic.ts
'use client';

import type { TickData, CandleData } from '@/lib/types';
import type { Indicators } from './indicator-service';

// ============================================================================
// TIPOS E INTERFACES REUTILIZÁVEIS
// ============================================================================
export interface BBAnalysis {
  upper: number;
  lower: number;
  middle: number;
  width: number;
  position: number;
  isSqueezed: boolean;
  touchingLower: boolean;
  touchingUpper: boolean;
}

export interface RSIAnalysis {
  value: number;
  oversold: boolean;
  overbought: boolean;
  divergence: 'bullish' | 'bearish' | null;
}

export interface VolumeAnalysis {
  isSpike: boolean;
  ratio: number;
}

export interface StrikeZone {
  type: 'LONG_ENTRY' | 'SHORT_ENTRY' | 'NEUTRAL';
  confidence: number;
  triggers: string[];
  entry: {
    price: number;
    timestamp: number;
  };
  targets: {
    takeProfit: number;
    stopLoss: number;
    riskReward: number;
  };
  indicators: {
    rsi: number;
    bbPosition: number;
    bbWidth: number;
    volumeSpike: boolean;
    divergence: 'bullish' | 'bearish' | null;
  };
  duration: number; // Duração sugerida em segundos
}

// ============================================================================
// FUNÇÕES DE ANÁLISE PURAS
// ============================================================================

/**
 * Analisa as Bandas de Bollinger em tempo real a cada tick.
 * @param bbData Dados das bandas (upper, middle, lower) já calculados.
 * @param bbSeries Histórico das bandas para cálculo da largura.
 * @param currentPrice O preço do tick atual.
 */
export function analyzeBollingerBands(
    bbData: Indicators['bb'], 
    bbSeries: Indicators['bollingerBands'],
    currentPrice: number
): BBAnalysis | null {
  try {
    if (!bbData || !bbData.upper || !bbData.middle || !bbData.lower) return null;
    const { upper, middle, lower } = bbData;

    // A largura (width) é calculada usando o histórico das bandas.
    const lastBand = bbSeries[bbSeries.length - 1];
    const bandWidth = lastBand && lastBand.middle > 0 ? ((lastBand.upper - lastBand.lower) / lastBand.middle) * 100 : 0;
    
    const bandRange = upper - lower;
    const bbPosition = bandRange > 0 ? (currentPrice - lower) / bandRange : 0.5;

    return {
      upper,
      lower,
      middle,
      width: bandWidth,
      position: bbPosition,
      isSqueezed: bandWidth < 1.5,
      touchingLower: currentPrice <= lower * 1.005,
      touchingUpper: currentPrice >= upper * 0.995,
    };
  } catch (error) {
    console.error('[HF Logic] BB Analysis Error:', error);
    return null;
  }
}

/**
 * Analisa o RSI e detecta divergências.
 * @param rsi O valor atual do RSI já calculado.
 * @param candleData O histórico de velas para detecção de divergência.
 */
export function analyzeRSI(
  rsi: number,
  candleData: CandleData[]
): RSIAnalysis | null {
  try {
    if (candleData.length < 10) return null;
    
    // Detecção de Divergência Simplificada
    const last10Candles = candleData.slice(-10);
    const priceChange = last10Candles[9].close - last10Candles[0].close;
    const priceIncreasing = priceChange > 0;
    let divergence: 'bullish' | 'bearish' | null = null;
    
    if (!priceIncreasing && rsi < 35 && rsi > 25) divergence = 'bullish';
    else if (priceIncreasing && rsi > 65 && rsi < 75) divergence = 'bearish';

    return {
      value: rsi,
      oversold: rsi < 30,
      overbought: rsi > 70,
      divergence,
    };
  } catch (error) {
    console.error('[HF Logic] RSI Analysis Error:', error);
    return null;
  }
}

/**
 * Analisa a velocidade dos ticks para detectar picos de volume/atividade.
 */
export function analyzeVolume(priceTicks: TickData[]): VolumeAnalysis | null {
  if (priceTicks.length < 60) return null;
  try {
    const last60Ticks = priceTicks.slice(-60);
    const last10Ticks = priceTicks.slice(-10);
    
    const window60Duration = last60Ticks[59].epoch - last60Ticks[0].epoch;
    const window10Duration = last10Ticks[9].epoch - last10Ticks[0].epoch;

    if (window60Duration === 0 || window10Duration === 0) return null;

    const avgTickRate = 60 / window60Duration;
    const recentTickRate = 10 / window10Duration;

    const ratio = recentTickRate / avgTickRate;
    const isSpike = ratio > 1.3;

    return { isSpike, ratio };
  } catch (error) {
    console.error('[HF Logic] Volume Analysis Error:', error);
    return null;
  }
}

/**
 * Combina todas as análises para detectar uma Strike Zone, aplicando filtros de "Guardião".
 */
export function detectStrikeZone(
  bbAnalysis: BBAnalysis | null,
  rsiAnalysis: RSIAnalysis | null,
  volumeAnalysis: VolumeAnalysis | null,
  currentPrice: number,
  ema100: number | null,
  atr: number | null
): StrikeZone | null {
  if (!bbAnalysis || !rsiAnalysis || !volumeAnalysis) return null;

  // --- GUARDIAN FILTERS ---
  const ATR_CHAOS_THRESHOLD = 0.0005; // Ajuste conforme o ativo
  if (atr && atr > ATR_CHAOS_THRESHOLD) {
    return { 
      type: 'NEUTRAL', confidence: 0, triggers: ['VETO: Volatilidade Caótica (ATR Alto)'], 
      // ... preencher o resto com valores padrão
      entry: { price: 0, timestamp: 0 }, targets: { takeProfit: 0, stopLoss: 0, riskReward: 0 }, 
      indicators: { rsi: 0, bbPosition: 0, bbWidth: 0, volumeSpike: false, divergence: null }, duration: 0
    };
  }

  const triggers: string[] = [];
  let confidence = 0;
  let type: StrikeZone['type'] = 'NEUTRAL';

  // --- LONG ENTRY CONDITIONS ---
  const longTriggers: string[] = [];
  let longConfidence = 0;
  if (bbAnalysis.touchingLower) {
    longTriggers.push(`📉 Preço na Banda Inferior`);
    longConfidence += 40;
  }
  if (rsiAnalysis.oversold) {
    longTriggers.push(`📊 RSI Oversold (${rsiAnalysis.value.toFixed(1)})`);
    longConfidence += 35;
  }
  if (rsiAnalysis.divergence === 'bullish') {
    longTriggers.push('🔄 Divergência Bullish');
    longConfidence += 25;
  }
  if (longConfidence > 0 && volumeAnalysis.isSpike) {
    longTriggers.push('📈 Spike de Volume');
    longConfidence += 15;
  }

  if (longConfidence >= 60) {
    // GUARDIAN CHECK (TREND)
    if (ema100 && currentPrice < ema100) {
       return { 
        type: 'NEUTRAL', confidence: 0, triggers: ['VETO: Sinal de compra contra tendência de baixa macro.'], 
        entry: { price: 0, timestamp: 0 }, targets: { takeProfit: 0, stopLoss: 0, riskReward: 0 }, 
        indicators: { rsi: 0, bbPosition: 0, bbWidth: 0, volumeSpike: false, divergence: null }, duration: 0
      };
    }
    type = 'LONG_ENTRY';
    confidence = longConfidence;
    triggers.push(...longTriggers);
  }
  // --- SHORT ENTRY CONDITIONS (if no long signal) ---
  else {
    const shortTriggers: string[] = [];
    let shortConfidence = 0;
    if (bbAnalysis.touchingUpper) {
      shortTriggers.push(`📈 Preço na Banda Superior`);
      shortConfidence += 40;
    }
    if (rsiAnalysis.overbought) {
      shortTriggers.push(`📊 RSI Overbought (${rsiAnalysis.value.toFixed(1)})`);
      shortConfidence += 35;
    }
    if (rsiAnalysis.divergence === 'bearish') {
      shortTriggers.push('🔄 Divergência Bearish');
      shortConfidence += 25;
    }
    if (shortConfidence > 0 && volumeAnalysis.isSpike) {
      shortTriggers.push('📈 Spike de Volume');
      shortConfidence += 15;
    }
    if (shortConfidence >= 60) {
      // GUARDIAN CHECK (TREND)
      if (ema100 && currentPrice > ema100) {
        return { 
          type: 'NEUTRAL', confidence: 0, triggers: ['VETO: Sinal de venda contra tendência de alta macro.'], 
          entry: { price: 0, timestamp: 0 }, targets: { takeProfit: 0, stopLoss: 0, riskReward: 0 }, 
          indicators: { rsi: 0, bbPosition: 0, bbWidth: 0, volumeSpike: false, divergence: null }, duration: 0
        };
      }
      type = 'SHORT_ENTRY';
      confidence = shortConfidence;
      triggers.push(...shortTriggers);
    }
  }
  
  if (type === 'NEUTRAL') return null;

  const currentATR = atr || (bbAnalysis.upper - bbAnalysis.lower); // Fallback para BB range se ATR for nulo
  return {
    type,
    confidence: Math.min(100, confidence),
    triggers,
    entry: { price: currentPrice, timestamp: Date.now() },
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + currentATR * 0.75 : currentPrice - currentATR * 0.75,
      stopLoss: type === 'LONG_ENTRY' ? currentPrice - currentATR * 0.5 : currentPrice + currentATR * 0.5,
      riskReward: 1.5,
    },
    indicators: {
      rsi: rsiAnalysis.value,
      bbPosition: bbAnalysis.position,
      bbWidth: bbAnalysis.width,
      volumeSpike: volumeAnalysis.isSpike,
      divergence: rsiAnalysis.divergence,
    },
    duration: bbAnalysis.isSqueezed ? 30 : 20,
  };
}
