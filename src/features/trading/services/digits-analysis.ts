// src/features/trading/services/digits-analysis.ts
'use client';

import type { TickData } from '@/lib/types';

// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

export type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface DigitFrequency {
  digit: Digit;
  count: number;
  probability: number; // 0–1
  zScore: number;
}

export interface ChiSquareResult {
  chiSquare: number;
  pValue: number;
  isSignificant: boolean; // pValue < 0.05
}

export interface WindowDigitStats {
  windowSize: number;
  frequencies: DigitFrequency[];
  hottestDigit: Digit;
  coldestDigit: Digit;
  chiSquare: ChiSquareResult;
  probOver4: number;
  probUnder5: number;
  probEven: number;
}

export type ConfidenceLevel = 'MUITO_ALTA' | 'ALTA' | 'MEDIA' | 'BAIXA' | 'NULA';

export interface MultiWindowAnalysis {
  windows: WindowDigitStats[];
  hottestConsensusDigit?: Digit;
  coldestConsensusDigit?: Digit;
  consensusStrength: ConfidenceLevel;
}

export interface SignalQuality {
  targetDigit: Digit;
  contractType: 'DIGITDIFF' | 'DIGITMATCH';
  mainWindow: WindowDigitStats;
  multiWindowAnalysis: MultiWindowAnalysis;
  recentWinrate?: number;
  confidenceLevel: ConfidenceLevel;
}

// ============================================================================
// 2. CONSTANTES E FUNÇÕES DE UTILIDADE ESTATÍSTICA
// ============================================================================

// Valores críticos para 9 graus de liberdade (10 categorias - 1)
const chiSquareCriticalValues: { [key: number]: number } = {
  0.995: 1.73, 0.99: 2.09, 0.975: 2.7, 0.95: 3.33, 0.90: 4.17,
  0.10: 14.68, 0.05: 16.92, 0.025: 19.02, 0.01: 21.67, 0.005: 23.59,
};

/**
 * Estima o p-value a partir do valor do Qui-Quadrado.
 * @param chiSquareValue - O valor calculado do Qui-Quadrado.
 * @returns O p-value estimado.
 */
function getPValueFromChiSquare(chiSquareValue: number): number {
  if (chiSquareValue < 3.33) return 0.95;
  if (chiSquareValue < 4.17) return 0.90;
  if (chiSquareValue < 14.68) return 0.10;
  if (chiSquareValue < 16.92) return 0.05;
  if (chiSquareValue < 19.02) return 0.025;
  if (chiSquareValue < 21.67) return 0.01;
  if (chiSquareValue < 23.59) return 0.005;
  return 0.001; // Para valores muito extremos
}

/**
 * Helper para obter o último dígito de um preço, considerando casas decimais.
 */
const getLastDigit = (price: number, decimalPlaces: number): Digit => {
    if (isNaN(price) || !Number.isFinite(price)) {
        return 0 as Digit;
    }
    const priceString = price.toFixed(decimalPlaces);
    return parseInt(priceString.slice(-1), 10) as Digit;
};

// ============================================================================
// 3. FUNÇÕES DE ANÁLISE PRINCIPAIS
// ============================================================================

/**
 * Calcula as estatísticas de frequência para uma janela de ticks.
 */
export function calculateDigitStatsForWindow(ticks: TickData[], windowSize: number, decimalPlaces: number): WindowDigitStats {
  const recentTicks = ticks.slice(-windowSize);
  const totalTicks = recentTicks.length;
  const expectedFrequency = totalTicks / 10;

  const counts = Array(10).fill(0);
  recentTicks.forEach(tick => {
    const digit = getLastDigit(tick.price, decimalPlaces);
    if (!isNaN(digit)) {
      counts[digit]++;
    }
  });

  const frequencies: DigitFrequency[] = counts.map((count, digit) => {
    const probability = totalTicks > 0 ? count / totalTicks : 0;
    const zScore = totalTicks > 0
      ? (count - expectedFrequency) / Math.sqrt(expectedFrequency * (1 - 0.1))
      : 0;
    return { digit: digit as Digit, count, probability, zScore };
  });

  const sortedByFreq = [...frequencies].sort((a, b) => b.count - a.count);

  const chiSquare = frequencies.reduce((sum, freq) => {
    if (expectedFrequency === 0) return sum; // Evitar divisão por zero
    return sum + Math.pow(freq.count - expectedFrequency, 2) / expectedFrequency;
  }, 0);
  
  const pValue = getPValueFromChiSquare(chiSquare);

  const probOver4 = frequencies.filter(f => f.digit > 4).reduce((sum, f) => sum + f.probability, 0);
  const probUnder5 = frequencies.filter(f => f.digit < 5).reduce((sum, f) => sum + f.probability, 0);
  const probEven = frequencies.filter(f => f.digit % 2 === 0).reduce((sum, f) => sum + f.probability, 0);

  return {
    windowSize,
    frequencies,
    hottestDigit: sortedByFreq[0]?.digit ?? 0,
    coldestDigit: sortedByFreq[9]?.digit ?? 9,
    chiSquare: { chiSquare, pValue, isSignificant: pValue < 0.05 },
    probOver4,
    probUnder5,
    probEven,
  };
}

/**
 * Analisa o consenso entre diferentes janelas de tempo.
 */
export function getMultiWindowAnalysis(windowsStats: WindowDigitStats[]): MultiWindowAnalysis {
  const hottestCounts: Record<number, number> = {};
  const coldestCounts: Record<number, number> = {};

  windowsStats.forEach(stat => {
    hottestCounts[stat.hottestDigit] = (hottestCounts[stat.hottestDigit] || 0) + 1;
    coldestCounts[stat.coldestDigit] = (coldestCounts[stat.coldestDigit] || 0) + 1;
  });

  const getConsensusDigit = (counts: Record<number, number>): Digit | undefined => {
    const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
    return sorted.length > 0 ? parseInt(sorted[0][0], 10) as Digit : undefined;
  };

  const hottestConsensusDigit = getConsensusDigit(hottestCounts);
  const coldestConsensusDigit = getConsensusDigit(coldestCounts);
  
  const hottestStrength = hottestConsensusDigit !== undefined ? hottestCounts[hottestConsensusDigit] : 0;
  const coldestStrength = coldestConsensusDigit !== undefined ? coldestCounts[coldestConsensusDigit] : 0;

  const strength = Math.max(hottestStrength, coldestStrength);

  let consensusStrength: ConfidenceLevel = 'NULA';
  if (strength >= 3) consensusStrength = 'MUITO_ALTA';
  else if (strength === 2) consensusStrength = 'ALTA';
  else if (strength === 1) consensusStrength = 'MEDIA';

  return {
    windows: windowsStats,
    hottestConsensusDigit,
    coldestConsensusDigit,
    consensusStrength,
  };
}

/**
 * Determina a qualidade geral do sinal com base em todas as análises.
 */
export function determineSignalQuality(
  multiWindowAnalysis: MultiWindowAnalysis,
  mainWindow: WindowDigitStats
): SignalQuality | null {
  const { consensusStrength, hottestConsensusDigit, coldestConsensusDigit } = multiWindowAnalysis;
  const { isSignificant } = mainWindow.chiSquare;

  let targetDigit: Digit | null = null;
  let contractType: 'DIGITDIFF' | 'DIGITMATCH' | null = null;
  let baseConfidence: ConfidenceLevel = 'NULA';

  if (hottestConsensusDigit !== undefined && (consensusStrength === 'ALTA' || consensusStrength === 'MUITO_ALTA')) {
    targetDigit = hottestConsensusDigit;
    contractType = 'DIGITDIFF';
    baseConfidence = consensusStrength;
  } else if (coldestConsensusDigit !== undefined && consensusStrength === 'MUITO_ALTA') { // Mais rigoroso para 'MATCH'
    targetDigit = coldestConsensusDigit;
    contractType = 'DIGITMATCH';
    baseConfidence = 'ALTA'; // 'MATCH' é inerentemente mais arriscado
  }

  if (targetDigit === null || contractType === null) return null;

  // Ajuste final da confiança com base na significância estatística
  let finalConfidence = baseConfidence;
  if (!isSignificant) {
    if (baseConfidence === 'MUITO_ALTA') finalConfidence = 'MEDIA';
    else if (baseConfidence === 'ALTA') finalConfidence = 'BAIXA';
    else finalConfidence = 'NULA';
  }

  return {
    targetDigit,
    contractType,
    mainWindow,
    multiWindowAnalysis,
    confidenceLevel: finalConfidence,
  };
}
