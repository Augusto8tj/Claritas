// src/features/trading/hooks/use-accumulators-council.ts
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDerivApiAccumulators } from './use-deriv-api-accumulators';
import { useToast } from '@/hooks/use-toast';
import type { CandleData, Operation } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';

type BotStatus = 'PAUSED' | 'MONITORING' | 'CALM_DETECTED' | 'POSITION_OPEN';

// --- Parâmetros da Estratégia ---
const VOLATILITY_LOOKBACK = 50;
const BBW_THRESHOLD = 0.2; // Entrar se a largura for menor que 20%
const ATR_THRESHOLD_NORMALIZED = 0.0003; // Entrar se ATR/preço for baixo
const ZSCORE_THRESHOLD = 0.8; // Entrar se o preço estiver a menos de 0.8 desvios padrão da média
const PROFIT_TAKE_PERCENT = 0.10; // Realizar lucro com 10% do stake
const VOLATILITY_EXIT_MULTIPLIER = 1.8; // Sair se a volatilidade atual for 80% maior que a média recente

export function useAccumulatorsCouncil() {
  const { 
    chartData, 
    executeTrade, 
    sellContract, 
    operationsLog, 
    activeSymbol, 
    isConnected 
  } = useDerivApiAccumulators();
  const { toast } = useToast();

  const [isAutopilotOn, setIsAutopilotOn] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus>('PAUSED');
  const [volatilityMetrics, setVolatilityMetrics] = useState<{ bbw: number; atr: number; zScore: number; avgBbw: number }>({ bbw: 0, atr: 0, zScore: 0, avgBbw: 0 });
  
  const executionRef = useRef(false);
  const openPositionRef = useRef<Operation | null>(null);
  const isInitialMount = useRef(true);

  // UseEffect para lidar com o side-effect (toast) na mudança do estado do piloto automático
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
      return newState;
    });
  }, []);

  useEffect(() => {
    if (!isAutopilotOn || !isConnected || !activeSymbol || chartData.length < VOLATILITY_LOOKBACK) {
      if (isAutopilotOn) setBotStatus('MONITORING');
      return;
    }

    if (executionRef.current) return;

    const runCycle = async () => {
      executionRef.current = true;
      
      const candleData = chartData.filter(d => 'close' in d) as CandleData[];
      if (candleData.length < VOLATILITY_LOOKBACK) {
        executionRef.current = false;
        return;
      }
      
      const indicators = calculateAllIndicators(candleData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
      if (!indicators || !indicators.bbw || !indicators.atr || !indicators.zScore) {
          executionRef.current = false;
          return;
      }

      const lastPrice = candleData[candleData.length - 1].close;
      const normalizedAtr = indicators.atr / lastPrice;
      const recentBbwValues = (indicators.bollingerBands || []).slice(-VOLATILITY_LOOKBACK).map(b => b ? ((b.upper - b.lower) / b.middle) * 100 : 0).filter(v => v > 0);
      const avgBbw = recentBbwValues.reduce((sum, val) => sum + val, 0) / recentBbwValues.length;
      
      setVolatilityMetrics({ bbw: indicators.bbw, atr: normalizedAtr, zScore: indicators.zScore, avgBbw });

      openPositionRef.current = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending') || null;

      if (openPositionRef.current) {
        setBotStatus('POSITION_OPEN');
        const position = openPositionRef.current;
        const profit = position.result || 0;
        
        // --- LÓGICA DE SAÍDA ---
        const isVolatilityExpanding = indicators.bbw > avgBbw * VOLATILITY_EXIT_MULTIPLIER;
        const hasReachedProfitTarget = profit >= position.stake * PROFIT_TAKE_PERCENT;
        
        if (isVolatilityExpanding || hasReachedProfitTarget) {
          toast({
            title: "🤖 Piloto: A fechar posição",
            description: isVolatilityExpanding ? `Volatilidade a aumentar (BBW: ${indicators.bbw.toFixed(2)} > ${avgBbw.toFixed(2)})` : `Meta de lucro de ${PROFIT_TAKE_PERCENT * 100}% atingida.`,
          });
          await sellContract(position.id);
        }
      } else {
        // --- LÓGICA DE ENTRADA ---
        const isCalm = 
          indicators.bbw < avgBbw * 0.7 && // BBW 30% abaixo da média
          normalizedAtr < ATR_THRESHOLD_NORMALIZED && 
          Math.abs(indicators.zScore) < ZSCORE_THRESHOLD;

        if (isCalm) {
          setBotStatus('CALM_DETECTED');
          // Para este protótipo, usamos stake e growth rate fixos.
          const stake = 10.0;
          const growthRate = 0.01;
          
          toast({
            title: "🤖 Piloto: Calmaria Detectada!",
            description: `A abrir posição de Acumulador em ${activeSymbol}.`,
          });

          await executeTrade(stake, growthRate, activeSymbol, 'Piloto');
        } else {
          setBotStatus('MONITORING');
        }
      }

      executionRef.current = false;
    };

    const timeoutId = setTimeout(runCycle, 1000);
    return () => clearTimeout(timeoutId);

  }, [isAutopilotOn, chartData, operationsLog, activeSymbol, isConnected, executeTrade, sellContract, toast]);

  return { isAutopilotOn, toggleAutopilot, botStatus, volatilityMetrics };
}
