// /src/hooks/use-strategy-evolution.ts
'use client';

import { useState, useCallback, useRef } from 'react';
import type { RobotStrategy, RobotPerformance } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

// ============================================================================
// PARÂMETROS DA EVOLUÇÃO
// ============================================================================
const EVOLUTION_TRIGGER_THRESHOLD = 50; // A cada X trades virtuais, aciona a evolução
const ELITE_COUNT = 5; // Número de melhores robôs a serem usados como base para mutação
const WORST_COUNT = 5; // Número de piores robôs a serem substituídos

export interface EvolutionEvent {
    timestamp: Date;
    elitePerformers: Pick<RobotPerformance, 'id' | 'strategyType' | 'totalProfit' | 'wins' | 'losses'>[];
    mutations: {
        replacedBotId: string;
        replacedBotType: string;
        parentBotId: string;
        parentBotType: string;
    }[];
}

// ============================================================================
// FUNÇÕES DE MUTAÇÃO
// ============================================================================

/**
 * Cria uma mutação de um robô de sucesso.
 * @param eliteRobot O robô de elite a ser mutado.
 * @returns Uma nova estratégia com parâmetros ligeiramente alterados.
 */
const mutateStrategy = (eliteRobot: RobotStrategy): Omit<RobotStrategy, 'id' | 'justification'> => {
    const newStrategy = { ...eliteRobot };
    
    // Fator de mutação pequeno
    const mutationFactor = 1 + (Math.random() - 0.5) * 0.2; // +/- 10%
    const smallChange = Math.random() > 0.5 ? 1 : -1;

    if (newStrategy.period) {
        newStrategy.period = Math.max(5, Math.round(newStrategy.period * mutationFactor));
    }
    if (newStrategy.shortPeriod) {
        newStrategy.shortPeriod = Math.max(3, Math.round(newStrategy.shortPeriod * mutationFactor));
    }
    if (newStrategy.longPeriod) {
        newStrategy.longPeriod = Math.max(newStrategy.shortPeriod ? newStrategy.shortPeriod + 5 : 10, Math.round(newStrategy.longPeriod * mutationFactor));
    }
     if (newStrategy.strongBuyThreshold) {
        newStrategy.strongBuyThreshold = Math.max(5, Math.min(40, newStrategy.strongBuyThreshold + smallChange));
        newStrategy.weakBuyThreshold = newStrategy.strongBuyThreshold + 10;
    }
    if (newStrategy.strongSellThreshold) {
        newStrategy.strongSellThreshold = Math.min(95, Math.max(60, newStrategy.strongSellThreshold + smallChange));
        newStrategy.weakSellThreshold = newStrategy.strongSellThreshold - 10;
    }
    if (newStrategy.optimalDuration) {
        newStrategy.optimalDuration = Math.max(1, Math.round(newStrategy.optimalDuration * mutationFactor));
        // Garante que a duração para ticks fique entre 1 e 10
        if (newStrategy.optimalDurationUnit === 't') {
            newStrategy.optimalDuration = Math.min(10, newStrategy.optimalDuration);
        }
    }
    
    // Remove os campos que serão gerados novamente
    const { id, justification, ...rest } = newStrategy;

    return rest as Omit<RobotStrategy, 'id' | 'justification'>;
};


// ============================================================================
// O HOOK DE EVOLUÇÃO
// ============================================================================

export function useStrategyEvolution(initialStrategies: Omit<RobotStrategy, 'id'>[]) {
    const { toast } = useToast();
    
    // O estado que guarda as estratégias atuais, começando com as iniciais
    const [evolvedStrategies, setEvolvedStrategies] = useState<Omit<RobotStrategy, 'id'>[]>(initialStrategies);
    // NOVO: Estado para guardar o histórico de eventos de evolução
    const [evolutionHistory, setEvolutionHistory] = useState<EvolutionEvent[]>([]);

    // Contador de trades para acionar a evolução
    const tradeCountRef = useRef(0);

    /**
     * A função principal que é chamada a cada ciclo de avaliação de desempenho.
     * Ela decide se é hora de evoluir e, se for, recalibra as estratégias.
     */
    const evolveTrigger = useCallback((performanceData: RobotPerformance[]) => {
        tradeCountRef.current += 1;

        if (tradeCountRef.current < EVOLUTION_TRIGGER_THRESHOLD) {
            return; // Ainda não é hora de evoluir
        }

        console.log(`[Evolution] Limite de ${EVOLUTION_TRIGGER_THRESHOLD} trades atingido. A iniciar ciclo de evolução...`);
        tradeCountRef.current = 0; // Reseta o contador

        // Ordena para encontrar os melhores e piores
        const sortedPerformance = [...performanceData].sort((a, b) => {
             // Prioriza taxa de acerto, depois lucro
            const aTotal = a.wins + a.losses;
            const bTotal = b.wins + b.losses;
            const aWinRate = aTotal > 0 ? a.wins / aTotal : 0;
            const bWinRate = bTotal > 0 ? b.wins / bTotal : 0;

            if (aWinRate !== bWinRate) return bWinRate - aWinRate;
            return b.totalProfit - a.totalProfit;
        });

        const elitePerformers = sortedPerformance.slice(0, ELITE_COUNT);
        const worstPerformers = sortedPerformance.slice(-WORST_COUNT);

        if (elitePerformers.length === 0 || worstPerformers.length === 0) {
            console.warn("[Evolution] Não há dados de desempenho suficientes para a evolução.");
            return;
        }

        toast({
            title: "🧬 Evolução de Estratégia!",
            description: "A IA está a recalibrar os robôs com base no desempenho recente.",
        });

        const newEvent: EvolutionEvent = {
            timestamp: new Date(),
            elitePerformers: elitePerformers.map(({ id, strategyType, totalProfit, wins, losses }) => ({ id, strategyType, totalProfit, wins, losses })),
            mutations: [],
        };
        
        // Cria um mapa das novas estratégias
        const newStrategiesMap = new Map<string, Omit<RobotStrategy, 'id'>>(
            evolvedStrategies.map(s => [(s as any).id, s])
        );

        // Substitui os piores por mutações dos melhores
        worstPerformers.forEach((worst, index) => {
            const eliteParent = elitePerformers[index % elitePerformers.length];
            const newStrategyParams = mutateStrategy(eliteParent.strategy);
            const newJustification = `Mutação da estratégia ${eliteParent.strategyType} de elite.`;
            
            newStrategiesMap.set(worst.id, {
                ...worst.strategy, 
                ...newStrategyParams, 
                justification: newJustification,
            });

            newEvent.mutations.push({
                replacedBotId: worst.id,
                replacedBotType: worst.strategyType,
                parentBotId: eliteParent.id,
                parentBotType: eliteParent.strategyType,
            });

            console.log(`[Evolution] Robô ${worst.id} (${worst.strategyType}) foi substituído por uma mutação de ${eliteParent.strategyType}.`);
        });

        setEvolvedStrategies(Array.from(newStrategiesMap.values()));
        setEvolutionHistory(prev => [newEvent, ...prev]);

    }, [evolvedStrategies, toast]);

    return {
        evolvedStrategies,
        evolveTrigger,
        evolutionHistory, // EXPORTA O HISTÓRICO
    };
}
