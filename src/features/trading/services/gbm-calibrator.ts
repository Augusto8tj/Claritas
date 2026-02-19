// src/features/trading/services/gbm-calibrator.ts
'use client'; // This ensures the module acts as a singleton on the client-side.

import type { CandleData, TradeResult as BaseTradeResult } from '@/lib/types';
import type { StrategyType } from './hf-strike-logic';

// --- Part A: GBM Parameter Caching ---

interface GBMCache {
  drift: number;
  volatility: number;
  lastUpdated: number;
  candleCount: number;
}

let gbmCache: GBMCache | null = null;
let isCalculatingGBM = false;
const CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Calculates GBM parameters from historical candles.
 * This is the core calculation logic, moved here for centralization.
 * @param candles - Array of candles to analyze.
 * @returns An object with drift and volatility per second.
 */
function calibrateGBMParams(candles: CandleData[]): { drift: number; volatility: number } {
  const lookback = Math.min(100, candles.length);
  const dataSlice = candles.slice(-lookback);

  if (dataSlice.length < 10) {
    // Fallback for insufficient data
    return { drift: 0, volatility: 0.002 / Math.sqrt(60) };
  }

  const logReturns: number[] = [];
  for (let i = 1; i < dataSlice.length; i++) {
    if (dataSlice[i - 1].close > 0) {
      logReturns.push(Math.log(dataSlice[i].close / dataSlice[i - 1].close));
    }
  }

  if (logReturns.length < 2) {
    return { drift: 0, volatility: 0.002 / Math.sqrt(60) };
  }

  const meanReturnPerCandle = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variancePerCandle = logReturns.reduce((sum, r) => sum + Math.pow(r - meanReturnPerCandle, 2), 0) / (logReturns.length - 1);
  const volatilityPerCandle = Math.sqrt(variancePerCandle);

  // Assuming 1-minute candles (60 seconds)
  const candleDurationSeconds = 60;
  const driftPerSecond = meanReturnPerCandle / candleDurationSeconds;
  const volatilityPerSecond = volatilityPerCandle / Math.sqrt(candleDurationSeconds);

  return { drift: driftPerSecond, volatility: volatilityPerSecond };
}

/**
 * Gets GBM parameters, using a cache to avoid frequent recalculations.
 * @param candles - The full historical candle data.
 * @returns Cached or newly calculated GBM parameters.
 */
export function getGBMParams(candles: CandleData[]): { drift: number; volatility: number } {
  const now = Date.now();

  if (gbmCache && (now - gbmCache.lastUpdated < CACHE_TTL_MS) && gbmCache.candleCount === candles.length) {
    return { drift: gbmCache.drift, volatility: gbmCache.volatility };
  }

  if (isCalculatingGBM) {
    // Return stale cache if available while recalculating
    return gbmCache ? { drift: gbmCache.drift, volatility: gbmCache.volatility } : { drift: 0, volatility: 0.002 / Math.sqrt(60) };
  }

  isCalculatingGBM = true;
  try {
    const params = calibrateGBMParams(candles);
    gbmCache = {
      ...params,
      lastUpdated: now,
      candleCount: candles.length,
    };
    return params;
  } finally {
    isCalculatingGBM = false;
  }
}

/**
 * Resets the GBM parameter cache.
 */
export function resetGBMCache(): void {
  gbmCache = null;
}

// --- Part B: Optimal Duration Discovery ---

// This type definition must match the one in hf-backtest-engine.ts
interface TradeResult extends BaseTradeResult {
  durationInCandles: number;
  strategy: StrategyType;
}

export interface OptimalDuration {
  strategy: StrategyType;
  optimalSeconds: number;
  winRateByDuration: Record<number, { wins: number; total: number; winRate: number }>;
  sampleSize: number;
  lastCalibrated: number;
}

const DURATION_BUCKETS = [10, 20, 30, 45, 60, 90, 120, 180, 300];
const MIN_TRADES_FOR_OPTIMAL_CHOICE = 5;

const DEFAULT_DURATIONS: Record<StrategyType, number> = {
  HF_MEAN_REVERSION: 20,
  STD_TREND_FOLLOW: 180,
  BOLLINGER_SQUEEZE: 30,
  VOLUME_ABSORPTION: 120,
  MICROSTRUCTURE_SCALP: 10,
  GBM_20S: 20,
  GBM_40S: 40,
};

// Module-level storage for optimal durations
const optimalDurationStore = new Map<StrategyType, OptimalDuration>();
const rollingTradeHistory = new Map<StrategyType, { duration: number; result: 'win' | 'loss' }[]>();
const ROLLING_WINDOW_SIZE = 200;

function getClosestBucket(seconds: number): number {
  return DURATION_BUCKETS.reduce((prev, curr) => 
    (Math.abs(curr - seconds) < Math.abs(prev - seconds) ? curr : prev)
  );
}

/**
 * Analyzes backtest results to find the optimal trade duration for each strategy.
 * @param trades - Array of trade results from the backtest engine.
 * @param candleDurationSeconds - The duration of each candle in seconds.
 */
export function analyzeOptimalDuration(
  trades: TradeResult[],
  candleDurationSeconds: number
): Map<StrategyType, OptimalDuration> {
  const analysisByStrategy = new Map<StrategyType, { winRateByDuration: Record<number, { wins: number; total: number }> }>();
  const localOptimalDurationStore = new Map<StrategyType, OptimalDuration>();

  // Initialize map
  for (const key in DEFAULT_DURATIONS) {
    const strategy = key as StrategyType;
    analysisByStrategy.set(strategy, { winRateByDuration: {} });
  }

  // Populate data from trades
  for (const trade of trades) {
    if (!trade.strategy) continue;
    
    const analysis = analysisByStrategy.get(trade.strategy);
    if (!analysis) continue;
    
    const durationInSeconds = trade.durationInCandles * candleDurationSeconds;
    const bucket = getClosestBucket(durationInSeconds);

    if (!analysis.winRateByDuration[bucket]) {
      analysis.winRateByDuration[bucket] = { wins: 0, total: 0 };
    }
    
    analysis.winRateByDuration[bucket].total++;
    if (trade.result === 'win') {
      analysis.winRateByDuration[bucket].wins++;
    }
  }

  // Calculate win rates and find optimal duration
  for (const [strategy, data] of analysisByStrategy.entries()) {
    let optimalSeconds = DEFAULT_DURATIONS[strategy];
    let bestWinRate = -1;
    let totalSampleSize = 0;

    const winRateByDuration: OptimalDuration['winRateByDuration'] = {};

    for (const bucketStr in data.winRateByDuration) {
      const bucket = Number(bucketStr);
      const stats = data.winRateByDuration[bucket];
      totalSampleSize += stats.total;
      
      const winRate = stats.total > 0 ? (stats.wins / stats.total) * 100 : 0;
      winRateByDuration[bucket] = { ...stats, winRate };
      
      if (winRate > bestWinRate && stats.total >= MIN_TRADES_FOR_OPTIMAL_CHOICE) {
        bestWinRate = winRate;
        optimalSeconds = bucket;
      }
    }
    
    const optimalResult: OptimalDuration = {
      strategy,
      optimalSeconds,
      winRateByDuration,
      sampleSize: totalSampleSize,
      lastCalibrated: Date.now(),
    };
    
    localOptimalDurationStore.set(strategy, optimalResult);
    optimalDurationStore.set(strategy, optimalResult); // Also update the global store
  }
  
  return localOptimalDurationStore;
}

/**
 * Gets the discovered optimal duration for a strategy.
 * @param strategy - The strategy to query.
 * @returns The optimal duration in seconds, or a default value.
 */
export function getOptimalDuration(strategy: StrategyType): number {
  return optimalDurationStore.get(strategy)?.optimalSeconds ?? DEFAULT_DURATIONS[strategy];
}

/**
 * Updates the optimal duration analysis with live trading data.
 * @param strategy - The strategy of the completed trade.
 * @param durationInCandles - The duration of the trade.
 * @param result - The outcome of the trade.
 * @param candleDurationSeconds - The duration of each candle.
 */
export function updateOptimalDuration(
  strategy: StrategyType,
  durationInCandles: number,
  result: 'win' | 'loss',
  candleDurationSeconds: number
): void {
  if (!rollingTradeHistory.has(strategy)) {
    rollingTradeHistory.set(strategy, []);
  }

  const history = rollingTradeHistory.get(strategy)!;
  const duration = durationInCandles * candleDurationSeconds;
  history.push({ duration, result });

  if (history.length > ROLLING_WINDOW_SIZE) {
    history.shift();
  }
  
  const tempTrades: TradeResult[] = history.map((h) => ({
    result: h.result,
    durationInCandles: h.duration / candleDurationSeconds,
    strategy: strategy,
    pnl: 0,
    exitIndex: 0,
    exitPrice: 0,
    strikeZone: {} as any, // Cast to any to satisfy the type, as it's not needed for this analysis
  }));

  analyzeOptimalDuration(tempTrades, candleDurationSeconds);
}

/**
 * Gets a summary of the optimal duration findings for UI display.
 */
export function getOptimalDurationSummary(): Record<StrategyType, { optimal: number; winRate: number; sampleSize: number }> {
    const summary: Record<string, any> = {};
    for (const [strategy, data] of optimalDurationStore.entries()) {
        const optimalData = data.winRateByDuration[data.optimalSeconds];
        summary[strategy] = {
            optimal: data.optimalSeconds,
            winRate: optimalData?.winRate ?? 0,
            sampleSize: data.sampleSize,
        };
    }
    return summary as Record<StrategyType, { optimal: number; winRate: number; sampleSize: number }>;
}
