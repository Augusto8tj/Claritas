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
    // BTC subindo forte - Fornecemos 25 velas para superar travas de histórico
    const btcPrices = Array(20).fill(10).concat([10.1, 10.3, 10.6, 11.2, 12.0]);
    const btcEpochs = Array(25).fill(0).map((_, i) => i);
    const btc = createMock(btcPrices, btcEpochs);
    // Injetamos momentum para simular validação de direção
    btc.momentumMedium = 1.0; 
    
    // Altcoin estável (Lag) - Em leve alta suave
    const altPrices = Array(20).fill(5).concat([5.01, 5.02, 5.03, 5.04, 5.05]);
    const altEpochs = Array(25).fill(0).map((_, i) => i);
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

  it('detecta Slingshot refinado com alinhamento de direção', () => {
    const btc = createMock(Array(20).fill(10), Array(20).fill(0).map((_, i) => i));
    const alt = createMock(Array(20).fill(10), Array(20).fill(0).map((_, i) => i));
    
    const result = calculateBitcoinGravity(btc, alt, 60, false);
    expect(result.slingshotDetected).toBe(false); // Estático não deve dar slingshot
  });
});
