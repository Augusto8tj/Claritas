// src/features/trading/ensemble/strategy-ensemble.ts
import {
  detectHFMeanReversionZone,
  detectStandardTrendZone,
  detectBollingerSqueezeZone,
  detectVolumeAbsorptionZone,
  detectMicrostructureScalpZone,
  type StrategyType
} from '../services/hf-strike-logic';
import type { Indicators } from '../services/indicator-service';
import type { CandleData, TickData } from '@/lib/types';
import type { OptimizedWeights } from '../ml/adaptive-optimizer';

const STRATEGIES_ORDER: StrategyType[] = [
  'HF_MEAN_REVERSION',
  'STD_TREND_FOLLOW',
  'BOLLINGER_SQUEEZE',
  'VOLUME_ABSORPTION',
  'MICROSTRUCTURE_SCALP',
];

export interface EnsembleSignal {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  participants: {
    strategy: StrategyType;
    vote: 'LONG' | 'SHORT' | 'NEUTRAL';
    weight: number;
    confidence: number;
  }[];
  reasoning: string;
  expectedWinRate: number;
  suggestedStake: number;
}

async function calculateExpectedWinRate(
  votingStrategies: any[],
  currentIndicators: Indicators
): Promise<number> {
  // Placeholder: In a real system, this would query a DB of historical trades
  // and find trades under similar market conditions (e.g., ADX range, volatility).
  return 0.62; // 62%
}

export async function getEnsembleSignal(
  priceTicks: TickData[],
  candles: CandleData[],
  indicators: Indicators,
  optimizedWeights: OptimizedWeights[],
  prevRsi: number, // Pass prevRsi for trend following logic
  currentBalance: number // Pass current balance for Kelly Criterion
): Promise<EnsembleSignal> {
  const currentPrice = priceTicks[priceTicks.length - 1].price;
  
  const signals = await Promise.all([
    detectHFMeanReversionZone(indicators, currentPrice),
    detectStandardTrendZone(indicators, currentPrice, prevRsi),
    detectBollingerSqueezeZone(indicators, currentPrice),
    detectVolumeAbsorptionZone(candles, indicators),
    detectMicrostructureScalpZone(priceTicks, candles, indicators, currentPrice),
  ]);
  
  const activeSignals = signals.map((s, i) => ({ signal: s, strategy: STRATEGIES_ORDER[i] })).filter(item => item.signal && item.signal.type !== 'NEUTRAL');
  
  if (activeSignals.length === 0) {
    return { direction: 'NEUTRAL', confidence: 0, participants: [], reasoning: 'Nenhum sinal de estratégia ativo.', expectedWinRate: 0, suggestedStake: 0 };
  }
  
  const weightedVotes = activeSignals.map(({ signal, strategy }) => {
    const weightInfo = optimizedWeights.find(w => w.strategy === strategy);
    const strategyWeight = weightInfo?.weight || 1 / activeSignals.length;
    return {
      strategy: strategy,
      vote: signal!.type === 'LONG_ENTRY' ? 'LONG' : 'SHORT',
      weight: strategyWeight,
      confidence: signal!.confidence,
    };
  });
  
  const longScore = weightedVotes
    .filter(v => v.vote === 'LONG')
    .reduce((sum, v) => sum + v.weight * v.confidence, 0);
  
  const shortScore = weightedVotes
    .filter(v => v.vote === 'SHORT')
    .reduce((sum, v) => sum + v.weight * v.confidence, 0);
  
  const totalScore = longScore + shortScore;
  
  if (totalScore < 50) { // Threshold for a valid consensus
    return { direction: 'NEUTRAL', confidence: 0, participants: weightedVotes, reasoning: 'Consenso fraco.', expectedWinRate: 0, suggestedStake: 0 };
  }
  
  const direction = longScore > shortScore ? 'LONG' : 'SHORT';
  const confidence = Math.max(longScore, shortScore);
  
  const expectedWinRate = await calculateExpectedWinRate(
    weightedVotes.filter(v => v.vote === direction),
    indicators
  );
  
  // Kelly Criterion for stake sizing
  const p = expectedWinRate;
  const rr = 1.5; // Assuming a Risk/Reward of 1.5
  const q = 1 - p;

  if ((p * rr - q) <= 0) {
      return { direction, confidence, participants: weightedVotes, reasoning: 'Sinal sem vantagem estatística (Kelly ≤ 0)', expectedWinRate, suggestedStake: 0 };
  }

  const kellyFull = (p * rr - q) / rr;
  const kellySafe = kellyFull > 0 ? kellyFull * 0.25 : 0; // Quarter Kelly
  const suggestedStake = Math.max(0.35, Math.min(5.0, kellySafe * currentBalance));
  
  return {
    direction,
    confidence,
    participants: weightedVotes,
    reasoning: `${weightedVotes.filter(v => v.vote === direction).length}/${weightedVotes.length} estratégias concordam.`,
    expectedWinRate,
    suggestedStake,
  };
}
