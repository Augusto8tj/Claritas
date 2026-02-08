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
 */
export function analyzeBollingerBands(
    bbData: Indicators['bb'], 
    bbSeries: Indicators['bollingerBands'],
    currentPrice: number
): BBAnalysis | null {
  try {
    if (!bbData || !bbData.upper || !bbData.middle || !bbData.lower) return null;
    const { upper, middle, lower } = bbData;

    const lastBand = bbSeries[bbSeries.length - 1];
    const bandWidth = lastBand && lastBand.middle > 0 ? ((lastBand.upper - lastBand.lower) / lastBand.middle) * 100 : 0;
    
    const bandRange = upper - lower;
    const bbPosition = bandRange > 0 ? (currentPrice - lower) / bandRange : 0.5;

    return {
      upper, lower, middle,
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
 */
export function analyzeRSI(
  rsi: number,
  candleData: CandleData[]
): RSIAnalysis | null {
  try {
    if (candleData.length < 10) return null;
    
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

    if (window60Duration <= 0 || window10Duration <= 0) return null;

    const avgTickRate = 60 / window60Duration;
    const recentTickRate = 10 / window10Duration;

    const ratio = avgTickRate > 0 ? recentTickRate / avgTickRate : 1;
    const isSpike = ratio > 1.3;

    return { isSpike, ratio };
  } catch (error) {
    console.error('[HF Logic] Volume Analysis Error:', error);
    return null;
  }
}

/**
 * Combina análises para detectar uma Strike Zone de REVERSÃO À MÉDIA (HF).
 */
export function detectHFMeanReversionZone(
  indicators: Indicators,
  currentPrice: number,
): StrikeZone | null {
  const { bb, bollingerBands, rsi: rsiValue } = indicators;
  
  if (!bb || !bollingerBands || rsiValue === null) return null;

  const bbAnalysis = analyzeBollingerBands(bb, bollingerBands, currentPrice);
  const rsiAnalysis = analyzeRSI(rsiValue, []); // Divergence logic needs candles, simplified here
  const volumeAnalysis = analyzeVolume([]); // Volume logic needs ticks
  
  if(!bbAnalysis || !rsiAnalysis) return null;

  const triggers: string[] = [];
  let confidence = 0;
  let type: StrikeZone['type'] = 'NEUTRAL';

  // LONG ENTRY
  if (bbAnalysis.touchingLower) {
    triggers.push(`📉 Preço na Banda Inferior`);
    confidence += 40;
  }
  if (rsiAnalysis.oversold) {
    triggers.push(`📊 RSI Oversold (${rsiAnalysis.value.toFixed(1)})`);
    confidence += 35;
  }
  if (confidence >= 60) type = 'LONG_ENTRY';
  
  // SHORT ENTRY (only if no long)
  if (type === 'NEUTRAL') {
      let shortConfidence = 0;
      const shortTriggers: string[] = [];
      if (bbAnalysis.touchingUpper) {
        shortTriggers.push(`📈 Preço na Banda Superior`);
        shortConfidence += 40;
      }
      if (rsiAnalysis.overbought) {
        shortTriggers.push(`📊 RSI Overbought (${rsiAnalysis.value.toFixed(1)})`);
        shortConfidence += 35;
      }
      if (shortConfidence >= 60) {
          type = 'SHORT_ENTRY';
          confidence = shortConfidence;
          triggers.push(...shortTriggers);
      }
  }
  
  if (type === 'NEUTRAL') return null;

  const atr = bbAnalysis.upper - bbAnalysis.lower;
  return {
    type,
    confidence: Math.min(100, confidence),
    triggers,
    entry: { price: currentPrice, timestamp: Date.now() },
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + atr * 0.75 : currentPrice - atr * 0.75,
      stopLoss: type === 'LONG_ENTRY' ? currentPrice - atr * 0.5 : currentPrice + atr * 0.5,
      riskReward: 1.5,
    },
    indicators: { rsi: rsiAnalysis.value, bbPosition: bbAnalysis.position, bbWidth: bbAnalysis.width, volumeSpike: false, divergence: null },
    duration: bbAnalysis.isSqueezed ? 30 : 20,
  };
}

/**
 * Detecta um sinal de SEGUIMENTO DE TENDÊNCIA (Standard).
 */
export function detectStandardTrendZone(
  indicators: Indicators, 
  currentPrice: number, 
  prevRsi: number
): StrikeZone | null {
  if (!indicators.adx || !indicators.ma.long || !indicators.rsi || !indicators.atr) return null;

  const { adx, ma: { long: ema100 }, rsi, atr } = indicators;
  let type: StrikeZone['type'] = 'NEUTRAL';
  const triggers: string[] = [];
  let confidence = 0;

  const isUpTrend = currentPrice > ema100!;
  const isDownTrend = currentPrice < ema100!;

  if (adx < 25) return null; // No trend
  
  if (isUpTrend && rsi > 50 && prevRsi <= 50) {
      type = 'LONG_ENTRY';
      triggers.push(`📈 Tendência de Alta (Acima da EMA 100)`);
      triggers.push(`🐂 Momentum de Compra (RSI cruzou 50)`);
      confidence = 50 + Math.min(50, (adx - 20) * 2);
  } else if (isDownTrend && rsi < 50 && prevRsi >= 50) {
      type = 'SHORT_ENTRY';
      triggers.push(`📉 Tendência de Baixa (Abaixo da EMA 100)`);
      triggers.push(`🐻 Momentum de Venda (RSI cruzou 50)`);
      confidence = 50 + Math.min(50, (adx - 20) * 2);
  }
  
  if (type === 'NEUTRAL') return null;

  const durationInMinutes = 45; // 3 velas de 15m

  return {
    type,
    confidence: Math.min(100, confidence),
    triggers,
    entry: { price: currentPrice, timestamp: Date.now() },
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + atr * 2.0 : currentPrice - atr * 2.0,
      stopLoss: type === 'LONG_ENTRY' ? currentPrice - atr * 1.5 : currentPrice + atr * 1.5,
      riskReward: 2.0 / 1.5,
    },
    indicators: {
      rsi: rsi, bbPosition: 0, bbWidth: 0, volumeSpike: false, divergence: null,
    },
    duration: durationInMinutes * 60,
  };
}
