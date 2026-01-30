// src/app/volatility-analysis/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useForm, FormProvider, useFormContext } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { TrendingUp, TrendingDown, HelpCircle, Bot, FlaskConical, Target, Info, Brain, Zap, Send, Loader2, ShieldCheck, GitBranch, BarChart, Activity, AlertTriangle, Power, ChevronsUpDown, Settings } from 'lucide-react';
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 as AssetSelector } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChartData, CandleData, Operation, PredictiveTradeLog, OperationInitiator } from '@/lib/types';
import { Progress } from "@/components/ui/progress";
import { TooltipProvider, Tooltip as ShadTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { volatilityTraderSchema, type VolatilityTraderFormValues } from "@/features/trading/components/deriv-trader/volatility-trader-interface.types";
import VolatilityTraderInterface from "@/features/trading/components/deriv-trader/volatility-trader-interface";
import { OperationsLogV2 } from "@/components/deriv-trader/operations-log-v2";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { getConsensusGradientStyle } from '@/features/trading/components/deriv-trader/utils/get-consensus-gradient-style';
import PredictiveLogViewer from '@/components/deriv-trader/PredictiveLogViewer';
import { getPredictiveTradeLogs, savePredictiveTradeLog, savePredictiveModels, loadPredictiveModels, PersistentModelState } from '@/services/financial-data-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { db } from '@/lib/firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import { errorEmitter, FirestorePermissionError } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { useMasterAutopilot } from '@/features/trading/hooks/use-master-autopilot';
import type { AssertivenessData } from '@/features/trading/hooks/use-master-autopilot';
import { BayesianModel, updateBayesianConfidence } from '@/features/trading/services/bayesian-confidence';

// ========================================================
// HELPER FUNCTIONS (ADVANCED MODELS)
// ========================================================
const calculateEMA = (prices: number[], period: number): number[] => {
    if (prices.length < period) return Array(prices.length).fill(prices[0] || 0);
    let result: number[] = [];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for(let i=0; i<period-1; i++) result.push(ema);
    result.push(ema);
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] - ema) * k + ema;
        result.push(ema);
    }
    return result;
};

const calculateStdDev = (data: number[]): number => {
    if (data.length < 2) return 0;
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    return Math.sqrt(data.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / data.length);
};

const calculateLag1Autocorr = (data: number[]): number => {
  if (data.length < 2) return 0;
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  let numerator = 0;
  let denominator = 0;
  for (let i = 1; i < data.length; i++) {
    numerator += (data[i] - mean) * (data[i - 1] - mean);
  }
  for (let i = 0; i < data.length; i++) {
    denominator += Math.pow(data[i] - mean, 2);
  }
  return denominator > 0 ? numerator / denominator : 0;
};

const calculateLag2Autocorr = (data: number[]): number => {
    if (data.length < 3) return 0;
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    let numerator = 0;
    let denominator = 0;
    for (let i = 2; i < data.length; i++) {
        numerator += (data[i] - mean) * (data[i - 2] - mean);
    }
    for (let i = 0; i < data.length; i++) {
        denominator += Math.pow(data[i] - mean, 2);
    }
    return denominator > 0 ? numerator / denominator : 0;
};

const calculateLinearRegression = (prices: number[]): number => {
    const n = prices.length;
    if (n < 2) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += prices[i];
        sumXY += i * prices[i];
        sumX2 += i * i;
    }
    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) return 0;
    return (n * sumXY - sumX * sumY) / denominator;
};


// ========================================================
// PREDICTIVE MODELS
// ========================================================
interface MicrostructureModel {
  predictNextTick: () => {
    expectedPrice: number;
    confidence: number;
    direction: 'RISE' | 'FALL';
  };
}

const createMicrostructureModel = (prices: number[]): MicrostructureModel => {
  const lag1Correlation = calculateLag1Autocorr(prices.slice(-20));
  
  const ema5 = calculateEMA(prices.slice(-10), 5);
  const isOverbought = prices[prices.length - 1] > ema5[ema5.length-1];
  
  const lastChange = prices[prices.length - 1] - prices[prices.length - 2];
  const returns = prices.slice(-10).map((p, i, arr) => i > 0 ? p - arr[i-1] : 0);
  const avgChange = calculateStdDev(returns);
  
  const zScore = avgChange > 0 ? lastChange / avgChange : 0;
  
  const expectedReversion = zScore > 1.5 ? -lastChange * 0.6 : 
                            zScore < -1.5 ? -lastChange * 0.6 : 
                            lastChange * lag1Correlation;
  
  const expectedPrice = prices[prices.length - 1] + expectedReversion;
  
  return {
    predictNextTick: () => ({
      expectedPrice,
      confidence: Math.min(Math.abs(zScore) / 2, 0.95),
      direction: expectedReversion > 0 ? 'RISE' : 'FALL'
    })
  };
};

const createARIMAModel = (prices: number[], horizon: number) => {
    const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i+1]));
    if(returns.length < 3) return prices[prices.length - 1];

    const ar1 = calculateLag1Autocorr(returns);
    const ar2 = calculateLag2Autocorr(returns);

    const sma = calculateEMA(prices, 10);
    const errors = prices.slice(-10).map((p, i) => p - sma[sma.length - 10 + i]);
    const maError = errors.reduce((a, b) => a + b, 0) / errors.length;
    
    const lastReturn = returns[returns.length - 1];
    const prevReturn = returns[returns.length - 2];
    
    const forecastReturn = ar1 * lastReturn + ar2 * prevReturn + 0.3 * maError;
    
    const ema5 = calculateEMA(prices, 5);
    const ema10 = calculateEMA(prices, 10);
    const momentumBoost = ema5[ema5.length-1] > ema10[ema10.length-1] ? 1.2 : 0.8;
    
    return prices[prices.length - 1] * Math.exp(forecastReturn * momentumBoost);
};


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
    const effectivePercentage = Math.max(percentage, 100 - percentage);
    if (effectivePercentage > 75) return 'bg-green-500';
    if (effectivePercentage > 60) return 'bg-blue-500';
    if (effectivePercentage < 55) return 'bg-red-500';
    return 'bg-gray-400';
};

const isCandle = (d: ChartData): d is CandleData => d != null && 'close' in d;

interface StrongestSignal {
    horizon: string;
    direction: 'RISE' | 'FALL' | 'HOLD';
    certaintyScore: number;
    accuracy: number;
}

interface StochasticLabProps {
  realData: ChartData[];
  operationsLog: Operation[];
  onConsensusUpdate: (consensus: any) => void;
  predictiveLogs: PredictiveTradeLog[];
  onDeletePredictiveLog: (logId: string) => void;
  deletingPredictiveLogId: string | null;
}


const StatItem = ({ label, value }: { label: string; value: string | number }) => (
    <div className="flex flex-col p-2 border-l-2 pl-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-bold font-mono">{value}</span>
    </div>
);

const StrongestSignalCard = ({ signal }: { signal: StrongestSignal }) => {
    const isHold = signal.direction === 'HOLD' || signal.certaintyScore === 0;
    const displayAccuracy = Math.max(signal.accuracy, 100 - signal.accuracy);

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
                        Confiança Bayesiana: <span className="font-bold">{displayAccuracy.toFixed(1)}%</span>
                    </p>
                </div>
            )}
        </Card>
    );
};

const ProjectionExpertsPanel = ({ experts }: { experts: { name: string; vote: 'RISE' | 'FALL' | 'HOLD'; accuracy: number }[] }) => (
    <Card className="p-4">
        <CardTitle className="text-sm font-semibold text-muted-foreground mb-3">Confiança dos Especialistas (Bayesiana)</CardTitle>
        <div className="space-y-2">
            {experts.map(({ name, vote, accuracy }) => {
                const effectiveDirection = getEffectiveVote({ accuracy, vote });
                const effectiveAccuracy = Math.max(accuracy, 100 - accuracy);
                
                return (
                    <div key={name} className="flex justify-between items-center bg-background p-2 rounded-md border text-xs">
                        <span className="font-semibold w-12">{name}</span>
                        <div className="flex items-center gap-2 w-24">
                            <Progress value={effectiveAccuracy} className="h-1.5 flex-1" indicatorClassName={getProgressColor(accuracy)} />
                            <span className="font-mono w-10 text-right">{effectiveAccuracy.toFixed(0)}%</span>
                        </div>
                        <span className={cn("font-bold w-10 text-right flex items-center justify-end gap-1", 
                            effectiveDirection === 'RISE' && 'text-green-500', 
                            effectiveDirection === 'FALL' && 'text-red-500',
                            effectiveDirection === 'HOLD' && 'text-gray-400'
                        )}>
                            {effectiveDirection === 'RISE' && <TrendingUp size={12}/>}
                            {effectiveDirection === 'FALL' && <TrendingDown size={12}/>}
                            {effectiveDirection === 'HOLD' && <HelpCircle size={12}/>}
                            {effectiveDirection}
                        </span>
                    </div>
                );
            })}
        </div>
    </Card>
);

function StochasticLab({ 
    realData, 
    operationsLog,
    onConsensusUpdate, 
    predictiveLogs,
    onDeletePredictiveLog,
    deletingPredictiveLogId,
}: StochasticLabProps) {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('prediction');
  
  const [priceData, setPriceData] = useState<any[]>([]);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [returns, setReturns] = useState<any[]>([]);
  const [volatilityData, setVolatilityData] = useState<any[]>([]);
  const [qqData, setQQData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  
  const [futurePaths, setFuturePaths] = useState<Record<string, any[]>>({});
  const [accuracies, setAccuracies] = useState<Record<string, number>>({});
  
  const [bayesianModels, setBayesianModels] = useState<Record<string, BayesianModel>>({});
  
  const pendingPredictionsRef = useRef<Record<string, { startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>>({});
  const lastSaveRef = useRef<number>(0);

  const normalRandom = (): number => {
    let u1 = 0;
    while (u1 === 0) { u1 = Math.random(); }
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  
  const horizons = useMemo(() => [
      { name: '3t', ticks: 3, window: 20 },
      { name: '6t', ticks: 6, window: 20 },
      { name: '10s', ticks: 10, window: 30 },
      { name: '20s', ticks: 20, window: 30 },
      { name: '30s', ticks: 30, window: 50 },
      { name: '40s', ticks: 40, window: 50 },
  ], []);

  // Load models from Firestore on mount
  useEffect(() => {
    if(!user || loading) return;
    loadPredictiveModels(user.uid).then(models => {
        if(models) {
            const loadedBayesianModels: Record<string, BayesianModel> = {};
            Object.keys(models).forEach(key => {
                loadedBayesianModels[key] = models[key].bayesianModel;
            });
            setBayesianModels(loadedBayesianModels);
        }
    });
  }, [user, loading]);

  useEffect(() => {
    const VOL_WINDOW = 50;
    
    if (realData.length < VOL_WINDOW) return;
    
    const prices = realData.map(d => isCandle(d) ? d.close : d.price);
    const logReturns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      if(prices[i-1] > 0) logReturns.push(Math.log(prices[i] / prices[i - 1]));
    }
    
    const lastPriceValue = prices[prices.length - 1];

    const newFuturePaths: Record<string, any[]> = {};
    const newAccuracies = { ...accuracies };

    horizons.forEach(h => {
        if (prices.length <= h.window) return;

        // Ensemble Prediction
        let model1_price, model2_price, model3_price;

        // Model 1: Specialized
        if (h.ticks <= 6) { // Microstructure Model
            const model = createMicrostructureModel(prices);
            model1_price = model.predictNextTick().expectedPrice;
        } else if (h.ticks <= 20) { // ARIMA Model
            model1_price = createARIMAModel(prices, h.ticks);
        } else { // Improved GBM Model
            let path = [{ time: prices.length - 1, price: lastPriceValue }];
            let currentPrice = lastPriceValue;
            
            for (let i = 1; i <= h.ticks; i++) {
                const recentLogReturns = logReturns.slice(-h.window);
                const lastSigma = calculateStdDev(recentLogReturns);

                // Weighted Mean
                const weights = recentLogReturns.map((_, i) => Math.exp(i / recentLogReturns.length));
                const sumWeights = weights.reduce((a, b) => a + b, 0);
                const weightedMean = recentLogReturns.reduce((sum, r, i) => sum + r * weights[i], 0) / sumWeights;

                const recentTrend = recentLogReturns.slice(-5).reduce((a, b) => a + b, 0) / 5;
                const trendStrength = lastSigma > 0 ? Math.abs(recentTrend / lastSigma) : 0;
                const driftAdjustment = trendStrength > 0.5 ? recentTrend * 0.3 : 0;
                
                let regimeAdjustedDrift = weightedMean + driftAdjustment;
                
                const recentVol = calculateStdDev(logReturns.slice(-10));
                const historicVol = calculateStdDev(logReturns.slice(-50));
                if (recentVol > historicVol * 1.3) regimeAdjustedDrift *= 0.7;
                else if (recentVol < historicVol * 0.7) regimeAdjustedDrift *= 1.2;

                const recentHigh = Math.max(...prices.slice(-20));
                const recentLow = Math.min(...prices.slice(-20));
                if (currentPrice > recentHigh * 0.998) regimeAdjustedDrift *= 0.5;
                if (currentPrice < recentLow * 1.002) regimeAdjustedDrift *= 0.5;

                const drift_future = regimeAdjustedDrift;
                const diffusion = lastSigma * normalRandom();
                currentPrice *= Math.exp(drift_future + diffusion);
                path.push({ time: prices.length - 1 + i, price: currentPrice });
            }
            model1_price = path[path.length - 1].price;
            newFuturePaths[`predicted_${h.name}_ahead`] = path.map(p => ({ ...p, [`predicted_${h.name}_ahead`]: p.price }));
        }

        // Model 2: Linear Regression
        const linearTrend = calculateLinearRegression(prices.slice(-10));
        model2_price = prices[prices.length - 1] + linearTrend * h.ticks;

        // Model 3: Null Model (last price)
        model3_price = prices[prices.length-1];

        // Ensemble with static weights for now
        const finalForecastPrice = model1_price * 0.6 + model2_price * 0.3 + model3_price * 0.1;
        
        // --- BAYESIAN UPDATE LOGIC ---
        const currentTimeIndex = prices.length - 1;
        if (!pendingPredictionsRef.current[h.name]) pendingPredictionsRef.current[h.name] = [];

        // Check finished predictions
        const stillPending: any[] = [];
        pendingPredictionsRef.current[h.name].forEach(pred => {
            if (currentTimeIndex >= pred.startTimeIndex + h.ticks) {
                const actualEndPrice = prices[pred.startTimeIndex + h.ticks];
                const predictedDirection = pred.predictedEndPrice > pred.startPrice;
                const actualDirection = actualEndPrice > pred.startPrice;
                const wasCorrect = predictedDirection === actualDirection;

                const modelState = bayesianModels[h.name] || { priorBelief: 0.5, successCount: 0, failureCount: 0, recentPerformance: [] };
                const { updatedModel, currentConfidence } = updateBayesianConfidence(modelState, wasCorrect);
                
                newAccuracies[h.name] = currentConfidence;
                setBayesianModels(prev => ({ ...prev, [h.name]: updatedModel }));

            } else {
                stillPending.push(pred);
            }
        });
        pendingPredictionsRef.current[h.name] = stillPending;
        
        // Add new prediction to pending
        pendingPredictionsRef.current[h.name].push({
            startTimeIndex: currentTimeIndex,
            startPrice: lastPriceValue,
            predictedEndPrice: finalForecastPrice,
        });
    });

    setFuturePaths(newFuturePaths);
    setAccuracies(newAccuracies);
    
    // Save updated models to Firestore periodically
    if(user && Date.now() - lastSaveRef.current > 30000) {
        const modelsToSave: Record<string, PersistentModelState> = {};
        Object.keys(bayesianModels).forEach(key => {
            modelsToSave[key] = {
                horizon: key,
                bayesianModel: bayesianModels[key],
                modelWeights: { w1: 0.6, w2: 0.3, w3: 0.1 }, // Static for now
                lastUpdate: new Date().toISOString()
            };
        });
        savePredictiveModels(user.uid, modelsToSave);
        lastSaveRef.current = Date.now();
    }
  }, [realData, horizons, user]);

  const projectionExperts = useMemo(() => {
    return horizons.map(h => {
      const path = futurePaths[`predicted_${h.name}_ahead`] || [];
      const accuracy = accuracies[h.name] || 50;
      const vote = path.length > 1 ? (path[path.length - 1][`predicted_${h.name}_ahead`] > path[0][`predicted_${h.name}_ahead`] ? 'RISE' : 'FALL') : 'HOLD';
      return { name: h.name, vote, accuracy };
    });
  }, [futurePaths, accuracies, horizons]);

  const strongestSignal = useMemo((): StrongestSignal => {
    let bestSignal: StrongestSignal = { horizon: 'N/A', direction: 'HOLD', certaintyScore: 0, accuracy: 50 };
    let maxCertainty = 0;

    projectionExperts.forEach(p => {
        if (p.vote !== 'HOLD') {
            const certainty = Math.abs(p.accuracy - 50) * 2;
            if (certainty > maxCertainty) {
                maxCertainty = certainty;
                bestSignal = {
                    horizon: p.name,
                    direction: getEffectiveVote(p),
                    certaintyScore: p.accuracy > 50 ? certainty : -certainty,
                    accuracy: p.accuracy,
                };
            }
        }
    });
    return bestSignal;
  }, [projectionExperts]);
  
  useEffect(() => {
    onConsensusUpdate({strongestSignal, projectionExperts});
  }, [strongestSignal, onConsensusUpdate, projectionExperts]);

  const chartDisplayData = useMemo(() => {
    if (realData.length === 0) return [];
    const predictionData = realData.map((d, i) => ({ time: i, real: isCandle(d) ? d.close : d.price }));
    const combined = [...predictionData];
    
    Object.values(futurePaths).forEach(path => {
        path.forEach(point => {
          const existingPointIndex = combined.findIndex(p => p.time === point.time);
          if (existingPointIndex !== -1) {
            combined[existingPointIndex] = { ...combined[existingPointIndex], ...point };
          } else {
            combined.push(point);
          }
        });
    });
    return combined.slice(-200);
  }, [realData, futurePaths]);

  return (
    <Card className="h-full flex flex-col col-span-1 lg:col-span-3">
        <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-purple-600" />
                Laboratório Preditivo (Cientista de IA)
            </CardTitle>
            <CardDescription>O cientista usa um ensemble de modelos para projetar o futuro e medir a própria confiança.</CardDescription>
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
                    
                    {realData.length === 0 ? (
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
                                <h3 className="text-lg font-semibold mb-2">Projeções Futuras (Ensemble)</h3>
                                <ResponsiveContainer width="100%" height={350}>
                                  <LineChart data={chartDisplayData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="time" label={{ value: 'Tempo (ticks)', position: 'insideBottom', offset: -5 }} />
                                    <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} label={{ value: 'Preço', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip />
                                    <Legend />
                                    <Line type="monotone" dataKey="real" stroke="#2563eb" strokeWidth={2.5} dot={false} name="Preço Real" />
                                    {Object.keys(futurePaths).map(key => (
                                        <Line key={key} type="monotone" dataKey={key} stroke="#a16207" strokeWidth={2} strokeDasharray="8 4" dot={false} name={`Projeção (${key.split('_')[1]})`} />
                                    ))}
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            )}
                             {activeTab === 'returns' && ( 
                              <div>
                                <h3 className="text-lg font-semibold mb-2">Distribuição de Retornos (Logarítmicos)</h3>
                                <ResponsiveContainer width="100%" height={350}>
                                  <ScatterChart>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" dataKey="index" name="Tick" />
                                    <YAxis type="number" dataKey="return" name="Retorno" unit="%" domain={['auto', 'auto']} />
                                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                                    <Scatter name="Retorno por Tick" data={returns} fill="#8884d8" />
                                  </ScatterChart>
                                </ResponsiveContainer>
                              </div>
                            )}
                            {activeTab === 'volatility' && (
                               <div>
                                 <h3 className="text-lg font-semibold mb-2">Volatilidade Realizada (Anualizada)</h3>
                                 <ResponsiveContainer width="100%" height={350}>
                                     <LineChart data={volatilityData}>
                                         <CartesianGrid strokeDasharray="3 3" />
                                         <XAxis dataKey="time" />
                                         <YAxis domain={[0, 'dataMax + 2']} unit="%" />
                                         <Tooltip />
                                         <Legend />
                                         <Line type="monotone" dataKey="realizedVol" stroke="#82ca9d" name="Volatilidade" dot={false} />
                                     </LineChart>
                                 </ResponsiveContainer>
                               </div>
                            )}
                            {activeTab === 'qq' && ( 
                                <div>
                                    <h3 className="text-lg font-semibold mb-2">Q-Q Plot: Validação da Normalidade dos Retornos</h3>
                                    <p className="text-sm text-muted-foreground mb-4">Se os pontos seguem a linha vermelha, os retornos do ativo se comportam como uma distribuição normal, validando a premissa do modelo GBM.</p>
                                    <ResponsiveContainer width="100%" height={350}>
                                      <ScatterChart>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis type="number" dataKey="theoretical" name="Quantis Teóricos" />
                                        <YAxis type="number" dataKey="empirical" name="Quantis Empíricos" />
                                        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                                        <Scatter name="Retornos" data={qqData} fill="#8884d8" shape="circle" />
                                      </ScatterChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>
                    )}
                    
                     {stats.observations > 0 && (
                       <Card className="mt-6">
                           <CardHeader><CardTitle>Estatísticas Descritivas dos Retornos</CardTitle></CardHeader>
                           <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <StatItem label="Observações" value={stats.observations} />
                                <StatItem label="Média (log)" value={stats.mean + '%'} />
                                <StatItem label="Desvio Padrão (log)" value={stats.stdDev + '%'} />
                                <StatItem label="Vol. Anualizada" value={stats.annualizedVol + '%'} />
                                <StatItem label="Assimetria (Skewness)" value={stats.skewness} />
                                <StatItem label="Curtose (Kurtosis)" value={stats.kurtosis} />
                           </CardContent>
                       </Card>
                     )}
                    <div className="p-1 mt-6">
                        <PredictiveLogViewer
                            logs={predictiveLogs}
                            onDeleteLog={onDeletePredictiveLog}
                            deletingLogId={deletingPredictiveLogId}
                        />
                    </div>
                </div>
          </ScrollArea>
        </CardContent>
    </Card>
  );
}

const VolatilityAutopilotInterface = ({ 
    autopilot,
    children,
    projectionExperts,
}: { 
    autopilot: ReturnType<typeof useMasterAutopilot>;
    children?: React.ReactNode,
    projectionExperts: {name: string, accuracy: number}[],
}) => {
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
                        checked={autopilot.isAutopilotOn}
                        onCheckedChange={autopilot.toggleAutopilot}
                    />
                </div>
                 <Alert className={cn(
                     "text-sm",
                     autopilot.masterState.trigger.signal === 'HOLD' && "bg-muted/50",
                     autopilot.masterState.trigger.signal !== 'HOLD' && "bg-green-500/10 border-green-500/50 text-green-700",
                 )}>
                    <AlertTitle className="font-semibold">Status do Piloto</AlertTitle>
                    <AlertDescription>
                        {autopilot.masterState.trigger.reason}
                    </AlertDescription>
                </Alert>
                {children}
                <Alert className="mt-4 bg-blue-50 border-blue-200">
                    <AlertTitle className="text-blue-900 font-semibold flex items-center gap-2">
                        <Settings className="h-4 w-4"/>
                        Confiança vs Thresholds
                    </AlertTitle>
                    <AlertDescription>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2 text-xs">
                            {Object.keys(autopilot.riskManager.thresholds).map((horizon) => {
                                const expert = projectionExperts?.find(p => p.name === horizon);
                                const accuracy = expert?.accuracy || 0;
                                const threshold = autopilot.riskManager.thresholds[horizon];
                                const effectiveAccuracy = Math.max(accuracy, 100 - accuracy);
                                const passes = effectiveAccuracy >= threshold;
                                
                                return (
                                    <div key={horizon} className={cn(
                                        "flex flex-col p-2 rounded border",
                                        passes 
                                            ? "bg-green-100 border-green-300 text-green-900" 
                                            : "bg-red-100 border-red-300 text-red-900"
                                    )}>
                                        <div className="font-mono font-bold text-sm">{horizon}</div>
                                        <div className="font-mono text-xs">
                                            {effectiveAccuracy.toFixed(1)}% / {threshold}%
                                        </div>
                                        <div className="text-xs font-bold">
                                            {passes ? '✅ PASSA' : '❌ BLOQUEIA'}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-xs text-muted-foreground mt-3 border-t pt-2">
                            💡 <strong>Verde</strong> = Confiança Efetiva ≥ Limiar | 
                            <strong className="text-red-600"> Vermelho</strong> = Bloqueado
                        </p>
                    </AlertDescription>
                </Alert>
            </CardContent>
        </Card>
    );
}

const Header = () => {
    const { activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading } = useDerivApi();
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left"> Análise de Volatilidade </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div className="flex justify-center">
                    <AssetSelector selectedAsset={activeSymbol || ""} onAssetChange={(asset) => setActiveSymbol(asset)} assetGroups={assetGroups} isAssetsLoading={isAssetsLoading} />
                </div>
                <div className="flex justify-center"> <ApiStatusIndicator /> </div>
            </div>
        </div>
    );
};

const getEffectiveVote = (expert: AssertivenessData | undefined): 'RISE' | 'FALL' | 'HOLD' => {
    if (!expert) return 'HOLD';
    return expert.accuracy > 50 
        ? expert.vote 
        : (expert.vote === 'RISE' ? 'FALL' : (expert.vote === 'FALL' ? 'RISE' : 'HOLD'));
};

const PageContent = () => {
    const { chartData, activeSymbol, operationsLog, sellContract, clearActiveContracts, durationLimits } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();
    const [predictiveLogs, setPredictiveLogs] = useState<PredictiveTradeLog[]>([]);
    const [isLogsLoading, setIsLogsLoading] = useState(true);
    const [deletingPredictiveLogId, setDeletingPredictiveLogId] = useState<string | null>(null);
    const [consensusData, setConsensusData] = useState<any>(null);
    
    const autopilot = useMasterAutopilot();
    const { isAutopilotOn, runAutopilotCycle } = autopilot;
    
    const handleConsensusUpdate = useCallback((data: any) => {
        setConsensusData(data);
        if (isAutopilotOn && data?.projectionExperts) {
            const assertiveness: Record<string, AssertivenessData> = Object.fromEntries(
                data.projectionExperts.map((p: any) => [p.name, { accuracy: p.accuracy, vote: p.vote }])
            );
            runAutopilotCycle(assertiveness);
        }
    }, [isAutopilotOn, runAutopilotCycle]);

    useEffect(() => {
        if (!user) {
            setIsLogsLoading(false);
            return;
        }
        const fetchLogs = async () => {
            setIsLogsLoading(true);
            try {
                const fetched = await getPredictiveTradeLogs(user.uid);
                setPredictiveLogs(fetched.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
            } catch (error) {
                console.error("Failed to fetch predictive logs:", error);
                toast({ title: "Erro ao Carregar Logs", description: "Não foi possível buscar os dados de auditoria preditiva.", variant: "destructive" });
            } finally {
                setIsLogsLoading(false);
            }
        };
        fetchLogs();
    }, [user, toast]);

    const handleDeletePredictiveLog = async (logId: string) => {
        if (!user) return;
        setDeletingPredictiveLogId(logId);
        try {
            const docRef = doc(db, `users/${user.uid}/predictive_logs_v1`, logId);
            await deleteDoc(docRef);
            setPredictiveLogs(prev => prev.filter(log => log.id !== logId));
            toast({ title: "Log Apagado", description: "O registo de auditoria foi removido." });
        } catch (error: any) {
            console.error(`Failed to delete predictive log ${logId}:`, error);
            toast({ title: "Erro ao Apagar", description: error.message || "Não foi possível apagar o registo.", variant: "destructive" });
            errorEmitter.emit('permission-error', new FirestorePermissionError({
                operation: 'delete',
                path: `users/${user.uid}/predictive_logs_v1/${logId}`
            }));
        } finally {
            setDeletingPredictiveLogId(null);
        }
    };

    const handleSyncDuration = () => {
        const { direction, horizon } = consensusData?.strongestSignal || {};
        if (!horizon || horizon === 'N/A' || !durationLimits) {
          toast({ variant: 'destructive', title: 'Nenhum Sinal Forte', description: 'Aguarde um sinal preditivo forte para sincronizar.' });
          return;
        }

        const durationMatch = horizon.match(/(\d+)([st])/);
        let duration: number = 15;
        
        if (durationMatch) {
            const suggestedDuration = parseInt(durationMatch[1], 10);
            const limits = durationLimits['s'];
            if (limits && limits.min > 0) {
                duration = Math.max(limits.min, Math.min(suggestedDuration, limits.max));
            }
        }
        
        form.setValue('duration', duration);

        toast({
          title: 'Duração Sincronizada!',
          description: `Duração definida para ${duration}s, com base no sinal de ${horizon}.`,
        });
    };
    
    const form = useFormContext<VolatilityTraderFormValues>();

    return (
            <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
                <Header />
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    <StochasticLab 
                        realData={chartData} 
                        operationsLog={operationsLog}
                        onConsensusUpdate={handleConsensusUpdate}
                        predictiveLogs={predictiveLogs}
                        onDeletePredictiveLog={handleDeletePredictiveLog}
                        deletingPredictiveLogId={deletingPredictiveLogId}
                    />
                    <div className="lg:col-span-2 space-y-6">
                        <VolatilityTraderInterface 
                          symbol={activeSymbol || ''} 
                          consensus={consensusData?.strongestSignal}
                          onSyncDuration={handleSyncDuration}
                        />
                        <VolatilityAutopilotInterface 
                            autopilot={autopilot}
                            projectionExperts={consensusData?.projectionExperts || []}
                        >
                            <Collapsible className="pt-4">
                                <CollapsibleTrigger asChild>
                                    <Button variant="outline" className="w-full">
                                        <Settings className="h-4 w-4 mr-2"/>
                                        Configurações Avançadas do Piloto
                                    </Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="pt-4 space-y-6">
                                    <Card>
                                        <CardHeader>
                                            <CardTitle className="text-base font-headline">Calibração de Risco e Lógica</CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-6">
                                            <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                                                <Label htmlFor="neighbor-confirmation-switch" className="flex flex-col space-y-1 flex-1 pr-4">
                                                    <span>Confirmação de Vizinhos</span>
                                                    <span className="font-normal text-xs text-muted-foreground">Exigir que dois especialistas vizinhos concordem.</span>
                                                </Label>
                                                <Switch id="neighbor-confirmation-switch" checked={autopilot.isNeighborConfirmationEnabled} onCheckedChange={autopilot.setIsNeighborConfirmationEnabled} disabled={autopilot.isAutopilotOn}/>
                                            </div>
                                            <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                                                <Label htmlFor="macro-trend-switch" className="flex flex-col space-y-1 flex-1 pr-4">
                                                    <span>Verificação de Tendência Macro</span>
                                                    <span className="font-normal text-xs text-muted-foreground">Alinhar trades com a EMA dinâmica. (Ignorado para sinais HF)</span>
                                                </Label>
                                                <Switch id="macro-trend-switch" checked={autopilot.isMacroTrendCheckEnabled} onCheckedChange={autopilot.setIsMacroTrendCheckEnabled} disabled={autopilot.isAutopilotOn}/>
                                            </div>
                                            
                                            <Separator/>

                                            <div className="space-y-2">
                                                <Label htmlFor="hf-threshold-slider">Limiar de Alta Frequência (HF)</Label>
                                                <div className="flex items-center gap-4">
                                                    <Slider
                                                        id="hf-threshold-slider"
                                                        min={5} max={60} step={5}
                                                        value={[autopilot.highFrequencyThreshold]}
                                                        onValueChange={(value) => autopilot.setHighFrequencyThreshold(value[0])}
                                                        disabled={autopilot.isAutopilotOn}
                                                    />
                                                    <span className="font-mono text-primary font-bold">{autopilot.highFrequencyThreshold}s</span>
                                                </div>
                                                <p className="text-xs text-muted-foreground pt-1">Sinais com duração igual ou inferior a este valor ignorarão o filtro de tendência macro.</p>
                                            </div>

                                            <Separator/>

                                            <div className="space-y-2">
                                                <Label htmlFor="global-assertiveness-threshold">Limiar de Confiança Global (%)</Label>
                                                <div className="flex items-center gap-4">
                                                    <Slider
                                                        id="global-assertiveness-threshold"
                                                        min={55} max={95} step={5}
                                                        value={[Object.values(autopilot.riskManager.thresholds)[0] || 80]}
                                                        onValueChange={(value) => autopilot.setGlobalAssertivenessThreshold(value[0])}
                                                        disabled={autopilot.isAutopilotOn}
                                                    />
                                                    <span className="font-mono text-primary font-bold">{Object.values(autopilot.riskManager.thresholds)[0] || 80}%</span>
                                                </div>
                                            </div>
                                            <Separator/>
                                            <div className="space-y-4">
                                                <Label>Calibração Individual por Horizonte</Label>
                                                {Object.keys(autopilot.riskManager.thresholds).map(horizon => (
                                                    <div key={horizon} className="space-y-2">
                                                        <div className="flex justify-between items-center">
                                                            <Label htmlFor={`threshold-${horizon}`} className="text-sm text-muted-foreground">{`Analista ${horizon}`}</Label>
                                                            <span className="font-mono text-primary font-bold">{autopilot.riskManager.thresholds[horizon]}%</span>
                                                        </div>
                                                        <Slider
                                                            id={`threshold-${horizon}`}
                                                            min={50} max={95} step={1}
                                                            value={[autopilot.riskManager.thresholds[horizon] || 80]}
                                                            onValueChange={(value) => autopilot.setIndividualThreshold(horizon, value[0])}
                                                            disabled={autopilot.isAutopilotOn}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </CollapsibleContent>
                            </Collapsible>
                        </VolatilityAutopilotInterface>
                        <OperationsLogV2 operations={operationsLog} sellContract={sellContract} priceTicks={[]} clearActiveContracts={clearActiveContracts}/>
                    </div>
                </div>
            </div>
    );
}

export default function VolatilityAnalysisPage() {
    return (
        <DerivApiProvider>
             <FormProvider {...useForm({ resolver: zodResolver(volatilityTraderSchema), defaultValues: { stake: 1.0, duration: 15 }})}>
                <PageContent />
            </FormProvider>
        </DerivApiProvider>
    );
}
