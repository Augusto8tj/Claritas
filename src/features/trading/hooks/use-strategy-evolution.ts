// /src/features/trading/hooks/use-strategy-evolution.ts
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RobotStrategy, EnhancedRobotPerformance as RobotPerformance, MarketRegime } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { loadEvolutionHistory, saveEvolutionHistory } from '@/services/financial-data-service';

// ============================================================================
// PARÂMETROS DA EVOLUÇÃO V3.0 (OTIMIZADOS PARA ALTA FREQUÊNCIA)
// ============================================================================
const EVOLUTION_CONFIG = {
  // ✅ REDUZIDO: De 10 para 5 trades totais (virtual + real)
  TRIGGER_THRESHOLD: 5,
  
  // Número de robôs de elite (top performers)
  ELITE_COUNT: 3,
  
  // Número de robôs a serem substituídos
  WORST_COUNT: 3,
  
  // Mínimo de trades para análise profunda
  MIN_TRADES_FOR_DEEP_ANALYSIS: 3,
  
  // Taxa de mutação (0.1 = 10% de mudança nos parâmetros)
  MUTATION_RATE: 0.15,
  
  // Força da mutação direcionada (maior = mais agressivo na correção)
  DIRECTED_MUTATION_STRENGTH: 0.3,
};

// ============================================================================
// TIPOS AVANÇADOS PARA ANÁLISE
// ============================================================================

interface TradeAnalysis {
  regime: MarketRegime;
  won: boolean;
  profit: number;
  timestamp: number;
}

interface RegimePerformance {
  regime: MarketRegime;
  wins: number;
  losses: number;
  totalTrades: number;
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  profitFactor: number;
}

interface RobotDNA {
  // Genoma do robô (parâmetros que podem ser mutados)
  period?: number;
  shortPeriod?: number;
  longPeriod?: number;
  strongBuyThreshold?: number;
  strongSellThreshold?: number;
  optimalDuration: number;
  optimalDurationUnit: 't' | 's' | 'm' | 'h' | 'd';
}

interface MutationPlan {
  robotId: string;
  robotType: string;
  parentId: string;
  parentType: string;
  diagnosis: string;
  prescription: string;
  expectedImprovement: string;
  mutatedGenes: string[];
}

export interface EvolutionEvent {
  timestamp: Date;
  generation: number;
  totalTrades: number;
  elitePerformers: {
    id: string;
    strategyType: string;
    sharpeRatio: number;
    winRate: number;
    totalProfit: number;
    effectiveRegimes: MarketRegime[];
  }[];
  mutations: MutationPlan[];
  populationStats: {
    avgSharpe: number;
    avgWinRate: number;
    totalProfit: number;
    bestRegimes: MarketRegime[];
  };
}

// ============================================================================
// ANALISADOR PROFUNDO DE PERFORMANCE POR REGIME
// ============================================================================

const analyzeRegimePerformance = (
  trades: { profit: number; regime: MarketRegime; timestamp: number }[]
): RegimePerformance[] => {
  
  const regimeMap = new Map<MarketRegime, TradeAnalysis[]>();
  
  // Agrupa trades por regime
  trades.forEach(t => {
    if (!regimeMap.has(t.regime)) {
      regimeMap.set(t.regime, []);
    }
    regimeMap.get(t.regime)!.push({
      regime: t.regime,
      won: t.profit > 0,
      profit: t.profit,
      timestamp: t.timestamp,
    });
  });
  
  // Calcula estatísticas por regime
  const results: RegimePerformance[] = [];
  
  regimeMap.forEach((trades, regime) => {
    const wins = trades.filter(t => t.won).length;
    const losses = trades.length - wins;
    const totalTrades = trades.length;
    const winRate = (wins / totalTrades) * 100;
    
    const profits = trades.filter(t => t.won).map(t => t.profit);
    const lossesPnL = trades.filter(t => !t.won).map(t => Math.abs(t.profit));
    
    const avgProfit = profits.length > 0 
      ? profits.reduce((sum, p) => sum + p, 0) / profits.length 
      : 0;
    
    const avgLoss = lossesPnL.length > 0 
      ? lossesPnL.reduce((sum, l) => sum + l, 0) / lossesPnL.length 
      : 0;
    
    const totalProfitSum = profits.reduce((sum, p) => sum + p, 0);
    const totalLossSum = lossesPnL.reduce((sum, l) => sum + l, 0);
    
    const profitFactor = totalLossSum > 0 ? totalProfitSum / totalLossSum : 0;
    
    results.push({
      regime,
      wins,
      losses,
      totalTrades,
      winRate,
      avgProfit,
      avgLoss,
      profitFactor,
    });
  });
  
  return results.sort((a, b) => a.winRate - b.winRate); // Pior regime primeiro
};

// ============================================================================
// DIAGNOSTICADOR INTELIGENTE (IA de Análise)
// ============================================================================

const diagnoseRobot = (
  robot: RobotPerformance
): {
  diagnosis: string;
  worstRegime: MarketRegime | null;
  bestRegime: MarketRegime | null;
  rootCause: string;
  recommendation: string;
} => {
  
  if (!robot.tradeHistory || robot.tradeHistory.length < EVOLUTION_CONFIG.MIN_TRADES_FOR_DEEP_ANALYSIS) {
    return {
      diagnosis: 'Dados insuficientes',
      worstRegime: null,
      bestRegime: null,
      rootCause: 'Menos de 3 trades executados',
      recommendation: 'Aguardar mais dados antes de mutar',
    };
  }
  
  const regimePerf = analyzeRegimePerformance(robot.tradeHistory);
  
  if (regimePerf.length === 0) {
    return {
      diagnosis: 'Sem dados de regime',
      worstRegime: null,
      bestRegime: null,
      rootCause: 'Nenhum trade registrado com contexto de regime',
      recommendation: 'Verificar sistema de regime detection',
    };
  }
  
  const worstRegime = regimePerf[0]; // Primeiro = pior win rate
  const bestRegime = regimePerf[regimePerf.length - 1]; // Último = melhor
  
  let rootCause = '';
  let recommendation = '';
  
  // Análise de Causa Raiz
  if (worstRegime.winRate < 40) {
    if (worstRegime.regime === 'trending_bull' || worstRegime.regime === 'trending_bear') {
      rootCause = `Incapaz de acompanhar tendências (${worstRegime.winRate.toFixed(0)}% WR em ${worstRegime.regime})`;
      recommendation = 'Reduzir período dos indicadores (tornar mais reativo)';
    } else if (worstRegime.regime === 'ranging') {
      rootCause = `Gera falsos sinais em mercado lateral (${worstRegime.winRate.toFixed(0)}% WR)`;
      recommendation = 'Aumentar período dos indicadores (filtrar ruído)';
    } else if (worstRegime.regime === 'high_volatility') {
      rootCause = `Não se adapta a alta volatilidade (${worstRegime.winRate.toFixed(0)}% WR)`;
      recommendation = 'Encurtar duração dos trades e aumentar thresholds';
    } else if (worstRegime.regime === 'breakout') {
      rootCause = `Perde oportunidades de breakout (${worstRegime.winRate.toFixed(0)}% WR)`;
      recommendation = 'Reduzir duração e tornar thresholds mais agressivos';
    }
  } else if (worstRegime.profitFactor < 1.0) {
    rootCause = `Profit Factor baixo (${worstRegime.profitFactor.toFixed(2)}) em ${worstRegime.regime}`;
    recommendation = 'Ajustar risk-reward: reduzir stake ou aumentar duração';
  }
  
  return {
    diagnosis: `Fraco em ${worstRegime.regime} (${worstRegime.wins}W/${worstRegime.losses}L)`,
    worstRegime: worstRegime.regime,
    bestRegime: bestRegime.regime,
    rootCause,
    recommendation,
  };
};

// ============================================================================
// MUTADOR CIRÚRGICO (Mutação Direcionada)
// ============================================================================

const performDirectedMutation = (
  eliteRobot: RobotStrategy,
  diagnosis: {
    worstRegime: MarketRegime | null;
    bestRegime: MarketRegime | null;
    rootCause: string;
    recommendation: string;
  }
): { mutatedDNA: Partial<RobotStrategy>; mutatedGenes: string[] } => {
  
  const mutatedDNA: Partial<RobotStrategy> = { ...eliteRobot };
  const mutatedGenes: string[] = [];
  const strength = EVOLUTION_CONFIG.DIRECTED_MUTATION_STRENGTH;
  
  // ────────────────────────────────────────────────────────────────
  // MUTAÇÃO DIRECIONADA POR REGIME
  // ────────────────────────────────────────────────────────────────
  
  if (diagnosis.worstRegime === 'trending_bull' || diagnosis.worstRegime === 'trending_bear') {
    // Torna o robô mais RÁPIDO (menor período)
    if (mutatedDNA.period) {
      mutatedDNA.period = Math.max(5, Math.round(mutatedDNA.period * (1 - strength)));
      mutatedGenes.push('period↓ (mais reativo a tendências)');
    }
    if (mutatedDNA.shortPeriod) {
      mutatedDNA.shortPeriod = Math.max(3, Math.round(mutatedDNA.shortPeriod * (1 - strength)));
      mutatedGenes.push('shortPeriod↓');
    }
    if (mutatedDNA.optimalDuration > 30) {
      mutatedDNA.optimalDuration = Math.round(mutatedDNA.optimalDuration * 0.8);
      mutatedGenes.push('duration↓ (trades mais curtos)');
    }
  }
  
  else if (diagnosis.worstRegime === 'ranging') {
    // Torna o robô mais LENTO (maior período = filtra ruído)
    if (mutatedDNA.period) {
      mutatedDNA.period = Math.round(mutatedDNA.period * (1 + strength));
      mutatedGenes.push('period↑ (filtra ruído lateral)');
    }
    if (mutatedDNA.longPeriod) {
      mutatedDNA.longPeriod = Math.round(mutatedDNA.longPeriod * (1 + strength));
      mutatedGenes.push('longPeriod↑');
    }
    // Thresholds mais conservadores
    if (mutatedDNA.strongBuyThreshold) {
      mutatedDNA.strongBuyThreshold = Math.max(15, mutatedDNA.strongBuyThreshold - 5);
      mutatedGenes.push('buyThreshold↓ (mais conservador)');
    }
    if (mutatedDNA.strongSellThreshold) {
      mutatedDNA.strongSellThreshold = Math.min(95, mutatedDNA.strongSellThreshold + 5);
      mutatedGenes.push('sellThreshold↑ (mais conservador)');
    }
  }
  
  else if (diagnosis.worstRegime === 'high_volatility') {
    // Encurta duração drasticamente
    if (mutatedDNA.optimalDuration > 15) {
      mutatedDNA.optimalDuration = Math.max(15, Math.round(mutatedDNA.optimalDuration * 0.6));
      mutatedGenes.push('duration↓↓ (sai rápido da volatilidade)');
    }
    // Thresholds mais extremos (só entra em sinais fortes)
    if (mutatedDNA.strongBuyThreshold) {
      mutatedDNA.strongBuyThreshold = Math.max(10, mutatedDNA.strongBuyThreshold - 10);
      mutatedGenes.push('buyThreshold↓↓ (sinais mais extremos)');
    }
  }
  
  else if (diagnosis.worstRegime === 'breakout') {
    // Torna mais agressivo
    if (mutatedDNA.optimalDuration > 20) {
      mutatedDNA.optimalDuration = Math.round(mutatedDNA.optimalDuration * 0.7);
      mutatedGenes.push('duration↓ (captura breakout rápido)');
    }
    if (mutatedDNA.strongBuyThreshold) {
      mutatedDNA.strongBuyThreshold = Math.min(35, mutatedDNA.strongBuyThreshold + 5);
      mutatedGenes.push('buyThreshold↑ (mais agressivo)');
    }
  }
  
  // ────────────────────────────────────────────────────────────────
  // MUTAÇÃO ALEATÓRIA LEVE (10% de chance)
  // ────────────────────────────────────────────────────────────────
  
  if (Math.random() < 0.1 && mutatedDNA.optimalDuration) {
    const randomFactor = 1 + (Math.random() - 0.5) * 0.2; // ±10%
    mutatedDNA.optimalDuration = Math.round(mutatedDNA.optimalDuration * randomFactor);
    mutatedGenes.push('duration (mutação aleatória)');
  }
  
  // Garante que nenhum gene ficou sem valor
  if (mutatedGenes.length === 0) {
    mutatedGenes.push('clone (sem mutações necessárias)');
  }
  
  return { mutatedDNA, mutatedGenes };
};

// ============================================================================
// HOOK PRINCIPAL DE EVOLUÇÃO V3.0
// ============================================================================

export function useStrategyEvolution(initialStrategies: Omit<RobotStrategy, 'id'>[]) {
  const { toast } = useToast();
  const { user, loading: isAuthLoading } = useAuth();
  
  const [evolvedStrategies, setEvolvedStrategies] = useState<Omit<RobotStrategy, 'id'>[]>(initialStrategies);
  const [evolutionHistory, setEvolutionHistory] = useState<EvolutionEvent[]>([]);
  
  const tradeCountRef = useRef(0);
  const generationRef = useRef(0);
  const lastEvolutionTimeRef = useRef(Date.now());
  
  const [isEvolving, setIsEvolving] = useState(false);
  const [evolutionProgress, setEvolutionProgress] = useState(0);

  // Carrega o histórico do Firestore na inicialização
  useEffect(() => {
    if (!user || isAuthLoading) return;
    
    const loadHistory = async () => {
        try {
            const storedHistory = await loadEvolutionHistory(user.uid);
            if (storedHistory && storedHistory.length > 0) {
                setEvolutionHistory(storedHistory);
                generationRef.current = storedHistory[0]?.generation || 0;
            }
        } catch (error) {
            console.error("[EvolutionV3] Falha ao carregar histórico:", error);
        }
    };
    
    loadHistory();
  }, [user, isAuthLoading]);

  const evolveTrigger = useCallback((performanceData: RobotPerformance[]) => {
    tradeCountRef.current += 1;
    
    if (tradeCountRef.current < EVOLUTION_CONFIG.TRIGGER_THRESHOLD) {
      return;
    }

    tradeCountRef.current = 0;
    generationRef.current++;
    setIsEvolving(true);
    setEvolutionProgress(0);

    const sortedPerformance = [...performanceData].sort((a, b) => {
      const sharpeA = a.sharpeRatio || -Infinity;
      const sharpeB = b.sharpeRatio || -Infinity;
      if (Math.abs(sharpeA - sharpeB) < 0.1) {
        return (b.winRate || 0) - (a.winRate || 0);
      }
      return sharpeB - sharpeA;
    });

    setEvolutionProgress(20);
    
    const elitePerformers = sortedPerformance
      .slice(0, EVOLUTION_CONFIG.ELITE_COUNT)
      .filter(p => p.tradeHistory && p.tradeHistory.length >= EVOLUTION_CONFIG.MIN_TRADES_FOR_DEEP_ANALYSIS);

    const worstPerformers = sortedPerformance
      .slice(-EVOLUTION_CONFIG.WORST_COUNT)
      .filter(p => p.tradeHistory && p.tradeHistory.length >= EVOLUTION_CONFIG.MIN_TRADES_FOR_DEEP_ANALYSIS);

    if (elitePerformers.length === 0 || worstPerformers.length === 0 || elitePerformers[0].totalProfit <= 0) {
      setIsEvolving(false);
      return;
    }

    setEvolutionProgress(40);
    
    const newEvent: EvolutionEvent = {
      timestamp: new Date(),
      generation: generationRef.current,
      totalTrades: performanceData.reduce((sum, p) => sum + (p.wins + p.losses), 0),
      elitePerformers: elitePerformers.map(e => ({
        id: e.id,
        strategyType: e.strategyType,
        sharpeRatio: e.sharpeRatio || 0,
        winRate: e.winRate || 0,
        totalProfit: e.totalProfit || 0,
        effectiveRegimes: e.effectiveRegimes || [],
      })),
      mutations: [],
      populationStats: {
        avgSharpe: performanceData.reduce((sum, p) => sum + (p.sharpeRatio || 0), 0) / performanceData.length,
        avgWinRate: performanceData.reduce((sum, p) => sum + (p.winRate || 0), 0) / performanceData.length,
        totalProfit: performanceData.reduce((sum, p) => sum + (p.totalProfit || 0), 0),
        bestRegimes: [],
      },
    };

    const currentStrategies = [...evolvedStrategies];
    let strategiesChanged = false;

    setEvolutionProgress(60);

    worstPerformers.forEach((worst, index) => {
      const eliteParent = elitePerformers[index % elitePerformers.length];
      const worstIndex = currentStrategies.findIndex(s => (s as RobotStrategy).id === worst.id);
      
      if (worstIndex === -1) return;

      const diagnosis = diagnoseRobot(worst);
      const { mutatedDNA, mutatedGenes } = performDirectedMutation(
        eliteParent.strategy,
        diagnosis
      );

      const newJustification = `Gen ${generationRef.current}: Clone de ${eliteParent.strategyType}. ${diagnosis.rootCause}. Ajuste: ${mutatedGenes.join(', ')}.`;

      currentStrategies[worstIndex] = {
        ...currentStrategies[worstIndex],
        ...mutatedDNA,
        justification: newJustification,
      };

      strategiesChanged = true;

      newEvent.mutations.push({
        robotId: worst.id,
        robotType: worst.strategyType,
        parentId: eliteParent.id,
        parentType: eliteParent.strategyType,
        diagnosis: diagnosis.diagnosis,
        prescription: diagnosis.recommendation,
        expectedImprovement: `Alvo: ${diagnosis.worstRegime} (${diagnosis.rootCause})`,
        mutatedGenes,
      });
    });

    setEvolutionProgress(80);

    if (strategiesChanged) {
        const newHistory = [newEvent, ...evolutionHistory];
        setEvolvedStrategies(currentStrategies);
        setEvolutionHistory(newHistory);
        if (user) {
            saveEvolutionHistory(user.uid, newHistory);
        }

      const timeSinceLastEvolution = (Date.now() - lastEvolutionTimeRef.current) / 1000;
      lastEvolutionTimeRef.current = Date.now();

      toast({
        title: `🧬 Geração ${generationRef.current} Completa`,
        description: `${newEvent.mutations.length} robôs evoluídos. Elite: ${elitePerformers[0].strategyType} (Sharpe ${elitePerformers[0].sharpeRatio?.toFixed(2)}). Tempo: ${timeSinceLastEvolution.toFixed(0)}s`,
        duration: 5000,
      });
    }

    setEvolutionProgress(100);
    setTimeout(() => setIsEvolving(false), 1000);

  }, [evolvedStrategies, toast, user, evolutionHistory]);

  return {
    evolvedStrategies,
    evolveTrigger,
    evolutionHistory,
    isEvolving,
    evolutionProgress,
    currentGeneration: generationRef.current,
    tradesUntilEvolution: Math.max(0, EVOLUTION_CONFIG.TRIGGER_THRESHOLD - tradeCountRef.current),
  };
}
