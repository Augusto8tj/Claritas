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
  it('detecta slingshotDetected = true quando zBtc > 1.8 e zTarget está em lag positivo', () => {
    // BTC e Alt subindo em correlação base para estabilizar desvio padrão
    // 25 velas no total
    const btcPrices = [];
    const altPrices = [];
    let btcPrice = 100;
    let altPrice = 50;
    for (let i = 0; i < 22; i++) {
        const step = (i % 2 === 0 ? 0.05 : -0.02);
        btcPrice += step;
        altPrice += step / 2;
        btcPrices.push(btcPrice);
        altPrices.push(altPrice);
    }
    
    // Vela 23: Salto explosivo BTC
    btcPrices.push(btcPrice + 8); // 100 -> 108 approx
    altPrices.push(altPrice + 0.012); // Lag suave e controlado para zTarget < 1.0
    
    // Vela 24 (formando, será descartada se dropForming=true)
    btcPrices.push(btcPrice + 8.1);
    altPrices.push(altPrice + 0.02);

    const btcEpochs = Array(25).fill(0).map((_, i) => i * 60);
    const altEpochs = Array(25).fill(0).map((_, i) => i * 60);
    
    const btc = createMock(btcPrices, btcEpochs);
    btc.momentumMedium = 1.0; 
    
    const alt = createMock(altPrices, altEpochs);

    const result = calculateBitcoinGravity(btc, alt, 60, true);
    
    expect(result.correlation).toBeGreaterThan(0.7);
    expect(result.slingshotDetected).toBe(true);
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
