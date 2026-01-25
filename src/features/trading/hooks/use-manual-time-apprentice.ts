'use client';

import { useState, useEffect, useRef } from 'react';
import type { TickData, Operation } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

const APPRENTICE_CONFIG = {
  TIME_WINDOWS_S: [5, 10, 15, 20, 25, 30],
  VOLATILITY_THRESHOLD: 0.0003,
  BASE_TAKE_PROFIT: 1.25,
  VOLATILITY_SENSITIVITY: 150,
  MIN_PROFIT_PERCENTAGE: 0.05,
  RISK_AVERSION: 0.5, // 0 = risk-neutral, 1 = max risk-averse
};

// Helper para a Cumulative Distribution Function (CDF) da distribuição Normal
const normalCDF = (x: number): number => {
    return 0.5 * (1 + (x / Math.sqrt(2)) / Math.sqrt(1 + (x*x)/2));
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
  historicalProfits: number[],
  currentVolatility: number,
  riskAversion: number // 0-1
): number {
  if (historicalProfits.length < 5) {
    // Fallback para lógica de volatilidade se não houver histórico suficiente
    const volatilityFactor = 1 + (currentVolatility * APPRENTICE_CONFIG.VOLATILITY_SENSITIVITY);
    return APPRENTICE_CONFIG.BASE_TAKE_PROFIT * volatilityFactor;
  }
  
  // 1. Ajustar distribuição aos dados históricos
  const meanProfit = historicalProfits.reduce((sum, p) => sum + p, 0) / historicalProfits.length;
  const variance = historicalProfits.reduce((sum, p) => sum + Math.pow(p - meanProfit, 2), 0) / historicalProfits.length;
  const stdDevProfit = Math.sqrt(variance);

  // 3. Maximizar E[U(profit)]
  // Uma aproximação é pegar um percentil da distribuição de lucros.
  // Maior aversão ao risco = percentil menor (mais conservador).
  const percentile = 0.75 - (riskAversion * 0.25); // Varia de 75% a 50%
  const sortedProfits = [...historicalProfits].sort((a,b) => a - b);
  const targetIndex = Math.floor(sortedProfits.length * percentile);
  
  return sortedProfits[targetIndex] || meanProfit;
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
  
  const historicalManualProfits = useRef<number[]>([]);

  useEffect(() => {
    const manualWins = operationsLog.filter(op => op.initiator === 'Manual' && op.status === 'won' && op.result);
    if(manualWins.length > 0) {
      historicalManualProfits.current = manualWins.map(op => op.result!);
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
      historicalManualProfits.current,
      maxVolatility,
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
