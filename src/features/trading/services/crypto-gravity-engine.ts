
// /src/features/trading/services/crypto-gravity-engine.ts

/**
 * @fileOverview CRYPTO GRAVITY ENGINE V5.0 (SUPREME)
 * Motor matemático institucional para detecção de correlação líder, 
 * beta dinâmico e Lead-Lag Arbitrage entre cryBTCUSD e o cluster de Altcoins.
 */

// ============================================================================
// 1. TYPES AND INTERFACES
// ============================================================================

export interface CryptoAssetFeatures {
  symbol: string;
  currentPrice: number;
  priceHistory: number[]; // Últimos 30-50 preços de fechamento
  rsi: number;
  adx: number;
  atrNow: number;
  bbw: number; // Bollinger BandWidth
  volatilityRatio: number; 
  momentumShort: number;   // ROC 5
  momentumMedium: number;  // ROC 20
}

export interface BitcoinGravityResult {
  btcVector: 'BULL_DRAG' | 'BEAR_DRAG' | 'COMPRESSION' | 'DIVERGENT' | 'CHOP';
  correlation: number;      // Correlação de Pearson (-1 a 1)
  beta: number;             // Sensibilidade/Elasticidade ao BTC
  isBtcExploding: boolean;
  gravityScore: number;     // 0 a 100
  slingshotDetected: boolean; // Lead-Lag Arbitrage trigger
  vetoReason?: string;
}

// ============================================================================
// 2. MATH UTILITIES
// ============================================================================

/**
 * Calcula a Correlação de Pearson entre dois vetores de preços.
 */
function calculatePearsonCorrelation(x: number[], y: number[]): number {
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

/**
 * Calcula o Beta (Inclinação da regressão linear simples).
 */
function calculateBeta(targetReturns: number[], btcReturns: number[]): number {
  const n = Math.min(targetReturns.length, btcReturns.length);
  if (n < 2) return 1.0;

  const muBtc = btcReturns.reduce((a, b) => a + b, 0) / n;
  let covariance = 0;
  let varianceBtc = 0;

  for (let i = 0; i < n; i++) {
    covariance += (btcReturns[i] - muBtc) * (targetReturns[i] - (targetReturns.reduce((a,b)=>a+b,0)/n));
    varianceBtc += Math.pow(btcReturns[i] - muBtc, 2);
  }

  return varianceBtc === 0 ? 1.0 : covariance / varianceBtc;
}

function getReturns(history: number[]): number[] {
  const returns = [];
  for (let i = 1; i < history.length; i++) {
    returns.push(Math.log(history[i] / history[i - 1]));
  }
  return returns;
}

// ============================================================================
// 3. CORE ENGINE
// ============================================================================

/**
 * Calcula a "gravidade" do Bitcoin sobre um ativo alvo (Altcoin).
 */
export function calculateBitcoinGravity(
  btc: CryptoAssetFeatures,
  target: CryptoAssetFeatures
): BitcoinGravityResult {
  
  // 1. CÁLCULO DE MÉTRICAS ROLANTES
  const btcReturns = getReturns(btc.priceHistory);
  const targetReturns = getReturns(target.priceHistory);
  
  const correlation = calculatePearsonCorrelation(btcReturns, targetReturns);
  const beta = calculateBeta(targetReturns, btcReturns);

  // 2. DETECÇÃO DE REGIME DO LÍDER (BTC)
  const isChop = btc.adx < 20;
  const isExploding = btc.atrNow > (btc.volatilityRatio * 1.5) || btc.bbw > 2.5;
  
  let btcVector: BitcoinGravityResult['btcVector'] = 'DIVERGENT';
  if (isChop) btcVector = 'CHOP';
  else if (Math.abs(btc.momentumMedium) < 0.2) btcVector = 'COMPRESSION';
  else btcVector = btc.momentumMedium > 0 ? 'BULL_DRAG' : 'BEAR_DRAG';

  // 3. DETECTOR DE SLINGSHOT (Lead-Lag Arbitrage)
  // Requisitos: Correlação histórica alta (>0.7), BTC em forte impulso, mas Alt ainda atrasada
  const btcZScore = (btc.momentumShort - 0) / (btc.volatilityRatio || 1);
  const targetZScore = (target.momentumShort - 0) / (target.volatilityRatio || 1);
  
  const slingshotDetected = 
    correlation > 0.7 && 
    Math.abs(btcZScore) > 1.8 && 
    Math.abs(targetZScore) < 1.0 && 
    Math.sign(btcZScore) === Math.sign(btc.momentumMedium);

  // 4. CÁLCULO DE SCORE DE GRAVIDADE
  let gravityScore = 50;
  if (correlation > 0.8) gravityScore += 20;
  if (slingshotDetected) gravityScore += 25;
  if (isExploding) gravityScore += 10;
  if (isChop) gravityScore -= 30;

  // 5. VETOS ESTRITOS
  let vetoReason: string | undefined;
  if (correlation < 0.65) vetoReason = "DESACOPLAMENTO: Correlação < 0.65";
  if (isChop) vetoReason = "CHOP_ZONE: BTC em lateralidade errática";
  if (correlation > 0.7 && Math.sign(btc.momentumShort) !== Math.sign(target.momentumShort) && !slingshotDetected) {
    vetoReason = "DIVERGÊNCIA: Alt operando contra vetor do líder";
  }

  return {
    btcVector,
    correlation,
    beta,
    isBtcExploding: isExploding,
    gravityScore: Math.max(0, Math.min(100, gravityScore)),
    slingshotDetected,
    vetoReason
  };
}
