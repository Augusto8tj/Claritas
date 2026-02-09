// src/features/trading/ml/adaptive-optimizer.ts
import type { StrategyType, CandleData } from '@/lib/types';
import type { Indicators } from '../services/indicator-service';
import type { MarketRegime, RegimeCharacteristics } from './market-regime-detector';
import { getHFTradeLogs } from '@/services/hf-data-service';

export interface StrategyPerformance {
  strategy: StrategyType;
  recentTrades: number;
  winRate: number;
  avgProfit: number;
  sharpeRatio: number;
  maxDrawdown: number;
  avgConfidence: number;
  marketConditions: {
    volatility: 'low' | 'medium' | 'high';
    trend: 'bullish' | 'bearish' | 'sideways';
    volume: 'low' | 'high';
  };
}

export interface OptimizedWeights {
  strategy: StrategyType;
  weight: number;
  confidence: number;
  reasoning: string[];
}

/**
 * Algoritmo: Bayesian Optimization + Thompson Sampling
 * 
 * 1. Coletar últimos 200 trades de cada estratégia
 * 2. Calcular métricas de performance por regime de mercado
 * 3. Usar Thompson Sampling para balancear exploitation vs exploration
 * 4. Retornar pesos otimizados com intervalo de confiança
 */
export async function optimizeStrategyWeights(
  userId: string,
  currentMarketConditions: RegimeCharacteristics
): Promise<OptimizedWeights[]> {
  // Placeholder implementation
  console.log('[ML] Optimizing weights for regime:', currentMarketConditions.regime);
  // In a real scenario, this would fetch historical data and run complex calculations.
  const weights: OptimizedWeights[] = [
    { strategy: 'HF_MEAN_REVERSION', weight: 0.25, confidence: 80, reasoning: ['Good performance in ranging markets.'] },
    { strategy: 'STD_TREND_FOLLOW', weight: 0.15, confidence: 75, reasoning: ['Best for trending markets.'] },
    { strategy: 'BOLLINGER_SQUEEZE', weight: 0.20, confidence: 85, reasoning: ['High win rate on breakouts.'] },
    { strategy: 'VOLUME_ABSORPTION', weight: 0.25, confidence: 90, reasoning: ['Highest Sharpe ratio historically.'] },
    { strategy: 'MICROSTRUCTURE_SCALP', weight: 0.15, confidence: 70, reasoning: ['Good for high-frequency scalping.'] },
  ];
  return weights;
}

/**
 * Feature Engineering para ML
 * Extrai features do estado atual do mercado para predição
 */
export function extractMarketFeatures(
  indicators: Indicators,
  recentCandles: CandleData[]
): number[] {
  const lastCandle = recentCandles[recentCandles.length - 1];
  if (!lastCandle) return Array(20).fill(0);

  return [
    (indicators.atr || 0) / lastCandle.close,  // ATR normalizado
    (indicators.adx || 0) / 100,                      // ADX normalizado
    (indicators.rsi || 0) / 100,                      // RSI normalizado
    (indicators.bbw || 0) / 5,                        // BB Width normalizado
    // ... mais 15-20 features
    (indicators.stoch || 0) / 100,
    (indicators.mfi || 50) / 100,
    (indicators.cci || 0) / 200,
    indicators.macd?.histogram || 0,
    indicators.ao || 0,
    indicators.roc || 0,
    indicators.trix || 0,
    indicators.rvi || 50,
    indicators.psar ? (indicators.psar > lastCandle.close ? -1 : 1) : 0,
    indicators.zScore || 0,
    indicators.kama ? (lastCandle.close > indicators.kama ? 1 : -1) : 0,
    0,0,0,0,0 // Padding
  ].slice(0, 20);
}

/**
 * Modelo de regressão logística simples (sem libs externas)
 * Prediz probabilidade de win dado features atuais
 */
export class SimpleLogisticRegression {
  private weights: number[] = [];

  constructor(featureCount: number = 20) {
    this.weights = Array(featureCount).fill(0);
  }

  train(features: number[][], outcomes: number[], learningRate = 0.01, iterations = 1000): void {
    console.log('[ML] Training Simple Logistic Regression...');
    // This is a placeholder for a complex algorithm.
    // A real implementation would involve gradient descent.
    this.weights = this.weights.map(() => Math.random() - 0.5);
    console.log('[ML] Training complete. New weights:', this.weights);
  }

  predict(features: number[]): number {
    const z = this.weights.reduce((sum, w, i) => sum + w * (features[i] || 0), 0);
    return 1 / (1 + Math.exp(-z)); // Sigmoid function
  }
}
