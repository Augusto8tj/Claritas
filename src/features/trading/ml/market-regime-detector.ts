// src/features/trading/ml/market-regime-detector.ts
import type { Indicators } from '../services/indicator-service';
import type { CandleData, StrategyType } from '@/lib/types';

export type MarketRegime = 
  | 'HIGH_VOLATILITY_TRENDING'
  | 'LOW_VOLATILITY_RANGING'
  | 'BREAKOUT_IMMINENT'
  | 'POST_NEWS_CHAOS'
  | 'CALM_ACCUMULATION';

export interface RegimeCharacteristics {
  regime: MarketRegime;
  confidence: number;
  features: {
    volatility: number;
    trend_strength: number;
    volume_profile: number;
  };
  bestStrategies: StrategyType[];
  worstStrategies: StrategyType[];
  suggestedAction: 'AGGRESSIVE' | 'CONSERVATIVE' | 'PAUSE';
}

export function detectMarketRegime(
  indicators: Indicators,
  recentCandles: CandleData[]
): RegimeCharacteristics {
  const atr = indicators.atr || 0;
  const adx = indicators.adx || 0;
  const bbw = indicators.bbw || 0;
  const avgVolume = indicators.volSma && indicators.volSma.length > 0 ? indicators.volSma[indicators.volSma.length - 1] || 1 : 1;
  const currentVolume = recentCandles[recentCandles.length - 1]?.volume || 1;
  const lastClose = recentCandles[recentCandles.length - 1]?.close || 1;
  
  const volatility = Math.min(1, (atr / lastClose) / 0.005);
  const trendStrength = adx / 100;
  const volumeProfile = currentVolume / avgVolume;
  
  let regime: MarketRegime = 'CALM_ACCUMULATION';
  let confidence = 50;
  let bestStrategies: StrategyType[] = [];
  let worstStrategies: StrategyType[] = [];
  let suggestedAction: 'AGGRESSIVE' | 'CONSERVATIVE' | 'PAUSE' = 'CONSERVATIVE';

  if (adx > 25 && volatility > 0.6) {
    regime = 'HIGH_VOLATILITY_TRENDING';
    confidence = Math.min(100, adx + volatility * 50);
    bestStrategies = ['STD_TREND_FOLLOW', 'MICROSTRUCTURE_SCALP'];
    worstStrategies = ['HF_MEAN_REVERSION'];
    suggestedAction = 'AGGRESSIVE';
  } 
  else if (adx < 20 && (bbw < 1.5 || volatility < 0.3)) {
    regime = 'LOW_VOLATILITY_RANGING';
    confidence = 80 - (adx - 10) * 2;
    bestStrategies = ['HF_MEAN_REVERSION'];
    worstStrategies = ['STD_TREND_FOLLOW'];
    suggestedAction = 'CONSERVATIVE';
  }
  else if (bbw < 1.0 && volumeProfile > 1.5) {
    regime = 'BREAKOUT_IMMINENT';
    confidence = 90;
    bestStrategies = ['BOLLINGER_SQUEEZE'];
    worstStrategies = ['HF_MEAN_REVERSION'];
    suggestedAction = 'AGGRESSIVE';
  }
  else {
    const atrHistory = indicators.atrSeries?.slice(-20) || [];
    const avgAtr = atrHistory.length > 0 ? atrHistory.reduce((a,b) => a! + b!, 0)! / atrHistory.length : atr;
    const atrSpike = atr > avgAtr * 2.5;

    if (atrSpike) {
      regime = 'POST_NEWS_CHAOS';
      confidence = 70;
      bestStrategies = [];
      worstStrategies = ['HF_MEAN_REVERSION', 'STD_TREND_FOLLOW'];
      suggestedAction = 'PAUSE';
    } else {
      regime = 'CALM_ACCUMULATION';
      confidence = 60;
      bestStrategies = ['VOLUME_ABSORPTION'];
      worstStrategies = [];
      suggestedAction = 'CONSERVATIVE';
    }
  }
  
  return {
    regime,
    confidence,
    features: { volatility, trend_strength: trendStrength, volume_profile: volumeProfile },
    bestStrategies,
    worstStrategies,
    suggestedAction,
  };
}
