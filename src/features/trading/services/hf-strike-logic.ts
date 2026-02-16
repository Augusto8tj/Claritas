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
  duration: number; // Duração sugerida em segundos
}

// ============================================================================
// FUNÇÕES DE ANÁLISE PURAS
// ============================================================================

export function detectHFMeanReversionZone(indicators: Indicators, currentPrice: number): StrikeZone | null {
  const { bb, bollingerBands, rsi: rsiValue } = indicators;
  if (!bb || !bollingerBands || rsiValue === null) return null;
  const bbAnalysis = {
    upper: bb.upper!, lower: bb.lower!, middle: bb.middle!,
    width: indicators.bbw!, position: (currentPrice - bb.lower!) / (bb.upper! - bb.lower! || 1),
    isSqueezed: indicators.bbw! < 1.5,
    touchingLower: currentPrice <= bb.lower!, touchingUpper: currentPrice >= bb.upper!,
  };
  const rsiAnalysis = { value: rsiValue, oversold: rsiValue < 30, overbought: rsiValue > 70, divergence: null };
  const triggers: string[] = []; let confidence = 0; let type: StrikeZone['type'] = 'NEUTRAL';
  if (bbAnalysis.touchingLower && rsiAnalysis.oversold) {
    type = 'LONG_ENTRY';
    triggers.push(`📉 Preço na Banda Inferior`, `📊 RSI Oversold (${rsiAnalysis.value.toFixed(1)})`);
    confidence = 75;
  } else if (bbAnalysis.touchingUpper && rsiAnalysis.overbought) {
    type = 'SHORT_ENTRY';
    triggers.push(`📈 Preço na Banda Superior`, `📊 RSI Overbought (${rsiAnalysis.value.toFixed(1)})`);
    confidence = 75;
  }
  if (type === 'NEUTRAL') return null;
  const atr = bbAnalysis.upper - bbAnalysis.lower;
  return { type, confidence: Math.min(100, confidence), triggers, entry: { price: currentPrice, timestamp: Date.now() },
    strategy: 'HF_MEAN_REVERSION',
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + atr * 0.75 : currentPrice - atr * 0.75,
      stopLoss: type === 'LONG_ENTRY' ? currentPrice - atr * 0.5 : currentPrice + atr * 0.5,
      riskReward: 1.5 },
    indicators: { rsi: rsiAnalysis.value, bbPosition: bbAnalysis.position, bbWidth: bbAnalysis.width, volumeSpike: false, divergence: null },
    duration: bbAnalysis.isSqueezed ? 30 : 20 };
}

export function detectStandardTrendZone(indicators: Indicators, currentPrice: number, prevRsi: number): StrikeZone | null {
  if (!indicators.adx || !indicators.ma.long || !indicators.rsi || !indicators.atr) return null;
  const { adx, ma: { long: ema100 }, rsi, atr } = indicators;
  
  if (adx < 20) return { type: 'NEUTRAL', confidence: 0, triggers: ['VETO: Mercado lateral (ADX < 20)'], strategy: 'STD_TREND_FOLLOW', entry: {price:0, timestamp:0}, targets: {takeProfit:0, stopLoss:0, riskReward:0}, indicators:{rsi:0,bbPosition:0,bbWidth:0,volumeSpike:false,divergence:null}, duration:0 };
  
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
  
  if (type === 'NEUTRAL') return null;
  
  return { type, confidence, triggers, entry: { price: currentPrice, timestamp: Date.now() },
    strategy: 'STD_TREND_FOLLOW',
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + atr * 2.0 : currentPrice - atr * 2.0,
      stopLoss: type === 'LONG_ENTRY' ? currentPrice - atr * 1.5 : currentPrice + atr * 1.5,
      riskReward: 2.0 / 1.5,
    },
    indicators: { rsi: rsi, bbPosition: 0, bbWidth: 0, volumeSpike: false, divergence: null },
    duration: 180,
  };
}

export function detectBollingerSqueezeZone(indicators: Indicators, currentPrice: number): StrikeZone | null {
  if (!indicators.bbw || indicators.bbw > 1.5) return null;
  const { bb } = indicators;
  if (!bb?.upper || !bb.lower) return null;
  let type: StrikeZone['type'] = 'NEUTRAL';
  if (currentPrice > bb.upper) type = 'LONG_ENTRY';
  else if (currentPrice < bb.lower) type = 'SHORT_ENTRY';
  else return null;
  return { type, confidence: 80, triggers: [`Squeeze de Bollinger rompido (${indicators.bbw.toFixed(2)}%)`], entry: { price: currentPrice, timestamp: Date.now() },
    strategy: 'BOLLINGER_SQUEEZE',
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + (bb.upper - bb.lower) * 1.5 : currentPrice - (bb.upper - bb.lower) * 1.5,
      stopLoss: bb.middle!,
      riskReward: 3.0, },
    indicators: { rsi: indicators.rsi || 50, bbPosition: 0, bbWidth: indicators.bbw, volumeSpike: false, divergence: null },
    duration: 30, };
}

export function detectVolumeAbsorptionZone(candles: CandleData[], indicators: Indicators): StrikeZone | null {
  if (candles.length < 10 || !indicators.atr || !indicators.volSma || indicators.volSma.length === 0) 
    return null;

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
  
  const isClimax = climaxCandle.volume! > avgVolume * 1.8;
  if (!isClimax) return null;
  
  const climaxRange = climaxCandle.high - climaxCandle.low;
  const isWideRangeClimax = climaxRange > (indicators.atr || 0.001) * 1.2;
  
  const isSellClimax = climaxCandle.close < climaxCandle.open;
  const isBuyClimax = climaxCandle.close > climaxCandle.open;
  
  const recentAbsorption = recentCandles.slice(-3);
  const hasAbsorption = recentAbsorption.some(c => 
    c.volume! < climaxCandle.volume! * 0.6 && 
    Math.abs(c.close - c.open) < (climaxCandle.high - climaxCandle.low) * 0.6
  );
  
  if (!hasAbsorption) return null;
  
  let type: StrikeZone['type'] = 'NEUTRAL';
  if (isSellClimax && isWideRangeClimax) type = 'LONG_ENTRY';
  else if (isBuyClimax && isWideRangeClimax) type = 'SHORT_ENTRY';
  
  if (type === 'NEUTRAL') return null;
  
  return { 
    type, 
    confidence: 80,
    triggers: [`Absorção de Volume após clímax (${(climaxCandle.volume! / avgVolume).toFixed(1)}x média)`], 
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
}


export function detectMicrostructureScalpZone(ticks: TickData[], candles: CandleData[], indicators: Indicators, currentPrice: number): StrikeZone | null {
  const micro = extractMicrostructureFeaturesFromService(ticks, candles);
  if (!micro) return null;
  let type: StrikeZone['type'] = 'NEUTRAL';
  if (micro.pressure === 'buy' && micro.tickVelocity > 1.5) type = 'LONG_ENTRY';
  else if (micro.pressure === 'sell' && micro.tickVelocity > 1.5) type = 'SHORT_ENTRY';
  if (type === 'NEUTRAL') return null;
  const atr = indicators.atr || 0.0001;
  return { type, confidence: 70, triggers: [`Fluxo de Ordens (${micro.pressure})`], entry: { price: currentPrice, timestamp: Date.now() },
    strategy: 'MICROSTRUCTURE_SCALP',
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + atr * 0.5 : currentPrice - atr * 0.5,
      stopLoss: type === 'LONG_ENTRY' ? currentPrice - atr * 0.25 : currentPrice + atr * 0.25,
      riskReward: 2.0, },
    indicators: { rsi: indicators.rsi || 50, bbPosition: 0, bbWidth: 0, volumeSpike: true, divergence: null },
    duration: 5, };
}
