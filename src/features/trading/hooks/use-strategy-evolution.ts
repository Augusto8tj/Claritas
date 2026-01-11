// /src/features/trading/hooks/use-strategy-evolution.ts
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

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================
const VIRTUAL_TRADES_THRESHOLD = 10; // ✅ 10 trades virtuais
const REAL_TRADES_THRESHOLD = 1;     // ✅ 1 trade real
const ELITE_COUNT = 3;
const WORST_COUNT = 3;
const MIN_TRADES_FOR_ANALYSIS = 5;

// ============================================================================
// INTERFACES
// ============================================================================
export interface EvolutionEvent {
  generation: number;           // ✅ NOVO: Número da geração
  timestamp: Date;
  elitePerformers: Pick<RobotPerformance, 'id' | 'strategyType' | 'totalProfit' | 'wins' | 'losses' | 'sharpeRatio'>[];
  mutations: {
    replacedBotId: string;
    replacedBotType: string;
    parentBotId: string;
    parentBotType: string;
    analysis: string;
    newParameters: Record<string, any>; // ✅ Registra os novos parâmetros
  }[];
  trigger: 'virtual' | 'real';  // ✅ NOVO: Qual tipo de trade acionou
  tradeCount: number;           // ✅ NOVO: Quantos trades foram processados
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
): { strategy: Omit<RobotStrategy, 'id' | 'justification'>; parameters: Record<string, any> } => {
  const newStrategy = { ...eliteRobot };
  const changedParams: Record<string, any> = {};

  const bigMutation = 1 + (Math.random() - 0.5) * 0.4; // ±20%
  const smallMutation = 1 + (Math.random() - 0.5) * 0.1; // ±5%
  const smallChange = Math.random() > 0.5 ? 1 : -1;

  // ✅ Mutação Direcionada por Regime
  if (analysis?.worstRegime === 'trending_bull' || analysis?.worstRegime === 'trending_bear') {
    if (newStrategy.period) {
      const oldPeriod = newStrategy.period;
      newStrategy.period = Math.max(5, Math.round(newStrategy.period * 0.8));
      changedParams.period = { old: oldPeriod, new: newStrategy.period, reason: 'Otimização para tendência' };
    }
  } else if (analysis?.worstRegime === 'ranging') {
    if (newStrategy.period) {
      const oldPeriod = newStrategy.period;
      newStrategy.period = Math.max(10, Math.round(newStrategy.period * 1.2));
      changedParams.period = { old: oldPeriod, new: newStrategy.period, reason: 'Otimização para lateral' };
    }
  }

  // Mutações gerais
  if (newStrategy.period && !changedParams.period) {
    const oldPeriod = newStrategy.period;
    newStrategy.period = Math.max(5, Math.round(newStrategy.period * smallMutation));
    if (oldPeriod !== newStrategy.period) {
      changedParams.period = { old: oldPeriod, new: newStrategy.period, reason: 'Ajuste fino' };
    }
  }

  if (newStrategy.strongBuyThreshold) {
    const oldThreshold = newStrategy.strongBuyThreshold;
    newStrategy.strongBuyThreshold = Math.max(5, Math.min(40, newStrategy.strongBuyThreshold + smallChange * 2));
    newStrategy.weakBuyThreshold = newStrategy.strongBuyThreshold + 10;
    if (oldThreshold !== newStrategy.strongBuyThreshold) {
      changedParams.buyThreshold = { old: oldThreshold, new: newStrategy.strongBuyThreshold };
    }
  }

  if (newStrategy.optimalDuration) {
    const oldDuration = newStrategy.optimalDuration;
    newStrategy.optimalDuration = Math.max(5, Math.round(newStrategy.optimalDuration * bigMutation));
    if (newStrategy.optimalDurationUnit === 't') {
      newStrategy.optimalDuration = Math.min(10, Math.max(5, newStrategy.optimalDuration));
    }
    if (oldDuration !== newStrategy.optimalDuration) {
      changedParams.duration = { old: oldDuration, new: newStrategy.optimalDuration };
    }
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
export function useStrategyEvolution(initialStrategies: Omit<RobotStrategy, 'id'>[]) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [evolvedStrategies, setEvolvedStrategies] = useState<Omit<RobotStrategy, 'id'>[]>(initialStrategies);
  const [evolutionHistory, setEvolutionHistory] = useState<EvolutionEvent[]>([]);
  
  // ✅ Estados de UI
  const [isEvolving, setIsEvolving] = useState(false);
  const [evolutionProgress, setEvolutionProgress] = useState(0);
  const [currentGeneration, setCurrentGeneration] = useState(0);

  // ✅ Contagem Dual
  const tradeCountsRef = useRef<TradeCounts>({ virtual: 0, real: 0, total: 0 });
  const [tradeCounts, setTradeCounts] = useState<TradeCounts>({ virtual: 0, real: 0, total: 0 });

  // ✅ Carrega histórico do Firestore ao montar
  useEffect(() => {
    if (!user) return;
    
    loadEvolutionHistory(user.uid)
      .then(history => {
        if (history.length > 0) {
          setEvolutionHistory(history);
          setCurrentGeneration(history[0].generation); // A geração mais recente
          console.log(`✅ [Evolution] Histórico carregado: ${history.length} gerações`);
        }
      })
      .catch(err => {
        console.error('❌ [Evolution] Erro ao carregar histórico:', err);
      });
  }, [user]);

  // ✅ Calcula trades até próxima evolução
  const tradesUntilEvolution = Math.min(
    VIRTUAL_TRADES_THRESHOLD - tradeCountsRef.current.virtual,
    REAL_TRADES_THRESHOLD - tradeCountsRef.current.real
  );

  // ============================================================================
  // FUNÇÃO DE EVOLUÇÃO
  // ============================================================================
  const evolveTrigger = useCallback(async (
    performanceData: RobotPerformance[],
    tradeType: 'virtual' | 'real',
    tradeCount: number = 1
  ) => {
    // ✅ Atualiza contadores
    if (tradeType === 'virtual') {
      tradeCountsRef.current.virtual += tradeCount;
    } else {
      tradeCountsRef.current.real += tradeCount;
    }
    tradeCountsRef.current.total += tradeCount;
    setTradeCounts({ ...tradeCountsRef.current });

    // ✅ Verifica se deve evoluir
    const shouldEvolve = 
      tradeCountsRef.current.virtual >= VIRTUAL_TRADES_THRESHOLD ||
      tradeCountsRef.current.real >= REAL_TRADES_THRESHOLD;

    if (!shouldEvolve) {
      return;
    }

    console.log(`[Evolution] 🧬 Acionando evolução (${tradeType}: ${tradeCount} trades)`);
    setIsEvolving(true);
    setEvolutionProgress(10);

    // ✅ Reseta contadores
    const processedTradeCount = tradeCountsRef.current.total;
    tradeCountsRef.current = { virtual: 0, real: 0, total: 0 };
    setTradeCounts({ virtual: 0, real: 0, total: 0 });

    try {
      // Análise de desempenho
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
        
      console.log(`
📊 [Evolution V3] Análise de Robôs:
   Total de robôs: ${performanceData.length}
   Elite (top ${ELITE_COUNT}): ${elitePerformers.length}
   Piores (bottom ${WORST_COUNT}): ${worstPerformers.length}
   
   Elite IDs: ${elitePerformers.map(e => e.id).join(', ')}
   Piores IDs: ${worstPerformers.map(w => w.id).join(', ')}
        `);
          
        if (elitePerformers.length === 0) {
          console.warn('❌ [Evolution V3] ABORTADO: Nenhum robô de elite com dados suficientes');
          setIsEvolving(false);
          return { real: 0, virtual: 0 };
        }
        
        if (worstPerformers.length === 0) {
          console.warn('❌ [Evolution V3] ABORTADO: Nenhum robô pior com dados suficientes');
          setIsEvolving(false);
          return { real: 0, virtual: 0 };
        }
        
        if (elitePerformers[0].totalProfit <= 0) {
          console.warn('❌ [Evolution V3] ABORTADO: Elite não é lucrativa');
          console.log(`   Elite #1: ${elitePerformers[0].strategyType} com lucro ${elitePerformers[0].totalProfit}`);
          setIsEvolving(false);
          return { real: 0, virtual: 0 };
        }


      setEvolutionProgress(50);

      // ✅ Cria novo evento com geração
      const newGeneration = currentGeneration + 1;
      const newEvent: EvolutionEvent = {
        generation: newGeneration,
        timestamp: new Date(),
        elitePerformers: elitePerformers.map(({ id, strategyType, totalProfit, wins, losses, sharpeRatio }) => ({
          id, strategyType, totalProfit: totalProfit || 0, wins: wins || 0, losses: losses || 0, sharpeRatio: sharpeRatio || 0
        })),
        mutations: [],
        trigger: tradeType,
        tradeCount: processedTradeCount,
      };

      const currentStrategies = [...evolvedStrategies];
      let strategiesChanged = false;

      setEvolutionProgress(70);

      // ✅ Realiza mutações
      worstPerformers.forEach((worst, index) => {
        const eliteParent = elitePerformers[index % elitePerformers.length];
        const worstIndex = currentStrategies.findIndex(s => (s as RobotStrategy).id === worst.id);
        if (worstIndex === -1) return;

        // Análise de causa-raiz
        const regimeTrades = worst.tradeHistory.reduce((acc, trade) => {
          const regime = trade.regime || 'ranging';
          if (!acc[regime]) acc[regime] = { wins: 0, losses: 0 };
          if (trade.profit > 0) acc[regime].wins++;
          else acc[regime].losses++;
          return acc;
        }, {} as Record<MarketRegime, { wins: number; losses: number }>);

        let worstRegime: MarketRegime | null = null;
        let lowestWinRate = 50;
        let analysis = 'Mutação geral baseada em elite.';

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
          analysis = `Desempenho fraco (${lowestWinRate.toFixed(0)}% WR) em '${worstRegime}'. Ajustando parâmetros.`;
        }

        const { strategy: newStrategyParams, parameters } = mutateStrategy(eliteParent.strategy, { worstRegime });
        const newJustification = `Gen ${newGeneration}: Mutação de ${eliteParent.strategyType}. ${analysis}`;

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
          newParameters: parameters,
        });

        console.log(`[Evolution] 🔄 ${worst.id} → ${eliteParent.id} | ${analysis}`);
      });

      setEvolutionProgress(90);

      if (strategiesChanged) {
        setEvolvedStrategies(currentStrategies);
        
        // ✅ ATOMIC WRITE: Atualiza estado e salva em uma única operação lógica
        setEvolutionHistory(prevHistory => {
            const updatedHistory = [newEvent, ...prevHistory];
            if (user) {
                saveEvolutionHistory(user.uid, updatedHistory).catch(error => {
                    console.error("❌ [EvolutionV3] Falha ao gravar histórico no Firestore:", error);
                    toast({
                        title: "⚠️ Erro de Persistência",
                        description: "A evolução ocorreu mas não foi salva no banco de dados.",
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
  }, [evolvedStrategies, evolutionHistory, currentGeneration, user, toast]);

  // ============================================================================
  // FUNÇÕES DE GERENCIAMENTO
  // ============================================================================
  const resetEvolutionHistory = useCallback(async () => {
    if (!user) return;
    
    try {
      await clearEvolutionHistory(user.uid);
      setEvolutionHistory([]);
      setCurrentGeneration(0);
      tradeCountsRef.current = { virtual: 0, real: 0, total: 0 };
      setTradeCounts({ virtual: 0, real: 0, total: 0 });
      
      toast({
        title: '🗑️ Histórico Resetado',
        description: 'Todo o histórico de evolução foi apagado.',
      });
      
      console.log('✅ [Evolution] Histórico resetado');
    } catch (error) {
      console.error('❌ [Evolution] Erro ao resetar:', error);
      toast({
        title: '❌ Erro ao Resetar',
        description: 'Não foi possível apagar o histórico.',
        variant: 'destructive'
      });
    }
  }, [user, toast]);

  const deleteSingleEvolution = useCallback(async (eventTimestamp: string) => {
    if (!user) return;
    
    try {
      await deleteEvolutionEvent(user.uid, eventTimestamp);
      
      const updatedHistory = evolutionHistory.filter(
        e => e.timestamp.toISOString() !== eventTimestamp
      );
      setEvolutionHistory(updatedHistory);
      
      toast({
        title: '🗑️ Geração Removida',
        description: 'O evento de evolução foi deletado.',
      });
      
      console.log('✅ [Evolution] Evento deletado:', eventTimestamp);
    } catch (error) {
      console.error('❌ [Evolution] Erro ao deletar evento:', error);
      toast({
        title: '❌ Erro ao Deletar',
        description: 'Não foi possível remover o evento.',
        variant: 'destructive'
      });
    }
  }, [user, evolutionHistory, toast]);

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
