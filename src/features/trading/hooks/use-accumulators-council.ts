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
  calmnessScoreThreshold: number;
  adaptiveDuration: number;
}

interface MultiScaleVolatility {
  immediate: number;   // Últimos 5 ticks
  short: number;       // Últimos 10 ticks
  medium: number;      // Últimos 20 ticks
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
    calmnessScore: number;
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
        calmnessScore: number;
    };
}

const VIRTUAL_TRADE_LOG_KEY = 'derivAccumulatorsVirtualLog_v4';
const MAX_VIRTUAL_LOG_SIZE = 101; 
const VOLATILITY_LOOKBACK = 50;
const BASE_CALMNESS_THRESHOLD = 70;
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

const calculatePercentile = (series: (number|null)[], value: number): number => {
    const validSeries = series.filter((v): v is number => v !== null && isFinite(v));
    if (validSeries.length === 0) return 50;
    const sorted = [...validSeries].sort((a,b) => a-b);
    const count = sorted.filter(v => v < value).length;
    return (count / sorted.length) * 100;
};

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

const calculateDelta = (series: (number | null)[], period: number): number => {
    const validSeries = series.filter((v): v is number => v !== null && isFinite(v));
    if (validSeries.length < period) return 0;
    const recentSlice = validSeries.slice(-period);
    return recentSlice[recentSlice.length - 1] - recentSlice[0];
};

const calculateTickConsistency = (ticks: TickData[]): number => {
  if (ticks.length < 2) return 50;
  const ranges = ticks.slice(1).map((tick, i) => Math.abs(tick.price - ticks[i].price));
  if (ranges.length === 0) return 50;
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  if (avgRange === 0) return 100;
  const rangeStdDev = Math.sqrt(ranges.map(r => Math.pow(r - avgRange, 2)).reduce((a, b) => a + b, 0) / ranges.length);
  return avgRange > 0 ? Math.max(0, 100 - (rangeStdDev / avgRange * 200)) : 50;
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
  const [metrics, setMetrics] = useState<{ bbw: number; atr: number; adx: number; avgBbw: number; avgAtr: number; }>({ bbw: 0, atr: 0, adx: 0, avgBbw: 0, avgAtr: 0 });
  const [calmnessScore, setCalmnessScore] = useState(0);
  const [dailyBalance, setDailyBalance] = useState(10.0);
  const [dailyTarget, setDailyTarget] = useState(5.0);
  const [riskManager, setRiskManager] = useState<RiskManagerStatus>({
    mode: 'Normal',
    lastLossReason: null,
    calmnessScoreThreshold: BASE_CALMNESS_THRESHOLD,
    adaptiveDuration: 40,
  });
  const [entryConditions, setEntryConditions] = useState({
    calmnessScore: false, bbwIsLow: false, atrIsLow: false, zScoreIsStable: false,
  });

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
    if (recentTrades.length === 0) return { wins: 0, losses: 0, winRate: 100 };
    const wins = recentTrades.filter(op => op.status === 'win').length;
    const losses = recentTrades.filter(op => op.status === 'loss').length;
    const total = wins + losses;
    const winRate = total > 0 ? (wins / total) * 100 : 100;
    return { wins, losses, winRate };
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
    localIndicators: Indicators, 
    localMetrics: { avgBbw: number; avgAtr: number; },
    currentCalmnessScore: number
  ) => {
    const sellReason = lastSellReasonRef.current;
    lastSellReasonRef.current = null;

    if (lastOp.status === 'lost') {
      let reason = "Perda por quebra de barreira.";

      const atrMultiplier = 1.6 * (1 + (localMetrics.avgBbw * 0.5)); // Mais tolerante em mercados mais amplos
      const bbwMultiplier = 1.8 * (1 - (localMetrics.avgBbw * 0.2)); // Menos tolerante se já está volátil

      if (sellReason) { reason = sellReason;
      } else if (localIndicators.adx! > ADX_EXIT_THRESHOLD) { reason = `Pico de Tendência (ADX: ${localIndicators.adx!.toFixed(1)})`;
      } else if (localIndicators.bbw! > localMetrics.avgBbw * bbwMultiplier) { reason = `Expansão de Volatilidade (BBW)`;
      } else if (localIndicators.atr! > localMetrics.avgAtr * atrMultiplier) { reason = `Aumento do Range (ATR)`; }

      const pattern: LossPattern = {
        timestamp: Date.now(),
        reason: reason,
        marketConditions: {
          bbw: localIndicators.bbw!, atr: localIndicators.atr!, adx: localIndicators.adx!,
          calmnessScore: currentCalmnessScore,
          timeToLoss: calculateTimeToLoss(lastOp)
        }
      };
      lossHistoryRef.current.push(pattern);
      const recentLosses = lossHistoryRef.current.slice(-5);
      const timeoutInCalmMarkets = recentLosses.filter(p => p.reason.includes('Kill Switch') && p.marketConditions.calmnessScore > 70).length;
      
      if (timeoutInCalmMarkets >= 3) {
        setRiskManager(prev => ({
          ...prev,
          mode: 'Hyper-Cautious',
          lastLossReason: 'Padrão: Falsa Calmaria Detectada',
          calmnessScoreThreshold: Math.min(85, prev.calmnessScoreThreshold + 5),
          adaptiveDuration: Math.max(20, prev.adaptiveDuration - 10),
        }));
        setTimeout(() => toast({ title: '🤖 Gerente: Modo Hyper-Cauteloso', description: `Mercado falso-calmo. Reduzindo tempo de exposição.`, variant: "destructive" }), 0);
      } else {
        setRiskManager(prev => {
          let newThreshold = prev.calmnessScoreThreshold;
          if (reason.includes('Kill Switch')) {
            newThreshold = Math.min(90, prev.calmnessScoreThreshold + 2);
            setTimeout(() => toast({ title: '🤖 Gerente: Aprendizado Temporal', description: `O sistema será mais seletivo na próxima entrada.`, variant: "default" }), 0);
          } else {
            newThreshold = Math.min(90, prev.calmnessScoreThreshold + 10);
            setTimeout(() => toast({ title: '🤖 Gerente: Modo Cauteloso', description: `Limiar de Calmaria aumentado para ${newThreshold}.`, variant: 'destructive' }), 0);
          }
          return { ...prev, mode: 'Cautious', lastLossReason: reason, calmnessScoreThreshold: newThreshold };
        });
      }

      setBotStatus('COOLDOWN');
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => { setBotStatus('MONITORING'); }, COOLDOWN_PERIOD_MS);

    } else if (lastOp.status === 'won') {
       if(riskManager.mode === 'Hyper-Cautious') {
           setRiskManager(prev => ({
             ...prev, 
             mode: 'Cautious',
             calmnessScoreThreshold: Math.max(BASE_CALMNESS_THRESHOLD, prev.calmnessScoreThreshold - 5),
           }));
           setTimeout(() => toast({ 
             title: '🤖 Gerente: Relaxando Cuidado', 
             description: 'Modo agora é Cauteloso. Mais uma vitória restaura parâmetros normais.' 
           }), 0);
       } else if(riskManager.mode === 'Cautious') {
           setRiskManager(prev => ({
             ...prev, 
             mode: 'Normal', 
             lastLossReason: null, 
             calmnessScoreThreshold: BASE_CALMNESS_THRESHOLD,
           }));
           setTimeout(() => toast({ 
             title: '🤖 Gerente: Modo Normal', 
             description: 'Confiança recuperada. Parâmetros restaurados.' 
           }), 0);
       }
    }
  }, [riskManager.mode, toast]);

  useEffect(() => {
    if (botStatus === 'COOLDOWN') {
      const maxCooldownTimer = setTimeout(() => {
        if (botStatus === 'COOLDOWN') {
          setBotStatus('MONITORING');
          console.warn('⚠️ Cooldown forçado a terminar após timeout');
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
                setTimeout(() => toast({ title: "🤖 Piloto: Limite de Perda Atingido", description: `Sistema pausado. Perda do dia: $${dailyPnL.toFixed(2)}`, variant: "destructive" }), 0);
            }
            return true;
        }
        if (dailyPnL >= dailyTarget) {
            if (isAutopilotOn) {
                setIsAutopilotOn(false);
                setTimeout(() => toast({ title: "🏆 Piloto: Meta de Lucro Atingida!", description: `Parabéns! Sistema pausado. Lucro do dia: $${dailyPnL.toFixed(2)}` }), 0);
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
      if (!calculatedIndicators || !calculatedIndicators.bbw || !calculatedIndicators.atr || !calculatedIndicators.adx || !calculatedIndicators.adxSeries) {
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

      const recentBbwValues = (calculatedIndicators.bbwSeries || []).slice(-VOLATILITY_LOOKBACK).filter(v => v !== null) as number[];
      const recentAtrValues = (calculatedIndicators.atrSeries || []).slice(-VOLATILITY_LOOKBACK).filter(v => v !== null) as number[];
      const avgBbw = recentBbwValues.length > 0 ? recentBbwValues.reduce((s, v) => s + v, 0) / recentBbwValues.length : 0;
      const avgAtr = recentAtrValues.length > 0 ? recentAtrValues.reduce((s, v) => s + v, 0) / recentAtrValues.length : 0;
      
      const localMetrics = { bbw: calculatedIndicators.bbw, atr: calculatedIndicators.atr, adx: calculatedIndicators.adx, avgBbw, avgAtr };
      setMetrics(localMetrics);
      
      const { adx, bbw, zScore, bbwSeries } = calculatedIndicators;
      const bbwDelta = calculateDelta(bbwSeries!, 5);
      const accelerationScore = bbwDelta < 0 ? 100 : Math.max(0, 100 - (Math.abs(bbwDelta) * 500));
      const tickConsistencyScore = calculateTickConsistency(priceTicks.slice(-20));

      let tickVolatilityScore = 50;
      if (priceTicks.length >= 20) {
          const recentTickPrices = priceTicks.slice(-20).map(t => t.price);
          const avgTickPrice = recentTickPrices.reduce((s, p) => s + p, 0) / 20;
          const tickStdDev = Math.sqrt(recentTickPrices.reduce((s, p) => s + Math.pow(p - avgTickPrice, 2), 0) / 20);
          const normalizedTickVolatility = avgTickPrice > 0 ? (tickStdDev / avgTickPrice) : 0;
          tickVolatilityScore = Math.max(0, 100 - (normalizedTickVolatility * 100000));
      }

      const adxScore = Math.max(0, 100 - ((Math.max(0, (adx || 35) - 15) / 20) * 100));
      const bbwScore = localMetrics.avgBbw > 0 ? Math.max(0, 100 - ((bbw! / (localMetrics.avgBbw * 1.5)) * 100)) : 50;
      
      const finalCalmnessScore = (adxScore * 0.20) + (bbwScore * 0.20) + (tickVolatilityScore * 0.40) + (accelerationScore * 0.10) + (tickConsistencyScore * 0.10);
      setCalmnessScore(finalCalmnessScore);
      
      const nowEpoch = priceTicks[priceTicks.length-1]?.epoch;
      if(nowEpoch) {
          const finishedTrades: VirtualOperation[] = [];
          const stillActiveTrades: VirtualOperation[] = [];

          activeVirtualTradesRef.current.forEach(trade => {
              if (nowEpoch >= trade.exitTime) {
                  trade.status = 'win';
                  trade.reason = 'Sobreviveu';
                  finishedTrades.push(trade);
              } else {
                  const barrierMultiplier = BARRIER_INDICES[trade.growthRate.toFixed(2)] || 2.0;
                  const barrier = trade.initialConditions.atr * barrierMultiplier;
                  
                  if (Math.abs(priceTicks[priceTicks.length-1].price - trade.entryPrice) > barrier) {
                      trade.status = 'loss';
                      trade.reason = 'Quebra de Barreira Virtual';
                      trade.exitTime = nowEpoch;
                      finishedTrades.push(trade);
                  } else {
                      stillActiveTrades.push(trade);
                  }
              }
          });
          
          if(finishedTrades.length > 0) {
              setAndPersistVirtualLog(prev => {
                const updatedLog = [...finishedTrades, ...prev];
                return updatedLog.slice(0, MAX_VIRTUAL_LOG_SIZE);
              });
              activeVirtualTradesRef.current = stillActiveTrades;
              setVirtualTradeCounter(c => c + finishedTrades.length);
          }
      }
      
      const lastOp = operationsLog.find(op => op.initiator === 'Piloto' && op.status !== 'pending' && op.id > lastOpIdRef.current);
      if (lastOp) {
         analyzeAndAdjustStrategy(lastOp, calculatedIndicators, localMetrics, finalCalmnessScore);
         lastOpIdRef.current = lastOp.id;
         executionRef.current = false;
         return;
      }

      const pilotOpenPosition = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');

      if (pilotOpenPosition) {
        let dynamicSpikeMultiplier = 2.5 * (1 + (localMetrics.avgBbw * 1.5)); // Calibração Dinâmica
        
        if (openPilotContractContextRef.current?.id !== pilotOpenPosition.id) {
            openPilotContractContextRef.current = { id: pilotOpenPosition.id, dynamicSpikeMultiplier };
        }

        setBotStatus('POSITION_OPEN');
        
        let microVolatilityVeto = false;
        const baselineVolatility = entryVolatilityRef.current;
        if (priceTicks.length > MICRO_VOLATILITY_WINDOW && baselineVolatility) {
            const currentVolatility = calculateMultiScaleVolatility(priceTicks);
            const context = openPilotContractContextRef.current;
            const multiplier = (context && context.id === pilotOpenPosition.id) ? context.dynamicSpikeMultiplier : 2.5;
            if (currentVolatility.immediate > baselineVolatility.immediate * 2.0 || 
                currentVolatility.short > baselineVolatility.short * multiplier ||
                currentVolatility.medium > baselineVolatility.medium * 3.0) {
                microVolatilityVeto = true;
            }
        }
        
        const atrMultiplier = 1.6 * (1 + (localMetrics.avgBbw * 0.5));
        const bbwMultiplier = 1.8 * (1 - (localMetrics.avgBbw * 0.2));

        const isVolatilityExpanding = calculatedIndicators.bbw > localMetrics.avgBbw * bbwMultiplier || calculatedIndicators.atr > localMetrics.avgAtr * atrMultiplier || calculatedIndicators.adx > ADX_EXIT_THRESHOLD;
        const hasReachedStopLoss = (pilotOpenPosition.result || 0) <= -pilotOpenPosition.stake * MAX_LOSS_PERCENT;
        
        const dynamicTakeProfit = calculateDynamicTakeProfit(timeMaster.regime, timeMaster.averageBreakTime);
        const hasReachedTakeProfit = (pilotOpenPosition.result || 0) >= pilotOpenPosition.stake * dynamicTakeProfit;
        
        const entryTime = new Date(pilotOpenPosition.timestamp).getTime();
        const elapsedTimeInSeconds = (Date.now() - entryTime) / 1000;
        const killSwitchTriggered = elapsedTimeInSeconds >= riskManager.adaptiveDuration;
        
        let shouldSell = false; let reason = '';
        if (hasReachedTakeProfit) { shouldSell = true; reason = `Alvo Dinâmico de ${(dynamicTakeProfit*100).toFixed(0)}% atingido.`; }
        else if (microVolatilityVeto) { shouldSell = true; reason = 'Disjuntor Ativado: Pico de volatilidade instantânea.'; }
        else if (killSwitchTriggered) { shouldSell = true; reason = `Kill Switch de Tempo (${riskManager.adaptiveDuration}s) ativado.`; }
        else if (isVolatilityExpanding) { shouldSell = true; reason = 'Veto de Volatilidade: Risco de mercado aumentou.'; }
        else if (hasReachedStopLoss) { shouldSell = true; reason = `Stop Loss de ${MAX_LOSS_PERCENT * 100}% atingido.`; }
        
        if (shouldSell) {
          setTimeout(() => toast({ title: "🤖 Piloto: A fechar posição", description: reason }), 0);
          lastSellReasonRef.current = reason;
          await sellContract(pilotOpenPosition.id);
          openPilotContractContextRef.current = null;
          entryVolatilityRef.current = null;
        }
      } else {
        if(openPilotContractContextRef.current !== null) { openPilotContractContextRef.current = null; entryVolatilityRef.current = null; }
        if(botStatus === 'COOLDOWN') { executionRef.current = false; return; }
        
        const calmnessScoreMet = finalCalmnessScore >= riskManager.calmnessScoreThreshold;
        const bbwIsLow = calculatedIndicators.bbw! < localMetrics.avgBbw;
        const atrIsLow = calculatedIndicators.atr! < localMetrics.avgAtr;
        const zScoreIsStable = Math.abs(calculatedIndicators.zScore || 0) < 1.0;

        setEntryConditions({ calmnessScore: calmnessScoreMet, bbwIsLow, atrIsLow, zScoreIsStable });
        
        const VIRTUAL_WIN_RATE_THRESHOLD = 75;
        const isArenaHealthy = virtualArenaStats.winRate >= VIRTUAL_WIN_RATE_THRESHOLD;
        
        if (!isArenaHealthy && riskManager.mode === 'Normal') {
            setRiskManager(prev => ({
              ...prev,
              mode: 'Cautious',
              lastLossReason: `Baixa performance da Arena (${virtualArenaStats.winRate.toFixed(0)}% WR)`,
              calmnessScoreThreshold: Math.min(85, prev.calmnessScoreThreshold + 5),
            }));
            setTimeout(() => toast({ title: '🤖 Gerente: Prevenção Ativada!', description: 'A Arena Virtual indica alto risco. Aumentando a cautela.', variant: "default" }), 0);
        } else if (isArenaHealthy && riskManager.mode === 'Cautious' && riskManager.lastLossReason?.includes('Arena')) {
            setRiskManager(prev => ({
              ...prev,
              mode: 'Normal',
              lastLossReason: null,
              calmnessScoreThreshold: BASE_CALMNESS_THRESHOLD,
            }));
        }

        const isCalm = calmnessScoreMet && bbwIsLow && atrIsLow && zScoreIsStable;

        if (isCalm) {
          const stake = Math.max(1.0, Math.min(dailyBalance * 0.1, 10));
          
          const newVirtualTrade: VirtualOperation = {
              id: `vt_${Date.now()}`,
              entryPrice: priceTicks[priceTicks.length - 1].price,
              entryTime: priceTicks[priceTicks.length - 1].epoch,
              exitTime: priceTicks[priceTicks.length - 1].epoch + effectiveDuration,
              status: 'pending',
              reason: 'Em jogo',
              growthRate: DEFAULT_GROWTH_RATE,
              initialConditions: {
                  atr: calculatedIndicators.atr!,
                  calmnessScore: finalCalmnessScore,
              },
          };
          activeVirtualTradesRef.current.push(newVirtualTrade);
          setVirtualTradeCounter(c => c + 1);
          
          setBotStatus('CALM_DETECTED');
          entryVolatilityRef.current = calculateMultiScaleVolatility(priceTicks);
          setTimeout(() => toast({ title: "🤖 Piloto: Posição Aberta!", description: `Calmaria detectada. Contrato aberto com taxa de ${DEFAULT_GROWTH_RATE * 100}%.` }), 0);
          const result = await executeTrade(stake, DEFAULT_GROWTH_RATE, activeSymbol, 'Piloto');
          if (result.success && result.contractId) {
              openPilotContractContextRef.current = { id: result.contractId, dynamicSpikeMultiplier: 2.5, };
          }
        } else { setBotStatus('MONITORING'); }
      }
      executionRef.current = false;
    };
    runCycle();
  }, [ isAutopilotOn, isConnected, activeSymbol, dataVersion, botCandleData, priceTicks, dailyPnL, dailyBalance, dailyTarget, executeTrade, sellContract, toast, analyzeAndAdjustStrategy, operationsLog, botStatus, riskManager.adaptiveDuration, virtualArenaStats, setAndPersistVirtualLog, timeMaster ]);

  return { isAutopilotOn, toggleAutopilot, botStatus, volatilityMetrics: metrics, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, dailyPnL, riskManager, calmnessScore, entryConditions, virtualOperationsLog, virtualTradeCounter, timeMaster };
}
