// src/app/volatility-analysis/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { TrendingUp, TrendingDown, HelpCircle, Bot, FlaskConical, Target, Info, Brain, Zap, Send, Loader2, ShieldCheck, GitBranch, BarChart, Activity, AlertTriangle, Power, ChevronsUpDown, Settings } from 'lucide-react';
import { DerivApiProviderV2, useDerivApiV2 } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { getConsensusGradientStyle } from '@/features/trading/components/deriv-trader/utils/get-consensus-gradient-style';
import PredictiveLogViewer from '@/components/deriv-trader/PredictiveLogViewer';
import { getPredictiveTradeLogs, savePredictiveTradeLog } from '@/services/financial-data-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { db } from '@/lib/firebase';
import { doc, deleteDoc, collection } from 'firebase/firestore';
import { errorEmitter, FirestorePermissionError } from '@/firebase';
import { evaluateTriggerConditions } from '@/features/trading/services/predictive-logic';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';

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
  predictiveLogs: PredictiveTradeLog[];
  onDeletePredictiveLog: (logId: string) => void;
  deletingPredictiveLogId: string | null;
  thresholds: Record<string, number>;
  isNeighborConfirmationEnabled: boolean;
  isMacroTrendCheckEnabled: boolean;
  highFrequencyThreshold: number; // NOVO
}

const calculateRollingAccuracy = (history: boolean[]) => {
    const hits = history.filter(h => h).length;
    const total = history.length;
    const percentage = total > 0 ? (hits / total) * 100 : 0;
    return { hits, total, percentage };
};

interface AssertivenessData {
    accuracy: number;
    vote: 'RISE' | 'FALL' | 'HOLD';
}

const StatItem = ({ label, value }: { label: string; value: string | number }) => (
    <div className="flex flex-col p-2 border-l-2 pl-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-bold font-mono">{value}</span>
    </div>
);

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
        <CardTitle className="text-sm font-semibold text-muted-foreground mb-3">Assertividade das Projeções</CardTitle>
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

function StochasticLab({ 
    realData, 
    operationsLog, 
    activeSymbol, 
    onConsensusUpdate, 
    isAutopilotOn, 
    setAutopilotStatus, 
    executeTrade,
    predictiveLogs,
    onDeletePredictiveLog,
    deletingPredictiveLogId,
    thresholds,
    isNeighborConfirmationEnabled,
    isMacroTrendCheckEnabled,
    highFrequencyThreshold, // NOVO
}: StochasticLabProps) {
  const { toast } = useToast();
  const { user, loading: isAuthLoading } = useAuth();
  const { durationLimits, botCandleData } = useDerivApiV2();
  const [activeTab, setActiveTab] = useState('prediction');
  
  const cooldownRef = useRef(false);
  
  const [priceData, setPriceData] = useState<any[]>([]);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [returns, setReturns] = useState<any[]>([]);
  const [volatilityData, setVolatilityData] = useState<any[]>([]);
  const [qqData, setQQData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  
  const [predictionData, setPredictionData] = useState<any[]>([]);
  const [futurePath3t, setFuturePath3t] = useState<any[]>([]);
  const [futurePath6t, setFuturePath6t] = useState<any[]>([]);
  const [futurePath10s, setFuturePath10s] = useState<any[]>([]);
  const [futurePath20s, setFuturePath20s] = useState<any[]>([]);
  const [futurePath30s, setFuturePath30s] = useState<any[]>([]);
  const [futurePath40s, setFuturePath40s] = useState<any[]>([]);
  
  const [driftCorrectionForDisplay, setDriftCorrectionForDisplay] = useState({drift: 0, mae: 0, rmse: 0});

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
  
  const horizons = useMemo(() => [
      { name: '3t', ticks: 3, window: 6 },
      { name: '6t', ticks: 6, window: 6 },
      { name: '10s', ticks: 10, window: 10 },
      { name: '20s', ticks: 20, window: 10 },
      { name: '30s', ticks: 30, window: 10 },
      { name: '40s', ticks: 40, window: 10 },
  ], []);

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
      
      const setHistoryFns = [setPredictionAccuracyHistory3t, setPredictionAccuracyHistory6t, setPredictionAccuracyHistory10s, setPredictionAccuracyHistory20s, setPredictionAccuracyHistory30s, setPredictionAccuracyHistory40s];
      const pendingRefs = [pendingPredictions3tRef, pendingPredictions6tRef, pendingPredictions10sRef, pendingPredictions20sRef, pendingPredictions30sRef, pendingPredictions40sRef];

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
      
      horizons.forEach((h, i) => {
          processPredictionHorizon(h.ticks, h.window, prices, pendingRefs[i], setHistoryFns[i]);
      });
      
      const paths = horizons.map(h => projectPath(h.ticks));

      horizons.forEach((h, index) => {
          const newFuturePath = paths[index];
          if (newFuturePath.length === h.ticks + 1) {
              const newPredictionTimeIndex = newFuturePath[0].time;
              const alreadyPending = pendingRefs[index].current.some(p => p.startTimeIndex === newPredictionTimeIndex);
              if (!alreadyPending) {
                  pendingRefs[index].current.push({
                      startTimeIndex: newPredictionTimeIndex,
                      startPrice: newFuturePath[0].price,
                      predictedEndPrice: newFuturePath[h.ticks].price,
                  });
              }
          }
      });
      
      setFuturePath3t(paths[0].map(p => ({ time: p.time, predicted_3t_ahead: p.price })));
      setFuturePath6t(paths[1].map(p => ({ time: p.time, predicted_6t_ahead: p.price })));
      setFuturePath10s(paths[2].map(p => ({ time: p.time, predicted_10s_ahead: p.price })));
      setFuturePath20s(paths[3].map(p => ({ time: p.time, predicted_20s_ahead: p.price })));
      setFuturePath30s(paths[4].map(p => ({ time: p.time, predicted_30s_ahead: p.price })));
      setFuturePath40s(paths[5].map(p => ({ time: p.time, predicted_40s_ahead: p.price })));
    }
    
    setPredictionData(newPredictionData.slice(-200));

  }, [realData, horizons]);

  const processedLogsRef = useRef(new Set<number>());

  useEffect(() => {
    if (!user || operationsLog.length === 0 || isAuthLoading) {
      return;
    }
    
    const logsToUpdate: PredictiveTradeLog[] = [];
    const openPilotTrades = operationsLog.filter(op => op.initiator === 'Piloto' && op.status === 'pending');
    const closedPilotTrades = operationsLog.filter(op => op.initiator === 'Piloto' && op.status !== 'pending');

    for (const op of closedPilotTrades) {
      if (!processedLogsRef.current.has(op.id)) {
        const predictiveLogToUpdate = predictiveLogs.find(
          (pLog) => pLog.contractId === op.id
        );

        if (predictiveLogToUpdate) {
          console.log(`[Log Finalizer] Finalizando log preditivo para o contrato #${op.id}. Resultado: ${op.status}, PnL: ${op.result}`);
          
          const updatedLogData: PredictiveTradeLog = {
            ...predictiveLogToUpdate,
            result: op.status,
            pnl: op.result ?? (op.status === 'lost' ? -op.stake : 0),
          };

          logsToUpdate.push(updatedLogData);
          processedLogsRef.current.add(op.id);
        }
      }
    }
    
    if (logsToUpdate.length > 0) {
      for (const log of logsToUpdate) {
        savePredictiveTradeLog(user.uid, log);
      }
       toast({
        title: "Auditoria Preditiva Atualizada",
        description: `${logsToUpdate.length} registro(s) de trade foram finalizados.`,
      });
    }
  }, [operationsLog, predictiveLogs, user, isAuthLoading, toast]);


  const accuracy3t = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory3t), [predictionAccuracyHistory3t]);
  const accuracy6t = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory6t), [predictionAccuracyHistory6t]);
  const accuracy10s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory10s), [predictionAccuracyHistory10s]);
  const accuracy20s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory20s), [predictionAccuracyHistory20s]);
  const accuracy30s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory30s), [predictionAccuracyHistory30s]);
  const accuracy40s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory40s), [predictionAccuracyHistory40s]);
  
   const projectionExperts = useMemo(() => ([
      { name: '3t', vote: futurePath3t.length > 1 ? (futurePath3t[futurePath3t.length - 1].predicted_3t_ahead > futurePath3t[0].predicted_3t_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy3t.percentage },
      { name: '6t', vote: futurePath6t.length > 1 ? (futurePath6t[futurePath6t.length - 1].predicted_6t_ahead > futurePath6t[0].predicted_6t_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy6t.percentage },
      { name: '10s', vote: futurePath10s.length > 1 ? (futurePath10s[futurePath10s.length - 1].predicted_10s_ahead > futurePath10s[0].predicted_10s_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy10s.percentage },
      { name: '20s', vote: futurePath20s.length > 1 ? (futurePath20s[futurePath20s.length - 1].predicted_20s_ahead > futurePath20s[0].predicted_20s_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy20s.percentage },
      { name: '30s', vote: futurePath30s.length > 1 ? (futurePath30s[futurePath30s.length - 1].predicted_30s_ahead > futurePath30s[0].predicted_30s_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy30s.percentage },
      { name: '40s', vote: futurePath40s.length > 1 ? (futurePath40s[futurePath40s.length - 1].predicted_40s_ahead > futurePath40s[0].predicted_40s_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy40s.percentage },
  ]), [futurePath3t, accuracy3t, futurePath6t, accuracy6t, futurePath10s, accuracy10s, futurePath20s, accuracy20s, futurePath30s, accuracy30s, futurePath40s, accuracy40s]);

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
                    direction: p.accuracy > 50 ? p.vote : (p.vote === 'RISE' ? 'FALL' : 'RISE'),
                    certaintyScore: certainty,
                    accuracy: p.accuracy,
                };
            }
        }
    });
    return bestSignal;
  }, [projectionExperts]);

  const executeTradeAction = useCallback(async (initiator: OperationInitiator, signalOverride: 'RISE' | 'FALL', triggeredBy: [string, string], reason: string) => {
    if (!activeSymbol || !executeTrade || !user || !durationLimits) {
        toast({ title: "Erro de Configuração", description: "O piloto automático não pôde executar. Verifique a conexão e o ativo selecionado.", variant: "destructive"});
        return;
    }

    const longerHorizon = triggeredBy[1]; 
    let duration: number;
    let durationUnit: 's' | 't';
    
    const durationMatch = longerHorizon.match(/(\d+)([st])/);
    if (durationMatch) {
        const suggestedDuration = parseInt(durationMatch[1], 10);
        const suggestedUnit = durationMatch[2] as 's' | 't';
        
        const limits = durationLimits[suggestedUnit];
        
        if (limits && limits.min > 0) {
            duration = Math.max(limits.min, Math.min(suggestedDuration, limits.max));
            durationUnit = suggestedUnit;
        } else if (suggestedUnit === 's' && durationLimits.t && durationLimits.t.min > 0) {
             duration = durationLimits.t.min;
             durationUnit = 't';
        } else {
            duration = 15;
            durationUnit = 's';
        }

    } else {
        duration = 15;
        durationUnit = 's';
    }

    toast({ title: `🤖 Master Autopilot: Ordem ${initiator} ${signalOverride}!`, description: `Executando ${duration}${durationUnit} em ${activeSymbol}`});

    try {
        const result = await executeTrade(
            signalOverride === 'RISE' ? 'CALL' : 'PUT',
            1.0, 
            activeSymbol,
            signalOverride.toLowerCase() as 'rise' | 'fall',
            duration,
            durationUnit,
            initiator
        );

        if (result.success && result.contractId && user) {
            const assertivenessSnapshot = projectionExperts.map(p => ({
                horizon: p.name,
                accuracy: p.accuracy,
                vote: p.vote,
            }));
            
            const logToSave: Omit<PredictiveTradeLog, 'id'> = {
                contractId: result.contractId,
                timestamp: new Date().toISOString(),
                asset: activeSymbol,
                tradeParams: {
                    direction: signalOverride,
                    stake: 1.0, 
                    duration,
                    durationUnit
                },
                context: {
                    triggerReason: reason,
                    assertivenessSnapshot: assertivenessSnapshot,
                },
                result: 'pending',
                pnl: 0,
            };
            const logDocRef = doc(collection(db, `users/${user.uid}/predictive_logs_v1`));
            await savePredictiveTradeLog(user.uid, {...logToSave, id: logDocRef.id});
        }

    } catch (error) {
        console.error("Master Autopilot Execution Error:", error);
        toast({ title: `❌ Erro na Execução ${initiator}`, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  }, [activeSymbol, executeTrade, toast, user, durationLimits, projectionExperts]);

  const runAutopilotCycle = useCallback(() => {
    const openMasterTrade = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');
    
    if (!isAutopilotOn || cooldownRef.current || !activeSymbol || !executeTrade || isAuthLoading || openMasterTrade) {
      const blockReasons = [];
      if (!isAutopilotOn) blockReasons.push('Piloto OFF');
      if (cooldownRef.current) blockReasons.push('Cooldown ativo');
      if (!activeSymbol) blockReasons.push('Sem ativo');
      if (!executeTrade) blockReasons.push('executeTrade N/A');
      if (isAuthLoading) blockReasons.push('Autenticando');
      if (openMasterTrade) blockReasons.push(`Trade #${openMasterTrade.id} ativo`);
      
      if (isAutopilotOn) {
        setAutopilotStatus(
          openMasterTrade 
            ? `Gerindo #${openMasterTrade.id}` 
            : `Bloqueado: ${blockReasons[0]}`
        );
      }
      return;
    }
    
    const assertiveness = Object.fromEntries(
      projectionExperts.map(p => [p.name, { accuracy: p.accuracy, vote: p.vote }])
    );
    
    // Simulação do macro trend para a lógica de decisão
    const macroTrend: 'UP' | 'DOWN' | 'NONE' = 'NONE'; // Deve ser substituído por uma lógica real
    
    const { newTriggerSignal, newTriggerReason, newTriggeredBy } = evaluateTriggerConditions(
        assertiveness,
        horizons,
        thresholds, 
        'Rise/Fall',
        'ranging', // Simulação do regime
        macroTrend,
        isNeighborConfirmationEnabled,
        isMacroTrendCheckEnabled,
        highFrequencyThreshold
    );
    
    setAutopilotStatus(newTriggerReason);
    
    if (newTriggerSignal !== 'HOLD' && newTriggeredBy) {
      
      executeTradeAction('Piloto', newTriggerSignal, newTriggeredBy, newTriggerReason);
      cooldownRef.current = true;
      setTimeout(() => { 
        cooldownRef.current = false;
      }, 20000); // 20 segundos
    }
  }, [
      isAutopilotOn, activeSymbol, executeTrade, operationsLog, isAuthLoading, 
      setAutopilotStatus, executeTradeAction, projectionExperts, horizons, thresholds,
      isNeighborConfirmationEnabled, isMacroTrendCheckEnabled, highFrequencyThreshold
  ]);

  useEffect(() => {
    if (!isAutopilotOn) return;
    const intervalId = setInterval(runAutopilotCycle, 2000); 
    return () => clearInterval(intervalId);
  }, [isAutopilotOn, runAutopilotCycle]);
  
  useEffect(() => {
    onConsensusUpdate({strongestSignal, projectionExperts});
  }, [strongestSignal, onConsensusUpdate, projectionExperts]);

  const allAccuracy = useMemo(() => [
      { name: '3t', ...accuracy3t },
      { name: '6t', ...accuracy6t },
      { name: '10s', ...accuracy10s },
      { name: '20s', ...accuracy20s },
      { name: '30s', ...accuracy30s },
      { name: '40s', ...accuracy40s },
  ], [accuracy3t, accuracy6t, accuracy10s, accuracy20s, accuracy30s, accuracy40s]);
  
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

  return (
    <Card className="h-full flex flex-col col-span-1 lg:col-span-3">
        <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-purple-600" />
                Laboratório Preditivo (Cientista de IA) - {activeSymbol}
            </CardTitle>
            <CardDescription>O cientista usa GBM para projetar o futuro e medir a própria assertividade.</CardDescription>
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
                                    <Line type="monotone" dataKey="predicted_10s_ahead" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (10s)" />
                                    <Line type="monotone" dataKey="predicted_20s_ahead" stroke="#3b82f6" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (20s)" />
                                    <Line type="monotone" dataKey="predicted_30s_ahead" stroke="#f472b6" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (30s)" />
                                    <Line type="monotone" dataKey="predicted_40s_ahead" stroke="#10b981" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (40s)" />
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
                                        <Line dataKey="empirical" data={lineData} stroke="#ff0000" strokeWidth={2} dot={false} name="Linha de Normalidade"/>
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
                     <Card className="mt-6">
                        <CardHeader>
                            <CardTitle>Painel de Assertividade dos Especialistas</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                            {allAccuracy.map(acc => (
                                <div key={acc.name} className="p-3 border rounded-lg text-center">
                                    <p className="font-bold text-sm text-muted-foreground">{acc.name.toUpperCase()}</p>
                                    <p className={cn("text-2xl font-bold", getProgressColor(acc.percentage).replace('bg-', 'text-'))}>{acc.percentage.toFixed(1)}%</p>
                                    <p className="text-xs text-muted-foreground">({acc.hits}/{acc.total})</p>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
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
    isAutopilotOn, 
    toggleAutopilot, 
    autopilotStatus,
    children,
    projectionExperts,
    thresholds,
}: { 
    isAutopilotOn: boolean, 
    toggleAutopilot: (checked: boolean) => void, 
    autopilotStatus: string,
    children?: React.ReactNode,
    projectionExperts: {name: string, accuracy: number}[],
    thresholds: Record<string, number>,
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
                {children}
                <Alert className="mt-4 bg-blue-50 border-blue-200">
                    <AlertTitle className="text-blue-900 font-semibold flex items-center gap-2">
                        <Settings className="h-4 w-4"/>
                        Assertividade vs Thresholds
                    </AlertTitle>
                    <AlertDescription>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2 text-xs">
                            {Object.keys(thresholds).map((horizon) => {
                                const expert = projectionExperts?.find(p => p.name === horizon);
                                const accuracy = expert?.accuracy || 0;
                                const threshold = thresholds[horizon];
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
                            💡 <strong>Verde</strong> = Assertividade Efetiva ≥ Limiar | 
                            <strong className="text-red-600"> Vermelho</strong> = Bloqueado
                        </p>
                    </AlertDescription>
                </Alert>
            </CardContent>
        </Card>
    );
}

const Header = () => {
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

const PageContent = () => {
    const { chartData, activeSymbol, operationsLog, sellContract, priceTicks, clearActiveContracts, executeTrade, dataVersion, durationLimits } = useDerivApiV2();
    const { user } = useAuth();
    const { toast } = useToast();
    const [predictiveLogs, setPredictiveLogs] = useState<PredictiveTradeLog[]>([]);
    const [isLogsLoading, setIsLogsLoading] = useState(true);
    const [deletingPredictiveLogId, setDeletingPredictiveLogId] = useState<string | null>(null);

    const form = useForm<VolatilityTraderFormValues>({
        resolver: zodResolver(volatilityTraderSchema),
        defaultValues: {
            stake: 1.0,
            duration: 15,
        },
    });

    const [globalAssertivenessThreshold, setGlobalAssertivenessThreshold] = useState(62);
    const [individualThresholds, setIndividualThresholds] = useState<Record<string, number>>({
        '3t': 65, '6t': 65, '10s': 60, '20s': 62, '30s': 58, '40s': 60,
    });
    const [isNeighborConfirmationEnabled, setIsNeighborConfirmationEnabled] = useState(true);
    const [isMacroTrendCheckEnabled, setIsMacroTrendCheckEnabled] = useState(true);
    const [highFrequencyThreshold, setHighFrequencyThreshold] = useState(10); // NOVO


    const handleGlobalThresholdChange = (value: number) => {
        setGlobalAssertivenessThreshold(value);
        const newThresholds: Record<string, number> = {};
        Object.keys(individualThresholds).forEach(key => {
            newThresholds[key] = value;
        });
        setIndividualThresholds(newThresholds);
    };

    const handleIndividualThresholdChange = (horizon: string, value: number) => {
        setIndividualThresholds(prev => ({ ...prev, [horizon]: value }));
    };

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

    const [consensusData, setConsensusData] = useState<any>({
        strongestSignal: {
            direction: 'HOLD',
            certaintyScore: 0,
            horizon: 'N/A',
            accuracy: 50,
        },
        projectionExperts: [],
    });
    
    const [isAutopilotOn, setIsAutopilotOn] = useState(false);
    const [autopilotStatus, setAutopilotStatus] = useState('Pausado');
    const toggleAutopilot = (checked: boolean) => {
        setIsAutopilotOn(checked);
        setAutopilotStatus(checked ? 'Monitorando...' : 'Pausado');
    };

    const handleConsensusUpdate = useCallback((data: any) => {
        setConsensusData(data);
    }, []);

    const handleSyncDuration = () => {
        const { duration, durationUnit } = getOptimalDuration(consensusData.strongestSignal.horizon, durationLimits);
        if (!duration) {
          toast({ variant: 'destructive', title: 'Nenhum Sinal Forte', description: 'Aguarde um sinal preditivo forte para sincronizar.' });
          return;
        }

        form.setValue('duration', duration);

        toast({
          title: 'Duração Sincronizada!',
          description: `Duração definida para ${duration}${durationUnit}, com base no sinal de ${consensusData.strongestSignal.horizon}.`,
        });
    };
    
    const getOptimalDuration = (horizon: string, durationLimits: any) => {
        if (!horizon || horizon === 'N/A' || !durationLimits) {
            return { duration: 15, durationUnit: 's' };
        }

        let duration = 15;
        let durationUnit: 's' | 't' = 's';
        const durationValue = parseInt(horizon.replace(/[st]/, ''), 10);
        
        if (horizon.endsWith('t')) {
            const limits = durationLimits?.t;
            if (limits) {
                duration = Math.max(limits.min, Math.min(durationValue, limits.max));
                durationUnit = 't';
            } else {
                 duration = Math.max(15, durationValue * 2);
                 durationUnit = 's';
            }
        } else if (horizon.endsWith('s')) {
            const limits = durationLimits?.s;
            duration = limits ? Math.max(limits.min, Math.min(durationValue, limits.max)) : durationValue;
            durationUnit = 's';
        }

        return { duration, durationUnit };
    };

    return (
        <FormProvider {...form}>
            <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
                <Header />
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    <StochasticLab 
                        realData={chartData} 
                        activeSymbol={activeSymbol} 
                        onConsensusUpdate={handleConsensusUpdate}
                        isAutopilotOn={isAutopilotOn}
                        setAutopilotStatus={setAutopilotStatus}
                        executeTrade={executeTrade}
                        operationsLog={operationsLog}
                        predictiveLogs={predictiveLogs}
                        onDeletePredictiveLog={handleDeletePredictiveLog}
                        deletingPredictiveLogId={deletingPredictiveLogId}
                        thresholds={individualThresholds}
                        isNeighborConfirmationEnabled={isNeighborConfirmationEnabled}
                        isMacroTrendCheckEnabled={isMacroTrendCheckEnabled}
                        highFrequencyThreshold={highFrequencyThreshold}
                    />
                    <div className="lg:col-span-2 space-y-6">
                        <VolatilityTraderInterface 
                          symbol={activeSymbol || ''} 
                          consensus={consensusData.strongestSignal}
                          onSyncDuration={handleSyncDuration}
                        />
                        <VolatilityAutopilotInterface 
                            isAutopilotOn={isAutopilotOn} 
                            toggleAutopilot={toggleAutopilot}
                            autopilotStatus={autopilotStatus}
                            projectionExperts={consensusData.projectionExperts}
                            thresholds={individualThresholds}
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
                                                <Switch id="neighbor-confirmation-switch" checked={isNeighborConfirmationEnabled} onCheckedChange={setIsNeighborConfirmationEnabled} disabled={isAutopilotOn}/>
                                            </div>
                                            <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                                                <Label htmlFor="macro-trend-switch" className="flex flex-col space-y-1 flex-1 pr-4">
                                                    <span>Verificação de Tendência Macro</span>
                                                    <span className="font-normal text-xs text-muted-foreground">Alinhar trades com a EMA 100. (Ignorado para sinais HF)</span>
                                                </Label>
                                                <Switch id="macro-trend-switch" checked={isMacroTrendCheckEnabled} onCheckedChange={setIsMacroTrendCheckEnabled} disabled={isAutopilotOn}/>
                                            </div>
                                            
                                            <Separator/>

                                            <div className="space-y-2">
                                                <Label htmlFor="hf-threshold-slider">Limiar de Alta Frequência (HF)</Label>
                                                <div className="flex items-center gap-4">
                                                    <Slider
                                                        id="hf-threshold-slider"
                                                        min={5} max={60} step={5}
                                                        value={[highFrequencyThreshold]}
                                                        onValueChange={(value) => setHighFrequencyThreshold(value[0])}
                                                        disabled={isAutopilotOn}
                                                    />
                                                    <span className="font-mono text-primary font-bold">{highFrequencyThreshold}s</span>
                                                </div>
                                                <p className="text-xs text-muted-foreground pt-1">Sinais com duração igual ou inferior a este valor ignorarão o filtro de tendência macro.</p>
                                            </div>

                                            <Separator/>

                                            <div className="space-y-2">
                                                <Label htmlFor="global-assertiveness-threshold">Limiar de Assertividade Global (%)</Label>
                                                <div className="flex items-center gap-4">
                                                    <Slider
                                                        id="global-assertiveness-threshold"
                                                        min={55} max={100} step={5}
                                                        value={[globalAssertivenessThreshold]}
                                                        onValueChange={(value) => handleGlobalThresholdChange(value[0])}
                                                        disabled={isAutopilotOn}
                                                    />
                                                    <span className="font-mono text-primary font-bold">{globalAssertivenessThreshold}%</span>
                                                </div>
                                            </div>
                                            <Separator/>
                                            <div className="space-y-4">
                                                <Label>Calibração Individual por Horizonte</Label>
                                                {Object.keys(individualThresholds).map(horizon => (
                                                    <div key={horizon} className="space-y-2">
                                                        <div className="flex justify-between items-center">
                                                            <Label htmlFor={`threshold-${horizon}`} className="text-sm text-muted-foreground">{`Analista ${horizon}`}</Label>
                                                            <span className="font-mono text-primary font-bold">{individualThresholds[horizon]}%</span>
                                                        </div>
                                                        <Slider
                                                            id={`threshold-${horizon}`}
                                                            min={55} max={80} step={1}
                                                            value={[individualThresholds[horizon]]}
                                                            onValueChange={(value) => handleIndividualThresholdChange(horizon, value[0])}
                                                            disabled={isAutopilotOn}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </CollapsibleContent>
                            </Collapsible>
                        </VolatilityAutopilotInterface>
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
