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
  survivalProbabilityThreshold: number; // Alterado de calmnessScoreThreshold
  adaptiveDuration: number;
}

interface MultiScaleVolatility {
  immediate: number;
  short: number;
  medium: number;
}

interface PilotContractContext {
  id: number;
  dynamicSpikeMultiplier: number;
}

interface LossPattern {
  timestamp: number;
  reason: string;
  marketConditions: {
    bbw: number;
    atr: number;
    adx: number;
    survivalProbability: number;
    timeToLoss: number;
  };
}

export interface VirtualOperation {
    id: string;
    entryPrice: number;
    entryTime: number;
    exitTime: number;
    status: 'pending' | 'win' | 'loss';
    reason: string;
    growthRate: number;
    initialConditions: {
        atr: number;
        survivalProbability: number; // Alterado de calmnessScore
    };
}

const VIRTUAL_TRADE_LOG_KEY = 'derivAccumulatorsVirtualLog_v4';
const MAX_VIRTUAL_LOG_SIZE = 101; 
const VOLATILITY_LOOKBACK = 50;
const BASE_SURVIVAL_PROBABILITY_THRESHOLD = 0.85; // 85% de probabilidade de sobrevivência
const MAX_LOSS_PERCENT = 0.50;

const ADX_EXIT_THRESHOLD = 25;
const COOLDOWN_PERIOD_MS = 30000;
const DEFAULT_GROWTH_RATE = 0.03;
const MICRO_VOLATILITY_WINDOW = 20;

const BARRIER_INDICES: { [key: string]: number } = {
  '0.01': 0.397,
  '0.02': 0.371,
  '0.03': 0.348,
  '0.04': 0.331,
  '0.05': 0.315,
};


// --- FUNÇÕES HELPER ---

const normalCDF = (x: number): number => {
    // Aproximação da Função de Erro (ERF) para calcular a CDF
    const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.sqrt(2)));
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429;
    const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x*x/2);
    return 0.5 * (1 + (x > 0 ? erf : -erf));
};

function calculateSurvivalProbability(
  barrierDistance: number,
  targetDuration: number,
  currentVolatility: number
): number {
  if(currentVolatility <= 0 || targetDuration <= 0) return 0;
  const standardizedBarrier = barrierDistance / (currentVolatility * Math.sqrt(targetDuration));
  // P(τ > t) = 2 * Φ(b / (σ√t)) - 1, corrigido para movimento Browniano
  const prob = 2 * normalCDF(standardizedBarrier) - 1;
  return Math.max(0, Math.min(1, prob));
}

function calculateOptimalStake(
  accountBalance: number,
  winRate: number,
  averageWin: number,
  averageLoss: number,
  kellyFraction: number = 0.25
): number {
  if (averageLoss === 0 || winRate === 0) return 1.0;
  const b = averageWin / Math.abs(averageLoss);
  const p = winRate / 100;
  const q = 1 - p;
  
  if (p * b - q <= 0) return 1.0;

  const kellyPercent = (p * b - q) / b;
  const stake = accountBalance * Math.max(0, kellyPercent) * kellyFraction;
  
  return Math.max(1.0, Math.min(stake, accountBalance * 0.10));
}

function optimizeGrowthRate(
  survivalProbability: number,
): number {
  const p = survivalProbability;
  const q = 1 - p;
  
  // O payoff (b) nos acumuladores depende da taxa de crescimento.
  // Assumimos uma relação linear simples: payoff ~ growth_rate * k
  // A fração de Kelly é f* = p - q/b. Queremos maximizar f.
  // Uma heurística é que taxas de crescimento mais altas são para probabilidades maiores.
  
  const targetKelly = (p - 0.5) * 2; // Mapeia p de [0.5, 1] para [0, 1]
  const optimalGrowthRate = 0.01 + (targetKelly * 0.04);
  
  return Math.max(0.01, Math.min(0.05, optimalGrowthRate));
}

const calculateMultiScaleVolatility = (ticks: TickData[]): MultiScaleVolatility => {
  const stdDev = (subTicks: TickData[]) => {
      if (subTicks.length < 2) return 0;
      const prices = subTicks.map(t => t.price);
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      return Math.sqrt(prices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / prices.length);
  }
  return {
    immediate: stdDev(ticks.slice(-5)),
    short: stdDev(ticks.slice(-10)),
    medium: stdDev(ticks.slice(-20)),
  };
};

const calculateTimeToLoss = (operation: Operation): number => {
    if (!operation.exitTimestamp) return 0;
    const entryTime = new Date(operation.timestamp).getTime();
    const exitTime = new Date(operation.exitTimestamp).getTime();
    return (exitTime - entryTime) / 1000;
};

function calculateDynamicTakeProfit(
  volatilityRegime: VolatilityRegime,
  averageBreakTime: number
): number {
  let baseTarget = 1.25; 

  if (averageBreakTime > 65) {
    baseTarget = 1.40;
  } else if (averageBreakTime < 35) {
    baseTarget = 1.10;
  }

  switch(volatilityRegime.regime) {
      case 'ultra-calm':
        baseTarget = Math.min(1.50, baseTarget + 0.15);
        break;
      case 'calm':
        baseTarget = Math.min(1.50, baseTarget + 0.05);
        break;
      case 'agitated':
         baseTarget = Math.max(1.05, baseTarget - 0.10);
        break;
      case 'volatile':
         baseTarget = Math.max(1.05, baseTarget - 0.20);
        break;
  }
  
  return baseTarget;
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
  });
  const [calculatedStake, setCalculatedStake] = useState(1.0);
  const [survivalProbability, setSurvivalProbability] = useState(0);

  const lastOpIdRef = useRef<number>(0);
  const executionRef = useRef(false);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const openPilotContractContextRef = useRef<PilotContractContext | null>(null);
  const lastSellReasonRef = useRef<string | null>(null);
  const entryVolatilityRef = useRef<MultiScaleVolatility | null>(null);
  const lossHistoryRef = useRef<LossPattern[]>([]);
  
  const [virtualOperationsLog, setVirtualOperationsLog] = useState<VirtualOperation[]>([]);
  const activeVirtualTradesRef = useRef<VirtualOperation[]>([]);
  const [virtualTradeCounter, setVirtualTradeCounter] = useState(0);
  const [dailyBalance, setDailyBalance] = useState(10.0);
  const [dailyTarget, setDailyTarget] = useState(5.0);
  
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

  const dailyPnL = useMemo(() => {
    const today = new Date().toDateString();
    return operationsLog
        .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today && op.initiator === 'Piloto')
        .reduce((sum, op) => sum + (op.result || 0), 0);
  }, [operationsLog]);
  
  const virtualArenaStats = useMemo(() => {
    const recentTrades = virtualOperationsLog.slice(0, 100);
    if (recentTrades.length === 0) return { wins: 0, losses: 0, winRate: 100, avgWin: 1, avgLoss: -1 };
    const wins = recentTrades.filter(op => op.status === 'win');
    const losses = recentTrades.filter(op => op.status === 'loss');
    const total = wins.length + losses.length;
    const winRate = total > 0 ? (wins.length / total) * 100 : 100;
    const avgWin = wins.length > 0 ? wins.reduce((s, o) => s + (o.growthRate * o.initialConditions.survivalProbability), 0) / wins.length : 1;
    const avgLoss = -1; // Para acumuladores, a perda é sempre o stake.
    return { wins: wins.length, losses: losses.length, winRate, avgWin, avgLoss };
  }, [virtualOperationsLog]);


  const toggleAutopilot = useCallback(() => {
    setIsAutopilotOn(prev => !prev);
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

      const pattern: LossPattern = {
        timestamp: Date.now(), reason,
        marketConditions: {
          bbw: indicators.bbw!, atr: indicators.atr!, adx: indicators.adx!,
          survivalProbability: currentSurvivalProb,
          timeToLoss: calculateTimeToLoss(lastOp)
        }
      };
      lossHistoryRef.current.push(pattern);

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
       if(riskManager.mode === 'Cautious') {
           setRiskManager(prev => ({
             ...prev, 
             mode: 'Normal', 
             lastLossReason: null, 
             survivalProbabilityThreshold: BASE_SURVIVAL_PROBABILITY_THRESHOLD,
           }));
       }
    }
  }, [riskManager.mode]);

  useEffect(() => {
    if (botStatus === 'COOLDOWN') {
      const maxCooldownTimer = setTimeout(() => {
        if (botStatus === 'COOLDOWN') {
          setBotStatus('MONITORING');
        }
      }, COOLDOWN_PERIOD_MS + 5000);
      return () => clearTimeout(maxCooldownTimer);
    }
  }, [botStatus]);

  useEffect(() => {
    if (!isAutopilotOn || !isConnected || !activeSymbol || botCandleData.length < VOLATILITY_LOOKBACK) {
        setBotStatus(isAutopilotOn ? 'MONITORING' : 'PAUSED');
        return;
    }

    if (executionRef.current) return;
    
    const runCycle = async () => {
      executionRef.current = true;
      
      const checkStopConditions = () => {
        if (dailyPnL <= -dailyBalance) {
            if (isAutopilotOn) {
                setIsAutopilotOn(false);
                setTimeout(() => toast({ title: "🤖 Piloto: Limite de Perda Atingido", variant: "destructive" }), 0);
            }
            return true;
        }
        if (dailyPnL >= dailyTarget) {
            if (isAutopilotOn) {
                setIsAutopilotOn(false);
                setTimeout(() => toast({ title: "🏆 Piloto: Meta de Lucro Atingida!" }), 0);
            }
            return true;
        }
        return false;
      }
      
      if (checkStopConditions()) {
          executionRef.current = false;
          return;
      }

      const calculatedIndicators = calculateAllIndicators(botCandleData, initialCouncilStrategies, '1m', {duration: 15, unit: 's'});
      if (!calculatedIndicators || !calculatedIndicators.atr || !calculatedIndicators.adx) {
          executionRef.current = false;
          return;
      }
      
      const effectiveDuration = Math.min(
        timeMaster.regime.expectedDuration,
        timeMaster.safeExitTime
      );

      if (riskManager.adaptiveDuration !== effectiveDuration) {
        setRiskManager(prev => ({
          ...prev, 
          adaptiveDuration: effectiveDuration
        }));
      }
      
      const barrierDistance = calculatedIndicators.atr * (BARRIER_INDICES[optimizeGrowthRate(survivalProbability).toFixed(2)] || 0.348);
      const instantaneousVolatility = timeMaster.regime.confidence > 0 ? timeMaster.regime.expectedDuration / 1000 : 0.000562;

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

      if (pilotOpenPosition) {
        setBotStatus('POSITION_OPEN');
        
        const microVolatilityVeto = false; // Placeholder para analyzeMicrostructure
        const isVolatilityExpanding = calculatedIndicators.adx > ADX_EXIT_THRESHOLD;
        const hasReachedStopLoss = (pilotOpenPosition.result || 0) <= -pilotOpenPosition.stake * MAX_LOSS_PERCENT;
        
        const dynamicTakeProfit = calculateDynamicTakeProfit(timeMaster.regime, timeMaster.averageBreakTime);
        const hasReachedTakeProfit = (pilotOpenPosition.result || 0) >= pilotOpenPosition.stake * dynamicTakeProfit;
        
        const entryTime = new Date(pilotOpenPosition.timestamp).getTime();
        const elapsedTimeInSeconds = (Date.now() - entryTime) / 1000;
        const killSwitchTriggered = elapsedTimeInSeconds >= riskManager.adaptiveDuration;
        
        let shouldSell = false; let reason = '';
        if (hasReachedTakeProfit) { shouldSell = true; reason = `Alvo Dinâmico atingido.`; }
        else if (microVolatilityVeto) { shouldSell = true; reason = 'Veto de Microestrutura.'; }
        else if (killSwitchTriggered) { shouldSell = true; reason = `Kill Switch de Tempo (${riskManager.adaptiveDuration}s).`; }
        else if (isVolatilityExpanding) { shouldSell = true; reason = 'Veto de Volatilidade Macro.'; }
        else if (hasReachedStopLoss) { shouldSell = true; reason = `Stop Loss de ${MAX_LOSS_PERCENT * 100}%.`; }
        
        if (shouldSell) {
          setTimeout(() => toast({ title: "🤖 Piloto: A fechar posição", description: reason }), 0);
          lastSellReasonRef.current = reason;
          await sellContract(pilotOpenPosition.id);
        }
      } else {
        if(botStatus === 'COOLDOWN') { executionRef.current = false; return; }

        const survivalProbMet = currentSurvivalProb >= riskManager.survivalProbabilityThreshold;
        
        setEntryConditions({ survivalProb: survivalProbMet, microstructure: true });
        
        if (survivalProbMet) {
          const stake = calculateOptimalStake(
            dailyBalance,
            virtualArenaStats.winRate,
            virtualArenaStats.avgWin,
            virtualArenaStats.avgLoss
          );
          setCalculatedStake(stake);

          const growthRate = optimizeGrowthRate(currentSurvivalProb);

          setBotStatus('CALM_DETECTED');
          entryVolatilityRef.current = calculateMultiScaleVolatility(priceTicks);
          
          const result = await executeTrade(stake, growthRate, activeSymbol, 'Piloto');
          if (result.success && result.contractId) {
              setTimeout(() => toast({ title: "🤖 Piloto: Posição Aberta!", description: `Prob. de Sobrevivência: ${(currentSurvivalProb*100).toFixed(1)}%` }), 0);
          }
        } else { setBotStatus('MONITORING'); }
      }
      executionRef.current = false;
    };
    runCycle();
  }, [ isAutopilotOn, isConnected, activeSymbol, dataVersion, botCandleData, priceTicks, dailyPnL, dailyBalance, dailyTarget, executeTrade, sellContract, toast, analyzeAndAdjustStrategy, operationsLog, botStatus, riskManager.adaptiveDuration, virtualArenaStats, setAndPersistVirtualLog, timeMaster, survivalProbability ]);

  return { isAutopilotOn, toggleAutopilot, botStatus, volatilityMetrics: {bbw:0, atr:0, adx:0, avgAtr:0, avgBbw:0}, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, dailyPnL, riskManager, calmnessScore: survivalProbability * 100, entryConditions, virtualOperationsLog, virtualTradeCounter, timeMaster, calculatedStake };
}
