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

/**
 * An "apprentice" hook that provides insights for manual trading AND
 * automatically closes manual positions based on a dynamic, conservative take-profit target.
 */
export const useManualTimeApprentice = (
  priceTicks: TickData[],
  operationsLog: Operation[],
  sellContract: (contractId: number) => Promise<any>
) => {
  const { toast } = useToast();
  const [isMarketCalm, setIsMarketCalm] = useState(false);
  const [suggestedTakeProfit, setSuggestedTakeProfit] = useState<number>(0);
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

    // 1. Calculate a conservative volatility measure from multiple time windows
    const maxVolatility = Math.max(
      ...APPRENTICE_CONFIG.TIME_WINDOWS_S.map(windowInSeconds => {
        const startIndex = priceTicks.findIndex(t => t.epoch > now - windowInSeconds);
        if (startIndex === -1) return 0;
        const ticksInWindow = priceTicks.slice(startIndex);
        return calculateStdDev(ticksInWindow);
      })
    );

    // 2. Determine market calmness
    const calm = maxVolatility < APPRENTICE_CONFIG.VOLATILITY_THRESHOLD;
    setIsMarketCalm(calm);

    // If there's no active manual trade, we just update the suggestion for the UI
    if (!activeManualTrade || closingInProgressRef.current.has(activeManualTrade.id)) {
        // Provide a default suggestion for a $1 stake for the UI
        const defaultStake = 1.0;
        const volatilityFactor = 1 + (maxVolatility * APPRENTICE_CONFIG.VOLATILITY_SENSITIVITY);
        const profitSuggestion = (APPRENTICE_CONFIG.BASE_TAKE_PROFIT / volatilityFactor) * defaultStake;
        const minProfit = defaultStake * APPRENTICE_CONFIG.MIN_PROFIT_PERCENTAGE;
        setSuggestedTakeProfit(Math.max(minProfit, profitSuggestion));
        return;
    }

    // 3. Calculate the take-profit for the ACTIVE manual trade
    const stake = activeManualTrade.stake;
    const volatilityFactor = 1 + (maxVolatility * APPRENTICE_CONFIG.VOLATILITY_SENSITIVITY);
    const profitTarget = (APPRENTICE_CONFIG.BASE_TAKE_PROFIT / volatilityFactor) * stake;
    const minProfitTarget = stake * APPRENTICE_CONFIG.MIN_PROFIT_PERCENTAGE;
    const finalTakeProfit = Math.max(minProfitTarget, profitTarget);
    
    setSuggestedTakeProfit(finalTakeProfit); // Update UI

    // 4. Auto-close logic
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

  }, [priceTicks, activeManualTrade, sellContract, toast]);

  return { isMarketCalm, suggestedTakeProfit };
};