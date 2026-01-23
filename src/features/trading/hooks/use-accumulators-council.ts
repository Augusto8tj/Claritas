// src/features/trading/hooks/use-accumulators-council.ts
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiAccumulators } from './use-deriv-api-accumulators';
import { useToast } from '@/hooks/use-toast';
import type { CandleData, Operation, TickData } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';

// --- TIPOS E CONFIGURAÇÕES DA ESTRATÉGIA ---

type BotStatus = 'PAUSED' | 'MONITORING' | 'ANALYZING_LOSS' | 'COOLDOWN' | 'CALM_DETECTED' | 'POSITION_OPEN';

interface RiskManagerStatus {
  mode: 'Normal' | 'Cautious';
  lastLossReason: string | null;
  calmnessScoreThreshold: number;
  adaptiveDuration: number;
}

const VOLATILITY_LOOKBACK = 50;
const BASE_CALMNESS_THRESHOLD = 70;
const MAX_LOSS_PERCENT = 0.50; 
const TAKE_PROFIT_PERCENT = 1.25; 
const KILL_SWITCH_SECONDS = 45; 

const VOLATILITY_EXIT_MULTIPLIER_BBW = 1.8;
const ADX_EXIT_THRESHOLD = 25;
const ATR_EXIT_MULTIPLIER = 1.6;
const COOLDOWN_PERIOD_MS = 30000;
const DEFAULT_GROWTH_RATE = 0.03;
const MICRO_VOLATILITY_SPIKE_MULTIPLIER = 2.5; // NOVO: Fator de pico de volatilidade
const MICRO_VOLATILITY_WINDOW = 10;          // NOVO: Janela para análise de ticks


export function useAccumulatorsCouncil() {
  const { 
    activeSymbol, 
    botCandleData,
    priceTicks,
    executeTrade, 
    sellContract, 
    operationsLog, 
    isConnected,
    dataVersion
  } = useDerivApiAccumulators();
  const { toast } = useToast();

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
    adaptiveDuration: KILL_SWITCH_SECONDS,
  });
  
  const [entryConditions, setEntryConditions] = useState({
    calmnessScore: false,
    bbwIsLow: false,
    atrIsLow: false,
    zScoreIsStable: false,
  });

  const lastOpIdRef = useRef<number>(0);
  const executionRef = useRef(false);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const openPilotContractIdRef = useRef<number | null>(null);
  const lastSellReasonRef = useRef<string | null>(null);
  const entryTickVolatilityRef = useRef<number | null>(null); // NOVO: Armazena volatilidade no momento da entrada

  const dailyPnL = useMemo(() => {
    const today = new Date().toDateString();
    return operationsLog
        .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today && op.initiator === 'Piloto')
        .reduce((sum, op) => sum + (op.result || 0), 0);
  }, [operationsLog]);

  const toggleAutopilot = useCallback(() => {
    setIsAutopilotOn(prev => !prev);
  }, []);

  useEffect(() => {
    if (botStatus === 'PAUSED' && !isAutopilotOn) return;

    setTimeout(() => {
        toast({
          title: `Piloto Automático (Acumuladores) ${isAutopilotOn ? 'Ativado' : 'Desativado'}`,
        });
    }, 0);
  }, [isAutopilotOn, toast, botStatus]); 

  const analyzeAndAdjustStrategy = useCallback((lastOp: Operation, localIndicators: Indicators, localMetrics: { avgBbw: number; avgAtr: number; }) => {
    const sellReason = lastSellReasonRef.current;
    lastSellReasonRef.current = null;

    if (lastOp.status === 'lost') {
      let reason = "Perda por quebra de barreira.";

      if (sellReason) {
        reason = sellReason;
      } else if (localIndicators.adx! > ADX_EXIT_THRESHOLD) {
        reason = `Pico de Tendência (ADX: ${localIndicators.adx!.toFixed(1)})`;
      } else if (localIndicators.bbw! > localMetrics.avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW) {
        reason = `Expansão de Volatilidade (BBW)`;
      } else if (localIndicators.atr! > localMetrics.avgAtr * ATR_EXIT_MULTIPLIER) {
        reason = `Aumento do Range (ATR)`;
      }

      setRiskManager(prev => {
        let newThreshold = prev.calmnessScoreThreshold;
        let newDuration = prev.adaptiveDuration;

        if (reason.includes('Kill Switch')) {
            newDuration = Math.max(15, Math.floor(prev.adaptiveDuration / 2));
            setTimeout(() => toast({ title: '🤖 Gerente de Estratégia: Adaptando Tempo', description: `O mercado está instável. Próxima operação terá um tempo limite de ${newDuration}s.`, variant: "default" }), 0);
        } else {
            newThreshold = Math.min(90, prev.calmnessScoreThreshold + 15);
            setTimeout(() => toast({ title: '🤖 Gerente de Estratégia: Modo Cauteloso', description: `Limiar de Calmaria aumentado para ${newThreshold}. O sistema será mais seletivo.`, variant: 'destructive' }), 0);
        }
        
        return { mode: 'Cautious', lastLossReason: reason, calmnessScoreThreshold: newThreshold, adaptiveDuration: newDuration };
      });

      setBotStatus('COOLDOWN');
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => {
        setBotStatus('MONITORING');
      }, COOLDOWN_PERIOD_MS);
    } else if (lastOp.status === 'won') {
       if(riskManager.mode === 'Cautious') {
           setRiskManager({
             mode: 'Normal',
             lastLossReason: null,
             calmnessScoreThreshold: BASE_CALMNESS_THRESHOLD,
             adaptiveDuration: KILL_SWITCH_SECONDS,
           });
           setTimeout(() => toast({ title: '🤖 Gerente de Estratégia: Modo Normal', description: 'Confiança recuperada. Parâmetros de risco restaurados.' }), 0);
       }
    }
  }, [riskManager.mode, toast]);

  useEffect(() => {
    if (!isAutopilotOn) {
        setBotStatus('PAUSED');
        return;
    }

    if (!isConnected || !activeSymbol || botCandleData.length < VOLATILITY_LOOKBACK) {
      setBotStatus('MONITORING');
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
                setTimeout(() => toast({ title: "🏆 Piloto: Meta de Lucro Atingida!", description: `Parabéns! O sistema foi pausado. Lucro do dia: $${dailyPnL.toFixed(2)}` }), 0);
            }
            return true;
        }
        return false;
      }
      
      if (checkStopConditions()) {
          executionRef.current = false;
          return;
      }

      const realtimeBotCandles = [...botCandleData];
      if (realtimeBotCandles.length > 0 && priceTicks.length > 0) {
          const lastCandle = realtimeBotCandles[realtimeBotCandles.length - 1];
          const latestTick = priceTicks[priceTicks.length - 1];
          
          if (latestTick && lastCandle) {
              if (latestTick.epoch >= lastCandle.epoch && latestTick.epoch < lastCandle.epoch + 60) {
                  const lastCandleMutable = { ...lastCandle };
                  lastCandleMutable.close = latestTick.price;
                  lastCandleMutable.high = Math.max(lastCandle.high, latestTick.price);
                  lastCandleMutable.low = Math.min(lastCandle.low, latestTick.price);
                  realtimeBotCandles[realtimeBotCandles.length - 1] = lastCandleMutable;
              } else if (latestTick.epoch >= lastCandle.epoch + 60) {
                  const newCandle: CandleData = {
                      epoch: Math.floor(latestTick.epoch / 60) * 60,
                      open: latestTick.price,
                      high: latestTick.price,
                      low: latestTick.price,
                      close: latestTick.price,
                      volume: 1,
                  };
                  realtimeBotCandles.push(newCandle);
              }
          }
      }

      const calculatedIndicators = calculateAllIndicators(realtimeBotCandles, initialCouncilStrategies, '1m', {duration: 15, unit: 's'});
      if (!calculatedIndicators || !calculatedIndicators.bbw || !calculatedIndicators.atr || !calculatedIndicators.adx || !calculatedIndicators.adxSeries) {
          executionRef.current = false;
          return;
      }

      const recentBbwValues = (calculatedIndicators.bbwSeries || []).slice(-VOLATILITY_LOOKBACK).filter(v => v !== null) as number[];
      const recentAtrValues = (calculatedIndicators.atrSeries || []).slice(-VOLATILITY_LOOKBACK).filter(v => v !== null) as number[];

      const avgBbw = recentBbwValues.length > 0 ? recentBbwValues.reduce((s, v) => s + v, 0) / recentBbwValues.length : 0;
      const avgAtr = recentAtrValues.length > 0 ? recentAtrValues.reduce((s, v) => s + v, 0) / recentAtrValues.length : 0;
      
      const localMetrics = { bbw: calculatedIndicators.bbw, atr: calculatedIndicators.atr, adx: calculatedIndicators.adx, avgBbw, avgAtr };
      setMetrics(localMetrics);
      
      const lastOp = operationsLog[0];
      if (lastOp && lastOp.status !== 'pending' && lastOp.initiator === 'Piloto' && lastOp.id > lastOpIdRef.current) {
         analyzeAndAdjustStrategy(lastOp, calculatedIndicators, localMetrics);
         lastOpIdRef.current = lastOp.id;
         executionRef.current = false;
         return;
      }

      const openPosition = operationsLog.find(op => op.id === openPilotContractIdRef.current && op.status === 'pending');

      if (openPosition) {
        setBotStatus('POSITION_OPEN');
        
        let microVolatilityVeto = false;
        if (priceTicks.length > MICRO_VOLATILITY_WINDOW && entryTickVolatilityRef.current !== null) {
            const recentTicks = priceTicks.slice(-MICRO_VOLATILITY_WINDOW);
            const recentPrices = recentTicks.map(t => t.price);
            const mean = recentPrices.reduce((a, b) => a + b) / recentPrices.length;
            const stdDev = Math.sqrt(recentPrices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b) / recentPrices.length);

            if (stdDev > entryTickVolatilityRef.current * MICRO_VOLATILITY_SPIKE_MULTIPLIER) {
                microVolatilityVeto = true;
            }
        }
        
        const isVolatilityExpanding = 
            calculatedIndicators.bbw! > localMetrics.avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW ||
            calculatedIndicators.atr! > localMetrics.avgAtr * ATR_EXIT_MULTIPLIER ||
            calculatedIndicators.adx! > ADX_EXIT_THRESHOLD;
            
        const hasReachedStopLoss = (openPosition.result || 0) <= -openPosition.stake * MAX_LOSS_PERCENT;
        const hasReachedTakeProfit = (openPosition.result || 0) >= openPosition.stake * TAKE_PROFIT_PERCENT;

        const entryTime = new Date(openPosition.timestamp).getTime();
        const elapsedTimeInSeconds = (Date.now() - entryTime) / 1000;
        const killSwitchTriggered = elapsedTimeInSeconds >= riskManager.adaptiveDuration;
        
        let shouldSell = false;
        let reason = '';

        if (hasReachedTakeProfit) {
            shouldSell = true;
            reason = `Alvo de ${TAKE_PROFIT_PERCENT*100}% atingido ($${(openPosition.result || 0).toFixed(2)}).`;
        } else if (microVolatilityVeto) {
            shouldSell = true;
            reason = 'Veto de Micro-Volatilidade: Pico de instabilidade nos ticks.';
        } else if (killSwitchTriggered) {
            shouldSell = true;
            reason = `Kill Switch de Tempo (${riskManager.adaptiveDuration}s) ativado para limitar exposição.`;
        } else if (isVolatilityExpanding) {
            shouldSell = true;
            reason = 'Veto de Volatilidade: Risco de mercado aumentou.';
        } else if (hasReachedStopLoss) {
            shouldSell = true;
            reason = `Stop Loss de ${MAX_LOSS_PERCENT * 100}% atingido.`;
        }
        
        if (shouldSell) {
          setTimeout(() => toast({
            title: "🤖 Piloto: A fechar posição",
            description: reason,
          }), 0);
          lastSellReasonRef.current = reason;
          await sellContract(openPosition.id);
          openPilotContractIdRef.current = null;
          entryTickVolatilityRef.current = null; // Limpa a volatilidade de entrada
        }
      } else {
        if(openPilotContractIdRef.current) openPilotContractIdRef.current = null;
        if(entryTickVolatilityRef.current) entryTickVolatilityRef.current = null;

        if(botStatus === 'COOLDOWN') {
          executionRef.current = false;
          return;
        }
        
        const { adx, bbw, zScore } = calculatedIndicators;
        
        const adxScore = Math.max(0, 100 - ((Math.max(0, (adx || 35) - 15) / 20) * 100));
        const bbwScore = localMetrics.avgBbw > 0 ? Math.max(0, 100 - ((bbw! / (localMetrics.avgBbw * 1.5)) * 100)) : 50;
        
        let tickVolatilityScore = 50;
        if (priceTicks.length >= 20) {
            const recentTickPrices = priceTicks.slice(-20).map(t => t.price);
            const avgTickPrice = recentTickPrices.reduce((s, p) => s + p, 0) / 20;
            const tickStdDev = Math.sqrt(recentTickPrices.reduce((s, p) => s + Math.pow(p - avgTickPrice, 2), 0) / 20);
            const normalizedTickVolatility = avgTickPrice > 0 ? (tickStdDev / avgTickPrice) : 0;
            tickVolatilityScore = Math.max(0, 100 - (normalizedTickVolatility * 100000));
        }

        const finalCalmnessScore = (adxScore * 0.25) + (bbwScore * 0.25) + (tickVolatilityScore * 0.50);
        setCalmnessScore(finalCalmnessScore);
        
        const calmnessScoreMet = finalCalmnessScore >= riskManager.calmnessScoreThreshold;
        const bbwIsLow = bbw! < localMetrics.avgBbw;
        const atrIsLow = calculatedIndicators.atr! < localMetrics.avgAtr;
        const zScoreIsStable = Math.abs(zScore || 0) < 1.0;

        setEntryConditions({ calmnessScore: calmnessScoreMet, bbwIsLow, atrIsLow, zScoreIsStable });
        
        const isCalm = calmnessScoreMet && bbwIsLow && atrIsLow && zScoreIsStable;

        if (isCalm && openPilotContractIdRef.current === null) {
          setBotStatus('CALM_DETECTED');
          const stake = Math.max(1.0, Math.min(dailyBalance * 0.1, 10));
          
          if (priceTicks.length > MICRO_VOLATILITY_WINDOW) {
              const recentTicks = priceTicks.slice(-MICRO_VOLATILITY_WINDOW);
              const recentPrices = recentTicks.map(t => t.price);
              const mean = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
              entryTickVolatilityRef.current = Math.sqrt(recentPrices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b) / recentPrices.length);
          } else {
              entryTickVolatilityRef.current = null;
          }

          setTimeout(() => toast({ title: "🤖 Piloto: Posição Aberta!", description: `Calmaria detectada. Contrato aberto com taxa de ${DEFAULT_GROWTH_RATE * 100}%.` }), 0);

          const result = await executeTrade(stake, DEFAULT_GROWTH_RATE, activeSymbol, 'Piloto');
          if (result.success && result.contractId) {
              openPilotContractIdRef.current = result.contractId;
          }

        } else {
          setBotStatus('MONITORING');
        }
      }
      executionRef.current = false;
    };
    runCycle();
  }, [
      isAutopilotOn, isConnected, activeSymbol, dataVersion, botCandleData, priceTicks,
      dailyPnL, dailyBalance, dailyTarget, executeTrade, sellContract, toast, 
      riskManager, analyzeAndAdjustStrategy, operationsLog, botStatus
  ]);

  return { isAutopilotOn, toggleAutopilot, botStatus, volatilityMetrics: metrics, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, dailyPnL, riskManager, calmnessScore, entryConditions };
}
