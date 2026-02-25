// src/features/trading/optimization/vagalume-auto-calibrator.ts
'use client';

import type { TickData, Operation } from '@/lib/types';
import type { VagalumeConfig } from '../hooks/use-vagalume-alternante';
import { calculateDigitStatsForWindow } from '../services/digits-analysis';
import { calculateAdvancedSignalScore } from '../services/digit-indicators';

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
 * 
 * Lógica:
 * 1. Para cada tick, calcula signal do Vagalume
 * 2. Se shouldTrade = true, simula entrada
 * 3. Calcula resultado baseado no próximo tick
 * 4. Atualiza estado da máquina (W1 → L1 → W2 → Reset)
 * 5. Repete até fim dos dados
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
  
  // Payouts (retorno líquido)
  const PAYOUTS = {
    DIGITEVEN: 0.95,
    DIGITODD: 0.95,
    DIGITOVER: 0.95,
    DIGITUNDER: 0.95,
  };

  // Itera pelos ticks (deixa margem para análise)
  for (let i = 200; i < ticks.length - 1; i++) {
    // --- 1. ANÁLISE DO TICK ATUAL ---
    const windowSize = (vagalumeState === 'W1' || vagalumeState === 'L1') ? 50 : 200;
    if (i < windowSize) continue;

    const ticksForAnalysis = config.usePredictiveAnalysis 
      ? ticks.slice(i - windowSize, i) 
      : ticks.slice(i - windowSize + 1, i + 1);
    
    const analysis = calculateDigitStatsForWindow(ticksForAnalysis, windowSize, decimalPlaces);
    
    // --- 2. DECISÃO DE TRADE ---
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
          if (analysis.probOver4 > 0.52) {
            suggestedContract = 'DIGITOVER';
            suggestedDigit = 4;
          } else {
            suggestedContract = 'DIGITUNDER';
            suggestedDigit = 5;
          }
          confidence = 0.52;
          shouldTrade = true;
        }
        break;
    }

    if (!shouldTrade || !suggestedContract) continue;

    // --- 3. FILTRAGEM POR ADVANCED SCORE ---
    const advancedScore = calculateAdvancedSignalScore(ticksForAnalysis, confidence, decimalPlaces);
    
    if (advancedScore.recommendation === 'AVOID' || advancedScore.recommendation === 'NEUTRAL') {
      continue; // Pula trade em condições ruins
    }

    // Ajusta confidence por regime
    let adjustedConfidence = confidence;
    if (advancedScore.regime.type === 'RANGING') {
      adjustedConfidence = Math.min(0.95, confidence * 1.10);
    } else if (advancedScore.regime.type === 'CHAOTIC') {
      adjustedConfidence = Math.max(0.50, confidence * 0.80);
    }

    // --- 4. CALCULA STAKE (com multiplicador de reset) ---
    const stakeMultiplier = (vagalumeState === 'W2' || vagalumeState === 'L2') ? config.resetMultiplier : 1.0;
    const finalStake = baseStake * stakeMultiplier;

    // --- 5. SIMULA RESULTADO (baseado no próximo tick) ---
    const nextTick = ticks[i + 1];
    const nextLastDigit = parseInt(nextTick.price.toFixed(decimalPlaces).slice(-1), 10);

    let isWin = false;
    switch (suggestedContract) {
      case 'DIGITEVEN':
        isWin = nextLastDigit % 2 === 0;
        break;
      case 'DIGITODD':
        isWin = nextLastDigit % 2 === 1;
        break;
      case 'DIGITOVER':
        isWin = nextLastDigit > (suggestedDigit ?? 4);
        break;
      case 'DIGITUNDER':
        isWin = nextLastDigit < (suggestedDigit ?? 5);
        break;
    }

    const payout = PAYOUTS[suggestedContract];
    const result = isWin ? finalStake * payout : -finalStake;

    // --- 6. REGISTRA TRADE ---
    trades.push({
      epoch: ticks[i].epoch,
      contract: suggestedContract,
      digit: suggestedDigit,
      stake: finalStake,
      confidence: adjustedConfidence,
      result,
      state: vagalumeState,
    });

    // --- 7. ATUALIZA ESTADO DA MÁQUINA ---
    switch (vagalumeState) {
      case 'W1':
        vagalumeState = isWin ? 'L1' : 'W1';
        break;
      case 'L1':
        vagalumeState = isWin ? 'W1' : 'W2';
        break;
      case 'W2':
        if (isWin) {
          failedResets++;
          vagalumeState = 'L1';
        } else {
          failedResets = 0;
          vagalumeState = 'W1';
        }
        break;
      case 'L2':
        if (!isWin) {
          failedResets++;
          vagalumeState = 'W1';
        } else {
          failedResets = 0;
          vagalumeState = 'L1';
        }
        break;
    }

    // Pausa por failedResets (como no real)
    if (failedResets >= config.pauseAfterFailedResets) {
      // Calcula alternance rate dos últimos 20 trades
      const recentTrades = trades.slice(-20);
      if (recentTrades.length >= 2) {
        const alternances = recentTrades.slice(1).filter((t, idx) => 
          (recentTrades[idx].result > 0) !== (t.result > 0)
        ).length;
        const alternanceRate = (alternances / (recentTrades.length - 1)) * 100;
        
        if (alternanceRate < 60) {
          // Pausa por 10 ticks
          i += 10;
          failedResets = 0;
          vagalumeState = 'W1';
        }
      }
    }
  }

  // --- 8. CALCULA MÉTRICAS ---
  const metrics = calculateMetrics(trades);

  return { trades, metrics };
}

// ============================================================================
// 3. CÁLCULO DE MÉTRICAS
// ============================================================================

function calculateMetrics(trades: SimulatedTrade[]): CalibrationMetrics {
  if (trades.length === 0) {
    return {
      winRate: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      totalPnl: 0,
      totalTrades: 0,
      avgWin: 0,
      avgLoss: 0,
      consecutiveLosses: 0,
    };
  }

  const wins = trades.filter(t => t.result > 0);
  const losses = trades.filter(t => t.result < 0);

  const totalPnl = trades.reduce((sum, t) => sum + t.result, 0);
  const winRate = (wins.length / trades.length) * 100;

  const totalWin = wins.reduce((sum, t) => sum + t.result, 0);
  const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.result, 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : 0;

  const avgWin = wins.length > 0 ? totalWin / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;

  // Sharpe Ratio (simplificado: retorno médio / desvio padrão dos retornos)
  const returns = trades.map(t => t.result);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Anualizado

  // Max Drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let cumPnl = 0;
  for (const trade of trades) {
    cumPnl += trade.result;
    if (cumPnl > peak) peak = cumPnl;
    const drawdown = ((peak - cumPnl) / Math.max(peak, 0.01)) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Consecutive Losses
  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;
  for (const trade of trades) {
    if (trade.result < 0) {
      consecutiveLosses++;
      if (consecutiveLosses > maxConsecutiveLosses) {
        maxConsecutiveLosses = consecutiveLosses;
      }
    } else {
      consecutiveLosses = 0;
    }
  }

  return {
    winRate,
    profitFactor,
    sharpeRatio,
    maxDrawdown,
    totalPnl,
    totalTrades: trades.length,
    avgWin,
    avgLoss,
    consecutiveLosses: maxConsecutiveLosses,
  };
}

// ============================================================================
// 4. GRID SEARCH PARA CALIBRAÇÃO
// ============================================================================

export interface ParameterSpace {
  resetMultiplier: number[];
  pauseAfterFailedResets: number[];
  // Adicione outros parâmetros se necessário
}

export interface CalibrationResult {
  bestConfig: VagalumeConfig;
  bestMetrics: CalibrationMetrics;
  allResults: Array<{ config: VagalumeConfig; metrics: CalibrationMetrics; score: number }>;
}

/**
 * Testa diferentes combinações de parâmetros via grid search
 * 
 * Função objetivo: Sharpe Ratio * Profit Factor - MaxDrawdown/10
 */
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

  // Grid search
  for (const resetMult of parameterSpace.resetMultiplier) {
    for (const pauseAfter of parameterSpace.pauseAfterFailedResets) {
      // A única combinação que falta aqui é o kellyFraction, que está fixo no config.
      // Se precisássemos iterar sobre ele, adicionaríamos outro loop.
      const config: VagalumeConfig = {
        maxStreak: 2,
        stateW1_matchThreshold: 8,
        stateL1_differsThreshold: 15,
        resetMultiplier: resetMult,
        pauseAfterFailedResets: pauseAfter,
        kellyFraction: 0.25, // Fixo para esta calibração
        usePredictiveAnalysis: true,
        ...baseConfig,
      };

      const { metrics } = simulateVagalume(ticks, config, decimalPlaces);
      
      // Função objetivo (maximizar)
      const score = 
        metrics.sharpeRatio * 2 +              // Prioriza Sharpe
        metrics.profitFactor * 1.5 -           // Prioriza Profit Factor
        metrics.maxDrawdown / 10 +             // Penaliza Drawdown
        (metrics.winRate / 100) * 2;           // Prioriza Win Rate

      allResults.push({ config, metrics, score });

      if (score > bestScore) {
        bestScore = score;
        bestConfig = config;
        bestMetrics = metrics;
      }
    }
  }

  // Ordena por score (melhor primeiro)
  allResults.sort((a, b) => b.score - a.score);

  return {
    bestConfig: bestConfig!,
    bestMetrics: bestMetrics!,
    allResults,
  };
}

// ============================================================================
// 5. FUNÇÃO AUXILIAR PARA COMPARAÇÃO
// ============================================================================

/**
 * Compara configuração atual vs configuração otimizada
 */
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

  return {
    current,
    optimized,
    improvement: {
      winRate: ((optimized.winRate - current.winRate) / current.winRate) * 100,
      profitFactor: ((optimized.profitFactor - current.profitFactor) / current.profitFactor) * 100,
      sharpeRatio: ((optimized.sharpeRatio - current.sharpeRatio) / Math.abs(current.sharpeRatio)) * 100,
      maxDrawdown: ((current.maxDrawdown - optimized.maxDrawdown) / current.maxDrawdown) * 100, // Redução é positiva
      totalPnl: ((optimized.totalPnl - current.totalPnl) / Math.abs(current.totalPnl)) * 100,
    },
  };
}
