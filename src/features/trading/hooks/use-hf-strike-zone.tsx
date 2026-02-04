// src/features/trading/hooks/use-hf-strike-zone.tsx
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { TickData, ChartData } from '@/lib/types';

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

  /**
   * Layer 1: Bollinger Bands Analysis
   * Período: 20, Desvio: 2.5 (mais agressivo para HF)
   */
  const bbAnalysis = useMemo((): BBAnalysis | null => {
    if (!enabled || chartData.length < 20) return null;

    try {
      const closes = chartData.slice(-20).map(c => ('close' in c ? c.close : c.price));

      // SMA (Simple Moving Average)
      const sma = closes.reduce((a, b) => a + b, 0) / closes.length;

      // Standard Deviation
      const variance = closes.reduce((sq, price) => sq + Math.pow(price - sma, 2), 0) / closes.length;
      const stdDev = Math.sqrt(variance);

      // Bollinger Bands (2.5 desvios para HF)
      const upperBand = sma + 2.5 * stdDev;
      const lowerBand = sma - 2.5 * stdDev;
      const currentPrice = closes[closes.length - 1];

      // BandWidth (quanto menor, mais "squeezed")
      const bandWidth = ((upperBand - lowerBand) / sma) * 100;

      // Posição do preço nas bandas (-1 = lower, 0 = middle, +1 = upper)
      const bbPosition = (currentPrice - sma) / (upperBand - sma);

      return {
        upper: upperBand,
        lower: lowerBand,
        middle: sma,
        width: bandWidth,
        position: bbPosition,
        isSqueezed: bandWidth < 1.5,
        touchingLower: currentPrice <= lowerBand * 1.005,
        touchingUpper: currentPrice >= upperBand * 0.995,
      };
    } catch (error) {
      console.error('[HF Strike Zone] BB Analysis Error:', error);
      return null;
    }
  }, [chartData, enabled]);

  /**
   * Layer 2: RSI Analysis com Divergence Detection
   * Período: 14 ticks
   */
  const rsiAnalysis = useMemo((): RSIAnalysis | null => {
    if (!enabled || priceTicks.length < 14) return null;

    try {
      const recentTicks = priceTicks.slice(-14);
      const gains: number[] = [];
      const losses: number[] = [];

      // Calcular gains e losses
      for (let i = 1; i < recentTicks.length; i++) {
        const change = recentTicks[i].price - recentTicks[i - 1].price;
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? -change : 0);
      }

      const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length;
      const avgLoss = losses.reduce((a, b) => a + b, 0) / losses.length;

      // RSI Calculation
      const rs = avgGain / (avgLoss || 0.0001);
      const rsi = 100 - 100 / (1 + rs);

      // Divergence Detection Simplificada
      const last10Ticks = priceTicks.slice(-10);
      const priceChange = last10Ticks[9].price - last10Ticks[0].price;
      const priceIncreasing = priceChange > 0;

      let divergence: 'bullish' | 'bearish' | null = null;

      // Divergência Bullish: Preço caindo mas RSI subindo (oversold)
      if (!priceIncreasing && rsi < 35 && rsi > 25) {
        divergence = 'bullish';
      }
      // Divergência Bearish: Preço subindo mas RSI caindo (overbought)
      else if (priceIncreasing && rsi > 65 && rsi < 75) {
        divergence = 'bearish';
      }

      return {
        value: rsi,
        oversold: rsi < 30,
        overbought: rsi > 70,
        divergence,
      };
    } catch (error) {
      console.error('[HF Strike Zone] RSI Analysis Error:', error);
      return null;
    }
  }, [priceTicks, enabled]);

  /**
   * Layer 3: Volume Spike Detection
   * Baseado na taxa de ticks recebidos
   */
  const volumeAnalysis = useMemo((): VolumeAnalysis | null => {
    if (!enabled || priceTicks.length < 60) return null;

    try {
      const last60Ticks = priceTicks.slice(-60);
      const last10Ticks = priceTicks.slice(-10);

      // Calcular janelas de tempo
      const window60Duration = last60Ticks[59].epoch - last60Ticks[0].epoch;
      const window10Duration = last10Ticks[9].epoch - last10Ticks[0].epoch;

      if (window60Duration === 0 || window10Duration === 0) return null;

      // Taxa de ticks por segundo
      const avgTickRate = 60 / (window60Duration / 1000);
      const recentTickRate = 10 / (window10Duration / 1000);

      const ratio = recentTickRate / avgTickRate;
      const isSpike = ratio > 1.3; // 30% acima da média

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
   * Combina todas as análises para detectar zonas de entrada
   */
  const currentZone = useMemo((): StrikeZone | null => {
    if (!enabled || !bbAnalysis || !rsiAnalysis || !volumeAnalysis) return null;
    if (priceTicks.length === 0) return null;

    const triggers: string[] = [];
    let confidence = 0;
    let type: StrikeZone['type'] = 'NEUTRAL';

    const currentPrice = priceTicks[priceTicks.length - 1].price;

    // ========== LONG ENTRY CONDITIONS ==========
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

    if (volumeAnalysis.isSpike && confidence > 0) {
      triggers.push(`📈 Volume Spike (${(volumeAnalysis.ratio * 100).toFixed(0)}%)`);
      confidence += 20;
    }

    // Bonus: Squeeze aumenta confiança
    if (bbAnalysis.isSqueezed && confidence > 0) {
      triggers.push('🎯 Bollinger Squeeze Ativo');
      confidence += 10;
    }

    // Se confiança >= 60%, é sinal LONG
    if (confidence >= 60) {
      type = 'LONG_ENTRY';

      const atr = bbAnalysis.upper - bbAnalysis.lower;
      const stopLoss = currentPrice - atr * 0.5;
      const takeProfit = currentPrice + atr * 0.75;

      return {
        type,
        confidence: Math.min(confidence, 100),
        triggers,
        entry: { price: currentPrice, timestamp: Date.now() },
        targets: {
          takeProfit,
          stopLoss,
          riskReward: 1.5,
        },
        indicators: {
          rsi: rsiAnalysis.value,
          bbPosition: bbAnalysis.position,
          bbWidth: bbAnalysis.width,
          volumeSpike: volumeAnalysis.isSpike,
          divergence: rsiAnalysis.divergence,
        },
        duration: bbAnalysis.isSqueezed ? 30 : 20, // Squeeze = mais tempo
      };
    }

    // ========== SHORT ENTRY CONDITIONS ==========
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

    if (volumeAnalysis.isSpike && confidence > 0) {
      triggers.push(`📈 Volume Spike (${(volumeAnalysis.ratio * 100).toFixed(0)}%)`);
      confidence += 20;
    }

    if (bbAnalysis.isSqueezed && confidence > 0) {
      triggers.push('🎯 Bollinger Squeeze Ativo');
      confidence += 10;
    }

    if (confidence >= 60) {
      type = 'SHORT_ENTRY';

      const atr = bbAnalysis.upper - bbAnalysis.lower;
      const stopLoss = currentPrice + atr * 0.5;
      const takeProfit = currentPrice - atr * 0.75;

      return {
        type,
        confidence: Math.min(confidence, 100),
        triggers,
        entry: { price: currentPrice, timestamp: Date.now() },
        targets: {
          takeProfit,
          stopLoss,
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

  /**
   * Auto-save strikes para histórico
   * Evita duplicatas em menos de 10 segundos
   */
  useEffect(() => {
    if (!currentZone || currentZone.type === 'NEUTRAL') return;

    setStrikeHistory(prev => {
      const lastStrike = prev[prev.length - 1];
      if (lastStrike && Date.now() - lastStrike.entry.timestamp < 10000) {
        return prev;
      }
      return [...prev, currentZone].slice(-100); // Manter últimos 100
    });
  }, [currentZone]);

  /**
   * Estatísticas agregadas
   */
  const stats: HFStats = useMemo(() => {
    const total = strikeHistory.length;
    const avgConfidence =
      total > 0 ? strikeHistory.reduce((sum, s) => sum + s.confidence, 0) / total : 0;

    const strikesByType = strikeHistory.reduce(
      (acc, strike) => {
        if (strike.type === 'LONG_ENTRY') acc.long++;
        if (strike.type === 'SHORT_ENTRY') acc.short++;
        return acc;
      },
      { long: 0, short: 0 }
    );

    return {
      totalStrikes: total,
      avgConfidence: parseFloat(avgConfidence.toFixed(1)),
      lastStrike: strikeHistory[strikeHistory.length - 1] || null,
      strikesByType,
    };
  }, [strikeHistory]);

  /**
   * Limpar histórico (útil para testes)
   */
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
  };
}
