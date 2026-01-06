// /src/hooks/use-robot-council-v2.ts
'use client';

/**
 * 🧠 DERIV TRADER V2.5 - SISTEMA EVOLUTIVO OTIMIZADO E CORRIGIDO
 * 
 * CORREÇÕES IMPLEMENTADAS:
 * ═══════════════════════════════════════════
 * 
 * 1. BOOTSTRAP AUTOMÁTICO DE DADOS HISTÓRICOS ✅
 *    - Carrega 1000 candles ao iniciar
 *    - Valida dados antes de operar
 *    - Reset automático ao mudar símbolo/período
 * 
 * 2. VALIDAÇÃO ROBUSTA DE INDICADORES ✅
 *    - Retorno explícito de null quando dados insuficientes
 *    - Validação de cada indicador crítico
 *    - Logs detalhados de status
 * 
 * 3. SINCRONIZAÇÃO COM dataVersion ✅
 *    - Council reage a mudanças de dados
 *    - Tracking de atualizações em tempo real
 * 
 * 4. PROTEÇÃO CONTRA MEMORY LEAKS ✅
 *    - Limpeza automática de trades órfãos
 *    - Limites de tamanho para logs
 *    - Health check com auto-recuperação
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiV2 as useDerivApi } from './use-deriv-api-v2';
import { useToast } from '@/hooks/use-toast';
import type { 
  RobotStrategy, DurationUnit, TickData, CandleData, Operation,
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
const TRADE_COOLDOWN_MS = 3000;

const MAX_VIRTUAL_TRADES = 500;
const MAX_DECISION_LOG = 100;
const TRADE_TIMEOUT_SECONDS = 3600;
const CLEANUP_INTERVAL_MS = 60000;
const HEALTH_CHECK_INTERVAL_MS = 90000;
const METRICS_UPDATE_INTERVAL_MS = 1000;

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

interface CouncilState {
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

const validateCandles = (candles: CandleData[], minCount: number): CandleData[] => {
  const valid = candles.filter(c => 
    c &&
    c.close > 0 && 
    Number.isFinite(c.close) && 
    c.epoch > 0 &&
    c.open > 0 &&
    c.high > 0 &&
    c.low > 0
  );
  
  if (valid.length < minCount) {
    // console.warn(`⚠️ Candles válidos: ${valid.length}/${candles.length} (mínimo: ${minCount})`);
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
  let reason = 'A aguardar sinal...';
  
  const { optimalDuration, optimalDurationUnit, suggestedStake: baseStake } = robot;
  const suggestedStake = baseStake || 1.0;

  if (!indicators || tickCandles.length < 2) {
    return { vote: 'HOLD', confidence: 0, reason: "Dados insuficientes", optimalDuration, optimalDurationUnit, suggestedStake: 0 };
  }

  const lastCandle = tickCandles[tickCandles.length - 1];
  const lastClose = lastCandle.close;
  const prevClose = tickCandles[tickCandles.length - 2].close;

  const format = (val: number | null | undefined) => (val !== null && val !== undefined && !isNaN(val) ? val.toFixed(4) : 'N/A');

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

  if (robot.strategyType === 'RSI' && isValid(rsi)) {
    if (rsi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `RSI(${format(rsi)}) < ${robot.strongBuyThreshold}`);
    else if (rsi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `RSI(${format(rsi)}) < ${robot.weakBuyThreshold}`);
    else if (rsi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `RSI(${format(rsi)}) > ${robot.strongSellThreshold}`);
    else if (rsi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `RSI(${format(rsi)}) > ${robot.weakSellThreshold}`);
  }
  
  if (robot.strategyType === 'STOCHASTIC' && isValid(stoch)) {
    if (stoch <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `Stoch(${format(stoch)}) Sobrevenda`);
    else if (stoch >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `Stoch(${format(stoch)}) Sobrecompra`);
  }
  
  if (robot.strategyType === 'MACD_CROSS' && isValid(macd?.macd) && isValid(macd?.signal)) {
    if (macd.macd > macd.signal) setVote('RISE', robot.strongConfidence, `MACD Cruzou p/ Cima`);
    else if (macd.macd < macd.signal) setVote('FALL', robot.strongConfidence, `MACD Cruzou p/ Baixo`);
  }
  
  if (robot.strategyType === 'ADX_TREND' && isValid(adx) && isValid(pdi) && isValid(ndi)) {
    if (adx > (robot.trendStrengthThreshold || 25)) {
       if (pdi > ndi) setVote('RISE', robot.strongConfidence, `ADX Forte (${format(adx)}) Bullish`);
       else if (ndi > pdi) setVote('FALL', robot.strongConfidence, `ADX Forte (${format(adx)}) Bearish`);
    }
  }
  
  if (robot.strategyType === 'AWESOME_OSCILLATOR' && isValid(ao)) {
    const isBullishSaucer = ao > 0 && ao > (indicators.aoPrev || 0);
    const isBearishSaucer = ao < 0 && ao < (indicators.aoPrev || 0);
    
    if (isBullishSaucer) setVote('RISE', robot.weakConfidence, `AO Momentum Alta`);
    else if (isBearishSaucer) setVote('FALL', robot.weakConfidence, `AO Momentum Baixa`);
  }
  
  if (robot.strategyType === 'TRIX' && isValid(trix)) {
    if (trix > 0 && trix > (indicators.trixPrev || 0)) setVote('RISE', robot.strongConfidence, 'TRIX Acelerando');
    else if (trix < 0 && trix < (indicators.trixPrev || 0)) setVote('FALL', robot.strongConfidence, 'TRIX Desacelerando');
  }
  
  if (robot.strategyType === 'ROC' && isValid(roc)) {
    if (roc > 0.1) setVote('RISE', robot.weakConfidence, `ROC(${format(roc)}) Positivo`);
    else if (roc < -0.1) setVote('FALL', robot.weakConfidence, `ROC(${format(roc)}) Negativo`);
  }
  
  if (robot.strategyType === 'RVI' && isValid(rvi)) {
    if (rvi > (robot.strongBuyThreshold || 50)) setVote('RISE', robot.weakConfidence, `RVI(${format(rvi)}) Alta Energia`);
    else if (rvi < (robot.weakSellThreshold || 50)) setVote('FALL', robot.weakConfidence, `RVI(${format(rvi)}) Baixa Energia`);
  }
  
  if (robot.strategyType === 'PARABOLIC_SAR' && isValid(psar)) {
    if (lastClose > psar) setVote('RISE', robot.strongConfidence, `Preço acima SAR`);
    else if (lastClose < psar) setVote('FALL', robot.strongConfidence, `Preço abaixo SAR`);
  }
  
  if (robot.strategyType === 'BOLLINGER_BANDS' && isValid(bb?.lower) && isValid(bb?.upper)) {
    if (lastClose <= bb.lower) setVote('RISE', robot.weakConfidence, `Toque Banda Inferior`);
    else if (lastClose >= bb.upper) setVote('FALL', robot.weakConfidence, `Toque Banda Superior`);
  }
  
  if (robot.strategyType === 'ICHIMOKU_CLOUD' && isValid(ichimoku?.spanA) && isValid(ichimoku?.spanB) && isValid(ichimoku?.tenkan) && isValid(ichimoku?.kijun)) {
    const cloudTop = Math.max(ichimoku.spanA, ichimoku.spanB);
    const cloudBottom = Math.min(ichimoku.spanA, ichimoku.spanB);
    
    if (lastClose > cloudTop && ichimoku.tenkan > ichimoku.kijun) 
        setVote('RISE', robot.strongConfidence, `Acima da Nuvem + TK Cross`);
    else if (lastClose < cloudBottom && ichimoku.tenkan < ichimoku.kijun) 
        setVote('FALL', robot.strongConfidence, `Abaixo da Nuvem + TK Cross`);
  }
  
  if (robot.strategyType === 'KAMA' && isValid(kama)) {
    if (lastClose > kama) setVote('RISE', robot.weakConfidence, `Tendência KAMA Alta`);
    else if (lastClose < kama) setVote('FALL', robot.weakConfidence, `Tendência KAMA Baixa`);
  }
  
  if (robot.strategyType === 'DONCHIAN_CHANNELS' && isValid(donchian?.upper) && isValid(donchian?.lower)) {
    if (lastClose >= donchian.upper) setVote('RISE', robot.strongConfidence, `Rompimento Donchian Alta`);
    else if (lastClose <= donchian.lower) setVote('FALL', robot.strongConfidence, `Rompimento Donchian Baixa`);
  }
  
  if (robot.strategyType === 'CHANDELIER_EXIT' && isValid(chandelier?.exitLong) && isValid(chandelier?.exitShort)) {
     if (lastClose > chandelier.exitShort) setVote('RISE', robot.weakConfidence, 'Acima Chandelier Short');
     else if (lastClose < chandelier.exitLong) setVote('FALL', robot.weakConfidence, 'Abaixo Chandelier Long');
  }
  
  if (robot.strategyType === 'VOLUME_PROFILE') {
     const range = Math.abs(lastCandle.high - lastCandle.low);
     const avgRange = (indicators.atr || 1);
     
     if (range > avgRange * 1.5 && lastClose > lastCandle.open) setVote('RISE', robot.weakConfidence, 'Expansão de Volume Alta');
     else if (range > avgRange * 1.5 && lastClose < lastCandle.open) setVote('FALL', robot.weakConfidence, 'Expansão de Volume Baixa');
  }

  if (robot.strategyType === 'VWAP' && vwap && vwap.length > 0 && isValid(vwap[vwap.length-1])) {
    const lastVwap = vwap[vwap.length-1]!;
    if (lastClose > lastVwap) setVote('RISE', robot.weakConfidence, `Preço > VWAP`);
    else if (lastClose < lastVwap) setVote('FALL', robot.weakConfidence, `Preço < VWAP`);
  }
  
  if (robot.strategyType === 'MFI' && isValid(mfi)) {
    if (mfi <= 20) setVote('RISE', robot.strongConfidence, `MFI Sobrevenda`);
    else if (mfi >= 80) setVote('FALL', robot.strongConfidence, `MFI Sobrecompra`);
  }
  
  if (robot.strategyType === 'OBV' && isValid(obv) && isValid(indicators.obvPrev)) {
    if (obv > indicators.obvPrev!) setVote('RISE', robot.weakConfidence, `OBV Subindo`);
    else if (obv < indicators.obvPrev!) setVote('FALL', robot.weakConfidence, `OBV Caindo`);
  }
  
  if (robot.strategyType === 'Z_SCORE' && isValid(zScore)) {
    if (zScore < -2.0) setVote('RISE', robot.strongConfidence, `Z-Score Desvio Negativo`);
    else if (zScore > 2.0) setVote('FALL', robot.strongConfidence, `Z-Score Desvio Positivo`);
  }
  
  if (robot.strategyType === 'STOCH_RSI' && isValid(stochRSI)) {
    if (stochRSI <= 0.2) setVote('RISE', robot.strongConfidence, `StochRSI Sobrevenda`);
    else if (stochRSI >= 0.8) setVote('FALL', robot.strongConfidence, `StochRSI Sobrecompra`);
  }
  
  if (robot.strategyType === 'MOVING_AVERAGE_CROSS' && isValid(ma?.short) && isValid(ma?.long)) {
    if (ma.short > ma.long) setVote('RISE', robot.weakConfidence, `Golden Cross`);
    else if (ma.short < ma.long) setVote('FALL', robot.weakConfidence, `Death Cross`);
  }
  
  if (robot.strategyType === 'PRICE_ACTION_PATTERN') {
      const body = Math.abs(lastClose - lastCandle.open);
      const upperShadow = lastCandle.high - Math.max(lastClose, lastCandle.open);
      const lowerShadow = Math.min(lastClose, lastCandle.open) - lastCandle.low;
      
      if (lowerShadow > body * 2 && upperShadow < body * 0.5) {
          if (lastClose < prevClose) setVote('RISE', robot.strongConfidence, 'Padrão Hammer Detectado');
      }
      else if (upperShadow > body * 2 && lowerShadow < body * 0.5) {
          if (lastClose > prevClose) setVote('FALL', robot.strongConfidence, 'Padrão Shooting Star Detectado');
      }
  }

  return { vote, confidence, reason, optimalDuration, optimalDurationUnit, suggestedStake };
};


// ════════════════════════════════════════════════════════════════════
// 🎯 HOOK PRINCIPAL
// ════════════════════════════════════════════════════════════════════

export function useRobotCouncilV2(
  activeSymbol: string | null,
  priceTicks: TickData[],
  chartData: CandleData[],
  dataVersion: number
) {
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits, sellContract, getHistoricalData } = useDerivApi();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);
  
  const executionIdRef = useRef(0);
  const contractsInAlertRef = useRef<Map<number, 'breached' | 'confirmed'>>(new Map());
  const lastActiveSymbolRef = useRef<string | null>(null);
  const lastTimePeriodRef = useRef<TimePeriod | null>(null);
  const lastRegimeRef = useRef<MarketRegime | null>(null);

  // 🔥 NOVO: Estados de Bootstrap
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const bootstrapAttemptedRef = useRef(false);

  const tickCandles = useMemo(() => {
    if (chartData && chartData.length > 0) {
      return chartData;
    }
    if (!priceTicks || priceTicks.length === 0) return [];
    return priceTicks.map((t) => ({
        epoch: t.epoch, open: t.price, high: t.price,
        low: t.price, close: t.price, volume: 1
    }));
  }, [chartData, priceTicks]);

  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>(evolvedStrategies as RobotStrategy[]);
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
  const [tradeDecisionLog, setTradeDecisionLog] = useState<TradeDecisionLog[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  const [councilState, setCouncilState] = useState<CouncilState>({
    indicators: null,
    currentRegime: {
        regime: 'ranging',
        confidence: 0.5,
        probabilities: { trending_bull: 0.2, trending_bear: 0.2, ranging: 0.4, high_volatility: 0.1, breakout: 0.1 }
    },
    microstructure: null,
    consensusDecision: { direction: 'HOLD', probability: 0.5, stake: 0 },
    portfolioStats: { totalExposure: 0, maxExposure: 10 * 0.3, currentDrawdown: 0, maxDrawdown: 0, dailyPnL: 0 },
    bayesianVotes: {},
    dashboardData: null,
    effectiveThreshold: 0,
    councilConfidence: 0,
    systemMetrics: {
        activeVirtualTrades: 0,
        totalVirtualTrades: 0,
        decisionLogCount: 0,
        activeRobotsCount: 0,
        memoryUsageMB: 0,
        isExecuting: false,
        lastCleanup: Date.now(),
        orphanedTradesRemoved: 0,
        sessionDuration: 0,
    },
  });

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
  const [isDynamicExitOn, setIsDynamicExitOn] = useState(true);

  const councilExecutionRef = useRef<{
    isExecuting: boolean;
    sellingContracts: Set<number>;
  }>({
    isExecuting: false,
    sellingContracts: new Set()
  });

  useEffect(() => {
    setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
  }, [evolvedStrategies]);
  
  const resetArenaPerformance = useCallback(() => {
    if (strategyCouncil.length === 0 || !user) return;

    toast({
      title: "🔄 Arena V2.5 Recalibrada",
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
    
    saveRobotPerformance(user.uid, initialPerformance);
  }, [strategyCouncil, user, toast]);

  // 🔥 NOVO: Bootstrap Automático de Dados Históricos
  useEffect(() => {
    if (!isCouncilAutopilotOn || !activeSymbol || !user || bootstrapAttemptedRef.current) return;
    
    bootstrapAttemptedRef.current = true;
    
    getHistoricalData(activeSymbol, 'candles', 1000, timePeriod)
      .then(data => {
        
        if (data.length >= REGIME_LOOKBACK) {
          setIsBootstrapped(true);
          toast({
            title: "📊 Sistema Pronto",
            description: `${data.length} candles carregados. Iniciando análise...`,
          });
        } else {
          setIsBootstrapped(false);
        }
      })
      .catch(err => {
        console.error('❌ [Bootstrap] Erro ao carregar dados:', err);
        bootstrapAttemptedRef.current = false;
        setIsBootstrapped(false);
        toast({
          title: "❌ Erro no Bootstrap",
          description: "Tentando novamente...",
          variant: "destructive"
        });
      });
  }, [isCouncilAutopilotOn, activeSymbol, timePeriod, user, getHistoricalData, toast]);
  
  useEffect(() => {
    if (!isCouncilAutopilotOn) return;

    const healthCheckCallback = () => {
        const activeRobots = robotPerformance.filter(p => (p.wins + p.losses) > 0).length;
        
        if (activeRobots === 0 && strategyCouncil.length > 0 && isBootstrapped) {
            console.warn('🚨 ALERTA: Nenhum robô ativo! Resetando sistema...');
            resetArenaPerformance();
            toast({
                title: "⚠️ Auto-Recuperação",
                description: "Sistema resetado automaticamente após inatividade detectada.",
                variant: "destructive"
            });
        }
    };
    
    const metricsInterval = setInterval(() => {
      setCouncilState(prev => ({
          ...prev,
          systemMetrics: {
              ...prev.systemMetrics,
              activeVirtualTrades: virtualTradesRef.current.length,
              totalVirtualTrades: tradeCounterRef.current,
              decisionLogCount: tradeDecisionLog.length,
              activeRobotsCount: robotPerformance.filter(p => (p.wins + p.losses) > 0).length,
              memoryUsageMB: (performance as any).memory?.usedJSHeapSize ? (performance as any).memory.usedJSHeapSize / 1024 / 1024 : 0,
              isExecuting: councilExecutionRef.current.isExecuting,
              sessionDuration: sessionStartTime ? (Date.now() - sessionStartTime) / 1000 : 0,
          }
      }));
    }, METRICS_UPDATE_INTERVAL_MS);

    const cleanupInterval = setInterval(() => {
      const now = Date.now() / 1000;
      const before = virtualTradesRef.current.length;

      virtualTradesRef.current = virtualTradesRef.current.filter(trade => {
        const age = now - trade.entryEpoch;
        return age < TRADE_TIMEOUT_SECONDS;
      }).slice(-MAX_VIRTUAL_TRADES);

      const removed = before - virtualTradesRef.current.length;
      
      if (removed > 0) {
        setCouncilState(prev => ({
            ...prev,
            systemMetrics: {
                ...prev.systemMetrics,
                orphanedTradesRemoved: prev.systemMetrics.orphanedTradesRemoved + removed,
                lastCleanup: Date.now(),
            }
        }));
      }
    }, CLEANUP_INTERVAL_MS);
    
    const healthCheck = setInterval(healthCheckCallback, HEALTH_CHECK_INTERVAL_MS);

    return () => {
        clearInterval(metricsInterval);
        clearInterval(cleanupInterval);
        clearInterval(healthCheck);
    };
  }, [isCouncilAutopilotOn, robotPerformance, strategyCouncil, isBootstrapped, resetArenaPerformance, toast, tradeDecisionLog.length, sessionStartTime]);
  
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
    tradeCounterRef.current = 0;

    toast({
      title: '🚀 Sistema V2.5 Ativado',
      description: `${council.length} robôs com IA avançada iniciados.`,
    });
    
    setSessionStartTime(Date.now());
    setIsCouncilAutopilotOn(true);
    lastActiveSymbolRef.current = activeSymbol;
    lastTimePeriodRef.current = timePeriod;
    setIsFetchingCouncil(false);
  }, [activeSymbol, user, toast, evolvedStrategies, resetArenaPerformance, timePeriod]);

  // 🔥 MODIFICADO: Reset de bootstrap ao mudar contexto
  useEffect(() => {
    const symbolChanged = activeSymbol && lastActiveSymbolRef.current !== activeSymbol;
    const timePeriodChanged = timePeriod && lastTimePeriodRef.current !== timePeriod;
  
    if (isCouncilAutopilotOn && (symbolChanged || timePeriodChanged)) {
      bootstrapAttemptedRef.current = false;
      setIsBootstrapped(false);
      resetArenaPerformance();
  
      if (symbolChanged) lastActiveSymbolRef.current = activeSymbol;
      if (timePeriodChanged) lastTimePeriodRef.current = timePeriod;
    }
  }, [activeSymbol, timePeriod, isCouncilAutopilotOn, resetArenaPerformance]);
  
  const dissolveCouncil = useCallback(() => {
    setIsFetchingCouncil(true);
    toast({
      title: 'Dispensando a Mesa V2.5...',
      description: 'A guardar os dados finais da sessão.',
    });

    setTimeout(() => {
      setIsCouncilAutopilotOn(false);
      virtualTradesRef.current = [];
      bootstrapAttemptedRef.current = false;
      setIsBootstrapped(false);
      setIsFetchingCouncil(false);
      setSessionStartTime(null);
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

  // 🔥 MODIFICADO: runCouncilCycle com validação de bootstrap
  const runCouncilCycle = useCallback(() => {
    
    if (!isBootstrapped) {
      return;
    }

    if (!isConnected || !user || !isCouncilAutopilotOn || councilExecutionRef.current.isExecuting ||
        strategyCouncil.length === 0 || !activeSymbol || tickCandles.length < REGIME_LOOKBACK) {
        return;
    }
    
    councilExecutionRef.current.isExecuting = true;
    const currentExecutionId = ++executionIdRef.current;
    
    try {
        const currentTick = priceTicks[priceTicks.length - 1];
        if (!currentTick) {
            councilExecutionRef.current.isExecuting = false;
            return;
        }

        const validCandles = validateCandles(tickCandles, REGIME_LOOKBACK);
        if (validCandles.length < REGIME_LOOKBACK) {
          councilExecutionRef.current.isExecuting = false;
          return;
        }

        const contractDurationForIndicators = { duration: 5, unit: 'm' as DurationUnit };
        const currentIndicators = calculateAllIndicators(
            validCandles, strategyCouncil, timePeriod, contractDurationForIndicators
        );
        
        // 🔥 VALIDAÇÃO EXPLÍCITA DE INDICADORES
        if (!currentIndicators) {
            councilExecutionRef.current.isExecuting = false;
            return;
        }
        
        if (!isValid(currentIndicators.adx)) {
            councilExecutionRef.current.isExecuting = false;
            return;
        }
        
        const regimeResult = detectMarketRegime(
            validCandles,
            { adx: currentIndicators.adx, pdi: currentIndicators.pdi, ndi: currentIndicators.ndi, bbw: currentIndicators.bbw, roc: currentIndicators.roc, atr: currentIndicators.atr },
            lastRegimeRef.current || 'ranging',
            transitionMatrixRef.current
        );
        
        if (lastRegimeRef.current && lastRegimeRef.current !== regimeResult.regime) {
            resetArenaPerformance();
        }
        lastRegimeRef.current = regimeResult.regime;

        const microFeatures = extractMicrostructureFeatures(priceTicks, validCandles);
        
        const activeCouncilContracts = operationsLog.filter(
            op => op.status === 'pending' && op.initiator === 'Conselho'
        );
        
        if (isDynamicExitOn) {
            activeCouncilContracts.forEach(contract => {
                const contractDurationInSeconds = durationToSeconds(contract.duration, contract.durationUnit);
                if (contractDurationInSeconds <= 15) return;
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
        }

        const stillActiveTrades: VirtualTrade[] = [];
        const performanceMap = new Map<string, EnhancedRobotPerformance>();
        strategyCouncil.forEach(robot => {
            const existing = robotPerformance.find(p => p.id === robot.id);
            if (existing) {
                performanceMap.set(robot.id, { ...existing });
            } else {
                performanceMap.set(robot.id, {
                    id: robot.id, strategyType: robot.strategyType, strategy: robot, wins: 0, losses: 0, totalProfit: 0, winRate: 0,
                    sharpeRatio: 0, maxDrawdown: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, kellyFraction: 0, effectiveRegimes: [],
                    monteCarloScore: 0, lastUpdated: Date.now(), tradeHistory: []
                });
            }
        });

        let performanceChanged = false;
        virtualTradesRef.current.forEach(trade => {
            const isExpired = currentTick.epoch >= (trade.exitEpoch - 5);
            if (isExpired) {
                const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;
                const isWin = (trade.vote === 'RISE' && exitTick.price > trade.entryPrice) || (trade.vote === 'FALL' && exitTick.price < trade.entryPrice);
                const pnl = isWin ? VIRTUAL_STAKE * 0.95 : -VIRTUAL_STAKE;
                const perf = performanceMap.get(trade.robotId);
                if (perf) {
                    perf.totalProfit += pnl;
                    if (!perf.tradeHistory) perf.tradeHistory = [];
                    perf.tradeHistory.push(pnl);
                    if (isWin) perf.wins++; else perf.losses++;
                    const totalTrades = perf.wins + perf.losses;
                    if (totalTrades > 0) {
                        perf.winRate = (perf.wins / totalTrades) * 100;
                    } else {
                        perf.winRate = 0;
                    }
                    if (perf.tradeHistory.length >= MIN_TRADES_FOR_STATS) {
                        const metrics = calculatePerformanceMetrics(perf.tradeHistory.map((profit, idx) => ({ profit, timestamp: Date.now() - (perf.tradeHistory.length - idx) * 60000 })));
                        Object.assign(perf, metrics);
                    }
                    perf.lastUpdated = Date.now();
                    performanceChanged = true;
                }
            } else {
                if (currentTick.epoch - trade.entryEpoch <= TRADE_TIMEOUT_SECONDS) {
                    stillActiveTrades.push(trade);
                }
            }
        });
        virtualTradesRef.current = stillActiveTrades;
        if (performanceChanged) {
            const updatedPerformance = Array.from(performanceMap.values());
            updatedPerformance.sort((a, b) => b.sharpeRatio - a.sharpeRatio);
            setRobotPerformance(updatedPerformance);
            evolveTrigger(updatedPerformance);
            if (user) {
                saveRobotPerformance(user.uid, updatedPerformance).catch(err => console.error('❌ Erro ao salvar:', err));
            }
        }

        const localBayesianVotes: Record<string, BayesianVote> = {};
        let riseSum = 0, fallSum = 0, totalWeight = 0, weightedStakeSum = 0, weightedDurationSum = 0;
        let activeRobotsCount = 0;
        
        strategyCouncil.forEach(robot => {
            const technicalVote = calculateTechnicalVote(robot, currentIndicators, validCandles);
            
            if (technicalVote.vote !== 'HOLD') {
                const hasActiveTrade = virtualTradesRef.current.some(t => t.robotId === robot.id && t.exitEpoch > currentTick.epoch);
                if (!hasActiveTrade) {
                    const durationInSeconds = durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit);
                    const tradeId = `vt_${Date.now()}_${tradeCounterRef.current++}`;
                    virtualTradesRef.current.push({ id: tradeId, robotId: robot.id, vote: technicalVote.vote, entryPrice: currentTick.price, entryEpoch: currentTick.epoch, exitEpoch: currentTick.epoch + durationInSeconds, regime: regimeResult.regime, microstructure: microFeatures!, stake: VIRTUAL_STAKE });
                }
            }

            if (technicalVote.confidence < confidenceFactor) {
                localBayesianVotes[robot.id] = { ...technicalVote, rawConfidence: technicalVote.confidence, calibratedConfidence: 0, bayesianProbability: 0.5, weight: 0, regime: regimeResult.regime, reason: `Confiança (${technicalVote.confidence.toFixed(0)}) < Limiar (${confidenceFactor})` };
                return;
            }
            
            const durationInSeconds = durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit);
            const perf = performanceMap.get(robot.id);
            const isRegimeEffective = !perf?.effectiveRegimes?.length || perf.effectiveRegimes.includes(regimeResult.regime);
            const isDurationInRange = durationInSeconds >= durationRange[0] && durationInSeconds <= durationRange[1];
            
            if (!isRegimeEffective || !isDurationInRange) {
                localBayesianVotes[robot.id] = { ...technicalVote, rawConfidence: 0, calibratedConfidence: 0, bayesianProbability: 0.5, weight: 0, regime: regimeResult.regime, reason: 'Fora de Regime/Duração' };
                return;
            }

            activeRobotsCount++;
            let prior = (perf && (perf.wins + perf.losses) >= MIN_TRADES_FOR_STATS) ? perf.winRate / 100 : 0.5;
            let likelihood = technicalVote.confidence / 100;
            if (microFeatures && microFeatures.yangZhangVolatility > 0.05) likelihood *= 0.8;
            const posterior = bayesianUpdate(prior, likelihood);
            const calibratedConf = calibrateConfidence(technicalVote.confidence, perf?.winRate || 50) / 100;
            let weight = 1.0;
            if (isMeritocracyOn && perf && (perf.wins + perf.losses) > 10) {
                const sharpeWeight = Math.max(0.2, Math.min(2.0, (perf.sharpeRatio || 0) / 1.5));
                const mcWeight = perf.monteCarloScore >= 0.95 ? 1.2 : perf.monteCarloScore >= 0.85 ? 1.0 : 0.5;
                weight = sharpeWeight * mcWeight;
            }
            const finalVote: BayesianVote = { ...technicalVote, rawConfidence: technicalVote.confidence, calibratedConfidence: calibratedConf * 100, bayesianProbability: posterior, weight, suggestedStake: technicalVote.suggestedStake * posterior, regime: regimeResult.regime, sharpeRatio: perf?.sharpeRatio, strategy: robot };
            localBayesianVotes[robot.id] = finalVote;
            const voteWeight = calibratedConf * weight;
            if (technicalVote.vote === 'RISE') riseSum += voteWeight;
            if (technicalVote.vote === 'FALL') fallSum += voteWeight;
            weightedStakeSum += finalVote.suggestedStake * voteWeight;
            weightedDurationSum += durationInSeconds * voteWeight;
            totalWeight += voteWeight;
        });

        let consensusDirection: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
        let consensusProbability = 0.5;
        if (totalWeight > 0 && (riseSum + fallSum) > 0) {
            consensusProbability = Math.max(riseSum, fallSum) / (riseSum + fallSum);
            if (riseSum > fallSum && riseSum > 0) consensusDirection = 'RISE';
            else if (fallSum > riseSum && fallSum > 0) consensusDirection = 'FALL';
        }

        const dailyPnL = operationsLog.filter(op => op.initiator === 'Conselho' && new Date(op.timestamp).toDateString() === new Date().toDateString()).reduce((sum, op) => sum + (op.result || 0), 0);

        if (dailyPnL <= -dailyBalance) { 
          toast({ title: "🛑 Stop Loss Diário", description: "Operações suspensas.", variant: "destructive" }); 
          councilExecutionRef.current.isExecuting = false; 
          return; 
        }
        if (dailyPnL >= dailyTarget) { 
          toast({ title: "🎯 Meta Batida", description: `Lucro de ${dailyPnL.toFixed(2)}!` }); 
          councilExecutionRef.current.isExecuting = false; 
          return; 
        }
        
        const calculatedEffectiveThreshold = (isDynamicConsensusOn && totalWeight > 0)
            ? (totalWeight * (consensusSensitivity / 100) * Math.pow(1 + (microFeatures ? Math.min(microFeatures.yangZhangVolatility * 5, 1) : 0), 1.5)) 
            : Infinity;
        const consensusReached = totalWeight > 0 && Math.max(riseSum, fallSum) >= calculatedEffectiveThreshold;

        let kellyStake = calculateKellyStake(dailyBalance - councilState.portfolioStats.totalExposure, consensusProbability, 0.95);
        if (microFeatures) {
            const isSpike = microFeatures.isSpike;
            if (isSpike) { 
              toast({ title: "🛡️ Veto Total", description: "Pico anômalo detectado.", variant: "destructive" }); 
              councilExecutionRef.current.isExecuting = false; 
              return; 
            }
            if ((consensusDirection === 'RISE' && microFeatures.pressure === 'sell') || (consensusDirection === 'FALL' && microFeatures.pressure === 'buy')) { 
              kellyStake *= 0.5; 
              toast({ title: "⚠️ Veto Parcial", description: "Risco reduzido." }); 
            }
            if (regimeResult.regime === 'breakout' && microFeatures.pressure === (consensusDirection === 'RISE' ? 'buy' : 'sell')) { 
              kellyStake *= 1.2; 
              toast({ title: "✅ Breakout Confirmado", description: "Risco aumentado." }); 
            }
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

        const activeStakes = activeCouncilContracts.reduce((sum, c) => sum + c.stake, 0);
        
        const { indicators } = councilState;
        
        setCouncilState(prev => ({
            ...prev,
            indicators: currentIndicators,
            currentRegime: { regime: regimeResult.regime, confidence: regimeResult.confidence, probabilities: regimeResult.probabilities },
            microstructure: microFeatures,
            consensusDecision: { direction: consensusDirection, probability: consensusProbability, stake: kellyStake },
            portfolioStats: { totalExposure: activeStakes, maxExposure: dailyBalance * 0.3, currentDrawdown: Math.abs(dailyPnL / dailyBalance * 100), maxDrawdown: prev.portfolioStats.maxDrawdown, dailyPnL: dailyPnL },
            bayesianVotes: localBayesianVotes,
            dashboardData: { regime: regimeResult.regime, bayesianProbability: consensusProbability, consensusDirection, activeRobotsCount, microstructure: { pressure: microFeatures ? microFeatures.volumeImbalance : 0.5, velocity: microFeatures ? microFeatures.tickVelocity : 0, isSpike: microFeatures ? microFeatures.isSpike : false }, kellyStake },
            effectiveThreshold: calculatedEffectiveThreshold,
            councilConfidence: totalWeight,
        }));

        if (!consensusReached || activeStakes + kellyStake > dailyBalance * 0.3 || consensusProbability < 0.65 || consensusDirection === "HOLD") {
            councilExecutionRef.current.isExecuting = false;
            return;
        }

        const decisionLog: TradeDecisionLog = { id: `TDL-${Date.now()}`, timestamp: new Date().toISOString(), asset: activeSymbol, timePeriod, tradeParams: { direction: consensusDirection, stake: kellyStake, duration: finalDuration, durationUnit: finalDurationUnit }, context: { marketRegime: regimeResult.regime, regimeConfidence: regimeResult.confidence, microstructure: microFeatures, indicators: currentIndicators, supervisionReason: "N/A" }, consensus: { bayesianProbability: consensusProbability, kellyStake, activeRobots: activeRobotsCount, votes: localBayesianVotes }, result: 'pending', pnl: 0 };
        setTradeDecisionLog(prev => [...prev, decisionLog].slice(-MAX_DECISION_LOG));
        
        toast({ title: "🚀 Ordem Executada", description: `${consensusDirection} com ${kellyStake.toFixed(2)} (${(consensusProbability * 100).toFixed(1)}%)` });    
        executeTrade(consensusDirection === 'RISE' ? 'CALL' : 'PUT', kellyStake, activeSymbol!, consensusDirection.toLowerCase() as 'rise' | 'fall', finalDuration, finalDurationUnit, 'Conselho')
            .finally(() => {
                setTimeout(() => {
                    if (currentExecutionId === executionIdRef.current) {
                        councilExecutionRef.current.isExecuting = false;
                    }
                }, TRADE_COOLDOWN_MS);
            });
        
        console.log('═══════════════════════════════════════');
        console.log('🔍 VALIDAÇÃO ARQUITETURA V2.5');
        console.log('═══════════════════════════════════════');

        // 1. Fonte de Dados
        console.log('1️⃣ FONTE DE DADOS:');
        console.log('   chartData (direto):', chartData?.length || 0, 'candles');
        console.log('   priceTicks (fallback):', priceTicks?.length || 0, 'ticks');
        console.log('   tickCandles (usado):', tickCandles?.length || 0);

        // 2. Bootstrap
        console.log('\n2️⃣ BOOTSTRAP:');
        console.log('   Status:', isBootstrapped ? '✅ OK' : '❌ PENDENTE');
        console.log('   Tentativa feita:', bootstrapAttemptedRef?.current ? 'Sim' : 'Não');

        // 3. Indicadores
        console.log('\n3️⃣ INDICADORES:');
        console.log('   Status:', indicators ? '✅ OK' : '❌ NULL');
        if (indicators) {
        console.log('   RSI:', indicators.rsi?.toFixed(2) || 'N/A');
        console.log('   ADX:', indicators.adx?.toFixed(2) || 'N/A');
        console.log('   MACD:', indicators.macd?.histogram?.toFixed(4) || 'N/A');
        }

        // 4. Regime
        const { currentRegime } = councilState;
        console.log('\n4️⃣ REGIME:');
        console.log('   Tipo:', currentRegime?.regime || 'N/A');
        console.log('   Confiança:', ((currentRegime?.confidence || 0) * 100).toFixed(0) + '%');

        // 5. Robôs
        const { bayesianVotes } = councilState;
        console.log('\n5️⃣ ROBÔS:');
        console.log('   Conselho:', strategyCouncil?.length || 0);
        console.log('   Com Votos:', Object.keys(bayesianVotes || {}).length);
        console.log('   Ativos (weight>0):', Object.values(bayesianVotes || {}).filter(v => v.weight > 0).length);

        // 6. Arena Virtual
        console.log('\n6️⃣ ARENA VIRTUAL:');
        console.log('   Trades Ativos:', virtualTradesRef.current?.length || 0);

        // 7. Consenso
        const { consensusDecision } = councilState;
        console.log('\n7️⃣ CONSENSO:');
        console.log('   Direção:', consensusDecision?.direction || 'N/A');
        console.log('   Probabilidade:', ((consensusDecision?.probability || 0) * 100).toFixed(0) + '%');
        console.log('   Stake:', '$' + (consensusDecision?.stake || 0).toFixed(2));

        console.log('═══════════════════════════════════════');

    } catch (error) {
        console.error("🚨 ERRO CRÍTICO NO CICLO:", error);
        councilExecutionRef.current.isExecuting = false;
    }
  }, [
    isBootstrapped,
    dataVersion,
    isConnected, user, isCouncilAutopilotOn,
    priceTicks, tickCandles,
    strategyCouncil, robotPerformance, isMeritocracyOn,
    activeSymbol, timePeriod,
    dailyBalance, dailyTarget,
    consensusSensitivity, confidenceFactor, durationRange,
    isDynamicConsensusOn, isDynamicRiskOn, isDynamicExitOn,
    stopLossThreshold, takeProfitThreshold,
    toast, executeTrade, sellContract, resetArenaPerformance, evolveTrigger, operationsLog, councilState.portfolioStats.totalExposure, durationLimits, chartData, councilState
  ]);

  useEffect(() => {
    if (!isCouncilAutopilotOn) return;
    const intervalId = setInterval(runCouncilCycle, THROTTLE_MS);
    return () => clearInterval(intervalId);
  }, [runCouncilCycle, isCouncilAutopilotOn]);

  const {
    indicators, currentRegime, microstructure, consensusDecision,
    portfolioStats, bayesianVotes, dashboardData, effectiveThreshold,
    councilConfidence, systemMetrics
  } = councilState;

  return {
    isCouncilAutopilotOn,
    setIsCouncilAutopilotOn,
    fetchStrategyCouncil,
    dissolveCouncil,
    isFetchingCouncil,
    strategyCouncil,
    robotPerformance,
    evolutionHistory,
    indicators,
    currentRegime,
    microstructure,
    consensusDecision,
    portfolioStats,
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
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
    isDynamicConsensusOn,
    setIsDynamicConsensusOn,
    isDynamicRiskOn,
    setIsDynamicRiskOn,
    isMeritocracyOn,
    setIsMeritocracyOn,
    isDynamicExitOn,
    setIsDynamicExitOn,
    dashboardData,
    effectiveThreshold,
    councilConfidence,
    resetArenaPerformance,
    tradeDecisionLog,
    systemMetrics,
    bayesianVotes,
    // Compatibilidade com a interface V1
    supervisionStatus: { status: 'approved', message: 'Cérebro V2.5 Ativo' },
  };
}
