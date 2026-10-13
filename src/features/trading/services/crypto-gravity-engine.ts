/**
 * @fileOverview Crypto Gravity Engine
 * Calcula a influência do Bitcoin (Líder) sobre as Altcoins (Betas).
 */

export interface BitcoinGravity {
  btcVector: 'BULL_DRAG' | 'BEAR_DRAG' | 'COMPRESSION' | 'DIVERGENT';
  betaScore: number;
  isBtcExploding: boolean;
  momentum: {
    m1: number;
    m5: number;
    m15: number;
  };
}

export function calculateBitcoinGravity(btcCandles: any[], targetCandles: any[]): BitcoinGravity {
  if (btcCandles.length < 30 || targetCandles.length < 30) {
    return { btcVector: 'COMPRESSION', betaScore: 1, isBtcExploding: false, momentum: { m1: 0, m5: 0, m15: 0 } };
  }

  const btcCloses = btcCandles.map(c => Number(c.close));
  const targetCloses = targetCandles.map(c => Number(c.close));
  const lastBtc = btcCloses[btcCloses.length - 1];

  // 1. Cálculo de Momentum Multi-Janela (BTC)
  const calcMom = (p: number) => (lastBtc - btcCloses[btcCloses.length - 1 - p]) / btcCloses[btcCloses.length - 1 - p];
  const m1 = calcMom(1);
  const m5 = calcMom(5);
  const m15 = calcMom(15);

  // 2. Detecção de Explosão (ATR-based simplification)
  const btcRanges = btcCandles.slice(-10).map(c => Number(c.high) - Number(c.low));
  const avgRange = btcRanges.reduce((a, b) => a + b, 0) / btcRanges.length;
  const last3Range = btcCandles.slice(-3).reduce((sum, c) => sum + (Number(c.high) - Number(c.low)), 0) / 3;
  const isBtcExploding = last3Range > avgRange * 1.5;

  // 3. Cálculo de Beta (Correlação de Pearson Simplificada)
  const betaScore = calculatePearson(btcCloses.slice(-30), targetCloses.slice(-30));

  // 4. Determinação do Vetor Gravitacional
  let btcVector: BitcoinGravity['btcVector'] = 'COMPRESSION';
  const targetMom = (targetCloses[targetCloses.length - 1] - targetCloses[targetCloses.length - 6]) / targetCloses[targetCloses.length - 6];

  if (m5 > 0.005 && targetMom < m5 * 0.5) btcVector = 'BULL_DRAG';
  else if (m5 < -0.005 && targetMom > m5 * 0.5) btcVector = 'BEAR_DRAG';
  else if (Math.abs(m5) < 0.001) btcVector = 'COMPRESSION';
  else if (Math.sign(m5) !== Math.sign(targetMom)) btcVector = 'DIVERGENT';

  return { btcVector, betaScore, isBtcExploding, momentum: { m1, m5, m15 } };
}

function calculatePearson(x: number[], y: number[]): number {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((prev, curr, i) => prev + curr * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return den === 0 ? 0 : num / den;
}
