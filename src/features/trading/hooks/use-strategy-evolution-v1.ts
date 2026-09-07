// /src/features/trading/hooks/use-strategy-evolution-v1.ts
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RobotStrategy, RobotPerformance, EnhancedRobotPerformance } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveEvolutionHistory, loadEvolutionHistory, clearEvolutionHistory } from '@/services/financial-data-service';
import { initialCouncilStrategies } from '@/features/trading/services/council-strategies';
import type { EvolutionEvent as EvolutionEventV2 } from './use-strategy-evolution-v2';

// ============================================================================
// PARÂMETROS DA EVOLUÇÃO
// ============================================================================
const EVOLUTION_TRIGGER_THRESHOLD = 20; 
const ELITE_COUNT = 5; 
const WORST_COUNT = 5;
const MIN_TRADES_FOR_ANALYSIS = 5;

export interface EvolutionEvent {
    timestamp: Date;
    elitePerformers: Pick<EnhancedRobotPerformance, 'id' | 'strategyType' | 'sharpeRatio' | 'wins' | 'losses' | 'totalProfit'>[];
    mutations: {
        robotId: string;
        robotType: string;
        parentId: string;
        parentType: string;
        diagnosis: string;
        prescription: string;
        mutatedGenes: string[];
    }[];
}

// ============================================================================
// FUNÇÕES DE MUTAÇÃO INTELIGENTE
// ============================================================================

function analyzeRobotFailures(
  robot: RobotPerformance,
): {
  weaknessPattern: string;
  suggestedFix: Partial<RobotStrategy>;
} {
  const losses = robot.tradeHistory?.filter(t => t.profit < 0) || [];
  
  if (!robot.tradeHistory || losses.length < MIN_TRADES_FOR_ANALYSIS / 2) {
    return { weaknessPattern: 'Dados insuficientes', suggestedFix: {} };
  }
  
  const lossesByTrend: Record<string, number> = {};
  losses.forEach(loss => {
    // regime agora é garantido como string no histórico
    const trend = loss.regime || 'NEUTRAL';
    lossesByTrend[trend] = (lossesByTrend[trend] || 0) + 1;
  });
  
  const worstTrend = Object.keys(lossesByTrend).reduce((a, b) => 
    lossesByTrend[a] > lossesByTrend[b] ? a : b
  , '');
  
  let suggestedFix: Partial<RobotStrategy> = {};
  let weaknessPattern = `Perde ${((losses.length / robot.tradeHistory.length) * 100).toFixed(0)}% das vezes.`;

  if (worstTrend && lossesByTrend[worstTrend] > losses.length * 0.5) {
     weaknessPattern += ` Ponto fraco: tendência ${worstTrend}.`;
     
     const isTrendStrategy = ['MACD_CROSS', 'ADX_TREND', 'MOVING_AVERAGE_CROSS'].includes(robot.strategyType);
     const isRangeStrategy = ['RSI', 'STOCHASTIC', 'BOLLINGER_BANDS'].includes(robot.strategyType);

     if (worstTrend === 'NEUTRAL' && isTrendStrategy && robot.strategy.period) {
         suggestedFix.period = Math.round(robot.strategy.period * 1.2);
     }
     else if ((worstTrend === 'STRONG_UP' || worstTrend === 'STRONG_DOWN') && isRangeStrategy && robot.strategy.period) {
         suggestedFix.period = Math.round(robot.strategy.period * 0.8);
     }
  }

  return { weaknessPattern, suggestedFix };
}

const mutateStrategy = (
    eliteRobot: RobotStrategy,
    suggestedFix: Partial<RobotStrategy> = {}
): { strategy: Omit<RobotStrategy, 'id' | 'justification'>; parameters: string[] } => {
    const newStrategy = { ...eliteRobot, ...suggestedFix };
    const changedParams: string[] = Object.keys(suggestedFix);
    
    const mutationFactor = 1 + (Math.random() - 0.5) * 0.1;
    const smallChange = Math.random() > 0.5 ? 1 : -1;

    if (newStrategy.period && !changedParams.includes('period')) {
        newStrategy.period = Math.max(5, Math.round(newStrategy.period * mutationFactor));
        changedParams.push('period (random)');
    }
     if (newStrategy.strongBuyThreshold && !changedParams.includes('strongBuyThreshold')) {
        newStrategy.strongBuyThreshold = Math.max(5, Math.min(40, newStrategy.strongBuyThreshold + smallChange));
        newStrategy.weakBuyThreshold = newStrategy.strongBuyThreshold + 10;
        changedParams.push('buyThreshold (random)');
    }
    
    const { id, justification, ...rest } = newStrategy;
    return { 
        strategy: rest as Omit<RobotStrategy, 'id' | 'justification'>, 
        parameters: changedParams 
    };
};

// ============================================================================
// O HOOK DE EVOLUÇÃO
// ============================================================================

export function useStrategyEvolutionV1(assetSymbol: string | null) {
    const { toast } = useToast();
    const { user } = useAuth();
    
    const [evolvedStrategies, setEvolvedStrategies] = useState<Omit<RobotStrategy, 'id'>[]>(initialCouncilStrategies);
    const [evolutionHistory, setEvolutionHistory] = useState<EvolutionEvent[]>([]);

    useEffect(() => {
        if (!user || !assetSymbol) {
            setEvolutionHistory([]);
            setEvolvedStrategies(initialCouncilStrategies);
            return;
        }
        
        loadEvolutionHistory(user.uid, 'v1', assetSymbol).then(history => {
            if (history && history.length > 0) {
                const compatibleHistory = history.map(h => ({
                    timestamp: h.timestamp,
                    elitePerformers: h.elitePerformers.map(p => ({
                        id: p.id,
                        strategyType: p.strategyType,
                        sharpeRatio: p.sharpeRatio,
                        totalProfit: p.totalProfit,
                        wins: p.wins,
                        losses: p.losses
                    })),
                    mutations: h.mutations.map(m => ({
                        robotId: m.robotId,
                        robotType: m.robotType,
                        parentId: m.parentId,
                        parentType: m.parentType,
                        diagnosis: m.diagnosis,
                        prescription: m.prescription,
                        mutatedGenes: m.mutatedGenes,
                    }))
                }));
                setEvolutionHistory(compatibleHistory as EvolutionEvent[]);
            } else {
                setEvolutionHistory([]);
            }
        });
    }, [user, assetSymbol]);

    const tradeCountRef = useRef(0);

    const evolveTrigger = useCallback((performanceData: RobotPerformance[]) => {
        tradeCountRef.current += 1;

        if (tradeCountRef.current < EVOLUTION_TRIGGER_THRESHOLD) {
            return; 
        }

        tradeCountRef.current = 0; 

        const sortedPerformance = [...performanceData].sort((a, b) => (b.sharpeRatio || -99) - (a.sharpeRatio || -99));

        const elitePerformers = sortedPerformance.slice(0, ELITE_COUNT);
        const worstPerformers = sortedPerformance.slice(-WORST_COUNT);

        if (elitePerformers.length === 0 || worstPerformers.length === 0) return;

        toast({ title: "🧬 Evolução Genética V1", description: "Otimizando conselho com base no desempenho." });

        const newEvent: EvolutionEvent = {
            timestamp: new Date(),
            elitePerformers: elitePerformers.map(p => ({ 
              id: p.id, 
              strategyType: p.strategyType, 
              sharpeRatio: p.sharpeRatio || 0,
              totalProfit: p.totalProfit || 0, 
              wins: p.wins || 0, 
              losses: p.losses || 0 
            })),
            mutations: [],
        };
        
        let strategiesChanged = false;
        const currentStrategies = [...evolvedStrategies];

        worstPerformers.forEach((worst) => {
            if ((worst.wins || 0) + (worst.losses || 0) < MIN_TRADES_FOR_ANALYSIS) return;

            const eliteParent = elitePerformers[Math.floor(Math.random() * elitePerformers.length)];
            const failureAnalysis = analyzeRobotFailures(worst);
            
            const { strategy: newStrategyParams, parameters: mutatedGenes } = mutateStrategy(eliteParent.strategy, failureAnalysis.suggestedFix);
            
            const newJustification = `Mutação Genética de ${eliteParent.strategyType}. Causa: ${failureAnalysis.weaknessPattern}`;
            
            const worstIndex = evolvedStrategies.findIndex(s => (s as any).strategyType === worst.strategyType);
            if (worstIndex !== -1) {
              currentStrategies[worstIndex] = {
                  ...currentStrategies[worstIndex],
                  ...newStrategyParams,
                  justification: newJustification,
              };
              strategiesChanged = true;

              newEvent.mutations.push({
                  robotId: worst.id,
                  robotType: worst.strategyType,
                  parentId: eliteParent.id,
                  parentType: eliteParent.strategyType,
                  diagnosis: failureAnalysis.weaknessPattern,
                  prescription: 'Ajuste de Parâmetros',
                  mutatedGenes: mutatedGenes,
              });
            }
        });

        if (strategiesChanged) {
            setEvolvedStrategies(currentStrategies);
            setEvolutionHistory(prev => {
                const newHistory = [newEvent, ...prev];
                if(user && assetSymbol) {
                    const historyV2Format = newHistory.map(h => ({
                        generation: 0,
                        timestamp: h.timestamp,
                        elitePerformers: h.elitePerformers.map(p => ({ 
                          id: p.id, 
                          strategyType: p.strategyType, 
                          totalProfit: p.totalProfit, 
                          wins: p.wins, 
                          losses: p.losses, 
                          sharpeRatio: p.sharpeRatio 
                        })),
                        mutations: h.mutations.map(m => ({ 
                          ...m, 
                          expectedImprovement: 'N/A' 
                        })),
                        trigger: 'virtual' as const,
                        tradeCount: EVOLUTION_TRIGGER_THRESHOLD,
                        populationStats: { avgSharpe: 0, avgWinRate: 0, totalProfit: 0, bestRegimes: [] }
                    }));
                    saveEvolutionHistory(user.uid, historyV2Format, 'v1', assetSymbol);
                }
                return newHistory;
            });
        }
    }, [evolvedStrategies, toast, user, assetSymbol]);

    return { evolvedStrategies, evolveTrigger, evolutionHistory, resetEvolutionHistoryForAsset: () => assetSymbol && user && clearEvolutionHistory(user.uid, 'v1', assetSymbol) };
}
