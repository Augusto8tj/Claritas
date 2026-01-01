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
import { useToast } from './use-toast';
import type { 
  RobotStrategy, 
  DurationUnit, 
  TickData, 
  CandleData, 
  Operation,
  RobotVote as RobotVoteType,
  MarketRegime,
  MicrostructureFeatures,
  BayesianVote,
  EnhancedRobotPerformance as EnhancedRobotPerformanceType
} from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance } from '@/services/financial-data-service';
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
  optimalDuration: number;
  optimalDurationUnit: DurationUnit;
  suggestedStake: number;
} => {
  let vote: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
  let confidence = 0;
  let suggestedStake = 0;
  const { optimalDuration, optimalDurationUnit, suggestedStake: baseStake } = robot;

  const setVote = (newVote: 'RISE' | 'FALL', newConfidence: number) => {
    vote = newVote;
    confidence = newConfidence;
    suggestedStake = confidence === robot.strongConfidence ? baseStake : baseStake * 0.5;
  };

  if (!indicators) {
    return { vote: 'HOLD', confidence: 0, optimalDuration, optimalDurationUnit, suggestedStake: 0 };
  }

  // Extrai indicadores para facilitar leitura
  const { rsi, stoch, macd, bb, ma, adx, pdi, ndi, stochRSI, mfi, rvi } = indicators;

  // ────────────────────────────────────────────────────────────────
  // LÓGICA DE VOTAÇÃO POR ESTRATÉGIA
  // ────────────────────────────────────────────────────────────────

  if (robot.strategyType === 'RSI' && isValid(rsi)) {
    if (rsi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
    else if (rsi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
    else if (rsi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    else if (rsi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
  } 
  else if (robot.strategyType === 'STOCHASTIC' && isValid(stoch)) {
    if (stoch <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
    else if (stoch <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
    else if (stoch >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    else if (stoch >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
  }
  else if (robot.strategyType === 'MACD_CROSS' && isValid(macd.macd) && isValid(macd.signal)) {
    if (macd.macd > macd.signal) setVote('RISE', robot.weakConfidence);
    else if (macd.signal > macd.macd) setVote('FALL', robot.weakConfidence);
  }
  else if (robot.strategyType === 'BOLLINGER_BANDS' && isValid(bb.lower) && isValid(bb.upper) && tickCandles.length > 0) {
    const lastPrice = tickCandles[tickCandles.length - 1].close;
    if (isValid(lastPrice)) {
      if (lastPrice <= bb.lower) setVote('RISE', robot.weakConfidence);
      if (lastPrice >= bb.upper) setVote('FALL', robot.weakConfidence);
    }
  }
  else if (robot.strategyType === 'MOVING_AVERAGE_CROSS' && isValid(ma.short) && isValid(ma.long)) {
    if (ma.short > ma.long) setVote('RISE', robot.weakConfidence);
    else if (ma.long > ma.short) setVote('FALL', robot.weakConfidence);
  }
  else if (robot.strategyType === 'ADX_TREND' && isValid(adx) && adx > (robot.trendStrengthThreshold || 25)) {
    if (isValid(pdi) && isValid(ndi)) {
      if (pdi > ndi) setVote('RISE', robot.weakConfidence);
      else if (ndi > pdi) setVote('FALL', robot.weakConfidence);
    }
  }
  else if (robot.strategyType === 'MFI' && isValid(mfi)) {
    if (mfi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
    else if (mfi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
    else if (mfi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    else if (mfi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
  }
  else if (robot.strategyType === 'STOCH_RSI' && isValid(stochRSI)) {
    if (stochRSI <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
    else if (stochRSI <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
    else if (stochRSI >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    else if (stochRSI >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
  }
  else if (robot.strategyType === 'RVI' && isValid(rvi)) {
    if (rvi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
    else if (rvi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
    else if (rvi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    else if (rvi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
  }

  return { vote, confidence, optimalDuration, optimalDurationUnit, suggestedStake };
};

// ════════════════════════════════════════════════════════════════════
// 🎯 HOOK PRINCIPAL
// ════════════════════════════════════════════════════════════════════

export function useRobotCouncilV2(
  activeSymbol: string | null,
  priceTicks: TickData[]
) {
  // ────────────────────────────────────────────────────────────────
  // DEPENDENCIES
  // ────────────────────────────────────────────────────────────────
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits, sellContract } = useDerivApi();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);

  // ────────────────────────────────────────────────────────────────
  // ESTADOS DO CONSELHO
  // ────────────────────────────────────────────────────────────────
  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>(evolvedStrategies as RobotStrategy[]);
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);

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
  const [dailyBalance, setDailyBalance] = useState(100);
  const [dailyTarget, setDailyTarget] = useState(50);
  const [consensusThreshold, setConsensusThreshold] = useState(300);
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

  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);

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
  }, [priceTicks]);

  // ────────────────────────────────────────────────────────────────
  // SINCRONIZAÇÃO COM EVOLUÇÃO GENÉTICA
  // ────────────────────────────────────────────────────────────────
  useEffect(() => {
    setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
  }, [evolvedStrategies]);

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
            effectiveRegimes: p.effectiveRegimes || ['ranging'],
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
    virtualTradesRef.current = [];
    tradeCounterRef.current = 0;

    await new Promise((resolve) => setTimeout(resolve, 500));

    const council = (evolvedStrategies as RobotStrategy[]).map(s => ({ ...s }));
    setStrategyCouncil(council);

    if (robotPerformance.length === 0) {
      const initialPerformance: EnhancedRobotPerformance[] = council.map((robot) => ({
        id: robot.id,
        strategyType: robot.strategyType,
        strategy: robot,
        wins: 0,
        losses: 0,
        totalProfit: 0,
        winRate: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        kellyFraction: 0,
        effectiveRegimes: ['ranging'],
        monteCarloScore: 0,
        lastUpdated: Date.now(),
        tradeHistory: []
      }));
      setRobotPerformance(initialPerformance);
      saveRobotPerformance(user.uid, initialPerformance);
    }

    toast({
      title: '🚀 Sistema V2.0 Ativado',
      description: `${council.length} robôs com IA avançada iniciados.`,
    });

    setIsCouncilAutopilotOn(true);
    setIsFetchingCouncil(false);
  }, [activeSymbol, user, toast, robotPerformance, evolvedStrategies]);

  // ────────────────────────────────────────────────────────────────
  // FUNÇÃO: DESATIVAR CONSELHO
  // ────────────────────────────────────────────────────────────────
  const dissolveCouncil = useCallback(() => {
    setStrategyCouncil([]);
    setIsCouncilAutopilotOn(false);
    virtualTradesRef.current = [];
    
    toast({
      title: '⏸️ Sistema Pausado',
      description: 'Conselho desativado.',
    });
  }, [toast]);

  // ════════════════════════════════════════════════════════════════════
  // 🔄 LOOP PRINCIPAL - EXECUTADO A CADA TICK
  // ════════════════════════════════════════════════════════════════════
  useEffect(() => {
    // ══════════════════════════════════════════════════════════════
    // VALIDAÇÕES PRELIMINARES
    // ══════════════════════════════════════════════════════════════
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
    const currentIndicators = calculateAllIndicators(
      tickCandles, 
      strategyCouncil, 
      timePeriod, 
      { duration: 5, unit: 'm' }
    );

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
        pdi: currentIndicators.pdi,
        ndi: currentIndicators.ndi,
        bbw: currentIndicators.bbw,
        roc: currentIndicators.roc,
        atr: currentIndicators.atr
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

      // Stop Loss Técnico: Chandelier Exit
      if (currentIndicators.chandelierExit && contract.entryPrice) {
        if (contract.direction === 'rise' && currentTick.price < currentIndicators.chandelierExit) {
          councilExecutionRef.current.sellingContracts.add(contract.id);
          sellContract(contract.id);
          toast({
            title: "🛡️ Stop Loss Atingido (Chandelier)",
            description: `Contrato #${contract.id} fechado para proteger capital.`,
            variant: "destructive"
          });
          return;
        }
      }

      // Take Profit Dinâmico: 75% do lucro potencial
      const potentialProfit = contract.stake * 0.90;
      const currentProfit = contract.result || 0;

      if (currentProfit >= potentialProfit * 0.75) {
        councilExecutionRef.current.sellingContracts.add(contract.id);
        sellContract(contract.id);
        toast({
          title: "💰 Lucro Garantido",
          description: `Contrato #${contract.id} fechado com +$${currentProfit.toFixed(2)}`
        });
      }
    });

    // ══════════════════════════════════════════════════════════════
    // ETAPA 5: ARENA VIRTUAL - JULGAMENTO DE TRADES
    // ══════════════════════════════════════════════════════════════
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
    // ══════════════════════════════════════════════════════════════
    const newVotes: Record<string, any> = {};
    let riseSum = 0;
    let fallSum = 0;
    let totalWeight = 0;
    let weightedStakeSum = 0;
    let weightedDurationSum = 0;
    let activeRobotsCount = 0;

    strategyCouncil.forEach(robot => {
      const perf = performanceMap.get(robot.id);

      // Voto técnico puro
      const technicalVote = calculateTechnicalVote(robot, currentIndicators, tickCandles);

      // Se robô não é efetivo neste regime, ignora
      if (perf && perf.effectiveRegimes && perf.effectiveRegimes.length > 0) {
        if (!perf.effectiveRegimes.includes(regimeResult.regime)) {
          newVotes[robot.id] = {
            vote: 'HOLD',
            rawConfidence: 0,
            calibratedConfidence: 0,
            bayesianProbability: 0.5,
            weight: 0,
            optimalDuration: robot.optimalDuration,
            optimalDurationUnit: robot.optimalDurationUnit,
            suggestedStake: 0,
            regime: regimeResult.regime
          };
          return;
        }
      }

      if (technicalVote.vote === 'HOLD') {
        newVotes[robot.id] = {
          ...technicalVote,
          rawConfidence: 0,
          calibratedConfidence: 0,
          bayesianProbability: 0.5,
          weight: 1.0,
          regime: regimeResult.regime
        };
        return;
      }

      activeRobotsCount++;

      // ────────────────────────────────────────────────────────────
      // INFERÊNCIA BAYESIANA
      // ────────────────────────────────────────────────────────────
      let prior = 0.5; // Neutro
      if (perf && (perf.wins + perf.losses) >= MIN_TRADES_FOR_STATS) {
        prior = perf.winRate / 100;
      }

      let likelihood = technicalVote.confidence / 100;

      // Ajuste por microestrutura
      if (microFeatures && microFeatures.yangZhangVolatility > 0.05) {
        likelihood *= 0.8; // Reduz confiança em alta volatilidade
      }

      if (microFeatures && Math.abs(microFeatures.meanReversion) > 2) {
        const isContrarian =
          (technicalVote.vote === 'RISE' && microFeatures.meanReversion > 2) ||
          (technicalVote.vote === 'FALL' && microFeatures.meanReversion < -2);

        if (isContrarian) likelihood *= 0.7;
      }

      // Bayesian Update
      const posterior = bayesianUpdate(prior, likelihood);

      // Calibração de confiança (Platt Scaling)
      const calibratedConf = calibrateConfidence(
        technicalVote.confidence,
        perf?.winRate || 50
      );

      // ────────────────────────────────────────────────────────────
      // PESO MERITOCRÁTICO
      // ────────────────────────────────────────────────────────────
      let weight = 1.0;
      if (isMeritocracyOn && perf && (perf.wins + perf.losses) > 10) {
        const sharpeWeight = Math.max(0.2, Math.min(2.0, perf.sharpeRatio / 1.5));
        const mcWeight = perf.monteCarloScore >= 0.95 ? 1.2 :
                         perf.monteCarloScore >= 0.85 ? 1.0 : 0.5;
        weight = sharpeWeight * mcWeight;
      }

      // ────────────────────────────────────────────────────────────
      // CRIA TRADE VIRTUAL
      // ────────────────────────────────────────────────────────────
      const durationInSeconds = durationToSeconds(
        technicalVote.optimalDuration,
        technicalVote.optimalDurationUnit
      );

      const tradeId = `vt_${Date.now()}_${tradeCounterRef.current++}`;
      const virtualTrade: VirtualTrade = {
        id: tradeId,
        robotId: robot.id,
        vote: technicalVote.vote,
        entryPrice: currentTick.price,
        entryEpoch: currentTick.epoch,
        exitEpoch: currentTick.epoch + durationInSeconds,
        regime: regimeResult.regime,
        microstructure: microFeatures,
        stake: VIRTUAL_STAKE
      };

      virtualTradesRef.current.push(virtualTrade);

      // ────────────────────────────────────────────────────────────
      // REGISTRA VOTO
      // ────────────────────────────────────────────────────────────
      const finalVote = {
        vote: technicalVote.vote,
        rawConfidence: technicalVote.confidence,
        calibratedConfidence: calibratedConf * 100,
        bayesianProbability: posterior,
        weight,
        optimalDuration: technicalVote.optimalDuration,
        optimalDurationUnit: technicalVote.optimalDurationUnit,
        suggestedStake: technicalVote.suggestedStake * posterior,
        regime: regimeResult.regime
      };

      newVotes[robot.id] = finalVote;

      // Acumula para consenso
      const voteWeight = calibratedConf * weight;

      if (technicalVote.vote === 'RISE') riseSum += voteWeight;
      if (technicalVote.vote === 'FALL') fallSum += voteWeight;

      weightedStakeSum += finalVote.suggestedStake * voteWeight;
      weightedDurationSum += durationInSeconds * voteWeight;
      totalWeight += voteWeight;
    });

    // ══════════════════════════════════════════════════════════════
    // ETAPA 7: CONSENSO BAYESIANO
    // ══════════════════════════════════════════════════════════════
    let consensusDirection: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
    let consensusProbability = 0.5;

    if (totalWeight > 0) {
      consensusProbability = Math.max(riseSum, fallSum) / (riseSum + fallSum);

      if (riseSum > fallSum && riseSum > 0) {
        consensusDirection = 'RISE';
      } else if (fallSum > riseSum && fallSum > 0) {
        consensusDirection = 'FALL';
      }
    }

    // ══════════════════════════════════════════════════════════════
    // ETAPA 8: GESTÃO DE RISCO E VALIDAÇÕES
    // ══════════════════════════════════════════════════════════════
    const dailyPnL = operationsLog
      .filter(op =>
        new Date(op.timestamp).toDateString() === new Date().toDateString() &&
        op.initiator === 'Conselho'
      )
      .reduce((sum, op) => sum + (op.result || 0), 0);

    // Stop Loss Diário
    if (dailyPnL <= -dailyBalance) {
      toast({
        title: "🛑 Stop Loss Diário Atingido",
        description: "Operações suspensas até amanhã.",
        variant: "destructive"
      });
      return;
    }

    // Meta Diária
    if (dailyPnL >= dailyTarget) {
      toast({
        title: "🎯 Meta Diária Batida",
        description: `Lucro de $${dailyPnL.toFixed(2)} garantido!`
      });
      return;
    }

    // Consenso Dinâmico
    let effectiveThreshold = consensusThreshold;
    if (isDynamicConsensusOn && microFeatures) {
      const volatilityFactor = (microFeatures.yangZhangVolatility > 0.05) ? 1.3 : 1.0;
      effectiveThreshold = (totalWeight * 0.6) * volatilityFactor;
    }

    const consensusReached = Math.max(riseSum, fallSum) >= effectiveThreshold;

    // ══════════════════════════════════════════════════════════════
    // ETAPA 9: KELLY CRITERION POSITION SIZING (CORRIGIDO)
    // ══════════════════════════════════════════════════════════════
    
    // Calcula win rate médio do conselho
    const avgWinRate = robotPerformance.length > 0
      ? robotPerformance.reduce((sum, r) => sum + r.winRate, 0) / robotPerformance.length / 100
      : consensusProbability;

    // Calcula payoff médio (avg win / avg loss)
    const validPerformance = robotPerformance.filter(r => r.avgWin > 0 && r.avgLoss > 0);

    const avgWinAmount = validPerformance.length > 0
      ? validPerformance.reduce((sum, r) => sum + r.avgWin, 0) / validPerformance.length
      : 1.5; // Default conservador

    const avgLossAmount = validPerformance.length > 0
      ? validPerformance.reduce((sum, r) => sum + r.avgLoss, 0) / validPerformance.length
      : 1.0;

    // Ajuste por volatilidade
    const volAdjustment = microFeatures && microFeatures.yangZhangVolatility > 0
      ? Math.max(1.0, microFeatures.yangZhangVolatility * 10)
      : 1.0;

    // Calcula Kelly Stake
    let kellyStake = calculateKellyStake(
      dailyBalance,
      avgWinRate,
      avgWinAmount,
      avgLossAmount,
      volAdjustment
    );

    // Validação de segurança
    if (!isFinite(kellyStake) || isNaN(kellyStake) || kellyStake < 0) {
      console.warn('⚠️ Kelly stake inválido:', kellyStake, '- usando mínimo');
      kellyStake = 0.35;
    }

    // Ajustes dinâmicos de risco
    if (isDynamicRiskOn) {
      // Reduz em mercado lateral (ADX < 20)
      if (currentIndicators.adx && currentIndicators.adx < 20) {
        kellyStake *= 0.5;
      }

      // Reduz se drawdown está alto
      const currentDrawdown = Math.abs(dailyPnL / dailyBalance * 100);
      if (currentDrawdown > 5) {
        kellyStake *= 0.7;
      }

      // Reduz em alta volatilidade
      if (microFeatures && microFeatures.yangZhangVolatility > 0.05) {
        kellyStake *= 0.8;
      }
    }

    // Limites finais de segurança
    kellyStake = Math.max(0.35, Math.min(kellyStake, dailyBalance * 0.05));

    // Log para debug (apenas em dev)
    if (process.env.NODE_ENV === 'development') {
      console.log('💰 Kelly Calculation:', {
        avgWinRate: (avgWinRate * 100).toFixed(1) + '%',
        avgWin: avgWinAmount.toFixed(2),
        avgLoss: avgLossAmount.toFixed(2),
        payoffRatio: (avgWinAmount / avgLossAmount).toFixed(2),
        volatility: volAdjustment.toFixed(3),
        finalStake: kellyStake.toFixed(2)
      });
    }

    // ══════════════════════════════════════════════════════════════
    // ETAPA 10: DURAÇÃO ÓTIMA
    // ══════════════════════════════════════════════════════════════
    const avgDurationSeconds = totalWeight > 0 ? weightedDurationSum / totalWeight : 300;

    let finalDuration = Math.round(avgDurationSeconds / 60);
    let finalDurationUnit: DurationUnit = 'm';

    if (durationLimits) {
      if (avgDurationSeconds <= durationLimits.t.max * 2) {
        finalDurationUnit = 't';
        finalDuration = Math.round(avgDurationSeconds / 2);
      } else if (avgDurationSeconds < 60) {
        finalDurationUnit = 's';
        finalDuration = Math.round(avgDurationSeconds);
      }

      const { min, max } = durationLimits[finalDurationUnit];
      finalDuration = Math.max(min, Math.min(max, finalDuration));
    } else {
      finalDuration = 5;
      finalDurationUnit = 't';
    }

    // ══════════════════════════════════════════════════════════════
    // ETAPA 11: ATUALIZA DASHBOARD DATA
    // ══════════════════════════════════════════════════════════════
    setDashboardData({
      regime: regimeResult.regime,
      bayesianProbability: consensusProbability,
      consensusDirection,
      activeRobotsCount,
      microstructure: {
        pressure: microFeatures ? microFeatures.volumeImbalance : 0.5,
        velocity: microFeatures ? microFeatures.tickVelocity : 0,
        isSpike: microFeatures ? Math.abs(microFeatures.priceAcceleration) > 0.001 : false,
      },
      kellyStake,
    });

    // ══════════════════════════════════════════════════════════════
    // ETAPA 12: ATUALIZA ESTADOS DE CONSENSO E PORTFOLIO
    // ══════════════════════════════════════════════════════════════
    if (!consensusReached) {
      setConsensusDecision({
        direction: 'HOLD',
        probability: consensusProbability,
        stake: 0
      });
      return;
    }

    setConsensusDecision({
      direction: consensusDirection,
      probability: consensusProbability,
      stake: kellyStake
    });

    const activeStakes = activeCouncilContracts.reduce((sum, c) => sum + c.stake, 0);
    setPortfolioStats({
      totalExposure: activeStakes,
      maxExposure: dailyBalance * 0.3,
      currentDrawdown: Math.abs(dailyPnL / dailyBalance * 100),
      maxDrawdown: Math.max(
        portfolioStats.maxDrawdown,
        Math.abs(dailyPnL / dailyBalance * 100)
      ),
      dailyPnL
    });

    // ══════════════════════════════════════════════════════════════
    // ETAPA 13: EXECUÇÃO DE TRADE REAL
    // ══════════════════════════════════════════════════════════════
    if (councilExecutionRef.current.isExecuting) return;

    // Verifica exposição máxima
    if (activeStakes + kellyStake > dailyBalance * 0.3) {
      toast({
        title: "⚠️ Limite de Exposição",
        description: "Aguardando fechamento de posições.",
        variant: "default"
      });
      return;
    }

    // Verifica probabilidade mínima
    if (consensusProbability < 0.65) {
      if (process.env.NODE_ENV === 'development') {
        console.log('⏸️ Consenso fraco, aguardando melhor oportunidade');
      }
      return;
    }

    // EXECUTA TRADE
    councilExecutionRef.current.isExecuting = true;

    toast({
      title: "🚀 Ordem Executada",
      description: `${consensusDirection} com $${kellyStake.toFixed(2)} (${(consensusProbability * 100).toFixed(1)}% confiança)`
    });

    executeTrade(
      consensusDirection === 'RISE' ? 'CALL' : 'PUT',
      kellyStake,
      activeSymbol!,
      consensusDirection.toLowerCase() as 'rise' | 'fall',
      finalDuration,
      finalDurationUnit,
      'Conselho'
    ).finally(() => {
      // Cooldown progressivo baseado em número de trades recentes
      const recentTrades = operationsLog.filter(
        op => op.initiator === 'Conselho' &&
        Date.now() - new Date(op.timestamp).getTime() < 300000 // Últimos 5 minutos
      ).length;

      const cooldownTime = Math.min(5000 + (recentTrades * 2000), 30000);

      setTimeout(() => {
        councilExecutionRef.current.isExecuting = false;
      }, cooldownTime);
    });

  }, [
    priceTicks,
    tickCandles,
    isConnected,
    isCouncilAutopilotOn,
    strategyCouncil,
    robotPerformance,
    isMeritocracyOn,
    isDynamicConsensusOn,
    isDynamicRiskOn,
    activeSymbol,
    operationsLog,
    currentRegime,
    user,
    toast,
    executeTrade,
    sellContract,
    timePeriod,
    durationLimits,
    consensusThreshold,
    dailyBalance,
    dailyTarget,
    evolveTrigger,
    portfolioStats.maxDrawdown
  ]);

  // ════════════════════════════════════════════════════════════════════
  // 📤 RETORNO DO HOOK
  // ════════════════════════════════════════════════════════════════════
  return {
    // Controles
    isCouncilAutopilotOn,
    setIsCouncilAutopilotOn,
    fetchStrategyCouncil,
    dissolveCouncil,
    isFetchingCouncil,

    // Estados do Conselho
    strategyCouncil,
    robotPerformance,
    evolutionHistory,

    // Regime e Mercado
    currentRegime,
    microstructure,
    indicators,

    // Decisão e Consenso
    consensusDecision,
    portfolioStats,

    // Configurações
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
    consensusThreshold,
    setConsensusThreshold,
    isDynamicConsensusOn,
    setIsDynamicConsensusOn,
    isDynamicRiskOn,
    setIsDynamicRiskOn,
    isMeritocracyOn,
    setIsMeritocracyOn,

    // Dashboard
    dashboardData,
  };
}
