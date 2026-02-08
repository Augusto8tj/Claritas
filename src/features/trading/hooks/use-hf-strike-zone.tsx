// src/features/trading/hooks/use-hf-strike-zone.tsx
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { TickData, CandleData } from '@/lib/types';
import {
    detectHFMeanReversionZone,
    detectStandardTrendZone,
    type StrikeZone,
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

export function useHFStrikeZone(
  priceTicks: TickData[],
  botCandleData: CandleData[], // Sempre 1 minuto para base
  uiChartData: CandleData[],   // Dados do gráfico da UI (pode ser 15m)
  enabled: boolean = true,
  tradingMode: 'hf' | 'standard' = 'hf'
) {
  const [strikeHistory, setStrikeHistory] = useState<StrikeZone[]>([]);
  const rsiStateRef = useRef({ prev: 50 });

  const indicators = useMemo((): Indicators | null => {
    if (!enabled || (tradingMode === 'hf' && botCandleData.length < 20) || (tradingMode === 'standard' && uiChartData.length < 100)) return null;
    
    // Use os dados de vela apropriados para o modo de trading
    const dataForIndicators = tradingMode === 'standard' ? uiChartData : botCandleData;
    const timePeriodForIndicators = tradingMode === 'standard' ? '15m' : '1m';

    return calculateAllIndicators(dataForIndicators, [], timePeriodForIndicators, { duration: 1, unit: 't' });
  }, [botCandleData, uiChartData, enabled, tradingMode]);

  const currentZone = useMemo((): StrikeZone | null => {
    if (!enabled || !indicators || priceTicks.length === 0) return null;

    const currentPrice = priceTicks[priceTicks.length - 1].price;
    let zone: StrikeZone | null = null;
    
    if (tradingMode === 'hf') {
        zone = detectHFMeanReversionZone(
            indicators,
            currentPrice
        );
    } else { // standard mode
        zone = detectStandardTrendZone(
            indicators,
            currentPrice,
            rsiStateRef.current.prev
        );
    }
    
    if (indicators.rsi) {
      rsiStateRef.current.prev = indicators.rsi;
    }

    return zone;
  }, [indicators, priceTicks, enabled, tradingMode]);
  
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
  };
}
