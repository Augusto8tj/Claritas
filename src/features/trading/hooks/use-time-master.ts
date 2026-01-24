'use client';

/**
 * @fileOverview O Sentinela Perene do Tempo (Time Master V2)
 *
 * Este hook opera de forma independente, analisando o mercado a cada segundo
 * para projetar o "tempo até a quebra da barreira". Ele não depende de trades
 * reais ou virtuais, observando o comportamento intrínseco do ativo.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import type { CandleData, TickData } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';

// --- CONFIGURAÇÕES ---
const ANALYSIS_INTERVAL_MS = 1000; // Analisa a cada segundo
const HISTORY_LENGTH = 180; // Mantém os últimos 3 minutos de projeções

const BARRIER_INDICES: { [key: string]: number } = {
  '0.01': 0.397,
  '0.02': 0.371,
  '0.03': 0.348,
  '0.04': 0.331,
  '0.05': 0.315,
};
const DEFAULT_GROWTH_RATE = 0.03;

// --- TIPOS ---
export interface TimeMasterState {
  averageBreakTime: number;
  safeExitTime: number;
  breakTimeHistory: number[];
}

// --- FUNÇÕES HELPER ---
const calculateStdDev = (ticks: TickData[]): number => {
    if (ticks.length < 2) return 0;
    const prices = ticks.map(t => t.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(prices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / prices.length);
    return stdDev;
};


export function useTimeMaster(botCandleData: CandleData[], priceTicks: TickData[]) {
  const [state, setState] = useState<TimeMasterState>({
    averageBreakTime: 45,
    safeExitTime: 35,
    breakTimeHistory: [],
  });

  const indicatorsRef = useRef<Indicators | null>(null);

  // Calcula indicadores de forma eficiente
  useEffect(() => {
    if (botCandleData.length < 50) return;
    indicatorsRef.current = calculateAllIndicators(botCandleData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
  }, [botCandleData]);

  // O ciclo principal do Sentinela
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (priceTicks.length < 20 || !indicatorsRef.current?.atr) {
        return;
      }

      const currentTick = priceTicks[priceTicks.length - 1];
      const tickStdDev = calculateStdDev(priceTicks.slice(-20));
      const currentATR = indicatorsRef.current.atr;

      // Projeta quanto tempo (em segundos) o preço levaria para atingir uma barreira
      // com base na volatilidade instantânea dos ticks e no ATR.
      const barrierMultiplier = BARRIER_INDICES[DEFAULT_GROWTH_RATE.toFixed(2)] || 2.0;
      const tickBarrier = tickStdDev * barrierMultiplier * 1.5; // Multiplicador de segurança
      const atrBarrier = currentATR * barrierMultiplier;

      // Usa a barreira mais conservadora (menor)
      const barrier = Math.min(tickBarrier, atrBarrier);

      const tickVelocity = Math.abs(currentTick.price - priceTicks[priceTicks.length - 2].price) / (currentTick.epoch - priceTicks[priceTicks.length - 2].epoch || 1);
      
      let estimatedTimeToBreak = 45; // Valor padrão
      if (tickVelocity > 0) {
        estimatedTimeToBreak = barrier / tickVelocity;
      }

      // Atualiza o histórico
      setState(prevState => {
        const newHistory = [...prevState.breakTimeHistory, estimatedTimeToBreak].slice(-HISTORY_LENGTH);
        
        const avg = newHistory.reduce((a, b) => a + b, 0) / newHistory.length;
        
        // "Tempo Seguro" é o 25º percentil: 75% das quebras projetadas acontecem depois deste tempo.
        const sortedHistory = [...newHistory].sort((a,b) => a - b);
        const q1Index = Math.floor(sortedHistory.length * 0.25);
        const safeTime = sortedHistory[q1Index] || 35;

        return {
          averageBreakTime: avg,
          safeExitTime: Math.max(15, Math.min(safeTime, 90)), // Limita entre 15s e 90s
          breakTimeHistory: newHistory,
        };
      });

    }, ANALYSIS_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [priceTicks, botCandleData]);

  return state;
}
