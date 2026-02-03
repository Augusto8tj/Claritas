// src/features/trading/hooks/use-stochastic-models.ts
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { ChartData, CandleData } from '@/lib/types';

// --- TYPE DEFINITIONS ---

export interface ExpertProjection {
    name: string;
    vote: 'RISE' | 'FALL' | 'HOLD';
    wilson: { lower: number; upper: number }; // Kept name for compatibility
    rawWinRate: number;
    hits: number;
    total: number;
    status: 'active' | 'suspended' | 'permanently_disabled';
    consecutiveLosses: number;
    totalSuspensions: number;
    lastResult?: boolean;
}

export interface StrongestSignal {
    horizon: string;
    direction: 'RISE' | 'FALL' | 'HOLD';
    certaintyScore: number;
    rawWinRate: number;
}

export interface MarketStats {
    annualizedVol: string;
    skewness: string;
    kurtosis: string;
}

// --- CONSTANTS ---
const ASSERTIVENESS_HISTORY_LIMIT = 1000;
const CONSECUTIVE_LOSS_LIMIT = 5;
const CONSECUTIVE_WIN_REACTIVATION = 3;
const MAX_SUSPENSIONS_ALLOWED = 3;
const DRIFT_LIMIT = 0.1;
const GBM_SIGMA = 0.10;
const GBM_DRIFT_TERM = - (GBM_SIGMA * GBM_SIGMA) / 2;
const ADAPTIVE_DRIFT_LEARNING_RATE = 0.1;
const DRIFT_EMA_ALPHA = 0.3; // Alpha for error EMA smoothing

// --- HELPER FUNCTIONS ---

const isCandle = (d: ChartData): d is CandleData => d != null && 'close' in d;

// ✅ PROBLEMA #8 CORRIGIDO: Substituído por Intervalo de Confiança Bayesiano
const bayesianConfidenceInterval = (wins: number, total: number): { lower: number; upper: number; mean: number } => {
    // Prior: Beta(1, 1) = Uniforme (sem assumir nada, máxima incerteza inicial)
    const alpha = wins + 1;
    const beta = (total - wins) + 1;
    
    const mean = alpha / (alpha + beta);
    
    // Para poucos dados, o intervalo é muito largo (incerteza alta), o que é o comportamento desejado.
    if (total < 20) {
        return { mean, lower: 0, upper: 1 };
    }
    
    // Usando aproximação normal da distribuição Beta, que é razoável para n > 20
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    const stdDev = Math.sqrt(variance);
    const z = 1.645; // Para um intervalo de confiança de 90%
    
    return {
        mean,
        lower: Math.max(0, mean - z * stdDev),
        upper: Math.min(1, mean + z * stdDev),
    };
};

const normalRandom = (): number => {
    let u1 = 0;
    while (u1 === 0) { u1 = Math.random(); }
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

const getDecayFactor = (horizonName: string): number => {
    if (horizonName.endsWith('t') && parseInt(horizonName.replace('t', '')) <= 10) {
      return 0.90;
    }
    return 0.95;
};

// ✅ PROBLEMA #7 CORRIGIDO: Nova função para atualizar o drift de forma suave
const updateDrift = (currentErrorEma: number, newError: number): number => {
    // A nova EMA do erro é uma média ponderada do novo erro e da EMA anterior
    const newErrorEma = (newError * DRIFT_EMA_ALPHA) + (currentErrorEma * (1 - DRIFT_EMA_ALPHA));
    return newErrorEma;
};


// --- THE HOOK ---
export function useStochasticModels(realData: ChartData[]) {
    const [priceData, setPriceData] = useState<any[]>([]);
    const [stats, setStats] = useState<MarketStats>({ annualizedVol: '0.0000', skewness: '0.0000', kurtosis: '0.0000' });
    const [assertivenessStats, setAssertivenessStats] = useState<Record<string, { wins: number; total: number; consecutiveLosses: number; consecutiveWins: number; status: 'active' | 'suspended' | 'permanently_disabled'; totalSuspensions: number; }>>({});
    const [expertVotes, setExpertVotes] = useState<Record<string, 'RISE' | 'FALL' | 'HOLD'>>({});

    const futurePathsRef = useRef<Record<string, { time: number; price: number }[]>>({});
    const adaptiveDriftRef = useRef<Record<string, number>>({});
    // NOVO: Ref para armazenar a EMA do erro, substituindo o histórico de erros
    const errorEmaRef = useRef<Record<string, number>>({});
    const assertivenessHistoryRef = useRef<Record<string, boolean[]>>({});
    const pendingPredictionsRef = useRef<Record<string, { startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>>({});

    const horizons = useMemo(() => [
        { name: '1t', ticks: 1, type: 'tick', window: 6 },
        { name: '3t', ticks: 3, type: 'tick', window: 6 },
        { name: '6t', ticks: 6, type: 'tick', window: 6 },
        { name: '10t', ticks: 10, type: 'tick', window: 10 },
        { name: '15s', ticks: 15, type: 'second', window: 10 },
        { name: '20s', ticks: 20, type: 'second', window: 10 },
        { name: '30s', ticks: 30, type: 'second', window: 75 },
        { name: '40s', ticks: 40, type: 'second', window: 75 },
        { name: '50s', ticks: 50, type: 'second', window: 75 },
    ], []);

    useEffect(() => {
        const initialStats: Record<string, { wins: number; total: number; consecutiveLosses: number; consecutiveWins: number; status: 'active' | 'suspended' | 'permanently_disabled'; totalSuspensions: number; }> = {};
        const initialPending: Record<string, any[]> = {};
        const initialDrift: Record<string, number> = {};
        const initialErrorEma: Record<string, number> = {};
        const initialAssertivenessHistory: Record<string, boolean[]> = {};
        const initialVotes: Record<string, 'RISE' | 'FALL' | 'HOLD'> = {};

        horizons.forEach(h => {
            initialStats[h.name] = { wins: 0, total: 0, consecutiveLosses: 0, consecutiveWins: 0, status: 'active', totalSuspensions: 0 };
            initialPending[h.name] = [];
            initialDrift[h.name] = 0;
            initialErrorEma[h.name] = 0;
            initialAssertivenessHistory[h.name] = [];
            initialVotes[h.name] = 'HOLD';
        });
        setAssertivenessStats(initialStats);
        setExpertVotes(initialVotes);
        pendingPredictionsRef.current = initialPending;
        adaptiveDriftRef.current = initialDrift;
        errorEmaRef.current = initialErrorEma;
        assertivenessHistoryRef.current = initialAssertivenessHistory;
    }, [horizons]);

    // ✅ PROBLEMA #4 VALIDADO: Adicionada monitorização de memória
    useEffect(() => {
        const interval = setInterval(() => {
            const memoryUsage = Object.keys(assertivenessHistoryRef.current)
                .reduce((sum, key) => sum + (assertivenessHistoryRef.current[key]?.length || 0), 0);
            
            if (memoryUsage > ASSERTIVENESS_HISTORY_LIMIT * horizons.length * 1.1) {
                console.warn(`⚠️ [Stochastic Models] Memory leak detected: ${memoryUsage} items in history ref.`);
            }
        }, 60000); // Check every minute
        
        return () => clearInterval(interval);
    }, [horizons]);


    useEffect(() => {
        const VOL_WINDOW = 50;
        
        if (realData.length < VOL_WINDOW) return;
        
        const prices = realData.map(d => isCandle(d) ? d.close : d.price);
        setPriceData(realData.map((d, i) => ({ time: d.epoch, price: isCandle(d) ? d.close : d.price })));

        const logReturns: number[] = [];
        for (let i = 1; i < prices.length; i++) {
          if(prices[i-1] > 0) logReturns.push(Math.log(prices[i] / prices[i - 1]));
        }
        
        if (logReturns.length > 1) {
          const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
          const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (logReturns.length - 1);
          const stdDev = Math.sqrt(variance);
          const skewness = logReturns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 3), 0) / logReturns.length;
          const kurtosis = logReturns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 4), 0) / logReturns.length - 3;
          const annualizedVol = stdDev * Math.sqrt(31536000) * 100;
          setStats({ annualizedVol: annualizedVol.toFixed(4), skewness: skewness.toFixed(4), kurtosis: kurtosis.toFixed(4) });
        }

        if (prices.length > VOL_WINDOW) {
          const lastPriceValue = prices[prices.length - 1];
          const lastTime = realData[realData.length-1].epoch;

          const projectPath = (steps: number, horizonName: string, horizonType: 'tick' | 'second') => {
              if (lastPriceValue === null) return [];
              let currentSimPrice = lastPriceValue;
              const path = [{ time: lastTime, price: lastPriceValue }];
              
              let driftCorrection = adaptiveDriftRef.current[horizonName] || 0;
              driftCorrection = Math.max(-DRIFT_LIMIT, Math.min(DRIFT_LIMIT, driftCorrection));
              
              const timeStepInSeconds = horizonType === 'tick' ? 2 : 1;

              for (let i = 1; i <= steps; i++) {
                const Z = normalRandom();
                const dt = timeStepInSeconds;
                const exponent = ((GBM_DRIFT_TERM + driftCorrection) * dt) + (GBM_SIGMA * Z * Math.sqrt(dt));
                currentSimPrice *= Math.exp(exponent);
                path.push({ time: lastTime + (i * timeStepInSeconds), price: currentSimPrice });
              }
              return path;
          };

          const newFuturePaths: Record<string, any[]> = {};
          const newAssertivenessData: Record<string, { lastResult: boolean }> = {};
          const horizonsToUpdateStats = new Set<string>();
          const newVotes: Record<string, 'RISE' | 'FALL' | 'HOLD'> = {};

          horizons.forEach(h => {
              const currentTimeIndex = prices.length - 1;
              const predictionsToProcess = pendingPredictionsRef.current[h.name] || [];
              const updatedPending = [];

              for (const pred of predictionsToProcess) {
                  if (currentTimeIndex >= pred.startTimeIndex + h.ticks) {
                      const actualEndPrice = prices[pred.startTimeIndex + h.ticks];
                      if (actualEndPrice !== undefined) {
                          const predictionError = actualEndPrice - pred.predictedEndPrice;
                          
                          // ✅ PROBLEMA #7 CORRIGIDO: Usa EMA para suavizar o erro
                          const currentErrorEma = errorEmaRef.current[h.name] || 0;
                          const newErrorEma = updateDrift(currentErrorEma, predictionError);
                          errorEmaRef.current[h.name] = newErrorEma;

                          const currentDrift = adaptiveDriftRef.current[h.name] || 0;
                          const decayFactor = getDecayFactor(h.name);
                          let newDrift = (currentDrift * decayFactor) + (ADAPTIVE_DRIFT_LEARNING_RATE * newErrorEma);
                          
                          adaptiveDriftRef.current[h.name] = Math.max(-DRIFT_LIMIT, Math.min(DRIFT_LIMIT, newDrift));

                          const predictedDirection = pred.predictedEndPrice > pred.startPrice;
                          const actualDirection = actualEndPrice > pred.startPrice;
                          const isWin = predictedDirection === actualDirection;

                          const assertivenessHistory = assertivenessHistoryRef.current[h.name] || [];
                          assertivenessHistory.push(isWin);
                          // ✅ PROBLEMA #4 VALIDADO: Limita o histórico
                          while (assertivenessHistory.length > ASSERTIVENESS_HISTORY_LIMIT) {
                              assertivenessHistory.shift();
                          }
                          assertivenessHistoryRef.current[h.name] = assertivenessHistory;
                          
                          newAssertivenessData[h.name] = { lastResult: isWin };
                          horizonsToUpdateStats.add(h.name);
                      }
                  } else {
                      updatedPending.push(pred);
                  }
              }
              pendingPredictionsRef.current[h.name] = updatedPending;

              const newPath = projectPath(h.ticks, h.name, h.type);
              newFuturePaths[h.name] = newPath;
              
              newVotes[h.name] = newPath.length > 1 ? (newPath[newPath.length - 1].price > newPath[0].price ? 'RISE' : 'FALL') : 'HOLD';

              if (newPath.length === h.ticks + 1) {
                  const newPredictionTimeIndex = newPath[0].time;
                  if (!pendingPredictionsRef.current[h.name].some(p => p.startTimeIndex === newPredictionTimeIndex)) {
                      pendingPredictionsRef.current[h.name].push({
                          startTimeIndex: currentTimeIndex,
                          startPrice: newPath[0].price,
                          predictedEndPrice: newPath[h.ticks].price,
                      });
                  }
              }
          });
          futurePathsRef.current = newFuturePaths;
          setExpertVotes(newVotes);

            if (horizonsToUpdateStats.size > 0) {
                setAssertivenessStats(prev => {
                    const newStats = { ...prev };
                    horizonsToUpdateStats.forEach(horizonName => {
                        const history = assertivenessHistoryRef.current[horizonName] || [];
                        const { lastResult } = newAssertivenessData[horizonName];
                        const currentExpertStats = (prev[horizonName] || { wins: 0, total: 0, consecutiveLosses: 0, consecutiveWins: 0, status: 'active', totalSuspensions: 0 });
                        let { consecutiveLosses, consecutiveWins, status, totalSuspensions } = currentExpertStats;
                        
                        if (status === 'permanently_disabled') {
                            newStats[horizonName] = currentExpertStats;
                            return;
                        }

                        if (lastResult === true) {
                            consecutiveWins++;
                            consecutiveLosses = 0;
                            if (status === 'suspended' && consecutiveWins >= CONSECUTIVE_WIN_REACTIVATION) {
                                if (totalSuspensions < MAX_SUSPENSIONS_ALLOWED) {
                                    status = 'active';
                                    totalSuspensions++;
                                } else {
                                    status = 'permanently_disabled';
                                }
                            }
                        } else {
                            consecutiveLosses++;
                            consecutiveWins = 0;
                            if (status === 'active' && consecutiveLosses >= CONSECUTIVE_LOSS_LIMIT) {
                                status = 'suspended';
                            }
                        }

                        newStats[horizonName] = {
                            wins: history.filter(v => v).length,
                            total: history.length,
                            consecutiveLosses,
                            consecutiveWins,
                            status,
                            totalSuspensions,
                        };
                    });
                    return newStats;
                });
            }
        }
    }, [realData, horizons]);

    const projectionExperts: ExpertProjection[] = useMemo(() => {
        return horizons.map(h => {
            const vote = expertVotes[h.name] || 'HOLD';
            const stats = assertivenessStats[h.name] || { wins: 0, total: 0, status: 'active', consecutiveLosses: 0, consecutiveWins: 0, totalSuspensions: 0 };
            const { wins, total, status, consecutiveLosses, totalSuspensions } = stats;
            const history = assertivenessHistoryRef.current[h.name] || [];
            const lastResult = history.length > 0 ? history[history.length - 1] : undefined;
            const rawWinRate = total > 0 ? (wins / total) * 100 : 0;
            // ✅ PROBLEMA #8 CORRIGIDO: Usa a nova função bayesiana
            const bayesianCI = bayesianConfidenceInterval(wins, total);

            return { 
                name: h.name, 
                vote, 
                wilson: { lower: bayesianCI.lower, upper: bayesianCI.upper }, // Mantém o nome da propriedade para compatibilidade
                rawWinRate,
                hits: wins, 
                total,
                status,
                consecutiveLosses,
                totalSuspensions,
                lastResult,
            };
        });
    }, [horizons, assertivenessStats, expertVotes]);

    // ✅ PROBLEMA #3 CORRIGIDO: Memoization depende apenas de 'projectionExperts'
    const getEffectiveVote = useCallback((expert: ExpertProjection | undefined): 'RISE' | 'FALL' | 'HOLD' => {
      if (!expert || expert.vote === 'HOLD' || expert.status !== 'active') return 'HOLD';
      if (expert.wilson.lower > 0.5) return expert.vote;
      if (expert.wilson.upper < 0.5) return expert.vote === 'RISE' ? 'FALL' : (expert.vote === 'FALL' ? 'RISE' : 'HOLD');
      return 'HOLD';
    }, []);

    const strongestSignal = useMemo((): StrongestSignal => {
        let bestSignal: StrongestSignal = { horizon: 'N/A', direction: 'HOLD', certaintyScore: 0, rawWinRate: 50 };
        let maxConfidence = 0; 

        projectionExperts.forEach(p => {
            const effectiveVote = getEffectiveVote(p);
            if (effectiveVote !== 'HOLD') {
                const confidence = p.wilson.lower > 0.5 
                    ? p.wilson.lower - 0.5 
                    : 0.5 - p.wilson.upper;
                
                if (confidence > maxConfidence) {
                    maxConfidence = confidence;
                    bestSignal = {
                        horizon: p.name,
                        direction: effectiveVote,
                        certaintyScore: (p.wilson.lower > 0.5 ? p.wilson.lower - 0.5 : 0.5 - p.wilson.upper) * 200,
                        rawWinRate: p.rawWinRate,
                    };
                }
            }
        });
        return bestSignal;
    }, [projectionExperts, getEffectiveVote]);

    return {
        projectionExperts,
        strongestSignal,
        stats,
        adaptiveDrifts: adaptiveDriftRef.current
    };
}
