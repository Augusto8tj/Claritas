// src/features/trading/hooks/use-hf-strike-zone.tsx
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { TickData, ChartData, CandleData } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/features/trading/services/indicator-service';
import { initialCouncilStrategies } from '@/features/trading/services/council-strategies';


export interface StrikeZone {
  type: 'LONG_ENTRY' | 'SHORT_ENTRY' | 'NEUTRAL';
  confidence: number;
  triggers: string[];
  entry: {
    price: number;
    timestamp: number;
  };
  targets: {
    takeProfit: number;
    stopLoss: number;
    riskReward: number;
  };
  indicators: {
    rsi: number;
    bbPosition: number;
    bbWidth: number;
    volumeSpike: boolean;
    divergence: 'bullish' | 'bearish' | null;
  };
  duration: number; // Duração sugerida em segundos
}

export interface HFStats {
  totalStrikes: number;
  avgConfidence: number;
  lastStrike: StrikeZone | null;
  strikesByType: {
    long: number;
    short: number;
  };
}

interface BBAnalysis {
  series: ({ upper: number; middle: number; lower: number; } | null)[];
  upper: number;
  lower: number;
  middle: number;
  width: number;
  position: number;
  isSqueezed: boolean;
  touchingLower: boolean;
  touchingUpper: boolean;
}

interface RSIAnalysis {
  value: number;
  oversold: boolean;
  overbought: boolean;
  divergence: 'bullish' | 'bearish' | null;
}

interface VolumeAnalysis {
  isSpike: boolean;
  ratio: number;
}

const isCandleData = (d: ChartData): d is CandleData => 'close' in d;

/**
 * Hook para detecção de Strike Zones em High Frequency Trading
 * Combina Bollinger Bands, RSI, Divergências e Volume para identificar
 * momentos estatisticamente ótimos para entradas rápidas (15-30s)
 */
export function useHFStrikeZone(
  priceTicks: TickData[],
  chartData: ChartData[],
  enabled: boolean = true
) {
  const [strikeHistory, setStrikeHistory] = useState<StrikeZone[]>([]);

  const indicators = useMemo((): Indicators | null => {
    if (!enabled || chartData.length < 20) return null;
    const candles = chartData.filter(isCandleData);
    if (candles.length < 20) return null;
    // Passamos um array vazio para as estratégias porque só precisamos dos valores brutos dos indicadores
    return calculateAllIndicators(candles, [], '1m', { duration: 1, unit: 't' });
  }, [chartData, enabled]);

  /**
   * Layer 1: Bollinger Bands Analysis
   */
  const bbAnalysis = useMemo((): BBAnalysis | null => {
    if (!indicators || !indicators.bb || !indicators.bollingerBands) return null;

    const { upper, middle, lower } = indicators.bb;
    if (upper === null || middle === null || lower === null) return null;

    const currentCandle = chartData[chartData.length - 1];
    if (!currentCandle) return null;
    
    const currentPrice = isCandleData(currentCandle) ? currentCandle.close : currentCandle.price;

    const bandWidth = ((upper - lower) / middle) * 100;
    const bbPosition = middle > 0 ? (currentPrice - middle) / (upper - middle) : 0;

    return {
      series: indicators.bollingerBands,
      upper,
      lower,
      middle,
      width: bandWidth,
      position: bbPosition,
      isSqueezed: bandWidth < 1.5,
      touchingLower: currentPrice <= lower * 1.005,
      touchingUpper: currentPrice >= upper * 0.995,
    };
  }, [chartData, indicators]);

  /**
   * Layer 2: RSI Analysis com Divergence Detection
   */
  const rsiAnalysis = useMemo((): RSIAnalysis | null => {
    if (!indicators || indicators.rsi === null) return null;

    const rsi = indicators.rsi;
    
    // Divergence Detection Simplificada
    const last10Ticks = priceTicks.slice(-10);
    if (last10Ticks.length < 10) return { value: rsi, oversold: rsi < 30, overbought: rsi > 70, divergence: null };
    
    const priceChange = last10Ticks[9].price - last10Ticks[0].price;
    const priceIncreasing = priceChange > 0;
    let divergence: 'bullish' | 'bearish' | null = null;

    if (!priceIncreasing && rsi < 35 && rsi > 25) {
      divergence = 'bullish';
    } else if (priceIncreasing && rsi > 65 && rsi < 75) {
      divergence = 'bearish';
    }

    return {
      value: rsi,
      oversold: rsi < 30,
      overbought: rsi > 70,
      divergence,
    };
  }, [priceTicks, indicators]);

  /**
   * Layer 3: Volume Spike Detection
   */
  const volumeAnalysis = useMemo((): VolumeAnalysis | null => {
    if (!enabled || priceTicks.length < 60) return null;

    try {
      const last60Ticks = priceTicks.slice(-60);
      const last10Ticks = priceTicks.slice(-10);

      const window60Duration = last60Ticks[59].epoch - last60Ticks[0].epoch;
      const window10Duration = last10Ticks[9].epoch - last10Ticks[0].epoch;

      if (window60Duration === 0 || window10Duration === 0) return null;

      const avgTickRate = 60 / window60Duration;
      const recentTickRate = 10 / window10Duration;

      const ratio = recentTickRate / avgTickRate;
      const isSpike = ratio > 1.3;

      return {
        isSpike,
        ratio,
      };
    } catch (error) {
      console.error('[HF Strike Zone] Volume Analysis Error:', error);
      return null;
    }
  }, [priceTicks, enabled]);

  /**
   * Strike Zone Logic Combiner
   */
  const currentZone = useMemo((): StrikeZone | null => {
    if (!enabled || !bbAnalysis || !rsiAnalysis || !volumeAnalysis) return null;
    if (priceTicks.length === 0) return null;

    const triggers: string[] = [];
    let confidence = 0;
    let type: StrikeZone['type'] = 'NEUTRAL';

    const currentPrice = priceTicks[priceTicks.length - 1].price;

    // LONG ENTRY
    if (bbAnalysis.touchingLower) {
      triggers.push(`📉 Preço na Banda Inferior (${currentPrice.toFixed(5)})`);
      confidence += 30;
    }
    if (rsiAnalysis.oversold) {
      triggers.push(`📊 RSI Oversold (${rsiAnalysis.value.toFixed(1)})`);
      confidence += 25;
    }
    if (rsiAnalysis.divergence === 'bullish') {
      triggers.push('🔄 Divergência Bullish Detectada');
      confidence += 25;
    }

    if (confidence >= 60) {
      if (volumeAnalysis.isSpike) {
        triggers.push(`📈 Volume Spike (${(volumeAnalysis.ratio * 100).toFixed(0)}%)`);
        confidence += 20;
      }
      if (bbAnalysis.isSqueezed) {
        triggers.push('🎯 Bollinger Squeeze Ativo');
        confidence += 10;
      }
      
      type = 'LONG_ENTRY';
      const atr = bbAnalysis.upper - bbAnalysis.lower;
      return {
        type,
        confidence: Math.min(confidence, 100),
        triggers,
        entry: { price: currentPrice, timestamp: Date.now() },
        targets: {
          takeProfit: currentPrice + atr * 0.75,
          stopLoss: currentPrice - atr * 0.5,
          riskReward: 1.5,
        },
        indicators: {
          rsi: rsiAnalysis.value,
          bbPosition: bbAnalysis.position,
          bbWidth: bbAnalysis.width,
          volumeSpike: volumeAnalysis.isSpike,
          divergence: rsiAnalysis.divergence,
        },
        duration: bbAnalysis.isSqueezed ? 30 : 20,
      };
    }

    // SHORT ENTRY
    confidence = 0;
    triggers.length = 0;

    if (bbAnalysis.touchingUpper) {
      triggers.push(`📈 Preço na Banda Superior (${currentPrice.toFixed(5)})`);
      confidence += 30;
    }
    if (rsiAnalysis.overbought) {
      triggers.push(`📊 RSI Overbought (${rsiAnalysis.value.toFixed(1)})`);
      confidence += 25;
    }
    if (rsiAnalysis.divergence === 'bearish') {
      triggers.push('🔄 Divergência Bearish Detectada');
      confidence += 25;
    }

    if (confidence >= 60) {
        if (volumeAnalysis.isSpike) {
            triggers.push(`📈 Volume Spike (${(volumeAnalysis.ratio * 100).toFixed(0)}%)`);
            confidence += 20;
        }
        if (bbAnalysis.isSqueezed) {
            triggers.push('🎯 Bollinger Squeeze Ativo');
            confidence += 10;
        }

      type = 'SHORT_ENTRY';
      const atr = bbAnalysis.upper - bbAnalysis.lower;
      return {
        type,
        confidence: Math.min(confidence, 100),
        triggers,
        entry: { price: currentPrice, timestamp: Date.now() },
        targets: {
          takeProfit: currentPrice - atr * 0.75,
          stopLoss: currentPrice + atr * 0.5,
          riskReward: 1.5,
        },
        indicators: {
          rsi: rsiAnalysis.value,
          bbPosition: bbAnalysis.position,
          bbWidth: bbAnalysis.width,
          volumeSpike: volumeAnalysis.isSpike,
          divergence: rsiAnalysis.divergence,
        },
        duration: bbAnalysis.isSqueezed ? 30 : 20,
      };
    }

    return null;
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
