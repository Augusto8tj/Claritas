'use client';

import { useState, useEffect, useMemo } from 'react';
import type { TickData } from '@/lib/types';

const APPRENTICE_CONFIG = {
  TICK_WINDOW: 50, // Analyze the last 50 ticks
  VOLATILITY_THRESHOLD: 0.005, // Normalized standard deviation threshold for what is considered "low volatility"
  BASE_TAKE_PROFIT: 1.5, // Base profit target in USD for a $1 stake, this is a starting point
  VOLATILITY_SENSITIVITY: 100, // How much volatility affects the profit target
};

/**
 * Calculates the standard deviation of a series of tick prices.
 * @param ticks An array of TickData objects.
 * @returns The normalized standard deviation (stdDev / mean).
 */
const calculateStdDev = (ticks: TickData[]): number => {
    if (ticks.length < 2) return 0;
    const prices = ticks.map(t => t.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(prices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / prices.length);
    // Normalize by mean to make it comparable across different price levels and assets
    return mean > 0 ? stdDev / mean : 0;
};

/**
 * A hook that acts as an "apprentice" to the Time Master, providing insights for manual trading.
 * It analyzes tick data to suggest a take profit value and determine if the market is calm.
 * @param priceTicks The array of recent price ticks.
 * @param stake The current stake amount from the form.
 * @returns An object containing `isMarketCalm` and `suggestedTakeProfit`.
 */
export const useManualTimeApprentice = (priceTicks: TickData[], stake: number) => {
  const [isMarketCalm, setIsMarketCalm] = useState(false);
  const [suggestedTakeProfit, setSuggestedTakeProfit] = useState<number>(APPRENTICE_CONFIG.BASE_TAKE_PROFIT);

  useEffect(() => {
    // Ensure we have enough data to perform a meaningful analysis
    if (priceTicks.length < APPRENTICE_CONFIG.TICK_WINDOW) {
      return;
    }

    const recentTicks = priceTicks.slice(-APPRENTICE_CONFIG.TICK_WINDOW);
    
    // 1. Calculate Volatility using a normalized standard deviation of recent ticks.
    const normalizedStdDev = calculateStdDev(recentTicks);

    // 2. Determine Market Calmness by comparing volatility to a predefined threshold.
    const calm = normalizedStdDev < APPRENTICE_CONFIG.VOLATILITY_THRESHOLD;
    setIsMarketCalm(calm);

    // 3. Calculate Suggested Take Profit.
    // The formula is designed to suggest a lower profit target in volatile markets and a higher one in calm markets.
    // The profit is also scaled by the current stake value.
    const volatilityFactor = 1 + (normalizedStdDev * APPRENTICE_CONFIG.VOLATILITY_SENSITIVITY);
    const profitSuggestion = (APPRENTICE_CONFIG.BASE_TAKE_PROFIT / volatilityFactor) * stake;
    
    // Ensure the suggested profit is at least a minimum percentage of the stake (e.g., 5%) to be meaningful.
    const minProfit = stake * 0.05;
    setSuggestedTakeProfit(Math.max(minProfit, profitSuggestion));

  }, [priceTicks, stake]); // Re-run the analysis whenever new tick data arrives or the stake changes.

  return { isMarketCalm, suggestedTakeProfit };
};
