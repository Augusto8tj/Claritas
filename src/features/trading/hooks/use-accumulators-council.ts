// src/features/trading/hooks/use-accumulators-council.ts
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDerivApiAccumulators } from './use-deriv-api-accumulators';
import { useToast } from '@/hooks/use-toast';
import type { CandleData, Operation } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';

type BotStatus = 'PAUSED' | 'MONITORING' | 'CALM_DETECTED' | 'POSITION_OPEN';

// --- Parâmetros da Estratégia "Caçador de Calmaria" ---
const VOLATILITY_LOOKBACK = 50; // Candles para calcular a média da volatilidade
const ADX_THRESHOLD = 20; // Entrar apenas se ADX (força da tendência) for menor que 20
const BBW_SHRINK_FACTOR = 0.7; // Entrar se a largura das bandas for 70% da média recente
const PROFIT_TAKE_PERCENT = 0.10; // Alvo de lucro: 10% do valor da aposta
const VOLATILITY_EXIT_MULTIPLIER = 1.8; // Sair se a volatilidade atual for 80% maior que a média

export function useAccumulatorsCouncil() {
  const { 
    activeSymbol, 
    botCandleData, // Usando o novo stream de dados dedicado
    executeTrade, 
    sellContract, 
    operationsLog, 
    isConnected,
    dataVersion // Usando o dataVersion como gatilho
  } = useDerivApiAccumulators();
  const { toast } = useToast();

  const [isAutopilotOn, setIsAutopilotOn] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus>('PAUSED');
  const [metrics, setMetrics] = useState<{ bbw: number; atr: number; adx: number; avgBbw: number }>({ bbw: 0, atr: 0, adx: 0, avgBbw: 0 });
  
  const executionRef = useRef(false);
  const openPositionRef = useRef<Operation | null>(null);
  const isInitialMount = useRef(true);

  // Efeito para disparar o toast na mudança de estado do piloto
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

  // Ciclo principal de lógica do bot
  useEffect(() => {
    if (!isAutopilotOn || !isConnected || !activeSymbol || botCandleData.length < VOLATILITY_LOOKBACK) {
      if (isAutopilotOn) setBotStatus('MONITORING');
      return;
    }

    if (executionRef.current) return;

    const runCycle = async () => {
      executionRef.current = true;
      
      const indicators = calculateAllIndicators(botCandleData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
      if (!indicators || !indicators.bbw || !indicators.atr || !indicators.adx) {
          executionRef.current = false;
          return;
      }

      const recentBbwValues = (indicators.bollingerBands || []).slice(-VOLATILITY_LOOKBACK).map(b => b ? ((b.upper - b.lower) / b.middle) * 100 : 0).filter(v => v > 0);
      const avgBbw = recentBbwValues.length > 0 ? recentBbwValues.reduce((sum, val) => sum + val, 0) / recentBbwValues.length : 0;
      
      setMetrics({ bbw: indicators.bbw, atr: indicators.atr, adx: indicators.adx, avgBbw });

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
            description: hasReachedProfitTarget ? `Take Profit de ${PROFIT_TAKE_PERCENT * 100}% atingido.` : `Volatilidade a aumentar (BBW: ${indicators.bbw.toFixed(2)} > ${avgBbw.toFixed(2)})`,
          });
          await sellContract(position.id);
        }
      } else {
        // --- LÓGICA DE ENTRADA ---
        const isCalm = 
          indicators.adx < ADX_THRESHOLD &&
          indicators.bbw < avgBbw * BBW_SHRINK_FACTOR;

        if (isCalm) {
          setBotStatus('CALM_DETECTED');
          // Para este protótipo, usamos stake e growth rate fixos.
          const stake = 10.0;
          const growthRate = 0.01;
          
          toast({
            title: "🤖 Piloto: Calmaria Detectada!",
            description: `ADX(${indicators.adx.toFixed(1)}) e BBW(${indicators.bbw.toFixed(2)}) baixos. A abrir posição.`,
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
      isAutopilotOn, isConnected, activeSymbol, dataVersion, // Acionado por novos dados
      executeTrade, sellContract, operationsLog, toast, botCandleData
  ]);

  return { isAutopilotOn, toggleAutopilot, botStatus, volatilityMetrics: metrics };
}
