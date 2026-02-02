// src/app/volatility-analysis/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useForm, FormProvider } from "react-hook-form";
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
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { useMasterAutopilot } from '@/features/trading/hooks/use-master-autopilot';
import type { AssertivenessData } from '@/features/trading/hooks/use-master-autopilot';

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
  onConsensusUpdate: (consensus: any) => void;
  predictiveLogs: PredictiveTradeLog[];
  onDeletePredictiveLog: (logId: string) => void;
  deletingPredictiveLogId: string | null;
}

const calculateRollingAccuracy = (history: boolean[]) => {
    const hits = history.filter(h => h).length;
    const total = history.length;
    const percentage = total > 0 ? (hits / total) * 100 : 0;
    return { hits, total, percentage };
};


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
                        Assertividade Efetiva: <span className="font-bold">{displayAccuracy.toFixed(1)}%</span>
                    </p>
                </div>
            )}
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
        <CardTitle className="text-sm font-semibold text-muted-foreground mb-3">Assertividade das Projeções</CardTitle>
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

/**
 * @fileOverview O `StochasticLab` é o coração do motor preditivo da aplicação.
 * Opera como um "Cientista de IA" que executa modelos de Movimento Browniano Geométrico (GBM)
 * em múltiplos horizontes de tempo para prever o comportamento do preço.
 * 
 * Filosofia: Comitê de Especialistas Temporais
 * 1.  Previsão Multi-Horizonte: Gera nove projeções de preço distintas para diferentes prazos.
 * 2.  Modelo Preditivo (GBM): Projeta o futuro com base na tendência (drift) e volatilidade (diffusion).
 * 3.  Meritocracia Preditiva: Avalia constantemente a "Assertividade" (taxa de acerto) de cada especialista.
 */
function StochasticLab({ 
    realData, 
    onConsensusUpdate, 
    predictiveLogs,
    onDeletePredictiveLog,
    deletingPredictiveLogId,
}: StochasticLabProps) {
  const { user, loading: isUserLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('prediction');
  
  const [priceData, setPriceData] = useState<any[]>([]);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [returns, setReturns] = useState<any[]>([]);
  const [volatilityData, setVolatilityData] = useState<any[]>([]);
  const [qqData, setQQData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  
  const [predictionData, setPredictionData] = useState<any[]>([]);
  const [futurePath1t, setFuturePath1t] = useState<any[]>([]);
  const [futurePath3t, setFuturePath3t] = useState<any[]>([]);
  const [futurePath6t, setFuturePath6t] = useState<any[]>([]);
  const [futurePath10t, setFuturePath10t] = useState<any[]>([]);
  const [futurePath15s, setFuturePath15s] = useState<any[]>([]);
  const [futurePath20s, setFuturePath20s] = useState<any[]>([]);
  const [futurePath30s, setFuturePath30s] = useState<any[]>([]);
  const [futurePath40s, setFuturePath40s] = useState<any[]>([]);
  const [futurePath50s, setFuturePath50s] = useState<any[]>([]);
  
  // PARÂMETROS DO MODELO GBM PARA 1HZ10V
  const ACCURACY_MEMORY = 10;
  const GBM_SIGMA = 0.10; // Volatilidade anualizada
  const GBM_DRIFT_TERM = - (GBM_SIGMA * GBM_SIGMA) / 2; // Termo de drift para um martingale: -σ²/2

  const [predictionAccuracyHistory1t, setPredictionAccuracyHistory1t] = useState<boolean[]>([]);
  const [predictionAccuracyHistory3t, setPredictionAccuracyHistory3t] = useState<boolean[]>([]);
  const [predictionAccuracyHistory6t, setPredictionAccuracyHistory6t] = useState<boolean[]>([]);
  const [predictionAccuracyHistory10t, setPredictionAccuracyHistory10t] = useState<boolean[]>([]);
  const [predictionAccuracyHistory15s, setPredictionAccuracyHistory15s] = useState<boolean[]>([]);
  const [predictionAccuracyHistory20s, setPredictionAccuracyHistory20s] = useState<boolean[]>([]);
  const [predictionAccuracyHistory30s, setPredictionAccuracyHistory30s] = useState<boolean[]>([]);
  const [predictionAccuracyHistory40s, setPredictionAccuracyHistory40s] = useState<boolean[]>([]);
  const [predictionAccuracyHistory50s, setPredictionAccuracyHistory50s] = useState<boolean[]>([]);
  
  const pendingPredictions1tRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions3tRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions6tRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions10tRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions15sRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions20sRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions30sRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions40sRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions50sRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const processedLogsRef = useRef(new Set<number>());

  const normalRandom = (): number => {
    let u1 = 0;
    while (u1 === 0) { u1 = Math.random(); }
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  
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
    const VOL_WINDOW = 50;
    
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
        
        // Simula uma previsão histórica usando o modelo matemático fixo
        const Z = normalRandom();
        const S_predicted_1_tick = S_prev * Math.exp(GBM_DRIFT_TERM + GBM_SIGMA * Z);
        
        if (Number.isFinite(S_real) && Number.isFinite(S_predicted_1_tick)) {
            newPredictionData.push({ time: i, real: S_real, predicted_1_tick: S_predicted_1_tick });
        }
    }

    if (prices.length > VOL_WINDOW) {
      const lastPriceValue = prices[prices.length - 1];
      const lastTime = prices.length - 1;

      /**
       * Projeta um caminho futuro do preço usando o modelo de Movimento Browniano Geométrico (GBM)
       * com parâmetros FÍXOS para o ativo 1HZ10V (martingale puro).
       * S(t+1) = S(t) × exp(-σ²/2 + σ × Z)
       * 
       * @param steps Número de passos (ticks ou segundos) à frente para projetar.
       * @returns Array de pontos de preço projetados.
       */
      const projectPath = (steps: number) => {
        if (lastPriceValue === null) return [];

        let currentSimPrice = lastPriceValue;
        const path = [{ time: lastTime, price: lastPriceValue }];
        
        for (let i = 1; i <= steps; i++) {
          const Z = normalRandom(); // Z ~ N(0,1)
          
          const exponent = GBM_DRIFT_TERM + GBM_SIGMA * Z;
          
          currentSimPrice = currentSimPrice * Math.exp(exponent);

          if (Number.isFinite(currentSimPrice)) {
            path.push({ time: lastTime + i, price: currentSimPrice });
          } else {
            // Failsafe em caso de cálculo inválido
            path.push({ time: lastTime + i, price: path[path.length - 1].price });
          }
        }
        return path;
      };
      
      const setHistoryFns = [
        setPredictionAccuracyHistory1t, setPredictionAccuracyHistory3t, setPredictionAccuracyHistory6t, 
        setPredictionAccuracyHistory10t, setPredictionAccuracyHistory15s, setPredictionAccuracyHistory20s, 
        setPredictionAccuracyHistory30s, setPredictionAccuracyHistory40s, setPredictionAccuracyHistory50s
      ];
      const pendingRefs = [
        pendingPredictions1tRef, pendingPredictions3tRef, pendingPredictions6tRef, 
        pendingPredictions10tRef, pendingPredictions15sRef, pendingPredictions20sRef, 
        pendingPredictions30sRef, pendingPredictions40sRef, pendingPredictions50sRef
      ];

      /**
       * Processa uma previsão pendente para calcular a assertividade.
       * Este é o núcleo da "Meritocracia Preditiva". Usa uma janela uniforme.
       */
      const processPredictionHorizon = (
          horizonTicks: number,
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
              setAccuracyHistory(prev => [...prev.slice(-ACCURACY_MEMORY + newHistory.length), ...newHistory]);
          }
      };
      
      horizons.forEach((h, i) => {
          processPredictionHorizon(h.ticks, prices, pendingRefs[i], setHistoryFns[i]);
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
      
      setFuturePath1t(paths[0].map(p => ({ time: p.time, predicted_1t_ahead: p.price })));
      setFuturePath3t(paths[1].map(p => ({ time: p.time, predicted_3t_ahead: p.price })));
      setFuturePath6t(paths[2].map(p => ({ time: p.time, predicted_6t_ahead: p.price })));
      setFuturePath10t(paths[3].map(p => ({ time: p.time, predicted_10t_ahead: p.price })));
      setFuturePath15s(paths[4].map(p => ({ time: p.time, predicted_15s_ahead: p.price })));
      setFuturePath20s(paths[5].map(p => ({ time: p.time, predicted_20s_ahead: p.price })));
      setFuturePath30s(paths[6].map(p => ({ time: p.time, predicted_30s_ahead: p.price })));
      setFuturePath40s(paths[7].map(p => ({ time: p.time, predicted_40s_ahead: p.price })));
      setFuturePath50s(paths[8].map(p => ({ time: p.time, predicted_50s_ahead: p.price })));
    }
    
    setPredictionData(newPredictionData.slice(-200));

  }, [realData, horizons]);

  useEffect(() => {
    if (!user || isUserLoading || !predictiveLogs) {
      return;
    }
    
    const logsToUpdate: PredictiveTradeLog[] = [];
    const closedPilotTrades = realData.filter(op => (op as any).initiator === 'Piloto' && (op as any).status !== 'pending') as Operation[];

    for (const op of closedPilotTrades) {
      if (!processedLogsRef.current.has(op.id)) {
        const predictiveLogToUpdate = predictiveLogs.find(
          (pLog) => pLog.contractId === op.id
        );

        if (predictiveLogToUpdate) {
          
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
    }
  }, [realData, predictiveLogs, user, isUserLoading]);


  const accuracy1t = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory1t), [predictionAccuracyHistory1t]);
  const accuracy3t = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory3t), [predictionAccuracyHistory3t]);
  const accuracy6t = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory6t), [predictionAccuracyHistory6t]);
  const accuracy10t = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory10t), [predictionAccuracyHistory10t]);
  const accuracy15s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory15s), [predictionAccuracyHistory15s]);
  const accuracy20s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory20s), [predictionAccuracyHistory20s]);
  const accuracy30s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory30s), [predictionAccuracyHistory30s]);
  const accuracy40s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory40s), [predictionAccuracyHistory40s]);
  const accuracy50s = useMemo(() => calculateRollingAccuracy(predictionAccuracyHistory50s), [predictionAccuracyHistory50s]);
  
   const projectionExperts = useMemo(() => ([
      { name: '1t', vote: futurePath1t.length > 1 ? (futurePath1t[futurePath1t.length - 1].predicted_1t_ahead > futurePath1t[0].predicted_1t_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy1t.percentage },
      { name: '3t', vote: futurePath3t.length > 1 ? (futurePath3t[futurePath3t.length - 1].predicted_3t_ahead > futurePath3t[0].predicted_3t_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy3t.percentage },
      { name: '6t', vote: futurePath6t.length > 1 ? (futurePath6t[futurePath6t.length - 1].predicted_6t_ahead > futurePath6t[0].predicted_6t_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy6t.percentage },
      { name: '10t', vote: futurePath10t.length > 1 ? (futurePath10t[futurePath10t.length - 1].predicted_10t_ahead > futurePath10t[0].predicted_10t_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy10t.percentage },
      { name: '15s', vote: futurePath15s.length > 1 ? (futurePath15s[futurePath15s.length - 1].predicted_15s_ahead > futurePath15s[0].predicted_15s_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy15s.percentage },
      { name: '20s', vote: futurePath20s.length > 1 ? (futurePath20s[futurePath20s.length - 1].predicted_20s_ahead > futurePath20s[0].predicted_20s_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy20s.percentage },
      { name: '30s', vote: futurePath30s.length > 1 ? (futurePath30s[futurePath30s.length - 1].predicted_30s_ahead > futurePath30s[0].predicted_30s_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy30s.percentage },
      { name: '40s', vote: futurePath40s.length > 1 ? (futurePath40s[futurePath40s.length - 1].predicted_40s_ahead > futurePath40s[0].predicted_40s_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy40s.percentage },
      { name: '50s', vote: futurePath50s.length > 1 ? (futurePath50s[futurePath50s.length - 1].predicted_50s_ahead > futurePath50s[0].predicted_50s_ahead ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy50s.percentage },
  ]), [
      futurePath1t, accuracy1t, futurePath3t, accuracy3t, futurePath6t, accuracy6t, futurePath10t, accuracy10t,
      futurePath15s, accuracy15s, futurePath20s, accuracy20s, futurePath30s, accuracy30s, 
      futurePath40s, accuracy40s, futurePath50s, accuracy50s
  ]);

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
    const combined = [...predictionData];
    
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

    mergePath(futurePath1t);
    mergePath(futurePath3t); 
    mergePath(futurePath6t); 
    mergePath(futurePath10t);
    mergePath(futurePath15s);
    mergePath(futurePath20s); 
    mergePath(futurePath30s); 
    mergePath(futurePath40s);
    mergePath(futurePath50s);

    return combined;
  }, [
      predictionData, futurePath1t, futurePath3t, futurePath6t, futurePath10t, 
      futurePath15s, futurePath20s, futurePath30s, futurePath40s, futurePath50s
  ]);

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
                Laboratório Preditivo (Cientista de IA)
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
                                    <YAxis
                                      tickCount={6}
                                      tickFormatter={(value) => value.toFixed(4)}
                                      label={{ value: 'Preço', angle: -90, position: 'insideLeft' }}
                                      domain={['dataMin', 'dataMax']}
                                    />
                                    <Tooltip />
                                    <Legend />
                                    <Line type="monotone" dataKey="real" stroke="hsl(var(--chart-1))" strokeWidth={3} dot={false} name="Preço Real" />
                                    <Line type="monotone" dataKey="predicted_1t_ahead" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} name="Projeção Histórica (1T)" />
                                    <Line type="monotone" dataKey="predicted_3t_ahead" stroke="hsl(var(--chart-3))" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Projeção (3t)" />
                                    <Line type="monotone" dataKey="predicted_6t_ahead" stroke="hsl(var(--chart-4))" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Projeção (6t)" />
                                    <Line type="monotone" dataKey="predicted_10t_ahead" stroke="hsl(var(--chart-5))" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Projeção (10t)" />
                                    <Line type="monotone" dataKey="predicted_15s_ahead" stroke="hsl(var(--chart-6))" strokeWidth={1.5} strokeDasharray="2 6" dot={false} name="Projeção (15s)" />
                                    <Line type="monotone" dataKey="predicted_20s_ahead" stroke="hsl(var(--chart-7))" strokeWidth={1.5} strokeDasharray="2 6" dot={false} name="Projeção (20s)" />
                                    <Line type="monotone" dataKey="predicted_30s_ahead" stroke="hsl(var(--chart-8))" strokeWidth={1.5} strokeDasharray="2 6" dot={false} name="Projeção (30s)" />
                                    <Line type="monotone" dataKey="predicted_40s_ahead" stroke="hsl(var(--chart-9))" strokeWidth={1.5} strokeDasharray="2 6" dot={false} name="Projeção (40s)" />
                                    <Line type="monotone" dataKey="predicted_50s_ahead" stroke="hsl(var(--chart-10))" strokeWidth={1.5} strokeDasharray="2 6" dot={false} name="Projeção (50s)" />
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

const PageContent = () => {
    const { chartData, activeSymbol, operationsLog, sellContract, clearActiveContracts, durationLimits, priceTicks } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();
    const [predictiveLogs, setPredictiveLogs] = useState<PredictiveTradeLog[]>([]);
    const [isLogsLoading, setIsLogsLoading] = useState(true);
    const [deletingPredictiveLogId, setDeletingPredictiveLogId] = useState<string | null>(null);
    const [consensusData, setConsensusData] = useState<any>(null);
    
    const autopilot = useMasterAutopilot();
    const { isAutopilotOn, runAutopilotCycle } = autopilot;
    
    const form = useForm<VolatilityTraderFormValues>({
        resolver: zodResolver(volatilityTraderSchema),
        defaultValues: {
            stake: 1.0,
            duration: 15,
        },
    });

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
        let durationUnit: 's' | 't' = 's';
        if (durationMatch) {
            const suggestedDuration = parseInt(durationMatch[1], 10);
            const suggestedUnit = durationMatch[2] as 's' | 't';
            const limits = durationLimits[suggestedUnit];
            if (limits && limits.min > 0) {
                duration = Math.max(limits.min, Math.min(suggestedDuration, limits.max));
                durationUnit = suggestedUnit;
            }
        }
        
        form.setValue('duration', duration);

        toast({
          title: 'Duração Sincronizada!',
          description: `Duração definida para ${duration}${durationUnit}, com base no sinal de ${horizon}.`,
        });
    };
    

    return (
        <FormProvider {...form}>
            <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
                <Header />
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                    <StochasticLab 
                        realData={chartData} 
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
                                                <Label htmlFor="triple-confirmation-switch" className="flex flex-col space-y-1 flex-1 pr-4">
                                                    <span>Confirmação Tripla (Vizinhos + Sequencial)</span>
                                                    <span className="font-normal text-xs text-muted-foreground">Exigir que três especialistas vizinhos (anterior, atual, próximo) concordem.</span>
                                                </Label>
                                                <Switch id="triple-confirmation-switch" checked={autopilot.isTripleConfirmationEnabled} onCheckedChange={autopilot.setIsTripleConfirmationEnabled} disabled={autopilot.isAutopilotOn}/>
                                            </div>
                                            <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                                                <Label htmlFor="macro-trend-switch" className="flex flex-col space-y-1 flex-1 pr-4">
                                                    <span>Verificação de Tendência Macro</span>
                                                    <span className="font-normal text-xs text-muted-foreground">Alinhar trades com a EMA dinâmica. (Ignorado para sinais HF)</span>
                                                </Label>
                                                <Switch id="macro-trend-switch" checked={autopilot.isMacroTrendCheckEnabled} onCheckedChange={autopilot.setIsMacroTrendCheckEnabled} disabled={autopilot.isAutopilotOn}/>
                                            </div>
                                             <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                                                <Label htmlFor="multiple-positions-switch" className="flex flex-col space-y-1 flex-1 pr-4">
                                                    <span>Permitir Múltiplas Posições</span>
                                                    <span className="font-normal text-xs text-muted-foreground">Se ativado, o piloto pode abrir novas ordens mesmo com outras já em andamento.</span>
                                                </Label>
                                                <Switch id="multiple-positions-switch" checked={autopilot.allowMultiplePositions} onCheckedChange={autopilot.setAllowMultiplePositions} disabled={autopilot.isAutopilotOn}/>
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
                                                <Label htmlFor="global-assertiveness-threshold">Limiar de Assertividade Global (%)</Label>
                                                <div className="flex items-center gap-4">
                                                    <Slider
                                                        id="global-assertiveness-threshold"
                                                        min={55} max={100} step={5}
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
                                                            min={55} max={80} step={1}
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
                        <OperationsLogV2 
                          operations={operationsLog} 
                          sellContract={sellContract} 
                          priceTicks={priceTicks} 
                          clearActiveContracts={clearActiveContracts}
                        />
                    </div>
                </div>
            </div>
        </FormProvider>
    );
}

export default function VolatilityAnalysisPage() {
    return (
        <DerivApiProvider>
            <PageContent />
        </DerivApiProvider>
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
                        Assertividade vs Thresholds
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
