// src/features/trading/services/__tests__/smart-stake-manager-digits.test.ts
import { describe, it, expect } from 'vitest';
import { decideNextStake, type SmartMartingaleConfig, type BankrollState } from '../smart-stake-manager-digits';
import type { Operation } from '@/lib/types';
import type { DigitContractType } from '../../hooks/use-vagalume-alternante';

describe('decideNextStake - Kelly Criterion', () => {
  const baseConfig: SmartMartingaleConfig = {
    isEnabled: true,
    baseStake: 0.35,
    maxMartingaleLevels: 5,
    martingaleMultiplier: 1.3,
    useAntiMartingale: false,
    isSmart: true,
  };

  const baseBankroll: BankrollState = {
    currentBankroll: 100,
    initialBankroll: 100,
    maxDailyLoss: 10,
    dailyProfitTarget: 5,
  };

  it('should use Kelly stake when confidence > 0.5 and isSmart = true', () => {
    const result = decideNextStake([], baseConfig, baseBankroll, 'DIGITEVEN', 0.65);

    expect(result.nextStake).toBeGreaterThan(baseConfig.baseStake);
    expect(result.shouldPause).toBe(false);
  });

  it('should return base stake for negative Kelly', () => {
    // Confidence baixa deve resultar em Kelly negativo
    const result = decideNextStake([], baseConfig, baseBankroll, 'DIGITEVEN', 0.40);

    expect(result.nextStake).toBe(baseConfig.baseStake); // Volta para base stake
    expect(result.shouldPause).toBe(false);
  });

  it('should not exceed 10% of bankroll', () => {
    const result = decideNextStake([], baseConfig, baseBankroll, 'DIGITEVEN', 0.95); // Confidence muito alta

    expect(result.nextStake).toBeLessThanOrEqual(baseBankroll.currentBankroll * 0.10);
  });
});

describe('decideNextStake - Martingale', () => {
  const baseConfig: SmartMartingaleConfig = {
    isEnabled: true,
    baseStake: 0.35,
    maxMartingaleLevels: 5,
    martingaleMultiplier: 1.3,
    useAntiMartingale: false,
    isSmart: false, // Kelly desabilitado
  };

  const baseBankroll: BankrollState = {
    currentBankroll: 100,
    initialBankroll: 100,
    maxDailyLoss: 10,
    dailyProfitTarget: 5,
  };

  it('should increase stake after loss', () => {
    const lastTrade: Operation = {
      id: 1,
      timestamp: new Date().toISOString(),
      asset: 'R_100',
      direction: 'rise',
      stake: 0.35,
      result: -0.35,
      status: 'lost',
      duration: 1,
      durationUnit: 't',
      initiator: 'Piloto'
    };

    const result = decideNextStake([lastTrade], baseConfig, baseBankroll, 'DIGITEVEN', 0.55);

    expect(result.nextStake).toBeCloseTo(0.35 * 1.3, 2);
    expect(result.shouldPause).toBe(false);
  });

  it('should reset to base stake after win', () => {
    const trades: Operation[] = [
      { id: 1, timestamp: new Date().toISOString(), asset: 'R_100', direction: 'rise', stake: 0.35, result: -0.35, status: 'lost', duration: 1, durationUnit: 't', initiator: 'Piloto' },
      { id: 2, timestamp: new Date().toISOString(), asset: 'R_100', direction: 'rise', stake: 0.455, result: 0.43, status: 'won', duration: 1, durationUnit: 't', initiator: 'Piloto' },
    ];

    const result = decideNextStake(trades, baseConfig, baseBankroll, 'DIGITEVEN', 0.55);

    expect(result.nextStake).toBe(baseConfig.baseStake);
  });
});

describe('decideNextStake - Circuit Breakers', () => {
  const baseConfig: SmartMartingaleConfig = {
    isEnabled: true,
    baseStake: 0.35,
    maxMartingaleLevels: 5,
    martingaleMultiplier: 1.3,
    useAntiMartingale: false,
    isSmart: true,
  };

  const baseBankroll: BankrollState = { currentBankroll: 100, initialBankroll: 100, maxDailyLoss: 10, dailyProfitTarget: 5 };

  it('should pause when daily loss limit reached', () => {
    const bankroll: BankrollState = {
      currentBankroll: 89, // Perdeu $11
      initialBankroll: 100,
      maxDailyLoss: 10,
      dailyProfitTarget: 5,
    };

    const result = decideNextStake([], baseConfig, bankroll, 'DIGITEVEN', 0.65);

    expect(result.shouldPause).toBe(true);
    expect(result.pauseReason).toContain('Stop Loss');
  });

  it('should pause when daily profit target reached', () => {
    const bankroll: BankrollState = {
      currentBankroll: 106, // Lucrou $6
      initialBankroll: 100,
      maxDailyLoss: 10,
      dailyProfitTarget: 5,
    };

    const result = decideNextStake([], baseConfig, bankroll, 'DIGITEVEN', 0.65);

    expect(result.shouldPause).toBe(true);
    expect(result.pauseReason).toContain('Meta de lucro');
  });

  it('should pause when max consecutive losses reached', () => {
    const losses: Operation[] = Array(5).fill(null).map((_, i) => ({
      id: i,
      timestamp: new Date().toISOString(),
      asset: 'R_100',
      direction: 'rise',
      stake: 0.35,
      result: -0.35,
      status: 'lost',
      duration: 1,
      durationUnit: 't',
      initiator: 'Piloto'
    }));

    const result = decideNextStake(losses, baseConfig, baseBankroll, 'DIGITEVEN', 0.65);

    expect(result.shouldPause).toBe(true);
    expect(result.pauseReason).toContain('perdas seguidas');
  });

  it('should pause when win rate < 45% after 5 losses', () => {
    const trades: Operation[] = [
      { id: 1, timestamp: new Date().toISOString(), asset: 'R_100', direction: 'rise', stake: 0.35, result: 0.33, status: 'won', duration: 1, durationUnit: 't', initiator: 'Piloto' },
      { id: 2, timestamp: new Date().toISOString(), asset: 'R_100', direction: 'rise', stake: 0.35, result: -0.35, status: 'lost', duration: 1, durationUnit: 't', initiator: 'Piloto' },
      { id: 3, timestamp: new Date().toISOString(), asset: 'R_100', direction: 'rise', stake: 0.35, result: -0.35, status: 'lost', duration: 1, durationUnit: 't', initiator: 'Piloto' },
      { id: 4, timestamp: new Date().toISOString(), asset: 'R_100', direction: 'rise', stake: 0.35, result: -0.35, status: 'lost', duration: 1, durationUnit: 't', initiator: 'Piloto' },
      { id: 5, timestamp: new Date().toISOString(), asset: 'R_100', direction: 'rise', stake: 0.35, result: -0.35, status: 'lost', duration: 1, durationUnit: 't', initiator: 'Piloto' },
      { id: 6, timestamp: new Date().toISOString(), asset: 'R_100', direction: 'rise', stake: 0.35, result: -0.35, status: 'lost', duration: 1, durationUnit: 't', initiator: 'Piloto' },
    ];

    const result = decideNextStake(trades, baseConfig, baseBankroll, 'DIGITEVEN', 0.65);

    expect(result.shouldPause).toBe(true);
    expect(result.pauseReason).toContain('Win rate');
  });
});
