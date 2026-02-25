// src/features/trading/hooks/use-vagalume-alternante.ts
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Operation, TickData } from '@/lib/types';
import type { DigitFrequency, WindowDigitStats } from '@/features/trading/services/digits-analysis';
import { calculateDigitStatsForWindow } from '@/features/trading/services/digits-analysis';
import { timingMonitor } from '@/features/trading/utils/timing-monitor';

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
  usePredictiveAnalysis: boolean;
}

export interface VagalumeSignal {
  state: VagalumeState;
  targetOutcome: 'WIN' | 'LOSS';
  confidence: number;
  suggestedContract: DigitContractType;
  suggestedDigit?: number;
  suggestedStakeMultiplier: number;
  sequenceStats: {
    currentStreak: number;
    alternanceRate: number;
    totalTrades: number;
  };
  shouldTrade: boolean;
  lastTickEpoch: number;
  analysisWindowEnd: number;
}

// ============================================================================
// 2. FUNÇÕES AUXILIARES
// ============================================================================

const calculateAdaptiveAnalysis = (
  ticks: TickData[],
  state: VagalumeState,
  decimalPlaces: number,
  usePredictiveAnalysis: boolean = true
): WindowDigitStats & { analyzedEpoch: number } => {
  const windowSize = (state === 'W1' || state === 'L1') ? 50 : 200;
  
  const emptyResult: WindowDigitStats & { analyzedEpoch: number } = {
    windowSize,
    frequencies: Array.from({ length: 10 }, (_, i) => ({ 
      digit: i as any, count: 0, probability: 0, zScore: 0 
    })),
    hottestDigit: 0,
    coldestDigit: 0,
    chiSquare: { chiSquare: 0, pValue: 1, isSignificant: false },
    probOver4: 0.5,
    probUnder5: 0.5,
    probEven: 0.5,
    analyzedEpoch: 0,
  };

  const minTicks = usePredictiveAnalysis ? windowSize + 1 : windowSize;
  if (ticks.length < minTicks) return emptyResult;
  
  const ticksToAnalyze = usePredictiveAnalysis 
    ? ticks.slice(-(windowSize + 1), -1)
    : ticks.slice(-windowSize);
  
  const stats = calculateDigitStatsForWindow(ticksToAnalyze, windowSize, decimalPlaces);
  const analyzedEpoch = ticksToAnalyze[ticksToAnalyze.length - 1]?.epoch || 0;
  
  return { ...stats, analyzedEpoch };
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
    if (tradeHistory.length < 2) {
      return { currentStreak: tradeHistory.length, alternanceRate: 0, totalTrades: tradeHistory.length };
    }
    const relevantTrades = tradeHistory.slice(-50);
    const alternances = relevantTrades.slice(1).filter((t, i) => 
      (relevantTrades[i].result! > 0) !== (t.result! > 0)
    ).length;
    
    let streak = 0;
    if (relevantTrades.length > 0) {
      streak = 1;
      const lastOutcomeIsWin = relevantTrades[relevantTrades.length - 1].result! > 0;
      for (let i = relevantTrades.length - 2; i >= 0; i--) {
        if ((relevantTrades[i].result! > 0) === lastOutcomeIsWin) {
          streak++;
        } else {
          break;
        }
      }
    }

    return {
      currentStreak: streak,
      alternanceRate: (alternances / (relevantTrades.length - 1)) * 100,
      totalTrades: relevantTrades.length
    };
  }, [tradeHistory]);

  const onTradeCompleted = useCallback((lastTrade: Operation) => {
    const isWin = (lastTrade.result || 0) > 0;
    
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
    return calculateAdaptiveAnalysis(ticks, state, decimalPlaces, config.usePredictiveAnalysis);
  }, [ticks, decimalPlaces, config.usePredictiveAnalysis]);

  const signal = useMemo((): VagalumeSignal | null => {
    const measure = timingMonitor.startMeasurement();
    
    if (vagalumeState === 'PAUSED') return null;
    
    const minTicks = (vagalumeState === 'W1' || vagalumeState === 'L1') ? 50 : 200;
    const requiredTicks = config.usePredictiveAnalysis ? minTicks + 1 : minTicks;
    if (ticks.length < requiredTicks) return null;

    const analysis = getAdaptiveAnalysis(vagalumeState);
    const targetOutcome = vagalumeState.startsWith('W') ? 'WIN' : 'LOSS';
    
    let suggestedContract: DigitContractType = 'DIGITEVEN';
    let suggestedDigit: number | undefined;
    let confidence = 0.5;
    let shouldTrade = false;
    
    const windowSize = (vagalumeState === 'W1' || vagalumeState === 'L1') ? 50 : 200;
    const lastTickEpoch = ticks[ticks.length - 1]?.epoch || 0;

    switch (vagalumeState) {
      case 'W1':
        if (analysis.probEven < 0.49) { // Ímpar favorecido
          const zScore = Math.abs((analysis.probEven - 0.5) / Math.sqrt(0.25 / windowSize));
          suggestedContract = 'DIGITODD';
          confidence = Math.min(0.95, 0.5 + (0.5 - analysis.probEven) + (zScore * 0.05));
          shouldTrade = confidence > 0.51;
        } else if (analysis.probEven > 0.51) { // Par favorecido
          const zScore = Math.abs((analysis.probEven - 0.5) / Math.sqrt(0.25 / windowSize));
          suggestedContract = 'DIGITEVEN';
          confidence = Math.min(0.95, 0.5 + (analysis.probEven - 0.5) + (zScore * 0.05));
          shouldTrade = confidence > 0.51;
        }
        break;

      case 'L1':
        const probOver = analysis.frequencies.slice(5).reduce((sum, f) => sum + f.probability, 0);
        if (probOver > 0.51) {
          suggestedContract = 'DIGITOVER';
          suggestedDigit = 4;
          confidence = 0.5 + (probOver - 0.5);
          shouldTrade = confidence > 0.51;
        } else if (probOver < 0.49) {
          suggestedContract = 'DIGITUNDER';
          suggestedDigit = 5;
          confidence = 0.5 + (0.5 - probOver);
          shouldTrade = confidence > 0.51;
        }
        break;

      case 'W2':
      case 'L2':
        if (analysis.probEven > 0.55) {
          suggestedContract = 'DIGITEVEN';
          confidence = 0.5 + (analysis.probEven - 0.5);
          shouldTrade = true;
        } else if (analysis.probEven < 0.45) {
          suggestedContract = 'DIGITODD';
          confidence = 0.5 + (0.5 - analysis.probEven);
          shouldTrade = true;
        } else {
          const probOver = analysis.frequencies.slice(5).reduce((sum, f) => sum + f.probability, 0);
          if (probOver > 0.52) {
            suggestedContract = 'DIGITOVER';
            suggestedDigit = 4;
            confidence = 0.52;
          } else {
            suggestedContract = 'DIGITUNDER';
            suggestedDigit = 5;
            confidence = 0.52;
          }
          shouldTrade = true;
        }
        break;
    }

    const stakeMultiplier = (vagalumeState === 'W2' || vagalumeState === 'L2') && sequenceStats.alternanceRate > 80 
      ? config.resetMultiplier 
      : 1.0;

    const analysisTime = measure.end();
    const tickAge = Date.now() - (lastTickEpoch * 1000);
    
    timingMonitor.recordTiming('vagalume', {
      analysisTime,
      executionTime: 0,
      totalLatency: analysisTime,
      tickAge,
    });

    return {
      state: vagalumeState,
      targetOutcome,
      confidence,
      suggestedContract,
      suggestedDigit,
      suggestedStakeMultiplier: stakeMultiplier,
      sequenceStats,
      shouldTrade,
      lastTickEpoch,
      analysisWindowEnd: analysis.analyzedEpoch,
    };
  }, [vagalumeState, getAdaptiveAnalysis, config, sequenceStats, ticks]);

  return { signal, onTradeCompleted };
};
