// src/features/trading/services/digit-indicators.ts
'use client';

import type { TickData } from '@/lib/types';
import type { Digit, DigitFrequency } from './digits-analysis';
import { timingMonitor } from '../utils/timing-monitor';

// ============================================================================
// 1. MOMENTUM INDICATORS
// ============================================================================

export interface MomentumIndicators {
  digitMomentum: number;      // -1 a +1 (bear to bull)
  trendStrength: number;       // 0 a 1
  movingAverage: number;       // MA do último dígito
  rateOfChange: number;        // ROC do último dígito
}

/**
 * Calcula momentum do último dígito nas últimas N observações
 */
export function calculateMomentum(
  ticks: TickData[], 
  shortPeriod: number = 10,
  longPeriod: number = 50,
  decimalPlaces: number = 2
): MomentumIndicators {
  if (ticks.length < longPeriod) {
    return { digitMomentum: 0, trendStrength: 0, movingAverage: 5, rateOfChange: 0 };
  }

  const getLastDigit = (price: number): number => {
    if (isNaN(price) || !Number.isFinite(price)) return 0;
    const priceString = price.toFixed(decimalPlaces);
    return parseInt(priceString.slice(-1), 10);
  };

  const recentDigits = ticks.slice(-shortPeriod).map(t => getLastDigit(t.price));
  const historicDigits = ticks.slice(-longPeriod).map(t => getLastDigit(t.price));
  
  const smaRecent = recentDigits.reduce((a, b) => a + b, 0) / recentDigits.length;
  const smaHistoric = historicDigits.reduce((a, b) => a + b, 0) / historicDigits.length;

  const momentum = (smaRecent - smaHistoric) / (smaHistoric || 5);
  const digitMomentum = Math.max(-1, Math.min(1, momentum));

  let upMoves = 0;
  let downMoves = 0;
  for (let i = 1; i < recentDigits.length; i++) {
    if (recentDigits[i] > recentDigits[i - 1]) upMoves++;
    else if (recentDigits[i] < recentDigits[i - 1]) downMoves++;
  }
  const totalMoves = upMoves + downMoves;
  const trendStrength = totalMoves > 0 ? Math.max(upMoves, downMoves) / totalMoves : 0;

  const oldDigit = historicDigits[0];
  const newDigit = recentDigits[recentDigits.length - 1];
  const rateOfChange = oldDigit !== 0 ? (newDigit - oldDigit) / oldDigit : 0;

  return {
    digitMomentum,
    trendStrength,
    movingAverage: smaRecent,
    rateOfChange,
  };
}

// ============================================================================
// 2. VOLATILITY INDICATORS
// ============================================================================

export interface VolatilityIndicators {
  digitVolatility: number;
  volatilityRegime: 'LOW' | 'MEDIUM' | 'HIGH';
  atr: number;
  isExpanding: boolean;
}

export function calculateVolatility(
  ticks: TickData[],
  period: number = 20,
  decimalPlaces: number = 2
): VolatilityIndicators {
  if (ticks.length < period) {
    return { digitVolatility: 2.87, volatilityRegime: 'MEDIUM', atr: 0, isExpanding: false };
  }

  const getLastDigit = (price: number): number => {
    if (isNaN(price)) return 0;
    return parseInt(price.toFixed(decimalPlaces).slice(-1), 10);
  };

  const digits = ticks.slice(-period).map(t => getLastDigit(t.price));
  const mean = digits.reduce((a, b) => a + b, 0) / digits.length;
  
  const variance = digits.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / digits.length;
  const digitVolatility = Math.sqrt(variance);

  let atrSum = 0;
  for (let i = 1; i < digits.length; i++) {
    atrSum += Math.abs(digits[i] - digits[i - 1]);
  }
  const atr = atrSum / (digits.length - 1);

  let volatilityRegime: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
  if (digitVolatility < 2.5) volatilityRegime = 'LOW';
  else if (digitVolatility > 3.2) volatilityRegime = 'HIGH';

  const halfPeriod = Math.floor(period / 2);
  const recentDigits = digits.slice(-halfPeriod);
  const oldDigits = digits.slice(0, halfPeriod);
  
  const recentMean = recentDigits.length > 0 ? recentDigits.reduce((s, d) => s + d, 0) / recentDigits.length : 0;
  const oldMean = oldDigits.length > 0 ? oldDigits.reduce((s, d) => s + d, 0) / oldDigits.length : 0;

  const recentVol = Math.sqrt(
    recentDigits.reduce((sum, d) => sum + Math.pow(d - recentMean, 2), 0) / (recentDigits.length || 1)
  );
  const oldVol = Math.sqrt(
    oldDigits.reduce((sum, d) => sum + Math.pow(d - oldMean, 2), 0) / (oldDigits.length || 1)
  );
  const isExpanding = recentVol > oldVol * 1.1;

  return {
    digitVolatility,
    volatilityRegime,
    atr,
    isExpanding,
  };
}

// ============================================================================
// 3. REGIME DETECTION
// ============================================================================

export interface MarketRegime {
  type: 'TRENDING' | 'RANGING' | 'CHAOTIC';
  confidence: number;
  isTrendingUp: boolean;
  isTrendingDown: boolean;
}

export function detectRegime(
  momentum: MomentumIndicators,
  volatility: VolatilityIndicators
): MarketRegime {
  const { digitMomentum, trendStrength } = momentum;
  const { volatilityRegime } = volatility;

  const isTrending = Math.abs(digitMomentum) > 0.3 && trendStrength > 0.6;
  const isRanging = Math.abs(digitMomentum) < 0.2 && volatilityRegime === 'MEDIUM';
  const isChaotic = volatilityRegime === 'HIGH' && trendStrength < 0.5;

  let type: 'TRENDING' | 'RANGING' | 'CHAOTIC' = 'RANGING';
  let confidence = 0.5;

  if (isChaotic) {
    type = 'CHAOTIC';
    confidence = 0.3;
  } else if (isTrending) {
    type = 'TRENDING';
    confidence = trendStrength;
  } else if (isRanging) {
    type = 'RANGING';
    confidence = 0.7;
  }

  return {
    type,
    confidence,
    isTrendingUp: digitMomentum > 0.3 && trendStrength > 0.6,
    isTrendingDown: digitMomentum < -0.3 && trendStrength > 0.6,
  };
}

// ============================================================================
// 4. COMBINED INDICATOR (SCORE GERAL)
// ============================================================================

export interface AdvancedSignalScore {
  rawScore: number;
  adjustedScore: number;
  momentum: MomentumIndicators;
  volatility: VolatilityIndicators;
  regime: MarketRegime;
  recommendation: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'AVOID';
  analysisTime: number;
}

export function calculateAdvancedSignalScore(
  ticks: TickData[],
  baseConfidence: number,
  decimalPlaces: number = 2
): AdvancedSignalScore {
  const startTime = performance.now();
  const momentum = calculateMomentum(ticks, 10, 50, decimalPlaces);
  const volatility = calculateVolatility(ticks, 20, decimalPlaces);
  const regime = detectRegime(momentum, volatility);

  let rawScore = baseConfidence * 100;
  let adjustedScore = rawScore;
  
  if (regime.type === 'RANGING') {
    adjustedScore *= 1.15;
  } else if (regime.type === 'TRENDING') {
    adjustedScore *= 0.90;
  } else if (regime.type === 'CHAOTIC') {
    adjustedScore *= 0.70;
  }

  if (volatility.volatilityRegime === 'HIGH') {
    adjustedScore *= 0.85;
  }

  adjustedScore = Math.max(0, Math.min(100, adjustedScore));

  let recommendation: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'AVOID' = 'NEUTRAL';
  if (adjustedScore >= 75) recommendation = 'STRONG_BUY';
  else if (adjustedScore >= 60) recommendation = 'BUY';
  else if (adjustedScore < 45) recommendation = 'AVOID';

  const analysisTime = performance.now() - startTime;

  return {
    rawScore,
    adjustedScore,
    momentum,
    volatility,
    regime,
    recommendation,
    analysisTime,
  };
}
