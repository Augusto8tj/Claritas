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
    touchingLower: currentPrice <= bb.lower! * 1.005, touchingUpper: currentPrice >= bb.upper! * 0.995,
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
  let type: StrikeZone['type'] = 'NEUTRAL'; const triggers: string[] = []; let confidence = 0;
  const isUpTrend = currentPrice > ema100!; const isDownTrend = currentPrice < ema100!;
  if (adx < 25) return { type: 'NEUTRAL', confidence: 0, triggers: ['VETO: Mercado lateral (ADX < 25)'], entry: {price:0, timestamp:0}, targets: {takeProfit:0, stopLoss:0, riskReward:0}, indicators:{rsi:0,bbPosition:0,bbWidth:0,volumeSpike:false,divergence:null}, duration:0 };
  if (isUpTrend && rsi > 50 && prevRsi <= 50) { type = 'LONG_ENTRY'; triggers.push(`📈 Tendência de Alta`, `🐂 RSI cruzou 50`); confidence = 65; }
  else if (isDownTrend && rsi < 50 && prevRsi >= 50) { type = 'SHORT_ENTRY'; triggers.push(`📉 Tendência de Baixa`, `🐻 RSI cruzou 50`); confidence = 65; }
  if (type === 'NEUTRAL') return null;
  return { type, confidence, triggers, entry: { price: currentPrice, timestamp: Date.now() },
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + atr * 2.0 : currentPrice - atr * 2.0,
      stopLoss: type === 'LONG_ENTRY' ? currentPrice - atr * 1.5 : currentPrice + atr * 1.5,
      riskReward: 2.0 / 1.5, },
    indicators: { rsi: rsi, bbPosition: 0, bbWidth: 0, volumeSpike: false, divergence: null },
    duration: 180, // 3 minutes for a 15m candle trade
  };
}

export function detectBollingerSqueezeZone(indicators: Indicators, currentPrice: number): StrikeZone | null {
  if (!indicators.bbw || indicators.bbw > 1.0) return null;
  const { bb } = indicators;
  if (!bb?.upper || !bb.lower) return null;
  let type: StrikeZone['type'] = 'NEUTRAL';
  if (currentPrice > bb.upper) type = 'LONG_ENTRY';
  else if (currentPrice < bb.lower) type = 'SHORT_ENTRY';
  else return null;
  return { type, confidence: 80, triggers: [`Squeeze de Bollinger rompido (${indicators.bbw.toFixed(2)}%)`], entry: { price: currentPrice, timestamp: Date.now() },
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + (bb.upper - bb.lower) * 1.5 : currentPrice - (bb.upper - bb.lower) * 1.5,
      stopLoss: bb.middle!,
      riskReward: 3.0, },
    indicators: { rsi: indicators.rsi || 50, bbPosition: 0, bbWidth: indicators.bbw, volumeSpike: false, divergence: null },
    duration: 30, };
}

export function detectVolumeAbsorptionZone(candles: CandleData[], indicators: Indicators): StrikeZone | null {
  if (candles.length < 5 || !indicators.atr || !indicators.volSma || indicators.volSma.length < 5) return null;

  const last4 = candles.slice(-4);
  const climaxCandle = last4[0];
  const absorptionCandle = last4[3];
  
  if (!climaxCandle.volume || !absorptionCandle.volume) return null;
  
  const lastVolSma = indicators.volSma[indicators.volSma.length - 5]; // Get SMA from a few candles ago to avoid using the spike itself
  const isClimax = climaxCandle.volume > (lastVolSma ? lastVolSma * 2.5 : 50) && Math.abs(climaxCandle.close - climaxCandle.open) > indicators.atr;

  if (!isClimax) return null;

  const isSellClimax = climaxCandle.close < climaxCandle.open;
  const isBuyClimax = climaxCandle.close > climaxCandle.open;
  const isAbsorption = absorptionCandle.volume < climaxCandle.volume * 0.5 && Math.abs(absorptionCandle.close - absorptionCandle.open) < climaxCandle.open * 0.5;
  
  let type: StrikeZone['type'] = 'NEUTRAL';
  if (isSellClimax && isAbsorption && absorptionCandle.close > absorptionCandle.open) type = 'LONG_ENTRY';
  else if (isBuyClimax && isAbsorption && absorptionCandle.close < absorptionCandle.open) type = 'SHORT_ENTRY';
  if (type === 'NEUTRAL') return null;
  
  return { type, confidence: 85, triggers: [`Absorção de Volume após clímax`], entry: { price: absorptionCandle.close, timestamp: Date.now() },
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? climaxCandle.high : climaxCandle.low,
      stopLoss: type === 'LONG_ENTRY' ? climaxCandle.low : climaxCandle.high,
      riskReward: 2.5, },
    indicators: { rsi: indicators.rsi || 50, bbPosition: 0, bbWidth: 0, volumeSpike: true, divergence: null },
    duration: 180, };
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
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + atr * 0.5 : currentPrice - atr * 0.5,
      stopLoss: type === 'LONG_ENTRY' ? currentPrice - atr * 0.25 : currentPrice + atr * 0.25,
      riskReward: 2.0, },
    indicators: { rsi: indicators.rsi || 50, bbPosition: 0, bbWidth: 0, volumeSpike: true, divergence: null },
    duration: 10, };
}
