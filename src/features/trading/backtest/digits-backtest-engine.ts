// src/features/trading/backtest/digits-backtest-engine.ts

import type { TickData } from '@/lib/types';

// --- TYPES ---
export interface DigitsBacktestConfig {
  stake: number;
  threshold: number; // Probability threshold to trigger a trade
  windowSize: number; // Ticks to analyze for frequency
}

export interface DigitTradeResult {
  tickIndex: number;
  entryPrice: number;
  exitPrice: number;
  prediction: string; // e.g., "DIFFERS 7"
  actualDigit: number;
  result: 'win' | 'loss';
  pnl: number;
}

export interface StrategyBacktestResult {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  trades: DigitTradeResult[];
}

// --- HELPERS ---
const getLastDigit = (price: number): number => {
    const priceString = String(price);
    // Handles cases with and without decimals
    if (priceString.includes('.')) {
        return parseInt(priceString.slice(-1), 10);
    }
    return price % 10;
};

// --- MAIN ENGINE ---

/**
 * Simulates digit-based trading strategies on historical tick data.
 * @param ticks - Array of historical tick data.
 * @param config - Configuration for the backtest (stake, threshold, etc.).
 * @returns An object with results for each simulated strategy.
 */
export function runDigitsBacktest(
  ticks: TickData[],
  config: DigitsBacktestConfig
): Record<'matchesDiffers', StrategyBacktestResult> {

  const matchesDiffersTrades: DigitTradeResult[] = [];

  // Loop through the ticks, starting after the first window, leaving one tick at the end for the result.
  for (let i = config.windowSize; i < ticks.length - 1; i++) {
    const analysisWindow = ticks.slice(i - config.windowSize, i);
    const counts = Array(10).fill(0);

    analysisWindow.forEach(tick => {
      const digit = getLastDigit(tick.price);
      if (!isNaN(digit)) {
        counts[digit]++;
      }
    });

    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;

    const stats = counts.map((count, digit) => ({
      digit,
      probability: (count / total) * 100,
    })).sort((a, b) => b.probability - a.probability);

    const mostProbable = stats[0];
    const exitTick = ticks[i + 1];
    const actualDigit = getLastDigit(exitTick.price);

    // Simulate "DIFFERS" strategy
    if (mostProbable && mostProbable.probability > config.threshold) {
      const predictionDigit = mostProbable.digit;
      const isWin = actualDigit !== predictionDigit;
      // Deriv payout for differs is complex. We use a conservative estimate of 10% profit on win.
      const pnl = isWin ? config.stake * 0.1 : -config.stake;

      matchesDiffersTrades.push({
        tickIndex: i,
        entryPrice: ticks[i].price,
        exitPrice: exitTick.price,
        prediction: `DIFFERS ${predictionDigit}`,
        actualDigit,
        result: isWin ? 'win' : 'loss',
        pnl,
      });
    }
  }

  const calculateMetrics = (trades: DigitTradeResult[]): StrategyBacktestResult => {
      const totalTrades = trades.length;
      if (totalTrades === 0) return { totalTrades: 0, winRate: 0, totalPnl: 0, trades: [] };
      const wins = trades.filter(t => t.result === 'win').length;
      const winRate = (wins / totalTrades) * 100;
      const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
      return { totalTrades, winRate, totalPnl, trades };
  };

  // NOTE: Other strategies like 'overUnder' or 'evenOdd' can be added here in the future.
  return {
    matchesDiffers: calculateMetrics(matchesDiffersTrades),
  };
}
