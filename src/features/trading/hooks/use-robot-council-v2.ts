// src/features/trading/hooks/use-robot-council-v2.ts
'use client';

/**
 * 🧠 DERIV TRADER V2.5 - CÉREBRO COGNITIVO (VERSÃO MESTRE OTIMIZADA)
 * =================================================================================
 * Otimizações de Prioridade 1 implementadas:
 * 
 * 1. THRESHOLDS ALINHADOS:
 *    - MIN_PAPER_CONFIDENCE ajustado para 60 para treino realista.
 *    - MIN_REAL_CONFIDENCE (confidenceFactor) em 70.
 * 
 * 2. PONDERAÇÃO EXPONENCIAL:
 *    - O peso de um robô agora cresce exponencialmente com seu Sharpe Ratio.
 *    - Robôs com Sharpe negativo são severamente penalizados.
 *    - Robôs não testados têm influência mínima.
 * 
 * 3. KELLY CRITERION AVANÇADO:
 *    - A probabilidade de consenso é ajustada pela confiança do regime de mercado.
 *    - Boost de 30% para sinais de altíssima convicção.
 *    - Penalização por entropia: stake é reduzido se o consenso for incerto.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { useToast } from '@/hooks/use-toast';
import type { 
  RobotStrategy, DurationUnit, TickData, CandleData,
  RobotVote as RobotVoteType, MarketRegime, MicrostructureFeatures,
  BayesianVote as BayesianVoteType, EnhancedRobotPerformance as EnhancedRobotPerformanceType,
  TimePeriod, TradeDecisionLog,
} from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance, saveTradeDecision, saveEvolutionHistory, clearEvolutionHistory, deleteEvolutionEvent } from '@/services/financial-data-service';
import { useStrategyEvolution } from './use-strategy-evolution-v2';
import { initialCouncilStrategies } from '@/services/council-strategies';
import {
  detectMarketRegime, calculateKellyStake, bayesianUpdate,
  extractMicrostructureFeatures, calculatePerformanceMetrics,
  calculateShannonEntropy,
  type RegimeDetectionResult,
} from '@/services/advanced-trading-services';
import { TRADER_CONFIG, ARENA_CONFIG, RISK_CONFIG } from '@/features/trading/config/trader-config';


// ════════════════════════════════════════════════════════════════════
// 2. DEFINIÇÃO DE TIPOS
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

export interface CouncilState {
    indicators: Indicators | null;
    currentRegime: {
        regime: MarketRegime;
        confidence: number;
        probabilities: Record<MarketRegime, number>;
    };
    microstructure: MicrostructureFeatures | null;
    consensusDecision: {
        direction: 'RISE' | 'FALL' | 'HOLD';
        probability: number;
        stake: number;
    };
    portfolioStats: {
        totalExposure: number;
        maxExposure: number;
        currentDrawdown: number;
        maxDrawdown: number;
        dailyPnL: number;
    };
    bayesianVotes: Record<string, BayesianVote>;
    dashboardData: DashboardData | null;
    effectiveThreshold: number;
    councilConfidence: number;
    systemMetrics: SystemMetrics;
    robotPerformance: EnhancedRobotPerformance[];
    consensusReached: boolean;
    consensusSum: { rise: number, fall: number};
    totalWeight: number;
    virtualTradeCount: number; // NOVO: Gatilho de renderização
}

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

export interface SystemMetrics {
  activeVirtualTrades: number;
  totalVirtualTrades: number;
  decisionLogCount: number;
  activeRobotsCount: number;
  memoryUsageMB: number;
  isExecuting: boolean;
  lastCleanup: number;
  orphanedTradesRemoved: number;
  sessionDuration: number;
}

// ════════════════════════════════════════════════════════════════════
// 3. FUNÇÕES UTILITÁRIAS
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

const validateCandles = (candles: CandleData[]): CandleData[] => {
  if (!candles || !Array.isArray(candles)) return [];
  return candles.filter(c => c && c.epoch > 0 && c.close > 0 && Number.isFinite(c.close) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low));
};

// ════════════════════════════════════════════════════════════════════
// 4. LÓGICA TÉCNICA OTIMIZADA (DYNAMIC DURATION & STAKE)
// ════════════════════════════════════════════════════════════════════

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
  let reason = 'Aguardando...';
  
  // INICIALIZAÇÃO com valores padrão da estratégia
  let dynamicDuration = robot.optimalDuration;
  let dynamicUnit = robot.optimalDurationUnit;
  
  if (indicators.atr && indicators.bbw) {
      const volatilityScore = indicators.bbw; 
      if (volatilityScore > 0.5) {
          dynamicDuration = Math.max(1, Math.floor(robot.optimalDuration / 2));
      } else if (volatilityScore < 0.1) {
          dynamicDuration = robot.optimalDuration * 2;
      }
  }

  const baseStake = 1.0;
  let suggestedStake = baseStake;

  if (!indicators || tickCandles.length < 2) {
    return { vote: 'HOLD', confidence: 0, reason: "Dados insuficientes", optimalDuration: dynamicDuration, optimalDurationUnit: dynamicUnit, suggestedStake: 0 };
  }

  const lastCandle = tickCandles[tickCandles.length - 1];
  const lastClose = lastCandle.close;
  
  const setVote = (newVote: 'RISE' | 'FALL', newConfidence: number, newReason: string) => {
    if (newConfidence <= 0) return;
    vote = newVote;
    confidence = newConfidence;
    reason = newReason;
    suggestedStake = baseStake * (1 + (newConfidence / 100)); 
  };

  const { 
    rsi, stoch, macd, bb, ma, adx, pdi, ndi, stochRSI, mfi, rvi, 
    ao: awesomeOscillator, trix, roc, psar: parabolicSAR, ichimoku, kama, donchian, chandelier, 
    vwap, obv, zScore 
  } = indicators;

  try {
      if (robot.strategyType === 'RSI' && isValid(rsi)) {
        if (rsi <= robot.strongBuyThreshold!) setVote('RISE', 93, `RSI Extremo Baixo`);
        else if (rsi <= robot.weakBuyThreshold!) setVote('RISE', 45, `RSI Baixo`);
        else if (rsi >= robot.strongSellThreshold!) setVote('FALL', 93, `RSI Extremo Alto`);
        else if (rsi >= robot.weakSellThreshold!) setVote('FALL', 45, `RSI Alto`);
      }
      
      else if (robot.strategyType === 'STOCHASTIC' && isValid(stoch)) {
        if (stoch <= robot.strongBuyThreshold!) setVote('RISE', 80, `Stoch Sobrevenda`);
        else if (stoch >= robot.strongSellThreshold!) setVote('FALL', 80, `Stoch Sobrecompra`);
      }
      
      else if (robot.strategyType === 'MACD_CROSS' && isValid(macd?.macd) && isValid(macd?.signal)) {
        if (macd.macd > macd.signal) setVote('RISE', 60, `MACD Cruzou UP`);
        else if (macd.macd < macd.signal) setVote('FALL', 60, `MACD Cruzou DOWN`);
      }
      
      else if (robot.strategyType === 'ADX_TREND' && isValid(adx) && isValid(pdi) && isValid(ndi)) {
        if (pdi > ndi && adx > 20) setVote('RISE', 50 + adx, `Tendência Bullish`);
        else if (ndi > pdi && adx > 20) setVote('FALL', 50 + adx, `Tendência Bearish`);
      }
      
      else if (robot.strategyType === 'BOLLINGER_BANDS' && isValid(bb?.lower) && isValid(bb?.upper)) {
        if (lastClose <= bb.lower) setVote('RISE', 75, `Banda Inferior`);
        else if (lastClose >= bb.upper) setVote('FALL', 75, `Banda Superior`);
      }

      else if (robot.strategyType === 'TRIX' && isValid(trix)) {
          if(trix > indicators.trixPrev!) setVote('RISE', 55, 'TRIX Acelerando');
          else setVote('FALL', 55, 'TRIX Desacelerando');
      }

      else if (robot.strategyType === 'ICHIMOKU_CLOUD' && isValid(ichimoku?.tenkan) && isValid(ichimoku?.kijun)) {
          if(ichimoku.tenkan > ichimoku.kijun) setVote('RISE', 65, 'TK Cross UP');
          else setVote('FALL', 65, 'TK Cross DOWN');
      }

      else if (robot.strategyType === 'PRICE_ACTION_PATTERN') {
          const body = Math.abs(lastClose - lastCandle.open);
          const lowerShadow = Math.min(lastClose, lastCandle.open) - lastCandle.low;
          if (lowerShadow > body) setVote('RISE', 60, 'Rejeição de Fundo');
          else setVote('FALL', 40, 'Pressão Vendedora');
      }

      else if (robot.strategyType === 'STOCH_RSI' && isValid(stochRSI)) {
          if (stochRSI < 0.2) setVote('RISE', 70, 'StochRSI Sobrevenda');
          else if (stochRSI > 0.8) setVote('FALL', 70, 'StochRSI Sobrecompra');
      }
      
      else if (isValid(rsi)) {
          if (rsi < 45) setVote('RISE', 35, 'Zona de Compra (Genérico)');
          else if (rsi > 55) setVote('FALL', 35, 'Zona de Venda (Genérico)');
      }

  } catch (e) {
      console.warn(`[Vote] Erro na estratégia ${robot.strategyType}:`, e);
  }

  return { vote, confidence, reason, optimalDuration: dynamicDuration, optimalDurationUnit: dynamicUnit, suggestedStake };
};

// ════════════════════════════════════════════════════════════════════
// 5. HOOK PRINCIPAL
// ════════════════════════════════════════════════════════════════════

export function useRobotCouncilV2(
  activeSymbol: string | null,
  priceTicks: TickData[],
  chartData: CandleData[],
  dataVersion: number
) {
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits, sellContract } = useDerivApiV2();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const { 
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
  } = useStrategyEvolution(initialCouncilStrategies);
  
  const executionIdRef = useRef(0);
  const processedRealTradesRef = useRef<Set<number>>(new Set());
  
  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>([]);
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
  const [tradeDecisionLog, setTradeDecisionLog] = useState<TradeDecisionLog[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  // NOVO: Gatilho de renderização para a UI
  const [virtualTradeCount, setVirtualTradeCount] = useState(0);
  
  const [councilState, setCouncilState] = useState<Omit<CouncilState, 'virtualTradeCount'>>({
    indicators: null,
    currentRegime: { regime: 'ranging', confidence: 0, probabilities: { trending_bull: 0.2, trending_bear: 0.2, ranging: 0.4, high_volatility: 0.1, breakout: 0.1 } },
    microstructure: null,
    consensusDecision: { direction: 'HOLD', probability: 0.5, stake: 0 },
    portfolioStats: { totalExposure: 0, maxExposure: 0, currentDrawdown: 0, maxDrawdown: 0, dailyPnL: 0 },
    bayesianVotes: {},
    dashboardData: null,
    effectiveThreshold: 0,
    councilConfidence: 0,
    systemMetrics: {
        activeVirtualTrades: 0, totalVirtualTrades: 0, decisionLogCount: 0, activeRobotsCount: 0,
        memoryUsageMB: 0, isExecuting: false, lastCleanup: Date.now(), orphanedTradesRemoved: 0, sessionDuration: 0,
    },
    robotPerformance: [],
    consensusReached: false,
    consensusSum: { rise: 0, fall: 0 },
    totalWeight: 0,
  });

  const [robotPerformance, setRobotPerformance] = useState<EnhancedRobotPerformance[]>([]);
  const robotPerformanceRef = useRef<EnhancedRobotPerformance[]>([]);
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  
  const lastRegimeRef = useRef<MarketRegime>('ranging');
  
  // Cache para o Regime de Mercado
  const regimeCacheRef = useRef<{ result: RegimeDetectionResult; timestamp: number } | null>(null);
  
  // NOVO: Histórico para Meta-Regime
  const regimeHistoryRef = useRef<MarketRegime[]>([]);
  const MAX_REGIME_HISTORY = 50;

  // Configurações
  const [dailyBalance, setDailyBalance] = useState(100); 
  const [dailyTarget, setDailyTarget] = useState(50);
  const [isDynamicConsensusOn, setIsDynamicConsensusOn] = useState(true);
  const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true);
  const [isMeritocracyOn, setIsMeritocracyOn] = useState(true);
  const [isDynamicExitOn, setIsDynamicExitOn] = useState(true);
  const [consensusSensitivity, setConsensusSensitivity] = useState(60); 
  const [confidenceFactor, setConfidenceFactor] = useState(RISK_CONFIG.MIN_REAL_CONFIDENCE);
  const [durationRange, setDurationRange] = useState<[number, number]>([15, 300]); 
  const [takeProfitThreshold, setTakeProfitThreshold] = useState(10);
  const [stopLossThreshold, setStopLossThreshold] = useState(20);

  const councilExecutionRef = useRef<{ isExecuting: boolean; sellingContracts: Set<number>; }>({
    isExecuting: false, sellingContracts: new Set()
  });

  useEffect(() => {
    setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
  }, [evolvedStrategies]);
  
  const resetArenaPerformance = useCallback(() => {
    if (strategyCouncil.length === 0) return;
    const initialPerformance: EnhancedRobotPerformance[] = strategyCouncil.map(robot => {
        if (!robot.id) throw new Error("Robô sem ID no reset!");
        return {
          id: robot.id, strategyType: robot.strategyType, strategy: robot, wins: 0, losses: 0, totalProfit: 0, winRate: 0,
          sharpeRatio: 0, maxDrawdown: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, kellyFraction: 0, effectiveRegimes: [],
          monteCarloScore: 0, lastUpdated: Date.now(), tradeHistory: []
        };
    });
    console.log(`[Arena Reset] ${initialPerformance.length} robôs inicializados com tradeHistory vazio`);
    robotPerformanceRef.current = initialPerformance;
    setRobotPerformance(initialPerformance);
    virtualTradesRef.current = [];
    setVirtualTradeCount(0); // Reseta o contador
  }, [strategyCouncil]);

  useEffect(() => {
    if (!user || isAuthLoading) return;
    loadRobotPerformance(user.uid, 'v2').then((stored) => {
        if (stored && stored.length > 0) {
            robotPerformanceRef.current = stored;
            setRobotPerformance(stored);
        } else {
            resetArenaPerformance();
        }
    }).catch(console.error);
  }, [user, isAuthLoading, resetArenaPerformance]);

  const fetchStrategyCouncil = useCallback(async () => {
    if (!activeSymbol) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Selecione um ativo.' });
      return;
    }
    setIsFetchingCouncil(true);
    await new Promise((r) => setTimeout(r, 500));
    
    setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
    resetArenaPerformance();
    
    setSessionStartTime(Date.now());
    setIsCouncilAutopilotOn(true);
    setIsFetchingCouncil(false);
    toast({ title: '🚀 Sistema V2.5 Iniciado', description: 'Monitoramento em tempo real ativo.' });
  }, [activeSymbol, evolvedStrategies, resetArenaPerformance, toast]);

  const dissolveCouncil = useCallback(() => {
    setIsCouncilAutopilotOn(false);
    setSessionStartTime(null);
    toast({ title: '⏸️ Sistema Pausado', description: 'Mesa Operacional suspensa.' });
  }, [toast]);
  

  const validCandles = useMemo(() => validateCandles(chartData), [chartData]);

  const memoizedIndicators = useMemo(() => {
    const lastCandleEpoch = validCandles[validCandles.length - 1]?.epoch;
    if (!lastCandleEpoch) return null;
    return calculateAllIndicators(validCandles, strategyCouncil, timePeriod, { duration: 5, unit: 'm' });
  }, [validCandles, timePeriod, strategyCouncil]);


  const runCouncilCycle = useCallback(() => {
    if (!isCouncilAutopilotOn || !isConnected || !activeSymbol) return;
    
    if (validCandles.length < TRADER_CONFIG.REGIME_LOOKBACK || priceTicks.length === 0) return;

    if (councilExecutionRef.current.isExecuting) return; 
    councilExecutionRef.current.isExecuting = true;
    executionIdRef.current++;

    try {
        const currentTick = priceTicks[priceTicks.length - 1];
        if (!currentTick) throw new Error("Tick indisponível");

        const currentIndicators = memoizedIndicators;
        if (!currentIndicators) {
            councilExecutionRef.current.isExecuting = false;
            return;
        }
        
        if (isDynamicExitOn) {
            const activeCouncilContracts = operationsLog.filter(op => 
                op.status === 'pending' && 
                op.initiator === 'Conselho' &&
                op.durationUnit !== 't'
            );

            activeCouncilContracts.forEach(contract => {
                if (councilExecutionRef.current.sellingContracts.has(contract.id)) return;

                const chandelier = currentIndicators.chandelier;
                const exitPrice = contract.direction === 'rise' ? chandelier?.exitLong : chandelier?.exitShort;

                let shouldSell = false;
                let reason = '';

                // 1. Chandelier Exit (Stop de Volatilidade)
                if (exitPrice) {
                    if (contract.direction === 'rise' && currentTick.price < exitPrice) {
                        shouldSell = true;
                        reason = 'Stop de Volatilidade Atingido (Chandelier)';
                    } else if (contract.direction === 'fall' && currentTick.price > exitPrice) {
                        shouldSell = true;
                        reason = 'Stop de Volatilidade Atingido (Chandelier)';
                    }
                }

                // 2. Mudança de Regime (Stop de Contexto)
                const tradeLog = tradeDecisionLog.find(l => l.contractId === contract.id);
                if (tradeLog) {
                    const entryRegime = tradeLog.context.marketRegime;
                    const currentRegime = lastRegimeRef.current;

                    const isContradictory =
                        (entryRegime === 'trending_bull' && currentRegime === 'trending_bear') ||
                        (entryRegime === 'trending_bear' && currentRegime === 'trending_bull');

                    if (isContradictory) {
                        shouldSell = true;
                        reason = `Inversão de Regime de Mercado (de ${entryRegime} para ${currentRegime})`;
                    }
                }

                if (shouldSell) {
                    councilExecutionRef.current.sellingContracts.add(contract.id);
                    sellContract(contract.id).finally(() => {
                        setTimeout(() => councilExecutionRef.current.sellingContracts.delete(contract.id), 10000);
                    });
                    toast({
                        title: "🛡️ Proteção de Posição Ativada",
                        description: `Contrato #${contract.id} fechado. Motivo: ${reason}`,
                        variant: "destructive"
                    });
                }
            });
        }
        
        const now = Date.now();
        const REGIME_CACHE_TTL = 5000; // 5 segundos
        let regimeResult: RegimeDetectionResult;

        if (regimeCacheRef.current && (now - regimeCacheRef.current.timestamp < REGIME_CACHE_TTL)) {
            regimeResult = regimeCacheRef.current.result;
        } else {
             regimeResult = detectMarketRegime(
                validCandles,
                { adx: currentIndicators.adx, pdi: currentIndicators.pdi, ndi: currentIndicators.ndi, bbw: currentIndicators.bbw, roc: currentIndicators.roc, atr: currentIndicators.atr },
                lastRegimeRef.current,
                undefined
            );
            regimeCacheRef.current = { result: regimeResult, timestamp: now };
        }
        
        lastRegimeRef.current = regimeResult.regime;
        
        regimeHistoryRef.current.push(regimeResult.regime);
        if (regimeHistoryRef.current.length > MAX_REGIME_HISTORY) {
            regimeHistoryRef.current.shift();
        }

        const microFeatures = extractMicrostructureFeatures(priceTicks, validCandles);

        let performanceChanged = false;
        let removedOrphanedCount = 0;
        
        const tradesToRemoveIndices: number[] = [];
        virtualTradesRef.current.forEach((trade, index) => {
            const isExpired = currentTick.epoch >= trade.exitEpoch;
            const isOrphaned = (currentTick.epoch - trade.entryEpoch) > TRADER_CONFIG.TRADE_TIMEOUT_SECONDS;
            if (isExpired || isOrphaned) {
                tradesToRemoveIndices.push(index);
                if (isOrphaned) removedOrphanedCount++;

                const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;
                const exitPrice = exitTick.price;
                const isWin = (trade.vote === 'RISE' && exitPrice > trade.entryPrice) || (trade.vote === 'FALL' && exitPrice < trade.entryPrice);
                
                const perfIndex = robotPerformanceRef.current.findIndex(p => p.id === trade.robotId);
                
                if (perfIndex !== -1) {
                    const perf = robotPerformanceRef.current[perfIndex];
                    const pnl = isWin ? ARENA_CONFIG.VIRTUAL_STAKE * 0.95 : -ARENA_CONFIG.VIRTUAL_STAKE;
                    perf.wins += (isWin ? 1 : 0);
                    perf.losses += (isWin ? 0 : 1);
                    perf.totalProfit += pnl;
                    perf.tradeHistory.push({ profit: pnl, regime: trade.regime, timestamp: Date.now() });
                    perf.lastUpdated = Date.now();
                    
                    const metrics = calculatePerformanceMetrics(perf.tradeHistory);
                    
                    robotPerformanceRef.current[perfIndex] = { ...perf, ...metrics };
                    performanceChanged = true;
                }
            }
        });
        
        if (tradesToRemoveIndices.length > 0) {
            for (let i = tradesToRemoveIndices.length - 1; i >= 0; i--) {
                virtualTradesRef.current.splice(tradesToRemoveIndices[i], 1);
            }
            if (tradesToRemoveIndices.length > 0) {
                evolveTrigger(robotPerformanceRef.current, 'virtual', tradesToRemoveIndices.length);
            }
        }
        
        const lastRealOperation = operationsLog.find(op => 
            op.status !== 'pending' && 
            op.initiator === 'Conselho' && 
            !processedRealTradesRef.current.has(op.id)
        );

        if (lastRealOperation) {
             const log = tradeDecisionLog.find(l => l.contractId === lastRealOperation.id);
             if (log) {
                 const pnl = lastRealOperation.result || 0;
                 const votingRobots = Object.keys(log.consensus.votes);
                 
                 votingRobots.forEach(robotId => {
                     const perfIndex = robotPerformanceRef.current.findIndex(p => p.id === robotId);
                     if (perfIndex !== -1) {
                         const perf = robotPerformanceRef.current[perfIndex];
                         perf.wins += (pnl > 0 ? 1 : 0);
                         perf.losses += (pnl <= 0 ? 1 : 0);
                         perf.totalProfit += pnl;
                         perf.tradeHistory.push({ profit: pnl, regime: log.context.marketRegime as MarketRegime, timestamp: Date.now() });
                         const metrics = calculatePerformanceMetrics(perf.tradeHistory);
                         robotPerformanceRef.current[perfIndex] = { ...perf, ...metrics };
                         performanceChanged = true;
                     }
                 });
                 
                 processedRealTradesRef.current.add(lastRealOperation.id);
                 evolveTrigger(robotPerformanceRef.current, 'real', 1);
             }
        }


        if (performanceChanged) {
            const updatedPerformance = Array.from(robotPerformanceRef.current);
            setRobotPerformance(updatedPerformance);
        }
        
        let riseSum = 0, fallSum = 0, totalWeight = 0;
        let activeRobotsCount = 0;
        const localBayesianVotes: Record<string, BayesianVote> = {};

        strategyCouncil.forEach(robot => {
            const robotId = robot.id;
            if (!robotId) return;

            const technicalVote = calculateTechnicalVote(robot, currentIndicators, validCandles);
            const hasActiveTrade = virtualTradesRef.current.some(t => t.robotId === robotId);

            if (technicalVote.confidence >= confidenceFactor && technicalVote.vote !== 'HOLD') {
                const perf = robotPerformanceRef.current.find(p => p.id === robotId);
                
                let weight = 0.01;
                if (isMeritocracyOn && perf && (perf.wins + perf.losses) >= 10) {
                    if (perf.sharpeRatio > 0) {
                        weight = Math.pow(1 + perf.sharpeRatio, 2);
                    } else {
                        weight = Math.exp(perf.sharpeRatio); 
                    }
                }
                
                const winRate = perf?.winRate ?? 50; 
                const posterior = bayesianUpdate(winRate/100, technicalVote.confidence/100);
                const voteWeight = posterior * weight;
                
                if (technicalVote.vote === 'RISE') riseSum += voteWeight;
                if (technicalVote.vote === 'FALL') fallSum += voteWeight;
                totalWeight += voteWeight;
                
                localBayesianVotes[robotId] = {
                    ...technicalVote,
                    rawConfidence: technicalVote.confidence,
                    calibratedConfidence: posterior * 100,
                    bayesianProbability: posterior,
                    weight,
                    regime: regimeResult.regime,
                    strategy: robot,
                    sharpeRatio: perf?.sharpeRatio || 0
                };
                activeRobotsCount++;
                
                if (!hasActiveTrade && technicalVote.confidence >= ARENA_CONFIG.MIN_PAPER_CONFIDENCE) {
                    const durationSec = Math.min(durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit), 300);
                    virtualTradesRef.current.push({
                        id: `vt-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                        robotId: robotId,
                        vote: technicalVote.vote,
                        entryPrice: currentTick.price,
                        entryEpoch: currentTick.epoch,
                        exitEpoch: currentTick.epoch + durationSec,
                        regime: regimeResult.regime,
                        microstructure: microFeatures!,
                        stake: technicalVote.suggestedStake
                    });
                }
            }
        });
        
        let consensusDirection: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
        let consensusProbability = 0.5;
        if (totalWeight > 0) {
            consensusProbability = Math.max(riseSum, fallSum) / totalWeight;
            if (riseSum > fallSum) consensusDirection = 'RISE';
            else if (fallSum > riseSum) consensusDirection = 'FALL';
        }

        const calculatedEffectiveThreshold = (totalWeight * (consensusSensitivity / 100));
        const consensusReached = totalWeight > 0 && Math.max(riseSum, fallSum) >= calculatedEffectiveThreshold;
        
        const memoryUsageMB = (typeof performance !== 'undefined' && (performance as any).memory) 
            ? (performance as any).memory.usedJSHeapSize / (1024 * 1024) 
            : 0;

        const currentSessionDuration = sessionStartTime ? (Date.now() - sessionStartTime) / 1000 : 0;
        
        let kellyStake = 0;
        if (isDynamicRiskOn) {
            const edgeAdjustedProb = consensusProbability * regimeResult.confidence;
            kellyStake = calculateKellyStake(dailyBalance, edgeAdjustedProb, 0.95);

            const volatilityFactor = (currentIndicators.atr || 0) / currentTick.price + (currentIndicators.bbw || 0);
            const volAdjustment = Math.exp(-volatilityFactor * RISK_CONFIG.VOLATILITY_ADJUSTMENT_FACTOR);
            kellyStake *= volAdjustment;

            if (consensusProbability > RISK_CONFIG.AGGRESSIVE_THRESHOLD / 100 && regimeResult.confidence > 0.8) {
                kellyStake *= RISK_CONFIG.AGGRESSIVE_BOOST_FACTOR;
            }

            const entropy = calculateShannonEntropy(riseSum, fallSum);
            const certaintyFactor = 1 - entropy;
            kellyStake *= (0.5 + certaintyFactor * 0.5);
            
            if (microFeatures) {
                const pressureIntensity = Math.abs(microFeatures.volumeImbalance - 0.5);
                const isContraryPressure = (microFeatures.pressure === 'sell' && consensusDirection === 'RISE') || 
                                           (microFeatures.pressure === 'buy' && consensusDirection === 'FALL');
            
                if (isContraryPressure) {
                    const reductionFactor = 1 - pressureIntensity * 1.5; 
                    kellyStake *= Math.max(0.25, reductionFactor);
                }
            }
            
            if (regimeHistoryRef.current.length >= 20) {
              const countRegimeChanges = (history: MarketRegime[]) => {
                return history.reduce((count, regime, i) => {
                  if (i > 0 && regime !== history[i - 1]) return count + 1;
                  return count;
                }, 0);
              };
              const changes = countRegimeChanges(regimeHistoryRef.current);
              const changeRate = changes / regimeHistoryRef.current.length;
              
              if (changeRate > 0.5) {
                kellyStake *= 0.5;
              } else if (changeRate < 0.15) {
                kellyStake *= 1.2;
              }
            }
        } else {
             kellyStake = 1.0; // Stake fixo se o risco dinâmico estiver desligado
        }
        
        kellyStake = Math.max(RISK_CONFIG.MIN_STAKE, kellyStake);

        setCouncilState(prev => ({
            ...prev,
            indicators: currentIndicators,
            currentRegime: regimeResult,
            microstructure: microFeatures,
            consensusDecision: { direction: consensusDirection, probability: consensusProbability, stake: kellyStake },
            bayesianVotes: localBayesianVotes,
            systemMetrics: {
                ...prev.systemMetrics,
                sessionDuration: currentSessionDuration,
                activeVirtualTrades: virtualTradesRef.current.length,
                totalVirtualTrades: prev.systemMetrics.totalVirtualTrades + tradesToRemoveIndices.length,
                activeRobotsCount,
                orphanedTradesRemoved: prev.systemMetrics.orphanedTradesRemoved + removedOrphanedCount,
                lastCleanup: removedOrphanedCount > 0 ? Date.now() : prev.systemMetrics.lastCleanup,
                memoryUsageMB,
            },
            robotPerformance: [...robotPerformanceRef.current],
            consensusReached,
            consensusSum: { rise: riseSum, fall: fallSum },
            totalWeight,
            effectiveThreshold: calculatedEffectiveThreshold
        }));
        
        setVirtualTradeCount(virtualTradesRef.current.length);

        if (consensusReached && consensusDirection !== 'HOLD' && user && consensusProbability > 0.52) {
             if (kellyStake > 0) {
                 
                 const votingRobots = Object.values(localBayesianVotes).filter(v => v.vote === consensusDirection);
                 const totalConfidence = votingRobots.reduce((sum, v) => sum + v.bayesianProbability, 0);

                 let weightedAvgDuration = totalConfidence > 0 
                    ? votingRobots.reduce((sum, v) => sum + durationToSeconds(v.optimalDuration, v.optimalDurationUnit) * v.bayesianProbability, 0) / totalConfidence
                    : durationRange[0];
                
                if (currentIndicators.bbw && currentIndicators.bbw > 0.08) weightedAvgDuration *= 0.75;
                else if (currentIndicators.bbw && currentIndicators.bbw < 0.02) weightedAvgDuration *= 1.25;

                let finalDuration = Math.round(weightedAvgDuration);
                let finalDurationUnit: DurationUnit = 's';
                
                if (durationLimits) {
                    const canUseTicks = durationLimits.t.min > 0;
                    if (canUseTicks && finalDuration <= 20) {
                        finalDurationUnit = 't';
                        finalDuration = Math.max(durationLimits.t.min, Math.round(finalDuration / 2));
                        finalDuration = Math.min(finalDuration, durationLimits.t.max);
                    } else {
                        finalDurationUnit = 's';
                        finalDuration = Math.max(durationLimits.s.min, finalDuration);
                        finalDuration = Math.min(finalDuration, durationLimits.s.max);
                    }
                } else {
                    finalDuration = Math.max(15, finalDuration);
                }

                 executeTrade(
                    consensusDirection === 'RISE' ? 'CALL' : 'PUT',
                    kellyStake,
                    activeSymbol,
                    consensusDirection.toLowerCase() as 'rise' | 'fall',
                    finalDuration,
                    finalDurationUnit,
                    'Conselho'
                ).then(tradeResult => {
                     if(tradeResult.success && tradeResult.contractId) {
                         const logId = `log-${Date.now()}`;
                         const log: TradeDecisionLog = {
                            id: logId,
                            contractId: tradeResult.contractId,
                            timestamp: new Date().toISOString(),
                            asset: activeSymbol,
                            timePeriod: timePeriod,
                            tradeParams: {
                                direction: consensusDirection,
                                stake: kellyStake,
                                duration: finalDuration,
                                durationUnit: finalDurationUnit
                            },
                            context: {
                                marketRegime: regimeResult.regime,
                                regimeConfidence: regimeResult.confidence,
                                microstructure: microFeatures,
                                indicators: currentIndicators,
                                supervisionReason: 'Execução Automática V2.5',
                                payout: kellyStake * 0.95,
                                entryPrice: tradeResult.entryPrice,
                            },
                            consensus: {
                                bayesianProbability: consensusProbability,
                                kellyStake: kellyStake,
                                activeRobots: activeRobotsCount,
                                votes: localBayesianVotes,
                            },
                            result: 'pending',
                            pnl: 0,
                         };

                         saveTradeDecision(user.uid, log, 'v2');
                         setTradeDecisionLog(prev => [log, ...prev]);
                     }
                });
             }
        }

    } catch (error) {
        console.error("🚨 [Council Error]", error);
    } finally {
        councilExecutionRef.current.isExecuting = false;
    }

  }, [
    isCouncilAutopilotOn, isConnected, activeSymbol, validCandles, priceTicks, 
    strategyCouncil, timePeriod, confidenceFactor, isMeritocracyOn, consensusSensitivity, dailyBalance, sessionStartTime, user, durationRange, executeTrade, evolveTrigger, durationLimits, sellContract, toast, tradeDecisionLog, isDynamicExitOn, memoizedIndicators
  ]);

  useEffect(() => {
    if (!isCouncilAutopilotOn) return;

    const intervalId = setInterval(runCouncilCycle, TRADER_CONFIG.THROTTLE_MS);

    return () => clearInterval(intervalId);
  }, [isCouncilAutopilotOn, runCouncilCycle]);

  return {
    isCouncilAutopilotOn,
    setIsCouncilAutopilotOn,
    fetchStrategyCouncil,
    dissolveCouncil,
    isFetchingCouncil,
    strategyCouncil,
    robotPerformance,
    evolutionHistory,
    isEvolving,
    evolutionProgress,
    currentGeneration,
    tradesUntilEvolution,
    tradeCounts,
    virtualTradesRef,
    ...councilState,
    virtualTradeCount, // Exporta o contador
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
    isDynamicConsensusOn,
    setIsDynamicConsensusOn,
    isDynamicRiskOn,
    setIsDynamicRiskOn,
    isMeritocracyOn,
    setIsMeritocracyOn,
    isDynamicExitOn,
    setIsDynamicExitOn,
    consensusSensitivity,
    setConsensusSensitivity,
    confidenceFactor,
    setConfidenceFactor,
    durationRange,
    setDurationRange,
    takeProfitThreshold,
    setTakeProfitThreshold,
    stopLossThreshold,
    setStopLossThreshold,
    resetArenaPerformance,
    tradeDecisionLog,
    supervisionStatus: { status: 'approved', message: 'Sistema Operacional v2.5' },
    evolveTrigger,
    resetEvolutionHistory,
    deleteSingleEvolution,
  };
}

// Helper to mark a log as processed without modifying the original array
function markLogAsProcessed(logs: TradeDecisionLog[], contractId: number): TradeDecisionLog[] {
    return logs.map(log => 
        log.contractId === contractId ? { ...log, processed: true } : log
    );
}
