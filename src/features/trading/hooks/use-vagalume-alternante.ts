// src/features/trading/hooks/use-vagalume-alternante.ts
'use client';

/**
 * @fileOverview Vagalume V3.1 - Híbrido: Repetition Trigger + Contextual Alternator
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
 * - Se o mercado for 'RANGING', procura oportunidades em 'DIGITEVEN'/'DIGITODD' ou 'OVER/UNDER'.
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
  minSequenceLength: number;
  usePredictiveAnalysis: boolean;
  allowedContracts: {
    MATCHDIFFERS: boolean;
    EVENODD: boolean;
    OVERUNDER: boolean;
  };
  // Campos legados para compatibilidade
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
  const [pauseReason, setPauseReason] = useState<string | null>(null);

  const onTradeCompleted = useCallback((lastTrade: Operation) => {
    // A lógica de estado W/L foi removida, então este callback é apenas para log.
    console.log(`[Vagalume V3] Trade concluído: ${lastTrade.result! > 0 ? 'WIN' : 'LOSS'}`);
  }, []);

  const signal = useMemo((): VagalumeSignal | null => {
    const minTicksRequired = Math.max(config.minSequenceLength, 100);
    if (ticks.length < minTicksRequired) return null;

    if (config.allowedContracts.MATCHDIFFERS) {
      const sequence = detectRepetitionSequence(ticks, decimalPlaces, config.minSequenceLength, 6);
      if (sequence) {
        const baseConfidence = 0.90 + (sequence.length - config.minSequenceLength) * 0.02;
        const confidence = Math.min(0.98, baseConfidence);
        
        return {
          state: 'SEQUENCE_DETECTED',
          activeStrategy: 'Repetition Trigger',
          confidence: confidence,
          suggestedContract: 'DIGITDIFF',
          suggestedDigit: sequence.digit,
          suggestedStakeMultiplier: 1.0,
          shouldTrade: true,
          reason: `Sequência de ${sequence.length}x dígito ${sequence.digit} detectada.`,
          targetOutcome: 'WIN',
          sequenceStats: { currentStreak: 0, alternanceRate: 0, totalTrades: 0 },
          lastTickEpoch: ticks[ticks.length - 1]?.epoch || 0,
          analysisWindowEnd: ticks[ticks.length - 1]?.epoch || 0,
          adjustedConfidence: confidence,
        };
      }
    }

    const analysisTicks = config.usePredictiveAnalysis ? ticks.slice(-101, -1) : ticks.slice(-100);
    const advancedScore = calculateAdvancedSignalScore(analysisTicks, 0.5, decimalPlaces);

    if (advancedScore.regime.type !== 'RANGING') {
      setPauseReason(`Pausado em regime ${advancedScore.regime.type}`);
      return null;
    }
    
    if (advancedScore.recommendation === 'AVOID' || advancedScore.recommendation === 'NEUTRAL') {
      setPauseReason(`Evitando trade. Recomendação: ${advancedScore.recommendation}`);
      return null;
    }

    const { probEven, probOver4, probUnder5 } = calculateDigitStatsForWindow(analysisTicks, 100, decimalPlaces);
    
    const threshold = 0.55;
    
    if (config.allowedContracts.EVENODD) {
      if (probEven > threshold || (1 - probEven) > threshold) {
        const contract: DigitContractType = probEven > threshold ? 'DIGITEVEN' : 'DIGITODD';
        const confidence = probEven > threshold ? probEven : (1 - probEven);
        return {
          state: 'CONTEXT_ANALYSIS',
          activeStrategy: 'Contextual Alternator',
          confidence,
          suggestedContract: contract,
          shouldTrade: true,
          reason: `Regime RANGING. Prob. ${contract.replace('DIGIT', '')} = ${(confidence * 100).toFixed(1)}%`,
          targetOutcome: 'WIN',
          sequenceStats: { currentStreak: 0, alternanceRate: 0, totalTrades: 0 },
          lastTickEpoch: ticks[ticks.length - 1]?.epoch || 0,
          analysisWindowEnd: analysisTicks[analysisTicks.length - 1]?.epoch || 0,
          advancedScore,
          adjustedConfidence: confidence,
          suggestedStakeMultiplier: 1.0
        };
      }
    }
    
    if (config.allowedContracts.OVERUNDER) {
      if (probOver4 > threshold || probUnder5 > threshold) {
        const contract: DigitContractType = probOver4 > threshold ? 'DIGITOVER' : 'DIGITUNDER';
        const suggestedDigit = probOver4 > threshold ? 4 : 5;
        const confidence = probOver4 > threshold ? probOver4 : probUnder5;
        return {
          state: 'CONTEXT_ANALYSIS',
          activeStrategy: 'Contextual Alternator',
          confidence,
          suggestedContract: contract,
          suggestedDigit,
          shouldTrade: true,
          reason: `Regime RANGING. Prob. ${contract.replace('DIGIT', '')} > ${suggestedDigit} = ${(confidence * 100).toFixed(1)}%`,
          targetOutcome: 'WIN',
          sequenceStats: { currentStreak: 0, alternanceRate: 0, totalTrades: 0 },
          lastTickEpoch: ticks[ticks.length - 1]?.epoch || 0,
          analysisWindowEnd: analysisTicks[analysisTicks.length - 1]?.epoch || 0,
          advancedScore,
          adjustedConfidence: confidence,
          suggestedStakeMultiplier: 1.0
        };
      }
    }
    
    setPauseReason('Aguardando oportunidade (Repetição ou Vantagem em Ranging).');
    return null;

  }, [ticks, config, decimalPlaces]);

  return { signal, onTradeCompleted };
};
