// src/features/trading/hooks/use-repetition-trigger.ts
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { TickData, Operation } from '@/lib/types';
import type { 
  RepetitionSignal, 
  RepetitionTriggerConfig,
  RepetitionSequence,
  RepetitionStats,
} from '../types/repetition-trigger';
import { DEFAULT_REPETITION_CONFIG } from '../types/repetition-trigger';
import { detectRepetitionSequence, analyzeSequencePatterns } from '../services/repetition-detector';
import { analyzeRepetitionSignal, checkSafetyCircuitBreakers } from '../services/repetition-analyzer';

export function useRepetitionTrigger(
  priceTicks: TickData[],
  tradeHistory: Operation[],
  decimalPlaces: number = 2,
  config: Partial<RepetitionTriggerConfig> = {}
) {
  
  const fullConfig: RepetitionTriggerConfig = useMemo(() => ({
    ...DEFAULT_REPETITION_CONFIG,
    ...config,
  }), [config]);
  
  const [currentSequence, setCurrentSequence] = useState<RepetitionSequence | null>(null);
  const [signal, setSignal] = useState<RepetitionSignal | null>(null);
  const [lastTradeEpoch, setLastTradeEpoch] = useState<number | undefined>();
  const [isPaused, setIsPaused] = useState(false);
  const [pauseReason, setPauseReason] = useState<string>('');
  
  // ========================================
  // DETECÇÃO DE SEQUÊNCIA
  // ========================================
  
  useEffect(() => {
    if (!fullConfig.enabled || priceTicks.length < fullConfig.minSequenceLength) {
      setCurrentSequence(null);
      setSignal(null);
      return;
    }
    
    // Detecta sequência
    const sequence = detectRepetitionSequence(
      priceTicks,
      decimalPlaces,
      fullConfig.minSequenceLength,
      fullConfig.maxSequenceLength
    );
    
    setCurrentSequence(sequence);
    
    // Se não há sequência, limpa sinal
    if (!sequence) {
      setSignal(null);
      return;
    }
    
    // Verifica circuit breakers
    const safety = checkSafetyCircuitBreakers(tradeHistory, fullConfig, lastTradeEpoch);
    
    if (!safety.canTrade) {
      setIsPaused(true);
      setPauseReason(safety.reason || 'Safety check failed');
      setSignal(null);
      return;
    }
    
    setIsPaused(false);
    setPauseReason('');
    
    // Analisa e gera sinal
    const newSignal = analyzeRepetitionSignal(sequence, priceTicks, fullConfig, decimalPlaces);
    
    setSignal(newSignal);
    
  }, [priceTicks, fullConfig, decimalPlaces, tradeHistory, lastTradeEpoch]);
  
  // ========================================
  // ESTATÍSTICAS
  // ========================================
  
  const stats: RepetitionStats = useMemo(() => {
    const repetitionTrades = tradeHistory.filter(t => 
      t.initiator === 'Repetition Trigger'
    );
    
    if (repetitionTrades.length === 0) {
      return {
        totalSequences: 0,
        sequencesByLength: {},
        winsByLength: {},
        avgWinRateByLength: {},
        totalTrades: 0,
        wins: 0,
        losses: 0,
        overallWinRate: 0,
        avgConfidence: 0,
        profitLoss: 0,
      };
    }
    
    const wins = repetitionTrades.filter(t => (t.result ?? 0) > 0);
    const losses = repetitionTrades.filter(t => (t.result ?? 0) < 0);
    
    const profitLoss = repetitionTrades.reduce((sum, t) => sum + (t.result ?? 0), 0);
    
    // Análise de padrões
    const patterns = analyzeSequencePatterns(priceTicks, decimalPlaces, 200);
    
    return {
      totalSequences: patterns.totalSequences,
      sequencesByLength: patterns.sequencesByLength,
      winsByLength: {}, // TODO: Implementar tracking por comprimento
      avgWinRateByLength: {},
      totalTrades: repetitionTrades.length,
      wins: wins.length,
      losses: losses.length,
      overallWinRate: wins.length / repetitionTrades.length,
      avgConfidence: 0, // TODO: Calcular média
      profitLoss,
    };
  }, [tradeHistory, priceTicks, decimalPlaces]);
  
  // ========================================
  // CALLBACKS
  // ========================================
  
  const onTradeExecuted = useCallback((epoch: number) => {
    setLastTradeEpoch(epoch);
  }, []);
  
  const resetPause = useCallback(() => {
    setIsPaused(false);
    setPauseReason('');
  }, []);
  
  return {
    // Estado
    currentSequence,
    signal,
    isPaused,
    pauseReason,
    
    // Estatísticas
    stats,
    
    // Callbacks
    onTradeExecuted,
    resetPause,
  };
}
