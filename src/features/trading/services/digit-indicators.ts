// src/features/trading/services/digit-indicators.ts
'use client';

import type { TickData } from '@/lib/types';
import type { Digit, DigitFrequency } from './digits-analysis';

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
 * 
 * Lógica:
 * - Se dígitos recentes > média histórica → momentum positivo
 * - Se dígitos recentes < média histórica → momentum negativo
 * - Trend strength mede consistência da direção
 * 
 * @param ticks - Array de ticks históricos
 * @param shortPeriod - Período curto (ex: 10 ticks)
 * @param longPeriod - Período longo (ex: 50 ticks)
 * @param decimalPlaces - Casas decimais do ativo
 * @returns Indicadores de momentum
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
    if (isNaN(price)) return 0;
    const priceString = price.toFixed(decimalPlaces);
    return parseInt(priceString.slice(-1), 10);
  };

  // 1. Média Móvel Simples (SMA)
  const recentDigits = ticks.slice(-shortPeriod).map(t => getLastDigit(t.price));
  const historicDigits = ticks.slice(-longPeriod).map(t => getLastDigit(t.price));
  
  const smaRecent = recentDigits.reduce((a, b) => a + b, 0) / recentDigits.length;
  const smaHistoric = historicDigits.reduce((a, b) => a + b, 0) / historicDigits.length;

  // 2. Momentum = (SMA curto - SMA longo) / SMA longo
  const momentum = (smaRecent - smaHistoric) / (smaHistoric || 5); // Normalizado
  const digitMomentum = Math.max(-1, Math.min(1, momentum)); // Clamp [-1, 1]

  // 3. Trend Strength (consistência da direção)
  let upMoves = 0;
  let downMoves = 0;
  for (let i = 1; i < recentDigits.length; i++) {
    if (recentDigits[i] > recentDigits[i - 1]) upMoves++;
    else if (recentDigits[i] < recentDigits[i - 1]) downMoves++;
  }
  const totalMoves = upMoves + downMoves;
  const trendStrength = totalMoves > 0 ? Math.max(upMoves, downMoves) / totalMoves : 0;

  // 4. Rate of Change (ROC)
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
  digitVolatility: number;     // Desvio padrão do último dígito
  volatilityRegime: 'LOW' | 'MEDIUM' | 'HIGH';
  atr: number;                 // Average True Range (adaptado para dígitos)
  isExpanding: boolean;        // Volatilidade está aumentando?
}

/**
 * Calcula volatilidade do último dígito
 * 
 * Insight:
 * - Alta volatilidade = dígitos variam muito (ex: 1, 9, 3, 7)
 * - Baixa volatilidade = dígitos estáveis (ex: 4, 5, 4, 5)
 * 
 * Uso estratégico:
 * - Em alta volatilidade: aumentar threshold de confiança
 * - Em baixa volatilidade: diminuir stake (sinais fracos)
 */
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
  
  // Desvio padrão
  const variance = digits.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / digits.length;
  const digitVolatility = Math.sqrt(variance);

  // ATR (Average True Range) para dígitos
  let atrSum = 0;
  for (let i = 1; i < digits.length; i++) {
    atrSum += Math.abs(digits[i] - digits[i - 1]);
  }
  const atr = atrSum / (digits.length - 1);

  // Regime de volatilidade (baseado no desvio padrão teórico = 2.87 para uniforme)
  let volatilityRegime: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
  if (digitVolatility < 2.5) volatilityRegime = 'LOW';
  else if (digitVolatility > 3.2) volatilityRegime = 'HIGH';

  // Está expandindo? (compara metade recente vs metade antiga)
  const halfPeriod = Math.floor(period / 2);
  const recentDigits = digits.slice(-halfPeriod);
  const oldDigits = digits.slice(0, halfPeriod);
  
  const recentVol = Math.sqrt(
    recentDigits.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / recentDigits.length
  );
  const oldVol = Math.sqrt(
    oldDigits.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / oldDigits.length
  );
  const isExpanding = recentVol > oldVol * 1.1; // 10% de aumento

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
  confidence: number; // 0 a 1
  isTrendingUp: boolean;
  isTrendingDown: boolean;
}

/**
 * Detecta o regime do mercado (trending vs ranging)
 * 
 * Lógica:
 * - TRENDING: Dígitos seguem padrão direcional (crescente ou decrescente)
 * - RANGING: Dígitos oscilam em torno de média (ex: 4-5-4-6-5)
 * - CHAOTIC: Volatilidade muito alta sem padrão claro
 * 
 * Aplicação:
 * - TRENDING → Usar estratégias de momentum
 * - RANGING → Usar estratégias mean-reversion (Vagalume atual)
 * - CHAOTIC → Aumentar thresholds ou pausar
 */
export function detectRegime(
  momentum: MomentumIndicators,
  volatility: VolatilityIndicators
): MarketRegime {
  const { digitMomentum, trendStrength } = momentum;
  const { volatilityRegime } = volatility;

  // Trending: momentum forte + baixa volatilidade
  const isTrending = Math.abs(digitMomentum) > 0.3 && trendStrength > 0.6;
  
  // Ranging: momentum fraco + volatilidade média
  const isRanging = Math.abs(digitMomentum) < 0.2 && volatilityRegime === 'MEDIUM';
  
  // Chaotic: volatilidade alta
  const isChaotic = volatilityRegime === 'HIGH' && trendStrength < 0.5;

  let type: 'TRENDING' | 'RANGING' | 'CHAOTIC' = 'RANGING';
  let confidence = 0.5;

  if (isChaotic) {
    type = 'CHAOTIC';
    confidence = 0.3; // Baixa confiança
  } else if (isTrending) {
    type = 'TRENDING';
    confidence = trendStrength; // Confiança = força da tendência
  } else if (isRanging) {
    type = 'RANGING';
    confidence = 0.7; // Boa confiança (Vagalume funciona bem aqui)
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
  rawScore: number;           // 0 a 100
  adjustedScore: number;      // Score ajustado por regime
  momentum: MomentumIndicators;
  volatility: VolatilityIndicators;
  regime: MarketRegime;
  recommendation: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'AVOID';
  analysisTime: number;
}

/**
 * Combina todos os indicadores em um score unificado
 */
export function calculateAdvancedSignalScore(
  ticks: TickData[],
  baseConfidence: number, // Do Vagalume (0.5 - 0.95)
  decimalPlaces: number = 2
): AdvancedSignalScore {
  const startTime = performance.now();
  const momentum = calculateMomentum(ticks, 10, 50, decimalPlaces);
  const volatility = calculateVolatility(ticks, 20, decimalPlaces);
  const regime = detectRegime(momentum, volatility);

  // Score base (do Vagalume)
  let rawScore = baseConfidence * 100; // 50 - 95

  // Ajustes por regime
  let adjustedScore = rawScore;
  if (regime.type === 'RANGING') {
    adjustedScore *= 1.15; // +15% em ranging (Vagalume performa melhor)
  } else if (regime.type === 'TRENDING') {
    adjustedScore *= 0.90; // -10% em trending (mean-reversion funciona mal)
  } else if (regime.type === 'CHAOTIC') {
    adjustedScore *= 0.70; // -30% em caos (muito arriscado)
  }

  // Ajuste por volatilidade
  if (volatility.volatilityRegime === 'HIGH') {
    adjustedScore *= 0.85; // -15% em alta volatilidade
  }

  // Clamp score
  adjustedScore = Math.max(0, Math.min(100, adjustedScore));

  // Recomendação
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
