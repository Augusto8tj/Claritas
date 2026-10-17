
// src/features/trading/services/crypto-gravity-engine.test.ts
import { describe, it, expect } from 'vitest';
import { calculateBitcoinGravity } from './crypto-gravity-engine';

const createMock = (prices: number[], epochs: number[]): any => ({
  symbol: 'TEST',
  currentPrice: prices[prices.length-1],
  priceHistory: prices,
  epochHistory: epochs,
  rsi: 50, adx: 25, atrNow: 0.001, bbw: 1.0, volatilityRatio: 1.0, atrRatio: 1.0, momentumShort: 0, momentumMedium: 0
});

describe('Crypto Gravity Engine V5.3', () => {
  it('identifica alta correlação com desalinhamento de tamanho (interseção)', () => {
    const base = [10, 11, 10, 12, 13, 11, 14, 15, 14, 16];
    const btcPrices = [...Array(100).fill(10), ...base];
    const btcEpochs = btcPrices.map((_, i) => 1000 + i);
    
    const altPrices = [...base];
    const altEpochs = altPrices.map((_, i) => 1100 + i); // Alinhado com o fim do BTC

    const btc = createMock(btcPrices, btcEpochs);
    const alt = createMock(altPrices, altEpochs);

    const result = calculateBitcoinGravity(btc, alt, 60, false);
    expect(result.correlation).toBeGreaterThan(0.9);
  });

  it('atrNow absoluto alto não gera isBtcExploding sozinho', () => {
    const btc = createMock([1000, 1001], [1, 2]);
    btc.atrNow = 50000; // Valor absoluto gigante
    btc.atrRatio = 1.0;  // Mas em relação à média está normal
    const alt = createMock([10, 10], [1, 2]);
    
    const result = calculateBitcoinGravity(btc, alt, 60, false);
    expect(result.isBtcExploding).toBe(false);
  });

  it('detecta desacoplamento em séries randômicas', () => {
    const btcPrices = Array.from({length: 100}, () => Math.random() * 100);
    const altPrices = Array.from({length: 100}, () => Math.random() * 100);
    const epochs = btcPrices.map((_, i) => i);
    
    const btc = createMock(btcPrices, epochs);
    const alt = createMock(altPrices, epochs);

    const result = calculateBitcoinGravity(btc, alt, 60, false);
    if (Math.abs(result.correlation) < 0.65) {
      expect(result.vetoReason).toContain('DESACOPLAMENTO');
    }
  });
});
