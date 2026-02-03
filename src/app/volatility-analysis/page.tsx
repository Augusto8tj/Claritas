// /src/app/volatility-analysis/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useForm, FormProvider, useFormContext } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, Scatter } from 'recharts';
import { TrendingUp, TrendingDown, HelpCircle, Bot, FlaskConical, Target, Info, Brain, Zap, Send, Loader2, ShieldCheck, GitBranch, BarChart, Activity, AlertTriangle, Power, ChevronsUpDown, Settings, Sigma, Shield, X, Check, Skull, PlayCircle, PauseCircle } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from '@/components/ui/skeleton';


/**
 * Wilson Score Interval for a binomial proportion.
 * Provides a confidence interval for the "true" success rate.
 * The lower bound is a conservative estimate, useful for decision making.
 * @param {number} successes - Number of successful trials (wins).
 * @param {number} trials - Total number of trials.
 * @returns {object} An object containing the lower and upper bounds of the confidence interval (0-1).
 */
const wilsonScoreInterval = (successes: number, trials: number): { lower: number; upper: number } => {
  if (trials === 0) {
    return { lower: 0, upper: 1 }; // Max uncertainty
  }
  // z-score for a 90% confidence interval. A good balance between confidence and responsiveness.
  const z = 1.645; 
  const p_hat = successes / trials;
  const n = trials;
  
  const center_adjustment = (z * z) / (2 * n);
  const margin = z * Math.sqrt((p_hat * (1 - p_hat)) / n + (z * z) / (4 * n * n));
  const denominator = 1 + (2 * center_adjustment);
  
  const lower = Math.max(0, (p_hat + center_adjustment - margin) / denominator);
  const upper = Math.min(1, (p_hat + center_adjustment + margin) / denominator);
  
  return { lower, upper };
};


const getProgressColor = (percentage: number) => {
    if (percentage > 55) return 'bg-green-500';
    if (percentage > 50) return 'bg-blue-500';
    if (percentage < 45) return 'bg-red-500';
    return 'bg-gray-400';
};

const isCandle = (d: ChartData): d is CandleData => d != null && 'close' in d;

interface ExpertProjection {
    name: string;
    vote: 'RISE' | 'FALL' | 'HOLD';
    wilson: { lower: number; upper: number };
    rawWinRate: number;
    hits: number;
    total: number;
    status: 'active' | 'suspended' | 'permanently_disabled';
    consecutiveLosses: number;
    totalSuspensions: number;
    lastResult?: boolean;
}


interface StrongestSignal {
    horizon: string;
    direction: 'RISE' | 'FALL' | 'HOLD';
    certaintyScore: number;
    rawWinRate: number;
}


interface StochasticLabProps {
  realData: ChartData[];
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

const StrongestSignalCard = ({ signal, className }: { signal: StrongestSignal, className?: string }) => {
    const isHold = signal.direction === 'HOLD' || signal.certaintyScore === 0;
    const displayAccuracy = Math.max(signal.rawWinRate, 100 - signal.rawWinRate);

    return (
        <Card className={cn("p-4 flex flex-col justify-center", 
            isHold ? 'bg-slate-50' : signal.direction === 'RISE' ? 'bg-green-50' : 'bg-red-50',
            className
        )}>
            <CardTitle className="text-sm font-semibold text-muted-foreground mb-2">Sinal Preditivo Mais Forte</CardTitle>
            {isHold ? (
                <div className="text-center text-muted-foreground">
                    <HelpCircle className="mx-auto h-8 w-8 opacity-50 mb-2"/>
                    <p className="font-bold text-lg">NEUTRO</p>
                    <p className="text-xs">Nenhum especialista com certeza estatística.</p>
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

const ProjectionExpertsPanel = ({ experts, adaptiveDrifts, className }: { experts: ExpertProjection[], adaptiveDrifts: Record<string, number>, className?: string }) => {
    
    const getEffectiveVote = (expert: ExpertProjection | undefined): 'RISE' | 'FALL' | 'HOLD' => {
        if (!expert || expert.vote === 'HOLD' || expert.status !== 'active') return 'HOLD';
        
        if (expert.wilson.lower > 0.5) {
            return expert.vote;
        }
        
        if (expert.wilson.upper < 0.5) {
            return expert.vote === 'RISE' ? 'FALL' : (expert.vote === 'FALL' ? 'RISE' : 'HOLD');
        }

        return 'HOLD';
    };

    const getStatusIcon = (status: ExpertProjection['status']) => {
        switch(status) {
            case 'active': return <PlayCircle size={12} className="text-green-500" />;
            case 'suspended': return <PauseCircle size={12} className="text-orange-500" />;
            case 'permanently_disabled': return <Skull size={12} className="text-destructive" />;
            default: return null;
        }
    }
    
    const getStatusTooltip = (expert: ExpertProjection) => {
        switch(expert.status) {
            case 'active': return 'Operacional';
            case 'suspended': return `Suspenso após ${expert.consecutiveLosses} perdas`;
            case 'permanently_disabled': return `Desabilitado após ${expert.totalSuspensions} suspensões`;
            default: return 'Status desconhecido';
        }
    }

    return (
        <Card className={cn("p-4", className)}>
            <CardTitle className="text-sm font-semibold text-muted-foreground mb-3 flex items-center justify-between">
                <span>Assertividade & Calibração</span>
                <span className="font-mono text-xs">Acertos / Total</span>
            </CardTitle>
            <div className="space-y-2">
                {experts.map((expert) => {
                    const { name, wilson, rawWinRate, hits, total, status } = expert;
                    const effectiveDirection = getEffectiveVote(expert);
                    const drift = adaptiveDrifts[name] || 0;
                    const driftColor = drift > 0.00001 ? 'text-green-500' : drift < -0.00001 ? 'text-red-500' : 'text-gray-400';
                    const displayWinRate = rawWinRate;
                    
                    return (
                        <div key={name} className="flex justify-between items-center bg-background p-2 rounded-md border text-xs">
                           <div className="w-16 flex items-center gap-2">
                             <span className={cn("font-semibold", status !== 'active' && 'text-muted-foreground line-through')}>{name}</span>
                             <TooltipProvider>
                                <ShadTooltip>
                                    <TooltipTrigger asChild>
                                        <div>{getStatusIcon(status)}</div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{getStatusTooltip(expert)}</p>
                                    </TooltipContent>
                                </ShadTooltip>
                             </TooltipProvider>
                           </div>
                            <div className="flex items-center gap-2 w-32">
                                <Progress value={displayWinRate} className="h-1.5 flex-1" indicatorClassName={getProgressColor(displayWinRate)} />
                                <span className="font-mono w-24 text-right">
                                    {displayWinRate.toFixed(0)}%
                                    <span className="text-muted-foreground ml-1">({hits}/{total})</span>
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5 w-16 justify-end">
                                <TooltipProvider>
                                    <ShadTooltip>
                                        <TooltipTrigger>
                                            <div className="flex items-center gap-1.5">
                                                <Sigma size={12} className={driftColor}/>
                                                <span className={cn("font-mono font-bold text-right", driftColor)}>{(drift * 10000).toFixed(1)}</span>
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Fator de Correção de Drift</p>
                                        </TooltipContent>
                                    </ShadTooltip>
                                </TooltipProvider>
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
};

const ASSERTIVENESS_HISTORY_LIMIT = 1000;
const CONSECUTIVE_LOSS_LIMIT = 5;
const CONSECUTIVE_WIN_REACTIVATION = 3;
const MAX_SUSPENSIONS_ALLOWED = 3;
const DRIFT_LIMIT = 0.1;

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
  const [stats, setStats] = useState<any>({ annualizedVol: '0.0000', skewness: '0.0000', kurtosis: '0.0000' });
  
  const futurePathsRef = useRef<Record<string, { time: number; price: number }[]>>({});

  // --- PARÂMETROS DO MODELO GBM PARA 1HZ10V ---
  const GBM_SIGMA = 0.10;
  const GBM_DRIFT_TERM = - (GBM_SIGMA * GBM_SIGMA) / 2;
  
  // --- ESTADO DO CONTROLADOR NEURO-ADAPTATIVO ---
  const ADAPTIVE_DRIFT_LEARNING_RATE = 0.1;
  const getDecayFactor = (horizonName: string): number => {
    if (horizonName.endsWith('t') && parseInt(horizonName.replace('t', '')) <= 10) {
      return 0.90; // Horizontes ultra-curtos esquecem mais rápido
    }
    return 0.95; // Horizontes longos mantêm memória
  };
  const ERROR_HISTORY_LENGTH = 20;

  const adaptiveDriftRef = useRef<Record<string, number>>({});
  const predictionErrorHistoryRef = useRef<Record<string, number[]>>({});

  const [assertivenessStats, setAssertivenessStats] = useState<Record<string, { wins: number; total: number; consecutiveLosses: number; consecutiveWins: number; status: 'active' | 'suspended' | 'permanently_disabled'; totalSuspensions: number; }>>({});
  const assertivenessHistoryRef = useRef<Record<string, boolean[]>>({});
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
    const initialStats: Record<string, { wins: number; total: number; consecutiveLosses: number; consecutiveWins: number; status: 'active' | 'suspended' | 'permanently_disabled'; totalSuspensions: number; }> = {};
    const initialPending: Record<string, any[]> = {};
    const initialDrift: Record<string, number> = {};
    const initialErrorHistory: Record<string, number[]> = {};
    const initialAssertivenessHistory: Record<string, boolean[]> = {};

    horizons.forEach(h => {
        initialStats[h.name] = { wins: 0, total: 0, consecutiveLosses: 0, consecutiveWins: 0, status: 'active', totalSuspensions: 0 };
        initialPending[h.name] = [];
        initialDrift[h.name] = 0;
        initialErrorHistory[h.name] = [];
        initialAssertivenessHistory[h.name] = [];
    });
    setAssertivenessStats(initialStats);
    pendingPredictionsRef.current = initialPending;
    adaptiveDriftRef.current = initialDrift;
    predictionErrorHistoryRef.current = initialErrorHistory;
    assertivenessHistoryRef.current = initialAssertivenessHistory;
  }, [horizons]);

  useEffect(() => {
    const VOL_WINDOW = 50;
    
    if (realData.length < VOL_WINDOW) return;
    
    const prices = realData.map(d => isCandle(d) ? d.close : d.price);
    if(prices.length > 0) setLastPrice(prices[prices.length - 1]);
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

      const projectPath = (steps: number, horizonName: string) => {
        if (lastPriceValue === null) return [];
        let currentSimPrice = lastPriceValue;
        const path = [{ time: lastTime, price: lastPriceValue }];
        
        let driftCorrection = adaptiveDriftRef.current[horizonName] || 0;
        
        driftCorrection = Math.max(-DRIFT_LIMIT, Math.min(DRIFT_LIMIT, driftCorrection));

        for (let i = 1; i <= steps; i++) {
          const Z = normalRandom();
          const exponent = (GBM_DRIFT_TERM + driftCorrection) + GBM_SIGMA * Z;
          currentSimPrice *= Math.exp(exponent);
          path.push({ time: lastTime + i, price: currentSimPrice });
        }
        return path;
      };

      const newFuturePaths: Record<string, any[]> = {};
      const newAssertivenessData: Record<string, { lastResult: boolean }> = {};
      const horizonsToUpdateStats = new Set<string>();
      
      horizons.forEach(h => {
          const currentTimeIndex = prices.length - 1;
          const predictionsToProcess = pendingPredictionsRef.current[h.name] || [];
          const updatedPending = [];

          for (const pred of predictionsToProcess) {
              if (currentTimeIndex >= pred.startTimeIndex + h.ticks) {
                  const actualEndPrice = prices[pred.startTimeIndex + h.ticks];
                  if (actualEndPrice !== undefined) {
                      const predictionError = actualEndPrice - pred.predictedEndPrice;
                      
                      const errorHistory = predictionErrorHistoryRef.current[h.name] || [];
                      errorHistory.push(predictionError);
                      if (errorHistory.length > ERROR_HISTORY_LENGTH) errorHistory.shift();
                      predictionErrorHistoryRef.current[h.name] = errorHistory;
                      
                      const averageError = errorHistory.reduce((a, b) => a + b, 0) / errorHistory.length;
                      const currentDrift = adaptiveDriftRef.current[h.name] || 0;
                      const decayFactor = getDecayFactor(h.name);
                      
                      let newDrift = (currentDrift * decayFactor) + (ADAPTIVE_DRIFT_LEARNING_RATE * averageError);
                      
                      newDrift = Math.max(-DRIFT_LIMIT, Math.min(DRIFT_LIMIT, newDrift));
                      
                      adaptiveDriftRef.current[h.name] = newDrift;

                      const predictedDirection = pred.predictedEndPrice > pred.startPrice;
                      const actualDirection = actualEndPrice > pred.startPrice;
                      const isWin = predictedDirection === actualDirection;

                      const assertivenessHistory = assertivenessHistoryRef.current[h.name] || [];
                      assertivenessHistory.push(isWin);
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

          const newPath = projectPath(h.ticks, h.name);
          newFuturePaths[h.name] = newPath;

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

                    if (lastResult === true) { // isWin
                        consecutiveWins++;
                        consecutiveLosses = 0;
                        if (status === 'suspended' && consecutiveWins >= CONSECUTIVE_WIN_REACTIVATION) {
                            if (totalSuspensions < MAX_SUSPENSIONS_ALLOWED) {
                                status = 'active';
                                totalSuspensions++; // Increment on re-activation
                            } else {
                                status = 'permanently_disabled';
                            }
                        }
                    } else { // isLoss
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
        const path = futurePathsRef.current[h.name] || [];
        const vote = path.length > 1 ? (path[path.length - 1].price > path[0].price ? 'RISE' : 'FALL') : 'HOLD';
        
        const stats = assertivenessStats[h.name] || { wins: 0, total: 0, status: 'active', consecutiveLosses: 0, consecutiveWins: 0, totalSuspensions: 0 };
        const { wins, total, status, consecutiveLosses, totalSuspensions } = stats;
        
        const history = assertivenessHistoryRef.current[h.name] || [];
        const lastResult = history.length > 0 ? history[history.length - 1] : undefined;

        const rawWinRate = total > 0 ? (wins / total) * 100 : 0;
        const wilson = wilsonScoreInterval(wins, total);

        return { 
            name: h.name, 
            vote, 
            wilson, 
            rawWinRate,
            hits: wins, 
            total,
            status,
            consecutiveLosses,
            totalSuspensions,
            lastResult,
        };
    });
  }, [horizons, assertivenessStats, realData]);

  const getEffectiveVote = useCallback((expert: ExpertProjection | undefined): 'RISE' | 'FALL' | 'HOLD' => {
      if (!expert || expert.vote === 'HOLD' || expert.status !== 'active') return 'HOLD';
      
      if (expert.wilson.lower > 0.5) {
          return expert.vote;
      }
      
      if (expert.wilson.upper < 0.5) {
          return expert.vote === 'RISE' ? 'FALL' : (expert.vote === 'FALL' ? 'RISE' : 'HOLD');
      }

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
  
  useEffect(() => {
    onConsensusUpdate({strongestSignal, projectionExperts});
  }, [strongestSignal, onConsensusUpdate, projectionExperts]);

  const medianProjection = useMemo(() => {
    if (priceData.length === 0 || !futurePathsRef.current) return [];
    
    const lastPoint = priceData[priceData.length - 1];
    if (!lastPoint) return [];
    
    const lastTime = lastPoint.time;
    const projectionLength = horizons.reduce((max, h) => Math.max(max, h.ticks), 0);
    const projectionData = [];

    for (let i = 0; i <= projectionLength; i++) {
        const pricesAtTimeStep = horizons
            .map(h => futurePathsRef.current?.[h.name]?.[i]?.price)
            .filter((p): p is number => p !== undefined && !isNaN(p));

        if (pricesAtTimeStep.length > 0) {
            pricesAtTimeStep.sort((a, b) => a - b);
            
            const q1Index = Math.floor(pricesAtTimeStep.length * 0.25);
            const medianIndex = Math.floor(pricesAtTimeStep.length / 2);
            const q3Index = Math.floor(pricesAtTimeStep.length * 0.75);
            
            const q1 = pricesAtTimeStep[q1Index];
            const median = pricesAtTimeStep.length % 2 !== 0
                ? pricesAtTimeStep[medianIndex]
                : (pricesAtTimeStep[medianIndex - 1] + pricesAtTimeStep[medianIndex]) / 2;
            const q3 = pricesAtTimeStep[q3Index];

            projectionData.push({
                time: lastTime + i,
                median,
                q1,
                q3,
            });
        }
    }
    return projectionData;
}, [priceData, horizons]);

  const combinedData = useMemo(() => {
    if (priceData.length === 0) return [];
    
    const displayData = priceData.slice(-70);
    if (medianProjection.length === 0) return displayData;
    
    const lastRealTime = displayData[displayData.length - 1]?.time;
    if (lastRealTime === undefined) return displayData;

    const dataMap = new Map<number, any>();
    displayData.forEach(d => dataMap.set(d.time, { ...d }));
    
    medianProjection.forEach((proj) => {
        const existing = dataMap.get(proj.time);
        if (existing) {
            Object.assign(existing, proj);
        } else {
            if (proj.time > lastRealTime) {
                dataMap.set(proj.time, { time: proj.time, ...proj });
            }
        }
    });
    
    return Array.from(dataMap.values()).sort((a, b) => a.time - b.time);
  }, [priceData, medianProjection]);


  return (
    <Card className="h-full flex flex-col col-span-1 lg:col-span-3">
        <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-purple-600" />
                Laboratório Preditivo (Cérebro Cético V2.1)
            </CardTitle>
            <CardDescription>O cientista usa GBM auto-calibrável, Wilson Score e gestão de risco por modelo para projetar o futuro.</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col min-h-0">
          <ScrollArea className="flex-1">
                <div className="p-1 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                         <StrongestSignalCard signal={strongestSignal} className="md:col-span-1" />
                         <ProjectionExpertsPanel experts={projectionExperts} adaptiveDrifts={adaptiveDriftRef.current} className="md:col-span-3" />
                    </div>
                    
                    <VolatilityProjectionChart 
                        chartData={combinedData}
                    />
                    
                     <Card className="mt-6">
                        <CardHeader>
                            <CardTitle>Estatísticas Descritivas dos Retornos</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                            <StatItem label="Volatilidade Anualizada" value={`${stats.annualizedVol || 0}%`} />
                            <StatItem label="Assimetria (Skewness)" value={stats.skewness || 0} />
                            <StatItem label="Curtose (Kurtosis)" value={stats.kurtosis || 0} />
                        </CardContent>
                    </Card>
                    
                     <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
                        <TabsList className="grid grid-cols-1">
                            <TabsTrigger value="audit">Auditoria Preditiva ({predictiveLogs.length} Registos)</TabsTrigger>
                        </TabsList>
                        <TabsContent value="audit" className="mt-4">
                          <PredictiveLogViewer logs={predictiveLogs} onDeleteLog={onDeletePredictiveLog} deletingPredictiveLogId={deletingPredictiveLogId} />
                        </TabsContent>
                     </Tabs>
                </div>
            </ScrollArea>
        </CardContent>
    </Card>
  );
}

function VolatilityProjectionChart({ chartData, className }: { 
  chartData: any[];
  className?: string;
}) {
    if (!chartData || chartData.length === 0) {
        return (
            <div className={cn("flex flex-col items-center justify-center h-64 text-muted-foreground", className)}>
                <Loader2 className="w-12 h-12 mb-4 opacity-30 animate-spin" />
                <p className="font-semibold">A carregar dados do mercado...</p>
            </div>
        )
    }

    const lastRealPoint = useMemo(() => {
        for (let i = chartData.length - 1; i >= 0; i--) {
            if (chartData[i].price !== undefined) {
                return chartData[i];
            }
        }
        return null;
    }, [chartData]);

    return (
        <Card className={cn("h-[500px]", className)}>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-purple-600" />
                    Projeção Preditiva: Histórico vs. Consenso
                </CardTitle>
                <CardDescription className="flex items-center gap-2 text-xs">
                    <Info className="h-3 w-3" />
                    Cone sombreado = margem de incerteza (25%-75%) | Linha tracejada = previsão mais provável
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={380}>
                    <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                        <XAxis 
                            dataKey="time" 
                            hide={true}
                        />
                        <YAxis
                            domain={['auto', 'auto']}
                            tickFormatter={(v) => typeof v === 'number' ? v.toFixed(4) : ''}
                            orientation="right"
                            axisLine={false}
                            tickLine={false}
                            width={80}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: 'hsl(var(--background))',
                                borderColor: 'hsl(var(--border))',
                                borderRadius: 'var(--radius)',
                                padding: '12px',
                            }}
                            labelFormatter={(label) => `Tick Epoch: ${label}`}
                             formatter={(value: number, name: string) => {
                                const formattedValue = `${Number(value).toFixed(4)}`;
                                if (name === 'price') return [formattedValue, 'Preço Real'];
                                if (name === 'median') return [formattedValue, 'Mediana (50%)'];
                                if (name === 'q1') return [formattedValue, 'Cenário Pessimista (25%)'];
                                if (name === 'q3') return [formattedValue, 'Cenário Otimista (75%)'];
                                return [formattedValue, name];
                            }}
                        />
                        
                        <Area
                            type="monotone"
                            dataKey="q3"
                            stackId="projection"
                            stroke="none"
                            fill="hsl(var(--accent))"
                            fillOpacity={0.15}
                            name="Limite Superior"
                            isAnimationActive={false}
                        />
                        <Area
                            type="monotone"
                            dataKey="q1"
                            stackId="projection"
                            stroke="none"
                            fill="hsl(var(--background))"
                            fillOpacity={1.0}
                            name="Limite Inferior"
                            isAnimationActive={false}
                        />
                        
                        <Line
                            type="monotone"
                            dataKey="price"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2.5}
                            dot={false}
                            name="Preço Real"
                            isAnimationActive={false}
                        />
                        
                        <Line
                            type="monotone"
                            dataKey="median"
                            stroke="hsl(var(--accent))"
                            strokeWidth={2.5}
                            strokeDasharray="5 5"
                            dot={false}
                            name="Projeção Mediana"
                            isAnimationActive={false}
                        />

                        {lastRealPoint && (
                            <ReferenceLine 
                                x={lastRealPoint.time} 
                                stroke="hsl(var(--primary))" 
                                strokeWidth={1.5} 
                                strokeDasharray="2 4"
                                label={{
                                    value: "AGORA",
                                    position: "top",
                                    fill: "hsl(var(--primary))",
                                    fontSize: 10,
                                    fontWeight: "bold",
                                    offset: 10
                                }}
                            />
                        )}
                    </LineChart>
                </ResponsiveContainer>
                
                <div className="flex flex-wrap gap-4 mt-4 text-xs justify-center">
                    <div className="flex items-center gap-1.5">
                        <div className="w-4 h-0.5 rounded bg-[hsl(var(--primary))]"/>
                        <span>Preço Real</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-4 border-t-2 border-dashed border-[hsl(var(--accent))]"/>
                        <span>Mediana (Mais Provável)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-4 h-3 rounded bg-[hsl(var(--accent))] opacity-15"/>
                        <span>Cone de Incerteza (Q1-Q3)</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function PageContent() {
  const { 
    activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading, 
    chartData, operationsLog, sellContract, clearActiveContracts,
    priceTicks, durationLimits,
  } = useDerivApi();
  const { toast } = useToast();
  const [consensusData, setConsensusData] = useState<any>(null);
  const [predictiveLogs, setPredictiveLogs] = useState<PredictiveTradeLog[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(true);
  const [deletingPredictiveLogId, setDeletingPredictiveLogId] = useState<string | null>(null);
  const { user } = useAuth();
  
  const autopilot = useMasterAutopilot();
  const { isAutopilotOn, runAutopilotCycle } = autopilot;
  
  const form = useFormContext<VolatilityTraderFormValues>();

  const handleConsensusUpdate = useCallback((data: any) => {
    setConsensusData(data);
    if (isAutopilotOn && data?.projectionExperts) {
      const assertiveness: Record<string, AssertivenessData> = Object.fromEntries(
        data.projectionExperts.map((p: any) => [p.name, { accuracy: p.rawWinRate, vote: p.vote, lastResult: p.lastResult }])
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
      } catch (error: any) {
        console.error("Failed to fetch predictive logs:", error);
        if (error instanceof FirestorePermissionError) {
           errorEmitter.emit('permission-error', error);
        } else {
             toast({ title: "Erro ao Carregar Logs", description: "Não foi possível buscar os dados de auditoria preditiva.", variant: "destructive" });
        }
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
      description: `Duração definida para ${duration}${durationUnit === 's' ? ' segundos' : ' ticks'}, com base no sinal de ${horizon}.`,
    });
  };
  

  return (
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
                        <span className="font-normal text-xs text-muted-foreground">(Ignorado para sinais HF)</span>
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
                          min={51} max={70} step={1}
                          value={[Object.values(autopilot.riskManager.thresholds)[0] || 52]}
                          onValueChange={(value) => autopilot.setGlobalAssertivenessThreshold(value[0])}
                          disabled={autopilot.isAutopilotOn}
                        />
                        <span className="font-mono text-primary font-bold">{Object.values(autopilot.riskManager.thresholds)[0] || 52}%</span>
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
                            min={51} max={70} step={1}
                            value={[autopilot.riskManager.thresholds[horizon] || 52]}
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
  );
}

export default function VolatilityAnalysisPage() {
    const form = useForm<VolatilityTraderFormValues>({
        resolver: zodResolver(volatilityTraderSchema),
        defaultValues: {
            stake: 1.0,
            duration: 15,
        },
    });

  return (
    <DerivApiProvider>
      <FormProvider {...form}>
        <PageContent />
      </FormProvider>
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
  projectionExperts: ExpertProjection[],
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
        <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/50">
          <Label htmlFor="autopilot-switch" className="font-semibold text-base flex items-center gap-2">
            <Power className={cn("h-5 w-5 transition-colors", autopilot.isAutopilotOn ? "text-green-500" : "text-muted-foreground")} />
            Status do Piloto
          </Label>
          <Switch
            id="autopilot-switch"
            checked={autopilot.isAutopilotOn}
            onCheckedChange={autopilot.toggleAutopilot}
            className="data-[state=checked]:bg-green-600"
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
                const accuracy = expert?.rawWinRate || 0;
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
