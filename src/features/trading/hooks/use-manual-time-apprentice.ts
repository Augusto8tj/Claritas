'use client';

import { useState, useEffect, useRef } from 'react';
import type { TickData, Operation } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

const APPRENTICE_CONFIG = {
  // Time windows in seconds to analyze for volatility
  TIME_WINDOWS_S: [5, 10, 15, 20, 25, 30],
  // Base volatility threshold to be considered "calm"
  VOLATILITY_THRESHOLD: 0.0003,
  // Base profit target for a $1 stake in a perfectly calm market
  BASE_TAKE_PROFIT: 1.25, // More conservative start
  // How much volatility reduces the profit target. Higher means more sensitive.
  VOLATILITY_SENSITIVITY: 150,
  // Minimum profit target as a percentage of stake
  MIN_PROFIT_PERCENTAGE: 0.05,
};

const calculateStdDev = (ticks: TickData[]): number => {
    if (ticks.length < 2) return 0;
    const prices = ticks.map(t => t.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(prices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / prices.length);
    // Normalize by mean to make it comparable
    return mean > 0 ? stdDev / mean : 0;
};

export interface ManualTimeApprenticeState {
    isMarketCalm: boolean;
    suggestedTakeProfit: number;
    volatilityDetails: {
        max: number;
        windows: { seconds: number; volatility: number }[];
    };
}


/**
 * An "apprentice" hook that provides insights for manual trading AND
 * automatically closes manual positions based on a dynamic, conservative take-profit target.
 */
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

  // Find the currently open manual trade
  useEffect(() => {
    const openManualTrade = operationsLog.find(
      op => op.initiator === 'Manual' && op.status === 'pending'
    );
    setActiveManualTrade(openManualTrade || null);
  }, [operationsLog]);

  // Main logic for calculation and auto-closing
  useEffect(() => {
    if (priceTicks.length < 10) return;

    const now = Date.now() / 1000;

    // 1. Calculate volatility for each window
    const windowVolatilities = APPRENTICE_CONFIG.TIME_WINDOWS_S.map(windowInSeconds => {
        const startIndex = priceTicks.findIndex(t => t.epoch > now - windowInSeconds);
        if (startIndex === -1) return { seconds: windowInSeconds, volatility: 0 };
        const ticksInWindow = priceTicks.slice(startIndex);
        return { seconds: windowInSeconds, volatility: calculateStdDev(ticksInWindow) };
    });

    const maxVolatility = Math.max(...windowVolatilities.map(w => w.volatility));
    
    // 2. Determine market calmness
    const calm = maxVolatility < APPRENTICE_CONFIG.VOLATILITY_THRESHOLD;
    
    // Determine the stake to use for profit calculation
    const stake = activeManualTrade?.stake || formStake || 1.0;

    // 3. Calculate take-profit target
    const volatilityFactor = 1 + (maxVolatility * APPRENTICE_CONFIG.VOLATILITY_SENSITIVITY);
    const profitSuggestion = (APPRENTICE_CONFIG.BASE_TAKE_PROFIT / volatilityFactor) * stake;
    const minProfit = stake * APPRENTICE_CONFIG.MIN_PROFIT_PERCENTAGE;
    const finalTakeProfit = Math.max(minProfit, profitSuggestion);

    // 4. Update the entire state at once
    setState({
        isMarketCalm: calm,
        suggestedTakeProfit: finalTakeProfit,
        volatilityDetails: {
            max: maxVolatility,
            windows: windowVolatilities,
        }
    });

    // 5. Auto-close logic (if there's an active trade)
    if (activeManualTrade && !closingInProgressRef.current.has(activeManualTrade.id)) {
        const currentProfit = activeManualTrade.result || 0;
        if (currentProfit >= finalTakeProfit) {
          closingInProgressRef.current.add(activeManualTrade.id);
          toast({
            title: "🎯 Aprendiz: Alvo Atingido!",
            description: `Fechando posição manual #${activeManualTrade.id} com lucro de $${currentProfit.toFixed(2)}.`,
          });
          sellContract(activeManualTrade.id).finally(() => {
            // Remove from the set after some time, even if the sell fails, to allow retries
            setTimeout(() => closingInProgressRef.current.delete(activeManualTrade.id), 5000);
          });
        }
    }
  }, [priceTicks, activeManualTrade, sellContract, toast, formStake]);

  return state;
};
