'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApi } from './use-deriv-api';
import { useToast } from './use-toast';
import type { RobotStrategy, DurationUnit, ChartData, TickData, CandleData, Operation, RobotPerformance as RobotPerformanceType, RobotVote as RobotVoteType, MarketRegime, MicrostructureFeatures, BayesianVote, EnhancedRobotPerformance } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance } from '@/services/financial-data-service';
import { useStrategyEvolution } from './use-strategy-evolution';
import { initialCouncilStrategies } from '@/services/council-strategies';
import { detectMarketRegime, calculateKellyStake, bayesianUpdate, calibrateConfidence, calculatePerformanceMetrics, monteCarloValidation, extractMicrostructureFeatures, analyzeStrategyByRegime } from '@/services/advanced-trading-services';

// --- CONSTANTES ---
const VIRTUAL_STAKE = 1.0;
const KELLY_FRACTION = 0.25;
const MIN_SHARPE_RATIO = 1.5;
const MONTE_CARLO_ITERATIONS = 1000;
const REGIME_LOOKBACK = 50;
const MICROSTRUCTURE_WINDOW = 20;
const MIN_TRADES_FOR_STATS = 30;

const REGIME_THRESHOLDS = {
  ADX_TREND: 25,
  ADX_WEAK: 20,
  BBW_HIGH_VOL: 0.1,
  RANGE_BREAK: 2.0,
};

type VirtualTrade = {
  id: string;
  robotId: string;
  vote: 'RISE' | 'FALL';
  entryPrice: number;
  entryEpoch: number;
  exitEpoch: number;
  regime: MarketRegime;
  microstructure: MicrostructureFeatures;
  stake: number;
};

// --- HOOK ---
export function useRobotCouncilV2(
  activeSymbol: string | null,
  priceTicks: TickData[]
) {
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits, sellContract } = useDerivApi();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);

  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>(evolvedStrategies as RobotStrategy[]);
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
  
  const [currentRegime, setCurrentRegime] = useState<{
    regime: MarketRegime;
    confidence: number;
  }>({
    regime: 'ranging',
    confidence: 0.5,
  });
  
  const [microstructure, setMicrostructure] = useState<MicrostructureFeatures | null>(null);
  const [robotPerformance, setRobotPerformance] = useState<EnhancedRobotPerformance[]>([]);
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  const tradeCounterRef = useRef(0);
  const transitionMatrixRef = useRef<number[][] | undefined>(undefined);

  const [dailyBalance, setDailyBalance] = useState(100);
  const [dailyTarget, setDailyTarget] = useState(50);
  
  const [consensusDecision, setConsensusDecision] = useState<{
    direction: 'RISE' | 'FALL' | 'HOLD';
    probability: number;
    stake: number;
  }>({
    direction: 'HOLD',
    probability: 0.5,
    stake: 0
  });

  const [portfolioStats, setPortfolioStats] = useState({
    totalExposure: 0,
    maxExposure: dailyBalance * 0.3,
    currentDrawdown: 0,
    maxDrawdown: 0,
    dailyPnL: 0
  });

  const councilExecutionRef = useRef<{ 
    isExecuting: boolean;
    sellingContracts: Set<number>;
  }>({ 
    isExecuting: false, 
    sellingContracts: new Set() 
  });

  const tickCandles = useMemo(() => {
    if (!priceTicks || priceTicks.length === 0) return [];
    return priceTicks.map((t) => ({ 
      epoch: t.epoch, 
      open: t.price, 
      high: t.price, 
      low: t.price, 
      close: t.price, 
      volume: 1 
    }));
  }, [priceTicks]);

  useEffect(() => {
    setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
  }, [evolvedStrategies]);

  useEffect(() => {
    if (!user || isAuthLoading) return;
    
    loadRobotPerformance(user.uid)
      .then((stored) => {
        if (stored && stored.length > 0) {
          const enhanced: EnhancedRobotPerformance[] = (stored as any[]).map(p => ({
            ...p,
            sharpeRatio: p.sharpeRatio || 0,
            maxDrawdown: p.maxDrawdown || 0,
            avgWin: p.avgWin || 0,
            avgLoss: p.avgLoss || 0,
            profitFactor: p.profitFactor || 0,
            kellyFraction: p.kellyFraction || 0,
            effectiveRegimes: p.effectiveRegimes || ['ranging'],
            monteCarloScore: p.monteCarloScore || 0,
            lastUpdated: p.lastUpdated || Date.now(),
            tradeHistory: []
          }));
          setRobotPerformance(enhanced);
        }
      })
      .catch(err => console.error("Erro ao carregar performance", err));
  }, [user, isAuthLoading]);

  const fetchStrategyCouncil = useCallback(async () => {
    // ... (função igual ao artefato)
  }, [activeSymbol, user, toast, robotPerformance, evolvedStrategies]);

  const dissolveCouncil = () => {
    // ... (função igual ao artefato)
  };

  useEffect(() => {
    // Validações
    if (!isConnected || !user || !isCouncilAutopilotOn || 
        strategyCouncil.length === 0 || !activeSymbol || 
        tickCandles.length < REGIME_LOOKBACK) {
      return;
    }
    const currentTick = priceTicks[priceTicks.length - 1];
    
    // Análise
    const currentIndicators = calculateAllIndicators(tickCandles, strategyCouncil, timePeriod);
    if (!currentIndicators) return;

    const regimeResult = detectMarketRegime(tickCandles, currentIndicators, currentRegime.regime, transitionMatrixRef.current);
    setCurrentRegime({ regime: regimeResult.regime, confidence: regimeResult.confidence });
    transitionMatrixRef.current = regimeResult.transitionMatrix;

    const microFeatures = extractMicrostructureFeatures(priceTicks, tickCandles);
    setMicrostructure(microFeatures);

    // Gestão de posições abertas
    // ...

    // Arena Virtual
    // ...

    // Votação Bayesiana
    // ...

    // Consenso
    // ...

    // Gestão de Risco
    // ...

    // Execução
    // ...
  }, [
    // Dependências
    priceTicks,
    isConnected,
    isCouncilAutopilotOn,
    // ... etc
  ]);

  return {
    isCouncilAutopilotOn, setIsCouncilAutopilotOn,
    robotPerformance, evolutionHistory,
    currentRegime, microstructure,
    consensusDecision, portfolioStats,
    dailyBalance, setDailyBalance,
    dailyTarget, setDailyTarget,
    fetchStrategyCouncil, dissolveCouncil,
    //...
  };
}
