// src/features/trading/hooks/use-accumulators-council.ts
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiAccumulators } from './use-deriv-api-accumulators';
import { useToast } from '@/hooks/use-toast';
import type { CandleData, Operation, TickData } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';
import { useTimeMaster, type VolatilityRegime } from './use-time-master';

// --- TIPOS E CONFIGURAÇÕES DA ESTRATÉGIA ---

type BotStatus = 'PAUSED' | 'MONITORING' | 'ANALYZING_LOSS' | 'COOLDOWN' | 'CALM_DETECTED' | 'POSITION_OPEN';

interface RiskManagerStatus {
  mode: 'Normal' | 'Cautious' | 'Hyper-Cautious';
  lastLossReason: string | null;
  survivalProbabilityThreshold: number; 
  adaptiveDuration: number;
}

interface MicrostructureSignal {
  isSafe: boolean;
  tickVelocityAnomaly: boolean;
  priceJumpDetected: boolean;
  safetyScore: number;
}

interface TradeMetrics {
  timestamp: number;
  survivalProbability: number;
  actualDuration: number;
  predictedDuration: number;
  result: 'won' | 'lost';
  exitReason: string;
}

export interface VirtualOperation {
    id: string;
    entryPrice: number;
    entryTime: number;
    exitTime: number;
    status: 'pending' | 'win' | 'loss';
    reason: string;
    growthRate: number;
    entryStake: number;
    pnl: number;
    initialConditions: {
        atr: number;
        survivalProbability: number;
    };
}

const VIRTUAL_TRADE_LOG_KEY = 'derivAccumulatorsVirtualLog_v4';
const MAX_VIRTUAL_LOG_SIZE = 101; 
const VOLATILITY_LOOKBACK = 50;
const BASE_SURVIVAL_PROBABILITY_THRESHOLD = 0.85;
const MAX_LOSS_PERCENT = 0.50;

const ADX_EXIT_THRESHOLD = 25;
const COOLDOWN_PERIOD_MS = 30000;

const BARRIER_INDICES: { [key: string]: number } = {
  '0.01': 0.397,
  '0.02': 0.371,
  '0.03': 0.348,
  '0.04': 0.331,
  '0.05': 0.315,
};

// --- FUNÇÕES HELPER ---

const normalCDF = (x: number): number => {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    if (x > 0) prob = 1 - prob;
    return prob;
};

function calculateSurvivalProbability(
  barrierDistance: number,
  targetDuration: number,
  currentVolatility: number
): number {
  const MIN_VOLATILITY = 1e-9;
  // Piso de incerteza para evitar probabilidade de 100%
  const VOLATILITY_FLOOR = 0.00005; 
  const effectiveVolatility = Math.max(currentVolatility, MIN_VOLATILITY, VOLATILITY_FLOOR);
  
  if (targetDuration <= 0) return 0;
  
  const normalized = barrierDistance / (effectiveVolatility * Math.sqrt(2 * targetDuration));
  
  const survivalProb = 2 * normalCDF(normalized * Math.sqrt(2)) - 1;
  
  // Impõe um teto de 99.9% para evitar a falácia do "risco zero"
  return Math.max(0, Math.min(0.999, survivalProb));
}


function calculateOptimalStake(
  accountBalance: number,
  winRate: number,
  averageWin: number,
  averageLoss: number,
  kellyFraction: number = 0.25
): number {
  if (averageLoss === 0 || winRate === 0 || winRate === 100) return 1.0;
  if (accountBalance < 1.0) return 1.0;
  
  const b = Math.abs(averageWin / averageLoss);
  const p = Math.max(0.01, Math.min(0.99, winRate / 100));
  const q = 1 - p;
  
  const kellyEdge = p * b - q;
  
  if (kellyEdge <= 0) return 1.0;

  const fullKelly = kellyEdge / b;
  const fractionalKelly = fullKelly * kellyFraction;
  const stake = accountBalance * fractionalKelly;
  
  return Math.max(1.0, Math.min(stake, accountBalance * 0.10));
}

function optimizeGrowthRate(
  survivalProbability: number,
  virtualArenaWinRate: number
): number {
  const baseRate = 0.01 + (Math.max(0, survivalProbability - 0.75) / 0.25) * 0.04;
  
  let adjustment = 1.0;
  if (virtualArenaWinRate < 0.75) {
    adjustment = 0.8; 
  } else if (virtualArenaWinRate > 0.85) {
    adjustment = 1.1;
  }
  
  const optimized = baseRate * adjustment;
  return Math.max(0.01, Math.min(0.05, optimized));
}

function analyzeMicrostructure(ticks: TickData[]): MicrostructureSignal & { reason: string } {
  if (ticks.length < 20) return { isSafe: true, tickVelocityAnomaly: false, priceJumpDetected: false, safetyScore: 50, reason: "Dados insuficientes" };
  
  const recentTicks = ticks.slice(-20);
  const prices = recentTicks.map(t => t.price);
  
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.abs(Math.log(prices[i] / prices[i-1])));
  }
  const meanReturn = returns.reduce((a,b) => a+b, 0) / returns.length;
  const stdReturn = Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / returns.length);
  
  const priceJumpDetected = returns.some(r => r > meanReturn + 3 * stdReturn);
  
  const epochs = recentTicks.map(t => t.epoch);
  const intervals = [];
  for (let i = 1; i < epochs.length; i++) {
    intervals.push(epochs[i] - epochs[i-1]);
  }
  const meanInterval = intervals.reduce((a,b) => a+b, 0) / intervals.length;
  const stdInterval = Math.sqrt(intervals.reduce((s, i) => s + Math.pow(i - meanInterval, 2), 0) / intervals.length);
  const tickVelocityAnomaly = stdInterval > meanInterval * 0.5;
  
  let safetyScore = 100;
  let reasons: string[] = [];
  if (priceJumpDetected) {
    safetyScore -= 40;
    reasons.push("Pico de Preço");
  }
  if (tickVelocityAnomaly) {
    safetyScore -= 30;
    reasons.push("Velocidade Anômala");
  }
  
  return {
    isSafe: safetyScore > 50,
    tickVelocityAnomaly,
    priceJumpDetected,
    safetyScore,
    reason: reasons.length > 0 ? reasons.join(', ') : "Seguro"
  };
}

const calculateTimeToLoss = (operation: Operation): number => {
    if (!operation.exitTimestamp) return 0;
    const entryTime = new Date(operation.timestamp).getTime();
    const exitTime = new Date(operation.exitTimestamp).getTime();
    return (exitTime - entryTime) / 1000;
};

const checkMicroVolatilityCircuitBreaker = (
  ticks: TickData[],
  baselineVolatility: number | null
): { trigger: boolean; reason: string } => {
  if (ticks.length < 15 || baselineVolatility === null) {
    return { trigger: false, reason: "" };
  }

  const recentTicks = ticks.slice(-10);
  const prices = recentTicks.map(t => t.price);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const stdDev = Math.sqrt(
    prices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / prices.length
  );
  
  const THRESHOLD_MULTIPLIER = 3.5;
  const ABSOLUTE_MIN_TRIGGER = 0.00008;

  const triggerThreshold = Math.max(baselineVolatility * THRESHOLD_MULTIPLIER, ABSOLUTE_MIN_TRIGGER);

  if (stdDev > triggerThreshold) {
    return {
      trigger: true,
      reason: `Disjuntor: Ruído de curto prazo detectado.`
    };
  }
  
  return { trigger: false, reason: "" };
};

function calculateDynamicTakeProfit(
  stake: number,
  volatilityRegime: VolatilityRegime,
  survivalProbability: number,
  historicalProfitRatios: number[]
): number {
  let baseProfitRatio = 0.30; 

  if (volatilityRegime.regime === 'ultra-calm' && survivalProbability > 0.9) {
    baseProfitRatio = 0.50;
  } else if (volatilityRegime.regime === 'calm') {
    baseProfitRatio = 0.40;
  }
  
  if (historicalProfitRatios.length > 10) {
    const sortedRatios = [...historicalProfitRatios].sort((a, b) => a - b);
    const medianProfit = sortedRatios[Math.floor(sortedRatios.length / 2)];
    baseProfitRatio = (baseProfitRatio + Math.min(medianProfit, 0.6)) / 2;
  }

  return stake * Math.max(0.25, baseProfitRatio);
}

// ============================================================================
// HOOK PRINCIPAL
// ============================================================================
export function useAccumulatorsCouncil() {
  const { 
    activeSymbol, botCandleData, priceTicks, executeTrade, 
    sellContract, operationsLog, isConnected, dataVersion
  } = useDerivApiAccumulators();
  const { toast } = useToast();
  
  const timeMaster = useTimeMaster(botCandleData, priceTicks);
  const metricsLogRef = useRef<TradeMetrics[]>([]);

  const [isAutopilotOn, setIsAutopilotOn] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus>('PAUSED');
  const [riskManager, setRiskManager] = useState<RiskManagerStatus>({
    mode: 'Normal',
    lastLossReason: null,
    survivalProbabilityThreshold: BASE_SURVIVAL_PROBABILITY_THRESHOLD,
    adaptiveDuration: 40,
  });
  const [entryConditions, setEntryConditions] = useState({
    survivalProb: false,
    microstructure: false,
    microstructureReason: ""
  });
  const [calculatedStake, setCalculatedStake] = useState(1.0);
  const [optimizedGrowthRate, setOptimizedGrowthRate] = useState(0.03);
  const [survivalProbability, setSurvivalProbability] = useState(0);

  const lastOpIdRef = useRef<number>(0);
  const executionRef = useRef(false);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSellReasonRef = useRef<string | null>(null);
  
  const [virtualOperationsLog, setVirtualOperationsLog] = useState<VirtualOperation[]>([]);
  const activeVirtualTradesRef = useRef<VirtualOperation[]>([]);
  const [dailyBalance, setDailyBalance] = useState(10.0);
  const [dailyTarget, setDailyTarget] = useState(5.0);
  const historicalProfitRatios = useRef<number[]>([]);
  const baselineVolatilityRef = useRef<number | null>(null);
  
  useEffect(() => {
      try {
          const storedLog = localStorage.getItem(VIRTUAL_TRADE_LOG_KEY);
          if (storedLog) {
              const parsed = JSON.parse(storedLog);
              if (Array.isArray(parsed)) setVirtualOperationsLog(parsed);
          }
      } catch (e) { console.error("Falha ao carregar log virtual", e) }
  }, []);
  
  const setAndPersistVirtualLog = useCallback((updater: React.SetStateAction<VirtualOperation[]>) => {
      setVirtualOperationsLog(prev => {
          const newState = typeof updater === 'function' ? updater(prev) : updater;
          localStorage.setItem(VIRTUAL_TRADE_LOG_KEY, JSON.stringify(newState));
          return newState;
      });
  }, []);

  const clearVirtualLog = useCallback(() => {
    setAndPersistVirtualLog([]);
    toast({
        title: "Arena Virtual Limpa",
        description: "O histórico de simulações foi apagado.",
    });
  }, [setAndPersistVirtualLog, toast]);

  const dailyPnL = useMemo(() => {
    const today = new Date().toDateString();
    return operationsLog
        .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today && op.initiator === 'Piloto')
        .reduce((sum, op) => sum + (op.result || 0), 0);
  }, [operationsLog]);
  
  const virtualArenaStats = useMemo(() => {
    const recentTrades = virtualOperationsLog.slice(0, 100).filter(op => op.status !== 'pending');
    if (recentTrades.length === 0) return { wins: 0, losses: 0, winRate: 100, avgWin: 0.25, avgLoss: -1 };
    
    const wins = recentTrades.filter(op => op.status === 'win');
    const losses = recentTrades.filter(op => op.status === 'loss');
    const total = wins.length + losses.length;
    const winRate = total > 0 ? (wins.length / total) * 100 : 100;
    
    const avgWin = wins.length > 0 ? wins.reduce((s, o) => s + o.pnl, 0) / wins.length : 0.25;
    const avgLoss = losses.length > 0 ? losses.reduce((s, o) => s + o.pnl, 0) / losses.length : -1;
    
    return { wins: wins.length, losses: losses.length, winRate, avgWin, avgLoss: avgLoss === 0 ? -1 : avgLoss };
  }, [virtualOperationsLog]);


  const toggleAutopilot = useCallback((checked: boolean) => {
    setIsAutopilotOn(checked);
    if (!checked) {
      setBotStatus('PAUSED');
    }
  }, []);

  useEffect(() => {
    if (botStatus === 'PAUSED' && !isAutopilotOn) return;
    setTimeout(() => {
        toast({ title: `Piloto Automático (Acumuladores) ${isAutopilotOn ? 'Ativado' : 'Desativado'}` });
    }, 0);
  }, [isAutopilotOn, toast, botStatus]); 

  const analyzeAndAdjustStrategy = useCallback((
    lastOp: Operation, 
    indicators: Indicators, 
    currentSurvivalProb: number
  ) => {
    const sellReason = lastSellReasonRef.current;
    lastSellReasonRef.current = null;

    if (lastOp.status === 'lost') {
      let reason = "Perda por quebra de barreira.";
      if (sellReason) reason = sellReason;

      metricsLogRef.current.push({
        timestamp: Date.now(),
        survivalProbability: currentSurvivalProb,
        actualDuration: calculateTimeToLoss(lastOp),
        predictedDuration: riskManager.adaptiveDuration,
        result: 'lost',
        exitReason: reason
      });

      setRiskManager(prev => ({
        ...prev, 
        mode: 'Cautious', 
        lastLossReason: reason, 
        survivalProbabilityThreshold: Math.min(0.95, prev.survivalProbabilityThreshold + 0.05)
      }));
      
      setBotStatus('COOLDOWN');
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => { setBotStatus('MONITORING'); }, COOLDOWN_PERIOD_MS);

    } else if (lastOp.status === 'won') {
       metricsLogRef.current.push({
          timestamp: Date.now(),
          survivalProbability: currentSurvivalProb,
          actualDuration: calculateTimeToLoss(lastOp),
          predictedDuration: riskManager.adaptiveDuration,
          result: 'won',
          exitReason: sellReason || 'take_profit'
      });
       if(riskManager.mode === 'Cautious') {
           setRiskManager(prev => ({
             ...prev, 
             mode: 'Normal', 
             lastLossReason: null, 
             survivalProbabilityThreshold: BASE_SURVIVAL_PROBABILITY_THRESHOLD,
           }));
       }
    }
  }, [riskManager]);

  useEffect(() => {
    if (!isAutopilotOn || !isConnected || !activeSymbol || botCandleData.length < VOLATILITY_LOOKBACK) {
        setBotStatus(isAutopilotOn ? 'MONITORING' : 'PAUSED');
        return;
    }

    if (executionRef.current) return;
    
    const runCycle = async () => {
      executionRef.current = true;
      
      const currentTick = priceTicks[priceTicks.length - 1];
      if (!currentTick) {
        executionRef.current = false;
        return;
      }

      if (priceTicks.length > 100) {
        const historicalTicks = priceTicks.slice(-100);
        const prices = historicalTicks.map(t => t.price);
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        baselineVolatilityRef.current = Math.sqrt(prices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / prices.length);
      }
      
      if (dailyPnL <= -dailyBalance || dailyPnL >= dailyTarget) {
          if (isAutopilotOn) {
              setIsAutopilotOn(false);
              toast({ title: dailyPnL <= -dailyBalance ? "🤖 Piloto: Limite de Perda Atingido" : "🏆 Piloto: Meta de Lucro Atingida!", variant: "destructive" });
          }
          executionRef.current = false;
          return;
      }

      const calculatedIndicators = calculateAllIndicators(botCandleData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
      if (!calculatedIndicators || !calculatedIndicators.atr || !calculatedIndicators.adx) {
          executionRef.current = false;
          return;
      }
      
      const effectiveDuration = Math.min(timeMaster.regime.expectedDuration, timeMaster.safeExitTime);
      if (riskManager.adaptiveDuration !== effectiveDuration) {
        setRiskManager(prev => ({ ...prev, adaptiveDuration: effectiveDuration }));
      }
      
      const growthRateForCalc = optimizeGrowthRate(survivalProbability, virtualArenaStats.winRate / 100);
      const barrierMultiplierForCalc = BARRIER_INDICES[growthRateForCalc.toFixed(2)] || 0.348;
      const barrierDistance = calculatedIndicators.atr * barrierMultiplierForCalc;

      const instantaneousVolatility = timeMaster.instantaneousVolatility || 0.000562;
      
      const currentSurvivalProb = calculateSurvivalProbability(barrierDistance, effectiveDuration, instantaneousVolatility);
      setSurvivalProbability(currentSurvivalProb);

      const lastOp = operationsLog.find(op => op.initiator === 'Piloto' && op.status !== 'pending' && op.id > lastOpIdRef.current);
      if (lastOp) {
         analyzeAndAdjustStrategy(lastOp, calculatedIndicators, currentSurvivalProb);
         lastOpIdRef.current = lastOp.id;
         executionRef.current = false;
         return;
      }

      const pilotOpenPosition = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');
      const anyOpenPosition = operationsLog.find(op => op.status === 'pending');

      if (pilotOpenPosition) {
        setBotStatus('POSITION_OPEN');
        
        const microstructureSignal = analyzeMicrostructure(priceTicks);
        const circuitBreaker = checkMicroVolatilityCircuitBreaker(priceTicks, baselineVolatilityRef.current);
        const isVolatilityExpanding = calculatedIndicators.adx > ADX_EXIT_THRESHOLD;
        const hasReachedStopLoss = (pilotOpenPosition.result || 0) <= -pilotOpenPosition.stake * MAX_LOSS_PERCENT;
        const dynamicTakeProfit = calculateDynamicTakeProfit(pilotOpenPosition.stake, timeMaster.regime, currentSurvivalProb, historicalProfitRatios.current);
        const hasReachedTakeProfit = (pilotOpenPosition.result || 0) >= dynamicTakeProfit;
        const elapsedTimeInSeconds = (Date.now() - new Date(pilotOpenPosition.timestamp).getTime()) / 1000;
        const killSwitchTriggered = elapsedTimeInSeconds >= riskManager.adaptiveDuration;
        
        let shouldSell = false; let reason = '';
        if (hasReachedTakeProfit) { shouldSell = true; reason = `Alvo Dinâmico atingido.`; }
        else if (circuitBreaker.trigger) { shouldSell = true; reason = circuitBreaker.reason; }
        else if (!microstructureSignal.isSafe) { shouldSell = true; reason = 'Veto de Microestrutura.'; }
        else if (killSwitchTriggered) { shouldSell = true; reason = `Kill Switch de Tempo (${riskManager.adaptiveDuration}s).`; }
        else if (isVolatilityExpanding) { shouldSell = true; reason = 'Veto de Volatilidade Macro.'; }
        else if (hasReachedStopLoss) { shouldSell = true; reason = `Stop Loss de ${MAX_LOSS_PERCENT * 100}%.`; }
        
        if (shouldSell) {
          setTimeout(() => toast({ title: "🤖 Piloto: A fechar posição", description: reason }), 0);
          lastSellReasonRef.current = reason;
          await sellContract(pilotOpenPosition.id);
        }
      } else {
        if (anyOpenPosition) {
            setBotStatus('MONITORING');
            executionRef.current = false;
            return;
        }

        if(botStatus === 'COOLDOWN') { executionRef.current = false; return; }

        const survivalProbMet = currentSurvivalProb >= riskManager.survivalProbabilityThreshold;
        const microstructureSignal = analyzeMicrostructure(priceTicks);
        setEntryConditions({ survivalProb: survivalProbMet, microstructure: microstructureSignal.isSafe, microstructureReason: microstructureSignal.reason });
        
        const canEnter = survivalProbMet && microstructureSignal.isSafe;

        if (canEnter && activeVirtualTradesRef.current.length === 0) {
          const stake = calculateOptimalStake(dailyBalance, virtualArenaStats.winRate, virtualArenaStats.avgWin, virtualArenaStats.avgLoss);
          setCalculatedStake(stake);

          const growthRate = optimizeGrowthRate(currentSurvivalProb, virtualArenaStats.winRate / 100);
          setOptimizedGrowthRate(growthRate);

          const newVirtualTrade: VirtualOperation = { 
              id: `vt_${Date.now()}`, 
              entryPrice: priceTicks[priceTicks.length - 1].price, 
              entryTime: currentTick.epoch, 
              exitTime: currentTick.epoch + effectiveDuration, 
              status: 'pending', 
              reason: 'Em jogo', 
              growthRate: growthRate, 
              entryStake: stake,
              pnl: 0,
              initialConditions: { atr: calculatedIndicators.atr!, survivalProbability: currentSurvivalProb }, 
          };
          activeVirtualTradesRef.current.push(newVirtualTrade);

          setBotStatus('CALM_DETECTED');
          const result = await executeTrade(stake, growthRate, activeSymbol, 'Piloto');
          if (result.success) {
              setTimeout(() => toast({ title: "🤖 Piloto: Posição Aberta!", description: `Prob. de Sobrevivência: ${(currentSurvivalProb*100).toFixed(1)}%` }), 0);
          }
        } else { setBotStatus('MONITORING'); }
      }
      
      const nowEpoch = currentTick.epoch;
      
      const finishedTrades: VirtualOperation[] = [];
      const stillActiveTrades: VirtualOperation[] = [];

      activeVirtualTradesRef.current.forEach(trade => {
        if (nowEpoch >= trade.exitTime) { 
            trade.status = 'win'; 
            trade.reason = 'Sobreviveu'; 
            trade.pnl = trade.entryStake * 0.25;
            finishedTrades.push(trade); 
        } 
        else {
          const barrierMultiplier = BARRIER_INDICES[trade.growthRate.toFixed(2)] || 0.348;
          const barrier = trade.initialConditions.atr * barrierMultiplier;
          if (Math.abs(priceTicks[priceTicks.length-1].price - trade.entryPrice) > barrier) { 
              trade.status = 'loss'; 
              trade.reason = 'Quebra de Barreira Virtual'; 
              trade.exitTime = nowEpoch; 
              trade.pnl = -trade.entryStake;
              finishedTrades.push(trade); 
          } 
          else { 
              stillActiveTrades.push(trade); 
          }
        }
      });

      if (finishedTrades.length > 0) {
        setAndPersistVirtualLog(prev => [...finishedTrades, ...prev].slice(0, MAX_VIRTUAL_LOG_SIZE));
        activeVirtualTradesRef.current = stillActiveTrades;
      }
      
      executionRef.current = false;
    };
    runCycle();
  }, [ isAutopilotOn, isConnected, activeSymbol, dataVersion, botCandleData, priceTicks, dailyPnL, dailyBalance, dailyTarget, executeTrade, sellContract, toast, analyzeAndAdjustStrategy, operationsLog, botStatus, riskManager, virtualArenaStats, setAndPersistVirtualLog, timeMaster, survivalProbability, optimizedGrowthRate, clearVirtualLog ]);

  return { isAutopilotOn, toggleAutopilot, botStatus, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, dailyPnL, riskManager, entryConditions, virtualOperationsLog, virtualArenaStats, timeMaster, calculatedStake, optimizedGrowthRate, survivalProbability, clearVirtualLog };
}
