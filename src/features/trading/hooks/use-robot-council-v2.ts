// /src/features/trading/hooks/use-robot-council-v2.ts
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
 * 3. KELLY STAKE AVANÇADO:
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
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service-v2';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance, saveTradeDecision } from '@/services/financial-data-service';
import { useStrategyEvolution } from './use-strategy-evolution';
import { initialCouncilStrategies } from '@/services/council-strategies';
import {
  detectMarketRegime, calculateKellyStake, bayesianUpdate,
  extractMicrostructureFeatures, calculatePerformanceMetrics,
  calculateShannonEntropy,
} from '@/services/advanced-trading-services';

// ════════════════════════════════════════════════════════════════════
// 1. CONSTANTES E AJUSTES FINOS (OTIMIZADOS)
// ════════════════════════════════════════════════════════════════════

const VIRTUAL_STAKE = 1.0; 
const REGIME_LOOKBACK = 30; 
const THROTTLE_MS = 1000; 
const TRADE_TIMEOUT_SECONDS = 3600; 

// ✅ Otimização 1: Limites de Confiança Alinhados
const MIN_PAPER_CONFIDENCE = 60;    // Aumentado para 60 para treinar com sinais mais realistas
const MIN_REAL_CONFIDENCE = 70;  // Mantém conservador para capital real
const AGGRESSIVE_THRESHOLD = 85; // Para oportunidades de alta convicção

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
  return candles.filter(c => c && c.epoch > 0 && c.close > 0);
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
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits } = useDerivApiV2();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);
  
  const executionIdRef = useRef(0);
  
  const tickCandles = useMemo(() => {
    if (chartData && chartData.length >= REGIME_LOOKBACK) return chartData;
    if (priceTicks && priceTicks.length > 0) {
      return priceTicks.map((t) => ({
          epoch: t.epoch, open: t.price, high: t.price, low: t.price, close: t.price, volume: 1 
      }));
    }
    return [];
  }, [chartData, priceTicks]);

  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>(evolvedStrategies as RobotStrategy[]);
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
  const [tradeDecisionLog, setTradeDecisionLog] = useState<TradeDecisionLog[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  const [councilState, setCouncilState] = useState<CouncilState>({
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
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  const lastRegimeRef = useRef<MarketRegime>('ranging');

  // Configurações
  const [dailyBalance, setDailyBalance] = useState(100); 
  const [dailyTarget, setDailyTarget] = useState(50);
  const [isDynamicConsensusOn, setIsDynamicConsensusOn] = useState(true);
  const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true);
  const [isMeritocracyOn, setIsMeritocracyOn] = useState(true);
  const [isDynamicExitOn, setIsDynamicExitOn] = useState(true);
  const [consensusSensitivity, setConsensusSensitivity] = useState(60); 
  const [confidenceFactor, setConfidenceFactor] = useState(MIN_REAL_CONFIDENCE); // ✅ Otimização 1
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
    const initialPerformance: EnhancedRobotPerformance[] = strategyCouncil.map(robot => ({
      id: robot.id, strategyType: robot.strategyType, strategy: robot, wins: 0, losses: 0, totalProfit: 0, winRate: 0,
      sharpeRatio: 0, maxDrawdown: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, kellyFraction: 0, effectiveRegimes: [],
      monteCarloScore: 0, lastUpdated: Date.now(), tradeHistory: []
    }));
    setRobotPerformance(initialPerformance);
    virtualTradesRef.current = [];
  }, [strategyCouncil]);

  useEffect(() => {
    if (!user || isAuthLoading) return;
    loadRobotPerformance(user.uid).then((stored) => {
        if (stored && stored.length > 0) setRobotPerformance(stored as EnhancedRobotPerformance[]);
    }).catch(console.error);
  }, [user, isAuthLoading]);

  const fetchStrategyCouncil = useCallback(async () => {
    if (!activeSymbol) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Selecione um ativo.' });
      return;
    }
    setIsFetchingCouncil(true);
    await new Promise((r) => setTimeout(r, 500));
    
    const council = (evolvedStrategies as RobotStrategy[]).map(s => ({ ...s }));
    setStrategyCouncil(council);
    
    if (robotPerformance.length === 0) resetArenaPerformance();
    
    setSessionStartTime(Date.now());
    setIsCouncilAutopilotOn(true);
    setIsFetchingCouncil(false);
    toast({ title: '🚀 Sistema V2.5 Iniciado', description: 'Monitoramento em tempo real ativo.' });
  }, [activeSymbol, evolvedStrategies, robotPerformance.length, resetArenaPerformance, toast]);

  const dissolveCouncil = useCallback(() => {
    setIsCouncilAutopilotOn(false);
    setSessionStartTime(null);
    toast({ title: '⏸️ Sistema Pausado', description: 'Mesa Operacional suspensa.' });
  }, [toast]);
  
    // EFEITO PARA ATUALIZAR O LOG DE DECISÃO QUANDO UMA OPERAÇÃO É CONCLUÍDA
    useEffect(() => {
        if (!operationsLog || operationsLog.length === 0 || !user) return;
    
        const lastOperation = operationsLog[0];
        
        // Se a última operação está concluída e foi iniciada pelo conselho
        if (lastOperation && lastOperation.status !== 'pending' && lastOperation.initiator === 'Conselho') {
            
            const logIndex = tradeDecisionLog.findIndex(log => log.contractId === lastOperation.id);
            
            // Só atualiza se o log existir e ainda estiver pendente
            if (logIndex !== -1 && tradeDecisionLog[logIndex].result === 'pending') {
                const updatedLog = {
                    ...tradeDecisionLog[logIndex],
                    result: lastOperation.status,
                    pnl: lastOperation.result || 0,
                    context: {
                        ...tradeDecisionLog[logIndex].context,
                        exitPrice: lastOperation.exitPrice,
                    }
                };
                
                const newLogs = [...tradeDecisionLog];
                newLogs[logIndex] = updatedLog;
                
                setTradeDecisionLog(newLogs);
                
                // Persiste a atualização no Firestore
                saveTradeDecision(user.uid, updatedLog);
            }
        }
    }, [operationsLog, tradeDecisionLog, user]);

  const runCouncilCycle = useCallback(() => {
    if (!isCouncilAutopilotOn) return; 
    if (!isConnected || !activeSymbol) return;
    
    const validCandles = validateCandles(tickCandles);
    if (validCandles.length < REGIME_LOOKBACK || priceTicks.length === 0) return;

    if (councilExecutionRef.current.isExecuting) return; 
    councilExecutionRef.current.isExecuting = true;
    executionIdRef.current++;

    try {
        const currentTick = priceTicks[priceTicks.length - 1];
        if (!currentTick) throw new Error("Tick indisponível");

        const currentIndicators = calculateAllIndicators(validCandles, strategyCouncil, timePeriod, { duration: 5, unit: 'm' });
        if (!currentIndicators) {
            councilExecutionRef.current.isExecuting = false;
            return;
        }

        let regimeResult = { regime: lastRegimeRef.current, confidence: 0.5, probabilities: { ranging: 1 } as any };
        if (isValid(currentIndicators.adx)) {
            regimeResult = detectMarketRegime(
                validCandles,
                { adx: currentIndicators.adx, pdi: currentIndicators.pdi, ndi: currentIndicators.bbw, roc: currentIndicators.roc, atr: currentIndicators.atr },
                lastRegimeRef.current,
                undefined
            );
        }
        lastRegimeRef.current = regimeResult.regime;

        const microFeatures = extractMicrostructureFeatures(priceTicks, validCandles);

        const stillActiveTrades: VirtualTrade[] = [];
        let performanceChanged = false;
        let removedOrphanedCount = 0;
        let localRobotPerformance = [...robotPerformance];

        virtualTradesRef.current.forEach(trade => {
            const isExpired = currentTick.epoch >= trade.exitEpoch;
            const isOrphaned = (currentTick.epoch - trade.entryEpoch) > TRADE_TIMEOUT_SECONDS;

            if (isExpired || isOrphaned) {
                if(isOrphaned) removedOrphanedCount++;
                const exitPrice = currentTick.price;
                const isWin = (trade.vote === 'RISE' && exitPrice > trade.entryPrice) || (trade.vote === 'FALL' && exitPrice < trade.entryPrice);
                
                localRobotPerformance = localRobotPerformance.map(p => {
                    if (p.id !== trade.robotId) return p;
                    const pnl = isWin ? trade.stake * 0.95 : -trade.stake;
                    const newWins = p.wins + (isWin ? 1 : 0);
                    const newLosses = p.losses + (isWin ? 0 : 1);
                    const newTradeHistory = [...(p.tradeHistory || []), pnl];
                    const performanceMetrics = calculatePerformanceMetrics(newTradeHistory.map((profit, i) => ({ profit, timestamp: Date.now() - (newTradeHistory.length - i) * 1000 })));

                    return { 
                        ...p, 
                        wins: newWins, 
                        losses: newLosses, 
                        totalProfit: p.totalProfit + pnl,
                        lastUpdated: Date.now(),
                        tradeHistory: newTradeHistory,
                        ...performanceMetrics,
                    };
                });
                performanceChanged = true;
            } else {
                stillActiveTrades.push(trade);
            }
        });
        
        virtualTradesRef.current = stillActiveTrades;
        if (performanceChanged) {
            setRobotPerformance(localRobotPerformance);
            evolveTrigger(localRobotPerformance);
        }

        const localBayesianVotes: Record<string, BayesianVote> = {};
        let riseSum = 0, fallSum = 0, totalWeight = 0;
        let activeRobotsCount = 0;

        strategyCouncil.forEach(robot => {
            const technicalVote = calculateTechnicalVote(robot, currentIndicators, validCandles);
            const safeRobotId = robot.id || robot.strategyType;

            if (technicalVote.vote !== 'HOLD' && technicalVote.confidence >= MIN_PAPER_CONFIDENCE) {
                 const hasActiveTrade = virtualTradesRef.current.some(t => t.robotId === safeRobotId);
                 if (!hasActiveTrade) {
                     const durationSec = durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit);
                     virtualTradesRef.current.push({
                         id: `vt-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                         robotId: safeRobotId,
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
            
            if (technicalVote.confidence >= confidenceFactor) {
                const perf = localRobotPerformance.find(p => p.id === safeRobotId);
                
                // ✅ Otimização 2: Ponderação Exponencial por Sharpe Ratio
                let weight = 0.05; // Peso base para robôs não testados
                if (isMeritocracyOn && perf && (perf.wins + perf.losses) >= 10) {
                    if (perf.sharpeRatio > 0) {
                        weight = Math.pow(1 + perf.sharpeRatio, 2);
                    } else {
                        weight = Math.exp(perf.sharpeRatio); 
                    }
                }

                const winRate = perf ? perf.winRate : 50; 
                const posterior = bayesianUpdate(winRate/100, technicalVote.confidence/100);
                const voteWeight = posterior * weight;
                
                if (technicalVote.vote === 'RISE') riseSum += voteWeight;
                if (technicalVote.vote === 'FALL') fallSum += voteWeight;
                totalWeight += voteWeight;
                
                localBayesianVotes[safeRobotId] = {
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
        
        // ✅ Otimização 3: Cálculo de Kelly Stake Avançado
        const edgeAdjustedProb = consensusProbability * regimeResult.confidence;
        let kellyStake = calculateKellyStake(dailyBalance, edgeAdjustedProb, 0.95);
        
        const volatilityFactor = (currentIndicators.atr || 0) / currentTick.price + (currentIndicators.bbw || 0);
        const volAdjustment = Math.exp(-volatilityFactor * 3);
        kellyStake *= volAdjustment;

        if (consensusProbability > AGGRESSIVE_THRESHOLD / 100 && regimeResult.confidence > 0.8) {
            kellyStake *= 1.3;
        }

        const entropy = calculateShannonEntropy(riseSum, fallSum);
        const certaintyFactor = 1 - entropy;
        kellyStake *= (0.5 + certaintyFactor * 0.5);

        const minStake = volatilityFactor > 0.005 ? 0.5 : 0.35;
        kellyStake = Math.max(minStake, kellyStake);
        
        const microstructureVeto = (microFeatures?.pressure === 'sell' && consensusDirection === 'RISE') ||
                                   (microFeatures?.pressure === 'buy' && consensusDirection === 'FALL');


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
                totalVirtualTrades: prev.systemMetrics.totalVirtualTrades + (performanceChanged ? 1 : 0),
                activeRobotsCount,
                orphanedTradesRemoved: prev.systemMetrics.orphanedTradesRemoved + removedOrphanedCount,
                lastCleanup: removedOrphanedCount > 0 ? Date.now() : prev.systemMetrics.lastCleanup,
                memoryUsageMB,
            },
            robotPerformance: performanceChanged ? localRobotPerformance : prev.robotPerformance,
            consensusReached,
            consensusSum: { rise: riseSum, fall: fallSum },
            totalWeight,
            effectiveThreshold: calculatedEffectiveThreshold
        }));
        
        if (executionIdRef.current % 10 === 0) {
            console.log(`✅ [Council Alive] Cycle #${executionIdRef.current} | Active Robots: ${activeRobotsCount} | Paper Trades: ${virtualTradesRef.current.length}`);
        }

        if (consensusReached && consensusDirection !== 'HOLD' && user) {
             if (kellyStake > 0 && !microstructureVeto) {
                 
                 const votingRobots = Object.values(localBayesianVotes).filter(v => v.vote === consensusDirection);
                 const totalConfidence = votingRobots.reduce((sum, v) => sum + v.bayesianProbability, 0);

                 let weightedAvgDuration = totalConfidence > 0 
                    ? votingRobots.reduce((sum, v) => sum + durationToSeconds(v.optimalDuration, v.optimalDurationUnit) * v.bayesianProbability, 0) / totalConfidence
                    : durationRange[0];
                
                if (currentIndicators.bbw && currentIndicators.bbw > 0.08) weightedAvgDuration *= 0.75;
                else if (currentIndicators.bbw && currentIndicators.bbw < 0.02) weightedAvgDuration *= 1.25;

                let finalDuration = Math.round(weightedAvgDuration);
                let finalDurationUnit: DurationUnit = 's'; // Padrão para segundos
                
                if (durationLimits) {
                    const canUseTicks = durationLimits.t.min > 0;
                    if (canUseTicks && finalDuration <= 20) { // Usa ticks para durações curtas se disponível
                        finalDurationUnit = 't';
                        finalDuration = Math.max(durationLimits.t.min, Math.round(finalDuration / 2));
                        finalDuration = Math.min(finalDuration, durationLimits.t.max);
                    } else { // Usa segundos como fallback ou para durações mais longas
                        finalDurationUnit = 's';
                        finalDuration = Math.max(durationLimits.s.min, finalDuration);
                        finalDuration = Math.min(finalDuration, durationLimits.s.max);
                    }
                } else {
                    finalDuration = Math.max(15, finalDuration); // Fallback seguro sem limits
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
                                payout: kellyStake * 0.95, // Aproximação, o valor real vem depois
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

                         saveTradeDecision(user.uid, log);
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
    isCouncilAutopilotOn, isConnected, activeSymbol, tickCandles, priceTicks, 
    strategyCouncil, timePeriod, robotPerformance, confidenceFactor, isMeritocracyOn, consensusSensitivity, dailyBalance, sessionStartTime, user, durationRange, executeTrade, evolveTrigger, durationLimits
  ]);

  useEffect(() => {
    if (!isCouncilAutopilotOn) return;
    const interval = setInterval(runCouncilCycle, THROTTLE_MS);
    return () => clearInterval(interval);
  }, [runCouncilCycle, isCouncilAutopilotOn]);

  return {
    isCouncilAutopilotOn,
    setIsCouncilAutopilotOn,
    fetchStrategyCouncil,
    dissolveCouncil,
    isFetchingCouncil,
    strategyCouncil,
    robotPerformance,
    evolutionHistory,
    virtualTradesRef,
    ...councilState,
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
    supervisionStatus: { status: 'approved', message: 'Sistema Operacional v2.5' }
  };
}
