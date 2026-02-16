// src/features/trading/hooks/use-hf-strike-zone.tsx
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { TickData, CandleData, TimePeriod } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/features/trading/services/indicator-service';
import { getCouncilStrategies } from '../services/council-strategies';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { detectMarketRegime, type RegimeCharacteristics } from '../ml/market-regime-detector';
import { AdvancedRiskManager, type PositionSizeRecommendation } from '../risk/advanced-risk-manager';
import {
  detectHFMeanReversionZone,
  detectStandardTrendZone,
  detectBollingerSqueezeZone,
  detectVolumeAbsorptionZone,
  detectMicrostructureScalpZone,
  type StrikeZone,
  type StrategyType
} from '../services/hf-strike-logic';
import type { HFConfig } from '@/features/trading/components/hf-trader/hf-config-panel';


export type { StrikeZone } from '../services/hf-strike-logic';

const CHAMPION_STRATEGY_MAP: Record<RegimeCharacteristics['regime'], { strategy: StrategyType, reason: string }> = {
  HIGH_VOLATILITY_TRENDING: { strategy: 'STD_TREND_FOLLOW', reason: 'Melhor para capturar movimentos direcionais fortes.' },
  LOW_VOLATILITY_RANGING: { strategy: 'HF_MEAN_REVERSION', reason: 'Otimizada para reversão à média em mercados laterais.' },
  BREAKOUT_IMMINENT: { strategy: 'BOLLINGER_SQUEEZE', reason: 'Especializada em operar a expansão de volatilidade.' },
  POST_NEWS_CHAOS: { strategy: 'MICROSTRUCTURE_SCALP', reason: 'Reação rápida ao fluxo de ordens em alta incerteza.' },
  CALM_ACCUMULATION: { strategy: 'VOLUME_ABSORPTION', reason: 'Identifica zonas de absorção antes de grandes movimentos.' },
};

export function useHFStrikeZone(
  priceTicks: TickData[],
  botCandleData: CandleData[],
  uiChartPeriod: TimePeriod,
  config: HFConfig
) {
  const { user } = useAuth();
  const { enabled, minConfidence } = config;
  const rsiStateRef = useRef({ prev: 50 });
  const initialStrategies = useMemo(() => getCouncilStrategies('standard'), []);

  const [marketRegime, setMarketRegime] = useState<RegimeCharacteristics | null>(null);
  const [championStrategy, setChampionStrategy] = useState<{ strategy: StrategyType, reason: string } | null>(null);
  const [activeStrikeZone, setActiveStrikeZone] = useState<StrikeZone | null>(null);
  const [isExploratory, setIsExploratory] = useState(false);
  const [riskManager] = useState(() => new AdvancedRiskManager({ maxDailyLoss: 10, maxDrawdown: 20, maxConcurrentTrades: 3, maxExposurePerAsset: 25, kellyFraction: 0.25 }, 1000));
  const [positionSizing, setPositionSizing] = useState<PositionSizeRecommendation | null>(null);
  const [allSignals, setAllSignals] = useState<(StrikeZone | null)[]>([]);

  const indicators = useMemo((): Indicators | null => {
    if (!enabled || botCandleData.length < 100) return null;
    return calculateAllIndicators(botCandleData, initialStrategies, '1m', { duration: 1, unit: 't' });
  }, [botCandleData, enabled, initialStrategies]);
  
  useEffect(() => {
    if (!enabled || !indicators || priceTicks.length < 2 || !user) {
      setActiveStrikeZone(null);
      return;
    };

    const runCycle = async () => {
      const regime = detectMarketRegime(indicators, botCandleData);
      setMarketRegime(regime);
      
      const champion = CHAMPION_STRATEGY_MAP[regime.regime];
      setChampionStrategy(champion);

      const currentPrice = priceTicks[priceTicks.length - 1].price;
      
      const allSignalsResult: (StrikeZone | null)[] = [
        detectHFMeanReversionZone(indicators, currentPrice),
        detectStandardTrendZone(indicators, currentPrice, rsiStateRef.current.prev),
        detectBollingerSqueezeZone(indicators, currentPrice),
        detectVolumeAbsorptionZone(botCandleData, indicators),
        detectMicrostructureScalpZone(priceTicks, botCandleData, indicators, currentPrice),
      ];
      setAllSignals(allSignalsResult);
      
      const validSignals = allSignalsResult.filter((zone): zone is StrikeZone => zone !== null && zone.type !== 'NEUTRAL');
      
      // --- Nova Lógica: Highest-Confidence-First ---
      const eligibleSignals = validSignals.filter(s => s.confidence >= minConfidence);

      let finalStrikeZone: StrikeZone | null = null;
      if (eligibleSignals.length > 0) {
          // Ordena por confiança para pegar o sinal mais forte
          eligibleSignals.sort((a, b) => b.confidence - a.confidence);
          finalStrikeZone = eligibleSignals[0];
      }

      // O conceito 'exploratório' não é mais necessário com este modelo direto.
      setActiveStrikeZone(finalStrikeZone);
      setIsExploratory(false); 
      
      if (finalStrikeZone) {
        const pseudoSignal = {
          expectedWinRate: 0.5 + (finalStrikeZone.confidence - 50) / 100 * 0.4,
        };
        const sizing = riskManager.calculatePositionSize(pseudoSignal as any, riskManager.currentCapital);
        
        setPositionSizing(sizing);
      } else {
        setPositionSizing(null);
      }

      if (indicators.rsi) {
        rsiStateRef.current.prev = indicators.rsi;
      }
    };
    
    const timeoutId = setTimeout(runCycle, 200); 
    return () => clearTimeout(timeoutId);

  }, [indicators, priceTicks, enabled, botCandleData, user, riskManager, minConfidence]);
  
  return {
    activeStrikeZone,
    marketRegime,
    championStrategy,
    isExploratory,
    positionSizing,
    riskManager,
    fullIndicators: indicators,
    supplyDemandZones: (indicators as any)?.supplyDemandZones,
    allSignals,
  };
}
