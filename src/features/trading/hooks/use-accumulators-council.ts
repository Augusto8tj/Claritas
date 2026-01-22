// src/features/trading/hooks/use-accumulators-council.ts
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiAccumulators } from './use-deriv-api-accumulators';
import { useToast } from '@/hooks/use-toast';
import type { CandleData, Operation } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';

// --- TIPOS E CONFIGURAÇÕES DA ESTRATÉGIA V2 ---

type BotStatus = 'PAUSED' | 'MONITORING' | 'ANALYZING_LOSS' | 'COOLDOWN' | 'CALM_DETECTED' | 'POSITION_OPEN';

interface RiskManagerStatus {
  mode: 'Normal' | 'Cautious';
  lastLossReason: string | null;
  adjustments: {
    adxThreshold: number;
    bbwFactor: number;
  }
}

const VOLATILITY_LOOKBACK = 50;
const BASE_ADX_THRESHOLD = 20;
const BASE_BBW_SHRINK_FACTOR = 0.7;
const PROFIT_TAKE_PERCENT = 0.10; // 10% de lucro
const VOLATILITY_EXIT_MULTIPLIER_BBW = 1.8;
const ADX_EXIT_THRESHOLD = 25;
const ATR_EXIT_MULTIPLIER = 1.6;
const COOLDOWN_PERIOD_MS = 30000; // 30 segundos

export function useAccumulatorsCouncil() {
  const { 
    activeSymbol, 
    botCandleData,
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
  const [indicators, setIndicators] = useState<Indicators | null>(null);

  const [dailyBalance, setDailyBalance] = useState(10.0);
  const [dailyTarget, setDailyTarget] = useState(5.0);
  
  const [riskManager, setRiskManager] = useState<RiskManagerStatus>({
    mode: 'Normal',
    lastLossReason: null,
    adjustments: {
      adxThreshold: BASE_ADX_THRESHOLD,
      bbwFactor: BASE_BBW_SHRINK_FACTOR,
    }
  });

  const lastOpIdRef = useRef<number>(0);
  const executionRef = useRef(false);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMount = useRef(true);

  const dailyPnL = useMemo(() => {
    const today = new Date().toDateString();
    return operationsLog
        .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today && op.initiator === 'Piloto')
        .reduce((sum, op) => sum + (op.result || 0), 0);
  }, [operationsLog]);


  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    toast({
      title: `Piloto Automático (Acumuladores) ${isAutopilotOn ? 'Ativado' : 'Desativado'}`,
    });
  }, [isAutopilotOn, toast]);

  const toggleAutopilot = useCallback(() => {
    setIsAutopilotOn(prev => {
      const newState = !prev;
      setBotStatus(newState ? 'MONITORING' : 'PAUSED');
      if (newState) {
          lastOpIdRef.current = operationsLog[0]?.id || 0;
      }
      return newState;
    });
  }, [operationsLog]);

  const analyzeAndAdjustStrategy = useCallback((lastOp: Operation, localIndicators: Indicators, localMetrics: { avgBbw: number; avgAtr: number; }) => {
    if (lastOp.status === 'lost') {
      let reason = "Perda por quebra de barreira.";
      if (localIndicators.adx! > ADX_EXIT_THRESHOLD) reason = `Pico de Tendência (ADX: ${localIndicators.adx!.toFixed(1)})`;
      else if (localIndicators.bbw! > localMetrics.avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW) reason = `Expansão de Volatilidade (BBW)`;
      else if (localIndicators.atr! > localMetrics.avgAtr * ATR_EXIT_MULTIPLIER) reason = `Aumento do Range (ATR)`;

      setRiskManager(prev => {
        const newAdjustments = {
          adxThreshold: Math.max(15, prev.adjustments.adxThreshold * 0.9),
          bbwFactor: Math.max(0.4, prev.adjustments.bbwFactor * 0.9),
        };
        toast({ title: '🤖 Gerente de Risco: Ajustando Estratégia', description: `Modo Cauteloso ativado após perda. Próxima entrada será mais seletiva.`, variant: 'destructive' });
        return { mode: 'Cautious', lastLossReason: reason, adjustments: newAdjustments };
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
         adjustments: { adxThreshold: BASE_ADX_THRESHOLD, bbwFactor: BASE_BBW_SHRINK_FACTOR }
       });
       toast({ title: '🤖 Gerente de Risco: Modo Normal', description: 'Confiança recuperada. Parâmetros de entrada restaurados.' });
    }
  }, [riskManager.mode, toast]);

  useEffect(() => {
    if (!isAutopilotOn || !isConnected || !activeSymbol || botCandleData.length < VOLATILITY_LOOKBACK || botStatus === 'COOLDOWN') {
      if(isAutopilotOn && botStatus !== 'COOLDOWN') setBotStatus('MONITORING');
      return;
    }

    if (executionRef.current) return;
    
    const checkStopConditions = () => {
        if (dailyPnL <= -dailyBalance) {
            if (isAutopilotOn) {
                toggleAutopilot();
                toast({ title: "🤖 Piloto: Limite de Perda Atingido", description: `Sistema pausado. Perda do dia: $${dailyPnL.toFixed(2)}`, variant: "destructive" });
            }
            return true;
        }
        if (dailyPnL >= dailyTarget) {
            if (isAutopilotOn) {
                toggleAutopilot();
                toast({ title: "🏆 Piloto: Meta de Lucro Atingida!", description: `Sistema pausado. Lucro do dia: $${dailyPnL.toFixed(2)}` });
            }
            return true;
        }
        return false;
    }

    const runCycle = async () => {
      executionRef.current = true;
      
      if (checkStopConditions()) {
          executionRef.current = false;
          return;
      }

      const calculatedIndicators = calculateAllIndicators(botCandleData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
      if (!calculatedIndicators || !calculatedIndicators.bbw || !calculatedIndicators.atr || !calculatedIndicators.adx) {
          executionRef.current = false;
          return;
      }
      setIndicators(calculatedIndicators);

      const recentCandles = botCandleData.slice(-VOLATILITY_LOOKBACK);
      const recentBbwValues = recentCandles.map(c => ((c.high - c.low) / c.close) * 100).filter(v => v > 0);
      const recentAtrValues = calculateAllIndicators(recentCandles, [], '1m', {duration:1,unit:'s'})?.atrSeries || [];
      const avgBbw = recentBbwValues.length > 0 ? recentBbwValues.reduce((s, v) => s + v, 0) / recentBbwValues.length : 0;
      const avgAtr = recentAtrValues.length > 0 ? recentAtrValues.reduce((s, v) => s + (v || 0), 0) / recentAtrValues.length : 0;
      
      const localMetrics = { bbw: calculatedIndicators.bbw, atr: calculatedIndicators.atr, adx: calculatedIndicators.adx, avgBbw, avgAtr };
      setMetrics(localMetrics);
      
      if (operationsLog.length > 0) {
          const lastOp = operationsLog[0];
          if (lastOp.status !== 'pending' && lastOp.initiator === 'Piloto' && lastOp.id > lastOpIdRef.current) {
             analyzeAndAdjustStrategy(lastOp, calculatedIndicators, localMetrics);
             lastOpIdRef.current = lastOp.id;
          }
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
        
        if (isVolatilityExpanding || hasReachedProfitTarget) {
          toast({
            title: "🤖 Piloto: A fechar posição",
            description: hasReachedProfitTarget ? `Take Profit de ${PROFIT_TAKE_PERCENT * 100}% atingido.` : `Risco de Volatilidade detectado.`,
          });
          await sellContract(openPosition.id);
        }
      } else {
        const { adxThreshold, bbwFactor } = riskManager.adjustments;
        const isCalm = 
          calculatedIndicators.adx < adxThreshold &&
          calculatedIndicators.bbw < avgBbw * bbwFactor;

        if (isCalm) {
          setBotStatus('CALM_DETECTED');
          const stake = Math.max(1.0, Math.min(dailyBalance * 0.1, 10));
          const growthRate = 0.01;
          
          toast({
            title: "🤖 Piloto: Calmaria Detectada!",
            description: `ADX(${calculatedIndicators.adx.toFixed(1)}) e BBW(${calculatedIndicators.bbw.toFixed(2)}) baixos. A abrir posição.`,
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
      isAutopilotOn, isConnected, activeSymbol, dataVersion, botCandleData, 
      dailyPnL, dailyBalance, dailyTarget, executeTrade, sellContract, toast, 
      riskManager, analyzeAndAdjustStrategy, toggleAutopilot, operationsLog
  ]);

  return { isAutopilotOn, toggleAutopilot, botStatus, volatilityMetrics: metrics, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, dailyPnL, riskManager };
}
