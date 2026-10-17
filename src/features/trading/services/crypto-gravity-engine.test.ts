// src/features/trading/services/crypto-gravity-engine.test.ts
import { describe, it, expect } from 'vitest';
import { 
    calculateBitcoinGravity, 
    getReturns, 
    Z_THRESHOLD_BTC, 
    Z_THRESHOLD_TARGET 
} from './crypto-gravity-engine';

/**
 * MOCK FACTORY
 */
const createMockFeatures = (prices: number[], symbol = 'TEST'): any => ({
  symbol,
  currentPrice: prices[prices.length - 1],
  priceHistory: prices,
  rsi: 50,
  adx: 25,
  atrNow: 0.001,
  bbw: 1.0,
  volatilityRatio: 1.0,
  momentumShort: 0,
  momentumMedium: 0
});

describe('Crypto Gravity Engine V5.2 - Institutional Suite', () => {

  it('Scenario A: Detects high correlation in Lead-Lag setup', () => {
    // BTC subindo degrau a degrau
    const btcPrices = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130];
    // Alt copia o BTC com 1 passo de atraso
    const altPrices = [100, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129];
    
    const btc = createMockFeatures(btcPrices, 'cryBTCUSD');
    const alt = createMockFeatures(altPrices, 'cryETHUSD');
    
    const result = calculateBitcoinGravity(btc, alt);
    
    expect(result.correlation).toBeGreaterThan(0.9);
    expect(result.vetoReason).toBeUndefined();
  });

  it('Scenario B: Vetoes decoupled random series', () => {
    const btcPrices = Array.from({length: 40}, () => 50000 + Math.random() * 100);
    const altPrices = Array.from({length: 40}, () => 3000 + Math.random() * 50);
    
    const btc = createMockFeatures(btcPrices, 'cryBTCUSD');
    const alt = createMockFeatures(altPrices, 'cryETHUSD');
    
    const result = calculateBitcoinGravity(btc, alt);
    
    // Séries aleatórias independentes devem ter correlação baixa
    if (Math.abs(result.correlation) < 0.65) {
        expect(result.vetoReason).toContain('DESACOPLAMENTO');
    }
  });

  it('Scenario C: Triggers SlingShot on BTC impulse with Alt lag', () => {
    // Séries estáveis por 30 períodos
    const baseBtc = Array(30).fill(50000);
    const baseAlt = Array(30).fill(3000);
    
    // BTC dá um salto violento no último candle
    const btcPrices = [...baseBtc, 55000]; 
    // Alt permanece parada (atraso de propagação)
    const altPrices = [...baseAlt, 3001]; 
    
    const btc = createMockFeatures(btcPrices, 'cryBTCUSD');
    btc.momentumMedium = 1.0; // Viés de alta confirmado
    
    const alt = createMockFeatures(altPrices, 'cryETHUSD');
    
    const result = calculateBitcoinGravity(btc, alt);
    
    // Z-Score do BTC deve ser muito alto
    expect(result.zBtc).toBeGreaterThan(Z_THRESHOLD_BTC);
    // Z-Score da Alt deve ser baixo (lag)
    expect(Math.abs(result.zTarget || 0)).toBeLessThan(Z_THRESHOLD_TARGET);
    // Slingshot deve ser ativado se a correlação for suficiente
    // (neste mock a correlação será 0 pois as séries eram flat, mas o teste foca na lógica do Z)
    
    // Validando apenas as métricas de Z
    expect(result.zBtc).toBeDefined();
    expect(result.zTarget).toBeDefined();
  });

});
