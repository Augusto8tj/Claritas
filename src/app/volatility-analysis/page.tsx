// src/app/volatility-analysis/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { TrendingUp, TrendingDown, HelpCircle, Bot, FlaskConical, Target, Info, Brain, Zap, Send, Loader2, ShieldCheck, GitBranch, BarChart, Activity, AlertTriangle, Power, ChevronsUpDown, Settings, Sigma } from 'lucide-react';
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

const ProjectionExpertsPanel = ({ experts, adaptiveDrifts }: { experts: { name: string; vote: 'RISE' | 'FALL' | 'HOLD'; accuracy: number }[], adaptiveDrifts: Record<string, number> }) => (
    <Card className="p-4">
        <CardTitle className="text-sm font-semibold text-muted-foreground mb-3">Assertividade & Calibração</CardTitle>
        <div className="space-y-2">
            {experts.map(({ name, vote, accuracy }) => {
                const effectiveDirection = getEffectiveVote({ accuracy, vote });
                const effectiveAccuracy = Math.max(accuracy, 100 - accuracy);
                const drift = adaptiveDrifts[name] || 0;
                const driftColor = drift > 0.00001 ? 'text-green-500' : drift < -0.00001 ? 'text-red-500' : 'text-gray-400';
                
                return (
                    <div key={name} className="flex justify-between items-center bg-background p-2 rounded-md border text-xs">
                        <span className="font-semibold w-12">{name}</span>
                        <div className="flex items-center gap-2 w-24">
                            <Progress value={effectiveAccuracy} className="h-1.5 flex-1" indicatorClassName={getProgressColor(accuracy)} />
                            <span className="font-mono w-10 text-right">{effectiveAccuracy.toFixed(0)}%</span>
                        </div>
                        <div className="flex items-center gap-1.5 w-16 justify-end">
                            <Sigma size={12} className={driftColor}/>
                            <span className={cn("font-mono font-bold text-right", driftColor)}>{(drift * 10000).toFixed(1)}</span>
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
 * 4.  Neuro-Adaptative Drift Controller: Ajusta o parâmetro 'drift' de cada modelo com base nos erros de previsão.
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
  const futurePathsRef = useRef<Record<string, { time: number; price: number }[]>>({});

  // --- PARÂMETROS DO MODELO GBM PARA 1HZ10V ---
  const ACCURACY_MEMORY = 10;
  const GBM_SIGMA = 0.10;
  const GBM_DRIFT_TERM = - (GBM_SIGMA * GBM_SIGMA) / 2;
  
  // --- ESTADO DO CONTROLADOR NEURO-ADAPTATIVO ---
  const ADAPTIVE_DRIFT_LEARNING_RATE = 0.1;
  const ERROR_HISTORY_LENGTH = 20;
  const adaptiveDriftRef = useRef<Record<string, number>>({});
  const predictionErrorHistoryRef = useRef<Record<string, number[]>>({});

  const [accuracyHistories, setAccuracyHistories] = useState<Record<string, boolean[]>>({});
  const pendingPredictionsRef = useRef<Record<string, { startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>>({});
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
    // Inicialização dos estados dinâmicos para cada horizonte
    const initialAccuracy: Record<string, boolean[]> = {};
    const initialPending: Record<string, any[]> = {};
    const initialDrift: Record<string, number> = {};
    const initialErrorHistory: Record<string, number[]> = {};

    horizons.forEach(h => {
        initialAccuracy[h.name] = [];
        initialPending[h.name] = [];
        initialDrift[h.name] = 0;
        initialErrorHistory[h.name] = [];
    });
    setAccuracyHistories(initialAccuracy);
    pendingPredictionsRef.current = initialPending;
    adaptiveDriftRef.current = initialDrift;
    predictionErrorHistoryRef.current = initialErrorHistory;
  }, [horizons]);

  useEffect(() => {
    const VOL_WINDOW = 50;
    
    if (realData.length < VOL_WINDOW) return;
    
    const prices = realData.map(d => isCandle(d) ? d.close : d.price);
    if(prices.length > 0) setLastPrice(prices[prices.length - 1]);
    setPriceData(realData.map((d, i) => ({ time: i, price: isCandle(d) ? d.close : d.price })));

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
      const lastTime = prices.length - 1;

      const projectPath = (steps: number, horizonName: string) => {
        if (lastPriceValue === null) return [];
        let currentSimPrice = lastPriceValue;
        const path = [{ time: lastTime, price: lastPriceValue }];
        
        // Aplica o Drift Adaptativo específico para este horizonte
        const driftCorrection = adaptiveDriftRef.current[horizonName] || 0;
        
        for (let i = 1; i <= steps; i++) {
          const Z = normalRandom();
          const exponent = (GBM_DRIFT_TERM + driftCorrection) + GBM_SIGMA * Z;
          currentSimPrice *= Math.exp(exponent);
          path.push({ time: lastTime + i, price: currentSimPrice });
        }
        return path;
      };

      const newFuturePaths: Record<string, any[]> = {};
      
      horizons.forEach(h => {
          // --- AUTO-CALIBRAÇÃO DE DRIFT ---
          const currentTimeIndex = prices.length - 1;
          const predictionsToProcess = pendingPredictionsRef.current[h.name] || [];
          const updatedPending = [];
          const newHistoryEntries: boolean[] = [];

          for (const pred of predictionsToProcess) {
              if (currentTimeIndex >= pred.startTimeIndex + h.ticks) {
                  const actualEndPrice = prices[pred.startTimeIndex + h.ticks];
                  if (actualEndPrice !== undefined) {
                      // 1. Calcula o erro da previsão
                      const predictionError = actualEndPrice - pred.predictedEndPrice;
                      
                      // 2. Atualiza o histórico de erros
                      const errorHistory = predictionErrorHistoryRef.current[h.name] || [];
                      errorHistory.push(predictionError);
                      if (errorHistory.length > ERROR_HISTORY_LENGTH) errorHistory.shift();
                      predictionErrorHistoryRef.current[h.name] = errorHistory;
                      
                      // 3. Calcula o novo drift adaptativo
                      const averageError = errorHistory.reduce((a, b) => a + b, 0) / errorHistory.length;
                      adaptiveDriftRef.current[h.name] = ADAPTIVE_DRIFT_LEARNING_RATE * averageError;

                      // 4. Atualiza a assertividade
                      const predictedDirection = pred.predictedEndPrice > pred.startPrice;
                      const actualDirection = actualEndPrice > pred.startPrice;
                      newHistoryEntries.push(predictedDirection === actualDirection);
                  }
              } else {
                  updatedPending.push(pred);
              }
          }
          pendingPredictionsRef.current[h.name] = updatedPending;
          
          if (newHistoryEntries.length > 0) {
            setAccuracyHistories(prev => ({
                ...prev,
                [h.name]: [...(prev[h.name] || []).slice(-ACCURACY_MEMORY + newHistoryEntries.length), ...newHistoryEntries]
            }));
          }

          // --- GERA NOVA PROJEÇÃO ---
          const newPath = projectPath(h.ticks, h.name);
          newFuturePaths[h.name] = newPath.map(p => ({ time: p.time, [`predicted_${h.name}_ahead`]: p.price }));

          if (newPath.length === h.ticks + 1) {
              const newPredictionTimeIndex = newPath[0].time;
              if (!pendingPredictionsRef.current[h.name].some(p => p.startTimeIndex === newPredictionTimeIndex)) {
                  pendingPredictionsRef.current[h.name].push({
                      startTimeIndex: newPredictionTimeIndex,
                      startPrice: newPath[0].price,
                      predictedEndPrice: newPath[h.ticks].price,
                  });
              }
          }
      });
      futurePathsRef.current = newFuturePaths;
    }
  }, [realData, horizons]);

  const projectionExperts = useMemo(() => {
    return horizons.map(h => {
        const path = futurePathsRef.current[h.name] || [];
        const vote = path.length > 1 ? (path[path.length - 1].price > path[0].price ? 'RISE' : 'FALL') : 'HOLD';
        const accuracyData = accuracyHistories[h.name] || [];
        const accuracy = accuracyData.length > 0 ? (accuracyData.filter(v => v).length / accuracyData.length) * 100 : 50;
        return { name: h.name, vote, accuracy };
    });
  }, [horizons, accuracyHistories, realData]); // realData dependency forces re-calc on new data

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
    const dataSlice = priceData.slice(-200); // Only display recent real data
    const combined = [...dataSlice];
    
    Object.values(futurePathsRef.current).forEach(path => {
        path.forEach(point => {
          const existingPointIndex = combined.findIndex(p => p.time === point.time);
          if (existingPointIndex !== -1) {
            combined[existingPointIndex] = { ...combined[existingPointIndex], ...point };
          } else {
            combined.push(point);
          }
        });
    });

    return combined;
  }, [priceData, realData]); // realData forces update when new futurePaths are calculated

  return (
    <Card className="h-full flex flex-col col-span-1 lg:col-span-3">
        <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-purple-600" />
                Laboratório Preditivo (Cérebro Adaptativo)
            </CardTitle>
            <CardDescription>O cientista usa GBM auto-calibrável para projetar o futuro e medir a própria assertividade.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col min-h-0">
          <ScrollArea className="flex-1">
                <div className="p-1 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <StrongestSignalCard signal={strongestSignal} />
                         <ProjectionExpertsPanel experts={projectionExperts} adaptiveDrifts={adaptiveDriftRef.current} />
                    </div>
                    
                    {priceData.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                            <Bot className="w-12 h-12 mb-4 opacity-30" />
                            <p className="font-semibold">Aguardando dados suficientes do mercado...</p>
                            <p className="text-sm">É necessário um histórico mínimo para a análise estatística.</p>
                        </div>
                    ) : (
                        <div className="min-h-0">
                            <h3 className="text-lg font-semibold mb-2">Preço Real & Projeções Estocásticas</h3>
                            <ResponsiveContainer width="100%" height={350}>
                              <LineChart data={chartDisplayData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="time" label={{ value: 'Tempo (ticks)', position: 'insideBottom', offset: -5 }} />
                                <YAxis tickCount={6} domain={['auto', 'auto']} label={{ value: 'Preço', angle: -90, position: 'insideLeft' }} tickFormatter={(value) => typeof value === 'number' ? value.toFixed(4) : value}/>
                                <Tooltip />
                                <Legend />
                                <Line type="monotone" dataKey="price" stroke="hsl(var(--chart-1))" strokeWidth={2.5} dot={false} name="Preço Real" />
                                {Object.keys(futurePathsRef.current).map((key, index) => (
                                    <Line 
                                        key={key}
                                        type="monotone" 
                                        dataKey={`predicted_${key}_ahead`}
                                        stroke={`hsl(var(--chart-${index + 2}))`}
                                        strokeWidth={key.endsWith('s') ? 1.5 : 2}
                                        dot={false} 
                                        name={`Proj. ${key}`}
                                        strokeDasharray={key.endsWith('s') ? "3 8" : "5 5"}
                                    />
                                ))}
                              </LineChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                    
                     {stats.annualizedVol && (
                       <Card className="mt-6">
                           <CardHeader><CardTitle>Estatísticas Descritivas dos Retornos</CardTitle></CardHeader>
                           <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                <StatItem label="Vol. Anualizada" value={stats.annualizedVol + '%'} />
                                <StatItem label="Assimetria (Skewness)" value={stats.skewness} />
                                <StatItem label="Curtose (Kurtosis)" value={... 
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
