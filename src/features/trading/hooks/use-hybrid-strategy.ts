// src/features/trading/hooks/use-hybrid-strategy.ts
'use client';

import { useState, useEffect, useMemo } from 'react';
import type { TickData, Operation } from '@/lib/types';
import type { VagalumeSignal } from './use-vagalume-alternante';
import type { RepetitionSignal, RepetitionTriggerConfig } from '../types/repetition-trigger';
import { useRepetitionTrigger } from './use-repetition-trigger';
import { useVagalumeAlternante } from './use-vagalume-alternante';

export type HybridStrategy = 'trigger' | 'vagalume' | 'none';

interface HybridStrategyConfig {
  repetitionConfig: Partial<RepetitionTriggerConfig>;
  vagalumeConfig: any; // Use VagalumeConfig type
  priorityMode: 'trigger_first' | 'vagalume_first' | 'best_confidence' | 'best_performance';
  performanceWindow: number; // Últimos N trades para comparar performance
}

export interface HybridSignal {
  activeStrategy: HybridStrategy;
  signal: RepetitionSignal | VagalumeSignal | null;
  alternativeSignal?: RepetitionSignal | VagalumeSignal | null;
  reason: string;
  confidenceComparison?: {
    trigger: number;
    vagalume: number;
    selected: HybridStrategy;
  };
}

export function useHybridStrategy(
  priceTicks: TickData[],
  tradeHistory: Operation[],
  decimalPlaces: number,
  config: HybridStrategyConfig
) {
  
  // Inicializa ambos os bots
  const triggerBot = useRepetitionTrigger(
    priceTicks,
    tradeHistory.filter(t => t.initiator === 'Repetition Trigger'),
    decimalPlaces,
    config.repetitionConfig
  );
  
  // Note: Vagalume hook needs its config object passed in correctly
  const vagalumeBot = useVagalumeAlternante(
    priceTicks,
    tradeHistory.filter(t => t.initiator === 'Vagalume'),
    config.vagalumeConfig, // Pass the full config
    1000, // Placeholder for bankroll
    decimalPlaces
  );
  
  const [hybridSignal, setHybridSignal] = useState<HybridSignal>({
    activeStrategy: 'none',
    signal: null,
    reason: 'Aguardando sinais...',
  });
  
  // ========================================
  // LÓGICA DE DECISÃO
  // ========================================
  
  useEffect(() => {
    const triggerSignal = triggerBot.signal;
    const vagalumeSignal = vagalumeBot.signal;
    
    // Ambos pausados
    if (triggerBot.isPaused && !!vagalumeBot.pauseReason) {
      setHybridSignal({
        activeStrategy: 'none',
        signal: null,
        reason: 'Ambos os bots estão pausados',
      });
      return;
    }
    
    // Nenhum sinal
    if (!triggerSignal && !vagalumeSignal) {
      setHybridSignal({
        activeStrategy: 'none',
        signal: null,
        reason: 'Nenhum sinal detectado',
      });
      return;
    }
    
    // Decide baseado no modo de prioridade
    let selectedStrategy: HybridStrategy = 'none';
    let selectedSignal: RepetitionSignal | VagalumeSignal | null = null;
    let reason = '';
    
    // Helper function to calculate win rate
    const calculateWinRate = (history: Operation[], window: number): number => {
        const recent = history.slice(-window);
        if (recent.length === 0) return 0;
        const wins = recent.filter(t => (t.result ?? 0) > 0).length;
        return (wins / recent.length);
    };

    switch (config.priorityMode) {
      
      case 'trigger_first':
        // SEMPRE prioriza Trigger se disponível
        if (triggerSignal && !triggerBot.isPaused) {
          selectedStrategy = 'trigger';
          selectedSignal = triggerSignal;
          reason = `Repetition Trigger: ${triggerSignal.sequence.length}x dígito ${triggerSignal.sequence.digit}`;
        } else if (vagalumeSignal && !vagalumeBot.pauseReason) {
          selectedStrategy = 'vagalume';
          selectedSignal = vagalumeSignal;
          reason = `Vagalume (fallback): Estado ${vagalumeSignal.state}`;
        }
        break;
      
      case 'vagalume_first':
        // SEMPRE prioriza Vagalume se disponível
        if (vagalumeSignal && !vagalumeBot.pauseReason) {
          selectedStrategy = 'vagalume';
          selectedSignal = vagalumeSignal;
          reason = `Vagalume: Estado ${vagalumeSignal.state}`;
        } else if (triggerSignal && !triggerBot.isPaused) {
          selectedStrategy = 'trigger';
          selectedSignal = triggerSignal;
          reason = `Repetition Trigger (fallback): ${triggerSignal.sequence.length}x`;
        }
        break;
      
      case 'best_confidence':
        // Escolhe o maior confidence
        const triggerConf = triggerSignal?.confidence || 0;
        const vagalumeConf = vagalumeSignal?.adjustedConfidence || vagalumeSignal?.confidence || 0;
        
        if (triggerConf > vagalumeConf && triggerSignal && !triggerBot.isPaused) {
          selectedStrategy = 'trigger';
          selectedSignal = triggerSignal;
          reason = `Trigger selecionado (${(triggerConf * 100).toFixed(1)}% vs ${(vagalumeConf * 100).toFixed(1)}%)`;
        } else if (vagalumeSignal && !vagalumeBot.pauseReason) {
          selectedStrategy = 'vagalume';
          selectedSignal = vagalumeSignal;
          reason = `Vagalume selecionado (${(vagalumeConf * 100).toFixed(1)}% vs ${(triggerConf * 100).toFixed(1)}%)`;
        }
        break;
      
      case 'best_performance':
        // Compara win rate dos últimos N trades
        const triggerWinRate = calculateWinRate(
            tradeHistory.filter(t => t.initiator === 'Repetition Trigger'),
            config.performanceWindow
        );
        const vagalumeWinRate = calculateWinRate(
            tradeHistory.filter(t => t.initiator === 'Vagalume'),
            config.performanceWindow
        );

        if (triggerWinRate > vagalumeWinRate && triggerSignal && !triggerBot.isPaused) {
            selectedStrategy = 'trigger';
            selectedSignal = triggerSignal;
            reason = `Trigger selecionado por performance (${(triggerWinRate * 100).toFixed(0)}% WR)`;
        } else if (vagalumeSignal && !vagalumeBot.pauseReason) {
            selectedStrategy = 'vagalume';
            selectedSignal = vagalumeSignal;
            reason = `Vagalume selecionado por performance (${(vagalumeWinRate * 100).toFixed(0)}% WR)`;
        }
        break;
      
      default:
        reason = "Modo de prioridade inválido.";
    }
    
    setHybridSignal({
        activeStrategy: selectedStrategy,
        signal: selectedSignal,
        reason,
    });
    
  }, [
    triggerBot.signal,
    triggerBot.isPaused,
    vagalumeBot.signal,
    vagalumeBot.pauseReason,
    config,
    tradeHistory,
  ]);
  
  return {
    hybridSignal,
    triggerBot,
    vagalumeBot,
  };
}
