// /src/features/trading/hooks/use-strategy-evolution.ts
'use client';

import { useState, useCallback, useRef } from 'react';
import type { RobotStrategy, EnhancedRobotPerformance as RobotPerformance, MarketRegime } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

// ============================================================================
// PARÂMETROS DA EVOLUÇÃO
// ============================================================================
const EVOLUTION_TRIGGER_THRESHOLD = 10; // ✅ Otimização: Reduzido de 50 para 10
const ELITE_COUNT = 3; 
const WORST_COUNT = 3; 
const MIN_TRADES_FOR_ANALYSIS = 5;

export interface EvolutionEvent {
    timestamp: Date;
    elitePerformers: Pick<RobotPerformance, 'id' | 'strategyType' | 'totalProfit' | 'wins' | 'losses'>[];
    mutations: {
        replacedBotId: string;
        replacedBotType: string;
        parentBotId: string;
        parentBotType: string;
        analysis: string; // ✅ NOVO: Análise da mutação
    }[];
}

// ============================================================================
// FUNÇÕES DE MUTAÇÃO INTELIGENTE
// ============================================================================

/**
 * Cria uma mutação de um robô de sucesso, com ajustes direcionados.
 * @param eliteRobot O robô de elite a ser mutado.
 * @param analysis A análise do robô a ser substituído (opcional).
 * @returns Uma nova estratégia com parâmetros ligeiramente alterados.
 */
const mutateStrategy = (
    eliteRobot: RobotStrategy, 
    analysis?: { worstRegime: MarketRegime | null }
): Omit<RobotStrategy, 'id' | 'justification'> => {
    const newStrategy = { ...eliteRobot };
    
    // Fatores de mutação
    const bigMutation = 1 + (Math.random() - 0.5) * 0.4; // +/- 20%
    const smallMutation = 1 + (Math.random() - 0.5) * 0.1; // +/- 5%
    const smallChange = Math.random() > 0.5 ? 1 : -1;

    // ✅ Mutação Direcionada: Se sabemos que o robô falha em tendência, o fazemos mais rápido (curto período)
    if (analysis?.worstRegime === 'trending_bull' || analysis?.worstRegime === 'trending_bear') {
        if (newStrategy.period) {
            newStrategy.period = Math.max(5, Math.round(newStrategy.period * 0.8)); // Torna-o mais rápido
        }
    } 
    // ✅ Se falha em mercado lateral, o fazemos mais lento (longo período)
    else if (analysis?.worstRegime === 'ranging') {
         if (newStrategy.period) {
            newStrategy.period = Math.max(10, Math.round(newStrategy.period * 1.2)); // Torna-o mais lento
        }
    }

    // Mutação geral com menor intensidade
    if (newStrategy.period) newStrategy.period = Math.max(5, Math.round(newStrategy.period * smallMutation));
    if (newStrategy.shortPeriod) newStrategy.shortPeriod = Math.max(3, Math.round(newStrategy.shortPeriod * smallMutation));
    if (newStrategy.longPeriod) newStrategy.longPeriod = Math.max(newStrategy.shortPeriod ? newStrategy.shortPeriod + 5 : 10, Math.round(newStrategy.longPeriod * smallMutation));
    
    if (newStrategy.strongBuyThreshold) {
        newStrategy.strongBuyThreshold = Math.max(5, Math.min(40, newStrategy.strongBuyThreshold + smallChange * 2));
        newStrategy.weakBuyThreshold = newStrategy.strongBuyThreshold + 10;
    }
    if (newStrategy.strongSellThreshold) {
        newStrategy.strongSellThreshold = Math.min(95, Math.max(60, newStrategy.strongSellThreshold - smallChange * 2));
        newStrategy.weakSellThreshold = newStrategy.strongSellThreshold - 10;
    }
    if (newStrategy.optimalDuration) {
        newStrategy.optimalDuration = Math.max(5, Math.round(newStrategy.optimalDuration * bigMutation));
        if (newStrategy.optimalDurationUnit === 't') {
            newStrategy.optimalDuration = Math.min(10, Math.max(5, newStrategy.optimalDuration));
        }
    }
    
    const { id, justification, ...rest } = newStrategy;

    return rest as Omit<RobotStrategy, 'id' | 'justification'>;
};


// ============================================================================
// O HOOK DE EVOLUÇÃO
// ============================================================================

export function useStrategyEvolution(initialStrategies: Omit<RobotStrategy, 'id'>[]) {
    const { toast } = useToast();
    
    const [evolvedStrategies, setEvolvedStrategies] = useState<Omit<RobotStrategy, 'id'>[]>(initialStrategies);
    const [evolutionHistory, setEvolutionHistory] = useState<EvolutionEvent[]>([]);

    const tradeCountRef = useRef(0);

    const evolveTrigger = useCallback((performanceData: RobotPerformance[]) => {
        tradeCountRef.current += 1;

        if (tradeCountRef.current < EVOLUTION_TRIGGER_THRESHOLD) {
            return;
        }

        console.log(`[Evolution] Limite de ${EVOLUTION_TRIGGER_THRESHOLD} trades atingido. A iniciar ciclo de evolução...`);
        tradeCountRef.current = 0;

        const sortedPerformance = [...performanceData].sort((a, b) => (b.sharpeRatio || -Infinity) - (a.sharpeRatio || -Infinity));

        const elitePerformers = sortedPerformance.slice(0, ELITE_COUNT).filter(p => p.tradeHistory && p.tradeHistory.length > MIN_TRADES_FOR_ANALYSIS);
        const worstPerformers = sortedPerformance.slice(-WORST_COUNT).filter(p => p.tradeHistory && p.tradeHistory.length > MIN_TRADES_FOR_ANALYSIS);

        if (elitePerformers.length === 0 || worstPerformers.length === 0 || elitePerformers[0].totalProfit <= 0) {
            console.warn("[Evolution] Não há robôs de elite com lucro ou piores robôs com dados suficientes. A evolução será adiada.");
            return;
        }

        toast({
            title: "🧬 Evolução Genética Inteligente!",
            description: "A IA está a analisar e a otimizar os robôs de pior desempenho.",
        });

        const newEvent: EvolutionEvent = {
            timestamp: new Date(),
            elitePerformers: elitePerformers.map(({ id, strategyType, totalProfit, wins, losses }) => ({ id, strategyType, totalProfit: totalProfit || 0, wins: wins || 0, losses: losses || 0 })),
            mutations: [],
        };
        
        const currentStrategies = [...evolvedStrategies];
        let strategiesChanged = false;

        worstPerformers.forEach((worst, index) => {
            const eliteParent = elitePerformers[index % elitePerformers.length];
            const worstIndex = currentStrategies.findIndex(s => (s as RobotStrategy).id === worst.id);
            if (worstIndex === -1) return;

            // ✅ ANÁLISE DE CAUSA-RAIZ
            const regimeTrades = worst.tradeHistory.reduce((acc, trade) => {
                // Supondo que tradeHistory agora guarda objetos { profit, regime }
                const regime = (trade as any).regime as MarketRegime || 'ranging';
                if (!acc[regime]) acc[regime] = { wins: 0, losses: 0 };
                if ((trade as any).profit > 0) acc[regime].wins++;
                else acc[regime].losses++;
                return acc;
            }, {} as Record<MarketRegime, { wins: number; losses: number }>);
            
            let worstRegime: MarketRegime | null = null;
            let lowestWinRate = 50; // Começa com 50% para só considerar pior se for abaixo disso
            let analysis = "Mutação geral baseada em elite.";

            for (const r in regimeTrades) {
                const regime = r as MarketRegime;
                const stats = regimeTrades[regime];
                const total = stats.wins + stats.losses;
                if (total > 2) { // Mínimo de 3 trades para considerar
                    const winRate = (stats.wins / total) * 100;
                    if (winRate < lowestWinRate) {
                        lowestWinRate = winRate;
                        worstRegime = regime;
                    }
                }
            }
            
            if (worstRegime) {
                analysis = `Desempenho fraco (${lowestWinRate.toFixed(0)}% WR) em regime '${worstRegime}'. A ajustar parâmetros para este cenário.`;
            }

            const newStrategyParams = mutateStrategy(eliteParent.strategy, { worstRegime });
            const newJustification = `Mutação de ${eliteParent.strategyType}. Análise: ${analysis}`;
            
            currentStrategies[worstIndex] = {
                ...currentStrategies[worstIndex], 
                ...newStrategyParams, 
                justification: newJustification,
            };
            strategiesChanged = true;

            newEvent.mutations.push({
                replacedBotId: worst.id,
                replacedBotType: worst.strategyType,
                parentBotId: eliteParent.id,
                parentBotType: eliteParent.strategyType,
                analysis,
            });

            console.log(`[Evolution] Robô ${worst.id} (${worst.strategyType}) substituído. Análise: ${analysis}`);
        });

        if (strategiesChanged) {
            setEvolvedStrategies(currentStrategies);
            setEvolutionHistory(prev => [newEvent, ...prev]);
        }

    }, [evolvedStrategies, toast]);

    return {
        evolvedStrategies,
        evolveTrigger,
        evolutionHistory,
    };
}
