// /src/features/trading/hooks/use-strategy-evolution-v1.ts
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RobotStrategy, RobotPerformance } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveEvolutionHistory, loadEvolutionHistory, clearEvolutionHistory } from '@/services/financial-data-service';
import { initialCouncilStrategies } from '@/features/trading/services/council-strategies';
import type { EvolutionEvent as EvolutionEventV2 } from './use-strategy-evolution-v2'; // Import the richer type

// ============================================================================
// PARÂMETROS DA EVOLUÇÃO
// ============================================================================
const EVOLUTION_TRIGGER_THRESHOLD = 20; 
const ELITE_COUNT = 5; 
const WORST_COUNT = 5;
const MIN_TRADES_FOR_ANALYSIS = 5;

// Corrected EvolutionEvent to be compatible with V2
export interface EvolutionEvent {
    timestamp: Date;
    elitePerformers: Pick<RobotPerformance, 'id' | 'strategyType' | 'totalProfit' | 'wins' | 'losses'>[];
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

/**
 * Analisa o histórico de perdas de um robô para identificar fraquezas.
 * @param robot O robô a ser analisado.
 * @returns Um objeto com o padrão de fraqueza e uma sugestão de correção.
 */
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
  
  // 1. Analisa em que REGIMES o robô perde mais
  const lossesByTrend: Record<string, number> = {};
  losses.forEach(loss => {
    const trend = loss.regime?.trend || 'NEUTRAL';
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
         suggestedFix.period = Math.round(robot.strategy.period * 1.2); // Torna a média mais lenta
     }
     else if ((worstTrend === 'STRONG_UP' || worstTrend === 'STRONG_DOWN') && isRangeStrategy && robot.strategy.period) {
         suggestedFix.period = Math.round(robot.strategy.period * 0.8); // Torna o oscilador mais rápido
     }
  }

  return {
    weaknessPattern,
    suggestedFix
  };
}

/**
 * Cria uma mutação de um robô, aplicando correções e alguma aleatoriedade.
 * @param eliteRobot O robô "pai".
 * @param suggestedFix Correções baseadas na análise do robô substituído.
 * @returns Uma nova estratégia com parâmetros alterados.
 */
const mutateStrategy = (
    eliteRobot: RobotStrategy,
    suggestedFix: Partial<RobotStrategy> = {}
): { strategy: Omit<RobotStrategy, 'id' | 'justification'>; parameters: string[] } => {
    const newStrategy = { ...eliteRobot, ...suggestedFix };
    const changedParams: string[] = Object.keys(suggestedFix);
    
    const mutationFactor = 1 + (Math.random() - 0.5) * 0.1; // +/- 5%
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
        };
        
        loadEvolutionHistory(user.uid, 'v1', assetSymbol).then(history => {
            if (history && history.length > 0) {
                // The loaded history is of type V2, we cast it to V1.
                // This might cause issues if V1 components expect different properties.
                // For now, we assume a compatible structure for display.
                const compatibleHistory = history.map(h => ({
                    timestamp: h.timestamp,
                    elitePerformers: h.elitePerformers,
                    mutations: h.mutations.map(m => ({
                        replacedBotId: m.robotId,
                        replacedBotType: m.robotType,
                        parentId: m.parentId,
                        parentType: m.parentType,
                        diagnosis: m.diagnosis,
                        prescription: m.prescription,
                        mutatedGenes: m.mutatedGenes,
                    }))
                }))
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

        console.log(`[Evolution V1] Limite de ${EVOLUTION_TRIGGER_THRESHOLD} trades atingido para ${assetSymbol}. A iniciar ciclo de evolução...`);
        tradeCountRef.current = 0; 

        const sortedPerformance = [...performanceData].sort((a, b) => (b.sharpeRatio || -99) - (a.sharpeRatio || -99));

        const elitePerformers = sortedPerformance.slice(0, ELITE_COUNT);
        const worstPerformers = sortedPerformance.slice(-WORST_COUNT);

        if (elitePerformers.length === 0 || worstPerformers.length === 0) {
            console.warn("[Evolution V1] Não há dados de desempenho suficientes para a evolução.");
            return;
        }

        toast({
            title: "🧬 Evolução Genética Inteligente!",
            description: "Analisando falhas e aplicando mutações direcionadas aos robôs.",
        });

        const newEvent: EvolutionEvent = {
            timestamp: new Date(),
            elitePerformers: elitePerformers.map(({ id, strategyType, totalProfit, wins, losses }) => ({ id, strategyType, totalProfit: totalProfit || 0, wins: wins || 0, losses: losses || 0 })),
            mutations: [],
        };
        
        let strategiesChanged = false;
        const newStrategiesMap = new Map(evolvedStrategies.map((s, i) => [initialCouncilStrategies[i].id, s]));

        worstPerformers.forEach((worst, index) => {
            if ((worst.wins || 0) + (worst.losses || 0) < MIN_TRADES_FOR_ANALYSIS) return;

            const eliteParent = elitePerformers[index % elitePerformers.length];
            const failureAnalysis = analyzeRobotFailures(worst);
            
            const { strategy: newStrategyParams, parameters: mutatedGenes } = mutateStrategy(eliteParent.strategy, failureAnalysis.suggestedFix);
            
            const newJustification = `Gen mutado de ${eliteParent.strategyType}. Causa: ${failureAnalysis.weaknessPattern}`;
            
            const worstBotInitialData = initialCouncilStrategies.find(s => s.id === worst.id);
            if(worstBotInitialData) {
              const fullNewStrategy = {
                  ...worstBotInitialData,
                  ...newStrategyParams,
                  justification: newJustification,
              };
              
              const currentStrategiesArray = Array.from(newStrategiesMap.values());
              const worstIndex = currentStrategiesArray.findIndex(s => (s as any).id === worst.id);
              if (worstIndex !== -1) {
                  newStrategiesMap.set(worst.id, fullNewStrategy);
                  strategiesChanged = true;

                  newEvent.mutations.push({
                      robotId: worst.id,
                      robotType: worst.strategyType,
                      parentId: eliteParent.id,
                      parentType: eliteParent.strategyType,
                      diagnosis: failureAnalysis.weaknessPattern,
                      prescription: Object.keys(failureAnalysis.suggestedFix).length > 0 ? 'Correção Direcionada' : 'Mutação Aleatória',
                      mutatedGenes: mutatedGenes,
                  });

                  console.log(`[Evolution V1] Robô ${worst.id} (${worst.strategyType}) substituído. Análise: ${failureAnalysis.weaknessPattern}`);
              }
            }
        });

        if (strategiesChanged) {
            setEvolvedStrategies(Array.from(newStrategiesMap.values()));
            setEvolutionHistory(prev => {
                const newHistory = [newEvent, ...prev];
                if(user && assetSymbol) {
                    const historyV2Format = newHistory.map(h => ({ ...h, generation: 0, trigger: 'virtual', tradeCount: EVOLUTION_TRIGGER_THRESHOLD, populationStats: { avgSharpe: 0, avgWinRate: 0, totalProfit: 0, bestRegimes: [] } } as EvolutionEventV2));
                    saveEvolutionHistory(user.uid, historyV2Format, 'v1', assetSymbol);
                }
                return newHistory;
            });
        }
    }, [evolvedStrategies, toast, user, assetSymbol, evolutionHistory]);

    const resetEvolutionHistoryForAsset = useCallback(async () => {
        if (!user || !assetSymbol) {
            toast({ title: 'Erro', description: 'Nenhum usuário ou ativo selecionado.', variant: 'destructive'});
            return;
        }
        try {
            await clearEvolutionHistory(user.uid, 'v1', assetSymbol);
            setEvolutionHistory([]); // Limpa o estado local
            setEvolvedStrategies(initialCouncilStrategies); // Reseta as estratégias para o padrão
            tradeCountRef.current = 0;
            toast({ title: `Evolução para ${assetSymbol} Resetada`, description: 'O sistema recomeçará a aprender com as estratégias padrão.'});
        } catch (error) {
            console.error("Failed to reset evolution history:", error);
            toast({ title: 'Erro ao Resetar', description: 'Não foi possível apagar o histórico de evolução.', variant: 'destructive'});
        }
    }, [user, assetSymbol, toast]);

    return {
        evolvedStrategies,
        evolveTrigger,
        evolutionHistory,
        resetEvolutionHistoryForAsset,
    };
}
