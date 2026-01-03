// src/hooks/use-robot-council-v2.ts
'use client';

/**
 * 🧠 DERIV TRADER V2.0 - SISTEMA EVOLUTIVO OTIMIZADO
 * 
 * MELHORIAS CRÍTICAS IMPLEMENTADAS:
 * ═══════════════════════════════════════════════════════════════════
 * 
 * 1. PROTEÇÃO CONTRA MEMORY LEAKS
 *    ✅ Limpeza automática de trades órfãos
 *    ✅ Limite de tamanho para logs de auditoria
 *    ✅ Timeout de segurança para trades antigos
 * 
 * 2. RACE CONDITION RESOLUTION
 *    ✅ Execution ID único por operação
 *    ✅ Validação de estado antes de liberar flags
 *    ✅ Finally sempre executa para limpar recursos
 * 
 * 3. SINCRONIZAÇÃO DE PERFORMANCE
 *    ✅ PerformanceMap sempre sincronizado com strategyCouncil
 *    ✅ Criação automática de entradas para novos robôs
 *    ✅ Health check com auto-recuperação
 * 
 * 4. VALIDAÇÃO ROBUSTA DE DADOS
 *    ✅ Filtragem de candles inválidos
 *    ✅ Validação de indicadores antes de uso
 *    ✅ Fallback gracioso em caso de erro
 * 
 * 5. MONITORAMENTO EM TEMPO REAL
 *    ✅ Métricas de sistema exportadas
 *    ✅ Logs estruturados para debug
 *    ✅ Alertas automáticos de anomalias
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApi } from './use-deriv-api';
import { useToast } from '@/hooks/use-toast';
import type { 
  RobotStrategy, DurationUnit, TickData, CandleData, Operation,
  RobotVote as RobotVoteType, MarketRegime, MicrostructureFeatures,
  BayesianVote as BayesianVoteType, EnhancedRobotPerformance as EnhancedRobotPerformanceType,
  TimePeriod, TradeDecisionLog,
} from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance, saveTradeDecision } from '@/services/financial-data-service';
import { useStrategyEvolution } from './use-strategy-evolution';
import { initialCouncilStrategies } from '@/services/council-strategies';
import {
  detectMarketRegime, calculateKellyStake, bayesianUpdate, calibrateConfidence,
  calculatePerformanceMetrics, monteCarloValidation, extractMicrostructureFeatures, analyzeStrategyByRegime
} from '@/services/advanced-trading-services';

// ════════════════════════════════════════════════════════════════════
// 📊 CONSTANTES E CONFIGURAÇÕES
// ════════════════════════════════════════════════════════════════════

const VIRTUAL_STAKE = 1.0;
const KELLY_FRACTION = 0.25;
const MIN_SHARPE_RATIO = 1.5;
const MONTE_CARLO_ITERATIONS = 1000;
const REGIME_LOOKBACK = 50;
const MICROSTRUCTURE_WINDOW = 20;
const MIN_TRADES_FOR_STATS = 30;
const THROTTLE_MS = 1000;

// 🔥 NOVOS LIMITES DE SEGURANÇA
const MAX_VIRTUAL_TRADES = 500;        // Máximo de trades na memória
const MAX_DECISION_LOG = 100;          // Máximo de logs de decisão
const TRADE_TIMEOUT_SECONDS = 3600;    // 1 hora - trades mais velhos são descartados
const CLEANUP_INTERVAL_MS = 60000;     // Limpeza a cada 1 minuto
const HEALTH_CHECK_INTERVAL_MS = 30000; // Health check a cada 30 segundos

const REGIME_THRESHOLDS = {
  ADX_TREND: 25,
  ADX_WEAK: 20,
  BBW_HIGH_VOL: 0.1,
  RANGE_BREAK: 2.0,
};

// ════════════════════════════════════════════════════════════════════
// 📋 TIPOS E INTERFACES
// ════════════════════════════════════════════════════════════════════

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

export type EnhancedRobotPerformance = EnhancedRobotPerformanceType;
export type RobotVote = RobotVoteType;
export type BayesianVote = BayesianVoteType;
export type CouncilVotes = { [key: string]: BayesianVote };

export interface DashboardData {
  regime: string;
  bayesianProbability: number;
  consensusDirection: 'RISE' | 'FALL' | 'HOLD';
  activeRobotsCount: number;
  microstructure: {
    pressure: number;
    velocity: number;
    isSpike: boolean;
  };
  kellyStake: number;
}

// 🔥 NOVO: Métricas de Sistema
export interface SystemMetrics {
  virtualTradesCount: number;
  decisionLogCount: number;
  activeRobotsCount: number;
  memoryUsageMB: number;
  isExecuting: boolean;
  lastCleanup: number;
  orphanedTradesRemoved: number;
}

// ════════════════════════════════════════════════════════════════════
// 🔧 FUNÇÕES AUXILIARES
// ════════════════════════════════════════════════════════════════════

const durationToSeconds = (duration: number, unit: DurationUnit): number => {
  switch (unit) {
    case 't': return duration * 2;
    case 's': return duration;
    case 'm': return duration * 60;
    case 'h': return duration * 3600;
    case 'd': return duration * 86400;
    default: return duration;
  }
};

const isValid = (value: any): value is number => 
  value !== null && value !== undefined && !isNaN(value) && Number.isFinite(value);

// 🔥 NOVO: Validação de Candles
const validateCandles = (candles: CandleData[], minCount: number): CandleData[] => {
  const valid = candles.filter(c => 
    c &&
    isValid(c.close) && c.close > 0 &&
    isValid(c.epoch) && c.epoch > 0 &&
    isValid(c.open) && c.open > 0 &&
    isValid(c.high) && c.high > 0 &&
    isValid(c.low) && c.low > 0
  );
  
  if (valid.length < minCount) {
    console.warn(`⚠️ Apenas ${valid.length}/${candles.length} candles válidos (mínimo: ${minCount})`);
  }
  
  return valid;
};

const calculateTechnicalVote = (
  robot: RobotStrategy,
  indicators: Indicators,
  tickCandles: CandleData[]
): {
  vote: 'RISE' | 'FALL' | 'HOLD';
  confidence: number;
  reason: string;
  optimalDuration: number;
  optimalDurationUnit: DurationUnit;
  suggestedStake: number;
} => {
  let vote: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
  let confidence = 0;
  let reason = 'Nenhum sinal claro';
  let suggestedStake = 0;
  
  const { optimalDuration, optimalDurationUnit, suggestedStake: baseStake } = robot;

  const setVote = (newVote: 'RISE' | 'FALL', rawConfidence: number, newReason: string) => {
    if (rawConfidence <= 0) return;
    vote = newVote;
    confidence = rawConfidence; // Store as 0-100
    reason = newReason;
    suggestedStake = confidence === robot.strongConfidence ? baseStake : baseStake * 0.5;
  };

  if (!indicators) {
    return { vote: 'HOLD', confidence: 0, reason, optimalDuration, optimalDurationUnit, suggestedStake: 0 };
  }

  const { rsi, stoch, macd, bb, ma, adx, pdi, ndi, stochRSI, mfi, rvi } = indicators;
  const format = (val: number | null) => (isValid(val) ? val!.toFixed(2) : 'N/A');

  if (robot.strategyType === 'RSI' && isValid(rsi) && robot.strongBuyThreshold) {
    if (rsi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `RSI(${format(rsi)}) <= Forte(${robot.strongBuyThreshold})`);
    else if (rsi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `RSI(${format(rsi)}) <= Fraco(${robot.weakBuyThreshold})`);
    else if (rsi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `RSI(${format(rsi)}) >= Forte(${robot.strongSellThreshold})`);
    else if (rsi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `RSI(${format(rsi)}) >= Fraco(${robot.weakSellThreshold})`);
  } 
  else if (robot.strategyType === 'STOCHASTIC' && isValid(stoch) && robot.strongBuyThreshold) {
    if (stoch <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `Stoch(${format(stoch)}) <= Forte(${robot.strongBuyThreshold})`);
    else if (stoch <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `Stoch(${format(stoch)}) <= Fraco(${robot.weakBuyThreshold})`);
    else if (stoch >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `Stoch(${format(stoch)}) >= Forte(${robot.strongSellThreshold})`);
    else if (stoch >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `Stoch(${format(stoch)}) >= Fraco(${robot.weakSellThreshold})`);
  }
  else if (robot.strategyType === 'MACD_CROSS' && isValid(macd.macd) && isValid(macd.signal)) {
    if (macd.macd > macd.signal) setVote('RISE', robot.weakConfidence, `Cruzamento MACD para cima`);
    else if (macd.signal > macd.macd) setVote('FALL', robot.weakConfidence, `Cruzamento MACD para baixo`);
  }
  else if (robot.strategyType === 'BOLLINGER_BANDS' && isValid(bb.lower) && isValid(bb.upper) && tickCandles.length > 0) {
    const lastPrice = tickCandles[tickCandles.length - 1].close;
    if (isValid(lastPrice)) {
      if (lastPrice <= bb.lower) setVote('RISE', robot.weakConfidence, `Preço tocou Banda Inferior`);
      if (lastPrice >= bb.upper) setVote('FALL', robot.weakConfidence, `Preço tocou Banda Superior`);
    }
  }
  else if (robot.strategyType === 'MOVING_AVERAGE_CROSS' && isValid(ma.short) && isValid(ma.long)) {
    if (ma.short > ma.long) setVote('RISE', robot.weakConfidence, `Cruzamento de Médias para cima`);
    else if (ma.long > ma.short) setVote('FALL', robot.weakConfidence, `Cruzamento de Médias para baixo`);
  }
  else if (robot.strategyType === 'ADX_TREND' && isValid(adx) && adx > (robot.trendStrengthThreshold || 25)) {
    if (isValid(pdi) && isValid(ndi)) {
      if (pdi > ndi) setVote('RISE', robot.weakConfidence, `ADX > ${robot.trendStrengthThreshold} e +DI > -DI`);
      else if (ndi > pdi) setVote('FALL', robot.weakConfidence, `ADX > ${robot.trendStrengthThreshold} e -DI > +DI`);
    }
  }
  else if (robot.strategyType === 'MFI' && isValid(mfi) && robot.strongBuyThreshold) {
    if (mfi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `MFI(${format(mfi)}) <= Forte(${robot.strongBuyThreshold})`);
    else if (mfi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `MFI(${format(mfi)}) <= Fraco(${robot.weakBuyThreshold})`);
    else if (mfi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `MFI(${format(mfi)}) >= Forte(${robot.strongSellThreshold})`);
    else if (mfi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `MFI(${format(mfi)}) >= Fraco(${robot.weakSellThreshold})`);
  }
  else if (robot.strategyType === 'STOCH_RSI' && isValid(stochRSI) && robot.strongBuyThreshold) {
    if (stochRSI <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `StochRSI(${format(stochRSI)}) <= Forte(${robot.strongBuyThreshold})`);
    else if (stochRSI <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `StochRSI(${format(stochRSI)}) <= Fraco(${robot.weakBuyThreshold})`);
    else if (stochRSI >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `StochRSI(${format(stochRSI)}) >= Forte(${robot.strongSellThreshold})`);
    else if (stochRSI >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `StochRSI(${format(stochRSI)}) >= Fraco(${robot.weakSellThreshold})`);
  }
  else if (robot.strategyType === 'RVI' && isValid(rvi) && robot.strongBuyThreshold) {
    if (rvi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `RVI(${format(rvi)}) <= Forte(${robot.strongBuyThreshold})`);
    else if (rvi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `RVI(${format(rvi)}) <= Fraco(${robot.weakBuyThreshold})`);
    else if (rvi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `RVI(${format(rvi)}) >= Forte(${robot.strongSellThreshold})`);
    else if (rvi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `RVI(${format(rvi)}) >= Fraco(${robot.weakSellThreshold})`);
  }

  return { vote, confidence, reason, optimalDuration, optimalDurationUnit, suggestedStake };
};

// ════════════════════════════════════════════════════════════════════
// 🎯 HOOK PRINCIPAL
// ════════════════════════════════════════════════════════════════════

export function useRobotCouncilV2(
  activeSymbol: string | null,
  priceTicks: TickData[],
  dataVersion: number,
) {
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits, sellContract } = useDerivApi();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);
  
  // 🔥 NOVO: Execution ID para prevenir race conditions
  const executionIdRef = useRef(0);
  const lastExecutionTimeRef = useRef(0);
  const contractsInAlertRef = useRef<Map<number, 'breached' | 'confirmed'>>(new Map());
  const lastActiveSymbolRef = useRef<string | null>(null);
  const lastTimePeriodRef = useRef<TimePeriod | null>(null);
  
  // 🔥 NOVO: Métricas de sistema
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>({
    virtualTradesCount: 0,
    decisionLogCount: 0,
    activeRobotsCount: 0,
    memoryUsageMB: 0,
    isExecuting: false,
    lastCleanup: Date.now(),
    orphanedTradesRemoved: 0
  });

  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>(evolvedStrategies as RobotStrategy[]);
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [tradeDecisionLog, setTradeDecisionLog] = useState<TradeDecisionLog[]>([]);
  const [bayesianVotes, setBayesianVotes] = useState<CouncilVotes>({});

  const [currentRegime, setCurrentRegime] = useState<{
    regime: MarketRegime;
    confidence: number;
    probabilities: Record<MarketRegime, number>;
  }>({
    regime: 'ranging',
    confidence: 0.5,
    probabilities: {
      trending_bull: 0.2,
      trending_bear: 0.2,
      ranging: 0.4,
      high_volatility: 0.1,
      breakout: 0.1
    }
  });

  const [microstructure, setMicrostructure] = useState<MicrostructureFeatures | null>(null);
  const [robotPerformance, setRobotPerformance] = useState<EnhancedRobotPerformance[]>([]);
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  const tradeCounterRef = useRef(0);
  const transitionMatrixRef = useRef<number[][] | undefined>(undefined);

  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusSensitivity, setConsensusSensitivity] = useState(60);
  const [confidenceFactor, setConfidenceFactor] = useState(70);
  const [durationRange, setDurationRange] = useState<[number, number]>([15, 180]);
  const [takeProfitThreshold, setTakeProfitThreshold] = useState(10);
  const [stopLossThreshold, setStopLossThreshold] = useState(20);
  const [isDynamicConsensusOn, setIsDynamicConsensusOn] = useState(true);
  const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true);
  const [isMeritocracyOn, setIsMeritocracyOn] = useState(true);

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

  const [councilConfidence, setCouncilConfidence] = useState(0);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [effectiveThreshold, setEffectiveThreshold] = useState(0);

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
  }, [dataVersion, priceTicks]);

  useEffect(() => {
    setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
  }, [evolvedStrategies]);

  useEffect(() => {
    if (!isCouncilAutopilotOn) return;

    const cleanupInterval = setInterval(() => {
      const now = Date.now() / 1000;
      const before = virtualTradesRef.current.length;

      virtualTradesRef.current = virtualTradesRef.current.filter(trade => {
        const age = now - trade.entryEpoch;
        return age < TRADE_TIMEOUT_SECONDS;
      }).slice(-MAX_VIRTUAL_TRADES);

      const removed = before - virtualTradesRef.current.length;
      
      if (removed > 0) {
        console.warn(`🧹 Limpeza: ${removed} trades órfãos removidos`);
        setSystemMetrics(prev => ({
          ...prev,
          orphanedTradesRemoved: prev.orphanedTradesRemoved + removed,
          lastCleanup: Date.now(),
          virtualTradesCount: virtualTradesRef.current.length
        }));
      }
    }, CLEANUP_INTERVAL_MS);

    return () => clearInterval(cleanupInterval);
  }, [isCouncilAutopilotOn]);

  useEffect(() => {
    if (!isCouncilAutopilotOn) return;

    const healthCheck = setInterval(() => {
      const activeRobots = strategyCouncil.filter(r => {
        const perf = robotPerformance.find(p => p.id === r.id);
        return perf && (perf.wins + perf.losses) > 0;
      }).length;

      if (activeRobots === 0 && strategyCouncil.length > 0) {
        console.error('🚨 ALERTA: Nenhum robô ativo! Resetando sistema...');
        resetArenaPerformance();
        toast({
          title: "⚠️ Auto-Recuperação",
          description: "Sistema resetado automaticamente após inatividade detectada.",
          variant: "destructive"
        });
      }

      setSystemMetrics(prev => ({
        ...prev,
        virtualTradesCount: virtualTradesRef.current.length,
        decisionLogCount: tradeDecisionLog.length,
        activeRobotsCount: activeRobots,
        memoryUsageMB: (performance as any).memory?.usedJSHeapSize 
          ? (performance as any).memory.usedJSHeapSize / 1024 / 1024 
          : 0,
        isExecuting: councilExecutionRef.current.isExecuting
      }));
    }, HEALTH_CHECK_INTERVAL_MS);

    return () => clearInterval(healthCheck);
  }, [isCouncilAutopilotOn, strategyCouncil, robotPerformance, tradeDecisionLog]);

  const resetArenaPerformance = useCallback(() => {
    if (strategyCouncil.length === 0 || !user) return;

    toast({
      title: "🔄 Arena V2.0 Recalibrada",
      description: `Análise de desempenho reiniciada para o contexto atual.`,
    });

    const initialPerformance: EnhancedRobotPerformance[] = strategyCouncil.map(robot => ({
      id: robot.id,
      strategyType: robot.strategyType,
      strategy: robot,
      wins: 0, losses: 0, totalProfit: 0, winRate: 0,
      sharpeRatio: 0, maxDrawdown: 0, avgWin: 0, avgLoss: 0,
      profitFactor: 0, kellyFraction: 0, effectiveRegimes: [],
      monteCarloScore: 0, lastUpdated: Date.now(), tradeHistory: []
    }));

    setRobotPerformance(initialPerformance);
    virtualTradesRef.current = [];
    tradeCounterRef.current = 0;
    saveRobotPerformance(user.uid, initialPerformance);
  }, [strategyCouncil, user, toast]);

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
            effectiveRegimes: p.effectiveRegimes || [],
            monteCarloScore: p.monteCarloScore || 0,
            lastUpdated: p.lastUpdated || Date.now(),
            tradeHistory: p.tradeHistory || []
          }));
          setRobotPerformance(enhanced);
        }
      })
      .catch(err => console.error("❌ Erro ao carregar performance:", err));
  }, [user, isAuthLoading]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!user || tradeDecisionLog.length === 0) return;
      console.log("[AUDIT] Salvando logs de auditoria pendentes antes de sair...");
      tradeDecisionLog.forEach(log => {
        if (log.result === 'pending') {
          saveTradeDecision(user.uid, log);
        }
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [tradeDecisionLog, user]);

  const fetchStrategyCouncil = useCallback(async () => {
    if (!activeSymbol || !user) {
      toast({
        variant: 'destructive',
        title: !user ? 'Não Autenticado' : 'Nenhum Ativo',
        description: 'Necessário login e ativo selecionado.',
      });
      return;
    }

    setIsFetchingCouncil(true);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const council = (evolvedStrategies as RobotStrategy[]).map(s => ({ ...s }));
    setStrategyCouncil(council);

    resetArenaPerformance();

    toast({
      title: '🚀 Sistema V2.0 Ativado',
      description: `${council.length} robôs com IA avançada iniciados.`,
    });

    setIsCouncilAutopilotOn(true);
    lastActiveSymbolRef.current = activeSymbol;
    lastTimePeriodRef.current = timePeriod;
    setIsFetchingCouncil(false);
  }, [activeSymbol, user, toast, evolvedStrategies, resetArenaPerformance, timePeriod]);

  useEffect(() => {
    const symbolChanged = activeSymbol && lastActiveSymbolRef.current !== activeSymbol;
    const timePeriodChanged = timePeriod && lastTimePeriodRef.current !== timePeriod;

    if (isCouncilAutopilotOn && (symbolChanged || timePeriodChanged)) {
      console.log(`[CONTEXT CHANGE] Mudança detectada. Resetando arena...`);
      resetArenaPerformance();

      if (symbolChanged) lastActiveSymbolRef.current = activeSymbol;
      if (timePeriodChanged) lastTimePeriodRef.current = timePeriod;
    }
  }, [activeSymbol, timePeriod, isCouncilAutopilotOn, resetArenaPerformance]);

  const dissolveCouncil = useCallback(() => {
    setIsFetchingCouncil(true);
    toast({
      title: 'Dispensando a Mesa V2.0...',
      description: 'A guardar os dados finais da sessão.',
    });

    setTimeout(() => {
      setIsCouncilAutopilotOn(false);
      virtualTradesRef.current = [];
      setIsFetchingCouncil(false);
      toast({
        title: '⏸️ Sistema Pausado',
        description: 'Conselho desativado com segurança.',
      });
    }, 1500);
  }, [toast]);

  useEffect(() => {
    tradeDecisionLog.forEach(log => {
      if (log.result === 'pending') {
        const matchingOp = operationsLog.find(op =>
          op.initiator === 'Conselho' &&
          Math.abs(new Date(op.timestamp).getTime() - new Date(log.timestamp).getTime()) < 5000
        );

        if (matchingOp && matchingOp.status !== 'pending') {
          setTradeDecisionLog(prevLogs =>
            prevLogs.map(l =>
              l.id === log.id
                ? { ...l, result: matchingOp.status, pnl: matchingOp.result || 0 }
                : l
            )
          );

          if (user) {
            saveTradeDecision(user.uid, { ...log, result: matchingOp.status, pnl: matchingOp.result || 0 });
          }
        }
      }
    });
  }, [operationsLog, tradeDecisionLog, user]);

  useEffect(() => {
    const now = Date.now();
    if (now - lastExecutionTimeRef.current < THROTTLE_MS) return;
    lastExecutionTimeRef.current = now;

    if (!isConnected || !user || !isCouncilAutopilotOn ||
      strategyCouncil.length === 0 || !activeSymbol) {
      return;
    }

    const validCandles = validateCandles(tickCandles, REGIME_LOOKBACK);
    if (validCandles.length < REGIME_LOOKBACK) return;
    
    const currentTick = priceTicks[priceTicks.length - 1];
    if (!currentTick) return;

    try {
      const contractDurationForIndicators = { duration: 5, unit: 'm' as DurationUnit };
      const currentIndicators = calculateAllIndicators(
        validCandles,
        strategyCouncil,
        timePeriod,
        contractDurationForIndicators
      );
      setIndicators(currentIndicators);

      if (!currentIndicators || !isValid(currentIndicators.adx)) {
        console.warn('⚠️ Indicadores incompletos, pulando ciclo');
        return;
      }

      const regimeResult = detectMarketRegime(
        validCandles,
        {
          adx: currentIndicators.adx,
          pdi: currentIndicators.pdi || undefined,
          ndi: currentIndicators.ndi || undefined,
          bbw: currentIndicators.bbw || undefined,
          roc: currentIndicators.roc || undefined,
          atr: currentIndicators.atr || undefined,
        },
        currentRegime.regime,
        transitionMatrixRef.current
      );

      setCurrentRegime({
        regime: regimeResult.regime,
        confidence: regimeResult.confidence,
        probabilities: regimeResult.probabilities
      });
      transitionMatrixRef.current = regimeResult.transitionMatrix;

      const microFeatures = extractMicrostructureFeatures(priceTicks, validCandles);
      setMicrostructure(microFeatures);

      const activeCouncilContracts = operationsLog.filter(
        op => op.status === 'pending' && op.initiator === 'Conselho'
      );

      activeCouncilContracts.forEach(contract => {
        if (councilExecutionRef.current.sellingContracts.has(contract.id)) return;
        const contractId = contract.id;
        const potentialProfit = contract.stake * 0.94;
        const currentProfit = contract.result || 0;

        if (currentProfit > 0 && potentialProfit > 0 && (currentProfit / potentialProfit) * 100 >= takeProfitThreshold) {
          councilExecutionRef.current.sellingContracts.add(contractId);
          sellContract(contractId).finally(() => setTimeout(() => councilExecutionRef.current.sellingContracts.delete(contractId), 5000));
          toast({ title: "💰 Take Profit Atingido", description: `Contrato #${contractId} fechado.` });
          return;
        }

        if (currentProfit < 0 && (Math.abs(currentProfit) / contract.stake) * 100 >= stopLossThreshold) {
          councilExecutionRef.current.sellingContracts.add(contractId);
          sellContract(contractId).finally(() => setTimeout(() => councilExecutionRef.current.sellingContracts.delete(contractId), 5000));
          toast({ title: "🛡️ Stop Loss Acionado", description: `Contrato #${contractId} fechado.`, variant: "destructive" });
        }
      });
      
      const performanceMap = new Map<string, EnhancedRobotPerformance>();
      strategyCouncil.forEach(robot => {
        const existing = robotPerformance.find(p => p.id === robot.id);
        performanceMap.set(robot.id, existing || {
          id: robot.id, strategyType: robot.strategyType, strategy: robot, wins: 0, losses: 0,
          totalProfit: 0, winRate: 0, sharpeRatio: 0, maxDrawdown: 0, avgWin: 0, avgLoss: 0,
          profitFactor: 0, kellyFraction: 0, effectiveRegimes: [], monteCarloScore: 0,
          lastUpdated: Date.now(), tradeHistory: []
        });
      });
      
      let performanceChanged = false;
      const stillActiveTrades = virtualTradesRef.current.filter(trade => {
        const isExpired = currentTick.epoch >= (trade.exitEpoch - 5);
        if (isExpired) {
          const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;
          const isWin = (trade.vote === 'RISE' && exitTick.price > trade.entryPrice) || (trade.vote === 'FALL' && exitTick.price < trade.entryPrice);
          const pnl = isWin ? VIRTUAL_STAKE * 0.95 : -VIRTUAL_STAKE;
          const perf = performanceMap.get(trade.robotId);
          if (perf) {
            perf.totalProfit += pnl;
            perf.tradeHistory.push(pnl);
            if (isWin) perf.wins++; else perf.losses++;
            const totalTrades = perf.wins + perf.losses;
            perf.winRate = totalTrades > 0 ? (perf.wins / totalTrades) * 100 : 0;
            if (perf.tradeHistory.length >= MIN_TRADES_FOR_STATS) {
              const metrics = calculatePerformanceMetrics(perf.tradeHistory.map((p, i) => ({ profit: p, timestamp: Date.now() - (perf.tradeHistory.length - i) * 60000 })));
              perf.sharpeRatio = metrics.sharpeRatio;
              perf.maxDrawdown = metrics.maxDrawdown;
              perf.avgWin = metrics.avgWin;
              perf.avgLoss = metrics.avgLoss;
              perf.profitFactor = metrics.profitFactor;
              perf.kellyFraction = metrics.kellyFraction;
              perf.monteCarloScore = monteCarloValidation(perf.tradeHistory).score;
              perf.effectiveRegimes = analyzeStrategyByRegime(perf.tradeHistory.map(p => ({ regime: trade.regime, profit: p })));
            }
            perf.lastUpdated = Date.now();
            performanceChanged = true;
          }
          return false;
        }
        return (currentTick.epoch - trade.entryEpoch) <= TRADE_TIMEOUT_SECONDS;
      });
      virtualTradesRef.current = stillActiveTrades;
      if (performanceChanged) {
        const updatedPerformance = Array.from(performanceMap.values());
        setRobotPerformance(updatedPerformance);
        evolveTrigger(updatedPerformance);
        if (user) saveRobotPerformance(user.uid, updatedPerformance).catch(err => console.error('❌ Erro ao salvar:', err));
      }

      const newBayesianVotes: CouncilVotes = {};
      let riseSum = 0, fallSum = 0, totalWeight = 0, weightedStakeSum = 0, weightedDurationSum = 0;
      let activeRobotsCount = 0;
      const inactivityReasons = {
        confidence: 0,
        regime: 0,
        duration: 0,
      };

      strategyCouncil.forEach(robot => {
        const perf = performanceMap.get(robot.id);
        const technicalVote = calculateTechnicalVote(robot, currentIndicators, validCandles);
        
        // ✅ BUG FIX #1: Comparação de Confiança Errada
        if (technicalVote.vote === 'HOLD' || (technicalVote.confidence) < confidenceFactor) {
            inactivityReasons.confidence++;
            newBayesianVotes[robot.id] = { ...technicalVote, rawConfidence: technicalVote.confidence, bayesianProbability: 0.5, weight: 0, regime: regimeResult.regime, reason: `Confiança Insuficiente`, calibratedConfidence: 0 };
            return;
        }

        const durationInSeconds = durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit);
        const isRegimeEffective = !perf?.effectiveRegimes?.length || perf.effectiveRegimes.includes(regimeResult.regime);
        const isDurationInRange = durationInSeconds >= durationRange[0] && durationInSeconds <= durationRange[1];

        // ✅ BUG FIX #2: Validação de Regime Ausente (movida para antes da criação do trade virtual)
        if (!isRegimeEffective) {
          inactivityReasons.regime++;
          newBayesianVotes[robot.id] = { ...technicalVote, rawConfidence: 0, bayesianProbability: 0.5, weight: 0, regime: regimeResult.regime, reason: 'Fora de Regime Efetivo', calibratedConfidence: 0 };
          return;
        }
        if (!isDurationInRange) {
          inactivityReasons.duration++;
          newBayesianVotes[robot.id] = { ...technicalVote, rawConfidence: 0, bayesianProbability: 0.5, weight: 0, regime: regimeResult.regime, reason: 'Fora do Range de Duração', calibratedConfidence: 0 };
          return;
        }
        
        activeRobotsCount++;
        let prior = (perf && (perf.wins + perf.losses) >= MIN_TRADES_FOR_STATS) ? perf.winRate / 100 : 0.5;
        let likelihood = technicalVote.confidence / 100;
        if (microFeatures && microFeatures.yangZhangVolatility > 0.05) likelihood *= 0.8;
        const posterior = bayesianUpdate(prior, likelihood);
        
        // ✅ BUG FIX #3: Calibração de Confiança Incorreta
        const calibratedConf = calibrateConfidence(technicalVote.confidence, perf?.winRate || 50) / 100;

        let weight = 1.0;
        if (isMeritocracyOn && perf && (perf.wins + perf.losses) > 10) {
          const sharpeWeight = Math.max(0.2, Math.min(2.0, (perf.sharpeRatio || 0) / 1.5));
          const mcWeight = perf.monteCarloScore >= 0.95 ? 1.2 : perf.monteCarloScore >= 0.85 ? 1.0 : 0.5;
          weight = sharpeWeight * mcWeight;
        }

        const tradeId = `vt_${Date.now()}_${tradeCounterRef.current++}`;
        virtualTradesRef.current.push({ id: tradeId, robotId: robot.id, vote: technicalVote.vote, entryPrice: currentTick.price, entryEpoch: currentTick.epoch, exitEpoch: currentTick.epoch + durationInSeconds, regime: regimeResult.regime, microstructure: microFeatures, stake: VIRTUAL_STAKE });

        const finalVote: BayesianVote = { vote: technicalVote.vote, rawConfidence: technicalVote.confidence, calibratedConfidence: calibratedConf * 100, bayesianProbability: posterior, weight, optimalDuration: technicalVote.optimalDuration, optimalDurationUnit: technicalVote.optimalDurationUnit, suggestedStake: technicalVote.suggestedStake * posterior, regime: regimeResult.regime, reason: technicalVote.reason };
        newBayesianVotes[robot.id] = finalVote;

        const voteWeight = calibratedConf * weight;
        if (technicalVote.vote === 'RISE') riseSum += voteWeight;
        if (technicalVote.vote === 'FALL') fallSum += voteWeight;
        weightedStakeSum += finalVote.suggestedStake * voteWeight;
        weightedDurationSum += durationInSeconds * voteWeight;
        totalWeight += voteWeight;
      });

      setBayesianVotes(newBayesianVotes);
      setCouncilConfidence(totalWeight);

      let consensusDirection: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
      let consensusProbability = 0.5;
      if (totalWeight > 0 && (riseSum + fallSum) > 0) {
        consensusProbability = Math.max(riseSum, fallSum) / (riseSum + fallSum);
        if (riseSum > fallSum && riseSum > 0) consensusDirection = 'RISE';
        else if (fallSum > riseSum && fallSum > 0) consensusDirection = 'FALL';
      }

      const dailyPnL = operationsLog.filter(op => op.initiator === 'Conselho' && new Date(op.timestamp).toDateString() === new Date().toDateString()).reduce((sum, op) => sum + (op.result || 0), 0);
      setPortfolioStats(prev => ({ ...prev, dailyPnL }));

      if (dailyPnL <= -dailyBalance) { toast({ title: "🛑 Stop Loss Diário", description: "Operações suspensas.", variant: "destructive" }); return; }
      if (dailyPnL >= dailyTarget) { toast({ title: "🎯 Meta Batida", description: `Lucro de ${dailyPnL.toFixed(2)}!` }); return; }

      let calculatedEffectiveThreshold = isDynamicConsensusOn ? (totalWeight * (consensusSensitivity / 100) * Math.pow(1 + (microFeatures ? Math.min(microFeatures.yangZhangVolatility * 5, 1) : 0), 1.5)) : consensusSensitivity;
      setEffectiveThreshold(calculatedEffectiveThreshold);
      const consensusReached = Math.max(riseSum, fallSum) >= calculatedEffectiveThreshold;

      const winningDirection = riseSum > fallSum ? 'RISE' : 'FALL';
      const winningVoters = Object.values(newBayesianVotes).filter(v => v.vote === winningDirection);
      const matureVoters = winningVoters.filter(voter => {
        const perf = robotPerformance.find(p => p.id === voter.strategy?.id);
        return perf && (perf.wins + perf.losses) > MIN_TRADES_FOR_STATS;
      });
      const maturityRatio = winningVoters.length > 0 ? matureVoters.length / winningVoters.length : 0;
      
      // ✅ BUG FIX #4 & #5: Requisito de Maturidade e Fase de Aquecimento
      const totalSystemTrades = robotPerformance.reduce((sum, p) => sum + p.wins + p.losses, 0);
      let hasStatisticalConfidence = maturityRatio >= 0.4 || matureVoters.length >= 3;
      
      let kellyStake = calculateKellyStake(dailyBalance - portfolioStats.totalExposure, consensusProbability, 0.95);
      if (microFeatures) {
        if (microFeatures.isSpike) { toast({ title: "🛡️ Veto Total", description: "Pico anômalo detectado.", variant: "destructive" }); return; }
        if ((consensusDirection === 'RISE' && microFeatures.pressure === 'sell') || (consensusDirection === 'FALL' && microFeatures.pressure === 'buy')) { kellyStake *= 0.5; toast({ title: "⚠️ Veto Parcial", description: "Risco reduzido." }); }
        if (regimeResult.regime === 'breakout' && microFeatures.pressure === (consensusDirection === 'RISE' ? 'buy' : 'sell')) { kellyStake *= 1.2; toast({ title: "✅ Breakout Confirmado", description: "Risco aumentado." }); }
      }
      kellyStake = Math.max(0.35, Math.min(kellyStake, dailyBalance * 0.05));

      const avgDurationSeconds = totalWeight > 0 ? weightedDurationSum / totalWeight : 60;
      let finalDuration = Math.round(avgDurationSeconds);
      let finalDurationUnit: DurationUnit = 's';
      if (durationLimits) {
        if (avgDurationSeconds <= durationLimits.t.max * 2 && durationLimits.t.min > 0) { finalDurationUnit = 't'; finalDuration = Math.round(avgDurationSeconds / 2); }
        else if (avgDurationSeconds < 60 && durationLimits.s.min > 0) { finalDurationUnit = 's'; }
        else if (durationLimits.m.min > 0) { finalDurationUnit = 'm'; finalDuration = Math.round(avgDurationSeconds / 60); }
        const { min, max } = durationLimits[finalDurationUnit];
        finalDuration = Math.max(min, Math.min(max, finalDuration));
      } else { finalDuration = 5; finalDurationUnit = 't'; }

      setDashboardData({ regime: regimeResult.regime, bayesianProbability: consensusProbability, consensusDirection, activeRobotsCount, microstructure: { pressure: microFeatures ? microFeatures.volumeImbalance : 0.5, velocity: microFeatures ? microFeatures.tickVelocity : 0, isSpike: microFeatures ? microFeatures.isSpike : false }, kellyStake });

      // Permite operar se estivermos na fase de aquecimento, ignorando a confiança estatística
      const isWarmupPhase = totalSystemTrades < 50;
      if (!hasStatisticalConfidence && isWarmupPhase) {
          hasStatisticalConfidence = true;
          console.log('🔥 FASE DE AQUECIMENTO: permitindo operação com confiança estatística reduzida.');
      }

      console.log(`
═══════════════════════════════════════════════════
📊 CICLO DE ANÁLISE
🤖 Robôs no Conselho: ${strategyCouncil.length}
✅ Robôs Ativos: ${activeRobotsCount}
📈 Rise Sum: ${riseSum.toFixed(2)} | Fall Sum: ${fallSum.toFixed(2)}
⚖️ Total Weight: ${totalWeight.toFixed(2)}
🎯 Threshold Efetivo: ${calculatedEffectiveThreshold.toFixed(2)}
🏟️ Virtual Trades Ativos: ${virtualTradesRef.current.length}

❌ Motivos de Inatividade:
   - Confiança < Limiar (${confidenceFactor}%): ${inactivityReasons.confidence} robô(s)
   - Regime ${regimeResult.regime} não efetivo: ${inactivityReasons.regime} robô(s)
   - Duração fora do range [${durationRange[0]}, ${durationRange[1]}]: ${inactivityReasons.duration} robô(s)

📊 Análise de Maturidade:
   Winning Direction: ${winningDirection}
   Winning Voters: ${winningVoters.length}
   Mature Voters: ${matureVoters.length}
   Maturity Ratio: ${(maturityRatio * 100).toFixed(1)}%
   Statistical Confidence: ${hasStatisticalConfidence ? '✅ SIM' : '❌ NÃO'} ${isWarmupPhase && !hasStatisticalConfidence ? '(Aquecimento)' : ''}
═══════════════════════════════════════════════════
`);


      if (!consensusReached || !hasStatisticalConfidence || consensusDirection === 'HOLD') {
        setConsensusDecision({ direction: 'HOLD', probability: consensusProbability, stake: 0 });
        return;
      }
      
      setConsensusDecision({ direction: consensusDirection, probability: consensusProbability, stake: kellyStake });
      const activeStakes = activeCouncilContracts.reduce((sum, c) => sum + c.stake, 0);
      setPortfolioStats(prev => ({ ...prev, totalExposure: activeStakes, maxDrawdown: Math.max(prev.maxDrawdown, Math.abs(dailyPnL / dailyBalance * 100)) }));

      if (councilExecutionRef.current.isExecuting || activeStakes + kellyStake > dailyBalance * 0.3 || consensusProbability < 0.65) return;
      
      const currentExecutionId = ++executionIdRef.current;
      councilExecutionRef.current.isExecuting = true;

      const decisionLog: TradeDecisionLog = { id: `TDL-${Date.now()}`, timestamp: new Date().toISOString(), asset: activeSymbol, timePeriod, tradeParams: { direction: consensusDirection, stake: kellyStake, duration: finalDuration, durationUnit: finalDurationUnit }, context: { marketRegime: regimeResult.regime, regimeConfidence: regimeResult.confidence, microstructure: microFeatures, indicators: currentIndicators }, consensus: { bayesianProbability: consensusProbability, kellyStake, activeRobots: activeRobotsCount, votes: bayesianVotes }, result: 'pending', pnl: 0 };
      setTradeDecisionLog(prev => [decisionLog, ...prev].slice(0, MAX_DECISION_LOG));
      
      toast({ title: "🚀 Ordem Executada", description: `${consensusDirection} com ${kellyStake.toFixed(2)} (${(consensusProbability * 100).toFixed(1)}%)` });

      executeTrade(consensusDirection === 'RISE' ? 'CALL' : 'PUT', kellyStake, activeSymbol, consensusDirection.toLowerCase() as 'rise' | 'fall', finalDuration, finalDurationUnit, 'Conselho')
        .finally(() => {
          const recentTrades = operationsLog.filter(op => op.initiator === 'Conselho' && Date.now() - new Date(op.timestamp).getTime() < 300000).length;
          const cooldownTime = Math.min(5000 + (recentTrades * 2000), 30000);
          setTimeout(() => {
            if (currentExecutionId === executionIdRef.current) {
              councilExecutionRef.current.isExecuting = false;
            }
          }, cooldownTime);
        });
    } catch (error) {
      console.error("🚨 ERRO CRÍTICO:", error);
    }
  }, [
    dataVersion, isConnected, isCouncilAutopilotOn, strategyCouncil,
    robotPerformance, isMeritocracyOn, isDynamicConsensusOn, isDynamicRiskOn,
    activeSymbol, operationsLog, currentRegime, user, toast, executeTrade, sellContract,
    timePeriod, durationLimits, dailyBalance, dailyTarget, evolveTrigger,
    portfolioStats, consensusSensitivity, confidenceFactor, durationRange,
    takeProfitThreshold, stopLossThreshold, priceTicks, tickCandles
  ]);

  return {
    isCouncilAutopilotOn, setIsCouncilAutopilotOn, fetchStrategyCouncil, dissolveCouncil,
    isFetchingCouncil, strategyCouncil, robotPerformance, evolutionHistory, indicators,
    currentRegime, microstructure, consensusDecision, portfolioStats, bayesianVotes,
    dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, consensusSensitivity,
    setConsensusSensitivity, confidenceFactor, setConfidenceFactor, durationRange,
    setDurationRange, takeProfitThreshold, setTakeProfitThreshold, stopLossThreshold,
    setStopLossThreshold, isDynamicConsensusOn, setIsDynamicConsensusOn,
    isDynamicRiskOn, setIsDynamicRiskOn, isMeritocracyOn, setIsMeritocracyOn,
    dashboardData, effectiveThreshold, councilConfidence, resetArenaPerformance,
    tradeDecisionLog, systemMetrics,
  };
}
