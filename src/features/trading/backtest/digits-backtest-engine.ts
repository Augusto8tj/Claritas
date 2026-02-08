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
): Record<'matchesDiffers' | 'overUnder' | 'evenOdd', StrategyBacktestResult> {

  const matchesDiffersTrades: DigitTradeResult[] = [];
  const overUnderTrades: DigitTradeResult[] = [];
  const evenOddTrades: DigitTradeResult[] = [];

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

    const exitTick = ticks[i + 1];
    const actualDigit = getLastDigit(exitTick.price);

    // 1. Matches/Differs Strategy
    const mostProbable = stats[0];
    if (mostProbable && mostProbable.probability > config.threshold) {
      const predictionDigit = mostProbable.digit;
      const isWin = actualDigit !== predictionDigit;
      const pnl = isWin ? config.stake * 0.10 : -config.stake; // Conservative 10% payout on win
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
    
    // 2. Over/Under Strategy (fixed barrier for now: Over 4 / Under 5)
    // Higher threshold because it's closer to a 50/50 bet
    const overUnderThreshold = config.threshold + 20;
    const probOver4 = stats.filter(s => s.digit > 4).reduce((sum, s) => sum + s.probability, 0);
    const probUnder5 = stats.filter(s => s.digit < 5).reduce((sum, s) => sum + s.probability, 0);

    if (probOver4 > overUnderThreshold) {
        const isWin = actualDigit > 4;
        const pnl = isWin ? config.stake * 0.95 : -config.stake;
        overUnderTrades.push({
            tickIndex: i,
            entryPrice: ticks[i].price,
            exitPrice: exitTick.price,
            prediction: 'OVER 4',
            actualDigit,
            result: isWin ? 'win' : 'loss',
            pnl,
        });
    } else if (probUnder5 > overUnderThreshold) {
        const isWin = actualDigit < 5;
        const pnl = isWin ? config.stake * 0.95 : -config.stake;
        overUnderTrades.push({
            tickIndex: i,
            entryPrice: ticks[i].price,
            exitPrice: exitTick.price,
            prediction: 'UNDER 5',
            actualDigit,
            result: isWin ? 'win' : 'loss',
            pnl,
        });
    }

    // 3. Even/Odd Strategy
    const evenOddThreshold = config.threshold + 20;
    const probEven = stats.filter(s => s.digit % 2 === 0).reduce((sum, s) => sum + s.probability, 0);
    
    if (probEven > evenOddThreshold) {
        const isWin = actualDigit % 2 === 0;
        const pnl = isWin ? config.stake * 0.95 : -config.stake;
        evenOddTrades.push({
            tickIndex: i,
            entryPrice: ticks[i].price,
            exitPrice: exitTick.price,
            prediction: 'EVEN',
            actualDigit,
            result: isWin ? 'win' : 'loss',
            pnl,
        });
    } else if ((100 - probEven) > evenOddThreshold) { // Probability of Odd
        const isWin = actualDigit % 2 !== 0;
        const pnl = isWin ? config.stake * 0.95 : -config.stake;
        evenOddTrades.push({
            tickIndex: i,
            entryPrice: ticks[i].price,
            exitPrice: exitTick.price,
            prediction: 'ODD',
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

  return {
    matchesDiffers: calculateMetrics(matchesDiffersTrades),
    overUnder: calculateMetrics(overUnderTrades),
    evenOdd: calculateMetrics(evenOddTrades),
  };
}
