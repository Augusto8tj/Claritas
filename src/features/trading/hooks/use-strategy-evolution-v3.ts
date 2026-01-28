// src/features/trading/hooks/use-strategy-evolution-v3.ts
'use client';

/**
 * 🧬 SISTEMA DE EVOLUÇÃO GENÉTICA V3.0 - VERSÃO COMPLETA E CORRIGIDA
 * ==================================================================
 * 
 * CORREÇÕES IMPLEMENTADAS:
 * 1. ✅ Contagem dual: 10 trades virtuais OU 1 trade real acionam evolução
 * 2. ✅ Persistência automática no Firestore após cada geração
 * 3. ✅ Estados de UI completos (isEvolving, progress, generation)
 * 4. ✅ Interface compatível com use-robot-council-v2.ts
 * 5. ✅ Funções de gerenciamento (reset, delete)
 * 6. ✅ Campo generation em EvolutionEvent
 * 7. ✅ Análise de causa-raiz direcionada por regime
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RobotStrategy, EnhancedRobotPerformance as RobotPerformance, MarketRegime } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { 
  saveEvolutionHistory, 
  loadEvolutionHistory, 
  clearEvolutionHistory,
  deleteEvolutionEvent 
} from '@/services/financial-data-service';
import { EVOLUTION_CONFIG } from '@/features/trading/config/trader-config';

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================
const VIRTUAL_TRADES_THRESHOLD = EVOLUTION_CONFIG.TRIGGER_THRESHOLD; 
const REAL_TRADES_THRESHOLD = 1;     // Aciona a cada trade real para aprendizado rápido
const ELITE_COUNT = EVOLUTION_CONFIG.ELITE_COUNT;
const WORST_COUNT = EVOLUTION_CONFIG.WORST_COUNT;
const MIN_TRADES_FOR_ANALYSIS = EVOLUTION_CONFIG.MIN_TRADES_FOR_DEEP_ANALYSIS;

// ============================================================================
// INTERFACES
// ============================================================================
export interface EvolutionEvent {
  generation: number;
  timestamp: Date;
  elitePerformers: Pick<RobotPerformance, 'id' | 'strategyType' | 'totalProfit' | 'wins' | 'losses' | 'sharpeRatio'>[];
  mutations: {
    robotId: string;
    robotType: string;
    parentId: string;
    parentType: string;
    diagnosis: string;
    prescription: string;
    expectedImprovement: string;
    mutatedGenes: string[];
  }[];
  trigger: 'virtual' | 'real';
  tradeCount: number;
  populationStats: {
      avgSharpe: number;
      avgWinRate: number;
      totalProfit: number;
      bestRegimes: string[];
  };
}

export interface TradeCounts {
  virtual: number;
  real: number;
  total: number;
}

// ============================================================================
// MUTAÇÃO INTELIGENTE
// ============================================================================
const mutateStrategy = (
  eliteRobot: RobotStrategy,
  analysis?: { worstRegime: MarketRegime | null }
): { strategy: Omit<RobotStrategy, 'id' | 'justification'>; parameters: string[] } => {
  const newStrategy = { ...eliteRobot };
  const changedParams: string[] = [];

  const bigMutation = 1 + (Math.random() - 0.5) * 0.4; // ±20%
  const smallMutation = 1 + (Math.random() - 0.5) * EVOLUTION_CONFIG.DIRECTED_MUTATION_STRENGTH; // Usa config
  const smallChange = Math.random() > 0.5 ? 1 : -1;

  if (analysis?.worstRegime === 'trending_bull' || analysis?.worstRegime === 'trending_bear') {
    if (newStrategy.period) {
      const oldPeriod = newStrategy.period;
      newStrategy.period = Math.max(5, Math.round(newStrategy.period * 0.8));
      if(oldPeriod !== newStrategy.period) changedParams.push(`period: ${oldPeriod} -> ${newStrategy.period}`);
    }
  } else if (analysis?.worstRegime === 'ranging') {
    if (newStrategy.period) {
      const oldPeriod = newStrategy.period;
      newStrategy.period = Math.max(10, Math.round(newStrategy.period * 1.2));
      if(oldPeriod !== newStrategy.period) changedParams.push(`period: ${oldPeriod} -> ${newStrategy.period}`);
    }
  }

  if (newStrategy.period && !changedParams.some(p => p.startsWith('period'))) {
    const old = newStrategy.period;
    newStrategy.period = Math.max(5, Math.round(newStrategy.period * smallMutation));
    if (old !== newStrategy.period) changedParams.push(`period: ${old} -> ${newStrategy.period}`);
  }

  if (newStrategy.strongBuyThreshold) {
    const old = newStrategy.strongBuyThreshold;
    newStrategy.strongBuyThreshold = Math.max(5, Math.min(40, newStrategy.strongBuyThreshold + smallChange * 2));
    newStrategy.weakBuyThreshold = newStrategy.strongBuyThreshold + 10;
     if (old !== newStrategy.strongBuyThreshold) changedParams.push(`buyThreshold: ${old} -> ${newStrategy.strongBuyThreshold}`);
  }

  if (newStrategy.optimalDuration) {
    const old = newStrategy.optimalDuration;
    newStrategy.optimalDuration = Math.max(5, Math.round(newStrategy.optimalDuration * bigMutation));
    if (newStrategy.optimalDurationUnit === 't') {
      newStrategy.optimalDuration = Math.min(10, Math.max(5, newStrategy.optimalDuration));
    }
     if (old !== newStrategy.optimalDuration) changedParams.push(`duration: ${old} -> ${newStrategy.optimalDuration}`);
  }

  const { id, justification, ...rest } = newStrategy;
  return { 
    strategy: rest as Omit<RobotStrategy, 'id' | 'justification'>, 
    parameters: changedParams 
  };
};

// ============================================================================
// HOOK PRINCIPAL
// ============================================================================
export function useStrategyEvolutionV3(initialStrategies: RobotStrategy[], assetSymbol: string) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [evolvedStrategies, setEvolvedStrategies] = useState<RobotStrategy[]>(initialStrategies);
  const [evolutionHistory, setEvolutionHistory] = useState<EvolutionEvent[]>([]);
  
  const [isEvolving, setIsEvolving] = useState(false);
  const [evolutionProgress, setEvolutionProgress] = useState(0);
  const [currentGeneration, setCurrentGeneration] = useState(0);

  const [tradeCounts, setTradeCounts] = useState<TradeCounts>({ virtual: 0, real: 0, total: 0 });
  const tradeCountsRef = useRef<TradeCounts>({ virtual: 0, real: 0, total: 0 });

  useEffect(() => {
    if (!user || !assetSymbol) return;
    
    loadEvolutionHistory(user.uid, 'v3', assetSymbol)
      .then(history => {
        if (history.length > 0) {
          setEvolutionHistory(history);
          setCurrentGeneration(history[0]?.generation || 0);
        }
      })
      .catch(err => {
        console.error('❌ [Evolution V3] Erro ao carregar histórico:', err);
      });
  }, [user, assetSymbol]);

  const tradesUntilEvolution = VIRTUAL_TRADES_THRESHOLD - tradeCounts.virtual;

  const evolveTrigger = useCallback(async (
    performanceData: RobotPerformance[],
    tradeType: 'virtual' | 'real',
    tradeCount: number = 1
  ) => {
    if (tradeType === 'virtual') {
      tradeCountsRef.current.virtual += tradeCount;
    } else {
      tradeCountsRef.current.real += tradeCount;
    }
    tradeCountsRef.current.total += tradeCount;
    setTradeCounts({ ...tradeCountsRef.current });

    const shouldEvolve = 
      tradeCountsRef.current.virtual >= VIRTUAL_TRADES_THRESHOLD ||
      tradeCountsRef.current.real >= REAL_TRADES_THRESHOLD;

    if (!shouldEvolve) return;

    setIsEvolving(true);
    setEvolutionProgress(10);
    
    const processedTradeCount = tradeCountsRef.current.total;
    tradeCountsRef.current = { virtual: 0, real: 0, total: 0 };
    setTradeCounts({ virtual: 0, real: 0, total: 0 });

    try {
      setEvolutionProgress(30);
      const sortedPerformance = [...performanceData].sort(
        (a, b) => (b.sharpeRatio || -Infinity) - (a.sharpeRatio || -Infinity)
      );

      const elitePerformers = sortedPerformance
        .slice(0, ELITE_COUNT)
        .filter(p => p.tradeHistory && p.tradeHistory.length >= MIN_TRADES_FOR_ANALYSIS);

      const worstPerformers = sortedPerformance
        .slice(-WORST_COUNT)
        .filter(p => p.tradeHistory && p.tradeHistory.length >= MIN_TRADES_FOR_ANALYSIS);

        if (elitePerformers.length === 0 || worstPerformers.length === 0 || elitePerformers[0].totalProfit <= 0) {
          setIsEvolving(false);
          return;
        }

      setEvolutionProgress(50);
      
      const newGeneration = currentGeneration + 1;
      const populationStats = performanceData.reduce((acc, p) => {
            acc.totalSharpe += p.sharpeRatio || 0;
            acc.totalWinRate += p.winRate || 0;
            acc.totalProfit += p.totalProfit || 0;
            return acc;
        }, { totalSharpe: 0, totalWinRate: 0, totalProfit: 0 });
        
      const newEvent: EvolutionEvent = {
        generation: newGeneration,
        timestamp: new Date(),
        elitePerformers: elitePerformers.map(({ id, strategyType, totalProfit, wins, losses, sharpeRatio }) => ({
          id, strategyType, totalProfit: totalProfit || 0, wins: wins || 0, losses: losses || 0, sharpeRatio: sharpeRatio || 0
        })),
        mutations: [],
        trigger: tradeType,
        tradeCount: processedTradeCount,
        populationStats: {
            avgSharpe: populationStats.totalSharpe / performanceData.length,
            avgWinRate: populationStats.totalWinRate / performanceData.length,
            totalProfit: populationStats.totalProfit,
            bestRegimes: [],
        },
      };

      const currentStrategies = [...evolvedStrategies];
      let strategiesChanged = false;

      setEvolutionProgress(70);

      worstPerformers.forEach((worst, index) => {
        const eliteParent = elitePerformers[index % elitePerformers.length];
        const worstIndex = currentStrategies.findIndex(s => (s as RobotStrategy).id === worst.id);
        if (worstIndex === -1) return;

        const regimeTrades = worst.tradeHistory.reduce((acc, trade) => {
          const regime = trade.regime || 'ranging';
          if (!acc[regime]) acc[regime] = { wins: 0, losses: 0 };
          if (trade.profit > 0) acc[regime].wins++;
          else acc[regime].losses++;
          return acc;
        }, {} as Record<MarketRegime, { wins: number; losses: number }>);

        let worstRegime: MarketRegime | null = null;
        let lowestWinRate = 50;
        let diagnosis = "Desempenho geral fraco.";

        for (const r in regimeTrades) {
          const regime = r as MarketRegime;
          const stats = regimeTrades[regime];
          const total = stats.wins + stats.losses;
          if (total > 2) {
            const winRate = (stats.wins / total) * 100;
            if (winRate < lowestWinRate) {
              lowestWinRate = winRate;
              worstRegime = regime;
            }
          }
        }

        if (worstRegime) {
          diagnosis = `Desempenho fraco (${lowestWinRate.toFixed(0)}% WR) em '${worstRegime}'.`;
        }

        const { strategy: newStrategyParams, parameters } = mutateStrategy(eliteParent.strategy, { worstRegime });
        const prescription = "Herda genes do robô de elite e ajusta parâmetros para o regime de falha.";
        const newJustification = `Gen ${newGeneration}: Mutação de ${eliteParent.strategyType}. Causa: ${diagnosis}`;
        
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
          diagnosis,
          prescription,
          expectedImprovement: `Melhorar performance em ${worstRegime || 'geral'}`,
          mutatedGenes: parameters,
        });
      });

      setEvolutionProgress(90);

      if (strategiesChanged) {
        setEvolvedStrategies(currentStrategies);
        
        setEvolutionHistory(prevHistory => {
            const updatedHistory = [newEvent, ...prevHistory];
            if (user) {
              saveEvolutionHistory(user.uid, updatedHistory, 'v3', assetSymbol).catch(error => {
                  console.error("❌ [EvolutionV3] Falha ao gravar histórico:", error);
                  toast({
                      title: "⚠️ Erro de Persistência",
                      description: "A evolução V3 ocorreu mas não foi salva no banco de dados.",
                      variant: "destructive",
                  });
              });
            }
            return updatedHistory;
        });

        setCurrentGeneration(newGeneration);

        toast({
          title: `🧬 Geração ${newGeneration} Completa`,
          description: `${newEvent.mutations.length} robôs evoluídos. Elite: ${elitePerformers[0].strategyType} (SR: ${elitePerformers[0].sharpeRatio?.toFixed(2)})`,
        });
      }

      setEvolutionProgress(100);
    } catch (error) {
      console.error('❌ [Evolution] Erro durante evolução:', error);
      toast({
        title: '❌ Erro na Evolução',
        description: 'Ocorreu um erro durante o processo de evolução genética.',
        variant: 'destructive'
      });
    } finally {
      setTimeout(() => {
        setIsEvolving(false);
        setEvolutionProgress(0);
      }, 1000);
    }
  }, [evolvedStrategies, evolutionHistory, currentGeneration, user, toast, assetSymbol]);

  const resetEvolutionHistory = useCallback(async () => {
    if (!user || !assetSymbol) return;
    try {
      await clearEvolutionHistory(user.uid, 'v3', assetSymbol);
      setEvolutionHistory([]);
      setCurrentGeneration(0);
      tradeCountsRef.current = { virtual: 0, real: 0, total: 0 };
      setTradeCounts({ virtual: 0, real: 0, total: 0 });
      toast({ title: '🗑️ Histórico V3 Resetado' });
    } catch (error) {
      toast({ title: '❌ Erro ao Resetar V3', variant: 'destructive' });
    }
  }, [user, toast, assetSymbol]);

  const deleteSingleEvolution = useCallback(async (eventTimestamp: string) => {
    if (!user || !assetSymbol) return;
    try {
      await deleteEvolutionEvent(user.uid, eventTimestamp, 'v3', assetSymbol);
      setEvolutionHistory(prev => prev.filter(e => e.timestamp.toISOString() !== eventTimestamp));
      toast({ title: '🗑️ Geração V3 Removida' });
    } catch (error) {
      toast({ title: '❌ Erro ao Deletar V3', variant: 'destructive' });
    }
  }, [user, toast, assetSymbol]);

  return {
    evolvedStrategies,
    evolveTrigger,
    evolutionHistory,
    isEvolving,
    evolutionProgress,
    currentGeneration,
    tradesUntilEvolution,
    tradeCounts,
    resetEvolutionHistory,
    deleteSingleEvolution,
  };
}
