// src/features/trading/hooks/use-vagalume-alternante.ts
'use client';

/**
 * @fileOverview Vagalume V3.0 - Híbrido: Repetition Trigger + Contextual Alternator
 *
 * Esta é uma implementação totalmente nova que abandona a lógica de W/L (Gambler's Fallacy)
 * e adota uma abordagem híbrida e matematicamente mais robusta.
 *
 * ESTRATÉGIA PRIMÁRIA: Repetition Trigger
 * - Detecta sequências de N dígitos idênticos.
 * - Dispara um trade 'DIGITDIFF' de alta confiança.
 *
 * ESTRATÉGIA SECUNDÁRIA: Contextual Alternator
 * - Opera apenas quando não há sequência de repetição.
 * - Analisa o regime de mercado usando 'digit-indicators'.
 * - Se o mercado for 'RANGING', procura oportunidades em 'DIGITEVEN'/'DIGITODD'.
 * - PAUSA em mercados 'CHAOTIC' ou 'TRENDING'.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Operation, TickData } from '@/lib/types';
import { calculateAdvancedSignalScore, type AdvancedSignalScore } from '../services/digit-indicators';
import { detectRepetitionSequence } from '../services/repetition-detector';
import { calculateDigitStatsForWindow } from '../services/digits-analysis';
import { timingMonitor } from '../utils/timing-monitor';

// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

export type VagalumeState = 'IDLE' | 'SEQUENCE_DETECTED' | 'CONTEXT_ANALYSIS' | 'PAUSED';
export type DigitContractType = 'DIGITMATCH' | 'DIGITDIFF' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER';

export interface VagalumeConfig {
  minSequenceLength: number; // Mínimo de repetições para ativar o Trigger
  usePredictiveAnalysis: boolean;
  // Configs legadas mantidas para evitar quebra de tipo, mas não usadas na lógica principal
  maxStreak: number;
  stateW1_matchThreshold: number;
  stateL1_differsThreshold: number;
  resetMultiplier: number;
  pauseAfterFailedResets: number;
  kellyFraction: number;
}

export interface VagalumeSignal {
  state: VagalumeState;
  activeStrategy: 'Repetition Trigger' | 'Contextual Alternator' | 'None';
  confidence: number;
  suggestedContract: DigitContractType;
  suggestedDigit?: number;
  suggestedStakeMultiplier: number;
  shouldTrade: boolean;
  reason: string;
  // Campos legados
  targetOutcome: 'WIN' | 'LOSS';
  sequenceStats: { currentStreak: number; alternanceRate: number; totalTrades: number };
  lastTickEpoch: number;
  analysisWindowEnd: number;
  advancedScore?: AdvancedSignalScore;
  adjustedConfidence: number;
}

// ============================================================================
// 2. HOOK PRINCIPAL
// ============================================================================

export const useVagalumeAlternante = (
  ticks: TickData[],
  tradeHistory: Operation[],
  config: VagalumeConfig,
  bankroll: number,
  decimalPlaces: number
): { signal: VagalumeSignal | null, onTradeCompleted: (tradeResult: Operation) => void } => {
  const [vagalumeState, setVagalumeState] = useState<VagalumeState>('IDLE');
  const [pauseReason, setPauseReason] = useState<string | null>(null);

  // O callback onTradeCompleted agora apenas loga, a lógica não depende mais dele.
  const onTradeCompleted = useCallback((lastTrade: Operation) => {
    console.log(`[Vagalume V3] Trade concluído: ${lastTrade.result > 0 ? 'WIN' : 'LOSS'}`);
  }, []);

  const signal = useMemo((): VagalumeSignal | null => {
    // --- 1. Cláusulas de Guarda ---
    const minTicksRequired = Math.max(config.minSequenceLength, 100);
    if (ticks.length < minTicksRequired) {
      return null;
    }

    // --- 2. Detecção de Sequência (Estratégia Primária) ---
    const sequence = detectRepetitionSequence(ticks, decimalPlaces, config.minSequenceLength, 6);
    
    if (sequence) {
      setVagalumeState('SEQUENCE_DETECTED');
      
      // A confiança aumenta com o comprimento da sequência
      const baseConfidence = 0.90 + (sequence.length - config.minSequenceLength) * 0.02;
      const confidence = Math.min(0.98, baseConfidence);
      
      return {
        state: 'SEQUENCE_DETECTED',
        activeStrategy: 'Repetition Trigger',
        confidence,
        suggestedContract: 'DIGITDIFF',
        suggestedDigit: sequence.digit,
        suggestedStakeMultiplier: 1.0, // Stake padrão para alta confiança
        shouldTrade: true,
        reason: `Sequência de ${sequence.length}x dígito ${sequence.digit} detectada.`,
        // Campos legados
        targetOutcome: 'WIN',
        sequenceStats: { currentStreak: 0, alternanceRate: 0, totalTrades: 0 },
        lastTickEpoch: ticks[ticks.length - 1]?.epoch || 0,
        analysisWindowEnd: ticks[ticks.length - 1]?.epoch || 0,
        adjustedConfidence: confidence,
      };
    }

    // --- 3. Análise de Contexto (Estratégia Secundária) ---
    setVagalumeState('CONTEXT_ANALYSIS');
    const analysisTicks = config.usePredictiveAnalysis ? ticks.slice(-101, -1) : ticks.slice(-100);
    const advancedScore = calculateAdvancedSignalScore(analysisTicks, 0.5, decimalPlaces);

    if (advancedScore.regime.type === 'CHAOTIC' || advancedScore.regime.type === 'TRENDING') {
      setPauseReason(`Pausado em regime ${advancedScore.regime.type}`);
      return null; // PAUSA em mercados não laterais
    }

    // Apenas opera em RANGING
    if (advancedScore.regime.type === 'RANGING') {
      const { probEven } = calculateDigitStatsForWindow(analysisTicks, 100, decimalPlaces);
      
      const threshold = 0.55; // Limiar de confiança para operar
      let confidence = 0.5;
      let contract: DigitContractType | null = null;

      if (probEven > threshold) {
        contract = 'DIGITEVEN';
        confidence = probEven;
      } else if ((1 - probEven) > threshold) {
        contract = 'DIGITODD';
        confidence = 1 - probEven;
      }

      if (contract) {
        return {
          state: 'CONTEXT_ANALYSIS',
          activeStrategy: 'Contextual Alternator',
          confidence,
          suggestedContract: contract,
          suggestedDigit: undefined,
          suggestedStakeMultiplier: 1.0,
          shouldTrade: true,
          reason: `Regime RANGING. Prob. ${contract.replace('DIGIT', '')} = ${(confidence * 100).toFixed(1)}%`,
          // Campos legados
          targetOutcome: 'WIN',
          sequenceStats: { currentStreak: 0, alternanceRate: 0, totalTrades: 0 },
          lastTickEpoch: ticks[ticks.length - 1]?.epoch || 0,
          analysisWindowEnd: analysisTicks[analysisTicks.length - 1]?.epoch || 0,
          advancedScore,
          adjustedConfidence: confidence,
        };
      }
    }

    // Se nenhuma condição for atendida, não faz nada
    setPauseReason('Aguardando oportunidade (Repetição ou Ranging).');
    return null;

  }, [ticks, config, decimalPlaces]);

  return { signal, onTradeCompleted };
};
