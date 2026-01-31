
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
import { OperationsLogV2 } from "@/features/trading/components/deriv-trader/operations-log-v2";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

const createMicrostructureModel = (prices: number[]): {
    expectedPrice: number;
} => {
    if (prices.length < 5) return { expectedPrice: prices[prices.length - 1] || 0 };
    const k = 2 / (3 + 1);
    let ema3 = prices.slice(0, 3).reduce((a,b) => a+b, 0) / 3;
    for(let i=3; i<prices.length; i++) {
        ema3 = (prices[i] - ema3) * k + ema3;
    }
    const prevEma = (prices[prices.length - 2] - ema3) * k + ema3;

    const momentum = (ema3 - prevEma) * 0.8;
    const lastPrice = prices[prices.length - 1];
    const meanReversion = (ema3 - lastPrice) * 0.2;
    
    const expectedChange = momentum + meanReversion;
    return { expectedPrice: lastPrice + expectedChange };
};

const createARIMAModel = (prices: number[], horizon: number) => {
    if (prices.length < 10) return prices[prices.length - 1];
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
        if(prices[i-1] > 0) returns.push(Math.log(prices[i] / prices[i-1]));
    }
    if (returns.length === 0) return prices[prices.length - 1];

    const ar1 = calculateLag1Autocorr(returns);
    const drift = returns.reduce((a,b) => a+b, 0) / returns.length;
    
    const lastReturn = returns[returns.length - 1] || 0;
    
    const forecastReturn = drift + ar1 * (lastReturn - drift);
    
    return prices[prices.length - 1] * Math.exp(forecastReturn);
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

const StrongestSignalCard = ({ signal, ensembleWeights }: { signal: StrongestSignal, ensembleWeights: Record<string, {w1: number, w2: number, w3: number}> }) => {
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
            <Card className="mt-4 p-4">
                <CardTitle className="text-sm mb-2">Performance dos Modelos (Ensemble)</CardTitle>
                <div className="space-y-1 text-xs">
                    {Object.entries(ensembleWeights).map(([horizon, w]) => (
                        <div key={horizon} className="flex justify-between">
                            <span className="font-mono">{horizon}:</span>
                            <span>
                                M1: {(w.w1 * 100).toFixed(0)}% | 
                                M2: {(w.w2 * 100).toFixed(0)}% | 
                                M3: {(w.w3 * 100).toFixed(0)}%
                            </span>
                        </div>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                    M1=Specialist, M2=LinearReg, M3=Null
                </p>
            </Card>
        </Card>
    );
};

const getEffectiveVote = (expert: AssertivenessData | undefined): 'RISE' | 'FALL' | 'HOLD' => {
    if (!expert) return 'HOLD';
    return expert.accuracy > 50 
        ? expert.vote 
        : (expert.vote === 'RISE' ? 'FALL' : (expert.vote === 'FALL' ? 'RISE' : 'HOLD'));
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
  
  const [qqData, setQQData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  
  const [futurePaths, setFuturePaths] = useState<Record<string, any[]>>({});
  const [accuracies, setAccuracies] = useState<Record<string, number>>({});
  
  const [bayesianModels, setBayesianModels] = useState<Record<string, BayesianModel>>({});
  
  const [ensembleWeights, setEnsembleWeights] = useState<Record<string, {w1: number, w2: number, w3: number}>>({});
  const modelErrorsRef = useRef<Record<string, {m1: number[], m2: number[], m3: number[]}>>({});

  const pendingPredictionsRef = useRef<Record<string, { startTimeIndex: number; startPrice: number; predictedEndPrice: number; model1Price: number; model2Price: number; model3Price: number; }[]>>({});
  const lastSaveRef = useRef<number>(0);

  const normalRandom = (): number => {
    let u1 = 0;
    while (u1 === 0) { u1 = Math.random(); }
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  
  const horizons = useMemo(() => [
      { name: '3t', ticks: 3, window: 50 },
      { name: '6t', ticks: 6, window: 50 },
      { name: '10t', ticks: 10, window: 100 },
      { name: '20s', ticks: 20, window: 100 },
      { name: '30s', ticks: 30, window: 75 },
      { name: '40s', ticks: 40, window: 75 },
  ], []);

  useEffect(() => {
    if (Object.keys(bayesianModels).length === 0) {
        const initialModels: Record<string, BayesianModel> = {};
        horizons.forEach(h => {
            const estimatedAccuracy = h.ticks <= 10 ? 0.60 : h.ticks <= 20 ? 0.55 : 0.52;
            const pseudoTrials = 10;
            
            initialModels[h.name] = {
                priorBelief: estimatedAccuracy,
                successCount: Math.floor(estimatedAccuracy * pseudoTrials),
                failureCount: Math.floor((1 - estimatedAccuracy) * pseudoTrials),
                recentPerformance: Array(10).fill(Math.random() < estimatedAccuracy ? 1 : 0)
            };
        });
        setBayesianModels(initialModels);
    }
  }, [horizons, bayesianModels]);

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
      if(prices[i-1] > 0) logReturns.push(Math.log(prices[i] / prices[i-1]));
    }
    
    const lastPriceValue = prices[prices.length - 1];

    const newFuturePaths: Record<string, any[]> = {};
    const newAccuracies = { ...accuracies };
    const newEnsembleWeights: Record<string, {w1: number, w2: number, w3: number}> = {};

    horizons.forEach(h => {
        if (prices.length <= h.window) return;

        let model1_price, model2_price, model3_price;

        if (h.ticks <= 6) { 
            model1_price = createMicrostructureModel(prices).expectedPrice;
        } else if (h.ticks <= 20) {
            model1_price = createARIMAModel(prices, h.ticks);
        } else {
            const recentLogReturns = logReturns.slice(-h.window);
            const volatility = calculateStdDev(recentLogReturns);

            const weights = recentLogReturns.map((_, i) => Math.exp(i / recentLogReturns.length));
            const sumWeights = weights.reduce((a, b) => a + b, 0);
            const weightedMean = sumWeights > 0 ? recentLogReturns.reduce((sum, r, i) => sum + r * weights[i], 0) / sumWeights : 0;
            
            const recentTrend = recentLogReturns.slice(-5).reduce((a, b) => a + b, 0) / 5;
            const lastSigma = volatility; 
            const trendStrength = lastSigma > 0 ? Math.abs(recentTrend / lastSigma) : 0;
            const driftAdjustment = trendStrength > 0.5 ? recentTrend * 0.3 : 0;

            const drift = weightedMean + driftAdjustment;
            const diffusion = volatility * normalRandom();
            const forecastReturn = drift + diffusion;
            model1_price = lastPriceValue * Math.exp(forecastReturn);
        }

        const linearTrend = calculateLinearRegression(prices.slice(-10));
        model2_price = prices[prices.length - 1] + linearTrend * h.ticks;

        model3_price = prices[prices.length-1];

        const currentTimeIndex = prices.length - 1;
        if (!pendingPredictionsRef.current[h.name]) pendingPredictionsRef.current[h.name] = [];
        if (!modelErrorsRef.current[h.name]) modelErrorsRef.current[h.name] = { m1: [], m2: [], m3: [] };

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

                modelErrorsRef.current[h.name].m1.push(Math.abs(actualEndPrice - pred.model1Price));
                modelErrorsRef.current[h.name].m2.push(Math.abs(actualEndPrice - pred.model2Price));
                modelErrorsRef.current[h.name].m3.push(Math.abs(actualEndPrice - pred.model3Price));
                
                if (modelErrorsRef.current[h.name].m1.length > 50) {
                    modelErrorsRef.current[h.name].m1.shift();
                    modelErrorsRef.current[h.name].m2.shift();
                    modelErrorsRef.current[h.name].m3.shift();
                }
            } else {
                stillPending.push(pred);
            }
        });
        pendingPredictionsRef.current[h.name] = stillPending;
        
        let weights = { w1: 0.6, w2: 0.3, w3: 0.1 }; 
        const errors = modelErrorsRef.current[h.name];
        if (errors && errors.m1.length > 10) {
            const avgError1 = errors.m1.reduce((a, b) => a + b, 0) / errors.m1.length;
            const avgError2 = errors.m2.reduce((a, b) => a + b, 0) / errors.m2.length;
            const avgError3 = errors.m3.reduce((a, b) => a + b, 0) / errors.m3.length;
            const invErr1 = 1 / (avgError1 + 0.0001);
            const invErr2 = 1 / (avgError2 + 0.0001);
            const invErr3 = 1 / (avgError3 + 0.0001);
            const sumInv = invErr1 + invErr2 + invErr3;
            if (sumInv > 0) {
               weights = { w1: invErr1 / sumInv, w2: invErr2 / sumInv, w3: invErr3 / sumInv };
            }
        }
        newEnsembleWeights[h.name] = weights;

        const finalForecastPrice = model1_price * weights.w1 + model2_price * weights.w2 + model3_price * weights.w3;
        
        if (!newFuturePaths[`predicted_${h.name}_ahead`]) {
            const path = [
                { time: prices.length - 1, price: lastPriceValue },
                { time: prices.length - 1 + h.ticks, price: finalForecastPrice }
            ];
             newFuturePaths[`predicted_${h.name}_ahead`] = path.map(p => ({ ...p, [`predicted_${h.name}_ahead`]: p.price }));
        }

        pendingPredictionsRef.current[h.name].push({
            startTimeIndex: currentTimeIndex,
            startPrice: lastPriceValue,
            predictedEndPrice: finalForecastPrice,
            model1Price: model1_price,
            model2Price: model2_price,
            model3Price: model3_price,
        });
    });

    setFuturePaths(newFuturePaths);
    setAccuracies(newAccuracies);
    setEnsembleWeights(newEnsembleWeights);
    
    if(user && Date.now() - lastSaveRef.current > 30000) {
        const modelsToSave: Record<string, PersistentModelState> = {};
        Object.keys(bayesianModels).forEach(key => {
            modelsToSave[key] = {
                horizon: key,
                bayesianModel: bayesianModels[key],
                modelWeights: { w1: 0.6, w2: 0.3, w3: 0.1 },
                lastUpdate: new Date().toISOString()
            };
        });
        savePredictiveModels(user.uid, modelsToSave);
        lastSaveRef.current = Date.now();
    }
  }, [realData, horizons, user, bayesianModels, loading]);

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
        const weights = ensembleWeights[p.name];
        if (weights && weights.w3 > 0.45) { // Filtro de dominância do Null Model
            return;
        }

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
  }, [projectionExperts, ensembleWeights]);
  
  const onConsensusUpdateRef = useRef(onConsensusUpdate);
  useEffect(() => {
    onConsensusUpdateRef.current = onConsensusUpdate;
  }, [onConsensusUpdate]);

  useEffect(() => {
    onConsensusUpdateRef.current({strongestSignal, projectionExperts, ensembleWeights});
  }, [strongestSignal, projectionExperts, ensembleWeights]);

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

  const projectionColors: { [key: string]: string } = {
    '3t': '#8884d8',
    '6t': '#82ca9d',
    '10t': '#ffc658',
    '20s': '#ff8042',
    '30s': '#f44336',
    '40s': '#00bcd4',
  };

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
                    {realData.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                            <Bot className="w-12 h-12 mb-4 opacity-30" />
                            <p className="font-semibold">Aguardando dados suficientes do mercado...</p>
                            <p className="text-sm">É necessário um histórico mínimo para a análise estatística.</p>
                        </div>
                    ) : (
                        <div className="min-h-0">
                              <div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                     <StrongestSignalCard signal={strongestSignal} ensembleWeights={ensembleWeights} />
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
                                    {Object.keys(futurePaths).map(key => {
                                        const horizonName = key.split('_')[1];
                                        const color = projectionColors[horizonName as keyof typeof projectionColors] || '#a16207';
                                        return (
                                          <Line key={key} type="monotone" dataKey={key} stroke={color} strokeWidth={2} strokeDasharray="5 5" dot={false} name={`Projeção (${horizonName})`} />
                                        )
                                    })}
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                        </div>
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

function PageContent() {
    const { chartData, activeSymbol, operationsLog, sellContract, clearActiveContracts, durationLimits } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();
    const [predictiveLogs, setPredictiveLogs] = useState<PredictiveTradeLog[]>([]);
    const [isLogsLoading, setIsLogsLoading] = useState(true);
    const [deletingPredictiveLogId, setDeletingPredictiveLogId] = useState<string | null>(null);
    
    const autopilot = useMasterAutopilot();
    const { isAutopilotOn, runAutopilotCycle } = autopilot;
    
    const [consensusData, setConsensusData] = useState<any>(null);

    const onConsensusUpdateRef = useRef(onConsensusUpdate);

    function onConsensusUpdate(data: any) {
        setConsensusData(data);
        if (isAutopilotOn && data?.projectionExperts) {
            const assertiveness: Record<string, AssertivenessData> = Object.fromEntries(
                data.projectionExperts.map((p: any) => [p.name, { accuracy: p.accuracy, vote: p.vote }])
            );
            runAutopilotCycle(assertiveness);
        }
    }
    
    useEffect(() => {
        onConsensusUpdateRef.current = onConsensusUpdate;
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
                        onConsensusUpdate={onConsensusUpdateRef.current}
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
                        <OperationsLogV2 operations={operationsLog} sellContract={sellContract} priceTicks={[]} clearActiveContracts={clearActiveContracts}/>
                    </div>
                </div>
            </div>
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


export default function VolatilityAnalysisPage() {
    
    const formMethods = useForm({ resolver: zodResolver(volatilityTraderSchema), defaultValues: { stake: 1.0, duration: 15 }});
    
    return (
        <DerivApiProvider>
             <FormProvider {...formMethods}>
                <PageContent />
            </FormProvider>
        </DerivApiProvider>
    );
}
