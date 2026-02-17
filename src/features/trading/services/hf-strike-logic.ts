// src/features/trading/services/hf-strike-logic.ts
'use client';

import type { TickData, CandleData, MicrostructureFeatures } from '@/lib/types';
import type { Indicators } from './indicator-service';
import { extractMicrostructureFeatures as extractMicrostructureFeaturesFromService } from './advanced-trading-services';
import { recordSignal, recordVeto } from './strategy-metrics';


// ============================================================================
// DETECÇÃO DE ATIVO RANDÔMICO
// ============================================================================

/**
 * Detecta se o ativo é randômico analisando padrões de preço
 * Ativos randômicos (1HZ10V, R_10, etc) têm características específicas:
 * - ADX consistentemente baixo (< 20)
 * - RSI oscilando em torno de 50
 * - Volume relativamente constante
 * - Sem tendências sustentadas
 */
export function isRandomAsset(candles: CandleData[], indicators: Indicators): boolean {
  if (candles.length < 50) return false;
  
  const recentCandles = candles.slice(-50);
  
  const adxBelowThreshold = (indicators.adx || 30) < 22;
  const rsi = indicators.rsi || 50;
  const rsiNeutral = rsi > 35 && rsi < 65;
  
  const volumes = recentCandles.map(c => c.volume || 0).filter(v => v > 0);
  if (volumes.length < 10) return false;
  
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const maxVol = Math.max(...volumes);
  const volumeVariation = maxVol / avgVol;
  const volumeConsistent = volumeVariation < 3.0;
  
  const prices = recentCandles.map(c => c.close);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const priceStd = Math.sqrt(
    prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length
  );
  const priceRange = Math.max(...prices) - Math.min(...prices);
  const lowVolatilityTrend = priceRange < priceStd * 5;
  
  const testsPass = [adxBelowThreshold, rsiNeutral, volumeConsistent, lowVolatilityTrend]
    .filter(t => t).length;
  
  const isRandom = testsPass >= 3;
  
  if (isRandom) {
    console.warn('[ASSET_DETECTION] ⚠️ ATIVO RANDÔMICO DETECTADO', {
      adx: indicators.adx?.toFixed(1),
      rsi: rsi.toFixed(1),
      volumeVariation: volumeVariation.toFixed(2),
      testsPass
    });
  }
  
  return isRandom;
}

/**
 * Ajusta parâmetros de estratégias para ativos randômicos
 */
export function getRandomAssetParams() {
  return {
    HF_MEAN_REVERSION: {
      rsiThreshold: 35,
      tolerance: 0.005,
    },
    STD_TREND_FOLLOW: {
      adxStrength: 15,
      rsiMomentum: 52,
    },
    BOLLINGER_SQUEEZE: {
      bbwThreshold: 1.5,
      breakoutMargin: 0.01,
    },
    VOLUME_ABSORPTION: {
      climaxMultiplier: 1.5,
      absorptionFactor: 0.7,
    },
    MICROSTRUCTURE_SCALP: {
      velocityThreshold: 1.2,
    },
  };
}

// ============================================================================
// TIPOS E INTERFACES REUTILIZÁVEIS
// ============================================================================
export type StrategyType =
  | 'HF_MEAN_REVERSION'
  | 'STD_TREND_FOLLOW'
  | 'BOLLINGER_SQUEEZE'
  | 'VOLUME_ABSORPTION'
  | 'MICROSTRUCTURE_SCALP'
  | 'GBM_20S'
  | 'GBM_40S';
  
export const strategyMetadata: Record<StrategyType, { label: string; description: string; isHF: boolean; }> = {
  HF_MEAN_REVERSION: { label: 'Alta Frequência (Reversão)', description: 'Otimizado para reversão à média em 15-45s.', isHF: true },
  STD_TREND_FOLLOW: { label: 'Padrão (Tendência)', description: 'Segue tendências em velas de 15m.', isHF: false },
  BOLLINGER_SQUEEZE: { label: 'Rompimento (Squeeze)', description: 'Opera na explosão de volatilidade.', isHF: true },
  VOLUME_ABSORPTION: { label: 'Absorção de Volume', description: 'Analisa o clímax e absorção de volume.', isHF: false },
  MICROSTRUCTURE_SCALP: { label: 'Scalping de Fluxo', description: 'Opera o fluxo de ordens para trades de 5 ticks.', isHF: true },
  GBM_20S: { label: 'Preditivo (GBM 20s)', description: 'Usa Movimento Browniano Geométrico para prever o preço em 20s.', isHF: true },
  GBM_40S: { label: 'Preditivo (GBM 40s)', description: 'Usa Movimento Browniano Geométrico para prever o preço em 40s.', isHF: true },
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


function runSimpleGBM(startPrice: number, durationSeconds: number, volatility: number): number {
    const dt = 1; // Time step of 1 second
    let price = startPrice;
    const drift = 0; // Assume no drift for random assets
    const steps = durationSeconds;

    for (let i = 0; i < steps; i++) {
        // Simplified normal random using central limit theorem approximation. More performant than Box-Muller.
        let sum = 0;
        for (let j = 0; j < 12; j++) {
          sum += Math.random();
        }
        const randomShock = (sum - 6) * Math.sqrt(dt);
        price += price * (drift * dt + volatility * randomShock);
    }
    return price;
}

function createGBMDetector(duration: 20 | 40): (indicators: Indicators, currentPrice: number) => StrikeZone | null {
  const strategyType: StrategyType = `GBM_${duration}S` as StrategyType;

  return (indicators: Indicators, currentPrice: number): StrikeZone | null => {
    if (!indicators.atr || !currentPrice) {
      recordVeto(strategyType, 'Indicadores (ATR) ou preço ausentes');
      return null;
    }

    // Use a normalized ATR as a proxy for instantaneous volatility
    const volatility = (indicators.atr / currentPrice) * 10; // Scaled up for more realistic simulation
    
    // Run a single simulation. For more robustness, one could run a mini-Monte Carlo.
    const finalPrice = runSimpleGBM(currentPrice, duration, volatility);

    const type = finalPrice > currentPrice ? 'LONG_ENTRY' : 'SHORT_ENTRY';
    
    // Confidence is inversely proportional to volatility. Less chaos = more confidence.
    const confidence = Math.max(50, Math.min(90, 100 - (volatility * 1000)));

    const zone: StrikeZone = {
      type,
      confidence,
      triggers: [`🔮 Predição GBM ${duration}s`],
      entry: { price: currentPrice, timestamp: Date.now() },
      strategy: strategyType,
      targets: {
        takeProfit: type === 'LONG_ENTRY' ? currentPrice + indicators.atr * 1.5 : currentPrice - indicators.atr * 1.5,
        stopLoss: type === 'LONG_ENTRY' ? currentPrice - indicators.atr : currentPrice + indicators.atr,
        riskReward: 1.5,
      },
      indicators: { rsi: indicators.rsi || 50, bbPosition: 0, bbWidth: indicators.bbw || 0, volumeSpike: false, divergence: null },
      duration,
    };
    
    recordSignal(zone.strategy, zone.confidence);
    return zone;
  };
}

// ============================================================================
// FUNÇÕES DE ANÁLISE PURAS
// ============================================================================

export function detectHFMeanReversionZone(indicators: Indicators, currentPrice: number, params: MeanReversionParams): StrikeZone | null {
  const startTime = performance.now();
  const { bb, rsi: rsiValue } = indicators;
  
  if (!bb || !bb.upper || !bb.lower || rsiValue === null) {
    recordVeto('HF_MEAN_REVERSION', 'Indicadores ausentes (BB/RSI)');
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
  
  if (type === 'NEUTRAL') {
    recordVeto('HF_MEAN_REVERSION', 'Preço não em extremo OU RSI neutro');
    return null;
  }
  
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
  
  recordSignal(zone.strategy, zone.confidence);
  
  const executionTime = performance.now() - startTime;
  if (executionTime > 5) console.warn('[PERFORMANCE] HF Mean Reversion took', executionTime.toFixed(2), 'ms');

  return zone;
}

export function detectStandardTrendZone(indicators: Indicators, currentPrice: number, prevRsi: number, params: TrendFollowParams): StrikeZone | null {
  const startTime = performance.now();
  if (!indicators.adx || !indicators.ma.long || !indicators.rsi || !indicators.atr) {
    recordVeto('STD_TREND_FOLLOW', 'Indicadores ausentes (ADX/MA/RSI/ATR)');
    return null;
  }
  
  const { adx, ma: { long: ema100 }, rsi, atr } = indicators;
  
  if (adx < params.adxStrength) {
    recordVeto('STD_TREND_FOLLOW', `ADX ${adx.toFixed(1)} < ${params.adxStrength}`);
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
  
  if (type === 'NEUTRAL') {
    recordVeto('STD_TREND_FOLLOW', 'Sem cruzamento de RSI em tendência');
    return null;
  }
  
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
  
  recordSignal(zone.strategy, zone.confidence);
  const executionTime = performance.now() - startTime;
  if (executionTime > 5) console.warn('[PERFORMANCE] STD Trend Follow took', executionTime.toFixed(2), 'ms');

  return zone;
}

export function detectBollingerSqueezeZone(indicators: Indicators, currentPrice: number, params: SqueezeParams): StrikeZone | null {
  const startTime = performance.now();
  if (!indicators.bbw) {
      recordVeto('BOLLINGER_SQUEEZE', 'Indicador BBW ausente');
      return null;
  }
  
  if (indicators.bbw > params.bbwThreshold) {
    recordVeto('BOLLINGER_SQUEEZE', `Sem squeeze (BBW ${indicators.bbw.toFixed(2)} > ${params.bbwThreshold})`);
    return null;
  }
  
  const { bb } = indicators;
  if (!bb?.upper || !bb.lower) {
    recordVeto('BOLLINGER_SQUEEZE', 'Bandas de Bollinger ausentes');
    return null;
  }
  
  let type: StrikeZone['type'] = 'NEUTRAL';
  
  const breakoutMargin = (bb.upper - bb.lower) * params.breakoutMargin;
  
  if (currentPrice > bb.upper + breakoutMargin) {
    type = 'LONG_ENTRY';
  } else if (currentPrice < bb.lower - breakoutMargin) {
    type = 'SHORT_ENTRY';
  } else {
    recordVeto('BOLLINGER_SQUEEZE', 'Preço não rompeu as bandas com margem');
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

  recordSignal(zone.strategy, zone.confidence);
  const executionTime = performance.now() - startTime;
  if (executionTime > 5) console.warn('[PERFORMANCE] Bollinger Squeeze took', executionTime.toFixed(2), 'ms');
  
  return zone;
}

export function detectVolumeAbsorptionZone(candles: CandleData[], indicators: Indicators, params: AbsorptionParams): StrikeZone | null {
  const startTime = performance.now();
  
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

  const lookbackPeriod = 20;
  const searchWindow = candles.slice(-lookbackPeriod);
  
  const avgVolume = indicators.volSma[indicators.volSma.length - 1] || 1;
  
  let climaxCandle: CandleData | null = null;
  let climaxIndex = -1;
  let maxVolume = 0;

  for (let i = 0; i < searchWindow.length - 4; i++) {
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
  
  console.debug(`[VOL_ABSORB] Clímax encontrado: volume=${climaxCandle.volume}, avg=${avgVolume.toFixed(0)}, ratio=${(climaxCandle.volume! / avgVolume).toFixed(2)}x`);
  
  const climaxRange = climaxCandle.high - climaxCandle.low;
  const isWideRangeClimax = climaxRange > (indicators.atr || 0.001) * 1.2;
  
  if (!isWideRangeClimax) {
    console.debug(`[VOL_ABSORB] VETO: Range não é largo o suficiente (${(climaxRange / (indicators.atr || 1)).toFixed(2)}x ATR < 1.2x)`);
    return null;
  }

  const absorptionWindowStart = climaxIndex + 1;
  const absorptionWindowEnd = Math.min(climaxIndex + 5, candles.length);
  const absorptionWindow = candles.slice(absorptionWindowStart, absorptionWindowEnd);
  
  if (absorptionWindow.length < 1) {
    console.debug(`[VOL_ABSORB] VETO: Sem velas pós-clímax para validar absorção`);
    return null;
  }

  let absorptionCount = 0;
  for (const c of absorptionWindow) {
    const volumeAbsorbed = (c.volume || 0) < climaxCandle.volume! * params.absorptionFactor;
    const rangeSmall = Math.abs(c.close - c.open) < climaxRange * params.absorptionFactor;
    
    if (volumeAbsorbed && rangeSmall) {
      absorptionCount++;
    }
  }
  
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
      recordVeto('MICROSTRUCTURE_SCALP', 'Microestrutura indisponível');
      return null;
  }
  
  let type: StrikeZone['type'] = 'NEUTRAL';
  if (micro.pressure === 'buy' && micro.tickVelocity > params.velocityThreshold) type = 'LONG_ENTRY';
  else if (micro.pressure === 'sell' && micro.tickVelocity > params.velocityThreshold) type = 'SHORT_ENTRY';
  
  if (type === 'NEUTRAL') {
    recordVeto('MICROSTRUCTURE_SCALP', `Pressão (${micro.pressure}) ou velocidade (${micro.tickVelocity.toFixed(1)}) insuficiente`);
    return null;
  }
  
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
  
  recordSignal(zone.strategy, zone.confidence);
  const executionTime = performance.now() - startTime;
  if (executionTime > 5) console.warn('[PERFORMANCE] Microstructure Scalp took', executionTime.toFixed(2), 'ms');

  return zone;
}

export function detectRandomWalkZone(
  candles: CandleData[], 
  indicators: Indicators, 
  currentPrice: number
): StrikeZone | null {
  if (!isRandomAsset(candles, indicators)) return null;
  
  const atr = indicators.atr || 0.001;
  const bbw = indicators.bbw || 2.0;
  
  if (bbw < 0.8) return null;
  if (bbw > 3.0) return null;
  
  const rsi = indicators.rsi || 50;
  const type: StrikeZone['type'] = rsi < 50 ? 'LONG_ENTRY' : 'SHORT_ENTRY';
  
  return {
    type,
    confidence: 50,
    triggers: ['🎲 Random Walk Strategy', `RSI: ${rsi.toFixed(1)}`],
    entry: { price: currentPrice, timestamp: Date.now() },
    strategy: 'MICROSTRUCTURE_SCALP',
    targets: {
      takeProfit: type === 'LONG_ENTRY' ? currentPrice + atr * 2.0 : currentPrice - atr * 2.0,
      stopLoss: type === 'LONG_ENTRY' ? currentPrice - atr * 1.0 : currentPrice + atr * 1.0,
      riskReward: 2.0,
    },
    indicators: { rsi, bbPosition: 0, bbWidth: bbw, volumeSpike: false, divergence: null },
    duration: 60,
  };
}

export const detectGBM20sZone = createGBMDetector(20);
export const detectGBM40sZone = createGBMDetector(40);
