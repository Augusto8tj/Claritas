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

// --- TIPOS DE PARÂMETROS ---
export interface MeanReversionParams { rsiThreshold: number; tolerance: number; }
export interface TrendFollowParams { adxStrength: number; rsiMomentum: number; }
export interface SqueezeParams { bbwThreshold: number; breakoutMargin: number; }
export interface AbsorptionParams { climaxMultiplier: number; absorptionFactor: number; }
export interface ScalpParams { velocityThreshold: number; }

// ============================================================================
// FUNÇÕES DE ANÁLISE PURAS
// ============================================================================

export function detectHFMeanReversionZone(indicators: Indicators, currentPrice: number, params: MeanReversionParams): StrikeZone | null {
  const startTime = performance.now();
  const { bb, rsi: rsiValue } = indicators;
  
  if (!bb || !bb.upper || !bb.lower || rsiValue === null) {
    console.debug('[HF_MEAN_REV] Missing indicators:', { bb: !!bb, rsi: !!rsiValue });
    return null;
  }
  
  const bbAnalysis = {
    upper: bb.upper!,
    lower: bb.lower!,
    middle: bb.middle!,
    width: indicators.bbw!,
    position: (currentPrice - bb.lower!) / (bb.upper! - bb.lower! || 1),
    isSqueezed: (indicators.bbw || 100) < 1.0,
    touchingLower: currentPrice <= bb.lower! * (1 + params.tolerance),
    touchingUpper: currentPrice >= bb.upper! * (1 - params.tolerance),
  };
  
  const rsiThresholdUpper = 100 - params.rsiThreshold;
  const rsiAnalysis = { value: rsiValue, oversold: rsiValue < params.rsiThreshold, overbought: rsiValue > rsiThresholdUpper, divergence: null };
  
  const triggers: string[] = [];
  let confidence = 0;
  let type: StrikeZone['type'] = 'NEUTRAL';
  
  if (bbAnalysis.touchingLower && rsiAnalysis.oversold) {
    type = 'LONG_ENTRY';
    triggers.push(`📉 Preço na Banda Inferior`, `📊 RSI Oversold (${rsiAnalysis.value.toFixed(1)})`);
    confidence = bbAnalysis.isSqueezed ? 85 : 75;
    if (bbAnalysis.isSqueezed) triggers.push('Squeeze Ativo');
  } else if (bbAnalysis.touchingUpper && rsiAnalysis.overbought) {
    type = 'SHORT_ENTRY';
    triggers.push(`📈 Preço na Banda Superior`, `📊 RSI Overbought (${rsiAnalysis.value.toFixed(1)})`);
    confidence = bbAnalysis.isSqueezed ? 85 : 75;
     if (bbAnalysis.isSqueezed) triggers.push('Squeeze Ativo');
  }
  
  if (type === 'NEUTRAL') return null;
  
  const atr = bbAnalysis.upper - bbAnalysis.lower;
  
  const zone: StrikeZone = {
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
  
  console.log('[HF_MEAN_REV] SIGNAL DETECTED:', { type: zone.type, confidence, price: currentPrice, rsi: rsiValue });
  
  const executionTime = performance.now() - startTime;
  if (executionTime > 5) console.warn('[PERFORMANCE] HF Mean Reversion took', executionTime.toFixed(2), 'ms');

  return zone;
}

export function detectStandardTrendZone(indicators: Indicators, currentPrice: number, prevRsi: number, params: TrendFollowParams): StrikeZone | null {
  const startTime = performance.now();
  if (!indicators.adx || !indicators.ma.long || !indicators.rsi || !indicators.atr) {
    console.debug('[STD_TREND] Missing indicators:', { adx: !!indicators.adx, ma: !!indicators.ma.long, rsi: !!indicators.rsi, atr: !!indicators.atr });
    return null;
  }
  
  const { adx, ma: { long: ema100 }, rsi, atr } = indicators;
  
  if (adx < params.adxStrength) {
    console.debug(`[STD_TREND] VETO: ADX ${adx.toFixed(1)} < ${params.adxStrength}`);
    return null;
  }
  
  const isUpTrend = currentPrice > ema100!;
  const isDownTrend = currentPrice < ema100!;
  
  const rsiMomentumThresholdUp = params.rsiMomentum;
  const rsiMomentumThresholdDown = 100 - params.rsiMomentum;
  
  const rsiCrossedUp = rsi > rsiMomentumThresholdUp && prevRsi <= rsiMomentumThresholdUp;
  const rsiCrossedDown = rsi < rsiMomentumThresholdDown && prevRsi >= rsiMomentumThresholdDown;
  
  let type: StrikeZone['type'] = 'NEUTRAL';
  const triggers: string[] = [];
  let confidence = 0;
  
  if (isUpTrend && rsiCrossedUp) { 
    type = 'LONG_ENTRY'; 
    triggers.push(`📈 Tendência de Alta (ADX: ${adx.toFixed(1)})`, `🐂 RSI cruzou UP (${rsi.toFixed(1)})`); 
    confidence = 75; 
  }
  else if (isDownTrend && rsiCrossedDown) { 
    type = 'SHORT_ENTRY'; 
    triggers.push(`📉 Tendência de Baixa (ADX: ${adx.toFixed(1)})`, `🐻 RSI cruzou DOWN (${rsi.toFixed(1)})`); 
    confidence = 75; 
  }
  
  if (type === 'NEUTRAL') return null;
  
  const zone: StrikeZone = {
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
  
  console.log('[STD_TREND] SIGNAL DETECTED:', { type, confidence, price: currentPrice, adx, rsi });
  const executionTime = performance.now() - startTime;
  if (executionTime > 5) console.warn('[PERFORMANCE] STD Trend Follow took', executionTime.toFixed(2), 'ms');

  return zone;
}

export function detectBollingerSqueezeZone(indicators: Indicators, currentPrice: number, params: SqueezeParams): StrikeZone | null {
  const startTime = performance.now();
  if (!indicators.bbw || indicators.bbw > params.bbwThreshold) {
    if(indicators.bbw) console.debug(`[BB_SQUEEZE] VETO: BBW ${indicators.bbw.toFixed(2)}% > ${params.bbwThreshold}%`);
    return null;
  }
  
  const { bb } = indicators;
  if (!bb?.upper || !bb.lower) {
    console.debug('[BB_SQUEEZE] Missing indicators: BB');
    return null;
  }
  
  let type: StrikeZone['type'] = 'NEUTRAL';
  
  const breakoutMargin = (bb.upper - bb.lower) * params.breakoutMargin;
  
  if (currentPrice > bb.upper + breakoutMargin) {
    type = 'LONG_ENTRY';
  } else if (currentPrice < bb.lower - breakoutMargin) {
    type = 'SHORT_ENTRY';
  } else {
    return null;
  }
  
  const zone: StrikeZone = {
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

  console.log('[BB_SQUEEZE] SIGNAL DETECTED:', { type, confidence: zone.confidence, bbw: indicators.bbw });
  const executionTime = performance.now() - startTime;
  if (executionTime > 5) console.warn('[PERFORMANCE] Bollinger Squeeze took', executionTime.toFixed(2), 'ms');
  
  return zone;
}

export function detectVolumeAbsorptionZone(candles: CandleData[], indicators: Indicators, params: AbsorptionParams): StrikeZone | null {
  const startTime = performance.now();
  
  // ✅ MELHORIA: Log detalhado de pré-condições
  if (candles.length < 20) {
    console.debug(`[VOL_ABSORB] VETO: Histórico insuficiente (${candles.length} < 20 candles)`);
    return null;
  }
  
  if (!indicators.atr) {
    console.debug('[VOL_ABSORB] VETO: ATR não calculado');
    return null;
  }
  
  if (!indicators.volSma || indicators.volSma.length === 0) {
    console.debug('[VOL_ABSORB] VETO: VolSMA não calculado');
    return null;
  }

  // ✅ CORREÇÃO: Lookback mais curto (10 velas ao invés de 15)
  const lookbackPeriod = 10;
  const searchWindow = candles.slice(-lookbackPeriod);  // ✅ Inclui última vela
  
  const avgVolume = indicators.volSma[indicators.volSma.length - 1] || 1;
  
  // ✅ CORREÇÃO: Busca do mais antigo ao mais recente (left-to-right)
  let climaxCandle: CandleData | null = null;
  let climaxIndex = -1;
  let maxVolume = 0;

  // ✅ MELHORIA: Encontra o clímax de maior volume (não o primeiro)
  for (let i = 0; i < searchWindow.length - 2; i++) {  // ✅ Deixa 2 velas para absorção
    const candle = searchWindow[i];
    if (candle && candle.volume && candle.volume > avgVolume * params.climaxMultiplier) {
      if (candle.volume > maxVolume) {
        maxVolume = candle.volume;
        climaxCandle = candle;
        climaxIndex = candles.length - lookbackPeriod + i;
      }
    }
  }
  
  if (!climaxCandle || climaxIndex === -1) {
    console.debug(`[VOL_ABSORB] VETO: Nenhum clímax encontrado (threshold: ${params.climaxMultiplier}x)`);
    return null;
  }
  
  // ✅ MELHORIA: Log do clímax encontrado
  console.debug(`[VOL_ABSORB] Clímax encontrado: volume=${climaxCandle.volume}, avg=${avgVolume.toFixed(0)}, ratio=${(climaxCandle.volume! / avgVolume).toFixed(2)}x`);
  
  const climaxRange = climaxCandle.high - climaxCandle.low;
  const isWideRangeClimax = climaxRange > (indicators.atr || 0.001) * 1.2;
  
  if (!isWideRangeClimax) {
    console.debug(`[VOL_ABSORB] VETO: Range não é largo o suficiente (${(climaxRange / (indicators.atr || 1)).toFixed(2)}x ATR < 1.2x)`);
    return null;
  }

  // ✅ CORREÇÃO: Window de absorção limitada (apenas 2-4 velas após clímax)
  const absorptionWindowStart = climaxIndex + 1;
  const absorptionWindowEnd = Math.min(climaxIndex + 5, candles.length);  // ✅ Max 4 velas após
  const absorptionWindow = candles.slice(absorptionWindowStart, absorptionWindowEnd);
  
  if (absorptionWindow.length < 1) {
    console.debug(`[VOL_ABSORB] VETO: Sem velas pós-clímax para validar absorção`);
    return null;
  }

  // ✅ MELHORIA: Validação mais robusta de absorção
  let absorptionCount = 0;
  for (const c of absorptionWindow) {
    const volumeAbsorbed = (c.volume || 0) < climaxCandle.volume! * params.absorptionFactor;
    const rangeSmall = Math.abs(c.close - c.open) < climaxRange * params.absorptionFactor;
    
    if (volumeAbsorbed && rangeSmall) {
      absorptionCount++;
    }
  }
  
  // ✅ CORREÇÃO: Exige pelo menos 50% das velas com absorção
  const hasAbsorption = absorptionCount >= Math.ceil(absorptionWindow.length / 2);

  if (!hasAbsorption) {
    console.debug(`[VOL_ABSORB] VETO: Absorção insuficiente (${absorptionCount}/${absorptionWindow.length} velas)`);
    return null;
  }

  const isSellClimax = climaxCandle.close < climaxCandle.open;
  const isBuyClimax = climaxCandle.close > climaxCandle.open;
  
  let type: StrikeZone['type'] = 'NEUTRAL';
  if (isSellClimax) {
    type = 'LONG_ENTRY';
  } else if (isBuyClimax) {
    type = 'SHORT_ENTRY'
  }

  if (type === 'NEUTRAL') {
    console.debug(`[VOL_ABSORB] VETO: Clímax não é claramente bullish ou bearish`);
    return null;
  }

  const currentPrice = candles[candles.length - 1].close;

  const zone: StrikeZone = { 
    type, 
    confidence: 80,
    triggers: [
      `📊 Clímax de Volume (${(climaxCandle.volume! / avgVolume).toFixed(1)}x média)`,
      `✅ Absorção detectada (${absorptionCount}/${absorptionWindow.length} velas)`
    ], 
    strategy: 'VOLUME_ABSORPTION',
    entry: { price: currentPrice, timestamp: Date.now() },
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + climaxRange : currentPrice - climaxRange,
      stopLoss: type === 'LONG_ENTRY' ? climaxCandle.low : climaxCandle.high,
      riskReward: (climaxRange) / Math.abs(currentPrice - (type === 'LONG_ENTRY' ? climaxCandle.low : climaxCandle.high)) || 2.0,
    },
    indicators: { 
      rsi: indicators.rsi || 50, 
      bbPosition: 0, 
      bbWidth: indicators.bbw || 0, 
      volumeSpike: true, 
      divergence: null 
    },
    duration: 120,
  };
  
  console.log(`[VOL_ABSORB] SIGNAL DETECTED:`, { 
    type: zone.type, 
    confidence: zone.confidence,
    climaxVolume: climaxCandle.volume,
    avgVolume: avgVolume.toFixed(0),
    absorptionRatio: `${absorptionCount}/${absorptionWindow.length}`
  });
  
  const executionTime = performance.now() - startTime;
  if (executionTime > 5) console.warn('[PERFORMANCE] Volume Absorption took', executionTime.toFixed(2), 'ms');

  return zone;
}


export function detectMicrostructureScalpZone(ticks: TickData[], candles: CandleData[], indicators: Indicators, currentPrice: number, params: ScalpParams): StrikeZone | null {
  const startTime = performance.now();
  const micro = extractMicrostructureFeaturesFromService(ticks, candles);
  if (!micro) {
      console.debug('[MICRO_SCALP] Missing microstructure features');
      return null;
  }
  
  let type: StrikeZone['type'] = 'NEUTRAL';
  if (micro.pressure === 'buy' && micro.tickVelocity > params.velocityThreshold) type = 'LONG_ENTRY';
  else if (micro.pressure === 'sell' && micro.tickVelocity > params.velocityThreshold) type = 'SHORT_ENTRY';
  
  if (type === 'NEUTRAL') return null;
  
  const atr = indicators.atr || 0.0001;
  
  const zone: StrikeZone = {
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
    duration: 10,
  };
  
  console.log('[MICRO_SCALP] SIGNAL DETECTED:', { type: zone.type, confidence: zone.confidence, pressure: micro.pressure, velocity: micro.tickVelocity });
  const executionTime = performance.now() - startTime;
  if (executionTime > 5) console.warn('[PERFORMANCE] Microstructure Scalp took', executionTime.toFixed(2), 'ms');

  return zone;
}
