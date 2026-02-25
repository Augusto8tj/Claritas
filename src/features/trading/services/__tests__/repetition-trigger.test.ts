// src/features/trading/services/__tests__/repetition-trigger.test.ts
import { describe, it, expect } from 'vitest';
import type { TickData } from '@/lib/types';
import {
  calculateMomentum,
  calculateVolatility,
  detectRegime,
  calculateAdvancedSignalScore,
} from '../digit-indicators';
import { decideNextStake, type SmartMartingaleConfig, type BankrollState } from '../smart-stake-manager-digits';

// ============================================================================
// MOCK DATA GENERATORS
// ============================================================================

function generateRangingTicks(count: number): TickData[] {
  const ticks: TickData[] = [];
  const basePrice = 1000.45;
  let epoch = Math.floor(Date.now() / 1000);
  for (let i = 0; i < count; i++) {
    const offset = (i % 3 - 1) * 0.01;
    ticks.push({ epoch: epoch++, price: basePrice + offset });
  }
  return ticks;
}

function generateChaoticTicks(count: number): TickData[] {
  const ticks: TickData[] = [];
  let epoch = Math.floor(Date.now() / 1000);
  for (let i = 0; i < count; i++) {
    const lastDigit = Math.floor(Math.random() * 10);
    const price = 1000.00 + (lastDigit / 100);
    ticks.push({ epoch: epoch++, price: price });
  }
  return ticks;
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Vagalume V3.0 - Advanced Features', () => {

  describe('Kelly Criterion', () => {
    it('calculates stake correctly', () => {
      const config: SmartMartingaleConfig = { isEnabled: true, baseStake: 0.35, maxMartingaleLevels: 5, martingaleMultiplier: 1.3, useAntiMartingale: false, isSmart: true };
      const bankroll: BankrollState = { currentBankroll: 100, initialBankroll: 100, maxDailyLoss: 10, dailyProfitTarget: 5 };
      const confidence = 0.65; // 65% chance de ganhar
      
      const result = decideNextStake([], config, bankroll, 'DIGITEVEN', confidence);
      
      expect(result.nextStake).toBeGreaterThan(0.35); // Deve ser maior que o base
      expect(result.nextStake).toBeLessThan(10); // Nunca > 10% do bankroll
    });
  });

  describe('Regime Detection', () => {
    it('identifies RANGING correctly', () => {
      const mockTicks = generateRangingTicks(100);
      
      const momentum = calculateMomentum(mockTicks);
      const volatility = calculateVolatility(mockTicks);
      const regime = detectRegime(momentum, volatility);
      
      expect(regime.type).toBe('RANGING');
      expect(regime.confidence).toBeGreaterThan(0.6);
    });
  });

  describe('Advanced Score', () => {
    it('adjusts confidence correctly', () => {
      const mockTicks = generateChaoticTicks(100); // Mercado caótico
      const baseConfidence = 0.75;
      
      const score = calculateAdvancedSignalScore(mockTicks, baseConfidence, 2);
      
      expect(score.adjustedScore).toBeLessThan(score.rawScore); // Deve penalizar
      expect(score.recommendation).toBe('AVOID'); // Deve evitar
    });
  });

  describe('Circuit Breakers', () => {
    it('pauses for low win rate', () => {
        const config: SmartMartingaleConfig = { isEnabled: true, baseStake: 0.35, maxMartingaleLevels: 5, martingaleMultiplier: 1.3, useAntiMartingale: false, isSmart: true };
        const bankroll: BankrollState = { currentBankroll: 95, initialBankroll: 100, maxDailyLoss: 10, dailyProfitTarget: 5 };
        const tradeHistory: any[] = [
            { result: 0.33 }, { result: -0.35 }, { result: -0.35 },
            { result: 0.33 }, { result: -0.35 }, { result: -0.35 },
        ]; // Win Rate = 33%

        const result = decideNextStake(tradeHistory, config, bankroll, 'DIGITEVEN', 0.65);
        expect(result.shouldPause).toBe(true);
        expect(result.pauseReason).toContain('Win rate');
    });
  });
});
