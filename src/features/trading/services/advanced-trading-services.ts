// src/features/trading/services/advanced-trading-services.ts
/**
 * @fileOverview Serviços Avançados de Trading para o Cérebro V2.5
 * =================================================================================
 * MÓDULO DE SERVIÇO (SERVICE LAYER)
 * 
 * OBJETIVO:
 * Este arquivo contém as funções matemáticas e lógicas mais complexas que
 * sustentam as decisões do Cérebro Cognitivo V2.5. A separação destas funções
 * da lógica do hook principal (`use-robot-council-v2`) torna o código mais limpo,
 * testável e reutilizável.
 */

import type { CandleData, MarketRegime, TickData } from '@/lib/types';
import { calculateATR, calculateBBWidth, calculateZScore } from './volatility-forecast';
import { type Indicators } from './indicator-service';

// --- CONFIGURAÇÕES ---
const MICROSTRUCTURE_LOOKBACK = 15;

// ============================================================================
// 1. DETECÇÃO DE REGIME DE MERCADO (MODELO HMM SIMPLIFICADO)
// ============================================================================

export interface RegimeDetectionResult {
  regime: MarketRegime;
  confidence: number;
  probabilities: Record<MarketRegime, number>;
  analysis: string;
}

export const detectMarketRegime = (
  candles: CandleData[],
  indicators: Pick<Indicators, 'adx' | 'pdi' | 'ndi' | 'bbw' | 'roc' | 'atr'>,
  previousRegime: MarketRegime,
  metaRegime?: 'Consolidation' | 'Expansion'
): RegimeDetectionResult => {
    let probabilities: Record<MarketRegime, number> = {
        trending_bull: 0, trending_bear: 0, ranging: 0, high_volatility: 0, breakout: 0
    };

    // --- Evidências dos Indicadores ---
    const adx = indicators.adx || 0;
    const pdi = indicators.pdi || 0;
    const ndi = indicators.ndi || 0;
    const bbw = indicators.bbw || 0;
    const roc = indicators.roc || 0;

    // Evidência de Tendência vs. Lateralidade
    if (adx > 25) {
        if (pdi > ndi) probabilities.trending_bull += 0.6;
        else probabilities.trending_bear += 0.6;
    } else {
        probabilities.ranging += 0.5;
    }

    // Evidência de Volatilidade e Breakout
    if (bbw > 0.6) { // BBW típico para 1 min. Pode precisar de ajuste.
        probabilities.high_volatility += 0.4;
        if (Math.abs(roc) > 0.05) probabilities.breakout += 0.5;
    } else {
        probabilities.ranging += 0.2;
    }

    // Normalização das probabilidades
    const totalProb = Object.values(probabilities).reduce((s, p) => s + p, 0);
    if (totalProb > 0) {
        (Object.keys(probabilities) as MarketRegime[]).forEach(key => {
            probabilities[key] /= totalProb;
        });
    }

    // Escolha do regime mais provável
    const bestRegime = (Object.keys(probabilities) as MarketRegime[]).reduce(
        (a, b) => probabilities[a] > probabilities[b] ? a : b
    );
    const confidence = probabilities[bestRegime];

    return {
        regime: bestRegime,
        confidence,
        probabilities,
        analysis: `ADX: ${adx.toFixed(1)}, BBW: ${bbw.toFixed(2)}, ROC: ${roc.toFixed(4)}`
    };
};


// ============================================================================
// 2. LÓGICA DE EXECUÇÃO E GESTÃO DE RISCO
// ============================================================================

export const calculateKellyStake = (
  balance: number,
  bayesianProb: number,
  payout: number // Ex: 0.95 para 95% de retorno
): number => {
    if (bayesianProb <= 0.5) return 0;
    const p = bayesianProb;
    const q = 1 - p;
    const b = payout; // Odds
    const kellyFraction = (p * b - q) / b;

    if (kellyFraction <= 0) return 0;
    return Math.max(0.35, balance * kellyFraction * 0.25); // Quarter Kelly
};

export const bayesianUpdate = (prior: number, evidence: number): number => {
  const p_b_given_a = evidence; // P(Evidência | Hipótese)
  const p_a = prior; // P(Hipótese)
  const p_b_given_not_a = 1 - evidence;
  const p_not_a = 1 - prior;

  const p_b = p_b_given_a * p_a + p_b_given_not_a * p_not_a;
  if(p_b === 0) return prior;

  return (p_b_given_a * p_a) / p_b;
};

// ============================================================================
// 3. ANÁLISE DE MICROESTRUTURA (FLUXO DE ORDENS)
// ============================================================================
export interface MicrostructureFeatures {
  spreadPercentage: number;
  volumeImbalance: number;
  tickVelocity: number;
  priceAcceleration: number;
  parkinsonVolatility: number;
  yangZhangVolatility: number;
  gapRatio: number;
  meanReversion: number;
  isSpike: boolean;
  pressure: 'buy' | 'sell' | 'neutral';
  analysis: string;
}

export const extractMicrostructureFeatures = (
  ticks: TickData[],
  candles: CandleData[],
): MicrostructureFeatures | null => {
  if (ticks.length < MICROSTRUCTURE_LOOKBACK) return null;

  const recentTicks = ticks.slice(-MICROSTRUCTURE_LOOKBACK);
  const startTick = recentTicks[0];
  const endTick = recentTicks[recentTicks.length - 1];

  let buyVolume = 0;
  let sellVolume = 0;
  let priceChanges: number[] = [];

  for (let i = 1; i < recentTicks.length; i++) {
    const change = recentTicks[i].price - recentTicks[i-1].price;
    priceChanges.push(change);
    if(change > 0) buyVolume++;
    else if (change < 0) sellVolume++;
  }
  
  const totalVolume = buyVolume + sellVolume;
  const volumeImbalance = totalVolume > 0 ? buyVolume / totalVolume : 0.5;

  const timeDelta = (endTick.epoch - startTick.epoch) || 1;
  const tickVelocity = recentTicks.length / timeDelta;
  
  const meanChange = priceChanges.reduce((a,b)=>a+b, 0) / priceChanges.length;
  const priceAcceleration = (priceChanges[priceChanges.length-1] - meanChange) / timeDelta;
  
  // Usando funções de forecast para os cálculos de volatilidade
  const parkinsonVolatility = calculateATR(candles.slice(-20), 14) || 0; // Exemplo de uso
  const yangZhangVolatility = calculateBBWidth(candles.slice(-20), 20, 2) || 0;

  return {
    spreadPercentage: 0,
    volumeImbalance,
    tickVelocity,
    priceAcceleration,
    parkinsonVolatility,
    yangZhangVolatility,
    gapRatio: 0,
    meanReversion: 0,
    isSpike: false,
    pressure: volumeImbalance > 0.6 ? 'buy' : volumeImbalance < 0.4 ? 'sell' : 'neutral',
    analysis: `Pressão de ${volumeImbalance > 0.6 ? 'compra' : 'venda'}`
  };
};

export function calculatePerformanceMetrics(tradeHistory: { profit: number }[]) {
  if (tradeHistory.length < 2) {
    return {
      sharpeRatio: 0,
      maxDrawdown: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      kellyFraction: 0,
    };
  }

  const profits = tradeHistory.map(t => t.profit);
  const meanReturn = profits.reduce((sum, p) => sum + p, 0) / profits.length;
  const stdDev = Math.sqrt(profits.reduce((sum, p) => sum + Math.pow(p - meanReturn, 2), 0) / profits.length);
  const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

  let peak = -Infinity;
  let maxDrawdown = 0;
  let cumulative = 0;
  profits.forEach(p => {
    cumulative += p;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  });

  const wins = profits.filter(p => p > 0);
  const losses = profits.filter(p => p < 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, p) => s + p, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, p) => s + p, 0) / losses.length : 0;
  const totalLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
  const profitFactor = totalLoss > 0 ? wins.reduce((s, p) => s + p, 0) / totalLoss : Infinity;

  const winRate = wins.length / profits.length;
  const b = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 1;
  const kelly = winRate - (1 - winRate) / b;
  
  return {
    sharpeRatio,
    maxDrawdown,
    avgWin,
    avgLoss,
    profitFactor,
    kellyFraction: Math.max(0, kelly),
  };
}

export function calculateShannonEntropy(riseSum: number, fallSum: number): number {
    const total = riseSum + fallSum;
    if (total === 0) return 1; // Máxima incerteza
    
    const pRise = riseSum / total;
    const pFall = fallSum / total;
    
    let entropy = 0;
    if (pRise > 0) entropy -= pRise * Math.log2(pRise);
    if (pFall > 0) entropy -= pFall * Math.log2(pFall);
    
    return entropy; // Retorna valor entre 0 (certeza total) e 1 (incerteza máxima)
}
