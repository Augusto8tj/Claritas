// src/features/trading/hooks/use-stochastic-models.ts
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { ChartData, CandleData, TickData, Operation } from '@/lib/types';
import { calculateATR, calculateBBWidth, calculateZScore } from '../services/volatility-forecast';
import type { BacktestResult } from '../backtest/backtest-engine';

// --- TYPE DEFINITIONS ---

export interface ExpertProjection {
    name: string;
    vote: 'RISE' | 'FALL' | 'HOLD';
    wilson: { lower: number; upper: number };
    rawWinRate: number;
    hits: number;
    total: number;
    status: 'active' | 'suspended' | 'permanently_disabled';
    consecutiveLosses: number;
    consecutiveWins: number;
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

export interface MeanReversionSignal {
  zscore: number;
  threshold: number;
  direction: 'LONG' | 'SHORT' | 'HOLD';
  confidence: number;
}

export interface VolatilityRegime {
  type: 'LOW' | 'NORMAL' | 'HIGH';
  atr: number;
  bbWidth: number;
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
const DRIFT_EMA_ALPHA = 0.3;

// --- HELPER FUNCTIONS ---

const isCandle = (d: ChartData): d is CandleData => d != null && 'close' in d;

const bayesianConfidenceInterval = (wins: number, total: number): { lower: number; upper: number; mean: number } => {
    const alpha = wins + 1;
    const beta = (total - wins) + 1;
    const mean = alpha / (alpha + beta);
    if (total < 10) return { mean, lower: 0, upper: 1 };
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    const stdDev = Math.sqrt(variance);
    const z = 1.645;
    return {
        mean,
        lower: Math.max(0, mean - z * stdDev),
        upper: Math.min(1, mean + z * stdDev),
    };
};

const normalRandom = (): number => {
    let u1 = 0;
    while (u1 === 0) u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

const getDecayFactor = (horizonName: string): number => (horizonName.endsWith('t') && parseInt(horizonName.replace('t', '')) <= 10) ? 0.90 : 0.95;

const updateDrift = (currentErrorEma: number, newError: number): number => (newError * DRIFT_EMA_ALPHA) + (currentErrorEma * (1 - DRIFT_EMA_ALPHA));

// --- THE HOOK ---
export function useStochasticModels(
    realData: ChartData[],
    priceTicks: TickData[],
    operationsLog: Operation[],
    initialPerformance: BacktestResult | null
) {
    const [stats, setStats] = useState<MarketStats>({ annualizedVol: '0.0000', skewness: '0.0000', kurtosis: '0.0000' });
    const [assertivenessStats, setAssertivenessStats] = useState<Record<string, { wins: number; total: number; consecutiveLosses: number; consecutiveWins: number; status: 'active' | 'suspended' | 'permanently_disabled'; totalSuspensions: number; }>>({});
    const [expertVotes, setExpertVotes] = useState<Record<string, 'RISE' | 'FALL' | 'HOLD'>>({});
    
    const [meanReversionSignal, setMeanReversionSignal] = useState<MeanReversionSignal>({ zscore: 0, threshold: 2.0, direction: 'HOLD', confidence: 0 });
    const [volatilityRegime, setVolatilityRegime] = useState<VolatilityRegime>({ type: 'NORMAL', atr: 0, bbWidth: 0 });

    const adaptiveDriftRef = useRef<Record<string, number>>({});
    const errorEmaRef = useRef<Record<string, number>>({});
    const assertivenessHistoryRef = useRef<Record<string, boolean[]>>({});
    const pendingPredictionsRef = useRef<Record<string, { startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>>({});

    const horizons = useMemo(() => [
        { name: '1t', ticks: 1, type: 'tick', window: 6 }, { name: '3t', ticks: 3, type: 'tick', window: 6 },
        { name: '6t', ticks: 6, type: 'tick', window: 6 }, { name: '10t', ticks: 10, type: 'tick', window: 10 },
        { name: '15s', ticks: 15, type: 'second', window: 10 }, { name: '20s', ticks: 20, type: 'second', window: 10 },
        { name: '30s', ticks: 30, type: 'second', window: 75 }, { name: '40s', ticks: 40, type: 'second', window: 75 },
        { name: '50s', ticks: 50, type: 'second', window: 75 },
    ], []);

    useEffect(() => {
        const initialStats: Record<string, any> = {};
        horizons.forEach(h => {
            const backtestMetrics = initialPerformance?.metricsByHorizon[h.name];
            const wins = backtestMetrics?.wins || 0;
            const total = backtestMetrics?.total || 0;

            initialStats[h.name] = {
                wins,
                total,
                consecutiveLosses: 0,
                consecutiveWins: 0,
                status: 'active',
                totalSuspensions: 0
            };
            
            if (total > 0) {
                const winsArr = Array(wins).fill(true);
                const lossesArr = Array(total - wins).fill(false);
                assertivenessHistoryRef.current[h.name] = [...winsArr, ...lossesArr];
            }
        });
        setAssertivenessStats(initialStats);
    }, [horizons, initialPerformance]);

    useEffect(() => {
        const candleData = realData.filter(isCandle);
        if (candleData.length < 50) return;
        
        const prices = candleData.map(d => d.close);
        const logReturns: number[] = [];
        for (let i = 1; i < prices.length; i++) if(prices[i-1] > 0) logReturns.push(Math.log(prices[i] / prices[i - 1]));
        
        if (logReturns.length > 1) {
            const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
            const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (logReturns.length - 1);
            const stdDev = Math.sqrt(variance);
            const skewness = logReturns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 3), 0) / logReturns.length;
            const kurtosis = logReturns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 4), 0) / logReturns.length - 3;
            const annualizedVol = stdDev * Math.sqrt(31536000) * 100;
            setStats({ annualizedVol: annualizedVol.toFixed(4), skewness: skewness.toFixed(4), kurtosis: kurtosis.toFixed(4) });
        }
        
        if (priceTicks.length >= 20) {
            const zscoreResult = calculateZScore(priceTicks, 20);
            const zscore = zscoreResult[zscoreResult.length-1];
            if (zscore > 2.0) setMeanReversionSignal({ zscore, threshold: 2.0, direction: 'SHORT', confidence: Math.min(Math.abs(zscore) / 3 * 100, 95) });
            else if (zscore < -2.0) setMeanReversionSignal({ zscore, threshold: -2.0, direction: 'LONG', confidence: Math.min(Math.abs(zscore) / 3 * 100, 95) });
            else setMeanReversionSignal({ zscore, threshold: 0, direction: 'HOLD', confidence: 0 });
        }

        const atr = calculateATR(candleData, 14);
        const avgATR = calculateATR(candleData, 50); 
        const bbWidth = calculateBBWidth(candleData, 20, 2);
        const avgBBWidth = calculateBBWidth(candleData.slice(0, -20), 20, 2); 

        let regimeType: 'LOW' | 'NORMAL' | 'HIGH' = 'NORMAL';
        if (atr > avgATR * 1.5 || bbWidth > avgBBWidth * 1.3) regimeType = 'HIGH';
        else if (atr < avgATR * 0.7) regimeType = 'LOW';
        setVolatilityRegime({ type: regimeType, atr, bbWidth });

        const lastPriceValue = prices[prices.length - 1];
        const lastTime = candleData[candleData.length - 1].epoch;
        const horizonsToUpdateStats = new Set<string>(), newVotes: Record<string, any> = {};

        horizons.forEach(h => {
            const predictionsToProcess = pendingPredictionsRef.current[h.name] || [];
            const updatedPending: any[] = [];
            
            for (const pred of predictionsToProcess) {
                if (prices.length - 1 >= pred.startTimeIndex + h.ticks) {
                    const actualEndPrice = prices[pred.startTimeIndex + h.ticks];
                    if (actualEndPrice !== undefined) {
                        const predictionError = actualEndPrice - pred.predictedEndPrice;
                        errorEmaRef.current[h.name] = updateDrift(errorEmaRef.current[h.name] || 0, predictionError);
                        adaptiveDriftRef.current[h.name] = (adaptiveDriftRef.current[h.name] * getDecayFactor(h.name)) + (ADAPTIVE_DRIFT_LEARNING_RATE * errorEmaRef.current[h.name]);
                        const isWin = (pred.predictedEndPrice > pred.startPrice) === (actualEndPrice > pred.startPrice);
                        assertivenessHistoryRef.current[h.name] = [...(assertivenessHistoryRef.current[h.name] || []), isWin].slice(-ASSERTIVENESS_HISTORY_LIMIT);
                        horizonsToUpdateStats.add(h.name);
                    }
                } else updatedPending.push(pred);
            }
            pendingPredictionsRef.current[h.name] = updatedPending;
            
            const projectPath = (steps: number) => {
                let currentSimPrice = lastPriceValue; let path = [{ time: lastTime, price: lastPriceValue }];
                const drift = Math.max(-DRIFT_LIMIT, Math.min(DRIFT_LIMIT, adaptiveDriftRef.current[h.name] || 0));
                for (let i = 1; i <= steps; i++) {
                    currentSimPrice *= Math.exp(((GBM_DRIFT_TERM + drift)) + (GBM_SIGMA * normalRandom()));
                    path.push({ time: lastTime + i, price: currentSimPrice });
                } return path;
            };
            const newPath = projectPath(h.ticks);
            newVotes[h.name] = newPath.length > 1 ? (newPath[newPath.length - 1].price > newPath[0].price ? 'RISE' : 'FALL') : 'HOLD';
            pendingPredictionsRef.current[h.name].push({ startTimeIndex: prices.length - 1, startPrice: newPath[0].price, predictedEndPrice: newPath[h.ticks].price });
        });
        
        setExpertVotes(newVotes);

        if (horizonsToUpdateStats.size > 0) {
            setAssertivenessStats(prev => {
                const newStats = { ...prev };
                horizonsToUpdateStats.forEach(h => {
                    const history = assertivenessHistoryRef.current[h] || [];
                    const lastResult = history[history.length - 1];
                    let { consecutiveLosses, consecutiveWins, status, totalSuspensions } = prev[h];
                    if (status === 'permanently_disabled') { newStats[h] = prev[h]; return; }
                    if (lastResult) { consecutiveWins++; consecutiveLosses = 0; if (status === 'suspended' && consecutiveWins >= CONSECUTIVE_WIN_REACTIVATION) status = (totalSuspensions < MAX_SUSPENSIONS_ALLOWED) ? 'active' : 'permanently_disabled'; }
                    else { consecutiveLosses++; consecutiveWins = 0; if (status === 'active' && consecutiveLosses >= CONSECUTIVE_LOSS_LIMIT) { status = 'suspended'; totalSuspensions++; } }
                    newStats[h] = { wins: history.filter(v => v).length, total: history.length, consecutiveLosses, consecutiveWins, status, totalSuspensions };
                });
                return newStats;
            });
        }
    }, [realData, horizons, priceTicks]);

    const projectionExperts: ExpertProjection[] = useMemo(() => {
        return horizons.map(h => {
            const stats = assertivenessStats[h.name] || { wins: 0, total: 0, status: 'active', consecutiveLosses: 0, consecutiveWins: 0, totalSuspensions: 0 };
            const history = assertivenessHistoryRef.current[h.name] || [];
            return { 
                name: h.name, vote: expertVotes[h.name] || 'HOLD', wilson: bayesianConfidenceInterval(stats.wins, stats.total),
                rawWinRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 50, 
                hits: stats.wins, ...stats, lastResult: history[history.length - 1]
            };
        });
    }, [horizons, assertivenessStats, expertVotes]);

    const getEffectiveVote = useCallback((expert: ExpertProjection | undefined): 'RISE' | 'FALL' | 'HOLD' => {
        if (!expert || expert.vote === 'HOLD' || expert.status !== 'active') return 'HOLD';
        if (expert.total < 10) return 'HOLD';
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
                const confidence = p.wilson.lower > 0.5 ? p.wilson.lower - 0.5 : 0.5 - p.wilson.upper;
                if (confidence > maxConfidence) {
                    maxConfidence = confidence;
                    bestSignal = { horizon: p.name, direction: effectiveVote, certaintyScore: confidence * 200, rawWinRate: p.rawWinRate };
                }
            }
        });
        return bestSignal;
    }, [projectionExperts, getEffectiveVote]);

    return {
        projectionExperts,
        strongestSignal,
        stats,
        adaptiveDrifts: adaptiveDriftRef.current,
        meanReversionSignal,
        volatilityRegime
    };
}
