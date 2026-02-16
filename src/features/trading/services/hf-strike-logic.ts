// src/features/trading/services/hf-strike-logic.ts
'use client';

import type { TickData, CandleData, MicrostructureFeatures } from '@/lib/types';
import type { Indicators } from './indicator-service';
import { extractMicrostructureFeatures as extractMicrostructureFeaturesFromService } from './advanced-trading-services';

// ============================================================================
// TIPOS E INTERFACES REUTILIZÁVEIS
// ============================================================================
export type StrategyType =
  | 'HF_MEAN_REVERSION'
  | 'STD_TREND_FOLLOW'
  | 'BOLLINGER_SQUEEZE'
  | 'VOLUME_ABSORPTION'
  | 'MICROSTRUCTURE_SCALP';
  
export const strategyMetadata: Record<StrategyType, { label: string; description: string; isHF: boolean; }> = {
  HF_MEAN_REVERSION: { label: 'Alta Frequência (Reversão)', description: 'Otimizado para reversão à média em 15-45s.', isHF: true },
  STD_TREND_FOLLOW: { label: 'Padrão (Tendência)', description: 'Segue tendências em velas de 15m.', isHF: false },
  BOLLINGER_SQUEEZE: { label: 'Rompimento (Squeeze)', description: 'Opera na explosão de volatilidade.', isHF: true },
  VOLUME_ABSORPTION: { label: 'Absorção de Volume', description: 'Analisa o clímax e absorção de volume.', isHF: false },
  MICROSTRUCTURE_SCALP: { label: 'Scalping de Fluxo', description: 'Opera o fluxo de ordens para trades de 5 ticks.', isHF: true },
};

export interface StrikeZone {
  type: 'LONG_ENTRY' | 'SHORT_ENTRY' | 'NEUTRAL';
  confidence: number;
  triggers: string[];
  entry: { price: number; timestamp: number; };
  targets: { takeProfit: number; stopLoss: number; riskReward: number; };
  indicators: { rsi: number; bbPosition: number; bbWidth: number; volumeSpike: boolean; divergence: 'bullish' | 'bearish' | null; };
  strategy: StrategyType;
  duration: number;
}

// ============================================================================
// FUNÇÕES DE ANÁLISE PURAS
// ============================================================================

export function detectHFMeanReversionZone(indicators: Indicators, currentPrice: number): StrikeZone | null {
  const startTime = performance.now();
  const { bb, bollingerBands, rsi: rsiValue } = indicators;
  
  if (!bb || !bollingerBands || rsiValue === null) {
    console.debug('[HF_MEAN_REV] Missing indicators:', { bb: !!bb, rsi: !!rsiValue });
    return null;
  }
  
  const bbAnalysis = {
    upper: bb.upper!,
    lower: bb.lower!,
    middle: bb.middle!,
    width: indicators.bbw!,
    position: (currentPrice - bb.lower!) / (bb.upper! - bb.lower! || 1),
    isSqueezed: indicators.bbw! < 1.0,
    
    // ✅ CORRIGIDO: Opção Balanceada (0.15%)
    touchingLower: currentPrice <= bb.lower! * 1.0015,
    touchingUpper: currentPrice >= bb.upper! * 0.9985,
  };
  
  const rsiAnalysis = { value: rsiValue, oversold: rsiValue < 30, overbought: rsiValue > 70, divergence: null };
  
  const triggers: string[] = [];
  let confidence = 0;
  let type: StrikeZone['type'] = 'NEUTRAL';
  
  if (bbAnalysis.touchingLower && rsiAnalysis.oversold) {
    type = 'LONG_ENTRY';
    triggers.push(`📉 Preço na Banda Inferior`, `📊 RSI Oversold (${rsiAnalysis.value.toFixed(1)})`);
    confidence = 75;
  } else if (bbAnalysis.touchingUpper && rsiAnalysis.overbought) {
    type = 'SHORT_ENTRY';
    triggers.push(`📈 Preço na Banda Superior`, `📊 RSI Overbought (${rsiAnalysis.value.toFixed(1)})`);
    confidence = 75;
  }
  
  const atr = bbAnalysis.upper - bbAnalysis.lower;
  
  const zone: StrikeZone | null = type === 'NEUTRAL' ? null : {
    type,
    confidence: Math.min(100, confidence),
    triggers,
    entry: { price: currentPrice, timestamp: Date.now() },
    strategy: 'HF_MEAN_REVERSION',
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + atr * 0.75 : currentPrice - atr * 0.75,
      stopLoss: type === 'LONG_ENTRY' ? currentPrice - atr * 0.5 : currentPrice + atr * 0.5,
      riskReward: 1.5
    },
    indicators: { rsi: rsiAnalysis.value, bbPosition: bbAnalysis.position, bbWidth: bbAnalysis.width, volumeSpike: false, divergence: null },
    duration: bbAnalysis.isSqueezed ? 30 : 20
  };

  if (zone) {
    console.log('[HF_MEAN_REV] SIGNAL DETECTED:', {
      type: zone.type,
      confidence: zone.confidence,
      price: currentPrice,
      bbLower: bb.lower,
      bbUpper: bb.upper,
      rsi: rsiValue
    });
  }
  
  const executionTime = performance.now() - startTime;
  if (executionTime > 5) {
    console.warn('[PERFORMANCE] HF Mean Reversion took', executionTime.toFixed(2), 'ms');
  }

  return zone;
}

export function detectStandardTrendZone(indicators: Indicators, currentPrice: number, prevRsi: number): StrikeZone | null {
  const startTime = performance.now();
  if (!indicators.adx || !indicators.ma.long || !indicators.rsi || !indicators.atr) {
    console.debug('[STD_TREND] Missing indicators:', { adx: !!indicators.adx, ma: !!indicators.ma.long, rsi: !!indicators.rsi, atr: !!indicators.atr });
    return null;
  }
  
  const { adx, ma: { long: ema100 }, rsi, atr } = indicators;
  
  if (adx < 20) {
    // Retornar um objeto nulo é mais limpo que retornar um StrikeZone "VETO"
    return null;
  }
  
  const isUpTrend = currentPrice > ema100!;
  const isDownTrend = currentPrice < ema100!;
  
  const rsiCrossedUp = rsi >= 47 && rsi <= 53 && prevRsi < 47;
  const rsiCrossedDown = rsi >= 47 && rsi <= 53 && prevRsi > 53;
  const strongUpTrend = isUpTrend && rsi > 55 && adx > 25;
  const strongDownTrend = isDownTrend && rsi < 45 && adx > 25;
  
  let type: StrikeZone['type'] = 'NEUTRAL';
  const triggers: string[] = [];
  let confidence = 0;
  
  if ((isUpTrend && rsiCrossedUp) || strongUpTrend) { 
    type = 'LONG_ENTRY'; 
    triggers.push(`📈 Tendência de Alta`, `🐂 RSI momentum positivo`); 
    confidence = strongUpTrend ? 75 : 65; 
  }
  else if ((isDownTrend && rsiCrossedDown) || strongDownTrend) { 
    type = 'SHORT_ENTRY'; 
    triggers.push(`📉 Tendência de Baixa`, `🐻 RSI momentum negativo`); 
    confidence = strongDownTrend ? 75 : 65; 
  }
  
  const zone = type === 'NEUTRAL' ? null : {
    type,
    confidence,
    triggers,
    entry: { price: currentPrice, timestamp: Date.now() },
    strategy: 'STD_TREND_FOLLOW',
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + atr * 2.0 : currentPrice - atr * 2.0,
      stopLoss: type === 'LONG_ENTRY' ? currentPrice - atr * 1.5 : currentPrice + atr * 1.5,
      riskReward: 2.0 / 1.5,
    },
    indicators: { rsi: rsi, bbPosition: 0, bbWidth: 0, volumeSpike: false, divergence: null },
    duration: 180,
  };

  if (zone) {
    console.log('[STD_TREND] SIGNAL DETECTED:', { type, confidence, price: currentPrice, adx, rsi });
  }

  const executionTime = performance.now() - startTime;
  if (executionTime > 5) {
    console.warn('[PERFORMANCE] STD Trend Follow took', executionTime.toFixed(2), 'ms');
  }

  return zone;
}

export function detectBollingerSqueezeZone(indicators: Indicators, currentPrice: number): StrikeZone | null {
  const startTime = performance.now();
  if (!indicators.bbw || indicators.bbw > 1.0) {
    if(!indicators.bbw) console.debug('[BB_SQUEEZE] Missing indicators: BBW');
    return null;
  }
  
  const { bb } = indicators;
  if (!bb?.upper || !bb.lower) {
    console.debug('[BB_SQUEEZE] Missing indicators: BB');
    return null;
  }
  
  let type: StrikeZone['type'] = 'NEUTRAL';
  const breakoutMargin = (bb.upper - bb.lower) * 0.02;
  
  if (currentPrice > bb.upper + breakoutMargin) {
    type = 'LONG_ENTRY';
  } else if (currentPrice < bb.lower - breakoutMargin) {
    type = 'SHORT_ENTRY';
  } else {
    return null;
  }
  
  const zone = {
    type,
    confidence: 80,
    triggers: [`🎯 Squeeze de Bollinger rompido (${indicators.bbw.toFixed(2)}%)`],
    entry: { price: currentPrice, timestamp: Date.now() },
    strategy: 'BOLLINGER_SQUEEZE',
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + (bb.upper - bb.lower) * 1.5 : currentPrice - (bb.upper - bb.lower) * 1.5,
      stopLoss: bb.middle!,
      riskReward: 3.0,
    },
    indicators: { rsi: indicators.rsi || 50, bbPosition: 0, bbWidth: indicators.bbw, volumeSpike: false, divergence: null },
    duration: 30,
  };

  if(zone) {
    console.log('[BB_SQUEEZE] SIGNAL DETECTED:', { type, confidence: zone.confidence, price: currentPrice, bbw: indicators.bbw });
  }
  
  const executionTime = performance.now() - startTime;
  if (executionTime > 5) {
    console.warn('[PERFORMANCE] Bollinger Squeeze took', executionTime.toFixed(2), 'ms');
  }
  
  return zone;
}

export function detectVolumeAbsorptionZone(candles: CandleData[], indicators: Indicators): StrikeZone | null {
  const startTime = performance.now();
  if (candles.length < 10 || !indicators.atr || !indicators.volSma || indicators.volSma.length === 0) {
    console.debug('[VOL_ABSORB] Missing indicators or data');
    return null;
  }

  const recentCandles = candles.slice(-10);
  
  let climaxCandle = recentCandles[0];
  if (!climaxCandle || !climaxCandle.volume) return null;

  for (let i = 0; i < recentCandles.length - 2; i++) {
    const currentCandle = recentCandles[i];
    if (currentCandle && currentCandle.volume! > climaxCandle.volume!) {
      climaxCandle = currentCandle;
    }
  }
  
  const absorptionCandle = candles[candles.length - 1];
  const avgVolume = indicators.volSma[indicators.volSma.length - 1] || 1;
  
  const isClimax = climaxCandle.volume! > avgVolume * 2.0;
  if (!isClimax) return null;
  
  const climaxRange = climaxCandle.high - climaxCandle.low;
  const isWideRangeClimax = climaxRange > (indicators.atr || 0.001) * 1.2;
  
  const isSellClimax = climaxCandle.close < climaxCandle.open;
  const isBuyClimax = climaxCandle.close > climaxCandle.open;
  
  const recentAbsorption = recentCandles.slice(-2);
  const climaxIndex = recentCandles.indexOf(climaxCandle);
  const isRecentClimax = climaxIndex >= recentCandles.length - 5;
  
  if (!isRecentClimax) return null;
  
  const hasAbsorption = recentAbsorption.some(c => 
    c.volume! < climaxCandle.volume! * 0.6 && 
    Math.abs(c.close - c.open) < (climaxCandle.high - climaxCandle.low) * 0.6
  );
  
  if (!hasAbsorption) return null;
  
  let type: StrikeZone['type'] = 'NEUTRAL';
  if (isSellClimax && isWideRangeClimax) type = 'LONG_ENTRY';
  else if (isBuyClimax && isWideRangeClimax) type = 'SHORT_ENTRY';
  
  const zone = (type === 'NEUTRAL') ? null : { 
    type, 
    confidence: 80,
    triggers: [
      `📊 Clímax de Volume (${(climaxCandle.volume! / avgVolume).toFixed(1)}x média)`,
      `✅ Absorção detectada`
    ], 
    strategy: 'VOLUME_ABSORPTION',
    entry: { price: absorptionCandle.close, timestamp: Date.now() },
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? climaxCandle.high : climaxCandle.low,
      stopLoss: type === 'LONG_ENTRY' ? climaxCandle.low : climaxCandle.high,
      riskReward: 2.0,
    },
    indicators: { rsi: indicators.rsi || 50, bbPosition: 0, bbWidth: 0, volumeSpike: true, divergence: null },
    duration: 120,
  };

  if (zone) {
      console.log('[VOL_ABSORB] SIGNAL DETECTED:', { type: zone.type, confidence: zone.confidence, climaxVolume: climaxCandle.volume, avgVolume });
  }

  const executionTime = performance.now() - startTime;
  if (executionTime > 5) {
    console.warn('[PERFORMANCE] Volume Absorption took', executionTime.toFixed(2), 'ms');
  }

  return zone;
}

export function detectMicrostructureScalpZone(ticks: TickData[], candles: CandleData[], indicators: Indicators, currentPrice: number): StrikeZone | null {
  const startTime = performance.now();
  const micro = extractMicrostructureFeaturesFromService(ticks, candles);
  if (!micro) {
      console.debug('[MICRO_SCALP] Missing microstructure features');
      return null;
  }
  
  let type: StrikeZone['type'] = 'NEUTRAL';
  if (micro.pressure === 'buy' && micro.tickVelocity > 1.5) type = 'LONG_ENTRY';
  else if (micro.pressure === 'sell' && micro.tickVelocity > 1.5) type = 'SHORT_ENTRY';
  
  if (type === 'NEUTRAL') return null;
  
  const atr = indicators.atr || 0.0001;
  
  const zone = (type === 'NEUTRAL') ? null : {
    type,
    confidence: 70,
    triggers: [`⚡ Fluxo de Ordens (${micro.pressure})`],
    entry: { price: currentPrice, timestamp: Date.now() },
    strategy: 'MICROSTRUCTURE_SCALP',
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + atr * 0.5 : currentPrice - atr * 0.5,
      stopLoss: type === 'LONG_ENTRY' ? currentPrice - atr * 0.25 : currentPrice + atr * 0.25,
      riskReward: 2.0,
    },
    indicators: { rsi: indicators.rsi || 50, bbPosition: 0, bbWidth: 0, volumeSpike: true, divergence: null },
    duration: 10, // ✅ CORRIGIDO
  };

  if (zone) {
      console.log('[MICRO_SCALP] SIGNAL DETECTED:', { type: zone.type, confidence: zone.confidence, pressure: micro.pressure, velocity: micro.tickVelocity });
  }

  const executionTime = performance.now() - startTime;
  if (executionTime > 5) {
    console.warn('[PERFORMANCE] Microstructure Scalp took', executionTime.toFixed(2), 'ms');
  }

  return zone;
}
