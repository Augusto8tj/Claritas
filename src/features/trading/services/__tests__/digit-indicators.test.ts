// src/features/trading/services/__tests__/digit-indicators.test.ts
import { describe, it, expect } from 'vitest';
import type { TickData } from '@/lib/types';
import {
  calculateMomentum,
  calculateVolatility,
  detectRegime,
  calculateAdvancedSignalScore,
  type MomentumIndicators,
  type VolatilityIndicators,
  type MarketRegime,
} from '../digit-indicators';

// ============================================================================
// MOCK DATA GENERATORS
// ============================================================================

function generateRangingTicks(count: number): TickData[] {
  const ticks: TickData[] = [];
  const basePrice = 1000.45;
  let epoch = Math.floor(Date.now() / 1000);

  for (let i = 0; i < count; i++) {
    // Oscila entre 1000.44 e 1000.46 (dígitos 4-5-6)
    const offset = (i % 3 - 1) * 0.01;
    ticks.push({
      epoch: epoch++,
      price: basePrice + offset,
    });
  }

  return ticks;
}

function generateTrendingTicks(count: number, direction: 'up' | 'down'): TickData[] {
  const ticks: TickData[] = [];
  let price = 1000.00;
  let epoch = Math.floor(Date.now() / 1000);

  for (let i = 0; i < count; i++) {
    const increment = direction === 'up' ? 0.01 : -0.01;
    price += increment;
    ticks.push({
      epoch: epoch++,
      price,
    });
  }

  return ticks;
}

function generateChaoticTicks(count: number): TickData[] {
  const ticks: TickData[] = [];
  let epoch = Math.floor(Date.now() / 1000);

  for (let i = 0; i < count; i++) {
    // Variação aleatória alta (dígitos 0-9)
    const lastDigit = Math.floor(Math.random() * 10);
    const price = 1000.00 + (lastDigit / 100);
    ticks.push({
      epoch: epoch++,
      price,
    });
  }

  return ticks;
}

// ============================================================================
// MOMENTUM TESTS
// ============================================================================

describe('calculateMomentum', () => {
  it('should return zero momentum for ranging market', () => {
    const ticks = generateRangingTicks(100);
    const momentum = calculateMomentum(ticks, 10, 50, 2);

    expect(momentum.digitMomentum).toBeCloseTo(0, 1);
    expect(momentum.trendStrength).toBeLessThan(0.7);
  });

  it('should return positive momentum for uptrend', () => {
    const ticks = generateTrendingTicks(100, 'up');
    const momentum = calculateMomentum(ticks, 10, 50, 2);

    expect(momentum.digitMomentum).toBeGreaterThan(0);
    expect(momentum.trendStrength).toBeGreaterThan(0.6);
  });

  it('should return negative momentum for downtrend', () => {
    const ticks = generateTrendingTicks(100, 'down');
    const momentum = calculateMomentum(ticks, 10, 50, 2);

    expect(momentum.digitMomentum).toBeLessThan(0);
    expect(momentum.trendStrength).toBeGreaterThan(0.6);
  });

  it('should clamp momentum between -1 and 1', () => {
    const ticks = generateTrendingTicks(100, 'up');
    const momentum = calculateMomentum(ticks, 5, 20, 2);

    expect(momentum.digitMomentum).toBeGreaterThanOrEqual(-1);
    expect(momentum.digitMomentum).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// VOLATILITY TESTS
// ============================================================================

describe('calculateVolatility', () => {
  it('should detect LOW volatility in ranging market', () => {
    const ticks = generateRangingTicks(100);
    const volatility = calculateVolatility(ticks, 20, 2);

    expect(volatility.volatilityRegime).toBe('LOW');
    expect(volatility.digitVolatility).toBeLessThan(2.5);
  });

  it('should detect HIGH volatility in chaotic market', () => {
    const ticks = generateChaoticTicks(100);
    const volatility = calculateVolatility(ticks, 20, 2);

    expect(volatility.volatilityRegime).toBe('HIGH');
    expect(volatility.digitVolatility).toBeGreaterThan(3.0);
  });

  it('should calculate ATR correctly', () => {
    const ticks = generateRangingTicks(50);
    const volatility = calculateVolatility(ticks, 20, 2);

    expect(volatility.atr).toBeGreaterThan(0);
    expect(volatility.atr).toBeLessThan(5); // Máximo esperado para dígitos
  });

  it('should detect expanding volatility', () => {
    const ticks: TickData[] = [
      ...generateRangingTicks(30), // Baixa volatilidade inicial
      ...generateChaoticTicks(30),  // Alta volatilidade recente
    ];

    const volatility = calculateVolatility(ticks, 60, 2);
    expect(volatility.isExpanding).toBe(true);
  });
});

// ============================================================================
// REGIME DETECTION TESTS
// ============================================================================

describe('detectRegime', () => {
  it('should detect RANGING regime', () => {
    const ticks = generateRangingTicks(100);
    const momentum = calculateMomentum(ticks, 10, 50, 2);
    const volatility = calculateVolatility(ticks, 20, 2);
    const regime = detectRegime(momentum, volatility);

    expect(regime.type).toBe('RANGING');
    expect(regime.confidence).toBeGreaterThan(0.6);
  });

  it('should detect TRENDING regime for uptrend', () => {
    const ticks = generateTrendingTicks(100, 'up');
    const momentum = calculateMomentum(ticks, 10, 50, 2);
    const volatility = calculateVolatility(ticks, 20, 2);
    const regime = detectRegime(momentum, volatility);

    expect(regime.type).toBe('TRENDING');
    expect(regime.isTrendingUp).toBe(true);
    expect(regime.isTrendingDown).toBe(false);
  });

  it('should detect CHAOTIC regime', () => {
    const ticks = generateChaoticTicks(100);
    const momentum = calculateMomentum(ticks, 10, 50, 2);
    const volatility = calculateVolatility(ticks, 20, 2);
    const regime = detectRegime(momentum, volatility);

    expect(regime.type).toBe('CHAOTIC');
    expect(regime.confidence).toBeLessThan(0.5);
  });
});

// ============================================================================
// ADVANCED SIGNAL SCORE TESTS
// ============================================================================

describe('calculateAdvancedSignalScore', () => {
  it('should boost score in RANGING market', () => {
    const ticks = generateRangingTicks(100);
    const baseConfidence = 0.65;
    const score = calculateAdvancedSignalScore(ticks, baseConfidence, 2);

    expect(score.rawScore).toBe(65);
    expect(score.adjustedScore).toBeGreaterThan(score.rawScore); // Boost de 15%
    expect(score.recommendation).toBe('BUY');
  });

  it('should penalize score in CHAOTIC market', () => {
    const ticks = generateChaoticTicks(100);
    const baseConfidence = 0.65;
    const score = calculateAdvancedSignalScore(ticks, baseConfidence, 2);

    expect(score.adjustedScore).toBeLessThan(score.rawScore); // Penalização
    expect(score.recommendation).toBe('AVOID');
  });

  it('should recommend STRONG_BUY for high confidence in RANGING', () => {
    const ticks = generateRangingTicks(100);
    const baseConfidence = 0.75;
    const score = calculateAdvancedSignalScore(ticks, baseConfidence, 2);

    expect(score.recommendation).toBe('STRONG_BUY');
    expect(score.adjustedScore).toBeGreaterThanOrEqual(75);
  });

  it('should track analysis time', () => {
    const ticks = generateRangingTicks(100);
    const score = calculateAdvancedSignalScore(ticks, 0.65, 2);

    expect(score.analysisTime).toBeGreaterThan(0);
    expect(score.analysisTime).toBeLessThan(100); // Deve ser rápido (<100ms)
  });

  it('should clamp adjusted score between 0 and 100', () => {
    const ticks = generateRangingTicks(100);
    const baseConfidence = 0.95;
    const score = calculateAdvancedSignalScore(ticks, baseConfidence, 2);

    expect(score.adjustedScore).toBeGreaterThanOrEqual(0);
    expect(score.adjustedScore).toBeLessThanOrEqual(100);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration: Full workflow', () => {
  it('should process complete analysis pipeline', () => {
    const ticks = generateRangingTicks(200);
    const baseConfidence = 0.70;

    // Step 1: Momentum
    const momentum = calculateMomentum(ticks, 10, 50, 2);
    expect(momentum).toBeDefined();

    // Step 2: Volatility
    const volatility = calculateVolatility(ticks, 20, 2);
    expect(volatility).toBeDefined();

    // Step 3: Regime
    const regime = detectRegime(momentum, volatility);
    expect(regime.type).toBe('RANGING');

    // Step 4: Combined Score
    const score = calculateAdvancedSignalScore(ticks, baseConfidence, 2);
    expect(score.regime.type).toBe('RANGING');
    expect(score.recommendation).toMatch(/BUY|STRONG_BUY/);
  });
});
