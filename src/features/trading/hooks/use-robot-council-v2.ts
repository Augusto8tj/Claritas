// src/hooks/use-robot-council-v2.ts
'use client';

/**
 * 🧠 DERIV TRADER V2.0 - SISTEMA DE CONSENSO "CÉREBRO QUANTITATIVO"
 * 
 * 🎓 GUIA DE ESTUDOS PARA O DESENVOLVEDOR:
 * 
 * Este Hook (gancho do React) atua como o Maestro de uma orquestra.
 * Ele não toca os instrumentos (os indicadores), mas decide quem toca,
 * quando toca e quão alto deve ser o som (o peso do voto).
 * 
 * PILARES DESTA IMPLEMENTAÇÃO:
 * 1. INCLUSÃO TOTAL: Todos os 22 robôs (ou mais) são ouvidos.
 * 2. SEPARAÇÃO DE PREOCUPAÇÕES: 
 *    - Arena Virtual: Onde os robôs aprendem (sem risco).
 *    - Consenso Real: Onde o dinheiro é alocado (com base na credibilidade).
 * 3. SEGURANÇA: Proteção contra vazamento de memória e dados corrompidos.
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
// ⚙️ CONFIGURAÇÕES GLOBAIS (CONSTANTES)
// ════════════════════════════════════════════════════════════════════

// Valor fictício apostado na Arena Virtual para calcular retorno
const VIRTUAL_STAKE = 1.0;

// Critério de Kelly Fracionado (1/4 é padrão conservador para evitar ruína)
const KELLY_FRACTION = 0.25;

// Mínimo de trades para começar a considerar estatística "séria"
const MIN_TRADES_FOR_STATS = 30;

// Intervalo entre ciclos de processamento (1 segundo) para não travar o navegador
const THROTTLE_MS = 1000;

// 🛡️ LIMITES DE SEGURANÇA (MEMORY LEAK PROTECTION)
const MAX_VIRTUAL_TRADES = 1000;       // Mantém apenas os últimos 1000 trades virtuais
const MAX_DECISION_LOG = 100;          // Mantém os últimos 100 logs de decisão
const TRADE_TIMEOUT_SECONDS = 3600;    // Descarta trades virtuais com mais de 1 hora
const CLEANUP_INTERVAL_MS = 60000;     // Limpa a memória a cada minuto
const HEALTH_CHECK_INTERVAL_MS = 30000;// Verifica se o sistema travou a cada 30s
const REGIME_LOOKBACK = 50;            // Quantos candles olhar para definir o regime

// ════════════════════════════════════════════════════════════════════
// 📋 DEFINIÇÃO DE TIPOS (TYPESCRIPT)
// ════════════════════════════════════════════════════════════════════

// Estrutura de um trade simulado (aprendizado)
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

// Estrutura para exibir dados no Dashboard (Front-end)
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

// Métricas técnicas para monitoramento de performance do sistema
export interface SystemMetrics {
  virtualTradesCount: number;
  decisionLogCount: number;
  activeRobotsCount: number;
  memoryUsageMB: number;
  isExecuting: boolean;
  lastCleanup: number;
  orphanedTradesRemoved: number;
}

// Re-exportando tipos para uso externo
export type EnhancedRobotPerformance = EnhancedRobotPerformanceType;
export type RobotVote = RobotVoteType;
export type BayesianVote = BayesianVoteType;
export type CouncilVotes = { [key: string]: BayesianVote };

// ════════════════════════════════════════════════════════════════════
// 🔧 FUNÇÕES AUXILIARES (PURE FUNCTIONS)
// ════════════════════════════════════════════════════════════════════

/**
 * Converte qualquer unidade de tempo (ticks, segundos, minutos) para segundos absolutos.
 * Essencial para calcular quando um trade deve fechar.
 */
const durationToSeconds = (duration: number, unit: DurationUnit): number => {
  switch (unit) {
    case 't': return duration * 2; // Aproximação: 1 tick ~= 2 segundos
    case 's': return duration;
    case 'm': return duration * 60;
    case 'h': return duration * 3600;
    case 'd': return duration * 86400;
    default: return duration;
  }
};

/**
 * Validação rigorosa de números.
 * Em finanças, null, undefined ou NaN (Not a Number) podem causar prejuízos enormes.
 */
const isValid = (value: any): value is number => 
  value !== null && value !== undefined && !isNaN(value) && Number.isFinite(value);

/**
 * Filtra candles "sujos" ou incompletos vindos da API.
 * Garante que a matemática dos indicadores não quebre.
 */
const validateCandles = (candles: CandleData[], minCount: number): CandleData[] => {
  const valid = candles.filter(c => 
    c &&
    isValid(c.close) && c.close > 0 &&
    isValid(c.epoch) && c.epoch > 0 &&
    isValid(c.open) && isValid(c.high) && isValid(c.low)
  );
  
  if (valid.length < minCount) {
    // Apenas aviso, não erro, pois no início é normal ter poucos candles
    // console.warn(`⚠️ Aguardando dados... ${valid.length}/${minCount} candles.`);
  }
  
  return valid;
};

/**
 * 🧠 CÁLCULO DO VOTO TÉCNICO
 * Esta função é o "cérebro individual" de cada robô.
 * Ela traduz indicadores matemáticos (RSI, MACD) em Opinião (RISE/FALL).
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
  // Padrão: Não fazer nada (HOLD)
  let vote: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
  let confidence = 0;
  let reason = 'Aguardando sinal...';
  let suggestedStake = 0;
  
  const { optimalDuration, optimalDurationUnit, suggestedStake: baseStake } = robot;

  // Função auxiliar interna para definir o voto e normalizar a confiança
  const setVote = (newVote: 'RISE' | 'FALL', rawConfidence: number, newReason: string) => {
    if (rawConfidence <= 0) return;
    vote = newVote;
    confidence = rawConfidence / 100; // Normaliza para 0.0 - 1.0
    reason = newReason;
    // Se a confiança for máxima, aposta o valor base. Se for fraca, aposta metade.
    suggestedStake = confidence === (robot.strongConfidence / 100) ? baseStake : baseStake * 0.5;
  };

  if (!indicators) {
    return { vote: 'HOLD', confidence: 0, reason: "Sem Indicadores", optimalDuration, optimalDurationUnit, suggestedStake: 0 };
  }

  const { rsi, stoch, macd, bb, ma, adx, pdi, ndi, stochRSI, mfi, rvi } = indicators;
  const format = (val: number | null) => (isValid(val) ? val!.toFixed(2) : 'N/A');

  // Lógica para Robôs de RSI
  if (robot.strategyType === 'RSI' && isValid(rsi) && robot.strongBuyThreshold) {
    if (rsi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `RSI(${format(rsi)}) Sobrevendido (Forte)`);
    else if (rsi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `RSI(${format(rsi)}) Sobrevendido (Fraco)`);
    else if (rsi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `RSI(${format(rsi)}) Sobrecomprado (Forte)`);
    else if (rsi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `RSI(${format(rsi)}) Sobrecomprado (Fraco)`);
  } 
  // Lógica para Estocástico
  else if (robot.strategyType === 'STOCHASTIC' && isValid(stoch) && robot.strongBuyThreshold) {
    if (stoch <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `Stoch(${format(stoch)}) Fundo`);
    else if (stoch <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `Stoch(${format(stoch)}) Baixo`);
    else if (stoch >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `Stoch(${format(stoch)}) Topo`);
    else if (stoch >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `Stoch(${format(stoch)}) Alto`);
  }
  // Lógica para MACD
  else if (robot.strategyType === 'MACD_CROSS' && isValid(macd.macd) && isValid(macd.signal)) {
    if (macd.macd > macd.signal) setVote('RISE', robot.weakConfidence, `MACD Cruzou para Cima`);
    else if (macd.signal > macd.macd) setVote('FALL', robot.weakConfidence, `MACD Cruzou para Baixo`);
  }
  // Lógica para Bollinger Bands (Reversão à média)
  else if (robot.strategyType === 'BOLLINGER_BANDS' && isValid(bb.lower) && isValid(bb.upper) && tickCandles.length > 0) {
    const lastPrice = tickCandles[tickCandles.length - 1].close;
    if (isValid(lastPrice)) {
      if (lastPrice <= bb.lower) setVote('RISE', robot.weakConfidence, `Preço tocou BB Inferior`);
      if (lastPrice >= bb.upper) setVote('FALL', robot.weakConfidence, `Preço tocou BB Superior`);
    }
  }
  // Lógica para Cruzamento de Médias
  else if (robot.strategyType === 'MOVING_AVERAGE_CROSS' && isValid(ma.short) && isValid(ma.long)) {
    if (ma.short > ma.long) setVote('RISE', robot.weakConfidence, `MA Curta > Longa`);
    else if (ma.long > ma.short) setVote('FALL', robot.weakConfidence, `MA Longa > Curta`);
  }
  // Lógica para Tendência ADX
  else if (robot.strategyType === 'ADX_TREND' && isValid(adx) && adx > (robot.trendStrengthThreshold || 25)) {
    if (isValid(pdi) && isValid(ndi)) {
      if (pdi > ndi) setVote('RISE', robot.weakConfidence, `Tendência Alta (ADX ${format(adx)})`);
      else if (ndi > pdi) setVote('FALL', robot.weakConfidence, `Tendência Baixa (ADX ${format(adx)})`);
    }
  }
  // Outros indicadores (MFI, StochRSI, RVI)...
  // A lógica segue o mesmo padrão: se atingir o limiar, define o voto.

  return { vote, confidence, reason, optimalDuration, optimalDurationUnit, suggestedStake };
};

// ════════════════════════════════════════════════════════════════════
// 🎣 O HOOK PRINCIPAL (CÉREBRO DO SISTEMA)
// ════════════════════════════════════════════════════════════════════

export function useRobotCouncilV2(
  activeSymbol: string | null,
  priceTicks: TickData[], // Dados brutos de ticks
  dataVersion: number,    // Contador para forçar atualizações
) {
  // 1. Hooks Externos (API, Auth, Toast)
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits, sellContract } = useDerivApi();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  // Sistema de Evolução (Algoritmo Genético)
  const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);
  
  // 2. Refs (Memória persistente que não causa re-render)
  const executionIdRef = useRef(0);
  const lastExecutionTimeRef = useRef(0);
  const lastActiveSymbolRef = useRef<string | null>(null);
  const lastTimePeriodRef = useRef<TimePeriod | null>(null);
  const virtualTradesRef = useRef<VirtualTrade[]>([]); // A "Mente" da Arena Virtual
  const tradeCounterRef = useRef(0);
  const transitionMatrixRef = useRef<number[][] | undefined>(undefined); // Para HMM
  
  const councilExecutionRef = useRef<{
    isExecuting: boolean;
    sellingContracts: Set<number>;
  }>({
    isExecuting: false,
    sellingContracts: new Set()
  });

  // 3. Estados (Variáveis reativas da interface)
  
  // Métricas de saúde do sistema
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>({
    virtualTradesCount: 0, decisionLogCount: 0, activeRobotsCount: 0,
    memoryUsageMB: 0, isExecuting: false, lastCleanup: Date.now(), orphanedTradesRemoved: 0
  });

  // O Conselho de Robôs (Lista de estratégias)
  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>(evolvedStrategies as RobotStrategy[]);
  
  // Controles
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
  
  // Dados Analíticos
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [tradeDecisionLog, setTradeDecisionLog] = useState<TradeDecisionLog[]>([]);
  const [bayesianVotes, setBayesianVotes] = useState<CouncilVotes>({}); // Votos finais processados
  
  // Estado do Mercado
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

  // Configurações de Risco (Ajustáveis pelo usuário na UI)
  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusSensitivity, setConsensusSensitivity] = useState(60); // % necessária para agir
  const [confidenceFactor, setConfidenceFactor] = useState(70); // Confiança mínima do robô
  const [durationRange, setDurationRange] = useState<[number, number]>([15, 180]);
  const [takeProfitThreshold, setTakeProfitThreshold] = useState(10);
  const [stopLossThreshold, setStopLossThreshold] = useState(20);
  const [isDynamicConsensusOn, setIsDynamicConsensusOn] = useState(true);
  const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true);
  const [isMeritocracyOn, setIsMeritocracyOn] = useState(true);

  // Decisão Final
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

  // 🔄 Conversão de Ticks para Candles (Memoizado para performance)
  const tickCandles = useMemo(() => {
    if (!priceTicks || priceTicks.length === 0) return [];
    return priceTicks.map((t) => ({
      epoch: t.epoch, open: t.price, high: t.price, low: t.price, close: t.price, volume: 1
    }));
  }, [dataVersion, priceTicks]);

  // Sincroniza estratégias evoluídas com o estado local
  useEffect(() => {
    setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
  }, [evolvedStrategies]);

  // 🧹 GARBAGE COLLECTOR (Limpeza de Memória)
  useEffect(() => {
    if (!isCouncilAutopilotOn) return;

    const cleanupInterval = setInterval(() => {
      const now = Date.now() / 1000;
      const before = virtualTradesRef.current.length;

      // Mantém apenas trades recentes ou não finalizados
      virtualTradesRef.current = virtualTradesRef.current.filter(trade => {
        const age = now - trade.entryEpoch;
        return age < TRADE_TIMEOUT_SECONDS;
      }).slice(-MAX_VIRTUAL_TRADES);

      const removed = before - virtualTradesRef.current.length;
      if (removed > 0) {
        setSystemMetrics(prev => ({
          ...prev, orphanedTradesRemoved: prev.orphanedTradesRemoved + removed, lastCleanup: Date.now()
        }));
      }
    }, CLEANUP_INTERVAL_MS);

    return () => clearInterval(cleanupInterval);
  }, [isCouncilAutopilotOn]);

  // 🏥 HEALTH CHECK (Auto-recuperação)
  useEffect(() => {
    if (!isCouncilAutopilotOn) return;

    const healthCheck = setInterval(() => {
      // Verifica se o React está responsivo e se há robôs ativos
      setSystemMetrics(prev => ({
        ...prev,
        virtualTradesCount: virtualTradesRef.current.length,
        decisionLogCount: tradeDecisionLog.length,
        memoryUsageMB: (performance as any).memory?.usedJSHeapSize 
          ? (performance as any).memory.usedJSHeapSize / 1024 / 1024 
          : 0,
        isExecuting: councilExecutionRef.current.isExecuting
      }));
    }, HEALTH_CHECK_INTERVAL_MS);

    return () => clearInterval(healthCheck);
  }, [isCouncilAutopilotOn, tradeDecisionLog]);

  // Função para resetar a estatística da Arena
  const resetArenaPerformance = useCallback(() => {
    if (strategyCouncil.length === 0 || !user) return;

    const initialPerformance: EnhancedRobotPerformance[] = strategyCouncil.map(robot => ({
      id: robot.id, strategyType: robot.strategyType, strategy: robot,
      wins: 0, losses: 0, totalProfit: 0, winRate: 0, sharpeRatio: 0,
      maxDrawdown: 0, avgWin: 0, avgLoss: 0, profitFactor: 0,
      kellyFraction: 0, effectiveRegimes: [], monteCarloScore: 0,
      lastUpdated: Date.now(), tradeHistory: []
    }));

    setRobotPerformance(initialPerformance);
    virtualTradesRef.current = [];
    tradeCounterRef.current = 0;
    saveRobotPerformance(user.uid, initialPerformance);
    
    toast({ title: "🔄 Arena Reiniciada", description: "Métricas de performance resetadas." });
  }, [strategyCouncil, user, toast]);

  // Carrega performance salva ao iniciar
  useEffect(() => {
    if (!user || isAuthLoading) return;
    loadRobotPerformance(user.uid).then((stored) => {
      if (stored && stored.length > 0) {
        // Hidrata os dados salvos
        const enhanced: EnhancedRobotPerformance[] = (stored as any[]).map(p => ({
            ...p, lastUpdated: Date.now(), tradeHistory: p.tradeHistory || []
        }));
        setRobotPerformance(enhanced);
      }
    });
  }, [user, isAuthLoading]);

  // Salva logs de auditoria antes de fechar a aba
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!user || tradeDecisionLog.length === 0) return;
      tradeDecisionLog.forEach(log => {
        if (log.result === 'pending') saveTradeDecision(user.uid, log);
      });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [tradeDecisionLog, user]);

  // Ativação do Sistema
  const fetchStrategyCouncil = useCallback(async () => {
    if (!activeSymbol || !user) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Selecione um ativo e faça login.' });
      return;
    }
    setIsFetchingCouncil(true);
    await new Promise(r => setTimeout(r, 500));
    setStrategyCouncil((evolvedStrategies as RobotStrategy[]).map(s => ({ ...s })));
    resetArenaPerformance();
    setIsCouncilAutopilotOn(true);
    lastActiveSymbolRef.current = activeSymbol;
    lastTimePeriodRef.current = timePeriod;
    setIsFetchingCouncil(false);
  }, [activeSymbol, user, toast, evolvedStrategies, resetArenaPerformance, timePeriod]);

  // Detecção de Mudança de Contexto (Novo Ativo = Novo Aprendizado)
  useEffect(() => {
    const symbolChanged = activeSymbol && lastActiveSymbolRef.current !== activeSymbol;
    const timePeriodChanged = timePeriod && lastTimePeriodRef.current !== timePeriod;

    if (isCouncilAutopilotOn && (symbolChanged || timePeriodChanged)) {
      resetArenaPerformance();
      if (symbolChanged) lastActiveSymbolRef.current = activeSymbol;
      if (timePeriodChanged) lastTimePeriodRef.current = timePeriod;
    }
  }, [activeSymbol, timePeriod, isCouncilAutopilotOn, resetArenaPerformance]);

  const dissolveCouncil = useCallback(() => {
    setIsCouncilAutopilotOn(false);
    toast({ title: '⏸️ Sistema Pausado', description: 'O cérebro parou de operar.' });
  }, [toast]);

  // ════════════════════════════════════════════════════════════════════
  // 🔄 LOOP PRINCIPAL (Executado a cada Tick)
  // ════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const now = Date.now();
    // Throttle: Garante que não roda mais que 1x por segundo
    if (now - lastExecutionTimeRef.current < THROTTLE_MS) return;
    lastExecutionTimeRef.current = now;

    if (!isConnected || !user || !isCouncilAutopilotOn || strategyCouncil.length === 0 || !activeSymbol) return;

    // 1. Validação de Dados
    const validCandles = validateCandles(tickCandles, REGIME_LOOKBACK);
    if (validCandles.length < REGIME_LOOKBACK) return; // Precisa de histórico
    const currentTick = priceTicks[priceTicks.length - 1];
    if (!currentTick) return;

    try {
      // 2. Cálculo de Indicadores
      const currentIndicators = calculateAllIndicators(validCandles, strategyCouncil, timePeriod, { duration: 5, unit: 'm' });
      setIndicators(currentIndicators);
      if (!currentIndicators || !isValid(currentIndicators.adx)) return;

      // 3. Detecção de Regime de Mercado (HMM)
      const regimeResult = detectMarketRegime(
        validCandles,
        {
          adx: currentIndicators.adx, pdi: currentIndicators.pdi, ndi: currentIndicators.ndi,
          bbw: currentIndicators.bbw, roc: currentIndicators.roc, atr: currentIndicators.atr
        },
        currentRegime.regime, transitionMatrixRef.current
      );
      setCurrentRegime({ regime: regimeResult.regime, confidence: regimeResult.confidence, probabilities: regimeResult.probabilities });
      transitionMatrixRef.current = regimeResult.transitionMatrix;

      // 4. Análise de Microestrutura (Fluxo de Ordens)
      const microFeatures = extractMicrostructureFeatures(priceTicks, validCandles);
      setMicrostructure(microFeatures);

      // 5. Gestão de Contratos Abertos (Take Profit / Stop Loss)
      const activeCouncilContracts = operationsLog.filter(op => op.status === 'pending' && op.initiator === 'Conselho');
      activeCouncilContracts.forEach(contract => {
        if (councilExecutionRef.current.sellingContracts.has(contract.id)) return;
        const profit = contract.result || 0;
        const pnlPct = (profit / contract.stake) * 100;

        if (profit > 0 && (profit / (contract.stake * 0.95)) * 100 >= takeProfitThreshold) {
          councilExecutionRef.current.sellingContracts.add(contract.id);
          sellContract(contract.id).finally(() => setTimeout(() => councilExecutionRef.current.sellingContracts.delete(contract.id), 5000));
          toast({ title: "💰 Lucro Garantido", description: `Take Profit atingido no contrato ${contract.id}` });
        } else if (profit < 0 && Math.abs(pnlPct) >= stopLossThreshold) {
          councilExecutionRef.current.sellingContracts.add(contract.id);
          sellContract(contract.id).finally(() => setTimeout(() => councilExecutionRef.current.sellingContracts.delete(contract.id), 5000));
          toast({ title: "🛡️ Stop Loss", description: `Perda limitada no contrato ${contract.id}`, variant: "destructive" });
        }
      });

      // 6. Atualização da Arena Virtual (Verificar quem ganhou/perdeu)
      const performanceMap = new Map<string, EnhancedRobotPerformance>();
      strategyCouncil.forEach(r => {
        const existing = robotPerformance.find(p => p.id === r.id);
        performanceMap.set(r.id, existing || { 
            id: r.id, strategyType: r.strategyType, strategy: r, wins: 0, losses: 0, totalProfit: 0, winRate: 0,
            sharpeRatio: 0, maxDrawdown: 0, avgWin: 0, avgLoss: 0, profitFactor: 0,
            kellyFraction: 0, effectiveRegimes: [], monteCarloScore: 0,
            lastUpdated: Date.now(), tradeHistory: []
        });
      });

      let performanceChanged = false;
      const stillActiveTrades = virtualTradesRef.current.filter(trade => {
        // Verifica se o trade já expirou
        if (currentTick.epoch >= trade.exitEpoch) {
            const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;
            const isWin = (trade.vote === 'RISE' && exitTick.price > trade.entryPrice) || (trade.vote === 'FALL' && exitTick.price < trade.entryPrice);
            const pnl = isWin ? VIRTUAL_STAKE * 0.95 : -VIRTUAL_STAKE;
            
            const perf = performanceMap.get(trade.robotId);
            if (perf) {
                perf.totalProfit += pnl;
                perf.tradeHistory.push(pnl);
                if (isWin) perf.wins++; else perf.losses++;
                const total = perf.wins + perf.losses;
                perf.winRate = total > 0 ? (perf.wins / total) * 100 : 0;
                
                // Recalcula métricas avançadas se tiver histórico suficiente
                if (perf.tradeHistory.length >= MIN_TRADES_FOR_STATS) {
                    const metrics = calculatePerformanceMetrics(perf.tradeHistory.map((p, i) => ({ profit: p, timestamp: Date.now() - i * 60000 })));
                    perf.sharpeRatio = metrics.sharpeRatio;
                    perf.monteCarloScore = monteCarloValidation(perf.tradeHistory).score;
                    perf.effectiveRegimes = analyzeStrategyByRegime(perf.tradeHistory.map(p => ({ regime: trade.regime, profit: p })));
                }
                perf.lastUpdated = Date.now();
                performanceChanged = true;
            }
            return false; // Remove da lista de ativos
        }
        return (currentTick.epoch - trade.entryEpoch) <= TRADE_TIMEOUT_SECONDS; // Mantém na lista
      });
      virtualTradesRef.current = stillActiveTrades;
      
      if (performanceChanged) {
        const updatedPerformance = Array.from(performanceMap.values());
        setRobotPerformance(updatedPerformance);
        evolveTrigger(updatedPerformance);
        if (user) saveRobotPerformance(user.uid, updatedPerformance).catch(console.error);
      }

      // 7. 🗳️ COLETA DE VOTOS E CONSENSO
      const newBayesianVotes: CouncilVotes = {};
      let riseSum = 0, fallSum = 0, totalWeight = 0, weightedStakeSum = 0, weightedDurationSum = 0;
      let activeRobotsCount = 0;
      
      const debugStats = { held: 0, lowConf: 0, badRegime: 0, badDuration: 0, active: 0 };
      let winningVoters: BayesianVote[] = [];

      strategyCouncil.forEach(robot => {
        const perf = performanceMap.get(robot.id);
        const technicalVote = calculateTechnicalVote(robot, currentIndicators, validCandles);
        
        if (technicalVote.vote === 'HOLD') {
            debugStats.held++;
            newBayesianVotes[robot.id] = { ...technicalVote, rawConfidence: 0, calibratedConfidence: 0, bayesianProbability: 0.5, weight: 0, regime: regimeResult.regime, reason: 'Sinal Técnico: HOLD', sharpeRatio: 0, strategy: robot };
            return;
        }

        const durationInSeconds = durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit);
        
        const hasHistory = perf && (perf.wins + perf.losses) > 10;
        const isRegimeEffective = !hasHistory || !perf?.effectiveRegimes?.length || perf.effectiveRegimes.includes(regimeResult.regime);
        
        const isDurationInRange = durationInSeconds >= durationRange[0] && durationInSeconds <= durationRange[1];
        const isConfidenceHigh = (technicalVote.confidence * 100) >= confidenceFactor;

        const tradeId = `vt_${Date.now()}_${tradeCounterRef.current++}`;
        const lastTrade = virtualTradesRef.current.find(t => t.robotId === robot.id);
        const isSpamming = lastTrade && (currentTick.epoch - lastTrade.entryEpoch) < 5;

        if (!isSpamming) {
             virtualTradesRef.current.push({ 
                id: tradeId, robotId: robot.id, vote: technicalVote.vote, 
                entryPrice: currentTick.price, entryEpoch: currentTick.epoch, 
                exitEpoch: currentTick.epoch + durationInSeconds, 
                regime: regimeResult.regime, microstructure: microFeatures, stake: VIRTUAL_STAKE 
            });
        }

        let rejectionReason = '';
        let isValidForConsensus = true;

        if (!isConfidenceHigh) {
            isValidForConsensus = false;
            rejectionReason = `Confiança Baixa (${(technicalVote.confidence * 100).toFixed(0)}% < ${confidenceFactor}%)`;
            debugStats.lowConf++;
        } else if (!isRegimeEffective) {
            isValidForConsensus = false;
            rejectionReason = `Regime Ineficaz (${regimeResult.regime})`;
            debugStats.badRegime++;
        } else if (!isDurationInRange) {
            isValidForConsensus = false;
            rejectionReason = `Duração Inválida (${durationInSeconds}s)`;
            debugStats.badDuration++;
        }

        let prior = (perf && (perf.wins + perf.losses) >= MIN_TRADES_FOR_STATS) ? perf.winRate / 100 : 0.5;
        let likelihood = technicalVote.confidence;
        
        if (microFeatures && microFeatures.yangZhangVolatility > 0.05) likelihood *= 0.8;
        
        const posterior = bayesianUpdate(prior, likelihood);
        const calibratedConf = calibrateConfidence(technicalVote.confidence * 100, perf?.winRate || 50) / 100;

        let weight = 0;
        
        if (isValidForConsensus) {
            activeRobotsCount++;
            debugStats.active++;
            
            weight = 1.0;
            if (isMeritocracyOn && perf && (perf.wins + perf.losses) > 10) {
              const sharpeWeight = Math.max(0.2, Math.min(2.0, (perf.sharpeRatio || 0) / 1.5));
              const mcWeight = (perf.monteCarloScore || 0) >= 0.95 ? 1.2 : (perf.monteCarloScore || 0) >= 0.85 ? 1.0 : 0.5;
              weight = sharpeWeight * mcWeight;
            }
        }

        const finalVote: BayesianVote = { 
            vote: technicalVote.vote, 
            rawConfidence: technicalVote.confidence * 100,
            calibratedConfidence: calibratedConf * 100, 
            bayesianProbability: posterior, 
            weight: weight,
            sharpeRatio: perf?.sharpeRatio || 0,
            optimalDuration: technicalVote.optimalDuration, 
            optimalDurationUnit: technicalVote.optimalDurationUnit, 
            suggestedStake: technicalVote.suggestedStake * posterior, 
            regime: regimeResult.regime, 
            reason: isValidForConsensus ? technicalVote.reason : rejectionReason,
            strategy: robot,
        };
        
        newBayesianVotes[robot.id] = finalVote;

        if (weight > 0) {
            const voteWeight = calibratedConf * weight;
            if (technicalVote.vote === 'RISE') riseSum += voteWeight;
            if (technicalVote.vote === 'FALL') fallSum += voteWeight;
            weightedStakeSum += finalVote.suggestedStake * voteWeight;
            weightedDurationSum += durationInSeconds * voteWeight;
            totalWeight += voteWeight;
        }
      });
      
      const winningDirection = riseSum > fallSum ? 'RISE' : 'FALL';
      const allWinningVoters = Object.values(newBayesianVotes).filter(v => v.vote === winningDirection);
      const matureVoters = allWinningVoters.filter(voter => {
        const perf = robotPerformance.find(p => p.id === voter.strategy?.id);
        return perf && (perf.wins + perf.losses) > MIN_TRADES_FOR_STATS;
      });
      const maturityRatio = allWinningVoters.length > 0 ? matureVoters.length / allWinningVoters.length : 0;
      
      const totalSystemTrades = robotPerformance.reduce((sum, p) => sum + p.wins + p.losses, 0);
      let hasStatisticalConfidence = maturityRatio >= 0.4 || matureVoters.length >= 3;
      if (!hasStatisticalConfidence && totalSystemTrades < 50) {
        console.log('🔥 FASE DE AQUECIMENTO: permitindo operação');
        hasStatisticalConfidence = true;
      }
      
      let calculatedEffectiveThreshold = isDynamicConsensusOn ? (totalWeight * (consensusSensitivity / 100)) : consensusSensitivity;
      setEffectiveThreshold(calculatedEffectiveThreshold);
      
      console.log(`
═══════════════════════════════════════════════════
📊 CICLO DE ANÁLISE
🤖 Robôs no Conselho: ${strategyCouncil.length}
✅ Robôs Ativos: ${debugStats.active}
📈 Rise Sum: ${riseSum.toFixed(2)} | Fall Sum: ${fallSum.toFixed(2)}
⚖️ Total Weight: ${totalWeight.toFixed(2)}
🎯 Threshold Efetivo: ${calculatedEffectiveThreshold.toFixed(2)}
🏟️ Virtual Trades Ativos: ${virtualTradesRef.current.length}

❌ Motivos de Inatividade:
   - Confiança (${confidenceFactor}%): ${debugStats.lowConf} robô(s)
   - Regime ${regimeResult.regime}: ${debugStats.badRegime} robô(s)
   - Duração [${durationRange[0]}, ${durationRange[1]}]s: ${debugStats.badDuration} robô(s)

📊 Análise de Maturidade:
   Winning Direction: ${winningDirection}
   Winning Voters: ${allWinningVoters.length}
   Mature Voters: ${matureVoters.length}
   Maturity Ratio: ${(maturityRatio * 100).toFixed(1)}%
   Statistical Confidence: ✅ ${hasStatisticalConfidence ? 'SIM' : 'NÃO'}
═══════════════════════════════════════════════════
      `);
      setBayesianVotes(newBayesianVotes);
      setCouncilConfidence(totalWeight);

      // 8. Decisão Final do Conselho
      let consensusDirection: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
      let consensusProbability = 0.5;

      if (totalWeight > 0) {
        const totalSum = riseSum + fallSum;
        if (totalSum > 0) {
          consensusProbability = Math.max(riseSum, fallSum) / totalSum;
          if (riseSum > fallSum) consensusDirection = 'RISE';
          else if (fallSum > riseSum) consensusDirection = 'FALL';
        }
      }

      const dailyPnL = operationsLog.filter(op => op.initiator === 'Conselho' && new Date(op.timestamp).toDateString() === new Date().toDateString()).reduce((sum, op) => sum + (op.result || 0), 0);
      setPortfolioStats(prev => ({ ...prev, dailyPnL }));

      if (dailyPnL <= -dailyBalance) { toast({ title: "🛑 Stop Loss do Dia", variant: "destructive" }); return; }
      if (dailyPnL >= dailyTarget) { toast({ title: "🎯 Meta Batida!", description: "Parabéns!" }); return; }

      const consensusReached = Math.max(riseSum, fallSum) >= calculatedEffectiveThreshold;

      let kellyStake = calculateKellyStake(dailyBalance - portfolioStats.totalExposure, consensusProbability, 0.95);
      
      if (microFeatures) {
          if (microFeatures.isSpike) { toast({ title: "🛡️ Veto Total", description: "Pico anômalo detectado.", variant: "destructive" }); consensusDirection = 'HOLD'; }
          if ((consensusDirection === 'RISE' && microFeatures.pressure === 'sell') || (consensusDirection === 'FALL' && microFeatures.pressure === 'buy')) { kellyStake *= 0.5; }
          if (regimeResult.regime === 'breakout' && microFeatures.pressure === (consensusDirection === 'RISE' ? 'buy' : 'sell')) { kellyStake *= 1.2; }
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

      setDashboardData({
        regime: regimeResult.regime, bayesianProbability: consensusProbability,
        consensusDirection, activeRobotsCount,
        microstructure: { pressure: microFeatures?.volumeImbalance ?? 0.5, velocity: microFeatures?.tickVelocity ?? 0, isSpike: microFeatures?.isSpike ?? false },
        kellyStake
      });

      if (!consensusReached || !hasStatisticalConfidence || consensusDirection === 'HOLD') {
        setConsensusDecision({ direction: 'HOLD', probability: consensusProbability, stake: 0 });
        return;
      }
      
      setConsensusDecision({ direction: consensusDirection, probability: consensusProbability, stake: kellyStake });
      const activeStakes = activeCouncilContracts.reduce((sum, c) => sum + c.stake, 0);
      setPortfolioStats(prev => ({ ...prev, totalExposure: activeStakes }));

      if (councilExecutionRef.current.isExecuting || activeStakes + kellyStake > dailyBalance * 0.4 || consensusProbability < 0.65) return;
      
      const currentExecutionId = ++executionIdRef.current;
      councilExecutionRef.current.isExecuting = true;

      const decisionLog: TradeDecisionLog = {
          id: `TDL-${Date.now()}`, timestamp: new Date().toISOString(), asset: activeSymbol, timePeriod,
          tradeParams: { direction: consensusDirection, stake: kellyStake, duration: finalDuration, durationUnit: finalDurationUnit },
          context: { marketRegime: regimeResult.regime, regimeConfidence: regimeResult.confidence, microstructure: microFeatures, indicators: currentIndicators, entryPrice: currentTick.price },
          consensus: { bayesianProbability: consensusProbability, kellyStake, activeRobots: activeRobotsCount, votes: newBayesianVotes },
          result: 'pending', pnl: 0
      };
      setTradeDecisionLog(prev => [decisionLog, ...prev].slice(0, MAX_DECISION_LOG));

      toast({ title: "🚀 Ordem Enviada", description: `${consensusDirection} | Stake: $${kellyStake.toFixed(2)}` });

      executeTrade(consensusDirection === 'RISE' ? 'CALL' : 'PUT', kellyStake, activeSymbol, consensusDirection.toLowerCase() as 'rise' | 'fall', finalDuration, finalDurationUnit, 'Conselho')
        .finally(() => {
            const cooldown = 3000;
            setTimeout(() => {
                if (currentExecutionId === executionIdRef.current) {
                    councilExecutionRef.current.isExecuting = false;
                }
            }, cooldown);
        });

    } catch (error) {
      console.error("🚨 Erro Crítico no Loop do Conselho:", error);
      councilExecutionRef.current.isExecuting = false;
    }
  }, [
    dataVersion, isConnected, isCouncilAutopilotOn, strategyCouncil, robotPerformance,
    activeSymbol, operationsLog, currentRegime, user, toast, executeTrade, sellContract,
    timePeriod, dailyBalance, dailyTarget, evolveTrigger, portfolioStats,
    consensusSensitivity, confidenceFactor, durationRange, takeProfitThreshold,
    stopLossThreshold, priceTicks, tickCandles, isMeritocracyOn, isDynamicConsensusOn
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
```