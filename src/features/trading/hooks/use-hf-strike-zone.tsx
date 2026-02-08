// src/features/trading/hooks/use-hf-strike-zone.tsx
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { TickData, CandleData } from '@/lib/types';
import {
    detectHFMeanReversionZone,
    detectStandardTrendZone,
    detectBollingerSqueezeZone,
    detectVolumeAbsorptionZone,
    detectMicrostructureScalpZone,
    type StrikeZone,
    StrategyType,
    strategyMetadata
} from '../services/hf-strike-logic';
import { calculateAllIndicators, type Indicators } from '@/features/trading/services/indicator-service';
import { getCouncilStrategies } from '../services/council-strategies';


export type { StrikeZone } from '../services/hf-strike-logic';


export interface HFStats {
  totalStrikes: number;
  avgConfidence: number;
  lastStrike: StrikeZone | null;
  strikesByType: {
    long: number;
    short: number;
  };
}

export function useHFStrikeZone(
  priceTicks: TickData[],
  botCandleData: CandleData[],
  uiChartPeriod: TimePeriod,
  enabled: boolean = true,
  strategy: StrategyType
) {
  const [strikeHistory, setStrikeHistory] = useState<StrikeZone[]>([]);
  const rsiStateRef = useRef({ prev: 50 });
  
  const initialStrategies = useMemo(() => getCouncilStrategies('standard'), []);

  const indicators = useMemo((): Indicators | null => {
    const isHF = strategyMetadata[strategy]?.isHF ?? true;
    const dataForIndicators = isHF ? botCandleData : botCandleData; // Sempre usar 1m para base de indicadores HF
    const timePeriodForIndicators = isHF ? '1m' : uiChartPeriod;

    if (!enabled || dataForIndicators.length < 100) return null;
    
    return calculateAllIndicators(dataForIndicators, initialStrategies, timePeriodForIndicators, { duration: 1, unit: 't' });
  }, [botCandleData, uiChartPeriod, enabled, strategy, initialStrategies]);
  
  const currentZone = useMemo((): StrikeZone | null => {
    if (!enabled || !indicators || priceTicks.length === 0) return null;

    const currentPrice = priceTicks[priceTicks.length - 1].price;
    let zone: StrikeZone | null = null;
    
    const windowCandles = strategyMetadata[strategy]?.isHF ? botCandleData : botCandleData; // Passa os candles corretos

    switch (strategy) {
        case 'HF_MEAN_REVERSION':
          zone = detectHFMeanReversionZone(indicators, currentPrice);
          break;
        case 'STD_TREND_FOLLOW':
          zone = detectStandardTrendZone(indicators, currentPrice, rsiStateRef.current.prev);
          break;
        case 'BOLLINGER_SQUEEZE':
          zone = detectBollingerSqueezeZone(indicators, currentPrice);
          break;
        case 'VOLUME_ABSORPTION':
          zone = detectVolumeAbsorptionZone(windowCandles, indicators);
          break;
        case 'MICROSTRUCTURE_SCALP':
          zone = detectMicrostructureScalpZone(priceTicks, windowCandles, indicators, currentPrice);
          break;
    }
    
    if (indicators.rsi) {
      rsiStateRef.current.prev = indicators.rsi;
    }

    return zone;
  }, [indicators, priceTicks, enabled, strategy, botCandleData]);
  
  useEffect(() => {
    if (!currentZone || currentZone.type === 'NEUTRAL') return;

    setStrikeHistory(prev => {
      const lastStrike = prev[prev.length - 1];
      if (lastStrike && Date.now() - lastStrike.entry.timestamp < 10000) {
        return prev;
      }
      return [...prev, currentZone].slice(-100);
    });
  }, [currentZone]);

  const stats: HFStats = useMemo(() => {
    const total = strikeHistory.length;
    const avgConfidence = total > 0 ? strikeHistory.reduce((sum, s) => sum + s.confidence, 0) / total : 0;
    const strikesByType = strikeHistory.reduce((acc, strike) => {
        if (strike.type === 'LONG_ENTRY') acc.long++;
        if (strike.type === 'SHORT_ENTRY') acc.short++;
        return acc;
      }, { long: 0, short: 0 });

    return {
      totalStrikes: total,
      avgConfidence: parseFloat(avgConfidence.toFixed(1)),
      lastStrike: strikeHistory[strikeHistory.length - 1] || null,
      strikesByType,
    };
  }, [strikeHistory]);

  const clearHistory = useCallback(() => {
    setStrikeHistory([]);
  }, []);

  return {
    currentZone,
    strikeHistory,
    stats,
    clearHistory,
    fullIndicators: indicators,
    supplyDemandZones: (indicators as any)?.supplyDemandZones,
  };
}
