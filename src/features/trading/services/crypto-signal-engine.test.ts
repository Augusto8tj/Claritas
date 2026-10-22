
// src/features/trading/services/crypto-signal-engine.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateCryptoSignals, SENTINEL_MIN_SCORE } from './crypto-signal-engine';

const createMockFeatures = (overrides: any = {}): any => ({
  price: 100, rsi: 50, bbPos: 0.5, bwPct: 50,
  atrPct: 0.1, atrRatio: 1.0, er: 0.5,
  mom5: 0, mom15: 0, streak: 0, maxJumpAtr: 1.0,
  vwapDist: 0,
  gravity: {
    btcVector: 'CHOP', correlation: 0.8, beta: 1.0,
    isBtcExploding: false, gravityScore: 70, slingshotDetected: false,
    zBtc: 0, zTarget: 0
  },
  ...overrides
});

describe('Crypto Signal Engine V11 - Soberania Lead-Lag', () => {
  it('LEADLAG_SLINGSHOT gera CALL quando zBtc > 0 independente da regra de reversão', () => {
    const f = createMockFeatures({
      rsi: 80, // Técnica diria PUT
      gravity: {
        slingshotDetected: true,
        zBtc: 2.5, // Bitcoin explodindo pra cima
        zTarget: 0.1,
        gravityScore: 90,
        correlation: 0.85
      }
    });

    const candidates = evaluateCryptoSignals('cryETHUSD', f);
    const sling = candidates.find(c => c.rule === 'LEADLAG_SLINGSHOT');
    const rev = candidates.find(c => c.rule === 'OPT_REV');

    expect(sling?.direction).toBe('CALL');
    expect(rev?.direction).toBe('NONE'); // Deve ser vetado por contradição
    expect(rev?.reasons).toContain('VETO: CONTRADIÇÃO LÍDER (BTC=CALL)');
  });

  it('Gera VETO: NO_GRAVITY se o objeto gravity for nulo', () => {
    const f = createMockFeatures({ gravity: null });
    const candidates = evaluateCryptoSignals('cryETHUSD', f);
    expect(candidates.every(c => c.score === 0)).toBe(true);
    expect(candidates[0].reasons).toContain('VETO: NO_GRAVITY');
  });

  it('Não recebe bônus de SlingShot nas regras base (apenas candidato próprio)', () => {
    const f = createMockFeatures({
        gravity: { slingshotDetected: true, zBtc: 2.0, zTarget: 0, gravityScore: 70, correlation: 0.8 }
    });
    const candidates = evaluateCryptoSignals('cryETHUSD', f);
    const rev = candidates.find(c => c.rule === 'OPT_REV');
    // Se não há bônus e a regra base é neutra, o score não deve subir magicamente
    expect(rev?.score ?? 0).toBeLessThan(SENTINEL_MIN_SCORE);
  });
});
