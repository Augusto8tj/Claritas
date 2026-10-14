
// /src/features/trading/services/crypto-gravity-engine.ts
/**
 * @fileOverview Crypto Gravity Engine V2
 * Motor matemático para detecção de lead-lag entre BTC e Altcoins.
 */

export interface BitcoinGravity {
  btcVector: 'BULL_DRAG' | 'BEAR_DRAG' | 'COMPRESSION' | 'DIVERGENT' | 'IMPULSE_UP' | 'IMPULSE_DOWN' | 'ALT_LAGGING_UP' | 'ALT_LAGGING_DOWN' | 'ALT_ALIGNED' | 'ALT_DIVERGENT' | 'INSUFFICIENT_DATA';
  betaReal: number;
  corrReturns: number;
  zImpulse: number;
  isBtcExploding: boolean;
  btcImpulseDir: 'UP' | 'DOWN' | null;
  expectedCatchUp: number;
  leadLagSeconds: number;
  leaderConfidence: number;
}

/**
 * Reamostra séries temporais para uma grade comum de 1 segundo.
 */
function resampleTo1sGrid(data: any[], windowSeconds: number): number[] {
  if (data.length < 2) return [];
  const now = Math.floor(Date.now() / 1000);
  const start = now - windowSeconds;
  const grid = new Array(windowSeconds).fill(null);
  
  // Mapeia dados existentes para a grade
  data.forEach(c => {
    const idx = Math.floor(c.epoch - start);
    if (idx >= 0 && idx < windowSeconds) {
      grid[idx] = Number(c.close);
    }
  });

  // Forward-fill de lacunas
  let lastVal = grid.find(v => v !== null) || data[0].close;
  for (let i = 0; i < windowSeconds; i++) {
    if (grid[i] === null) grid[i] = lastVal;
    else lastVal = grid[i];
  }

  // Converte para retornos logarítmicos
  const returns: number[] = [];
  for (let i = 1; i < windowSeconds; i++) {
    returns.push(Math.log(grid[i] / grid[i - 1]));
  }
  return returns;
}

function calculatePearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((prev, curr, i) => prev + curr * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return den === 0 ? 0 : num / den;
}

export function calculateBitcoinGravity(btcCandles: any[], targetCandles: any[]): BitcoinGravity {
  const WINDOW = 60; // 60 segundos de análise
  if (btcCandles.length < 30 || targetCandles.length < 30) {
    return { btcVector: 'INSUFFICIENT_DATA', betaReal: 1, corrReturns: 0, zImpulse: 0, isBtcExploding: false, btcImpulseDir: null, expectedCatchUp: 0, leadLagSeconds: 0, leaderConfidence: 0 };
  }

  const btcRet = resampleTo1sGrid(btcCandles, WINDOW);
  const altRet = resampleTo1sGrid(targetCandles, WINDOW);

  if (btcRet.length < 10 || altRet.length < 10) {
    return { btcVector: 'INSUFFICIENT_DATA', betaReal: 1, corrReturns: 0, zImpulse: 0, isBtcExploding: false, btcImpulseDir: null, expectedCatchUp: 0, leadLagSeconds: 0, leaderConfidence: 0 };
  }

  // 1. Z-Score do Impulso do BTC (últimos 15s)
  const recentBtc = btcRet.slice(-15);
  const btcMean = btcRet.reduce((a,b) => a+b, 0) / btcRet.length;
  const btcStd = Math.sqrt(btcRet.reduce((s,v) => s + (v-btcMean)**2, 0) / btcRet.length) || 0.0001;
  const currentBtcRet = recentBtc.reduce((a,b) => a+b, 0);
  const zImpulse = currentBtcRet / (btcStd * Math.sqrt(15));

  // 2. Detecção de Explosão
  const isBtcExploding = Math.abs(zImpulse) > 2.0;
  const btcImpulseDir = zImpulse > 2.0 ? 'UP' : (zImpulse < -2.0 ? 'DOWN' : null);

  // 3. Beta Real e Correlação
  const corrReturns = calculatePearson(btcRet, altRet);
  const btcVar = btcRet.reduce((s,v) => s + (v-btcMean)**2, 0) / btcRet.length || 0.0001;
  const altMean = altRet.reduce((a,b) => a+b, 0) / altRet.length;
  const covariance = btcRet.reduce((s,v,i) => s + (v-btcMean)*(altRet[i]-altMean), 0) / btcRet.length;
  const betaReal = covariance / btcVar;

  // 4. Cross-Correlation para Lead-Lag
  let maxCorr = -1;
  let leadLagSeconds = 0;
  for (let lag = -5; lag <= 5; lag++) {
    const bSlice = lag < 0 ? btcRet.slice(0, lag) : btcRet.slice(lag);
    const aSlice = lag < 0 ? altRet.slice(-lag) : altRet.slice(0, btcRet.length - lag);
    const c = calculatePearson(bSlice, aSlice);
    if (c > maxCorr) {
      maxCorr = c;
      leadLagSeconds = lag;
    }
  }

  // 5. Retorno de Catch-up esperado
  const currentAltRet = altRet.slice(-15).reduce((a,b) => a+b, 0);
  const expectedCatchUp = (betaReal * currentBtcRet) - currentAltRet;

  // 6. Máquina de Estados
  let btcVector: BitcoinGravity['btcVector'] = 'INSUFFICIENT_DATA';
  if (Math.abs(zImpulse) > 2.5) {
    btcVector = zImpulse > 0 ? 'IMPULSE_UP' : 'IMPULSE_DOWN';
  } else if (Math.abs(expectedCatchUp) > btcStd * 2 && Math.sign(expectedCatchUp) === Math.sign(zImpulse)) {
    btcVector = expectedCatchUp > 0 ? 'ALT_LAGGING_UP' : 'ALT_LAGGING_DOWN';
  } else if (corrReturns > 0.7) {
    btcVector = 'ALT_ALIGNED';
  } else if (corrReturns < 0.2) {
    btcVector = 'COMPRESSION';
  } else {
    btcVector = 'ALT_DIVERGENT';
  }

  return {
    btcVector,
    betaReal,
    corrReturns,
    zImpulse,
    isBtcExploding,
    btcImpulseDir,
    expectedCatchUp,
    leadLagSeconds,
    leaderConfidence: maxCorr
  };
}
