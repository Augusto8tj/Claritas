// /src/features/trading/hooks/use-robot-council-v2.ts
'use client';

/**
 * 🧠 DERIV TRADER V2.5 - CÉREBRO COGNITIVO (VERSÃO ESTÁVEL & OTIMIZADA)
 * =================================================================================
 * CORREÇÕES DE ESTABILIDADE (30s CRASH FIX):
 * 1. Batch State Updates: Removeu updates de estado de dentro de loops (causa principal de travamentos).
 * 2. Memory Safety: Acesso seguro à API de performance do navegador.
 * 3. Garbage Collection: Limpeza otimizada de trades órfãos.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiV2 as useDerivApi } from './use-deriv-api-v2';
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
  extractMicrostructureFeatures
} from '@/services/advanced-trading-services';

// ════════════════════════════════════════════════════════════════════
// 1. CONSTANTES DE PERFORMANCE
// ════════════════════════════════════════════════════════════════════

const VIRTUAL_STAKE = 1.0; 
const REGIME_LOOKBACK = 30; 
const THROTTLE_MS = 1000; 
const TRADE_TIMEOUT_SECONDS = 3600; 
const MAX_VIRTUAL_TRADES = 500;

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
// 4. LÓGICA TÉCNICA (CORE)
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
  let reason = 'A aguardar sinal...';
  
  const { optimalDuration, optimalDurationUnit, suggestedStake: baseStake } = robot;
  const suggestedStake = baseStake || 1.0;

  if (!indicators || tickCandles.length < 2) {
    return { vote: 'HOLD', confidence: 0, reason: "Dados insuficientes", optimalDuration, optimalDurationUnit, suggestedStake: 0 };
  }

  const lastCandle = tickCandles[tickCandles.length - 1];
  const lastClose = lastCandle.close;
  const format = (val: number | null | undefined) => (isValid(val) ? val.toFixed(4) : 'N/A');

  const setVote = (newVote: 'RISE' | 'FALL', newConfidence: number, newReason: string) => {
    if (newConfidence <= 0) return;
    vote = newVote;
    confidence = newConfidence;
    reason = newReason;
  };

  const { 
    rsi, stoch, macd, bb, ma, adx, pdi, ndi, stochRSI, mfi, rvi, 
    ao, trix, roc, psar, ichimoku, kama, donchian, chandelier, 
    vwap, obv, zScore 
  } = indicators;

  try {
      if (robot.strategyType === 'RSI' && isValid(rsi)) {
        if (rsi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `RSI Baixo (${format(rsi)})`);
        else if (rsi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `RSI Alto (${format(rsi)})`);
      }
      else if (robot.strategyType === 'STOCHASTIC' && isValid(stoch)) {
        if (stoch <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `Stoch Baixo`);
        else if (stoch >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `Stoch Alto`);
      }
      else if (robot.strategyType === 'MACD_CROSS' && isValid(macd?.macd) && isValid(macd?.signal)) {
        if (macd.macd > macd.signal) setVote('RISE', robot.strongConfidence, `MACD Cruzou p/ Cima`);
        else if (macd.macd < macd.signal) setVote('FALL', robot.strongConfidence, `MACD Cruzou p/ Baixo`);
      }
      else if (robot.strategyType === 'ADX_TREND' && isValid(adx) && isValid(pdi) && isValid(ndi)) {
        if (adx > (robot.trendStrengthThreshold || 25)) {
           if (pdi > ndi) setVote('RISE', robot.strongConfidence, `Tendência Alta`);
           else if (ndi > pdi) setVote('FALL', robot.strongConfidence, `Tendência Baixa`);
        }
      }
      else if (robot.strategyType === 'BOLLINGER_BANDS' && isValid(bb?.lower) && isValid(bb?.upper)) {
        if (lastClose <= bb.lower) setVote('RISE', robot.weakConfidence, `Banda Inferior`);
        else if (lastClose >= bb.upper) setVote('FALL', robot.weakConfidence, `Banda Superior`);
      }
      else if (robot.strategyType === 'MOVING_AVERAGE_CROSS' && isValid(ma?.short) && isValid(ma?.long)) {
        if (ma.short > ma.long) setVote('RISE', robot.weakConfidence, `Golden Cross`);
        else setVote('FALL', robot.weakConfidence, `Death Cross`);
      }
      // Adicionar aqui lógica para outros robôs (Ichimoku, etc) se necessário
      // A lógica básica cobre a maioria dos casos para teste inicial
      else if (robot.strategyType === 'STOCH_RSI' && isValid(stochRSI)) {
          if (stochRSI < 0.2) setVote('RISE', robot.strongConfidence, 'StochRSI Sobrevenda');
          else if (stochRSI > 0.8) setVote('FALL', robot.strongConfidence, 'StochRSI Sobrecompra');
      }

  } catch (e) {
      console.warn(`[Vote] Erro seguro na estratégia ${robot.strategyType}:`, e);
  }

  return { vote, confidence, reason, optimalDuration, optimalDurationUnit, suggestedStake };
};

// ════════════════════════════════════════════════════════════════════
// 5. HOOK PRINCIPAL (ORQUESTRADOR)
// ════════════════════════════════════════════════════════════════════

export function useRobotCouncilV2(
  activeSymbol: string | null,
  priceTicks: TickData[],
  chartData: CandleData[],
  dataVersion: number
) {
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits } = useDerivApi();
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
  const transitionMatrixRef = useRef<number[][] | undefined>(undefined);
  const lastRegimeRef = useRef<MarketRegime>('ranging');

  // Configurações
  const [dailyBalance, setDailyBalance] = useState(100); 
  const [dailyTarget, setDailyTarget] = useState(50);
  const [consensusSensitivity, setConsensusSensitivity] = useState(60); 
  const [confidenceFactor, setConfidenceFactor] = useState(70); 
  const [durationRange, setDurationRange] = useState<[number, number]>([15, 300]); 
  const [takeProfitThreshold, setTakeProfitThreshold] = useState(10);
  const [stopLossThreshold, setStopLossThreshold] = useState(20);
  const [isDynamicConsensusOn, setIsDynamicConsensusOn] = useState(true);
  const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true);
  const [isMeritocracyOn, setIsMeritocracyOn] = useState(true); 
  const [isDynamicExitOn, setIsDynamicExitOn] = useState(true);

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

  // 🔄 CICLO DE VIDA OTIMIZADO
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

        // 1. Indicadores
        const currentIndicators = calculateAllIndicators(validCandles, strategyCouncil, timePeriod, { duration: 5, unit: 'm' });
        if (!currentIndicators) {
            councilExecutionRef.current.isExecuting = false;
            return;
        }

        // 2. Regime
        let regimeResult = { 
            regime: lastRegimeRef.current, 
            confidence: 0.5, 
            probabilities: { ranging: 1 } as any 
        };
        
        if (isValid(currentIndicators.adx)) {
            regimeResult = detectMarketRegime(
                validCandles,
                { adx: currentIndicators.adx, pdi: currentIndicators.pdi, ndi: currentIndicators.ndi, bbw: currentIndicators.bbw, roc: currentIndicators.roc, atr: currentIndicators.atr },
                lastRegimeRef.current,
                transitionMatrixRef.current
            );
        }
        lastRegimeRef.current = regimeResult.regime;

        // 3. Microestrutura
        const microFeatures = extractMicrostructureFeatures(priceTicks, validCandles);

        // 4. Arena Virtual (ATUALIZAÇÃO EM LOTE PARA EVITAR CRASH)
        const stillActiveTrades: VirtualTrade[] = [];
        let performanceChanged = false;
        let removedOrphanedCount = 0;
        
        // Criar uma cópia local da performance para modificar sem disparar renders
        let localRobotPerformance = [...robotPerformance];

        virtualTradesRef.current.forEach(trade => {
            const isExpired = currentTick.epoch >= trade.exitEpoch;
            const isOrphaned = (currentTick.epoch - trade.entryEpoch) > TRADE_TIMEOUT_SECONDS;

            if (isExpired || isOrphaned) {
                if(isOrphaned) removedOrphanedCount++;
                
                const exitPrice = currentTick.price;
                const isWin = (trade.vote === 'RISE' && exitPrice > trade.entryPrice) || 
                              (trade.vote === 'FALL' && exitPrice < trade.entryPrice);
                
                // Atualizar o array local
                localRobotPerformance = localRobotPerformance.map(p => {
                    if (p.id !== trade.robotId) return p;
                    const pnl = isWin ? VIRTUAL_STAKE * 0.95 : -VIRTUAL_STAKE;
                    const newWins = p.wins + (isWin ? 1 : 0);
                    const newLosses = p.losses + (isWin ? 0 : 1);
                    const newHistory = [...(p.tradeHistory || []), pnl].slice(-100);
                    return {
                        ...p,
                        wins: newWins,
                        losses: newLosses,
                        totalProfit: p.totalProfit + pnl,
                        tradeHistory: newHistory,
                        winRate: (newWins / (newWins + newLosses)) * 100,
                        lastUpdated: Date.now()
                    };
                });
                performanceChanged = true;
            } else {
                stillActiveTrades.push(trade);
            }
        });
        
        // Atualizar refs e estados apenas UMA VEZ
        virtualTradesRef.current = stillActiveTrades;
        if (performanceChanged) {
            setRobotPerformance(localRobotPerformance);
        }

        // 5. Votação
        const localBayesianVotes: Record<string, BayesianVote> = {};
        let riseSum = 0, fallSum = 0, totalWeight = 0;
        let activeRobotsCount = 0;

        strategyCouncil.forEach(robot => {
            const technicalVote = calculateTechnicalVote(robot, currentIndicators, validCandles);
            
            // Paper Trades
            if (technicalVote.vote !== 'HOLD') {
                 const hasActiveTrade = virtualTradesRef.current.some(t => t.robotId === robot.id);
                 if (!hasActiveTrade) {
                     const durationSec = durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit);
                     virtualTradesRef.current.push({
                         id: `vt-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                         robotId: robot.id,
                         vote: technicalVote.vote,
                         entryPrice: currentTick.price,
                         entryEpoch: currentTick.epoch,
                         exitEpoch: currentTick.epoch + durationSec,
                         regime: regimeResult.regime,
                         microstructure: microFeatures!,
                         stake: VIRTUAL_STAKE
                     });
                 }
            }
            
            // Consenso
            if (technicalVote.confidence >= confidenceFactor) {
                const perf = localRobotPerformance.find(p => p.id === robot.id);
                const winRate = perf ? perf.winRate : 50; 
                let weight = 1;
                if (isMeritocracyOn && perf) weight = Math.max(0.1, (perf.sharpeRatio || 0) + 0.5); 

                const posterior = bayesianUpdate(winRate/100, technicalVote.confidence/100);
                const voteWeight = posterior * weight;
                
                if (technicalVote.vote === 'RISE') riseSum += voteWeight;
                if (technicalVote.vote === 'FALL') fallSum += voteWeight;
                totalWeight += voteWeight;
                
                localBayesianVotes[robot.id] = {
                    ...technicalVote,
                    rawConfidence: technicalVote.confidence,
                    calibratedConfidence: posterior * 100,
                    bayesianProbability: posterior,
                    weight,
                    regime: regimeResult.regime,
                    strategy: robot
                };
                activeRobotsCount++;
            }
        });

        // 6. Decisão Final
        let consensusDirection: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
        let consensusProbability = 0.5;
        
        if (totalWeight > 0) {
            consensusProbability = Math.max(riseSum, fallSum) / totalWeight;
            if (riseSum > fallSum) consensusDirection = 'RISE';
            else if (fallSum > riseSum) consensusDirection = 'FALL';
        }

        const calculatedEffectiveThreshold = (totalWeight * (consensusSensitivity / 100));
        const consensusReached = totalWeight > 0 && Math.max(riseSum, fallSum) >= calculatedEffectiveThreshold;
        
        // Medição de memória segura (Compatibilidade Cross-Browser)
        const memoryUsageMB = (typeof performance !== 'undefined' && (performance as any).memory) 
            ? (performance as any).memory.usedJSHeapSize / (1024 * 1024) 
            : 0;

        const currentSessionDuration = sessionStartTime ? (Date.now() - sessionStartTime) / 1000 : 0;

        // Atualização da UI
        setCouncilState(prev => ({
            ...prev,
            indicators: currentIndicators,
            currentRegime: regimeResult,
            microstructure: microFeatures,
            consensusDecision: { direction: consensusDirection, probability: consensusProbability, stake: 0 },
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
        
        // Log Periódico (A cada 10 ticks)
        if (executionIdRef.current % 10 === 0) {
            console.log(`✅ [Council Alive] Cycle #${executionIdRef.current} | Active Robots: ${activeRobotsCount}`);
        }

        // 7. Execução Real (Se Aprovado)
        if (consensusReached && consensusDirection !== 'HOLD') {
             const kellyStake = calculateKellyStake(dailyBalance, consensusProbability, 0.9);
             if (kellyStake > 0) {
                // executeTrade(...)
             }
        }

    } catch (error) {
        console.error("🚨 [Council Error] Erro crítico no ciclo:", error);
    } finally {
        councilExecutionRef.current.isExecuting = false;
    }

  }, [
    isCouncilAutopilotOn, isConnected, activeSymbol, tickCandles, priceTicks, 
    strategyCouncil, timePeriod, robotPerformance, confidenceFactor, isMeritocracyOn, consensusSensitivity, dailyBalance, sessionStartTime
  ]);

  useEffect(() => {
    if (!isCouncilAutopilotOn) return;
    const interval = setInterval(runCouncilCycle, THROTTLE_MS);
    return () => clearInterval(interval);
  }, [runCouncilCycle, isCouncilAutopilotOn]);

  return {
    isCouncilAutopilotOn,
    fetchStrategyCouncil,
    dissolveCouncil,
    isFetchingCouncil,
    strategyCouncil,
    robotPerformance,
    evolutionHistory,
    virtualTradesRef,
    ...councilState,
    setDailyBalance, setDailyTarget, setConsensusSensitivity, setConfidenceFactor, 
    setDurationRange, setTakeProfitThreshold, setStopLossThreshold, 
    setIsDynamicConsensusOn, setIsDynamicRiskOn, setIsMeritocracyOn, setIsDynamicExitOn,
    resetArenaPerformance, tradeDecisionLog,
    supervisionStatus: { status: 'approved', message: 'Sistema Operacional v2.5' }
  };
}
