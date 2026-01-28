// src/app/volatility-analysis/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { TrendingUp, TrendingDown, HelpCircle, Bot, FlaskConical, Target, Info, Brain, Zap, Send, Loader2, ShieldCheck, GitBranch, BarChart, Activity, AlertTriangle, Power, ChevronsUpDown } from 'lucide-react';
import { DerivApiProviderV2, useDerivApiV2 } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChartData, CandleData, Operation, DurationUnit } from '@/lib/types';
import { Progress } from "@/components/ui/progress";
import { TooltipProvider, Tooltip as ShadTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { volatilityTraderSchema, type VolatilityTraderFormValues } from "@/features/trading/components/deriv-trader/volatility-trader-interface.types";
import VolatilityTraderInterface from "@/features/trading/components/deriv-trader/volatility-trader-interface";
import { OperationsLogV2 } from "@/features/trading/components/deriv-trader/operations-log-v2";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { getConsensusGradientStyle } from '@/features/trading/components/deriv-trader/utils/get-consensus-gradient-style';


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

const getProgressColor = (percentage: number) => {
    if (percentage > 75) return 'bg-green-500';
    if (percentage > 60) return 'bg-blue-500';
    if (percentage < 40) return 'bg-red-500';
    return 'bg-gray-400';
};

const isCandle = (d: ChartData): d is CandleData => d != null && 'close' in d;

interface ConfirmationSystem {
  gbmSignal: 'RISE' | 'FALL';
  rsiSignal: 'RISE' | 'FALL' | 'NEUTRAL';
  momentumSignal: 'RISE' | 'FALL' | 'NEUTRAL';
}

interface ConfirmedSignal {
  signal: 'RISE' | 'FALL' | 'NEUTRAL';
  confidenceScore: number;
  reason: string;
}


interface StrongestSignal {
    horizon: string;
    direction: 'RISE' | 'FALL' | 'HOLD';
    certaintyScore: number;
    accuracy: number;
}

interface StochasticLabProps {
  realData: ChartData[];
  operationsLog: Operation[];
  activeSymbol: string | null;
  onConsensusUpdate: (consensus: any) => void;
  isAutopilotOn: boolean;
  setAutopilotStatus: (status: string) => void;
  executeTrade: ReturnType<typeof useDerivApiV2>['executeTrade'];
}

const calculateRollingAccuracy = (history: boolean[]) => {
    const hits = history.filter(h => h).length;
    const total = history.length;
    const percentage = total > 0 ? (hits / total) * 100 : 0;
    return { hits, total, percentage };
};

const AccuracyCard = ({ horizon, accuracyData }: { horizon: string; accuracyData: { hits: number; total: number; percentage: number }}) => {
    const isWinning = accuracyData.percentage > 55;
    const isLosing = accuracyData.percentage < 45;
    const isNeutral = !isWinning && !isLosing;

    return (
        <div className="p-3 bg-background rounded-lg border text-center">
            <p className="text-sm font-semibold text-muted-foreground">{horizon}</p>
            <p className={cn(
                "text-3xl font-bold font-mono",
                isWinning && "text-green-600",
                isLosing && "text-destructive",
                isNeutral && "text-foreground"
            )}>
                {accuracyData.percentage.toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted-foreground">
                ({accuracyData.hits}/{accuracyData.total} acertos)
            </p>
        </div>
    );
};


function StochasticLab({ realData, operationsLog, activeSymbol, onConsensusUpdate, isAutopilotOn, setAutopilotStatus, executeTrade }: StochasticLabProps) {
  const { toast } = useToast();
  const cooldownRef = useRef(false);
  const [activeTab, setActiveTab] = useState('prediction');
  const [priceData, setPriceData] = useState<any[]>([]);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [returns, setReturns] = useState<any[]>([]);
  const [volatilityData, setVolatilityData] = useState<any[]>([]);
  const [qqData, setQQData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  
  const [predictionData, setPredictionData] = useState<any[]>([]);
  const [futurePath3t, setFuturePath3t] = useState<any[]>([]);
  const [futurePath6t, setFuturePath6t] = useState<any[]>([]);
  const [futurePath10t, setFuturePath10t] = useState<any[]>([]);
  const [futurePath20s, setFuturePath20s] = useState<any[]>([]);
  const [futurePath30s, setFuturePath30s] = useState<any[]>([]);
  const [futurePath40s, setFuturePath40s] = useState<any[]>([]);
  
  const [driftCorrectionForDisplay, setDriftCorrectionForDisplay] = useState({drift: 0, mae: 0, rmse: 0});

  const [predictionAccuracyHistory3t, setPredictionAccuracyHistory3t] = useState<boolean[]>([]);
  const [predictionAccuracyHistory6t, setPredictionAccuracyHistory6t] = useState<boolean[]>([]);
  const [predictionAccuracyHistory10t, setPredictionAccuracyHistory10t] = useState<boolean[]>([]);
  const [predictionAccuracyHistory20s, setPredictionAccuracyHistory20s] = useState<boolean[]>([]);
  const [predictionAccuracyHistory30s, setPredictionAccuracyHistory30s] = useState<boolean[]>([]);
  const [predictionAccuracyHistory40s, setPredictionAccuracyHistory40s] = useState<boolean[]>([]);

  const predictionErrorsRef = useRef<number[]>([]);
  const pendingPredictions3tRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions6tRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions10tRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
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
      return;
    }
    
    const prices = realData.map(d => isCandle(d) ? d.close : d.price);
    if(prices.length > 0) setLastPrice(prices[prices.length - 1]);
    setPriceData(realData.map((d, i) => ({ time: i, price: isCandle(d) ? d.close : d.price })));

    const logReturns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if(prices[i-1] > 0) logReturns.push(Math.log(prices[i] / prices[i - 1]));
    }
    
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
        
        const pastLogReturns = logReturns.slice(Math.max(0, i - VOL_WINDOW), i);
        const meanPastReturn = pastLogReturns.reduce((a, b) => a + b, 0) / pastLogReturns.length;
        const variance = pastLogReturns.reduce((s, r) => s + Math.pow(r - meanPastReturn, 2), 0) / (pastLogReturns.length - 1);
        const sigma = Math.sqrt(variance);

        const Z = normalRandom();
        const drift = meanPastReturn;
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
        
        setDriftCorrectionForDisplay(prev => {
            if (prev.drift !== newDrift || prev.mae !== newMAE) {
                return { drift: newDrift, mae: newMAE, rmse: newRMSE };
            }
            return prev;
        });
    }

    if (prices.length > VOL_WINDOW) {
      const lastPriceValue = prices[prices.length - 1];
      const lastLogReturns = logReturns.slice(-VOL_WINDOW);
      const meanLastReturn = lastLogReturns.reduce((a, b) => a + b, 0) / VOL_WINDOW;
      const lastVariance = lastLogReturns.reduce((s, r) => s + Math.pow(r - meanLastReturn, 2), 0) / (VOL_WINDOW - 1);
      const lastSigma = Math.sqrt(lastVariance);
      const lastTime = prices.length - 1;

      const projectPath = (steps: number) => {
        if (lastPriceValue === null) return [];
        let currentSimPrice = lastPriceValue;
        const path = [{ time: lastTime, price: lastPriceValue }];
        for (let i = 1; i <= steps; i++) {
          const Z = normalRandom();
          const drift_future = meanLastReturn;
          const diffusion_future = lastSigma * Z;
          currentSimPrice = currentSimPrice * Math.exp(drift_future + diffusion_future);

          if (Number.isFinite(currentSimPrice)) {
            path.push({ time: lastTime + i, price: currentSimPrice });
          } else {
            path.push({ time: lastTime + i, price: path[path.length - 1].price });
          }
        }
        return path;
      };
      
      const horizons = [
          { name: '3t', ticks: 3, window: 6, ref: pendingPredictions3tRef, setHistory: setPredictionAccuracyHistory3t },
          { name: '6t', ticks: 6, window: 6, ref: pendingPredictions6tRef, setHistory: setPredictionAccuracyHistory6t },
          { name: '10t', ticks: 10, window: 10, ref: pendingPredictions10tRef, setHistory: setPredictionAccuracyHistory10t },
          { name: '20s', ticks: 20, window: 10, ref: pendingPredictions20sRef, setHistory: setPredictionAccuracyHistory20s },
          { name: '30s', ticks: 30, window: 10, ref: pendingPredictions30sRef, setHistory: setPredictionAccuracyHistory30s },
          { name: '40s', ticks: 40, window: 10, ref: pendingPredictions40sRef, setHistory: setPredictionAccuracyHistory40s },
      ];
      
      const processPredictionHorizon = (
          horizonTicks: number,
          accuracyWindow: number,
          prices: number[],
          pendingPredictionsRef: React.MutableRefObject<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>,
          setAccuracyHistory: React.Dispatch<React.SetStateAction<boolean[]>>,
      ) => {
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
      };
      
      horizons.forEach(h => {
          processPredictionHorizon(h.ticks, h.window, prices, h.ref, h.setHistory);
      });
      
      const paths = horizons.map(h => projectPath(h.ticks));

      horizons.forEach((h, index) => {
          const newFuturePath = paths[index];
          if (newFuturePath.length === h.ticks + 1) {
              const newPredictionTimeIndex = newFuturePath[0].time;
              const alreadyPending = h.ref.current.some(p => p.startTimeIndex === newPredictionTimeIndex);
              if (!alreadyPending) {
                  h.ref.current.push({
                      startTimeIndex: newPredictionTimeIndex,
                      startPrice: newFuturePath[0].price,
                      predictedEndPrice: newFuturePath[h.ticks].price,
                  });
              }
          }
      });
      
      setFuturePath3t(paths[0].map(p => ({ time: p.time, predicted_3t_ahead: p.price })));
      setFuturePath6t(paths[1].map(p => ({ time: p.time, predicted_6t_ahead: p.price })));
      setFuturePath10t(paths[2].map(p => ({ time: p.time, predicted_10t_ahead: p.price })));
      setFuturePath20s(paths[3].map(p => ({ time: p.time, predicted_20s_ahead: p.price })));
      setFuturePath30s(paths[4].map(p => ({ time: p.time, predicted_30s_ahead: p.price })));
      setFuturePath40s(paths[5].map(p => ({ time: p.time, predicted_40s_ahead: p.price })));
    }
    
    setPredictionData(newPredictionData.slice(-200));

  }, [realData]);

  const accuracy3t = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory3t), [predictionAccuracyHistory3t]);
  const accuracy6t = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory6t), [predictionAccuracyHistory6t]);
  const accuracy10t = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory10t), [predictionAccuracyHistory10t]);
  const accuracy20s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory20s), [predictionAccuracyHistory20s]);
  const accuracy30s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory30s), [predictionAccuracyHistory30s]);
  const accuracy40s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory40s), [predictionAccuracyHistory40s]);
  
   const projectionExperts = useMemo(() => ([
      { name: '3t', vote: futurePath3t.length > 1 ? (futurePath3t[futurePath3t.length - 1].price > futurePath3t[0].price ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy3t.percentage },
      { name: '6t', vote: futurePath6t.length > 1 ? (futurePath6t[futurePath6t.length - 1].price > futurePath6t[0].price ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy6t.percentage },
      { name: '10t', vote: futurePath10t.length > 1 ? (futurePath10t[futurePath10t.length - 1].price > futurePath10t[0].price ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy10t.percentage },
      { name: '20s', vote: futurePath20s.length > 1 ? (futurePath20s[futurePath20s.length - 1].price > futurePath20s[0].price ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy20s.percentage },
      { name: '30s', vote: futurePath30s.length > 1 ? (futurePath30s[futurePath30s.length - 1].price > futurePath30s[0].price ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy30s.percentage },
      { name: '40s', vote: futurePath40s.length > 1 ? (futurePath40s[futurePath40s.length - 1].price > futurePath40s[0].price ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy40s.percentage },
  ]), [futurePath3t, accuracy3t, futurePath6t, accuracy6t, futurePath10t, accuracy10t, futurePath20s, accuracy20s, futurePath30s, accuracy30s, futurePath40s, accuracy40s]);

  const strongestSignal = useMemo((): StrongestSignal => {
    let bestSignal: StrongestSignal = { horizon: 'N/A', direction: 'HOLD', certaintyScore: 0, accuracy: 50 };
    let maxCertainty = 0;

    projectionExperts.forEach(p => {
        if (p.vote !== 'HOLD') {
            const certainty = Math.abs(p.accuracy - 50) * 2;
            
            if (certainty > maxCertainty) {
                maxCertainty = certainty;
                const direction: 'RISE' | 'FALL' = p.accuracy > 50 ? p.vote : (p.vote === 'RISE' ? 'FALL' : 'RISE');
                bestSignal = {
                    horizon: p.name,
                    direction: direction,
                    certaintyScore: certainty,
                    accuracy: p.accuracy,
                };
            }
        }
    });
    return bestSignal;
  }, [projectionExperts]);

  // --- PILOTO AUTOMÁTICO ---
  useEffect(() => {
    if (!isAutopilotOn || cooldownRef.current || !activeSymbol || !executeTrade) return;

    const activeAutopilotTrade = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');
    if (activeAutopilotTrade) {
        setAutopilotStatus(`Gerindo posição #${activeAutopilotTrade.id}`);
        return;
    }
    
    let tradeExecuted = false;
    for (let i = 1; i < projectionExperts.length; i++) {
        const currentExpert = projectionExperts[i];
        const prevExpert = projectionExperts[i-1];
        
        const currentVote = currentExpert.accuracy > 50 ? currentExpert.vote : (currentExpert.vote === 'RISE' ? 'FALL' : (currentExpert.vote === 'FALL' ? 'RISE' : 'HOLD'));
        const prevVote = prevExpert.accuracy > 50 ? prevExpert.vote : (prevExpert.vote === 'RISE' ? 'FALL' : (prevExpert.vote === 'FALL' ? 'RISE' : 'HOLD'));

        const currentEffectiveAccuracy = Math.max(currentExpert.accuracy, 100 - currentExpert.accuracy);
        const prevEffectiveAccuracy = Math.max(prevExpert.accuracy, 100 - prevExpert.accuracy);

        if (currentEffectiveAccuracy > 70 && prevEffectiveAccuracy > 70 && currentVote === prevVote && currentVote !== 'HOLD') {
            const statusMessage = `Sinal ${currentVote} confirmado por ${prevExpert.name} (${prevEffectiveAccuracy.toFixed(0)}%) e ${currentExpert.name} (${currentEffectiveAccuracy.toFixed(0)}%). Executando...`;
            setAutopilotStatus(statusMessage);
            toast({ title: '🤖 Piloto Automático Ativado!', description: statusMessage });

            const expertName = currentExpert.name;
            const [durationStr] = expertName.split(/[st]/);
            const duration = parseInt(durationStr, 10);

            let durationUnit: DurationUnit;

            if (expertName.endsWith('t')) {
                durationUnit = 't';
            } else {
                durationUnit = 's';
            }

            executeTrade(
                currentVote === 'RISE' ? 'CALL' : 'PUT',
                1.0, // Stake fixo para o piloto
                activeSymbol,
                currentVote.toLowerCase() as 'rise' | 'fall',
                duration,
                durationUnit,
                'Piloto'
            );

            cooldownRef.current = true;
            setTimeout(() => {
                cooldownRef.current = false;
                setAutopilotStatus('Monitorando...');
            }, 60000); // Cooldown de 60 segundos

            tradeExecuted = true;
            break;
        }
    }

    if (!tradeExecuted) {
        setAutopilotStatus('Monitorando...');
    }

  }, [projectionExperts, isAutopilotOn, operationsLog, activeSymbol, executeTrade, setAutopilotStatus, toast]);
  

  useEffect(() => {
    onConsensusUpdate(strongestSignal);
  }, [strongestSignal, onConsensusUpdate]);

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

    mergePath(futurePath3t); mergePath(futurePath6t); mergePath(futurePath10t);
    mergePath(futurePath20s); mergePath(futurePath30s); mergePath(futurePath40s);

    return combined;
  }, [predictionData, futurePath3t, futurePath6t, futurePath10t, futurePath20s, futurePath30s, futurePath40s]);

  const lineData = useMemo(() => {
    if (qqData.length === 0) return [];
    const allValues = [...qqData.map(d => d.theoretical), ...qqData.map(d => d.empirical)].filter(v => Number.isFinite(v));
    if (allValues.length === 0) return [{ theoretical: 0, empirical: 0}, { theoretical: 0, empirical: 0}];
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);
    return [{ theoretical: minVal, empirical: minVal }, { theoretical: maxVal, empirical: maxVal }];
  }, [qqData]);

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
                        { id: 'volatility', icon: BarChart, label: 'Volatilidade' },
                        { id: 'qq', icon: GitBranch, label: 'Q-Q Plot' }
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
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                     <StrongestSignalCard signal={strongestSignal} />
                                     <ProjectionExpertsPanel experts={projectionExperts} />
                                </div>
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
                                    <Line type="monotone" dataKey="predicted_10t_ahead" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (10 Ticks)" />
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
                                </div>
                              </div>
                            )}
                            {activeTab === 'returns' && ( 
                              <div>
                                <h3 className="text-lg font-semibold mb-2">Distribuição de Retornos (Log)</h3>
                                <ResponsiveContainer width="100%" height={300}>
                                  <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" dataKey="index" name="Observation" unit="" label={{ value: 'Observação (Tick)', position: 'insideBottom', offset: -5 }} />
                                    <YAxis type="number" dataKey="return" name="Return" unit="%" label={{ value: 'Retorno (%)', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                                    <Scatter name="Log Returns" data={returns} fill="hsl(var(--primary))" />
                                  </ScatterChart>
                                </ResponsiveContainer>
                              </div>
                            )}
                            {activeTab === 'volatility' && ( 
                                <div>
                                    <h3 className="text-lg font-semibold mb-2">Volatilidade Realizada (Anualizada)</h3>
                                    <ResponsiveContainer width="100%" height={300}>
                                      <LineChart data={volatilityData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="time" label={{ value: 'Tempo (ticks)', position: 'insideBottom', offset: -5 }} />
                                        <YAxis label={{ value: 'Volatilidade Anualizada (%)', angle: -90, position: 'insideLeft' }} domain={[0, 'dataMax + 5']} />
                                        <Tooltip />
                                        <Legend />
                                        <Line type="monotone" dataKey="realizedVol" stroke="hsl(var(--primary))" name="Realizada (Janela 50)" dot={false} />
                                        <Line type="monotone" dataKey="targetVol" stroke="hsl(var(--accent))" name="Alvo" dot={false} strokeDasharray="5 5"/>
                                      </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                            {activeTab === 'qq' && ( 
                                <div>
                                    <h3 className="text-lg font-semibold mb-2">Q-Q Plot (Normalidade dos Retornos)</h3>
                                    <ResponsiveContainer width="100%" height={300}>
                                        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                            <CartesianGrid />
                                            <XAxis type="number" dataKey="theoretical" name="Quantis Teóricos" label={{ value: 'Quantis Teóricos (Normal)', position: 'insideBottom', offset: -5 }} />
                                            <YAxis type="number" dataKey="empirical" name="Quantis da Amostra" label={{ value: 'Quantis Empíricos (Retornos)', angle: -90, position: 'insideLeft' }} />
                                            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                                            <Scatter name="Retornos" data={qqData} fill="hsl(var(--primary))" />
                                            <Line data={lineData} dataKey="empirical" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} legendType="none" />
                                        </ScatterChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>
                    )}
                    
                     {stats.observations > 0 && (
                        <Card className="mt-6">
                            <CardHeader>
                                <CardTitle className="font-headline text-lg">Estatísticas Descritivas dos Retornos</CardTitle>
                                <CardDescription>Análise da distribuição dos log-returns dos últimos {stats.observations} ticks.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                                <div className="p-3 bg-slate-50 rounded border">
                                    <p className="text-xs text-muted-foreground">Média (%)</p>
                                    <p className="text-lg font-bold font-mono">{stats.mean}</p>
                                </div>
                                <div className="p-3 bg-slate-50 rounded border">
                                    <p className="text-xs text-muted-foreground">Desvio Padrão (%)</p>
                                    <p className="text-lg font-bold font-mono">{stats.stdDev}</p>
                                </div>
                                <div className="p-3 bg-slate-50 rounded border">
                                    <p className="text-xs text-muted-foreground">Assimetria (Skewness)</p>
                                    <p className="text-lg font-bold font-mono">{stats.skewness}</p>
                                </div>
                                <div className="p-3 bg-slate-50 rounded border">
                                    <p className="text-xs text-muted-foreground">Curtose (Kurtosis)</p>
                                    <p className="text-lg font-bold font-mono">{stats.kurtosis}</p>
                                </div>
                            </CardContent>
                        </Card>
                     )}
                     
                    <Card className="mt-6">
                        <CardHeader>
                            <CardTitle className="font-headline text-lg flex items-center gap-2">
                                <ShieldCheck className="h-5 w-5 text-blue-500" />
                                Assertividade das Projeções (Taxa de Acerto Direcional)
                            </CardTitle>
                            <CardDescription>
                                Performance histórica de cada especialista temporal em prever a direção correta do preço.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            <AccuracyCard horizon="3 Ticks" accuracyData={accuracy3t} />
                            <AccuracyCard horizon="6 Ticks" accuracyData={accuracy6t} />
                            <AccuracyCard horizon="10 Ticks" accuracyData={accuracy10t} />
                            <AccuracyCard horizon="20 Segundos" accuracyData={accuracy20s} />
                            <AccuracyCard horizon="30 Segundos" accuracyData={accuracy30s} />
                            <AccuracyCard horizon="40 Segundos" accuracyData={accuracy40s} />
                        </CardContent>
                    </Card>
                </div>
          </ScrollArea>
        </CardContent>
    </Card>
  );
};

const StrongestSignalCard = ({ signal }: { signal: StrongestSignal }) => {
    const isHold = signal.direction === 'HOLD' || signal.certaintyScore === 0;
    const displayAccuracy = signal.accuracy > 50 ? signal.accuracy : 100 - signal.accuracy;

    return (
        <Card className={cn("p-4 flex flex-col justify-center", 
            isHold ? 'bg-slate-50' : signal.direction === 'RISE' ? 'bg-green-50' : 'bg-red-50'
        )}>
            <CardTitle className="text-sm font-semibold text-muted-foreground mb-2">Sinal Preditivo Mais Forte</CardTitle>
            {isHold ? (
                <div className="text-center text-muted-foreground">
                    <HelpCircle className="mx-auto h-8 w-8 opacity-50 mb-2"/>
                    <p className="font-bold text-lg">NEUTRO</p>
                    <p className="text-xs">Nenhum especialista com alta certeza.</p>
                </div>
            ) : (
                <div className="text-center">
                    {signal.direction === 'RISE' ? <TrendingUp className="mx-auto h-8 w-8 text-green-500 mb-2" /> : <TrendingDown className="mx-auto h-8 w-8 text-red-500 mb-2" />}
                    <p className={cn("font-bold text-lg", signal.direction === 'RISE' ? 'text-green-600' : 'text-red-600')}>
                        {signal.direction} para {signal.horizon}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        Assertividade do Especialista: <span className="font-bold">{displayAccuracy.toFixed(1)}%</span>
                    </p>
                </div>
            )}
        </Card>
    );
};

const ProjectionExpertsPanel = ({ experts }: { experts: { name: string; vote: 'RISE' | 'FALL' | 'HOLD'; accuracy: number }[] }) => (
    <Card className="p-4">
        <CardTitle className="text-sm font-semibold text-muted-foreground mb-3">Painel dos Especialistas</CardTitle>
        <div className="space-y-2">
            {experts.map(({ name, vote, accuracy }) => {
                const effectiveDirection = accuracy > 50 ? vote : (vote === 'RISE' ? 'FALL' : (vote === 'FALL' ? 'RISE' : 'HOLD'));
                const effectiveAccuracy = accuracy > 50 ? accuracy : 100 - accuracy;
                
                return (
                    <div key={name} className="flex justify-between items-center bg-background p-2 rounded-md border text-xs">
                        <span className="font-semibold w-12">{name}</span>
                        <div className="flex items-center gap-2 w-24">
                            <Progress value={effectiveAccuracy} className="h-1.5 flex-1" indicatorClassName={getProgressColor(effectiveAccuracy)} />
                            <span className="font-mono w-10 text-right">{effectiveAccuracy.toFixed(0)}%</span>
                        </div>
                        <span className={cn("font-bold w-10 text-right flex items-center justify-end gap-1", 
                            effectiveDirection === 'RISE' && 'text-green-500', 
                            effectiveDirection === 'FALL' && 'text-red-500',
                            effectiveDirection === 'HOLD' && 'text-gray-400'
                        )}>
                            {effectiveDirection === 'RISE' && <TrendingUp size={12}/>}
                            {effectiveDirection === 'FALL' && <TrendingDown size={12}/>}
                            {effectiveDirection}
                        </span>
                    </div>
                );
            })}
        </div>
    </Card>
);

function VolatilityAutopilotInterface({ isAutopilotOn, toggleAutopilot, autopilotStatus }: { isAutopilotOn: boolean, toggleAutopilot: (checked: boolean) => void, autopilotStatus: string }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                    <Bot className="h-5 w-5 text-primary" />
                    Piloto Automático Preditivo
                </CardTitle>
                <CardDescription>
                    Executa trades automaticamente com base na confirmação dupla de especialistas.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <Label htmlFor="autopilot-switch" className="font-semibold">Ativar Piloto</Label>
                    <Switch
                        id="autopilot-switch"
                        checked={isAutopilotOn}
                        onCheckedChange={toggleAutopilot}
                    />
                </div>
                 <Alert className={cn(
                     "text-sm",
                     autopilotStatus === 'Pausado' && "bg-muted/50",
                     autopilotStatus.startsWith('Gerindo') && "bg-blue-500/10 border-blue-500/50 text-blue-700",
                     autopilotStatus.startsWith('Sinal') && "bg-green-500/10 border-green-500/50 text-green-700",
                 )}>
                    <AlertTitle className="font-semibold">Status do Piloto</AlertTitle>
                    <AlertDescription>
                        {autopilotStatus}
                    </AlertDescription>
                </Alert>
            </CardContent>
        </Card>
    );
}

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
    const { chartData, activeSymbol, operationsLog, sellContract, priceTicks, clearActiveContracts, executeTrade } = useDerivApiV2();
    const { toast } = useToast();
    const form = useForm<VolatilityTraderFormValues>({
        resolver: zodResolver(volatilityTraderSchema),
        defaultValues: {
            stake: 1.0,
            duration: 15,
        },
    });

    const [confirmedSignal, setConfirmedSignal] = useState<any>({
      direction: 'HOLD',
      certaintyScore: 0,
      horizon: 'N/A',
      accuracy: 50,
    });
    
    // Autopilot State
    const [isAutopilotOn, setIsAutopilotOn] = useState(false);
    const [autopilotStatus, setAutopilotStatus] = useState('Pausado');
    const toggleAutopilot = (checked: boolean) => {
        setIsAutopilotOn(checked);
        setAutopilotStatus(checked ? 'Monitorando...' : 'Pausado');
    };

    const handleSyncDuration = () => {
        const horizon = confirmedSignal.horizon;
        if (!horizon || horizon === 'N/A') {
          toast({ variant: 'destructive', title: 'Nenhum Sinal Forte', description: 'Aguarde um sinal preditivo forte para sincronizar.' });
          return;
        }

        let duration = 5;
        if (horizon.endsWith('s')) {
          duration = parseInt(horizon.replace('s', ''), 10);
        } else if (horizon.endsWith('t')) {
          // Aproximação: 1 tick ~ 2 segundos.
          duration = parseInt(horizon.replace('t', ''), 10) * 2;
        }
        
        // Mínimo de 15 segundos
        const finalDuration = Math.max(15, duration);
        form.setValue('duration', finalDuration);

        toast({
          title: 'Duração Sincronizada!',
          description: `Duração definida para ${finalDuration}s, com base no sinal de ${horizon}.`,
        });
    };

    return (
        <FormProvider {...form}>
            <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
                <Header />
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    <StochasticLab 
                        realData={chartData} 
                        activeSymbol={activeSymbol} 
                        onConsensusUpdate={setConfirmedSignal}
                        isAutopilotOn={isAutopilotOn}
                        setAutopilotStatus={setAutopilotStatus}
                        executeTrade={executeTrade}
                        operationsLog={operationsLog}
                    />
                    <div className="lg:col-span-2 space-y-6">
                        <VolatilityTraderInterface 
                          symbol={activeSymbol || ''} 
                          consensus={confirmedSignal}
                          onSyncDuration={handleSyncDuration}
                        />
                        <VolatilityAutopilotInterface 
                            isAutopilotOn={isAutopilotOn} 
                            toggleAutopilot={toggleAutopilot}
                            autopilotStatus={autopilotStatus}
                        />
                        <OperationsLogV2 operations={operationsLog} sellContract={sellContract} priceTicks={priceTicks} clearActiveContracts={clearActiveContracts}/>
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
