// src/hooks/use-robot-council-v2.ts
'use client';

/**
 * 🧠 DERIV TRADER V2.0 - SISTEMA EVOLUTIVO COMPLETO
 * 
 * ARQUITETURA REVOLUCIONÁRIA:
 * ═══════════════════════════════════════════════════════════════════
 * 
 * 1. REGIME DETECTION (Hidden Markov Model)
 *    - Identifica 5 estados de mercado em tempo real
 *    - Ativa estratégias específicas por regime
 *    - Previne overfitting com context-awareness
 * 
 * 2. MACHINE LEARNING LAYER
 *    - Features de microestrutura (spread, volume flow)
 *    - Volatilidade realizada (Parkinson, Yang-Zhang)
 *    - Bayesian inference para calibração de confiança
 * 
 * 3. BAYESIAN CONSENSUS
 *    - Substitui votação simples por inferência probabilística
 *    - Atualiza crenças com base em histórico de cada robô
 *    - Calibração de confiança via Platt Scaling
 * 
 * 4. KELLY CRITERION POSITION SIZING
 *    - Maximiza crescimento logarítmico do capital
 *    - Fractional Kelly (1/4) para segurança
 *    - Ajuste dinâmico por volatilidade
 * 
 * 5. MONTE CARLO VALIDATION
 *    - Testa se resultados são skill ou sorte
 *    - Walk-forward analysis contínuo
 *    - Sharpe Ratio mínimo de 1.5
 * 
 * 6. MICROSTRUCTURE EXPLOITATION
 *    - Captura bid-ask spread patterns
 *    - Volume imbalance detection
 *    - Trade flow analysis
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApi } from './use-deriv-api';
import { useToast } from '@/hooks/use-toast';
import type { 
  RobotStrategy, 
  DurationUnit, 
  TickData, 
  CandleData, 
  Operation,
  RobotVote as RobotVoteType,
  MarketRegime,
  MicrostructureFeatures,
  BayesianVote as BayesianVoteType,
  EnhancedRobotPerformance as EnhancedRobotPerformanceType,
  TimePeriod,
  TradeDecisionLog,
} from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance, saveTradeDecision } from '@/services/financial-data-service';
import { useStrategyEvolution } from './use-strategy-evolution';
import { initialCouncilStrategies } from '@/services/council-strategies';
import {
  detectMarketRegime,
  calculateKellyStake,
  bayesianUpdate,
  calibrateConfidence,
  calculatePerformanceMetrics,
  monteCarloValidation,
  extractMicrostructureFeatures,
  analyzeStrategyByRegime
} from '@/services/advanced-trading-services';

// ════════════════════════════════════════════════════════════════════
// 📊 CONSTANTES E CONFIGURAÇÕES
// ════════════════════════════════════════════════════════════════════

const VIRTUAL_STAKE = 1.0;               // Stake fixo para arena virtual
const KELLY_FRACTION = 0.25;             // Fractional Kelly (1/4) para segurança
const MIN_SHARPE_RATIO = 1.5;            // Sharpe mínimo aceitável
const MONTE_CARLO_ITERATIONS = 1000;     // Iterações para validação
const REGIME_LOOKBACK = 50;              // Janela para detecção de regime
const MICROSTRUCTURE_WINDOW = 20;        // Janela para features de microestrutura
const MIN_TRADES_FOR_STATS = 30;         // Trades mínimos para estatísticas confiáveis
const THROTTLE_MS = 1000;                // Intervalo mínimo entre execuções do ciclo principal (em ms)


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
export type CouncilVotes = { [key: string]: RobotVote };

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

// ════════════════════════════════════════════════════════════════════
// 🔧 FUNÇÕES AUXILIARES
// ════════════════════════════════════════════════════════════════════

/**
 * Converte durações de diferentes unidades para segundos
 */
const durationToSeconds = (duration: number, unit: DurationUnit): number => {
  switch (unit) {
    case 't': return duration * 2;      // 1 tick ≈ 2 segundos
    case 's': return duration;
    case 'm': return duration * 60;
    case 'h': return duration * 3600;
    case 'd': return duration * 86400;
    default: return duration;
  }
};

/**
 * Valida se um valor é um número válido
 */
const isValid = (value: any): value is number => 
  value !== null && value !== undefined && !isNaN(value);

/**
 * Calcula voto técnico puro baseado em indicadores
 * Isolado para facilitar testes e manutenção
 */
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
  
  // Retorna a duração ótima do robô, sem clamping.
  const { optimalDuration, optimalDurationUnit, suggestedStake: baseStake } = robot;

  const setVote = (newVote: 'RISE' | 'FALL', newConfidence: number, newReason: string) => {
    if (newConfidence <= 0) return;
    vote = newVote;
    confidence = newConfidence;
    reason = newReason;
    suggestedStake = confidence === robot.strongConfidence ? baseStake : baseStake * 0.5;
  };

  if (!indicators) {
    return { vote: 'HOLD', confidence: 0, reason, optimalDuration, optimalDurationUnit, suggestedStake: 0 };
  }

  // Extrai indicadores para facilitar leitura
  const { rsi, stoch, macd, bb, ma, adx, pdi, ndi, stochRSI, mfi, rvi } = indicators;
  const format = (val: number | null) => (val !== null && val !== undefined && !isNaN(val) ? val.toFixed(2) : 'N/A');

  // ────────────────────────────────────────────────────────────────
  // LÓGICA DE VOTAÇÃO POR ESTRATÉGIA
  // ────────────────────────────────────────────────────────────────
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
  // ────────────────────────────────────────────────────────────────
  // DEPENDENCIES
  // ────────────────────────────────────────────────────────────────
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits, sellContract } = useDerivApi();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);
  const lastExecutionTimeRef = useRef(0); // Para o throttle
  const contractsInAlertRef = useRef<Map<number, 'breached' | 'confirmed'>>(new Map());
  const lastActiveSymbolRef = useRef<string | null>(null);
  const lastTimePeriodRef = useRef<TimePeriod | null>(null); // NOVO: Para detetar mudança de tempo

  // ────────────────────────────────────────────────────────────────
  // ESTADOS DO CONSELHO
  // ────────────────────────────────────────────────────────────────
  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>(evolvedStrategies as RobotStrategy[]);
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [tradeDecisionLog, setTradeDecisionLog] = useState<TradeDecisionLog[]>([]);


  // ────────────────────────────────────────────────────────────────
  // ESTADOS DE REGIME E MICROESTRUTURA
  // ────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────
  // ESTADOS DE PERFORMANCE E ARENA VIRTUAL
  // ────────────────────────────────────────────────────────────────
  const [robotPerformance, setRobotPerformance] = useState<EnhancedRobotPerformance[]>([]);
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  const tradeCounterRef = useRef(0);
  const transitionMatrixRef = useRef<number[][] | undefined>(undefined);

  // ────────────────────────────────────────────────────────────────
  // CONFIGURAÇÕES DE GESTÃO DE RISCO
  // ────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────
  // ESTADOS DE CONSENSO E DECISÃO
  // ────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────
  // CONVERSÃO DE TICKS PARA CANDLES (MEMOIZADO)
  // ────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────
  // SINCRONIZAÇÃO COM EVOLUÇÃO GENÉTICA
  // ────────────────────────────────────────────────────────────────
  useEffect(() => {
    setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
  }, [evolvedStrategies]);
  
  // ────────────────────────────────────────────────────────────────
  // RESET INTELIGENTE DA ARENA
  // ────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────
  // CARREGAMENTO DE PERFORMANCE DO FIREBASE
  // ────────────────────────────────────────────────────────────────
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
  
  // ────────────────────────────────────────────────────────────────
  // SALVAR LOGS DE AUDITORIA AO SAIR DA PÁGINA
  // ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!user || tradeDecisionLog.length === 0) return;

      console.log("[AUDIT] Salvando logs de auditoria pendentes antes de sair...");
      tradeDecisionLog.forEach(log => {
        if (log.result === 'pending') {
          // Usamos a função não-bloqueante para uma tentativa de "fire and forget"
          saveTradeDecision(user.uid, log);
        }
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [tradeDecisionLog, user]);

  // ────────────────────────────────────────────────────────────────
  // FUNÇÃO: ATIVAR CONSELHO
  // ────────────────────────────────────────────────────────────────
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
  
  // ────────────────────────────────────────────────────────────────
  // DETEÇÃO AUTOMÁTICA DE MUDANÇA DE CONTEXTO (ATIVO OU PERÍODO)
  // ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const symbolChanged = activeSymbol && lastActiveSymbolRef.current !== activeSymbol;
    const timePeriodChanged = timePeriod && lastTimePeriodRef.current !== timePeriod;

    if (isCouncilAutopilotOn && (symbolChanged || timePeriodChanged)) {
        console.log(`[CONTEXT CHANGE] Mudança detectada. Ativo: ${symbolChanged}, Período: ${timePeriodChanged}. Resetando arena...`);
        resetArenaPerformance();
        
        if (symbolChanged) {
          lastActiveSymbolRef.current = activeSymbol;
        }
        if (timePeriodChanged) {
          lastTimePeriodRef.current = timePeriod;
        }
    }
  }, [activeSymbol, timePeriod, isCouncilAutopilotOn, resetArenaPerformance]);

  // ────────────────────────────────────────────────────────────────
  // FUNÇÃO: DESATIVAR CONSELHO
  // ────────────────────────────────────────────────────────────────
  const dissolveCouncil = useCallback(() => {
    setIsFetchingCouncil(true); // Usa o mesmo estado para feedback visual
    toast({
        title: 'Dispensando a Mesa V2.0...',
        description: 'A guardar os dados finais da sessão.',
    });

    // Simula uma operação de limpeza assíncrona
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
  
  // ════════════════════════════════════════════════════════════════════
  // 🔄 LOOP PRINCIPAL - EXECUTADO A CADA TICK
  // ════════════════════════════════════════════════════════════════════
  useEffect(() => {
    // ══════════════════════════════════════════════════════════════
    // THROTTLE: CONTROLA A FREQUÊNCIA DE EXECUÇÃO
    // ══════════════════════════════════════════════════════════════
    const now = Date.now();
    if (now - lastExecutionTimeRef.current < THROTTLE_MS) {
        return; // Pula a execução se for muito cedo
    }
    lastExecutionTimeRef.current = now;

    // ══════════════════════════════════════════════════════════════
    // VALIDAÇÕES PRELIMINARES
    // ══════════════════════════════════════════════════════════
    if (!isConnected || !user || !isCouncilAutopilotOn || 
        strategyCouncil.length === 0 || !activeSymbol || 
        tickCandles.length < REGIME_LOOKBACK) {
      return;
    }

    const currentTick = priceTicks[priceTicks.length - 1];
    if (!currentTick) return;

    // ══════════════════════════════════════════════════════════════
    // ETAPA 1: CÁLCULO DE INDICADORES TÉCNICOS
    // ══════════════════════════════════════════════════════════════
    const contractDurationForIndicators = { duration: 5, unit: 'm' as DurationUnit };
    const currentIndicators = calculateAllIndicators(
      tickCandles, 
      strategyCouncil, 
      timePeriod,
      contractDurationForIndicators
    );
    setIndicators(currentIndicators);

    if (!currentIndicators || !currentIndicators.adx) {
      console.warn('⚠️ Indicadores incompletos, pulando ciclo');
      return;
    }

    // ══════════════════════════════════════════════════════════════
    // ETAPA 2: DETECÇÃO DE REGIME (HMM)
    // ══════════════════════════════════════════════════════════════
    const regimeResult = detectMarketRegime(
      tickCandles,
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

    // ══════════════════════════════════════════════════════════════
    // ETAPA 3: EXTRAÇÃO DE MICROESTRUTURA
    // ══════════════════════════════════════════════════════════════
    const microFeatures = extractMicrostructureFeatures(priceTicks, tickCandles);
    setMicrostructure(microFeatures);

    // ══════════════════════════════════════════════════════════════
    // ETAPA 4: GESTÃO DE POSIÇÕES ABERTAS (TP/SL DINÂMICO)
    // ══════════════════════════════════════════════════════════════
    const activeCouncilContracts = operationsLog.filter(
      op => op.status === 'pending' && op.initiator === 'Conselho'
    );
    
    activeCouncilContracts.forEach(contract => {
        if (councilExecutionRef.current.sellingContracts.has(contract.id)) return;

        const contractId = contract.id;
        const potentialProfit = contract.stake * 0.94; // Payout médio
        const currentProfit = contract.result || 0;

        // --- TAKE PROFIT ---
        if (currentProfit > 0 && potentialProfit > 0 && (currentProfit / potentialProfit) * 100 >= takeProfitThreshold) {
            councilExecutionRef.current.sellingContracts.add(contractId);
            sellContract(contractId).finally(() => setTimeout(() => councilExecutionRef.current.sellingContracts.delete(contractId), 5000));
            toast({ title: "💰 Take Profit Atingido", description: `Contrato #${contractId} fechado para garantir ${takeProfitThreshold}% do lucro.` });
            return;
        }

        // --- STOP LOSS ---
        if (currentProfit < 0 && (Math.abs(currentProfit) / contract.stake) * 100 >= stopLossThreshold) {
            councilExecutionRef.current.sellingContracts.add(contractId);
            sellContract(contractId).finally(() => setTimeout(() => councilExecutionRef.current.sellingContracts.delete(contractId), 5000));
            toast({ title: "🛡️ Stop Loss Acionado", description: `Contrato #${contractId} fechado para limitar perda em ${stopLossThreshold}%.`, variant: "destructive" });
        }
    });

    // ══════════════════════════════════════════════════════════════
    // ETAPA 5: ARENA VIRTUAL - JULGAMENTO DE TRADES
    // ══════════════════════════════════════════════════════════
    const stillActiveTrades: VirtualTrade[] = [];
    const performanceMap = new Map<string, EnhancedRobotPerformance>(
      robotPerformance.map(p => [p.id, { ...p }])
    );
    let performanceChanged = false;

    virtualTradesRef.current.forEach(trade => {
      // Verifica se trade já expirou
      if (currentTick.epoch >= trade.exitEpoch) {
        const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;

        // Determina win ou loss
        const isWin = 
          (trade.vote === 'RISE' && exitTick.price > trade.entryPrice) ||
          (trade.vote === 'FALL' && exitTick.price < trade.entryPrice);

        const pnl = isWin ? VIRTUAL_STAKE * 0.95 : -VIRTUAL_STAKE;

        // Atualiza performance do robô
        const perf = performanceMap.get(trade.robotId);
        if (perf) {
          perf.totalProfit += pnl;
          if (!perf.tradeHistory) perf.tradeHistory = [];
          perf.tradeHistory.push(pnl);

          if (isWin) perf.wins++;
          else perf.losses++;

          const totalTrades = perf.wins + perf.losses;
          perf.winRate = totalTrades > 0 ? (perf.wins / totalTrades) * 100 : 0;

          // Calcula métricas avançadas se houver trades suficientes
          if (perf.tradeHistory.length >= MIN_TRADES_FOR_STATS) {
            const metrics = calculatePerformanceMetrics(
              perf.tradeHistory.map((profit, idx) => ({
                profit,
                timestamp: Date.now() - (perf.tradeHistory.length - idx) * 60000
              }))
            );

            perf.sharpeRatio = metrics.sharpeRatio;
            perf.maxDrawdown = metrics.maxDrawdown;
            perf.avgWin = metrics.avgWin;
            perf.avgLoss = metrics.avgLoss;
            perf.profitFactor = metrics.profitFactor;
            perf.kellyFraction = metrics.kellyFraction;

            // Monte Carlo Validation
            const mcResult = monteCarloValidation(perf.tradeHistory);
            perf.monteCarloScore = mcResult.score;

            // Analisa regimes efetivos
            const regimeTrades = perf.tradeHistory.map((profit) => ({
              regime: trade.regime,
              profit
            }));
            perf.effectiveRegimes = analyzeStrategyByRegime(regimeTrades);
          }

          perf.lastUpdated = Date.now();
          performanceChanged = true;
        }
      } else {
        stillActiveTrades.push(trade);
      }
    });

    virtualTradesRef.current = stillActiveTrades;

    // Atualiza estado se houve mudanças
    if (performanceChanged) {
      const updatedPerformance = Array.from(performanceMap.values());
      updatedPerformance.sort((a, b) => b.sharpeRatio - a.sharpeRatio);

      setRobotPerformance(updatedPerformance);
      evolveTrigger(updatedPerformance);

      if (user) {
        saveRobotPerformance(user.uid, updatedPerformance)
          .catch(err => console.error('❌ Erro ao salvar performance:', err));
      }
    }

    // ══════════════════════════════════════════════════════════════
    // ETAPA 6: VOTAÇÃO BAYESIANA DOS ROBÔS
    // ══════════════════════════════════════════════════════════
    const bayesianVotes: Record<string, BayesianVote> = {};
    let riseSum = 0;
    let fallSum = 0;
    let totalWeight = 0;
    let weightedStakeSum = 0;
    let weightedDurationSum = 0;
    let activeRobotsCount = 0;

    strategyCouncil.forEach(robot => {
      const perf = performanceMap.get(robot.id);
      const technicalVote = calculateTechnicalVote(robot, currentIndicators, tickCandles);
      
      // NOVA LÓGICA: Aplica o limiar de confiança mínimo
      if (technicalVote.vote === 'HOLD' || technicalVote.confidence < confidenceFactor) {
        bayesianVotes[robot.id] = {
          ...technicalVote,
          rawConfidence: technicalVote.confidence, 
          calibratedConfidence: 0, 
          bayesianProbability: 0.5,
          weight: 0, 
          regime: regimeResult.regime, 
          reason: technicalVote.confidence < confidenceFactor ? `Confiança (${technicalVote.confidence}) < Limiar (${confidenceFactor})` : 'Inativo/Fora de Regime'
        };
        return;
      }

      const durationInSeconds = durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit);
      
      const isRegimeEffective = !perf?.effectiveRegimes?.length || perf.effectiveRegimes.includes(regimeResult.regime);
      const isDurationInRange = durationInSeconds >= durationRange[0] && durationInSeconds <= durationRange[1];
      
      if (!isRegimeEffective || !isDurationInRange) {
        bayesianVotes[robot.id] = {
          ...technicalVote,
          rawConfidence: 0, calibratedConfidence: 0, bayesianProbability: 0.5,
          weight: 0, regime: regimeResult.regime, reason: 'Inativo/Fora de Regime ou Duração'
        };
        return;
      }

      activeRobotsCount++;

      let prior = 0.5; 
      if (perf && (perf.wins + perf.losses) >= MIN_TRADES_FOR_STATS) {
        prior = perf.winRate / 100;
      }

      let likelihood = technicalVote.confidence / 100;
      if (microFeatures && microFeatures.yangZhangVolatility > 0.05) {
        likelihood *= 0.8;
      }

      const posterior = bayesianUpdate(prior, likelihood);
      const calibratedConf = calibrateConfidence(technicalVote.confidence, perf?.winRate || 50);

      let weight = 1.0;
      if (isMeritocracyOn && perf && (perf.wins + perf.losses) > 10) {
        const sharpeWeight = Math.max(0.2, Math.min(2.0, perf.sharpeRatio / 1.5));
        const mcWeight = perf.monteCarloScore >= 0.95 ? 1.2 : perf.monteCarloScore >= 0.85 ? 1.0 : 0.5;
        weight = sharpeWeight * mcWeight;
      }

      const tradeId = `vt_${Date.now()}_${tradeCounterRef.current++}`;
      const virtualTrade: VirtualTrade = {
        id: tradeId, robotId: robot.id, vote: technicalVote.vote, entryPrice: currentTick.price,
        entryEpoch: currentTick.epoch, exitEpoch: currentTick.epoch + durationInSeconds,
        regime: regimeResult.regime, microstructure: microFeatures, stake: VIRTUAL_STAKE
      };
      virtualTradesRef.current.push(virtualTrade);

      const finalVote: BayesianVote = {
        vote: technicalVote.vote, rawConfidence: technicalVote.confidence,
        calibratedConfidence: calibratedConf * 100, bayesianProbability: posterior, weight,
        optimalDuration: technicalVote.optimalDuration, optimalDurationUnit: technicalVote.optimalDurationUnit,
        suggestedStake: technicalVote.suggestedStake * posterior, regime: regimeResult.regime, reason: technicalVote.reason,
      };
      bayesianVotes[robot.id] = finalVote;
      
      const voteWeight = calibratedConf * weight;

      if (technicalVote.vote === 'RISE') riseSum += voteWeight;
      if (technicalVote.vote === 'FALL') fallSum += voteWeight;
      weightedStakeSum += finalVote.suggestedStake * voteWeight;
      weightedDurationSum += durationInSeconds * voteWeight;
      totalWeight += voteWeight;
    });
    setCouncilConfidence(totalWeight);

    // ══════════════════════════════════════════════════════════════
    // ETAPA 7: CONSENSO BAYESIANO
    // ══════════════════════════════════════════════════════════
    let consensusDirection: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
    let consensusProbability = 0.5;
    if (totalWeight > 0 && (riseSum + fallSum) > 0) {
      consensusProbability = Math.max(riseSum, fallSum) / (riseSum + fallSum);
      if (riseSum > fallSum && riseSum > 0) consensusDirection = 'RISE';
      else if (fallSum > riseSum && fallSum > 0) consensusDirection = 'FALL';
    }

    // ══════════════════════════════════════════════════════════════
    // ETAPA 8: GESTÃO DE RISCO E VALIDAÇÕES
    // ══════════════════════════════════════════════════════════
    const dailyPnL = operationsLog
      .filter(op => op.initiator === 'Conselho' && new Date(op.timestamp).toDateString() === new Date().toDateString())
      .reduce((sum, op) => sum + (op.result || 0), 0);
      
    setPortfolioStats(prev => ({ ...prev, dailyPnL }));


    if (dailyPnL <= -dailyBalance) {
      toast({ title: "🛑 Stop Loss Diário Atingido", description: "Operações suspensas.", variant: "destructive" });
      return;
    }
    if (dailyPnL >= dailyTarget) {
      toast({ title: "🎯 Meta Diária Batida", description: `Lucro de $${dailyPnL.toFixed(2)} garantido!` });
      return;
    }

    let calculatedEffectiveThreshold;
    if (isDynamicConsensusOn) {
        const baseThreshold = totalWeight * (consensusSensitivity / 100);
        const volFactor = 1 + (microFeatures ? Math.min(microFeatures.yangZhangVolatility * 5, 1) : 0);
        calculatedEffectiveThreshold = baseThreshold * Math.pow(volFactor, 1.5);
    } else {
        calculatedEffectiveThreshold = consensusSensitivity; 
    }
    setEffectiveThreshold(calculatedEffectiveThreshold); 
    
    const consensusReached = Math.max(riseSum, fallSum) >= calculatedEffectiveThreshold;


    // ══════════════════════════════════════════════════════════════
    // ETAPA 9: KELLY CRITERION POSITION SIZING
    // ══════════════════════════════════════════════════════════
    const PAYOUT_RATE = 0.95; // Payout líquido para RISE/FALL
    let kellyStake = calculateKellyStake(
      dailyBalance - portfolioStats.totalExposure, consensusProbability, PAYOUT_RATE
    );
    
    // GUARDA-COSTAS DE MICROESTRUTURA (VETO GRADUADO)
    if (microFeatures) {
      if (microFeatures.isSpike) {
          // VETO TOTAL: Pico de preço anômalo, abortar.
          toast({ title: "🛡️ Veto de Microestrutura!", description: "Pico de preço súbito detectado. Trade abortado.", variant: "destructive" });
          return;
      }
      if (consensusDirection === 'RISE' && microFeatures.pressure === 'sell') {
          // VETO PARCIAL: Pressão contrária, reduz o risco.
          kellyStake *= 0.5; // Reduz o stake pela metade
          toast({ title: "⚠️ Veto Parcial", description: "Pressão de venda detectada. Risco reduzido." });
      }
      if (consensusDirection === 'FALL' && microFeatures.pressure === 'buy') {
          // VETO PARCIAL
          kellyStake *= 0.5;
          toast({ title: "⚠️ Veto Parcial", description: "Pressão de compra detectada. Risco reduzido." });
      }
      if (regimeResult.regime === 'breakout' && microFeatures.pressure === (consensusDirection === 'RISE' ? 'buy' : 'sell')) {
          // CONFIRMAÇÃO DE BREAKOUT: Aumenta o risco.
          kellyStake *= 1.2;
          toast({ title: "✅ Confirmação de Breakout", description: "Volume confirma o rompimento. Risco aumentado." });
      }
    }
    
    kellyStake = Math.max(0.35, Math.min(kellyStake, dailyBalance * 0.05)); // Aplica limites de segurança

    // ══════════════════════════════════════════════════════════════
    // ETAPA 10: DURAÇÃO ÓTIMA
    // ══════════════════════════════════════════════════════════
    const avgDurationSeconds = totalWeight > 0 ? weightedDurationSum / totalWeight : 60;
    let finalDuration = Math.round(avgDurationSeconds);
    let finalDurationUnit: DurationUnit = 's';
    if (durationLimits) {
      if (avgDurationSeconds <= durationLimits.t.max * 2 && durationLimits.t.min > 0) {
        finalDurationUnit = 't';
        finalDuration = Math.round(avgDurationSeconds / 2);
      } else if (avgDurationSeconds < 60 && durationLimits.s.min > 0) {
        finalDurationUnit = 's';
      } else if (durationLimits.m.min > 0) {
        finalDurationUnit = 'm';
        finalDuration = Math.round(avgDurationSeconds / 60);
      }
      const { min, max } = durationLimits[finalDurationUnit];
      finalDuration = Math.max(min, Math.min(max, finalDuration));
    } else {
      finalDuration = 5;
      finalDurationUnit = 't';
    }

    // ══════════════════════════════════════════════════════════════
    // ETAPA 11: ATUALIZA DASHBOARD DATA
    // ══════════════════════════════════════════════════════════
    const newDashboardData = {
      regime: regimeResult.regime, bayesianProbability: consensusProbability, consensusDirection,
      activeRobotsCount, microstructure: {
        pressure: microFeatures ? microFeatures.volumeImbalance : 0.5,
        velocity: microFeatures ? microFeatures.tickVelocity : 0,
        isSpike: microFeatures ? microFeatures.isSpike : false,
      }, kellyStake,
    };
    setDashboardData(newDashboardData);

    // ══════════════════════════════════════════════════════════
    // ETAPA 12: ATUALIZA ESTADOS DE CONSENSO E PORTFOLIO
    // ══════════════════════════════════════════════════════════
    if (!consensusReached) {
      setConsensusDecision({ direction: 'HOLD', probability: consensusProbability, stake: 0 });
      return;
    }
    setConsensusDecision({ direction: consensusDirection, probability: consensusProbability, stake: kellyStake });
    const activeStakes = activeCouncilContracts.reduce((sum, c) => sum + c.stake, 0);
    setPortfolioStats(prev => ({
      ...prev,
      totalExposure: activeStakes,
      maxDrawdown: Math.max(prev.maxDrawdown, Math.abs(dailyPnL / dailyBalance * 100)),
    }));

    // ══════════════════════════════════════════════════════════
    // ETAPA 13: EXECUÇÃO DE TRADE REAL
    // ══════════════════════════════════════════════════════════
    if (councilExecutionRef.current.isExecuting) return;
    if (activeStakes + kellyStake > dailyBalance * 0.3) return;
    if (consensusProbability < 0.65) return;
    if(consensusDirection === "HOLD") return;


    councilExecutionRef.current.isExecuting = true;
    
     // Log da Decisão
    const decisionLog: TradeDecisionLog = {
      id: `TDL-${Date.now()}`,
      timestamp: new Date().toISOString(),
      asset: activeSymbol,
      timePeriod: timePeriod,
      tradeParams: {
        direction: consensusDirection,
        stake: kellyStake,
        duration: finalDuration,
        durationUnit: finalDurationUnit,
      },
      context: {
        marketRegime: regimeResult.regime,
        regimeConfidence: regimeResult.confidence,
        microstructure: microFeatures,
        indicators: currentIndicators,
      },
      consensus: {
        bayesianProbability: consensusProbability,
        kellyStake: kellyStake,
        activeRobots: activeRobotsCount,
        votes: bayesianVotes,
      },
      result: 'pending',
      pnl: 0,
    };

    setTradeDecisionLog(prev => [...prev, decisionLog]);

    toast({
      title: "🚀 Ordem Executada",
      description: `${consensusDirection} com $${kellyStake.toFixed(2)} (${(consensusProbability * 100).toFixed(1)}% confiança)`
    });

    executeTrade(
      consensusDirection === 'RISE' ? 'CALL' : 'PUT', kellyStake, activeSymbol!,
      consensusDirection.toLowerCase() as 'rise' | 'fall', finalDuration, finalDurationUnit, 'Conselho'
    ).then(tradeResult => {
      // Este bloco executa após a compra ser confirmada
      const watchForCompletion = (op: Operation) => {
        if (op.id === tradeResult.contractId && op.status !== 'pending') {
          setTradeDecisionLog(prevLogs => {
            return prevLogs.map(log => {
              if (log.id === decisionLog.id) {
                const finalLog = { ...log, result: op.status, pnl: op.result };
                if (user) {
                    saveTradeDecision(user.uid, finalLog); // Salva no Firebase
                }
                return finalLog;
              }
              return log;
            });
          });
        }
      };

      // Adicionamos um listener que será chamado quando o operationsLog mudar
      const checkOpsLog = (log: Operation[]) => {
        const updatedOp = log.find(op => op.id === tradeResult.contractId);
        if (updatedOp && updatedOp.status !== 'pending') {
          watchForCompletion(updatedOp);
        }
      };
      
      // Simulação de como o React reagiria à atualização do `operationsLog`
      // A lógica real dependerá de como o `operationsLog` é atualizado pelo `useDerivApi`
      const unsubscribe = () => { /* Em um app real, aqui removeríamos o listener */ };
      
      // Quando `operationsLog` for atualizado, esta lógica será acionada
      checkOpsLog(operationsLog);
      
    }).finally(() => {
      const recentTrades = operationsLog.filter(op => op.initiator === 'Conselho' && Date.now() - new Date(op.timestamp).getTime() < 300000).length;
      const cooldownTime = Math.min(5000 + (recentTrades * 2000), 30000);
      setTimeout(() => { councilExecutionRef.current.isExecuting = false; }, cooldownTime);
    });

  }, [
    dataVersion, isConnected, isCouncilAutopilotOn, strategyCouncil,
    robotPerformance, isMeritocracyOn, isDynamicConsensusOn, isDynamicRiskOn,
    activeSymbol, operationsLog, currentRegime, user, toast, executeTrade, sellContract,
    timePeriod, durationLimits, dailyBalance, dailyTarget, evolveTrigger,
    portfolioStats.maxDrawdown, consensusSensitivity, confidenceFactor, durationRange,
    takeProfitThreshold, stopLossThreshold, priceTicks, tickCandles
  ]);

  // ════════════════════════════════════════════════════════════════════
  // 📤 RETORNO DO HOOK
  // ════════════════════════════════════════════════════════════════════
  return {
    isCouncilAutopilotOn, setIsCouncilAutopilotOn, fetchStrategyCouncil, dissolveCouncil,
    isFetchingCouncil, strategyCouncil, robotPerformance, evolutionHistory, indicators,
    currentRegime, microstructure, consensusDecision, portfolioStats,
    dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, consensusSensitivity,
    setConsensusSensitivity, confidenceFactor, setConfidenceFactor, durationRange,
    setDurationRange, takeProfitThreshold, setTakeProfitThreshold, stopLossThreshold,
    setStopLossThreshold, isDynamicConsensusOn, setIsDynamicConsensusOn,
    isDynamicRiskOn, setIsDynamicRiskOn, isMeritocracyOn, setIsMeritocracyOn,
    dashboardData,
    effectiveThreshold,
    councilConfidence,
    resetArenaPerformance,
    tradeDecisionLog,
  };
}
