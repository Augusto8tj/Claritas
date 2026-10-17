
// /src/features/trading/services/crypto-gravity-engine.ts

/**
 * @fileOverview CRYPTO GRAVITY ENGINE V5.3 (SUPREME)
 * Motor matemático institucional para detecção de correlação líder, 
 * beta dinâmico e Lead-Lag Arbitrage entre cryBTCUSD e o cluster de Altcoins.
 * V5.3: Alinhamento temporal por epoch e detecção de explosão por desvio relativo.
 */

// ============================================================================
// 1. TYPES AND INTERFACES
// ============================================================================

export interface CryptoAssetFeatures {
  symbol: string;
  currentPrice: number;
  priceHistory: number[]; 
  epochHistory: number[]; // Novo campo para alinhamento
  rsi: number;
  adx: number;
  atrNow: number;
  bbw: number; 
  volatilityRatio: number; 
  momentumShort: number;   
  momentumMedium: number;  
  atrRatio: number; // Novo: para explosão relativa
}

export interface BitcoinGravityResult {
  btcVector: 'BULL_DRAG' | 'BEAR_DRAG' | 'COMPRESSION' | 'DIVERGENT' | 'CHOP';
  correlation: number;      
  beta: number;             
  isBtcExploding: boolean;
  gravityScore: number;     
  slingshotDetected: boolean; 
  vetoReason?: string;
  zBtc?: number;            
  zTarget?: number;         
}

export type BitcoinGravity = BitcoinGravityResult;

// Constantes de Calibração Institucional
export const Z_THRESHOLD_BTC = 1.8;
export const Z_THRESHOLD_TARGET = 1.0;

// ============================================================================
// 2. MATH UTILITIES
// ============================================================================

export function calculatePearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  const muX = x.reduce((a, b) => a + b, 0) / n;
  const muY = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let sumSqX = 0;
  let sumSqY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = x[i] - muX;
    const diffY = y[i] - muY;
    numerator += diffX * diffY;
    sumSqX += diffX * diffX;
    sumSqY += diffY * diffY;
  }

  const denominator = Math.sqrt(sumSqX * sumSqY);
  return denominator === 0 ? 0 : numerator / denominator;
}

export function calculateBeta(targetReturns: number[], btcReturns: number[]): number {
  const n = Math.min(targetReturns.length, btcReturns.length);
  if (n < 2) return 1.0;

  const muBtc = btcReturns.reduce((a, b) => a + b, 0) / n;
  const muTarget = targetReturns.reduce((a, b) => a + b, 0) / n;
  
  let covariance = 0;
  let varianceBtc = 0;

  for (let i = 0; i < n; i++) {
    covariance += (btcReturns[i] - muBtc) * (targetReturns[i] - muTarget);
    varianceBtc += Math.pow(btcReturns[i] - muBtc, 2);
  }

  return varianceBtc === 0 ? 1.0 : covariance / varianceBtc;
}

export function getReturns(history: number[]): number[] {
  const returns = [];
  for (let i = 1; i < history.length; i++) {
    if (history[i - 1] > 0) {
      returns.push(Math.log(history[i] / history[i - 1]));
    }
  }
  return returns;
}

function calculateZScoreFromReturns(returns: number[]): number {
  if (returns.length < 2) return 0;
  const lastReturn = returns[returns.length - 1];
  const slice = returns.slice(-31, -1);
  if (slice.length === 0) return 0;
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / slice.length;
  const stdDev = Math.sqrt(variance);
  return stdDev === 0 ? 0 : (lastReturn - mean) / stdDev;
}

// ============================================================================
// 3. CORE ENGINE
// ============================================================================

export function calculateBitcoinGravity(
  btc: CryptoAssetFeatures,
  target: CryptoAssetFeatures,
  windowSize = 60,
  dropForming = true
): BitcoinGravityResult {
  
  // 1. ALINHAMENTO TEMPORAL POR EPOCH (INTERSEÇÃO)
  const btcData = new Map<number, number>();
  btc.epochHistory.forEach((epoch, i) => btcData.set(epoch, btc.priceHistory[i]));

  const alignedBtc: number[] = [];
  const alignedTarget: number[] = [];

  // Exclui última vela se estiver em formação
  const targetEpochs = dropForming ? target.epochHistory.slice(0, -1) : target.epochHistory;
  const targetPrices = dropForming ? target.priceHistory.slice(0, -1) : target.priceHistory;

  targetEpochs.forEach((epoch, i) => {
    if (btcData.has(epoch)) {
      alignedBtc.push(btcData.get(epoch)!);
      alignedTarget.push(targetPrices[i]);
    }
  });

  // Fallback: alinhamento pelo fim se interseção for pequena
  if (alignedBtc.length < 10) {
    const n = Math.min(btc.priceHistory.length, target.priceHistory.length) - (dropForming ? 1 : 0);
    alignedBtc.length = 0;
    alignedTarget.length = 0;
    alignedBtc.push(...btc.priceHistory.slice(-n - (dropForming ? 1 : 0), dropForming ? -1 : undefined));
    alignedTarget.push(...target.priceHistory.slice(-n - (dropForming ? 1 : 0), dropForming ? -1 : undefined));
  }

  const btcReturns = getReturns(alignedBtc).slice(-windowSize);
  const targetReturns = getReturns(alignedTarget).slice(-windowSize);
  
  const correlation = calculatePearsonCorrelation(btcReturns, targetReturns);
  const beta = calculateBeta(targetReturns, btcReturns);

  // 2. CÁLCULO DE Z-SCORES
  const zBtc = calculateZScoreFromReturns(getReturns(btc.priceHistory));
  const zTarget = calculateZScoreFromReturns(getReturns(target.priceHistory));

  // 3. DETECÇÃO DE EXPLOSÃO (VALORES RELATIVOS)
  const isBtcExploding = btc.atrRatio > 1.5 || btc.bbw > 2.5;
  
  // 4. VETOR DO LÍDER (BTC)
  let btcVector: BitcoinGravityResult['btcVector'] = 'CHOP';
  if (btc.adx > 20) {
    if (Math.abs(btc.momentumMedium) < 0.2) btcVector = 'COMPRESSION';
    else btcVector = btc.momentumMedium > 0 ? 'BULL_DRAG' : 'BEAR_DRAG';
  }

  // 5. SLINGSHOT (Lead-Lag Arbitrage)
  const slingshotDetected = 
    correlation > 0.7 && 
    Math.abs(zBtc) > Z_THRESHOLD_BTC && 
    Math.abs(zTarget) < Z_THRESHOLD_TARGET && 
    Math.sign(zBtc) === Math.sign(btc.momentumMedium);

  // 6. DIVERGENT STATE
  if (correlation > 0.7 && Math.abs(zBtc) > 0.2 && Math.abs(zTarget) > 0.2) {
    if (Math.sign(zBtc) !== Math.sign(zTarget)) btcVector = 'DIVERGENT';
  }

  let gravityScore = 50;
  if (correlation > 0.8) gravityScore += 20;
  if (slingshotDetected) gravityScore += 25;
  if (isBtcExploding) gravityScore += 10;
  if (btcVector === 'CHOP') gravityScore -= 30;

  let vetoReason: string | undefined;
  if (correlation < 0.65) vetoReason = "DESACOPLAMENTO: Correlação < 0.65";

  return {
    btcVector,
    correlation,
    beta,
    isBtcExploding,
    gravityScore: Math.max(0, Math.min(100, gravityScore)),
    slingshotDetected,
    vetoReason,
    zBtc,
    zTarget
  };
}
