// src/features/trading/hooks/use-vagalume-alternante.ts
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Operation, TickData } from '@/lib/types';
import type { DigitFrequency } from '@/features/trading/services/digits-analysis';

// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

export type VagalumeState = 'W1' | 'L1' | 'W2' | 'L2' | 'PAUSED';
export type DigitContractType = 'DIGITMATCH' | 'DIGITDIFF' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER';

export interface VagalumeConfig {
  maxStreak: number;
  stateW1_matchThreshold: number;
  stateL1_differsThreshold: number;
  resetMultiplier: number;
  pauseAfterFailedResets: number;
  kellyFraction: number;
}

export interface VagalumeSignal {
  state: VagalumeState;
  targetOutcome: 'WIN' | 'LOSS';
  confidence: number;          // 0-1
  suggestedContract: DigitContractType;
  suggestedDigit?: number;
  suggestedStakeMultiplier: number;
  sequenceStats: {
    currentStreak: number;
    alternanceRate: number;    // últimos 50 trades
    totalTrades: number;
  };
  shouldTrade: boolean;
}

// ============================================================================
// 2. FUNÇÕES AUXILIARES
// ============================================================================

const getLastDigit = (price: number, decimalPlaces: number): number => {
    if (isNaN(price) || !Number.isFinite(price)) return 0;
    const priceString = price.toFixed(decimalPlaces);
    return parseInt(priceString.slice(-1), 10);
};

const calculateAdaptiveAnalysis = (
  ticks: TickData[],
  state: VagalumeState,
  decimalPlaces: number
): { frequencies: DigitFrequency[]; hottestDigit: number; coldestDigit: number; probEven: number } => {
  const windowSize = state === 'W1' || state === 'L1' ? 50 : 200;

  const emptyResult = {
    frequencies: Array.from({ length: 10 }, (_, i) => ({ digit: i, count: 0, probability: 0, zScore: 0 })),
    hottestDigit: 0,
    coldestDigit: 0,
    probEven: 0.5,
  };

  if (ticks.length < windowSize) return emptyResult;
  
  const recentTicks = ticks.slice(-windowSize);
  const digitCounts = new Array(10).fill(0);
  recentTicks.forEach(tick => {
    const lastDigit = getLastDigit(tick.price, decimalPlaces);
    if (!isNaN(lastDigit)) digitCounts[lastDigit]++;
  });

  let hottestDigit = 0, coldestDigit = 0;
  let maxFreq = -1, minFreq = Infinity;

  const frequencies: DigitFrequency[] = digitCounts.map((count, digit) => {
    if (count > maxFreq) { maxFreq = count; hottestDigit = digit; }
    if (count < minFreq) { minFreq = count; coldestDigit = digit; }
    const probability = count / windowSize;
    const zScore = (probability - 0.1) / Math.sqrt(0.1 * 0.9 / windowSize);
    return { digit: digit, count, probability, zScore };
  });
  
  const probEven = frequencies.filter(f => f.digit % 2 === 0).reduce((sum, f) => sum + f.probability, 0);

  return { frequencies, hottestDigit, coldestDigit, probEven };
};


// ============================================================================
// 3. HOOK PRINCIPAL
// ============================================================================

export const useVagalumeAlternante = (
  ticks: TickData[],
  tradeHistory: Operation[],
  config: VagalumeConfig,
  bankroll: number,
  decimalPlaces: number
): { signal: VagalumeSignal | null, onTradeCompleted: (tradeResult: Operation) => void } => {
  const [vagalumeState, setVagalumeState] = useState<VagalumeState>('W1');
  const [failedResets, setFailedResets] = useState(0);

  const sequenceStats = useMemo(() => {
    const relevantTrades = tradeHistory.slice(-50);
    if (relevantTrades.length < 2) {
      return { currentStreak: relevantTrades.length, alternanceRate: 0, totalTrades: relevantTrades.length };
    }

    const alternances = relevantTrades.slice(1).filter((t, i) =>
      (relevantTrades[i].result! > 0) !== (t.result! > 0)
    ).length;
    
    let streak = 0;
    if (relevantTrades.length > 0) {
      streak = 1;
      const lastOutcomeIsWin = relevantTrades[relevantTrades.length - 1].result! > 0;
      for (let i = relevantTrades.length - 2; i >= 0; i--) {
        if ((relevantTrades[i].result! > 0) === lastOutcomeIsWin) streak++;
        else break;
        lastOutcomeIsWin;
      }
    }

    return {
      currentStreak: streak,
      alternanceRate: (alternances / (relevantTrades.length - 1)) * 100,
      totalTrades: relevantTrades.length
    };
  }, [tradeHistory]);

  const onTradeCompleted = useCallback((lastTrade: Operation) => {
    const isWin = lastTrade.result! > 0;
    
    setVagalumeState(prevState => {
      switch (prevState) {
        case 'W1': return isWin ? 'L1' : 'W1';
        case 'L1': return isWin ? 'W1' : 'W2';
        case 'W2':
          if (isWin) { setFailedResets(prev => prev + 1); return 'L1'; }
          setFailedResets(0); return 'W1';
        case 'L2':
          if (!isWin) { setFailedResets(prev => prev + 1); return 'W1'; }
          setFailedResets(0); return 'L1';
        case 'PAUSED':
          if (sequenceStats.alternanceRate > 70) { setFailedResets(0); return 'W1'; }
          return 'PAUSED';
        default: return prevState;
      }
    });
  }, [sequenceStats.alternanceRate]);

  useEffect(() => {
    if (failedResets >= config.pauseAfterFailedResets && sequenceStats.alternanceRate < 60) {
      setVagalumeState('PAUSED');
    }
  }, [failedResets, sequenceStats.alternanceRate, config.pauseAfterFailedResets]);

  const getAdaptiveAnalysis = useCallback((state: VagalumeState) => {
    return calculateAdaptiveAnalysis(ticks, state, decimalPlaces);
  }, [ticks, decimalPlaces]);

  const signal = useMemo((): VagalumeSignal | null => {
    if (vagalumeState === 'PAUSED' || ticks.length < 200) return null;

    const analysis = getAdaptiveAnalysis(vagalumeState);
    const targetOutcome = vagalumeState.startsWith('W') ? 'WIN' : 'LOSS';
    
    let suggestedContract: DigitContractType = 'DIGITDIFF';
    let suggestedDigit: number | undefined;
    let confidence = 0.5; // baseline 50%
    let shouldTrade = false;

    // Lógica adaptativa por estado
    switch (vagalumeState) {
      case 'W1':
        if (analysis.coldestDigit !== undefined && analysis.frequencies[analysis.coldestDigit].probability <= config.stateW1_matchThreshold / 100) {
          suggestedContract = 'DIGITMATCH';
          suggestedDigit = analysis.coldestDigit;
          confidence = Math.min(0.95, 0.5 + Math.abs(analysis.frequencies[analysis.coldestDigit].zScore) * 0.15);
          shouldTrade = true;
        }
        break;

      case 'L1':
        if (analysis.hottestDigit !== undefined && analysis.frequencies[analysis.hottestDigit].probability >= config.stateL1_differsThreshold / 100) {
          suggestedContract = 'DIGITDIFF';
          suggestedDigit = analysis.hottestDigit;
          confidence = Math.min(0.95, 0.5 + Math.abs(analysis.frequencies[analysis.hottestDigit].zScore) * 0.20);
          shouldTrade = true;
        }
        break;

      case 'W2':
      case 'L2':
        // **LÓGICA APRIMORADA**
        if (analysis.probEven > 0.51) { // Pares estão "quentes"
          suggestedContract = 'DIGITODD'; // Aposta em "frio" (Ímpar)
          confidence = 0.5 + (analysis.probEven - 0.5); // Confiança é proporcional ao desequilíbrio
        } else { // Ímpares estão "quentes" ou está equilibrado
          suggestedContract = 'DIGITEVEN'; // Aposta em "frio" (Par)
          confidence = 0.5 + (0.5 - analysis.probEven);
        }
        shouldTrade = true;
        break;
    }
    
    if (confidence < 0.51) shouldTrade = false;

    const stakeMultiplier = (vagalumeState === 'W2' || vagalumeState === 'L2') && sequenceStats.alternanceRate > 80 ? config.resetMultiplier : 1.0;

    return {
      state: vagalumeState,
      targetOutcome,
      confidence,
      suggestedContract,
      suggestedDigit,
      suggestedStakeMultiplier: stakeMultiplier,
      sequenceStats,
      shouldTrade,
    };
  }, [vagalumeState, getAdaptiveAnalysis, config, sequenceStats]);

  return { signal, onTradeCompleted };
};
