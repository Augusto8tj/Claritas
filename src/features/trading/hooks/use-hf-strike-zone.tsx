// src/features/trading/hooks/use-hf-strike-zone.tsx
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { TickData, CandleData } from '@/lib/types';
import {
    analyzeBollingerBands,
    analyzeRSI,
    analyzeVolume,
    detectStrikeZone,
    type StrikeZone,
    type BBAnalysis,
    type RSIAnalysis,
    type VolumeAnalysis,
} from '../services/hf-strike-logic';
import { calculateAllIndicators, type Indicators } from '@/features/trading/services/indicator-service';

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

/**
 * Hook para detecção de Strike Zones em High Frequency Trading
 * Combina Bollinger Bands, RSI, Divergências e Volume para identificar
 * momentos estatisticamente ótimos para entradas rápidas (15-30s)
 */
export function useHFStrikeZone(
  priceTicks: TickData[],
  candleData: CandleData[],
  enabled: boolean = true
) {
  const [strikeHistory, setStrikeHistory] = useState<StrikeZone[]>([]);

  const indicators = useMemo((): Indicators | null => {
    if (!enabled || candleData.length < 20) return null;
    // O serviço de indicadores já está otimizado com cache.
    return calculateAllIndicators(candleData, [], '1m', { duration: 1, unit: 't' });
  }, [candleData, enabled]);

  /**
   * Layer 1: Bollinger Bands Analysis - Reage a cada tick!
   */
  const bbAnalysis = useMemo((): BBAnalysis | null => {
    if (!enabled || !indicators || !indicators.bb || priceTicks.length === 0) return null;
    const currentPrice = priceTicks[priceTicks.length - 1].price;
    return analyzeBollingerBands(indicators.bb, indicators.bollingerBands, currentPrice);
  }, [indicators, priceTicks, enabled]);


  /**
   * Layer 2: RSI Analysis com Divergence Detection
   */
    const rsiAnalysis = useMemo((): RSIAnalysis | null => {
    if (!enabled || !indicators || indicators.rsi === null || candleData.length < 14) return null;
    return analyzeRSI(indicators.rsi, candleData);
  }, [candleData, indicators, enabled]);

  /**
   * Layer 3: Volume Spike Detection
   */
  const volumeAnalysis = useMemo((): VolumeAnalysis | null => {
    if (!enabled || priceTicks.length < 60) return null;
    return analyzeVolume(priceTicks);
  }, [priceTicks, enabled]);

  /**
   * Strike Zone Logic Combiner
   */
  const currentZone = useMemo((): StrikeZone | null => {
    if (!enabled || priceTicks.length === 0) return null;
    const currentPrice = priceTicks[priceTicks.length - 1].price;
    return detectStrikeZone(bbAnalysis, rsiAnalysis, volumeAnalysis, currentPrice);
  }, [bbAnalysis, rsiAnalysis, volumeAnalysis, priceTicks, enabled]);
  
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
    bbAnalysis,
    rsiAnalysis,
    volumeAnalysis,
    clearHistory,
    fullIndicators: indicators,
  };
}
