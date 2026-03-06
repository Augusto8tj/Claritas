// src/features/trading/hooks/use-vagalume-alternante.ts
'use client';

/**
 * @fileOverview Vagalume V3.3 - Híbrido Refatorado: Repetition Trigger + Contextual Alternator
 *
 * Esta versão remove completamente a máquina de estados W1/L1, focando em uma
 * lógica de decisão stateless e mais robusta, baseada em duas estratégias distintas.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Operation, TickData } from '@/lib/types';
import { calculateAdvancedSignalScore, type AdvancedSignalScore } from '../services/digit-indicators';
import { detectRepetitionSequence } from '../services/repetition-detector';
import { calculateDigitStatsForWindow } from '../services/digits-analysis';

// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

export type VagalumeState = 'IDLE' | 'SEQUENCE_DETECTED' | 'CONTEXT_ANALYSIS' | 'PAUSED';
export type DigitContractType = 'DIGITMATCH' | 'DIGITDIFF' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER';

export interface VagalumeConfig {
  minSequenceLength: number;
  usePredictiveAnalysis: boolean;
  contextualThreshold: number; 
  requireRangingRegime: boolean;
  allowedContracts: {
    MATCHDIFFERS: boolean;
    EVENODD: boolean;
    OVERUNDER: boolean;
  };
  // Campos legados mantidos para evitar quebras de tipo, mas não são mais usados na lógica principal.
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
  advancedScore?: AdvancedSignalScore;
  adjustedConfidence: number;
  // Campos legados
  targetOutcome: 'WIN' | 'LOSS';
  sequenceStats: { currentStreak: number; alternanceRate: number; totalTrades: number };
  lastTickEpoch: number;
  analysisWindowEnd: number;
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
): { signal: VagalumeSignal | null, onTradeCompleted: (tradeResult: Operation) => void, pauseReason: string | null } => {
  const [pauseReason, setPauseReason] = useState<string | null>(null);

  const onTradeCompleted = useCallback((lastTrade: Operation) => {
    // A lógica de estado W/L foi removida, então este callback é apenas para log futuro.
    console.log(`[Vagalume V3.3] Trade concluído: ${lastTrade.result! > 0 ? 'WIN' : 'LOSS'}`);
  }, []);

  const signal = useMemo((): VagalumeSignal | null => {
    const minTicksRequired = Math.max(config.minSequenceLength, 100);
    if (ticks.length < minTicksRequired) {
      setPauseReason(`Dados insuficientes (${ticks.length}/${minTicksRequired} ticks)`);
      return null;
    }
    
    // --- ESTRATÉGIA 1 (PRIORIDADE): REPETITION TRIGGER ---
    // ✅ CORREÇÃO: Apenas procurar sequências se o comprimento mínimo for > 1.
    // Se for 1, a intenção é usar apenas o modo contextual.
    if (config.allowedContracts.MATCHDIFFERS && config.minSequenceLength > 1) {
      const sequence = detectRepetitionSequence(ticks, decimalPlaces, config.minSequenceLength, 6);
      if (sequence) {
        const baseConfidence = 0.90 + (sequence.length - config.minSequenceLength) * 0.02;
        const confidence = Math.min(0.98, baseConfidence);
        setPauseReason(null); 
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
          advancedScore: undefined,
          adjustedConfidence: confidence,
        };
      }
    }

    // --- ESTRATÉGIA 2 (FALLBACK): CONTEXTUAL ALTERNATOR ---
    const analysisTicks = ticks.slice(-100);
    const advancedScore = calculateAdvancedSignalScore(analysisTicks, 0.5, decimalPlaces);

    if (config.requireRangingRegime && advancedScore.regime.type !== 'RANGING') {
      setPauseReason(`Pausado em regime ${advancedScore.regime.type}. Desative o filtro para operar.`);
      return null;
    }
    
    if (advancedScore.recommendation === 'AVOID' || advancedScore.recommendation === 'NEUTRAL') {
      setPauseReason(`Análise contextual: ${advancedScore.recommendation}. Aguardando melhores condições.`);
      return null;
    }
    
    const { probEven, probOver4, probUnder5 } = calculateDigitStatsForWindow(analysisTicks, 100, decimalPlaces);
    const threshold = config.contextualThreshold / 100;
    
    // Análise de Par/Ímpar
    if (config.allowedContracts.EVENODD) {
      if (probEven > threshold || (1 - probEven) > threshold) {
        const contract: DigitContractType = probEven > threshold ? 'DIGITEVEN' : 'DIGITODD';
        const confidence = probEven > threshold ? probEven : (1 - probEven);
        setPauseReason(null);
        return {
          state: 'CONTEXT_ANALYSIS',
          activeStrategy: 'Contextual Alternator',
          confidence,
          suggestedContract: contract,
          shouldTrade: true,
          reason: `Vantagem em bloco ${contract.replace('DIGIT', '')} (${(confidence * 100).toFixed(1)}%)`,
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
    
    // Análise de Acima/Abaixo
    if (config.allowedContracts.OVERUNDER) {
      if (probOver4 > threshold || probUnder5 > threshold) {
        const contract: DigitContractType = probOver4 > threshold ? 'DIGITOVER' : 'DIGITUNDER';
        const suggestedDigit = probOver4 > threshold ? 4 : 5;
        const confidence = probOver4 > threshold ? probOver4 : probUnder5;
        setPauseReason(null);
        return {
          state: 'CONTEXT_ANALYSIS',
          activeStrategy: 'Contextual Alternator',
          confidence,
          suggestedContract: contract,
          suggestedDigit,
          shouldTrade: true,
          reason: `Vantagem em bloco ${contract.replace('DIGIT', '')} > ${suggestedDigit} (${(confidence * 100).toFixed(1)}%)`,
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
    
    setPauseReason('Aguardando oportunidade (Repetição ou Vantagem em Bloco).');
    return null;

  }, [ticks, config, decimalPlaces]);

  return { signal, onTradeCompleted, pauseReason };
};
