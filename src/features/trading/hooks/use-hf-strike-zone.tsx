// src/features/trading/hooks/use-hf-strike-zone.tsx
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { TickData, CandleData, TimePeriod } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/features/trading/services/indicator-service';
import { getCouncilStrategies } from '../services/council-strategies';
import { useAuth } from '@/features/auth/hooks/use-auth';

// NEW IMPORTS
import { optimizeStrategyWeights, type OptimizedWeights } from '../ml/adaptive-optimizer';
import { getEnsembleSignal, type EnsembleSignal } from '../ensemble/strategy-ensemble';
import { detectMarketRegime, type RegimeCharacteristics } from '../ml/market-regime-detector';
import { AdvancedRiskManager, type PositionSizeRecommendation } from '../risk/advanced-risk-manager';

export type { StrikeZone } from '../services/hf-strike-logic'; // Keep for hf-data-service compatibility for now

export interface HFStats {
  totalStrikes: number;
  avgConfidence: number;
  lastStrike: any | null; // StrikeZone is now EnsembleSignal
  strikesByType: { long: number; short: number; };
}

export function useHFStrikeZone(
  priceTicks: TickData[],
  botCandleData: CandleData[],
  uiChartPeriod: TimePeriod,
  enabled: boolean = true,
  strategy: any // strategy is now managed by ensemble
) {
  const { user } = useAuth();
  const [strikeHistory, setStrikeHistory] = useState<any[]>([]); // EnsembleSignal[]
  const rsiStateRef = useRef({ prev: 50 });
  const initialStrategies = useMemo(() => getCouncilStrategies('standard'), []);

  // NEW STATES
  const [optimizedWeights, setOptimizedWeights] = useState<OptimizedWeights[]>([]);
  const [ensembleSignal, setEnsembleSignal] = useState<EnsembleSignal | null>(null);
  const [marketRegime, setMarketRegime] = useState<RegimeCharacteristics | null>(null);
  const [riskManager] = useState(() => new AdvancedRiskManager({ maxDailyLoss: 10, maxDrawdown: 20, maxConcurrentTrades: 3, maxExposurePerAsset: 25, kellyFraction: 0.25 }, 1000));
  const [positionSizing, setPositionSizing] = useState<PositionSizeRecommendation | null>(null);

  const indicators = useMemo((): Indicators | null => {
    if (!enabled || botCandleData.length < 100) return null;
    return calculateAllIndicators(botCandleData, initialStrategies, '1m', { duration: 1, unit: 't' });
  }, [botCandleData, enabled, initialStrategies]);
  
  // Main Logic Loop
  useEffect(() => {
    if (!enabled || !indicators || priceTicks.length < 2 || !user) {
      setEnsembleSignal(null);
      return;
    };

    const runCycle = async () => {
      // 1. Detect Market Regime
      const regime = detectMarketRegime(indicators, botCandleData);
      setMarketRegime(regime);
      
      // 2. Get Ensemble Signal
      const signal = await getEnsembleSignal(priceTicks, botCandleData, indicators, optimizedWeights, rsiStateRef.current.prev, riskManager.currentCapital);
      setEnsembleSignal(signal);

      // 3. Get Position Sizing recommendation
      if (signal.direction !== 'NEUTRAL') {
          const sizing = riskManager.calculatePositionSize(signal, riskManager.currentCapital);
          setPositionSizing(sizing);
      } else {
          setPositionSizing(null);
      }

      if (indicators.rsi) {
        rsiStateRef.current.prev = indicators.rsi;
      }
    };
    
    const timeoutId = setTimeout(runCycle, 200); // Debounce
    return () => clearTimeout(timeoutId);

  }, [indicators, priceTicks, enabled, optimizedWeights, botCandleData, user, riskManager]);
  
  // Weight optimization loop
  useEffect(() => {
      if (!user || !marketRegime) return;

      const optimize = async () => {
          const weights = await optimizeStrategyWeights(user.uid, marketRegime);
          setOptimizedWeights(weights);
      };
      
      optimize(); // Initial run
      const interval = setInterval(optimize, 60 * 60 * 1000); // every hour
      return () => clearInterval(interval);
  }, [user, marketRegime]);

  const stats: HFStats = useMemo(() => {
      // This needs to be adapted for ensemble signals
      return { totalStrikes: 0, avgConfidence: 0, lastStrike: null, strikesByType: { long: 0, short: 0 } };
  }, []);

  const clearHistory = useCallback(() => {
    setStrikeHistory([]);
  }, []);

  return {
    // Legacy returns for compatibility
    currentZone: null, // Replaced by ensembleSignal
    strikeHistory,
    stats,
    clearHistory,
    fullIndicators: indicators,
    supplyDemandZones: (indicators as any)?.supplyDemandZones,
    // New Institutional returns
    ensembleSignal,
    marketRegime,
    optimizedWeights,
    positionSizing,
    riskManager
  };
}
