// src/hooks/use-robot-council-v2.ts
'use client';

/**
 * 🧠 DERIV TRADER V2.5 - CÉREBRO QUANTITATIVO COM "DEEP CONSENSUS"
 * 
 * 🎓 NOTAS DE ARQUITETURA AVANÇADA:
 * 
 * Este sistema evoluiu de uma democracia simples para uma "Meritocracia Ponderada pelo Risco".
 * 
 * NOVOS CONCEITOS IMPLEMENTADOS:
 * 1. ENTROPIA DE SHANNON: Mede a desordem do conselho. Se a entropia for alta 
 *    (votos muito divididos), o sistema aborta a operação por incerteza.
 * 2. SHARPE RATIO WEIGHTING: O peso do voto não é apenas a taxa de acerto, 
 *    mas o retorno ajustado ao risco.
 * 3. VOLATILITY SCALING: O tamanho da aposta (Kelly) é ajustado inversamente 
 *    à volatilidade do mercado (Yang-Zhang).
 * 4. RECENCY BIAS: Robôs que erraram os últimos 3 trades perdem 50% da credibilidade 
 *    instantaneamente, permitindo adaptação rápida a mudanças de mercado.
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
  calculatePerformanceMetrics, monteCarloValidation, extractMicrostructureFeatures, analyzeStrategyByRegime, calculateShannonEntropy
} from '@/services/advanced-trading-services';

// ════════════════════════════════════════════════════════════════════
// ⚙️ CONFIGURAÇÕES AVANÇADAS
// ════════════════════════════════════════════════════════════════════

const VIRTUAL_STAKE = 1.0;
const MIN_TRADES_FOR_STATS = 30; // Mínimo para ter significância estatística
const THROTTLE_MS = 1000;

// Limites de Segurança do Sistema
const MAX_VIRTUAL_TRADES = 1000;
const MAX_DECISION_LOG = 100;
const TRADE_TIMEOUT_SECONDS = 3600;
const CLEANUP_INTERVAL_MS = 60000;
const HEALTH_CHECK_INTERVAL_MS = 30000;
const REGIME_LOOKBACK = 50;
const SELL_DEAD_ZONE_MS = 15000; // Não vender nos últimos 15 segundos

// Limiares de Inteligência
const MAX_ENTROPY_THRESHOLD = 0.95; // Se a confusão do conselho passar de 95%, não opera
const MIN_CONGRUENCE_RATIO = 0.60;  // Mínimo de 60% dos pesos apontando para o mesmo lado

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

export interface DashboardData {
  regime: string;
  bayesianProbability: number;
  consensusDirection: 'RISE' | 'FALL' | 'HOLD';
  activeRobotsCount: number;
  entropy: number; // Nível de confusão (0=Certeza, 1=Caos)
  microstructure: {
    pressure: number;
    velocity: number;
    isSpike: boolean;
  };
  kellyStake: number;
}

export interface SystemMetrics {
  virtualTradesCount: number;
  decisionLogCount: number;
  activeRobotsCount: number;
  memoryUsageMB: number;
  isExecuting: boolean;
  lastCleanup: number;
  orphanedTradesRemoved: number;
}

export type EnhancedRobotPerformance = EnhancedRobotPerformanceType;
export type RobotVote = RobotVoteType;
export type BayesianVote = BayesianVoteType;
export type CouncilVotes = { [key: string]: BayesianVote };

// ════════════════════════════════════════════════════════════════════
// 🔧 FUNÇÕES AUXILIARES INTELIGENTES
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

const validateCandles = (candles: CandleData[], minCount: number): CandleData[] => {
  if (candles.length < minCount) return [];
  return candles.filter(c => 
    c && isValid(c.close) && c.close > 0 && isValid(c.epoch) && c.epoch > 0 &&
    isValid(c.open) && isValid(c.high) && isValid(c.low)
  );
};


/**
 * Cérebro Individual do Robô
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
  let reason = 'Aguardando sinal...';
  let suggestedStake = 0;
  
  const { optimalDuration, optimalDurationUnit, suggestedStake: baseStake } = robot;

  const setVote = (newVote: 'RISE' | 'FALL', rawConfidence: number, newReason: string) => {
    if (rawConfidence <= 0) return;
    vote = newVote;
    confidence = rawConfidence / 100;
    reason = newReason;
    suggestedStake = confidence === (robot.strongConfidence / 100) ? baseStake : baseStake * 0.5;
  };

  if (!indicators) return { vote: 'HOLD', confidence: 0, reason: "Sem Indicadores", optimalDuration, optimalDurationUnit, suggestedStake: 0 };

  const { rsi, stoch, macd, bb, ma, adx, pdi, ndi, stochRSI, mfi, trix, roc, obv, rvi, parabolicSAR, chandelierExit, awesomeOscillator, kama, donchianChannels, ichimoku, zScore, vwap } = indicators;
  const format = (val: number | null) => (isValid(val) ? val!.toFixed(2) : 'N/A');
  const lastCandle = tickCandles[tickCandles.length - 1];
  if(!lastCandle) return { vote: 'HOLD', confidence: 0, reason: "Sem candles", optimalDuration, optimalDurationUnit, suggestedStake: 0 };
  const price = lastCandle.close;

  // --- Lógica de Votação Expandida para Todos os Robôs ---
    switch(robot.strategyType) {
        case 'RSI':
            if(isValid(rsi)) {
                if (rsi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `RSI(${format(rsi)}) < ${robot.strongBuyThreshold}`);
                else if (rsi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `RSI(${format(rsi)}) < ${robot.weakBuyThreshold}`);
                else if (rsi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `RSI(${format(rsi)}) > ${robot.strongSellThreshold}`);
                else if (rsi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `RSI(${format(rsi)}) > ${robot.weakSellThreshold}`);
            }
            break;
        case 'STOCHASTIC':
            if(isValid(stoch)) {
                 if (stoch <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `Stoch(${format(stoch)}) < ${robot.strongBuyThreshold}`);
                else if (stoch <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `Stoch(${format(stoch)}) < ${robot.weakBuyThreshold}`);
                else if (stoch >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `Stoch(${format(stoch)}) > ${robot.strongSellThreshold}`);
                else if (stoch >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `Stoch(${format(stoch)}) > ${robot.weakSellThreshold}`);
            }
            break;
        case 'MACD_CROSS':
             if (isValid(macd.macd) && isValid(macd.signal) && isValid(macd.histogram)) {
                const isCrossingUp = macd.histogram > 0 && indicators.macd?.histogram! - macd.histogram > 0;
                const isCrossingDown = macd.histogram < 0 && indicators.macd?.histogram! - macd.histogram < 0;
                const divergence = Math.abs(macd.macd - macd.signal);
                const conf = Math.min(100, 50 + divergence * 1000);

                if (isCrossingUp) setVote('RISE', conf, `Crossover de alta`);
                else if (isCrossingDown) setVote('FALL', conf, `Crossover de baixa`);
            }
            break;
        case 'BOLLINGER_BANDS':
            if (isValid(bb.lower) && isValid(bb.upper)) {
                if (price <= bb.lower) setVote('RISE', robot.strongConfidence, `Toque na banda inferior`);
                else if (price >= bb.upper) setVote('FALL', robot.strongConfidence, `Toque na banda superior`);
            }
            break;
        case 'MOVING_AVERAGE_CROSS':
            if (isValid(ma.short) && isValid(ma.long)) {
                if (ma.short > ma.long) setVote('RISE', robot.weakConfidence, `Cruzamento de Alta`);
                else if (ma.long > ma.short) setVote('FALL', robot.weakConfidence, `Cruzamento de Baixa`);
            }
            break;
        case 'ADX_TREND':
            if (isValid(adx) && adx > (robot.trendStrengthThreshold || 20) && isValid(pdi) && isValid(ndi)) {
                const conf = Math.min(100, 40 + (adx - 20) * 2);
                if (pdi > ndi) setVote('RISE', conf, `Tendência de Alta Forte (ADX: ${format(adx)})`);
                else if (ndi > pdi) setVote('FALL', conf, `Tendência de Baixa Forte (ADX: ${format(adx)})`);
            }
            break;
        case 'STOCH_RSI':
            if (isValid(stochRSI)) {
                if (stochRSI <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `StochRSI(${format(stochRSI)}) na zona de sobrevenda`);
                else if (stochRSI >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `StochRSI(${format(stochRSI)}) na zona de sobrecompra`);
            }
            break;
        case 'MFI':
             if (isValid(mfi)) {
                if (mfi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `MFI(${format(mfi)}) sobrevendido`);
                else if (mfi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `MFI(${format(mfi)}) sobrecomprado`);
            }
            break;
        case 'TRIX':
            if (isValid(trix)) {
                 if (trix > 0) setVote('RISE', Math.min(90, Math.abs(trix) * 200), `TRIX positivo`);
                else if (trix < 0) setVote('FALL', Math.min(90, Math.abs(trix) * 200), `TRIX negativo`);
            }
            break;
        case 'ROC':
             if (isValid(roc)) {
                 if (roc > 0) setVote('RISE', Math.min(90, roc * 10), `ROC positivo`);
                else if (roc < 0) setVote('FALL', Math.min(90, Math.abs(roc) * 10), `ROC negativo`);
            }
            break;
        case 'RVI':
             if (isValid(rvi) && isValid(indicators.rvi)) {
                if (rvi > 50) setVote('RISE', (rvi - 50) * 2, `Vigor de Alta (${format(rvi)})`);
                else if (rvi < 50) setVote('FALL', (50 - rvi) * 2, `Vigor de Baixa (${format(rvi)})`);
            }
            break;
        case 'PARABOLIC_SAR':
            if (isValid(parabolicSAR)) {
                 if (price > parabolicSAR) setVote('RISE', robot.weakConfidence, `Preço acima do SAR`);
                 else if (price < parabolicSAR) setVote('FALL', robot.weakConfidence, `Preço abaixo do SAR`);
            }
            break;
        case 'ICHIMOKU_CLOUD':
            if (ichimoku && isValid(ichimoku.senkouA) && isValid(ichimoku.senkouB) && isValid(ichimoku.tenkan) && isValid(ichimoku.kijun)) {
                const aboveCloud = price > ichimoku.senkouA && price > ichimoku.senkouB;
                const belowCloud = price < ichimoku.senkouA && price < ichimoku.senkouB;
                const tenkanAboveKijun = ichimoku.tenkan > ichimoku.kijun;
                if (aboveCloud && tenkanAboveKijun) setVote('RISE', robot.strongConfidence, `Acima da Nuvem, Tenkan > Kijun`);
                else if (belowCloud && !tenkanAboveKijun) setVote('FALL', robot.strongConfidence, `Abaixo da Nuvem, Tenkan < Kijun`);
            }
            break;
        case 'KAMA':
            if (isValid(kama)) {
                if (price > kama) setVote('RISE', robot.weakConfidence, `Preço > KAMA`);
                else if (price < kama) setVote('FALL', robot.weakConfidence, `Preço < KAMA`);
            }
            break;
        case 'Z_SCORE':
            if (isValid(zScore)) {
                if (zScore <= -(robot.zScoreThreshold || 2)) setVote('RISE', robot.strongConfidence, `Z-Score (${format(zScore)}) Extremo Negativo`);
                else if (zScore >= (robot.zScoreThreshold || 2)) setVote('FALL', robot.strongConfidence, `Z-Score (${format(zScore)}) Extremo Positivo`);
            }
            break;
         case 'DONCHIAN_CHANNELS':
            const lastChannel = donchianChannels[donchianChannels.length-1];
            if (lastChannel && isValid(lastChannel.upper) && isValid(lastChannel.lower)) {
                if (price >= lastChannel.upper) setVote('RISE', robot.strongConfidence, `Rompimento de Máxima`);
                else if (price <= lastChannel.lower) setVote('FALL', robot.strongConfidence, `Rompimento de Mínima`);
            }
            break;
        case 'AWESOME_OSCILLATOR':
            if(isValid(awesomeOscillator)) {
                if (awesomeOscillator > 0) setVote('RISE', robot.weakConfidence, `AO positivo`);
                else if (awesomeOscillator < 0) setVote('FALL', robot.weakConfidence, `AO negativo`);
            }
            break;
        case 'OBV':
             if (isValid(obv)) {
                const obvSma = calculateSMA(tickCandles.map(c => ({...c, close: obv})), 20);
                const lastObvSma = obvSma[obvSma.length-1];
                if (isValid(lastObvSma)) {
                    if (obv > lastObvSma) setVote('RISE', robot.weakConfidence, `OBV acima da sua média`);
                    else if (obv < lastObvSma) setVote('FALL', robot.weakConfidence, `OBV abaixo da sua média`);
                }
            }
            break;
        case 'VWAP':
            const lastVwap = vwap[vwap.length - 1];
            if (isValid(lastVwap)) {
                if (price > lastVwap) setVote('RISE', robot.strongConfidence, `Preço > VWAP`);
                else if (price < lastVwap) setVote('FALL', robot.strongConfidence, `Preço < VWAP`);
            }
            break;
        case 'CHANDELIER_EXIT':
            if(isValid(chandelierExit)) {
                if (price > chandelierExit) setVote('RISE', robot.weakConfidence, `Acima da saída Chandelier`);
            }
            break;
    }
  return { vote, confidence, reason, optimalDuration, optimalDurationUnit, suggestedStake };
};

// ════════════════════════════════════════════════════════════════════
// 🎣 HOOK PRINCIPAL V2.5
// ════════════════════════════════════════════════════════════════════

export function useRobotCouncilV2(
  activeSymbol: string | null,
  priceTicks: TickData[],
  dataVersion: number,
) {
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits, sellContract, getHistoricalData } = useDerivApi();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);
  
  const executionIdRef = useRef(0);
  const lastExecutionTimeRef = useRef(0);
  const lastActiveSymbolRef = useRef<string | null>(null);
  const lastTimePeriodRef = useRef<TimePeriod | null>(null);
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  const tradeCounterRef = useRef(0);
  const transitionMatrixRef = useRef<number[][] | undefined>(undefined);
  
  const councilExecutionRef = useRef<{ isExecuting: boolean; sellingContracts: Set<number>; }>({
    isExecuting: false, sellingContracts: new Set()
  });

  // Métricas de Saúde e Monitoramento
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>({
    virtualTradesCount: 0, decisionLogCount: 0, activeRobotsCount: 0,
    memoryUsageMB: 0, isExecuting: false, lastCleanup: Date.now(), orphanedTradesRemoved: 0
  });

  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>(evolvedStrategies as RobotStrategy[]);
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [tradeDecisionLog, setTradeDecisionLog] = useState<TradeDecisionLog[]>([]);
  const [bayesianVotes, setBayesianVotes] = useState<CouncilVotes>({});
  const initialDataFetchedRef = useRef(false);
  const [historicalData, setHistoricalData] = useState<CandleData[]>([]);
  
  const [currentRegime, setCurrentRegime] = useState<{
    regime: MarketRegime;
    confidence: number;
    probabilities: Record<MarketRegime, number>;
  }>({
    regime: 'ranging', confidence: 0.5,
    probabilities: { trending_bull: 0.2, trending_bear: 0.2, ranging: 0.4, high_volatility: 0.1, breakout: 0.1 }
  });

  const [microstructure, setMicrostructure] = useState<MicrostructureFeatures | null>(null);
  const [robotPerformance, setRobotPerformance] = useState<EnhancedRobotPerformance[]>([]);

  // Configurações de Risco
  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusSensitivity, setConsensusSensitivity] = useState(60); 
  const [confidenceFactor, setConfidenceFactor] = useState(60);
  const [durationRange, setDurationRange] = useState<[number, number]>([15, 180]);
  const [takeProfitThreshold, setTakeProfitThreshold] = useState(100);
  const [stopLossThreshold, setStopLossThreshold] = useState(100);
  const [isDynamicConsensusOn, setIsDynamicConsensusOn] = useState(true);
  const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true);
  const [isMeritocracyOn, setIsMeritocracyOn] = useState(true);

  const [consensusDecision, setConsensusDecision] = useState<{
    direction: 'RISE' | 'FALL' | 'HOLD';
    probability: number;
    stake: number;
  }>({ direction: 'HOLD', probability: 0.5, stake: 0 });

  const [portfolioStats, setPortfolioStats] = useState({
    totalExposure: 0, maxExposure: dailyBalance * 0.3, currentDrawdown: 0, maxDrawdown: 0, dailyPnL: 0
  });

  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [effectiveThreshold, setEffectiveThreshold] = useState(0);
  const [councilConfidence, setCouncilConfidence] = useState(0);

  const tickCandles = useMemo(() => {
    if (historicalData.length === 0 && priceTicks.length === 0) return [];
    
    // Combina dados históricos com os novos ticks em tempo real
    const combinedData = [...historicalData];
    priceTicks.forEach(tick => {
      const lastCandle = combinedData[combinedData.length - 1];
      if (lastCandle && lastCandle.epoch === tick.epoch) {
        // Atualiza o último candle
        lastCandle.close = tick.price;
        lastCandle.high = Math.max(lastCandle.high, tick.price);
        lastCandle.low = Math.min(lastCandle.low, tick.price);
      } else {
        // Adiciona um novo "candle" de tick
        combinedData.push({ epoch: tick.epoch, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: 1 });
      }
    });

    if (combinedData.length > 2000) {
      return combinedData.slice(combinedData.length - 2000);
    }
    return combinedData;
  }, [historicalData, priceTicks, dataVersion]);

  useEffect(() => { setStrategyCouncil(evolvedStrategies as RobotStrategy[]); }, [evolvedStrategies]);

  // Garbage Collector
  useEffect(() => {
    if (!isCouncilAutopilotOn) return;
    const cleanupInterval = setInterval(() => {
      const now = Date.now() / 1000;
      virtualTradesRef.current = virtualTradesRef.current.filter(trade => (now - trade.entryEpoch) < TRADE_TIMEOUT_SECONDS).slice(-MAX_VIRTUAL_TRADES);
      setSystemMetrics(prev => ({ ...prev, lastCleanup: Date.now() }));
    }, CLEANUP_INTERVAL_MS);
    return () => clearInterval(cleanupInterval);
  }, [isCouncilAutopilotOn]);

  // Health Check
  useEffect(() => {
    if (!isCouncilAutopilotOn) return;
    const healthCheck = setInterval(() => {
      setSystemMetrics(prev => ({
        ...prev, virtualTradesCount: virtualTradesRef.current.length, decisionLogCount: tradeDecisionLog.length,
        memoryUsageMB: (performance as any).memory?.usedJSHeapSize ? (performance as any).memory.usedJSHeapSize / 1024 / 1024 : 0,
        isExecuting: councilExecutionRef.current.isExecuting
      }));
    }, HEALTH_CHECK_INTERVAL_MS);
    return () => clearInterval(healthCheck);
  }, [isCouncilAutopilotOn, tradeDecisionLog]);

  const resetArenaPerformance = useCallback(() => {
    if (strategyCouncil.length === 0 || !user) return;
    const initialPerformance: EnhancedRobotPerformance[] = strategyCouncil.map(robot => ({
      id: robot.id, strategyType: robot.strategyType, strategy: robot,
      wins: 0, losses: 0, totalProfit: 0, winRate: 0, sharpeRatio: 0,
      maxDrawdown: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, kellyFraction: 0,
      effectiveRegimes: [], monteCarloScore: 0, lastUpdated: Date.now(), tradeHistory: []
    }));
    setRobotPerformance(initialPerformance);
    virtualTradesRef.current = [];
    tradeCounterRef.current = 0;
    saveRobotPerformance(user.uid, initialPerformance);
    toast({ title: "🔄 Arena V2.5 Reiniciada", description: "Novo ciclo de inteligência iniciado." });
  }, [strategyCouncil, user, toast]);

  // Load Performance
  useEffect(() => {
    if (!user || isAuthLoading) return;
    loadRobotPerformance(user.uid).then((stored) => {
      if (stored && stored.length > 0) {
        const enhanced: EnhancedRobotPerformance[] = (stored as any[]).map(p => ({ ...p, lastUpdated: Date.now(), tradeHistory: p.tradeHistory || [] }));
        setRobotPerformance(enhanced);
      }
    });
  }, [user, isAuthLoading]);

  // Audit Log Saver
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!user || tradeDecisionLog.length === 0) return;
      tradeDecisionLog.forEach(log => { if (log.result === 'pending') saveTradeDecision(user.uid, log); });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [tradeDecisionLog, user]);

  const fetchStrategyCouncil = useCallback(async () => {
    if (!activeSymbol || !user) { toast({ variant: 'destructive', title: 'Erro', description: 'Login necessário.' }); return; }
    setIsFetchingCouncil(true);
    await new Promise(r => setTimeout(r, 500));
    setStrategyCouncil((evolvedStrategies as RobotStrategy[]).map(s => ({ ...s })));
    resetArenaPerformance();
    initialDataFetchedRef.current = false; // Força a busca de dados históricos
    setIsCouncilAutopilotOn(true);
    lastActiveSymbolRef.current = activeSymbol;
    lastTimePeriodRef.current = timePeriod;
    setIsFetchingCouncil(false);
  }, [activeSymbol, user, toast, evolvedStrategies, resetArenaPerformance, timePeriod]);

  // Mudança de Ativo/Periodo
  useEffect(() => {
    const symbolChanged = activeSymbol && lastActiveSymbolRef.current !== activeSymbol;
    if (isCouncilAutopilotOn && symbolChanged) {
        resetArenaPerformance();
        initialDataFetchedRef.current = false; // Força a busca de dados históricos
        lastActiveSymbolRef.current = activeSymbol;
    }
  }, [activeSymbol, isCouncilAutopilotOn, resetArenaPerformance]);

  const dissolveCouncil = useCallback(() => {
    setIsCouncilAutopilotOn(false);
    toast({ title: '⏸️ Sistema Pausado', description: 'Operações suspensas com segurança.' });
  }, [toast]);

  // ════════════════════════════════════════════════════════════════════
  // 🧠 CÉREBRO CENTRAL (LOOP DE EXECUÇÃO)
  // ════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const now = Date.now();
    if (now - lastExecutionTimeRef.current < THROTTLE_MS) return;
    lastExecutionTimeRef.current = now;

    if (!isConnected || !user || !isCouncilAutopilotOn || strategyCouncil.length === 0 || !activeSymbol) return;

    // --- BOOTSTRAP DE DADOS HISTÓRICOS ---
    if (!initialDataFetchedRef.current) {
        initialDataFetchedRef.current = true; // Marca como "em progresso" para evitar múltiplas chamadas
        getHistoricalData(activeSymbol, 'candles', 1000, timePeriod)
          .then(history => {
            setHistoricalData(history as CandleData[]);
            console.log(`[Bootstrap] ${history.length} candles históricos carregados para ${activeSymbol}.`);
          })
          .catch(error => {
            toast({ title: "Erro de Bootstrap", description: "Não foi possível carregar os dados históricos.", variant: "destructive" });
            initialDataFetchedRef.current = false; // Permite tentar novamente
          });
        return; // Retorna para aguardar os dados
    }

    const validCandles = validateCandles(tickCandles, REGIME_LOOKBACK);
    if (validCandles.length < REGIME_LOOKBACK) return;
    const currentTick = priceTicks[priceTicks.length - 1];
    if (!currentTick) return;

    try {
      // 1. ANÁLISE TÉCNICA
      const currentIndicators = calculateAllIndicators(validCandles, strategyCouncil, timePeriod, { duration: 5, unit: 'm' });
      setIndicators(currentIndicators);
      if (!currentIndicators || !isValid(currentIndicators.adx)) return;

      // 2. DETECÇÃO DE REGIME E MICROESTRUTURA
      const regimeResult = detectMarketRegime(
        validCandles,
        { adx: currentIndicators.adx, pdi: currentIndicators.pdi, ndi: currentIndicators.ndi, bbw: currentIndicators.bbw, roc: currentIndicators.roc, atr: currentIndicators.atr },
        currentRegime.regime, transitionMatrixRef.current
      );
      setCurrentRegime({ regime: regimeResult.regime, confidence: regimeResult.confidence, probabilities: regimeResult.probabilities });
      transitionMatrixRef.current = regimeResult.transitionMatrix;

      const microFeatures = extractMicrostructureFeatures(priceTicks, validCandles);
      setMicrostructure(microFeatures);

      // 3. GESTÃO DE POSIÇÕES ABERTAS
      const activeCouncilContracts = operationsLog.filter(op => op.status === 'pending' && op.initiator === 'Conselho');
      activeCouncilContracts.forEach(contract => {
        if (councilExecutionRef.current.sellingContracts.has(contract.id) || !contract.expirationTime) return;

        const remainingTime = contract.expirationTime - Date.now();
        if (remainingTime < SELL_DEAD_ZONE_MS) {
            return; // Entrou na zona de não-interferência, ignora
        }

        const profit = contract.result || 0;
        const pnlPct = (profit / contract.stake) * 100;
        if (profit > 0 && (profit / (contract.stake * 0.95)) * 100 >= takeProfitThreshold) {
          councilExecutionRef.current.sellingContracts.add(contract.id);
          sellContract(contract.id).finally(() => setTimeout(() => councilExecutionRef.current.sellingContracts.delete(contract.id), 5000));
          toast({ title: "💰 Take Profit", description: `Lucro garantido: $${profit.toFixed(2)}` });
        } else if (profit < 0 && Math.abs(pnlPct) >= stopLossThreshold) {
          councilExecutionRef.current.sellingContracts.add(contract.id);
          sellContract(contract.id).finally(() => setTimeout(() => councilExecutionRef.current.sellingContracts.delete(contract.id), 5000));
          toast({ title: "🛡️ Stop Loss", description: `Prejuízo limitado: $${profit.toFixed(2)}`, variant: "destructive" });
        }
      });

      // 4. ATUALIZAÇÃO DA ARENA VIRTUAL
      const performanceMap = new Map<string, EnhancedRobotPerformance>();
      strategyCouncil.forEach(r => {
        const existing = robotPerformance.find(p => p.id === r.id);
        performanceMap.set(r.id, existing || { 
            id: r.id, strategyType: r.strategyType, strategy: r, wins: 0, losses: 0, totalProfit: 0, winRate: 0,
            sharpeRatio: 0, maxDrawdown: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, kellyFraction: 0,
            effectiveRegimes: [], monteCarloScore: 0, lastUpdated: Date.now(), tradeHistory: []
        });
      });

      let performanceChanged = false;
      virtualTradesRef.current = virtualTradesRef.current.filter(trade => {
        if (currentTick.epoch >= trade.exitEpoch) {
            const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;
            const isWin = (trade.vote === 'RISE' && exitTick.price > trade.entryPrice) || (trade.vote === 'FALL' && exitTick.price < trade.entryPrice);
            const pnl = isWin ? VIRTUAL_STAKE * 0.95 : -VIRTUAL_STAKE;
            const perf = performanceMap.get(trade.robotId);
            if (perf) {
                perf.totalProfit += pnl; perf.tradeHistory.push(pnl);
                if (isWin) perf.wins++; else perf.losses++;
                const total = perf.wins + perf.losses;
                perf.winRate = total > 0 ? (perf.wins / total) * 100 : 0;
                
                if (perf.tradeHistory.length >= MIN_TRADES_FOR_STATS) {
                    const metrics = calculatePerformanceMetrics(perf.tradeHistory.map((p, i) => ({ profit: p, timestamp: Date.now() - i * 60000 })));
                    perf.sharpeRatio = metrics.sharpeRatio;
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
      
      if (performanceChanged) {
        setRobotPerformance(Array.from(performanceMap.values()));
        if (user) saveRobotPerformance(user.uid, Array.from(performanceMap.values())).catch(console.error);
      }

      // 5. DEEP CONSENSUS (A Lógica Central de Decisão)
      const newBayesianVotes: CouncilVotes = {};
      let riseSum = 0, fallSum = 0, totalWeight = 0, weightedDurationSum = 0;
      let activeRobotsCount = 0;
      
      strategyCouncil.forEach(robot => {
        const perf = performanceMap.get(robot.id);
        const technicalVote = calculateTechnicalVote(robot, currentIndicators, validCandles);
        
        // --- APRENDIZAGEM (FUNIL LARGO) ---
        if (technicalVote.vote !== 'HOLD') {
            const hasActiveTrade = virtualTradesRef.current.some(t => t.robotId === robot.id && currentTick.epoch < t.exitEpoch);
            if (!hasActiveTrade) {
                const durationInSeconds = durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit);
                virtualTradesRef.current.push({ 
                    id: `vt_${Date.now()}_${tradeCounterRef.current++}`, robotId: robot.id, vote: technicalVote.vote, 
                    entryPrice: currentTick.price, entryEpoch: currentTick.epoch, exitEpoch: currentTick.epoch + durationInSeconds, 
                    regime: regimeResult.regime, microstructure: microFeatures, stake: VIRTUAL_STAKE 
                });
            }
        }
        
        // --- CONSENSO REAL (FUNIL ESTREITO) ---
        const durationInSeconds = durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit);
        const hasHistory = perf && (perf.wins + perf.losses) > 10;
        const isRegimeEffective = !hasHistory || !perf?.effectiveRegimes?.length || perf.effectiveRegimes.includes(regimeResult.regime);
        const isDurationInRange = durationInSeconds >= durationRange[0] && durationInSeconds <= durationRange[1];

        let rejectionReason = '';
        if (technicalVote.vote === 'HOLD') {
            rejectionReason = 'HOLD';
        } else if (technicalVote.confidence < (confidenceFactor / 100)) {
            rejectionReason = `Confiança Baixa`;
        } else if (!isRegimeEffective) {
            rejectionReason = `Regime Ineficaz`;
        } else if (!isDurationInRange) {
            rejectionReason = `Duração Inválida`;
        }

        const isValidForConsensus = rejectionReason === '';
        
        // Cálculo de Peso Inteligente
        let prior = (perf && (perf.wins + perf.losses) >= MIN_TRADES_FOR_STATS) ? perf.winRate / 100 : 0.5;
        let likelihood = technicalVote.confidence;
        if (microFeatures && microFeatures.yangZhangVolatility > 0.05) likelihood *= 0.8; // Penaliza em alta volatilidade
        
        const posterior = bayesianUpdate(prior, likelihood);
        const calibratedConf = calibrateConfidence(technicalVote.confidence * 100, perf?.winRate || 50) / 100;

        let weight = 0;
        if (isValidForConsensus) {
            activeRobotsCount++;
            weight = 1.0;
            
            // Fator Meritocrático e Sharpe Ratio
            if (isMeritocracyOn && perf && (perf.wins + perf.losses) > 10) {
              const sharpeWeight = Math.max(0.2, Math.min(2.5, (perf.sharpeRatio || 0) / 1.5));
              weight *= sharpeWeight;
              
              // Recency Bias (Penaliza se errou os últimos 3 trades)
              const recentHistory = perf.tradeHistory.slice(-3);
              const recentLosses = recentHistory.filter(p => p < 0).length;
              if (recentLosses === 3) weight *= 0.5; // Penalidade severa
            }
        }
        
        const finalVote: BayesianVote = { 
            vote: technicalVote.vote, rawConfidence: technicalVote.confidence * 100, calibratedConfidence: calibratedConf * 100, 
            bayesianProbability: posterior, weight: weight, sharpeRatio: perf?.sharpeRatio || 0,
            optimalDuration: technicalVote.optimalDuration, optimalDurationUnit: technicalVote.optimalDurationUnit, 
            suggestedStake: technicalVote.suggestedStake * posterior, regime: regimeResult.regime, 
            reason: isValidForConsensus ? technicalVote.reason : rejectionReason, strategy: robot
        };
        newBayesianVotes[robot.id] = finalVote;

        if (weight > 0) {
            const voteWeight = calibratedConf * weight;
            if (technicalVote.vote === 'RISE') riseSum += voteWeight;
            if (technicalVote.vote === 'FALL') fallSum += voteWeight;
            weightedDurationSum += durationInSeconds * voteWeight;
            totalWeight += voteWeight;
        }
      });
      setBayesianVotes(newBayesianVotes);
      setCouncilConfidence(totalWeight);

      // 6. ANÁLISE DE CONSENSO E ENTROPIA
      let consensusDirection: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
      let consensusProbability = 0.5;
      const entropy = calculateShannonEntropy(riseSum, fallSum);

      if (totalWeight > 0) {
        consensusProbability = Math.max(riseSum, fallSum) / (riseSum + fallSum);
        if (riseSum > fallSum) consensusDirection = 'RISE';
        else if (fallSum > riseSum) consensusDirection = 'FALL';
      }

      // Verificações de Carteira
      const dailyPnL = operationsLog.filter(op => op.initiator === 'Conselho' && new Date(op.timestamp).toDateString() === new Date().toDateString()).reduce((sum, op) => sum + (op.result || 0), 0);
      setPortfolioStats(prev => ({ ...prev, dailyPnL }));

      if (dailyPnL <= -dailyBalance) { toast({ title: "🛑 Stop Loss Diário", variant: "destructive" }); return; }
      if (dailyPnL >= dailyTarget) { toast({ title: "🎯 Meta Batida", description: "Parabéns!" }); return; }

      // Threshold e Congruência
      const effectiveThresholdRaw = isDynamicConsensusOn ? (totalWeight * (consensusSensitivity / 100)) : consensusSensitivity;
      setEffectiveThreshold(effectiveThresholdRaw);
      
      const consensusReached = Math.max(riseSum, fallSum) >= effectiveThresholdRaw;
      const congruenceRatio = totalWeight > 0 ? Math.max(riseSum, fallSum) / totalWeight : 0;
      
      const totalSystemTrades = robotPerformance.reduce((sum, p) => sum + (p.wins || 0) + (p.losses || 0), 0);
      const isSystemWarmingUp = totalSystemTrades < 50;

      const matureVoters = Object.values(newBayesianVotes).filter(v => {
          const perf = robotPerformance.find(p => p.id === v.strategy?.id);
          return v.weight > 0 && perf && (perf.wins + perf.losses) > MIN_TRADES_FOR_STATS;
      });
      const matureVotersRatio = activeRobotsCount > 0 ? matureVoters.length / activeRobotsCount : 0;

      const hasStatisticalConfidence = !isSystemWarmingUp && (matureVotersRatio >= 0.4 || matureVoters.length >= 3);

      // 7. CÁLCULO DE STAKE (KELLY CRITERION + VOLATILITY SCALING)
      let kellyStake = calculateKellyStake(dailyBalance - portfolioStats.totalExposure, consensusProbability, 0.95);
      
      if (microFeatures && microFeatures.yangZhangVolatility > 0.02) {
          const volFactor = 1 - (microFeatures.yangZhangVolatility * 10);
          kellyStake *= Math.max(0.2, volFactor);
      }
      
      if (currentIndicators.ema20 && currentIndicators.ema50) {
          if (consensusDirection === 'RISE' && currentIndicators.ema20 < currentIndicators.ema50) kellyStake *= 0.5;
          else if (consensusDirection === 'FALL' && currentIndicators.ema20 > currentIndicators.ema50) kellyStake *= 0.5;
      }

      let microstructureVeto = false;
      if (microFeatures) {
          if (microFeatures.isSpike) microstructureVeto = true;
          if ((consensusDirection === 'RISE' && microFeatures.pressure === 'sell') || (consensusDirection === 'FALL' && microFeatures.pressure === 'buy')) {
              kellyStake *= 0.5;
          }
      }
      
      kellyStake = Math.max(0.35, Math.min(kellyStake, dailyBalance * 0.1));

      const avgDurationSeconds = totalWeight > 0 ? weightedDurationSum / totalWeight : 60;
      let finalDuration = 5; let finalDurationUnit: DurationUnit = 't';
       if (durationLimits) {
        if (avgDurationSeconds <= durationLimits.t.max * 2 && durationLimits.t.min > 0) { finalDurationUnit = 't'; finalDuration = Math.round(avgDurationSeconds / 2); }
        else if (avgDurationSeconds < 60 && durationLimits.s.min > 0) { finalDurationUnit = 's'; finalDuration = Math.round(avgDurationSeconds); }
        else if (durationLimits.m.min > 0) { finalDurationUnit = 'm'; finalDuration = Math.round(avgDurationSeconds / 60); }
        const { min, max } = durationLimits[finalDurationUnit];
        finalDuration = Math.max(min, Math.min(max, finalDuration));
      }
      
      setDashboardData({
        regime: regimeResult.regime, bayesianProbability: consensusProbability, entropy,
        consensusDirection, activeRobotsCount,
        microstructure: { pressure: microFeatures?.volumeImbalance ?? 0.5, velocity: microFeatures?.tickVelocity ?? 0, isSpike: microFeatures?.isSpike ?? false },
        kellyStake
      });
      
      // 8. O "GLEIPNIR LOCK" (Validação Final de Segurança)
      const isSafeToTrade = 
        consensusReached &&
        hasStatisticalConfidence &&
        consensusDirection !== 'HOLD' &&
        entropy < MAX_ENTROPY_THRESHOLD &&
        congruenceRatio > MIN_CONGRUENCE_RATIO &&
        !microstructureVeto;

      if (!isSafeToTrade) {
        setConsensusDecision({ direction: 'HOLD', probability: consensusProbability, stake: 0 });
        return;
      }
      
      // EXECUÇÃO
      setConsensusDecision({ direction: consensusDirection, probability: consensusProbability, stake: kellyStake });
      const activeStakes = activeCouncilContracts.reduce((sum, c) => sum + c.stake, 0);
      setPortfolioStats(prev => ({ ...prev, totalExposure: activeStakes }));

      if (councilExecutionRef.current.isExecuting || activeStakes + kellyStake > dailyBalance * 0.4 || consensusProbability < 0.60) return;
      
      const currentExecutionId = ++executionIdRef.current;
      councilExecutionRef.current.isExecuting = true;

      const decisionLog: TradeDecisionLog = {
          id: `TDL-${Date.now()}`, timestamp: new Date().toISOString(), asset: activeSymbol, timePeriod,
          tradeParams: { direction: consensusDirection, stake: kellyStake, duration: finalDuration, durationUnit: finalDurationUnit },
          context: { marketRegime: regimeResult.regime, regimeConfidence: regimeResult.confidence, microstructure: microFeatures, indicators: currentIndicators, entryPrice: currentTick.price, supervisionReason: `Entropy: ${entropy.toFixed(2)}` },
          consensus: { bayesianProbability: consensusProbability, kellyStake, activeRobots: activeRobotsCount, votes: newBayesianVotes },
          result: 'pending', pnl: 0
      };
      setTradeDecisionLog(prev => [decisionLog, ...prev].slice(0, MAX_DECISION_LOG));

      toast({ title: "🚀 Ordem Inteligente", description: `${consensusDirection} | Confiança: ${(congruenceRatio*100).toFixed(0)}%` });

      executeTrade(consensusDirection === 'RISE' ? 'CALL' : 'PUT', kellyStake, activeSymbol, consensusDirection.toLowerCase() as 'rise' | 'fall', finalDuration, finalDurationUnit, 'Conselho')
        .finally(() => {
            setTimeout(() => { if (currentExecutionId === executionIdRef.current) councilExecutionRef.current.isExecuting = false; }, 3000);
        });

    } catch (error) {
      console.error("🚨 Erro Crítico:", error);
      councilExecutionRef.current.isExecuting = false;
    }
  }, [
    dataVersion, isConnected, isCouncilAutopilotOn, strategyCouncil, robotPerformance,
    activeSymbol, operationsLog, currentRegime, user, toast, executeTrade, sellContract,
    timePeriod, dailyBalance, dailyTarget, evolveTrigger, portfolioStats,
    consensusSensitivity, confidenceFactor, durationRange, takeProfitThreshold,
    stopLossThreshold, priceTicks, tickCandles, isMeritocracyOn, isDynamicConsensusOn,
    getHistoricalData, initialDataFetchedRef, historicalData, // Novas dependências
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
