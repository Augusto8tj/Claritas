// src/features/trading/analytics/performance-metrics.ts
import { getHFTradeLogs, HFTradeLog } from '@/services/hf-data-service';
import type { StrategyType } from '../services/hf-strike-logic';
import type { MarketRegime } from '../ml/market-regime-detector';

export interface InstitutionalMetrics {
  totalReturn: number;
  cagr: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  totalTrades: number;
  avgTradesPerDay: number;
  avgHoldingTime: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  largestWin: number;
  largestLoss: number;
  strategyBreakdown: {
    strategy: StrategyType;
    trades: number;
    winRate: number;
    profitLoss: number;
    sharpe: number;
  }[];
  regimePerformance: {
    regime: MarketRegime;
    trades: number;
    winRate: number;
    profitLoss: number;
  }[];
}

// Dummy functions to be implemented
async function fetchTradesFromFirebase(userId: string, startDate: Date, endDate: Date): Promise<HFTradeLog[]> {
    return getHFTradeLogs(userId, 500); // Fetch last 500 trades as a proxy
}

function calculateEquityCurve(trades: HFTradeLog[], startCapital: number = 1000): number[] {
  const curve = [startCapital];
  trades.forEach(trade => {
    curve.push(curve[curve.length - 1] + (trade.execution.result || 0));
  });
  return curve;
}

function calculateMaxDrawdown(equity: number[]): number {
  if(equity.length === 0) return 0;
  let peak = equity[0];
  let maxDD = 0;
  
  equity.forEach(value => {
    if (value > peak) peak = value;
    const drawdown = peak > 0 ? ((peak - value) / peak) * 100 : 0;
    if (drawdown > maxDD) maxDD = drawdown;
  });
  return maxDD;
}

function calculateStrategyBreakdown(trades: HFTradeLog[]): InstitutionalMetrics['strategyBreakdown'] { return []; }
function calculateRegimePerformance(trades: HFTradeLog[]): InstitutionalMetrics['regimePerformance'] { return []; }
function calculateAvgHoldingTime(trades: HFTradeLog[]): number { return 0; }
function calculateMaxConsecutive(trades: HFTradeLog[], winning: boolean): number { return 0; }

function getEmptyMetrics(): InstitutionalMetrics {
    return {
        totalReturn:0, cagr:0, sharpeRatio:0, sortinoRatio:0, calmarRatio:0, maxDrawdown:0,
        winRate:0, profitFactor:0, avgWin:0, avgLoss:0, expectancy:0, totalTrades:0, avgTradesPerDay:0,
        avgHoldingTime:0, consecutiveWins:0, consecutiveLosses:0, largestWin:0, largestLoss:0,
        strategyBreakdown:[], regimePerformance:[],
    };
}


export async function calculateInstitutionalMetrics(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<InstitutionalMetrics> {
  const trades = await fetchTradesFromFirebase(userId, startDate, endDate);
  
  if (trades.length < 2) {
    return getEmptyMetrics();
  }
  
  const wins = trades.filter(t => t.execution.result !== undefined && t.execution.result > 0);
  const losses = trades.filter(t => t.execution.result !== undefined && t.execution.result < 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  
  const totalProfit = wins.reduce((sum, t) => sum + (t.execution.result || 0), 0);
  const totalLoss = Math.abs(losses.reduce((sum, t) => sum + (t.execution.result || 0), 0));
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;
  
  const avgWin = wins.length > 0 ? totalProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;
  const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;
  
  const returns = trades.map(t => (t.execution.result || 0) / t.strikeZone.entry.price);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

  const downsideReturns = returns.filter(r => r < 0);
  const downsideVariance = downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / (downsideReturns.length || 1);
  const downsideDeviation = Math.sqrt(downsideVariance);
  const sortinoRatio = downsideDeviation > 0 ? (avgReturn / downsideDeviation) * Math.sqrt(252) : 0;

  const equity = calculateEquityCurve(trades);
  const totalReturn = ((equity[equity.length - 1] - equity[0]) / equity[0]) * 100;
  const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
  const cagr = totalDays > 0 ? (Math.pow(1 + totalReturn / 100, 365 / totalDays) - 1) * 100 : 0;
  const maxDrawdown = calculateMaxDrawdown(equity);
  const calmarRatio = maxDrawdown > 0 ? cagr / maxDrawdown : 0;
  
  return {
    totalReturn, cagr, sharpeRatio, sortinoRatio, calmarRatio, maxDrawdown, winRate, profitFactor, avgWin,
    avgLoss, expectancy, totalTrades: trades.length, avgTradesPerDay: trades.length / Math.max(1, totalDays),
    avgHoldingTime: calculateAvgHoldingTime(trades),
    consecutiveWins: calculateMaxConsecutive(trades, true),
    consecutiveLosses: calculateMaxConsecutive(trades, false),
    largestWin: Math.max(...wins.map(t => t.execution.result || 0), 0),
    largestLoss: Math.min(...losses.map(t => t.execution.result || 0), 0),
    strategyBreakdown: calculateStrategyBreakdown(trades),
    regimePerformance: calculateRegimePerformance(trades),
  };
}
