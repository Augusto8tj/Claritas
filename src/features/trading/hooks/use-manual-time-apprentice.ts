// src/features/trading/hooks/use-manual-time-apprentice.ts
'use client';

import { useState, useEffect, useRef } from 'react';
import type { TickData, Operation } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

const APPRENTICE_CONFIG = {
  TIME_WINDOWS_S: [5, 10, 15, 20, 25, 30],
  VOLATILITY_THRESHOLD: 0.0003,
  RISK_AVERSION: 0.5, // 0 = risk-neutral, 1 = max risk-averse
  MIN_PROFIT_PERCENTAGE: 0.05,
};

const calculateStdDev = (ticks: TickData[]): number => {
    if (ticks.length < 2) return 0;
    const prices = ticks.map(t => t.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(prices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / prices.length);
    return mean > 0 ? stdDev / mean : 0;
};

/**
 * Estima o take profit que maximiza a utilidade esperada
 * usando a distribuição empírica de lucros históricos
 */
function calculateOptimalTakeProfit(
  historicalProfitRatios: number[], // Expects ratios (profit/stake)
  riskAversion: number // 0-1
): number {
  if (historicalProfitRatios.length < 5) {
    return 0.25; // Fallback para 25% de lucro se não houver histórico
  }
  
  const sortedRatios = [...historicalProfitRatios].sort((a, b) => a - b);
  
  // Aversão ao risco mapeia para um percentil. 
  // 0 (risk neutral) -> 75th percentile
  // 1 (max risk averse) -> 50th percentile (mediana)
  const percentile = 0.75 - (riskAversion * 0.25);
  const targetIndex = Math.floor(sortedRatios.length * percentile);
  
  // Retorna o ratio de lucro ótimo
  return sortedRatios[targetIndex] || 0.25;
}


export interface ManualTimeApprenticeState {
    isMarketCalm: boolean;
    suggestedTakeProfit: number;
    volatilityDetails: {
        max: number;
        windows: { seconds: number; volatility: number }[];
    };
}

export const useManualTimeApprentice = (
  priceTicks: TickData[],
  operationsLog: Operation[],
  sellContract: (contractId: number) => Promise<any>,
  formStake: number
): ManualTimeApprenticeState => {
  const { toast } = useToast();
  const [state, setState] = useState<ManualTimeApprenticeState>({
      isMarketCalm: false,
      suggestedTakeProfit: 0,
      volatilityDetails: {
          max: 0,
          windows: APPRENTICE_CONFIG.TIME_WINDOWS_S.map(s => ({ seconds: s, volatility: 0 })),
      },
  });
  const [activeManualTrade, setActiveManualTrade] = useState<Operation | null>(null);
  const closingInProgressRef = useRef<Set<number>>(new Set());
  
  const historicalManualProfitRatios = useRef<number[]>([]);

  useEffect(() => {
    const manualWins = operationsLog.filter(op => op.initiator === 'Manual' && op.status === 'won' && op.result && op.stake > 0);
    if(manualWins.length > 0) {
      historicalManualProfitRatios.current = manualWins.map(op => op.result! / op.stake);
    }
  }, [operationsLog]);


  useEffect(() => {
    const openManualTrade = operationsLog.find(
      op => op.initiator === 'Manual' && op.status === 'pending'
    );
    setActiveManualTrade(openManualTrade || null);
  }, [operationsLog]);

  useEffect(() => {
    if (priceTicks.length < 10) return;

    const now = Date.now() / 1000;

    const windowVolatilities = APPRENTICE_CONFIG.TIME_WINDOWS_S.map(windowInSeconds => {
        const startIndex = priceTicks.findIndex(t => t.epoch > now - windowInSeconds);
        if (startIndex === -1) return { seconds: windowInSeconds, volatility: 0 };
        const ticksInWindow = priceTicks.slice(startIndex);
        return { seconds: windowInSeconds, volatility: calculateStdDev(ticksInWindow) };
    });

    const maxVolatility = Math.max(...windowVolatilities.map(w => w.volatility));
    
    const calm = maxVolatility < APPRENTICE_CONFIG.VOLATILITY_THRESHOLD;
    
    const stake = activeManualTrade?.stake || formStake || 1.0;

    const optimalProfitRatio = calculateOptimalTakeProfit(
      historicalManualProfitRatios.current,
      APPRENTICE_CONFIG.RISK_AVERSION
    );
    
    const profitSuggestion = optimalProfitRatio * stake;
    const minProfit = stake * APPRENTICE_CONFIG.MIN_PROFIT_PERCENTAGE;
    const finalTakeProfit = Math.max(minProfit, profitSuggestion);
    
    setState({
        isMarketCalm: calm,
        suggestedTakeProfit: finalTakeProfit,
        volatilityDetails: {
            max: maxVolatility,
            windows: windowVolatilities,
        }
    });

    if (activeManualTrade && !closingInProgressRef.current.has(activeManualTrade.id)) {
        const currentProfit = activeManualTrade.result || 0;
        if (currentProfit >= finalTakeProfit) {
          closingInProgressRef.current.add(activeManualTrade.id);
          toast({
            title: "🎯 Aprendiz: Alvo Atingido!",
            description: `Fechando posição manual #${activeManualTrade.id} com lucro de $${currentProfit.toFixed(2)}.`,
          });
          sellContract(activeManualTrade.id).finally(() => {
            setTimeout(() => closingInProgressRef.current.delete(activeManualTrade.id), 5000);
          });
        }
    }
  }, [priceTicks, activeManualTrade, sellContract, toast, formStake]);

  return state;
};
