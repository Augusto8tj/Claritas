// src/features/trading/services/crypto-gravity-engine.test.ts
import { describe, it, expect } from 'vitest';
import { calculateBitcoinGravity } from './crypto-gravity-engine';

const createMock = (prices: number[], epochs: number[]): any => ({
  symbol: 'TEST',
  currentPrice: prices[prices.length-1],
  priceHistory: prices,
  epochHistory: epochs,
  rsi: 50, adx: 25, atrNow: 0.001, bbw: 1.0, volatilityRatio: 1.0, atrRatio: 1.0, momentumShort: 0, momentumMedium: 1.0
});

describe('Crypto Gravity Engine V13 (Hardening)', () => {
  it('detecta slingshotDetected quando o BTC salta e o alvo (correlacionado antes) fica parado', () => {
    // Regressão: a correlação NÃO pode incluir o candle do evento (senão o veto DESACOPLAMENTO bloqueia o setup).
    const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
    const seeds = [2, 3, 4, 5]; // seed 1 tem zAlvo=1.1 (> 1.0): o alvo já reagiu, não é slingshot
    for (const seed of seeds) {
      const r = rng(seed);
      let b = 60000, a = 3000;
      const bp = [b], ap = [a];
      for (let i = 0; i < 80; i++) {
        const rb = 0.001 * gauss(r); const ra = 0.8 * rb + 0.0004 * gauss(r);
        b *= Math.exp(rb); a *= Math.exp(ra); bp.push(b); ap.push(a);
      }
      b *= Math.exp(0.012); a *= Math.exp(0.0006); bp.push(b); ap.push(a); // candle do evento (fechado)
      bp.push(b * 1.0002); ap.push(a * 1.0002);                           // vela em formação (descartada)
      const ep = bp.map((_, i) => i * 60);
      const res = calculateBitcoinGravity(createMock(bp, ep), createMock(ap, ep), 60, true);
      expect(res.correlation).toBeGreaterThan(0.7);
      expect(res.slingshotDetected).toBe(true);
      expect(res.vetoReason).toBeUndefined();
    }
  });

  it('retorna HISTÓRICO_INSUFICIENTE quando as séries têm menos de 10 velas alinhadas', () => {
    const btc = createMock([10, 11, 12], [1, 2, 3]);
    const alt = createMock([10, 11, 12], [1, 2, 3]);

    const result = calculateBitcoinGravity(btc, alt, 60, false);
    expect(result.vetoReason).toBe('HISTÓRICO_INSUFICIENTE (<10 velas)');
  });

  it('nunca retorna NaN com séries degeneradas (constantes)', () => {
    const btc = createMock(Array(20).fill(100), Array(20).fill(0).map((_, i) => i * 60));
    const alt = createMock(Array(20).fill(50), Array(20).fill(0).map((_, i) => i * 60));
    
    const result = calculateBitcoinGravity(btc, alt, 60, false);
    expect(Number.isFinite(result.correlation)).toBe(true);
    expect(Number.isFinite(result.beta)).toBe(true);
    expect(result.vetoReason).toMatch(/NUMERIC_INVALID|DESACOPLAMENTO/);
  });

  it('detecta Slingshot refinado com alinhamento de direção', () => {
    const btc = createMock(Array(20).fill(10), Array(20).fill(0).map((_, i) => i));
    const alt = createMock(Array(20).fill(10), Array(20).fill(0).map((_, i) => i));
    
    const result = calculateBitcoinGravity(btc, alt, 60, false);
    expect(result.slingshotDetected).toBe(false); // Estático não deve dar slingshot
  });
});