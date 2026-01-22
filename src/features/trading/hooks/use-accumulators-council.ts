// src/features/trading/hooks/use-accumulators-council.ts
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiAccumulators } from './use-deriv-api-accumulators';
import { useToast } from '@/hooks/use-toast';
import type { CandleData, Operation, TickData } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';

// --- TIPOS E CONFIGURAÇÕES DA ESTRATÉGIA V3 (ADAPTATIVA) ---

type BotStatus = 'PAUSED' | 'MONITORING' | 'ANALYZING_LOSS' | 'COOLDOWN' | 'CALM_DETECTED' | 'POSITION_OPEN';

interface RiskManagerStatus {
  mode: 'Normal' | 'Cautious';
  lastLossReason: string | null;
  calmnessScoreThreshold: number; // Limiar de Calmaria ajustável
}

const VOLATILITY_LOOKBACK = 50;
const BASE_CALMNESS_THRESHOLD = 70; // Limiar base para entrar numa operação
const PROFIT_TAKE_PERCENT = 0.10;
const MAX_LOSS_PERCENT = 0.50; 
const VOLATILITY_EXIT_MULTIPLIER_BBW = 1.8;
const ADX_EXIT_THRESHOLD = 25;
const ATR_EXIT_MULTIPLIER = 1.6;
const COOLDOWN_PERIOD_MS = 30000;

export function useAccumulatorsCouncil() {
  const { 
    activeSymbol, 
    botCandleData,
    priceTicks, // Adicionado para reatividade tick-a-tick
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
  });

  const lastOpIdRef = useRef<number>(0);
  const executionRef = useRef(false);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);

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
    // Evita notificação no carregamento inicial
    if (botStatus === 'PAUSED' && !isAutopilotOn) {
        const lastOp = operationsLog.length > 0 ? operationsLog[0] : null;
        if(lastOp && lastOpIdRef.current === lastOp.id) return;
    }
    
    // Apenas mostra o toast se o estado não for o inicial de pausa
    if (botStatus !== 'PAUSED' || isAutopilotOn) {
        toast({
          title: `Piloto Automático (Acumuladores) ${isAutopilotOn ? 'Ativado' : 'Desativado'}`,
        });
    }
  }, [isAutopilotOn, botStatus, toast, operationsLog]); 

  const analyzeAndAdjustStrategy = useCallback((lastOp: Operation, localIndicators: Indicators, localMetrics: { avgBbw: number; avgAtr: number; }) => {
    if (lastOp.status === 'lost') {
      let reason = "Perda por quebra de barreira.";
      if (localIndicators.adx! > ADX_EXIT_THRESHOLD) reason = `Pico de Tendência (ADX: ${localIndicators.adx!.toFixed(1)})`;
      else if (localIndicators.bbw! > localMetrics.avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW) reason = `Expansão de Volatilidade (BBW)`;
      else if (localIndicators.atr! > localMetrics.avgAtr * ATR_EXIT_MULTIPLIER) reason = `Aumento do Range (ATR)`;

      setRiskManager(prev => {
        const newThreshold = Math.min(90, prev.calmnessScoreThreshold + 15);
        toast({ title: '🤖 Gerente de Risco: Modo Cauteloso', description: `Limiar de Calmaria aumentado para ${newThreshold}. O sistema será mais seletivo.`, variant: 'destructive' });
        return { mode: 'Cautious', lastLossReason: reason, calmnessScoreThreshold: newThreshold };
      });

      setBotStatus('COOLDOWN');
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => {
        setBotStatus('MONITORING');
      }, COOLDOWN_PERIOD_MS);
    } else if (lastOp.status === 'won' && riskManager.mode === 'Cautious') {
       setRiskManager({
         mode: 'Normal',
         lastLossReason: null,
         calmnessScoreThreshold: BASE_CALMNESS_THRESHOLD
       });
       toast({ title: '🤖 Gerente de Risco: Modo Normal', description: 'Confiança recuperada. Limiar de Calmaria restaurado.' });
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
                toast({ title: "🤖 Piloto: Limite de Perda Atingido", description: `Sistema pausado. Perda do dia: $${dailyPnL.toFixed(2)}`, variant: "destructive" });
            }
            return true;
        }
        if (dailyPnL >= dailyTarget) {
            if (isAutopilotOn) {
                setIsAutopilotOn(false);
                toast({ title: "🏆 Piloto: Meta de Lucro Atingida!", description: `Sistema pausado. Lucro do dia: $${dailyPnL.toFixed(2)}` });
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
      if (!calculatedIndicators || !calculatedIndicators.bbw || !calculatedIndicators.atr || !calculatedIndicators.adx) {
          executionRef.current = false;
          return;
      }

      const recentBbwValues = (calculatedIndicators.bbwSeries || []).slice(-VOLATILITY_LOOKBACK).filter(v => v !== null) as number[];
      const recentAtrValues = (calculatedIndicators.atrSeries || []).slice(-VOLATILITY_LOOKBACK).filter(v => v !== null) as number[];

      const avgBbw = recentBbwValues.length > 0 ? recentBbwValues.reduce((s, v) => s + v, 0) / recentBbwValues.length : 0;
      const avgAtr = recentAtrValues.length > 0 ? recentAtrValues.reduce((s, v) => s + v, 0) / recentAtrValues.length : 0;
      
      const localMetrics = { bbw: calculatedIndicators.bbw, atr: calculatedIndicators.atr, adx: calculatedIndicators.adx, avgBbw, avgAtr };
      setMetrics(localMetrics);
      
      const lastOp = operationsLog.length > 0 ? operationsLog[0] : null;
      if (lastOp && lastOp.status !== 'pending' && lastOp.initiator === 'Piloto' && lastOp.id > lastOpIdRef.current) {
         analyzeAndAdjustStrategy(lastOp, calculatedIndicators, localMetrics);
         lastOpIdRef.current = lastOp.id;
         executionRef.current = false;
         return;
      }

      const openPosition = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');

      if (openPosition) {
        setBotStatus('POSITION_OPEN');
        const profit = openPosition.result || 0;
        
        const isVolatilityExpanding = 
            calculatedIndicators.bbw > avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW ||
            calculatedIndicators.atr > avgAtr * ATR_EXIT_MULTIPLIER ||
            calculatedIndicators.adx > ADX_EXIT_THRESHOLD;
            
        const hasReachedProfitTarget = profit >= openPosition.stake * PROFIT_TAKE_PERCENT;
        const hasReachedStopLoss = profit <= -openPosition.stake * MAX_LOSS_PERCENT;
        
        if (hasReachedProfitTarget || isVolatilityExpanding || hasReachedStopLoss) {
          let reason = 'Condição de saída atingida.';
          if(hasReachedProfitTarget) reason = `Take Profit de ${PROFIT_TAKE_PERCENT * 100}% atingido.`;
          else if(hasReachedStopLoss) reason = `Stop Loss de ${MAX_LOSS_PERCENT * 100}% atingido para limitar perdas.`;
          else if(isVolatilityExpanding) reason = 'Veto de Volatilidade: Risco de mercado aumentou.';

          toast({
            title: "🤖 Piloto: A fechar posição",
            description: reason,
          });
          await sellContract(openPosition.id);
        }
      } else {
        if(botStatus === 'COOLDOWN') {
          executionRef.current = false;
          return;
        }
        
        const { adx, bbw, atr } = calculatedIndicators;
        
        const adxScore = Math.max(0, 100 - ((Math.max(0, adx - 15) / 20) * 100)); // Gradual
        const bbwScore = localMetrics.avgBbw > 0 ? Math.max(0, 100 - ((bbw / (localMetrics.avgBbw * 1.5)) * 100)) : 50;
        
        // --- NOVO: TICK VOLATILITY SCORE ---
        const TICK_VOL_WINDOW = 20;
        let tickVolatilityScore = 50; // Default neutro
        if (priceTicks.length >= TICK_VOL_WINDOW) {
            const recentTickPrices = priceTicks.slice(-TICK_VOL_WINDOW).map(t => t.price);
            const avgTickPrice = recentTickPrices.reduce((s, p) => s + p, 0) / TICK_VOL_WINDOW;
            const tickStdDev = Math.sqrt(recentTickPrices.reduce((s, p) => s + Math.pow(p - avgTickPrice, 2), 0) / TICK_VOL_WINDOW);
            
            const normalizedTickVolatility = avgTickPrice > 0 ? (tickStdDev / avgTickPrice) : 0;
            
            tickVolatilityScore = Math.max(0, 100 - (normalizedTickVolatility * 100000));
        }

        // --- PONTUAÇÃO FINAL COM PESOS AJUSTADOS ---
        const finalCalmnessScore = (adxScore * 0.25) + (bbwScore * 0.25) + (tickVolatilityScore * 0.50);
        setCalmnessScore(finalCalmnessScore);

        const isCalm = finalCalmnessScore >= riskManager.calmnessScoreThreshold;

        if (isCalm) {
          setBotStatus('CALM_DETECTED');
          const stake = Math.max(1.0, Math.min(dailyBalance * 0.1, 10));
          const growthRate = 0.01;
          
          toast({
            title: "🤖 Piloto: Calmaria Detectada!",
            description: `Score: ${finalCalmnessScore.toFixed(0)}. Limiar: ${riskManager.calmnessScoreThreshold}. A abrir posição.`,
          });

          await executeTrade(stake, growthRate, activeSymbol, 'Piloto');
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

  return { isAutopilotOn, toggleAutopilot, botStatus, volatilityMetrics: metrics, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, dailyPnL, riskManager, calmnessScore };
}
