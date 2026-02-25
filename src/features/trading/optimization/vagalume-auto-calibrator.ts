// src/features/trading/optimization/vagalume-auto-calibrator.ts
'use client';

import type { TickData, Operation } from '@/lib/types';
import type { VagalumeConfig } from '../hooks/use-vagalume-alternante';
import { calculateDigitStatsForWindow } from '../services/digits-analysis';
import { calculateAdvancedSignalScore } from '../services/digit-indicators';
import { DigitContractType } from '../hooks/use-vagalume-alternante';

// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

export interface CalibrationMetrics {
  winRate: number;           // % de trades vencedores
  profitFactor: number;      // Lucro total / Perda total
  sharpeRatio: number;       // Retorno / Volatilidade
  maxDrawdown: number;       // Maior perda acumulada (%)
  totalPnl: number;          // Lucro/Prejuízo líquido
  totalTrades: number;       // Número de trades executados
  avgWin: number;            // Média de ganhos
  avgLoss: number;           // Média de perdas
  consecutiveLosses: number; // Maior sequência de perdas
}

export interface SimulatedTrade {
  epoch: number;
  contract: 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER';
  digit?: number;
  stake: number;
  confidence: number;
  result: number; // Positivo = lucro, Negativo = perda
  state: 'W1' | 'L1' | 'W2' | 'L2';
}

// ============================================================================
// 2. SIMULAÇÃO DO VAGALUME (CORE FUNCTION)
// ============================================================================

/**
 * Simula Vagalume em histórico de ticks
 */
function simulateVagalume(
  ticks: TickData[],
  config: VagalumeConfig,
  decimalPlaces: number,
  baseStake: number = 0.35
): { trades: SimulatedTrade[]; metrics: CalibrationMetrics } {
  
  const trades: SimulatedTrade[] = [];
  let vagalumeState: 'W1' | 'L1' | 'W2' | 'L2' = 'W1';
  let failedResets = 0;
  
  const PAYOUTS = {
    DIGITEVEN: 0.95,
    DIGITODD: 0.95,
    DIGITOVER: 0.95,
    DIGITUNDER: 0.95,
  };

  for (let i = 200; i < ticks.length - 1; i++) {
    const windowSize = (vagalumeState === 'W1' || vagalumeState === 'L1') ? 50 : 200;
    if (i < windowSize) continue;

    const ticksForAnalysis = config.usePredictiveAnalysis 
      ? ticks.slice(i - windowSize, i) 
      : ticks.slice(i - windowSize + 1, i + 1);
    
    const analysis = calculateDigitStatsForWindow(ticksForAnalysis, windowSize, decimalPlaces);
    
    let suggestedContract: 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | null = null;
    let suggestedDigit: number | undefined;
    let confidence = 0.5;
    let shouldTrade = false;
    
    switch (vagalumeState) {
      case 'W1':
        if (analysis.probEven < 0.49) {
          suggestedContract = 'DIGITODD';
          confidence = Math.min(0.95, 0.5 + (0.5 - analysis.probEven));
          shouldTrade = confidence > 0.51;
        } else if (analysis.probEven > 0.51) {
          suggestedContract = 'DIGITEVEN';
          confidence = Math.min(0.95, 0.5 + (analysis.probEven - 0.5));
          shouldTrade = confidence > 0.51;
        }
        break;
      case 'L1':
        if (analysis.probOver4 > 0.51) {
          suggestedContract = 'DIGITOVER';
          suggestedDigit = 4;
          confidence = 0.5 + (analysis.probOver4 - 0.5);
          shouldTrade = confidence > 0.51;
        } else if (analysis.probUnder5 > 0.51) {
          suggestedContract = 'DIGITUNDER';
          suggestedDigit = 5;
          confidence = 0.5 + (analysis.probUnder5 - 0.5);
          shouldTrade = confidence > 0.51;
        }
        break;
      case 'W2':
      case 'L2':
        if (analysis.probEven > 0.55) {
          suggestedContract = 'DIGITEVEN';
          confidence = 0.5 + (analysis.probEven - 0.5);
          shouldTrade = true;
        } else if (analysis.probEven < 0.45) {
          suggestedContract = 'DIGITODD';
          confidence = 0.5 + (0.5 - analysis.probEven);
          shouldTrade = true;
        } else {
          suggestedContract = analysis.probOver4 > 0.52 ? 'DIGITOVER' : 'DIGITUNDER';
          suggestedDigit = analysis.probOver4 > 0.52 ? 4 : 5;
          confidence = 0.52;
          shouldTrade = true;
        }
        break;
    }

    if (!shouldTrade || !suggestedContract) continue;

    const advancedScore = calculateAdvancedSignalScore(ticksForAnalysis, confidence, decimalPlaces);
    if (advancedScore.recommendation === 'AVOID' || advancedScore.recommendation === 'NEUTRAL') continue;

    let adjustedConfidence = confidence;
    if (advancedScore.regime.type === 'RANGING') adjustedConfidence *= 1.10;
    else if (advancedScore.regime.type === 'CHAOTIC') adjustedConfidence *= 0.80;
    
    const stakeMultiplier = (vagalumeState === 'W2' || vagalumeState === 'L2') ? config.resetMultiplier : 1.0;
    const finalStake = baseStake * stakeMultiplier;

    const nextTick = ticks[i + 1];
    const lastDigit = parseInt(nextTick.price.toFixed(decimalPlaces).slice(-1), 10);

    let isWin = false;
    switch (suggestedContract) {
      case 'DIGITEVEN': isWin = lastDigit % 2 === 0; break;
      case 'DIGITODD': isWin = lastDigit % 2 !== 0; break;
      case 'DIGITOVER': isWin = lastDigit > (suggestedDigit ?? 4); break;
      case 'DIGITUNDER': isWin = lastDigit < (suggestedDigit ?? 5); break;
    }

    const payout = PAYOUTS[suggestedContract];
    const result = isWin ? finalStake * payout : -finalStake;

    trades.push({
      epoch: ticks[i].epoch,
      contract: suggestedContract,
      digit: suggestedDigit,
      stake: finalStake,
      confidence: adjustedConfidence,
      result,
      state: vagalumeState,
    });

    switch (vagalumeState) {
      case 'W1': vagalumeState = isWin ? 'L1' : 'W1'; break;
      case 'L1': vagalumeState = isWin ? 'W1' : 'W2'; break;
      case 'W2':
        if (isWin) { failedResets++; vagalumeState = 'L1'; } 
        else { failedResets = 0; vagalumeState = 'W1'; }
        break;
      case 'L2':
        if (!isWin) { failedResets++; vagalumeState = 'W1'; } 
        else { failedResets = 0; vagalumeState = 'L1'; }
        break;
    }

    if (failedResets >= config.pauseAfterFailedResets) {
      const recentTrades = trades.slice(-20);
      if (recentTrades.length >= 2) {
        const alternances = recentTrades.slice(1).filter((t, idx) => (recentTrades[idx].result > 0) !== (t.result > 0)).length;
        if ((alternances / (recentTrades.length - 1)) < 0.6) {
          i += 10;
          failedResets = 0;
          vagalumeState = 'W1';
        }
      }
    }
  }

  return { trades, metrics: calculateMetrics(trades) };
}

// ============================================================================
// 3. CÁLCULO DE MÉTRICAS
// ============================================================================

function calculateMetrics(trades: SimulatedTrade[]): CalibrationMetrics {
  if (trades.length === 0) {
    return { winRate: 0, profitFactor: 0, sharpeRatio: 0, maxDrawdown: 0, totalPnl: 0, totalTrades: 0, avgWin: 0, avgLoss: 0, consecutiveLosses: 0 };
  }

  const wins = trades.filter(t => t.result > 0);
  const losses = trades.filter(t => t.result < 0);
  const totalPnl = trades.reduce((sum, t) => sum + t.result, 0);
  const winRate = (wins.length / trades.length) * 100;
  const totalWin = wins.reduce((sum, t) => sum + t.result, 0);
  const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.result, 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : Infinity;
  const avgWin = wins.length > 0 ? totalWin / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;

  const returns = trades.map(t => t.result);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

  let peak = 0, maxDrawdown = 0, cumPnl = 0;
  for (const trade of trades) {
    cumPnl += trade.result;
    if (cumPnl > peak) peak = cumPnl;
    const drawdown = ((peak - cumPnl) / Math.max(peak, 0.01)) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  let consecutiveLosses = 0, maxConsecutiveLosses = 0;
  for (const trade of trades) {
    if (trade.result < 0) {
      consecutiveLosses++;
      if (consecutiveLosses > maxConsecutiveLosses) maxConsecutiveLosses = consecutiveLosses;
    } else {
      consecutiveLosses = 0;
    }
  }

  return { winRate, profitFactor, sharpeRatio, maxDrawdown, totalPnl, totalTrades: trades.length, avgWin, avgLoss, consecutiveLosses: maxConsecutiveLosses };
}

// ============================================================================
// 4. GRID SEARCH PARA CALIBRAÇÃO
// ============================================================================

export interface ParameterSpace {
  resetMultiplier: number[];
  pauseAfterFailedResets: number[];
}

export interface CalibrationResult {
  bestConfig: VagalumeConfig;
  bestMetrics: CalibrationMetrics;
  allResults: Array<{ config: VagalumeConfig; metrics: CalibrationMetrics; score: number }>;
}

export function autoCalibrate(
  ticks: TickData[],
  decimalPlaces: number,
  baseConfig: Partial<VagalumeConfig> = {},
  parameterSpace: ParameterSpace = {
    resetMultiplier: [1.1, 1.2, 1.3, 1.5],
    pauseAfterFailedResets: [2, 3, 4],
  }
): CalibrationResult {
  
  const allResults: Array<{ config: VagalumeConfig; metrics: CalibrationMetrics; score: number }> = [];
  let bestConfig: VagalumeConfig | null = null;
  let bestMetrics: CalibrationMetrics | null = null;
  let bestScore = -Infinity;

  for (const resetMult of parameterSpace.resetMultiplier) {
    for (const pauseAfter of parameterSpace.pauseAfterFailedResets) {
      const config: VagalumeConfig = {
        maxStreak: 2,
        stateW1_matchThreshold: 8,
        stateL1_differsThreshold: 15,
        resetMultiplier: resetMult,
        pauseAfterFailedResets: pauseAfter,
        kellyFraction: 0.25,
        usePredictiveAnalysis: true,
        ...baseConfig,
      };

      const { metrics } = simulateVagalume(ticks, config, decimalPlaces);
      const score = metrics.sharpeRatio * 2 + metrics.profitFactor * 1.5 - metrics.maxDrawdown / 10 + (metrics.winRate / 100) * 2;

      allResults.push({ config, metrics, score });

      if (score > bestScore) {
        bestScore = score;
        bestConfig = config;
        bestMetrics = metrics;
      }
    }
  }

  allResults.sort((a, b) => b.score - a.score);

  if (!bestConfig || !bestMetrics) throw new Error("A calibração falhou em produzir um resultado.");

  return { bestConfig, bestMetrics, allResults };
}

// ============================================================================
// 5. FUNÇÃO AUXILIAR PARA COMPARAÇÃO
// ============================================================================
export function compareConfigs(
  ticks: TickData[],
  currentConfig: VagalumeConfig,
  optimizedConfig: VagalumeConfig,
  decimalPlaces: number
): {
  current: CalibrationMetrics;
  optimized: CalibrationMetrics;
  improvement: {
    winRate: number;
    profitFactor: number;
    sharpeRatio: number;
    maxDrawdown: number;
    totalPnl: number;
  };
} {
  const { metrics: current } = simulateVagalume(ticks, currentConfig, decimalPlaces);
  const { metrics: optimized } = simulateVagalume(ticks, optimizedConfig, decimalPlaces);

  const calculateImprovement = (opt: number, curr: number) => curr !== 0 ? ((opt - curr) / Math.abs(curr)) * 100 : opt > 0 ? Infinity : 0;

  return {
    current,
    optimized,
    improvement: {
      winRate: calculateImprovement(optimized.winRate, current.winRate),
      profitFactor: calculateImprovement(optimized.profitFactor, current.profitFactor),
      sharpeRatio: calculateImprovement(optimized.sharpeRatio, current.sharpeRatio),
      maxDrawdown: calculateImprovement(current.maxDrawdown, optimized.maxDrawdown), // Invertido
      totalPnl: calculateImprovement(optimized.totalPnl, current.totalPnl),
    },
  };
}
