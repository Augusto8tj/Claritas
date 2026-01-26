// src/features/trading/hooks/use-time-master.ts
'use client';

/**
 * @fileOverview O MESTRE DO TEMPO V3 - PREDITOR DE PRIMEIRA PASSAGEM
 *
 * Este hook opera de forma independente, analisando o mercado a cada segundo
 * para projetar o "tempo até a quebra da barreira" usando modelos estocásticos
 * otimizados.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import type { CandleData, TickData } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';

// --- CONFIGURAÇÕES ---
const ANALYSIS_INTERVAL_MS = 1000;
const HISTORY_LENGTH = 180;
const VOLATILITY_WINDOWS = [5, 10, 15, 20, 25, 30];

const BARRIER_INDICES: { [key: string]: number } = {
  '0.01': 0.397,
  '0.02': 0.371,
  '0.03': 0.348,
  '0.04': 0.331,
  '0.05': 0.315,
};
const DEFAULT_GROWTH_RATE = 0.03;

// --- TIPOS ---
export interface VolatilityRegime {
  regime: 'ultra-calm' | 'calm' | 'normal' | 'agitated' | 'volatile';
  confidence: number;
  expectedDuration: number;
}

export interface TimeMasterState {
  averageBreakTime: number;
  safeExitTime: number;
  breakTimeHistory: number[];
  regime: VolatilityRegime;
  instantaneousVolatility: number;
}

// --- FUNÇÕES MATEMÁTICAS ---

/**
 * Estimador de Parkinson para volatilidade realizada
 * Mais eficiente que desvio padrão simples para dados de alta frequência
 */
function parkinsonVolatility(ticks: TickData[], window: number): number {
  if (ticks.length < window) return 0;
  const recentTicks = ticks.slice(-window);
  const high = Math.max(...recentTicks.map(t => t.price));
  const low = Math.min(...recentTicks.map(t => t.price));
  
  if (low <= 0) return 0;
  
  // Fórmula de Parkinson: σ = √[(ln(H/L))² / (4 × ln(2))]
  const volatility = Math.sqrt(
    Math.pow(Math.log(high / low), 2) / (4 * Math.log(2))
  );
  
  return volatility;
}


/**
 * Calcula o tempo esperado até a barreira ser atingida
 * baseado na teoria de primeira passagem de Brownian Motion
 */
function calculateFirstPassageTime(
  barrierDistance: number,
  instantaneousVolatility: number
): number {
  const MIN_VOLATILITY = 1e-9;
  const MAX_TIME_TO_BREAK_S = 300; 

  // CORREÇÃO: Piso de Incerteza para evitar tempos de quebra infinitos.
  const VOLATILITY_FLOOR = 0.00005;
  const effectiveVolatility = Math.max(instantaneousVolatility, MIN_VOLATILITY, VOLATILITY_FLOOR);
  
  const expectedTime = Math.pow(barrierDistance, 2) / 
                       (2 * Math.pow(effectiveVolatility, 2));

  return Math.min(expectedTime, MAX_TIME_TO_BREAK_S);
}


/**
 * Modelo GARCH simplificado para detecção de regime, usando percentis.
 */
function detectVolatilityRegime(
  volatilityHistory: number[],
  currentVol: number
): VolatilityRegime {
    const sortedHistory = [...volatilityHistory].sort((a,b) => a - b);
    const percentile = sortedHistory.length > 0 ? sortedHistory.findIndex(v => v >= currentVol) / sortedHistory.length * 100 : 50;

    if (percentile <= 15) {
        return { regime: 'ultra-calm', confidence: (15 - percentile) / 15, expectedDuration: 75 };
    } else if (percentile <= 35) {
        return { regime: 'calm', confidence: (35 - percentile) / 20, expectedDuration: 55 };
    } else if (percentile <= 65) {
        return { regime: 'normal', confidence: 1 - Math.abs(percentile - 50) / 15, expectedDuration: 40 };
    } else if (percentile <= 85) {
        return { regime: 'agitated', confidence: (percentile - 65) / 20, expectedDuration: 25 };
    } else {
        return { regime: 'volatile', confidence: (percentile - 85) / 15, expectedDuration: 15 };
    }
}


// --- HOOK PRINCIPAL ---
export function useTimeMaster(botCandleData: CandleData[], priceTicks: TickData[]) {
  const [state, setState] = useState<TimeMasterState>({
    averageBreakTime: 45,
    safeExitTime: 35,
    breakTimeHistory: [],
    regime: { regime: 'normal', confidence: 1, expectedDuration: 40 },
    instantaneousVolatility: 0.000562,
  });

  const indicatorsRef = useRef<Indicators | null>(null);
  const volatilityHistoryRef = useRef<number[]>([]);

  useEffect(() => {
    if (botCandleData.length < 50) return;
    indicatorsRef.current = calculateAllIndicators(botCandleData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
  }, [botCandleData]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (priceTicks.length < 30 || !indicatorsRef.current?.atr) {
        return;
      }
      
      const currentATR = indicatorsRef.current.atr;
      
      // 1. Análise Multi-Escala com Parkinson
      const parkinsonVolatilities = VOLATILITY_WINDOWS.map(window => parkinsonVolatility(priceTicks, window));
      const instantaneousVolatility = Math.max(...parkinsonVolatilities);

      // Atualiza histórico de volatilidade
      volatilityHistoryRef.current.push(instantaneousVolatility);
      if (volatilityHistoryRef.current.length > HISTORY_LENGTH) {
        volatilityHistoryRef.current.shift();
      }

      // 2. Detecção de Regime de Volatilidade
      const regime = detectVolatilityRegime(volatilityHistoryRef.current, instantaneousVolatility);

      // 3. Cálculo do Tempo de Primeira Passagem
      const barrierMultiplier = BARRIER_INDICES[DEFAULT_GROWTH_RATE.toFixed(2)] || 0.348;
      const barrierDistance = currentATR * barrierMultiplier;
      const estimatedTimeToBreak = calculateFirstPassageTime(barrierDistance, instantaneousVolatility);

      // Atualiza o histórico de tempo de quebra
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
          regime: regime,
          instantaneousVolatility,
        };
      });

    }, ANALYSIS_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [priceTicks, botCandleData]);

  return state;
}
