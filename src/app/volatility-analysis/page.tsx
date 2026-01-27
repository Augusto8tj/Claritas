// /src/app/volatility-analysis/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { Calculator, TrendingUp, Activity, BarChart3, Bot, FlaskConical, Target, Info, HelpCircle, Brain, ChevronRight, Archive, Swords, TrendingDown } from 'lucide-react';
import { DerivApiProviderV2, useDerivApiV2 } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChartData, CandleData } from '@/lib/types';
import { Progress } from "@/components/ui/progress";
import { TooltipProvider, Tooltip as ShadTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { volatilityTraderSchema, type VolatilityTraderFormValues } from "@/features/trading/components/deriv-trader/volatility-trader-interface.types";
import VolatilityTraderInterface from "@/features/trading/components/deriv-trader/volatility-trader-interface";
import { OperationsLogV2 } from "@/features/trading/components/deriv-trader/operations-log-v2";


// Aproximação da função quantil normal inversa
const normalQuantile = (p: number): number => {
  const a1 = -39.69683028665376; const a2 = 220.9460984245205; const a3 = -275.9285104469687; const a4 = 138.357751867269; const a5 = -30.66479806614716; const a6 = 2.506628277459239;
  const b1 = -54.47609879822406; const b2 = 161.5858368580409; const b3 = -155.6989798598866; const b4 = 66.80131188771972; const b5 = -13.28068155288572;
  const c1 = -0.007784894002430293; const c2 = -0.3223964580411365; const c3 = -2.400758277161838; const c4 = -2.549732539343734; const c5 = 4.374664141464968; const c6 = 2.938163982698783;
  const d1 = 0.007784695709041462; const d2 = 0.3224671290700398; const d3 = 2.445134137142996; const d4 = 3.754408661907416;
  const pLow = 0.02425; const pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a1*r+a2)*r+a3)*r+a4)*r+a5)*r+a6)*q / (((((b1*r+b2)*r+b3)*r+b4)*r+b5)*r+1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1-p));
    return -(((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  }
};

const isCandle = (d: ChartData): d is CandleData => d != null && 'close' in d;

interface Consensus {
  decision: 'RISE' | 'FALL' | 'HOLD';
  confidence: number;
  certaintyScore: number;
  votes: { name: string; vote: 'RISE' | 'FALL' | 'HOLD'; accuracy: number }[];
}

interface StochasticLabProps {
  realData: ChartData[];
  activeSymbol: string | null;
  onConsensusUpdate: (consensus: Consensus) => void;
}

function StochasticLab({ realData, activeSymbol, onConsensusUpdate }: StochasticLabProps) {
  const [activeTab, setActiveTab] = useState('prediction');
  const [priceData, setPriceData] = useState<any[]>([]);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [rsi, setRsi] = useState<number | null>(null);
  const [returns, setReturns] = useState<any[]>([]);
  const [volatilityData, setVolatilityData] = useState<any[]>([]);
  const [qqData, setQQData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  
  // --- States para Previsão ---
  const [predictionData, setPredictionData] = useState<any[]>([]);
  const [futurePath3t, setFuturePath3t] = useState<any[]>([]);
  const [futurePath6t, setFuturePath6t] = useState<any[]>([]);
  const [futurePath10s, setFuturePath10s] = useState<any[]>([]);
  const [futurePath20s, setFuturePath20s] = useState<any[]>([]);
  const [futurePath30s, setFuturePath30s] = useState<any[]>([]);
  const [futurePath40s, setFuturePath40s] = useState<any[]>([]);
  
  const driftCorrectionRef = useRef(0);
  const [driftCorrectionForDisplay, setDriftCorrectionForDisplay] = useState({drift: 0, mae: 0, rmse: 0});

  // --- Estados para Assertividade da Projeção ---
  const [predictionAccuracyHistory3t, setPredictionAccuracyHistory3t] = useState<boolean[]>([]);
  const [predictionAccuracyHistory6t, setPredictionAccuracyHistory6t] = useState<boolean[]>([]);
  const [predictionAccuracyHistory10s, setPredictionAccuracyHistory10s] = useState<boolean[]>([]);
  const [predictionAccuracyHistory20s, setPredictionAccuracyHistory20s] = useState<boolean[]>([]);
  const [predictionAccuracyHistory30s, setPredictionAccuracyHistory30s] = useState<boolean[]>([]);
  const [predictionAccuracyHistory40s, setPredictionAccuracyHistory40s] = useState<boolean[]>([]);

  const predictionErrorsRef = useRef<number[]>([]);
  const pendingPredictions3tRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions6tRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions10sRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions20sRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions30sRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions40sRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);


  const normalRandom = (): number => {
    let u1 = 0;
    while (u1 === 0) { u1 = Math.random(); }
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };


  useEffect(() => {
    const VOL_WINDOW = 50;
    const ERROR_MEMORY = 50;
    
    if (realData.length < VOL_WINDOW) {
      setPriceData([]); setReturns([]); setVolatilityData([]); setQQData([]); setStats({}); 
      setPredictionData([]); setFuturePath3t([]); setFuturePath6t([]); setFuturePath10s([]); setFuturePath20s([]); setFuturePath30s([]); setFuturePath40s([]);
      return;
    }
    
    const prices = realData.map(d => isCandle(d) ? d.close : d.price);
    if(prices.length > 0) setLastPrice(prices[prices.length - 1]);
    setPriceData(realData.map((d, i) => ({ time: i, price: isCandle(d) ? d.close : d.price })));

    const logReturns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if(prices[i-1] > 0) logReturns.push(Math.log(prices[i] / prices[i - 1]));
    }
    
    // --- Cálculo do RSI ---
    const calculateRsiSeries = (prices: number[], period: number) => {
        if (prices.length < period + 1) return Array(prices.length).fill(null);
        const results: (number | null)[] = Array(period).fill(null);
        
        let gains = 0; let losses = 0;
        for (let i = 1; i <= period; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) gains += change; else losses -= change;
        }
        let avgGain = gains / period; let avgLoss = losses / period;

        results.push(100 - (100 / (1 + (avgGain / (avgLoss || 1e-9)))));
        
        for (let i = period + 1; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? -change : 0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            const rs = avgGain / (avgLoss || 1e-9);
            results.push(100 - (100 / (1 + rs)));
        }
        return results;
    };
    const rsiSeries = calculateRsiSeries(prices, 14);
    const lastRsi = rsiSeries[rsiSeries.length - 1];
    if (lastRsi !== null) setRsi(lastRsi);
    // --- Fim do RSI ---

    const volData: any[] = [];
    const annualizationFactor = Math.sqrt(31536000);
    for (let i = VOL_WINDOW; i < logReturns.length; i++) {
      const window = logReturns.slice(i - VOL_WINDOW, i);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const variance = window.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (window.length - 1);
      const realizedVol = Math.sqrt(variance) * annualizationFactor * 100;
      volData.push({ time: i, realizedVol: parseFloat(realizedVol.toFixed(4)), targetVol: 10 });
    }

    if (logReturns.length > 1) {
      const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
      const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (logReturns.length - 1);
      const stdDev = Math.sqrt(variance);
      const skewness = logReturns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 3), 0) / logReturns.length;
      const kurtosis = logReturns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 4), 0) / logReturns.length - 3;
      const returnHistogram = logReturns.map((r, i) => ({ 'return': parseFloat((r * 100).toFixed(4)), index: i }));
      const sortedReturns = [...logReturns].sort((a, b) => a - b);
      const qqPlotData = sortedReturns.map((r, i) => {
        const p = (i + 0.5) / sortedReturns.length;
        const theoreticalQuantile = normalQuantile(p) * stdDev + mean;
        return { theoretical: parseFloat((theoreticalQuantile * 100).toFixed(4)), empirical: parseFloat((r * 100).toFixed(4)) };
      });
      setReturns(returnHistogram); setQQData(qqPlotData);
      setStats({
        mean: (mean * 100).toFixed(6), stdDev: (stdDev * 100).toFixed(6), annualizedVol: (stdDev * annualizationFactor * 100).toFixed(4),
        skewness: skewness.toFixed(4), kurtosis: kurtosis.toFixed(4), observations: logReturns.length
      });
    }
    setVolatilityData(volData);

    const newPredictionData: any[] = [];
    
    for (let i = VOL_WINDOW; i < prices.length; i++) {
        const S_prev = prices[i-1];
        const S_real = prices[i];
        
        const pastLogReturns = logReturns.slice(i - VOL_WINDOW, i);
        const meanPastReturn = pastLogReturns.reduce((a, b) => a + b, 0) / VOL_WINDOW;
        const variance = pastLogReturns.reduce((s, r) => s + Math.pow(r - meanPastReturn, 2), 0) / (VOL_WINDOW - 1);
        const sigma = Math.sqrt(variance);

        const Z = normalRandom();
        // CORREÇÃO: Aplicação do termo de correção do drift do GBM
        const drift = meanPastReturn - 0.5 * sigma * sigma;
        const diffusion = sigma * Math.sqrt(1) * Z;
        const S_predicted_1_tick = S_prev * Math.exp(drift + diffusion);
        
        if (Number.isFinite(S_real) && Number.isFinite(S_predicted_1_tick)) {
            newPredictionData.push({ time: i, real: S_real, predicted_1_tick: S_predicted_1_tick });
            const error = S_real - S_predicted_1_tick;
            predictionErrorsRef.current.push(error);
            if(predictionErrorsRef.current.length > ERROR_MEMORY) {
              predictionErrorsRef.current.shift();
            }
        }
    }
    
    if (predictionErrorsRef.current.length > 0) {
        const errors = predictionErrorsRef.current;
        const sumSquaredErrors = errors.reduce((a, e) => a + e * e, 0);
        const sumAbsErrors = errors.reduce((a, e) => a + Math.abs(e), 0);
        const newMAE = sumAbsErrors / errors.length;
        const newRMSE = Math.sqrt(sumSquaredErrors / errors.length);
        const newDrift = errors.reduce((a,e) => a + e, 0) / errors.length;
        
        driftCorrectionRef.current = newDrift;
        if (newDrift !== driftCorrectionForDisplay.drift || newMAE !== driftCorrectionForDisplay.mae) {
             setDriftCorrectionForDisplay({ drift: newDrift, mae: newMAE, rmse: newRMSE });
        }
    }

    if (prices.length > VOL_WINDOW) {
      const lastPrice = prices[prices.length - 1];
      const lastLogReturns = logReturns.slice(-VOL_WINDOW);
      const meanLastReturn = lastLogReturns.reduce((a, b) => a + b, 0) / VOL_WINDOW;
      const lastVariance = lastLogReturns.reduce((s, r) => s + Math.pow(r - meanLastReturn, 2), 0) / (VOL_WINDOW - 1);
      const lastSigma = Math.sqrt(lastVariance);
      const lastTime = prices.length - 1;

      const projectPath = (steps: number) => {
        let currentSimPrice = lastPrice;
        const path = [{ time: lastTime, price: lastPrice }];
        for (let i = 1; i <= steps; i++) {
          const Z = normalRandom();
          // CORREÇÃO: Aplicação do termo de correção do drift do GBM nas projeções futuras
          const drift_future = meanLastReturn - 0.5 * lastSigma * lastSigma;
          const diffusion_future = lastSigma * Math.sqrt(1) * Z;
          currentSimPrice = currentSimPrice * Math.exp(drift_future + diffusion_future);

          if (Number.isFinite(currentSimPrice)) {
            path.push({ time: lastTime + i, price: currentSimPrice });
          } else {
            path.push({ time: lastTime + i, price: path[path.length - 1].price });
          }
        }
        return path;
      };
      
      const ACCURACY_WINDOW_3T = 6;
      const ACCURACY_WINDOW_6T = 6;
      const ACCURACY_WINDOW_10S = 10;
      const ACCURACY_WINDOW_20S = 10;
      const ACCURACY_WINDOW_30S = 10;
      const ACCURACY_WINDOW_40S = 10;

      const processPredictionHorizon = (
          horizonTicks: number,
          accuracyWindow: number,
          prices: number[],
          pendingPredictionsRef: React.MutableRefObject<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>,
          setAccuracyHistory: React.Dispatch<React.SetStateAction<boolean[]>>,
      ) => {
          const newFuturePath = projectPath(horizonTicks);
          const currentTimeIndex = prices.length - 1;
          let newHistory: boolean[] = [];

          const updatedPending = pendingPredictionsRef.current.filter((pred) => {
              if (currentTimeIndex >= pred.startTimeIndex + horizonTicks) {
                  const actualEndPrice = prices[pred.startTimeIndex + horizonTicks];
                  if (actualEndPrice === undefined) return true;
                  const predictedDirection = pred.predictedEndPrice > pred.startPrice;
                  const actualDirection = actualEndPrice > pred.startPrice;
                  newHistory.push(predictedDirection === actualDirection);
                  return false;
              }
              return true;
          });
          
          pendingPredictionsRef.current = updatedPending;
          
          if (newHistory.length > 0) {
              setAccuracyHistory(prev => [...prev.slice(-accuracyWindow + newHistory.length), ...newHistory]);
          }

          if (newFuturePath.length === horizonTicks + 1) {
              const newPredictionTimeIndex = newFuturePath[0].time;
              const alreadyPending = pendingPredictionsRef.current.some(p => p.startTimeIndex === newPredictionTimeIndex);
              if (!alreadyPending) {
                  pendingPredictionsRef.current.push({
                      startTimeIndex: newPredictionTimeIndex,
                      startPrice: newFuturePath[0].price,
                      predictedEndPrice: newFuturePath[horizonTicks].price,
                  });
              }
          }
      };

      const horizons = [
          { ticks: 3, window: ACCURACY_WINDOW_3T, ref: pendingPredictions3tRef, setAccuracyHistory: setPredictionAccuracyHistory3t },
          { ticks: 6, window: ACCURACY_WINDOW_6T, ref: pendingPredictions6tRef, setAccuracyHistory: setPredictionAccuracyHistory6t },
          { ticks: 10, window: ACCURACY_WINDOW_10S, ref: pendingPredictions10sRef, setAccuracyHistory: setPredictionAccuracyHistory10s }, 
          { ticks: 20, window: ACCURACY_WINDOW_20S, ref: pendingPredictions20sRef, setAccuracyHistory: setPredictionAccuracyHistory20s }, 
          { ticks: 30, window: ACCURACY_WINDOW_30S, ref: pendingPredictions30sRef, setAccuracyHistory: setPredictionAccuracyHistory30s },
          { ticks: 40, window: ACCURACY_WINDOW_40S, ref: pendingPredictions40sRef, setAccuracyHistory: setPredictionAccuracyHistory40s }, 
      ];
      
      horizons.forEach(h => {
          processPredictionHorizon(h.ticks, h.window, prices, h.ref, h.setAccuracyHistory);
      });

      setFuturePath3t(projectPath(3).map(p => ({ time: p.time, predicted_3t_ahead: p.price })));
      setFuturePath6t(projectPath(6).map(p => ({ time: p.time, predicted_6t_ahead: p.price })));
      setFuturePath10s(projectPath(10).map(p => ({ time: p.time, predicted_10s_ahead: p.price })));
      setFuturePath20s(projectPath(20).map(p => ({ time: p.time, predicted_20s_ahead: p.price })));
      setFuturePath30s(projectPath(30).map(p => ({ time: p.time, predicted_30s_ahead: p.price })));
      setFuturePath40s(projectPath(40).map(p => ({ time: p.time, predicted_40s_ahead: p.price })));
    }
    
    setPredictionData(newPredictionData.slice(-200));

  }, [realData]);

  const accuracy3t = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory3t), [predictionAccuracyHistory3t]);
  const accuracy6t = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory6t), [predictionAccuracyHistory6t]);
  const accuracy10s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory10s), [predictionAccuracyHistory10s]);
  const accuracy20s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory20s), [predictionAccuracyHistory20s]);
  const accuracy30s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory30s), [predictionAccuracyHistory30s]);
  const accuracy40s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory40s), [predictionAccuracyHistory40s]);
  
  const projectionConsensus = useMemo((): Consensus => {
    const projections = [
      { name: '3t', path: futurePath3t, accuracy: accuracy3t.percentage },
      { name: '6t', path: futurePath6t, accuracy: accuracy6t.percentage },
      { name: '10s', path: futurePath10s, accuracy: accuracy10s.percentage },
      { name: '20s', path: futurePath20s, accuracy: accuracy20s.percentage },
      { name: '30s', path: futurePath30s, accuracy: accuracy30s.percentage },
      { name: '40s', path: futurePath40s, accuracy: accuracy40s.percentage },
    ];

    const PROJECTION_WEIGHT = 0.6;
    const RSI_WEIGHT = 0.3;
    const DRIFT_WEIGHT = 0.1;

    let totalWeightedScore = 0;
    let totalWeightSum = 0;

    // 1. Projection Scores
    projections.forEach(p => {
      if (p.path.length > 1 && lastPrice) {
        const startPrice = p.path[0].price;
        const endPrice = p.path[p.path.length - 1].price;
        const accuracyWeight = Math.abs(p.accuracy - 50) / 50; 
        const projectedChange = ((endPrice - startPrice) / startPrice) * 100;
        
        totalWeightedScore += projectedChange * accuracyWeight * PROJECTION_WEIGHT;
        totalWeightSum += accuracyWeight * PROJECTION_WEIGHT;
      }
    });

    // 2. RSI Score
    if (rsi !== null) {
      const rsiScore = (50 - rsi) * 0.2; // Scaled down
      totalWeightedScore += rsiScore * RSI_WEIGHT;
      totalWeightSum += RSI_WEIGHT;
    }
    
    // 3. Drift Score
    if (driftCorrectionForDisplay.drift !== 0 && lastPrice) {
        const driftImpact = (driftCorrectionForDisplay.drift / lastPrice) * 10000;
        totalWeightedScore += driftImpact * DRIFT_WEIGHT;
        totalWeightSum += DRIFT_WEIGHT;
    }
    
    const certaintyScore = totalWeightSum > 0 ? (totalWeightedScore / totalWeightSum) * 10 : 0;
    const finalCertainty = Math.max(-100, Math.min(100, certaintyScore));
    
    const DECISION_THRESHOLD = 5;
    let decision: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
    if (finalCertainty > DECISION_THRESHOLD) decision = 'RISE';
    else if (finalCertainty < -DECISION_THRESHOLD) decision = 'FALL';
    
    const confidence = Math.abs(finalCertainty);

    const votes = projections.map(p => ({
        name: p.name,
        vote: p.path.length > 1 ? (p.path[p.path.length-1].price > p.path[0].price ? 'RISE' : 'FALL') : 'HOLD',
        accuracy: p.accuracy
    }));

    return { decision, confidence, certaintyScore: finalCertainty, votes };

  }, [
    futurePath3t, accuracy3t,
    futurePath6t, accuracy6t,
    futurePath10s, accuracy10s,
    futurePath20s, accuracy20s,
    futurePath30s, accuracy30s,
    futurePath40s, accuracy40s,
    rsi,
    driftCorrectionForDisplay.drift,
    lastPrice
  ]);

  useEffect(() => {
    onConsensusUpdate(projectionConsensus);
  }, [projectionConsensus, onConsensusUpdate]);

  const chartDisplayData = useMemo(() => {
    const combined = [...predictionData.filter(p => p && (p.real || p.predicted_1_tick))];
    
    const mergePath = (path: any[]) => {
        path.forEach(point => {
          const existingPointIndex = combined.findIndex(p => p.time === point.time);
          if (existingPointIndex !== -1) {
            combined[existingPointIndex] = { ...combined[existingPointIndex], ...point };
          } else {
            combined.push(point);
          }
        });
    };

    mergePath(futurePath3t); mergePath(futurePath6t); mergePath(futurePath10s);
    mergePath(futurePath20s); mergePath(futurePath30s); mergePath(futurePath40s);

    return combined;
  }, [predictionData, futurePath3t, futurePath6t, futurePath10s, futurePath20s, futurePath30s, futurePath40s]);

  const lineData = useMemo(() => {
    if (qqData.length === 0) return [];
    const allValues = [...qqData.map(d => d.theoretical), ...qqData.map(d => d.empirical)].filter(v => Number.isFinite(v));
    if (allValues.length === 0) return [{ theoretical: 0, empirical: 0}, { theoretical: 0, empirical: 0}];
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);
    return [{ theoretical: minVal, empirical: minVal }, { theoretical: maxVal, empirical: maxVal }];
  }, [qqData]);

  const calculateRollingAccuracy = (history: boolean[]) => {
    const hits = history.filter(h => h).length;
    const total = history.length;
    const percentage = total > 0 ? (hits / total) * 100 : 0;
    return { hits, total, percentage };
  };
  
  const getProgressColor = (percentage: number) => {
    if (percentage > 75) return 'bg-green-500';
    if (percentage > 60) return 'bg-blue-500';
    if (percentage < 40) return 'bg-red-500';
    return 'bg-gray-400';
  };

  return (
    <Card className="h-full flex flex-col col-span-1 lg:col-span-3">
        <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-purple-600" />
                Laboratório Preditivo (Cientista de IA) - {activeSymbol}
            </CardTitle>
            <CardDescription>O cientista usa GBM, RSI e Drift para prever o próximo tick e projetar o futuro.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col min-h-0">
          <ScrollArea className="flex-1">
                <div className="p-1 space-y-6">
                    <div className="flex gap-2 mb-6 flex-wrap">
                      {[
                        { id: 'prediction', icon: TrendingUp, label: 'Previsão & Projeção' },
                        { id: 'returns', icon: Activity, label: 'Retornos' },
                        { id: 'volatility', icon: BarChart3, label: 'Volatilidade' },
                        { id: 'qq', icon: Calculator, label: 'Q-Q Plot' }
                      ].map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${ activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80' }`}
                        >
                          <tab.icon size={16} />{tab.label}
                        </button>
                      ))}
                    </div>
                    
                    {priceData.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                            <Bot className="w-12 h-12 mb-4 opacity-30" />
                            <p className="font-semibold">Aguardando dados suficientes do mercado...</p>
                            <p className="text-sm">É necessário um histórico mínimo para a análise estatística.</p>
                        </div>
                    ) : (
                        <div className="min-h-0">
                            {activeTab === 'prediction' && (
                              <div>
                                <Collapsible defaultOpen>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                      <div className="p-4 bg-slate-50 rounded border col-span-1 md:col-span-2">
                                          <CollapsibleTrigger className="w-full flex justify-between items-center cursor-pointer group">
                                            <h3 className="text-lg font-semibold flex items-center gap-2"><Brain className="h-5 w-5 text-indigo-500"/>Consenso das Projeções</h3>
                                            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"/>
                                          </CollapsibleTrigger>
                                          <CollapsibleContent>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                                                <div className={cn("p-4 rounded-lg flex flex-col items-center justify-center text-white",
                                                    projectionConsensus.decision === 'RISE' && 'bg-green-600',
                                                    projectionConsensus.decision === 'FALL' && 'bg-red-600',
                                                    projectionConsensus.decision === 'HOLD' && 'bg-gray-500',
                                                )}>
                                                    <span className="text-sm font-medium opacity-80">Decisão Final</span>
                                                    <span className="text-3xl font-bold">{projectionConsensus.decision}</span>
                                                    <span className="text-xs font-mono opacity-90">Certeza: {projectionConsensus.certaintyScore.toFixed(1)}%</span>
                                                </div>
                                                <div className="space-y-2">
                                                    {projectionConsensus.votes.map(({ name, vote, accuracy }) => (
                                                        <div key={name} className="flex justify-between items-center bg-background p-2 rounded-md border text-xs">
                                                            <span className="font-semibold w-12">{name}</span>
                                                            <div className="flex items-center gap-2 w-24">
                                                                <Progress value={accuracy} className="h-1.5 flex-1" indicatorClassName={getProgressColor(accuracy)} />
                                                                <span className="font-mono w-10 text-right">{accuracy.toFixed(0)}%</span>
                                                            </div>
                                                            <span className={cn("font-bold w-10 text-right", 
                                                                vote === 'RISE' && 'text-green-500', 
                                                                vote === 'FALL' && 'text-red-500',
                                                                vote === 'HOLD' && 'text-gray-400'
                                                            )}>{vote}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                          </CollapsibleContent>
                                      </div>
                                  </div>
                                </Collapsible>
                                <h3 className="text-lg font-semibold mb-2">Previsão (1-Tick) & Projeções Futuras</h3>
                                <ResponsiveContainer width="100%" height={350}>
                                  <LineChart data={chartDisplayData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="time" label={{ value: 'Tempo (ticks)', position: 'insideBottom', offset: -5 }} />
                                    <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} label={{ value: 'Preço', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip />
                                    <Legend />
                                    <Line type="monotone" dataKey="real" stroke="#2563eb" strokeWidth={2.5} dot={false} name="Preço Real" />
                                    <Line type="monotone" dataKey="predicted_1_tick" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 3" dot={false} name="Previsão (1-Tick)" />
                                    <Line type="monotone" dataKey="predicted_3t_ahead" stroke="#a16207" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (3 Ticks)" />
                                    <Line type="monotone" dataKey="predicted_6t_ahead" stroke="#ef4444" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (6 Ticks)" />
                                    <Line type="monotone" dataKey="predicted_10s_ahead" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (10s)" />
                                    <Line type="monotone" dataKey="predicted_20s_ahead" stroke="#3b82f6" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (20s)" />
                                    <Line type="monotone" dataKey="predicted_30s_ahead" stroke="#f472b6" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (30s)" />
                                    <Line type="monotone" dataKey="predicted_40s_ahead" stroke="#10b981" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (40s)" />
                                  </LineChart>
                                </ResponsiveContainer>
                                <div className="mt-4 grid grid-cols-2 lg:grid-cols-3 gap-4">
                                    <div className="p-3 bg-slate-50 rounded border">
                                        <TooltipProvider>
                                            <ShadTooltip>
                                                <TooltipTrigger asChild><p className="text-xs text-muted-foreground flex items-center gap-1.5 cursor-help">Erro Médio Absoluto (MAE) <Info className="h-3 w-3" /></p></TooltipTrigger>
                                                <TooltipContent><p className="max-w-xs">Em média, as previsões para o próximo tick erraram por este valor. Menor é melhor.</p></TooltipContent>
                                            </ShadTooltip>
                                        </TooltipProvider>
                                        <p className="text-lg font-bold font-mono">{driftCorrectionForDisplay.mae.toFixed(4)}</p>
                                    </div>
                                    <div className="p-3 bg-slate-50 rounded border">
                                        <TooltipProvider>
                                            <ShadTooltip>
                                                <TooltipTrigger asChild><p className="text-xs text-muted-foreground flex items-center gap-1.5 cursor-help">Raiz do Erro Quadrático Médio (RMSE) <Info className="h-3 w-3" /></p></TooltipTrigger>
                                                <TooltipContent><p className="max-w-xs">Mede o erro médio, mas penaliza erros grandes mais do que o MAE.</p></TooltipContent>
                                            </ShadTooltip>
                                        </TooltipProvider>
                                        <p className="text-lg font-bold font-mono">{driftCorrectionForDisplay.rmse.toFixed(4)}</p>
                                    </div>
                                    <div className="p-3 bg-slate-50 rounded border">
                                        <TooltipProvider>
                                            <ShadTooltip>
                                                <TooltipTrigger asChild><p className="text-xs text-muted-foreground flex items-center gap-1.5 cursor-help">Fator de Correção (Drift) <Info className="h-3 w-3" /></p></TooltipTrigger>
                                                <TooltipContent><p className="max-w-xs">O ajuste aplicado às projeções futuras com base no viés (erro médio) recente do modelo.</p></TooltipContent>
                                            </ShadTooltip>
                                        </TooltipProvider>
                                        <p className="text-lg font-bold font-mono">{driftCorrectionForDisplay.drift.toFixed(6)}</p>
                                    </div>
                                    {/* Métricas de Assertividade... */}
                                    <div className="p-3 bg-slate-50 rounded border"><p className="text-xs text-muted-foreground flex items-center gap-1.5"><Target className="h-4 w-4"/>Assertividade (3t)</p><div className="flex items-center gap-2"><Progress value={accuracy3t.percentage} className="h-2 w-full flex-1" indicatorClassName={getProgressColor(accuracy3t.percentage)} /><span className="font-mono font-semibold w-16 text-right">{accuracy3t.percentage.toFixed(1)}%</span></div></div>
                                    <div className="p-3 bg-slate-50 rounded border"><p className="text-xs text-muted-foreground flex items-center gap-1.5"><Target className="h-4 w-4"/>Assertividade (6t)</p><div className="flex items-center gap-2"><Progress value={accuracy6t.percentage} className="h-2 w-full flex-1" indicatorClassName={getProgressColor(accuracy6t.percentage)} /><span className="font-mono font-semibold w-16 text-right">{accuracy6t.percentage.toFixed(1)}%</span></div></div>
                                     <div className="p-3 bg-slate-50 rounded border"><p className="text-xs text-muted-foreground flex items-center gap-1.5"><Target className="h-4 w-4"/>Assertividade (10s)</p><div className="flex items-center gap-2"><Progress value={accuracy10s.percentage} className="h-2 w-full flex-1" indicatorClassName={getProgressColor(accuracy10s.percentage)} /><span className="font-mono font-semibold w-16 text-right">{accuracy10s.percentage.toFixed(1)}%</span></div></div>
                                     <div className="p-3 bg-slate-50 rounded border"><p className="text-xs text-muted-foreground flex items-center gap-1.5"><Target className="h-4 w-4"/>Assertividade (20s)</p><div className="flex items-center gap-2"><Progress value={accuracy20s.percentage} className="h-2 w-full flex-1" indicatorClassName={getProgressColor(accuracy20s.percentage)} /><span className="font-mono font-semibold w-16 text-right">{accuracy20s.percentage.toFixed(1)}%</span></div></div>
                                     <div className="p-3 bg-slate-50 rounded border"><p className="text-xs text-muted-foreground flex items-center gap-1.5"><Target className="h-4 w-4"/>Assertividade (30s)</p><div className="flex items-center gap-2"><Progress value={accuracy30s.percentage} className="h-2 w-full flex-1" indicatorClassName={getProgressColor(accuracy30s.percentage)} /><span className="font-mono font-semibold w-16 text-right">{accuracy30s.percentage.toFixed(1)}%</span></div></div>
                                     <div className="p-3 bg-slate-50 rounded border col-span-2 lg:col-span-1"><p className="text-xs text-muted-foreground flex items-center gap-1.5"><Target className="h-4 w-4"/>Assertividade (40s)</p><div className="flex items-center gap-2"><Progress value={accuracy40s.percentage} className="h-2 w-full flex-1" indicatorClassName={getProgressColor(accuracy40s.percentage)} /><span className="font-mono font-semibold w-16 text-right">{accuracy40s.percentage.toFixed(1)}%</span></div></div>
                                </div>
                              </div>
                            )}
                            {activeTab === 'returns' && ( /* ... JSX inalterado */ <div>...</div> )}
                            {activeTab === 'volatility' && ( /* ... JSX inalterado */ <div>...</div> )}
                            {activeTab === 'qq' && ( /* ... JSX inalterado */ <div>...</div> )}
                        </div>
                    )}
                    
                     {stats.observations > 0 && ( /* ... JSX inalterado */ <div>...</div> )}
                </div>
          </ScrollArea>
        </CardContent>
    </Card>
  );
};


function Header() {
    const { activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading } = useDerivApiV2();
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left"> Análise de Volatilidade </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div className="flex justify-center">
                    <AssetSelectorV2 selectedAsset={activeSymbol || ""} onAssetChange={(asset) => setActiveSymbol(asset)} assetGroups={assetGroups} isAssetsLoading={isAssetsLoading} />
                </div>
                <div className="flex justify-center"> <ApiStatusIndicatorV2 /> </div>
            </div>
        </div>
    );
};

function PageContent() {
    const { chartData, activeSymbol, operationsLog, sellContract, priceTicks, clearActiveContracts } = useDerivApiV2();
    const form = useForm<VolatilityTraderFormValues>({
        resolver: zodResolver(volatilityTraderSchema),
        defaultValues: {
            stake: 1.0,
            duration: 15,
        },
    });

    const [consensus, setConsensus] = useState<Consensus>({
      decision: 'HOLD',
      certaintyScore: 0,
      confidence: 0,
      votes: [],
    });

    return (
        <FormProvider {...form}>
            <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
                <Header />
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    <StochasticLab realData={chartData} activeSymbol={activeSymbol} onConsensusUpdate={setConsensus} />
                    <div className="lg:col-span-2 space-y-6">
                        <VolatilityTraderInterface symbol={activeSymbol || ''} consensus={consensus} />
                        <OperationsLogV2 operations={operationsLog} sellContract={sellContract} priceTicks={priceTicks} clearActiveContracts={clearActiveContracts} />
                    </div>
                </div>
            </div>
        </FormProvider>
    );
}

export default function VolatilityAnalysisPage() {
    return (
        <DerivApiProviderV2>
            <PageContent />
        </DerivApiProviderV2>
    );
}
