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
import type { ChartData, CandleData, Operation, PredictiveTradeLog } from '@/lib/types';
import { Progress } from "@/components/ui/progress";
import { TooltipProvider, Tooltip as ShadTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { volatilityTraderSchema, type VolatilityTraderFormValues } from "@/features/trading/components/deriv-trader/volatility-trader-interface.types";
import VolatilityTraderInterface from "@/features/trading/components/deriv-trader/volatility-trader-interface";
import { OperationsLogV2 } from "@/features/trading/components/deriv-trader/operations-log-v2";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { getPredictiveTradeLogs, savePredictiveTradeLog } from '@/services/financial-data-service';
import PredictiveLogViewer from '@/components/deriv-trader/PredictiveLogViewer';
import { evaluateTriggerConditions } from '@/features/trading/services/predictive-logic';


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
  gbmSignal: 'RISE' | 'FALL' | 'HOLD';
  rsiSignal: 'RISE' | 'FALL' | 'NEUTRAL';
  momentumSignal: 'RISE' | 'FALL' | 'NEUTRAL';
}

interface ConfirmedSignal {
  signal: 'RISE' | 'FALL' | 'HOLD';
  confidenceScore: number;
  reason: string;
  horizon: string;
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
  onConsensusUpdate: (consensus: ConfirmedSignal) => void;
  isAutopilotOn: boolean;
  setAutopilotStatus: (status: string) => void;
  executeTrade: ReturnType<typeof useDerivApiV2>['executeTrade'];
  predictiveLogs: PredictiveTradeLog[];
  setPredictiveLogs: React.Dispatch<React.SetStateAction<PredictiveTradeLog[]>>;
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


function StochasticLab({ realData, operationsLog, activeSymbol, onConsensusUpdate, isAutopilotOn, setAutopilotStatus, executeTrade, predictiveLogs, setPredictiveLogs }: StochasticLabProps) {
  const { user } = useAuth();
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
  const [futurePath10s, setFuturePath10s] = useState<any[]>([]);
  const [futurePath20s, setFuturePath20s] = useState<any[]>([]);
  const [futurePath30s, setFuturePath30s] = useState<any[]>([]);
  const [futurePath40s, setFuturePath40s] = useState<any[]>([]);
  
  const [driftCorrectionForDisplay, setDriftCorrectionForDisplay] = useState({drift: 0, mae: 0, rmse: 0});

  const predictionErrorsRef = useRef<number[]>([]);
  const accuracyHistoryRefs = {
    '3t': useRef<boolean[]>([]), '6t': useRef<boolean[]>([]), '10s': useRef<boolean[]>([]),
    '20s': useRef<boolean[]>([]), '30s': useRef<boolean[]>([]), '40s': useRef<boolean[]>([]),
  };
  const pendingPredictionsRefs = {
    '3t': useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]),
    '6t': useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]),
    '10s': useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]),
    '20s': useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]),
    '30s': useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]),
    '40s': useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]),
  };
  const pendingLogRef = useRef<Omit<PredictiveTradeLog, 'contractId'> | null>(null);
  const pendingSignalRef = useRef<{ signal: 'RISE' | 'FALL', triggeredBy: [string, string], epoch: number, reason: string, assertivenessSnapshot: any[] } | null>(null);

  const normalRandom = (): number => {
    let u1 = 0;
    while (u1 === 0) { u1 = Math.random(); }
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  
  const executeTradeAction = useCallback(async (
    initiator: 'Piloto' | 'Manual',
    signal: 'RISE' | 'FALL',
    triggeredBy: [string, string] | null
  ) => {
      if (!activeSymbol || !triggeredBy) return { success: false, contractId: undefined };

      const expertName = triggeredBy[1];
      const durationMatch = expertName.match(/(\d+)([st])/);
      if (!durationMatch) return { success: false, contractId: undefined };
      
      const duration = parseInt(durationMatch[1], 10);
      const durationUnit = durationMatch[2] === 't' ? 't' : 's';
      
      return executeTrade(
          signal === 'RISE' ? 'CALL' : 'PUT',
          1.0, 
          activeSymbol,
          signal.toLowerCase() as 'rise' | 'fall',
          duration,
          durationUnit,
          initiator
      );
  }, [activeSymbol, executeTrade]);


  useEffect(() => {
    const VOL_WINDOW = 50;
    const ERROR_MEMORY = 50;
    const RSI_PERIOD = 14;

    const calculateRsi = (prices: number[], period: number) => {
        if (prices.length <= period) return null;
        const slice = prices.slice(-period - 1);
        let gains = 0; let losses = 0;
        for (let i = 1; i < slice.length; i++) {
            const change = slice[i] - slice[i-1];
            if (change > 0) gains += change;
            else losses -= change;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    };

    const calculateMacdHistogram = (prices: number[], fast = 12, slow = 26, signal = 9) => {
      if (prices.length < slow) return null;
      const ema = (data: number[], period: number) => {
          const k = 2 / (period + 1);
          let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
          const emas = [ema];
          for (let i = period; i < data.length; i++) {
              ema = (data[i] * k) + (ema * (1 - k));
              emas.push(ema);
          }
          return emas;
      };
      
      const priceSlice = prices.slice(- (slow + signal)); // Use a relevant slice
      const emaFast = ema(priceSlice, fast);
      const emaSlow = ema(priceSlice, slow);
      const macdLine = emaFast.slice(slow - fast).map((f, i) => f - emaSlow[i]);
      const signalLine = ema(macdLine, signal);
      const histogram = macdLine.slice(macdLine.length - signalLine.length).map((m, i) => m - signalLine[i]);
      return histogram.pop() ?? null;
    };
    
    const getConfirmationSignal = (gbmSignal: StrongestSignal, rsiValue: number | null, macdHist: number | null): ConfirmedSignal => {
      const confirmation: ConfirmationSystem = {
          gbmSignal: gbmSignal.direction,
          rsiSignal: 'NEUTRAL',
          momentumSignal: 'NEUTRAL'
      };

      if (rsiValue !== null) {
          if (rsiValue > 65) confirmation.rsiSignal = 'FALL';
          else if (rsiValue < 35) confirmation.rsiSignal = 'RISE';
      }
      if (macdHist !== null) {
          if (macdHist > 0) confirmation.momentumSignal = 'RISE';
          else if (macdHist < 0) confirmation.momentumSignal = 'FALL';
      }

      const votes = { RISE: 0, FALL: 0 };
      if (confirmation.gbmSignal === 'RISE') votes.RISE++;
      if (confirmation.gbmSignal === 'FALL') votes.FALL++;
      if (confirmation.rsiSignal === 'RISE') votes.RISE++;
      if (confirmation.rsiSignal === 'FALL') votes.FALL++;
      if (confirmation.momentumSignal === 'RISE') votes.RISE++;
      if (confirmation.momentumSignal === 'FALL') votes.FALL++;

      let finalSignal: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
      let reason = 'Sinais divergentes ou insuficientes.';
      let confidenceScore = 0;

      if (votes.RISE >= 2) {
          finalSignal = 'RISE';
          confidenceScore = (votes.RISE / 3) * gbmSignal.certaintyScore;
          reason = `Alta (${votes.RISE}/3): ${confirmation.gbmSignal === 'RISE' ? 'GBM,' : ''} ${confirmation.rsiSignal === 'RISE' ? 'RSI,' : ''} ${confirmation.momentumSignal === 'RISE' ? 'MACD' : ''}`.replace(/,\s*$/, "");
      } else if (votes.FALL >= 2) {
          finalSignal = 'FALL';
          confidenceScore = -1 * (votes.FALL / 3) * gbmSignal.certaintyScore;
          reason = `Baixa (${votes.FALL}/3): ${confirmation.gbmSignal === 'FALL' ? 'GBM,' : ''} ${confirmation.rsiSignal === 'FALL' ? 'RSI,' : ''} ${confirmation.momentumSignal === 'FALL' ? 'MACD' : ''}`.replace(/,\s*$/, "");
      }

      return { signal: finalSignal, confidenceScore, reason, horizon: gbmSignal.horizon };
    };

    const executeLogic = () => {
        if (realData.length < VOL_WINDOW) return;
        
        const prices = realData.map(d => isCandle(d) ? d.close : d.price);
        if(prices.length > 0) setLastPrice(prices[prices.length - 1]);
        setPriceData(realData.map((d, i) => ({ time: i, price: isCandle(d) ? d.close : d.price })));

        const logReturns: number[] = [];
        for (let i = 1; i < prices.length; i++) {
          if(prices[i-1] > 0) logReturns.push(Math.log(prices[i] / prices[i - 1]));
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
              { name: '3t', ticks: 3, window: 6, ref: pendingPredictions3tRef, historyRef: accuracyHistoryRefs['3t'] },
              { name: '6t', ticks: 6, window: 6, ref: pendingPredictions6tRef, historyRef: accuracyHistoryRefs['6t'] },
              { name: '10s', ticks: 10, window: 10, ref: pendingPredictions10sRef, historyRef: accuracyHistoryRefs['10s']},
              { name: '20s', ticks: 20, window: 10, ref: pendingPredictions20sRef, historyRef: accuracyHistoryRefs['20s']},
              { name: '30s', ticks: 30, window: 10, ref: pendingPredictions30sRef, historyRef: accuracyHistoryRefs['30s']},
              { name: '40s', ticks: 40, window: 10, ref: pendingPredictions40sRef, historyRef: accuracyHistoryRefs['40s']},
          ];
          
          horizons.forEach(h => {
              const { ticks, window, ref, historyRef } = h;
              const currentTimeIndex = prices.length - 1;
              let newHistory: boolean[] = [];

              ref.current = ref.current.filter((pred) => {
                  if (currentTimeIndex >= pred.startTimeIndex + ticks) {
                      const actualEndPrice = prices[pred.startTimeIndex + ticks];
                      if (actualEndPrice !== undefined) newHistory.push((pred.predictedEndPrice > pred.startPrice) === (actualEndPrice > pred.startPrice));
                      return false;
                  }
                  return true;
              });
              
              if (newHistory.length > 0) historyRef.current = [...historyRef.current.slice(-window + newHistory.length), ...newHistory];
          });
          
          const paths = horizons.map(h => projectPath(h.ticks));
          horizons.forEach((h, index) => {
            const newFuturePath = paths[index];
            if (newFuturePath.length === h.ticks + 1) {
              h.ref.current.push({ startTimeIndex: lastTime, startPrice: newFuturePath[0].price, predictedEndPrice: newFuturePath[h.ticks].price });
            }
          });
          
          setFuturePath3t(paths[0].map(p => ({ time: p.time, predicted_3t_ahead: p.price })));
          setFuturePath6t(paths[1].map(p => ({ time: p.time, predicted_6t_ahead: p.price })));
          setFuturePath10s(paths[2].map(p => ({ time: p.time, predicted_10s_ahead: p.price })));
          setFuturePath20s(paths[3].map(p => ({ time: p.time, predicted_20s_ahead: p.price })));
          setFuturePath30s(paths[4].map(p => ({ time: p.time, predicted_30s_ahead: p.price })));
          setFuturePath40s(paths[5].map(p => ({ time: p.time, predicted_40s_ahead: p.price })));
          
        }
    };
    const intervalId = setInterval(executeLogic, 1000);
    return () => clearInterval(intervalId);
  }, [realData]);

  // Main Autopilot logic loop
  useEffect(() => {
    if (!isAutopilotOn || cooldownRef.current || !activeSymbol || !executeTradeAction) {
        if (!isAutopilotOn) setAutopilotStatus('Pausado');
        return;
    }
    const currentTick = priceTicks[priceTicks.length - 1];
    if (!currentTick) return;

    const prices = realData.map(d => isCandle(d) ? d.close : d.price);
    const rsiValue = calculateRsi(prices, 14);
    const macdHist = calculateMacdHistogram(prices);

    // This is now always based on the latest state
    const currentConfirmedSignal = getConfirmationSignal(strongestSignal, rsiValue, macdHist);
    onConsensusUpdate(currentConfirmedSignal);

    if (pendingSignalRef.current && currentTick.epoch > pendingSignalRef.current.epoch) {
        const pending = pendingSignalRef.current;
        pendingSignalRef.current = null;
        
        if (currentConfirmedSignal.signal === pending.signal) {
            setAutopilotStatus(currentConfirmedSignal.reason);
            const { newTriggerReason } = evaluateTriggerConditions(
                projectionExperts.reduce((acc, p) => ({...acc, [p.name]: p}), {}),
                [{name:'3t', ticks:3, window:6}, {name:'6t', ticks:6, window:6}, {name:'10s', ticks:10, window:10}, {name:'20s', ticks:20, window:10}, {name:'30s', ticks:30, window:10}, {name:'40s', ticks:40, window:10}]
            );
            
            const newPendingLog: Omit<PredictiveTradeLog, 'contractId'> = {
                id: `pred_log_${Date.now()}`,
                timestamp: new Date().toISOString(),
                asset: activeSymbol,
                tradeParams: { direction: pending.signal, stake: 1.0, duration: 10, durationUnit: 't' }, // Placeholder duration
                context: { triggerReason: newTriggerReason, assertivenessSnapshot: pending.assertivenessSnapshot },
                result: 'pending', pnl: 0,
            };
            pendingLogRef.current = newPendingLog;

            executeTradeAction('Piloto', pending.signal, pending.triggeredBy);
            
            cooldownRef.current = true;
            setTimeout(() => { cooldownRef.current = false; setAutopilotStatus('Monitorando...'); }, 60000);
        } else {
            setAutopilotStatus(`Sinal ${pending.signal} Abortado. Condição não persistiu.`);
            toast({ title: '🤖 Piloto: Operação Abortada', description: `O sinal para ${pending.signal} não foi confirmado no tick seguinte.`, variant: 'destructive' });
        }
        return;
    }
    
    const activeAutopilotTrade = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');
    if (activeAutopilotTrade || isCoolingDownRef.current || pendingSignalRef.current) {
        if (activeAutopilotTrade) setAutopilotStatus(`Gerindo posição #${activeAutopilotTrade.id}`);
        return;
    }
    
    const { newTriggerSignal, newTriggerReason, newTriggeredBy } = evaluateTriggerConditions(
        projectionExperts.reduce((acc, p) => ({...acc, [p.name]: p}), {}),
        [{name:'3t', ticks:3, window:6}, {name:'6t', ticks:6, window:6}, {name:'10s', ticks:10, window:10}, {name:'20s', ticks:20, window:10}, {name:'30s', ticks:30, window:10}, {name:'40s', ticks:40, window:10}]
    );

    if (newTriggerSignal !== 'HOLD' && newTriggeredBy) {
        setAutopilotStatus(newTriggerReason.replace("Executando...", "Aguardando confirmação..."));
        const assertivenessSnapshot = projectionExperts.map(p => ({ horizon: p.name, accuracy: p.accuracy, vote: p.vote }));
        pendingSignalRef.current = { signal: newTriggerSignal, triggeredBy: newTriggeredBy, epoch: currentTick.epoch, reason: newTriggerReason, assertivenessSnapshot };
    } else {
        setAutopilotStatus('Monitorando...');
    }

  }, [realData, isAutopilotOn, operationsLog, activeSymbol, executeTradeAction, user, toast, setAutopilotStatus, onConsensusUpdate]);


  const accuracy3t = useMemo(() => calculateRollingAccuracy(accuracyHistoryRefs['3t'].current), [dataVersion]);
  const accuracy6t = useMemo(() => calculateRollingAccuracy(accuracyHistoryRefs['6t'].current), [dataVersion]);
  const accuracy10s = useMemo(() => calculateRollingAccuracy(accuracyHistoryRefs['10s'].current), [dataVersion]);
  const accuracy20s = useMemo(() => calculateRollingAccuracy(accuracyHistoryRefs['20s'].current), [dataVersion]);
  const accuracy30s = useMemo(() => calculateRollingAccuracy(accuracyHistoryRefs['30s'].current), [dataVersion]);
  const accuracy40s = useMemo(() => calculateRollingAccuracy(accuracyHistoryRefs['40s'].current), [dataVersion]);

   const projectionExperts = useMemo(() => ([
      { name: '3t', vote: futurePath3t.length > 1 ? (futurePath3t[futurePath3t.length - 1].price > futurePath3t[0].price ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy3t.percentage },
      { name: '6t', vote: futurePath6t.length > 1 ? (futurePath6t[futurePath6t.length - 1].price > futurePath6t[0].price ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy6t.percentage },
      { name: '10s', vote: futurePath10s.length > 1 ? (futurePath10s[futurePath10s.length - 1].price > futurePath10s[0].price ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy10s.percentage },
      { name: '20s', vote: futurePath20s.length > 1 ? (futurePath20s[futurePath20s.length - 1].price > futurePath20s[0].price ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy20s.percentage },
      { name: '30s', vote: futurePath30s.length > 1 ? (futurePath30s[futurePath30s.length - 1].price > futurePath30s[0].price ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy30s.percentage },
      { name: '40s', vote: futurePath40s.length > 1 ? (futurePath40s[futurePath40s.length - 1].price > futurePath40s[0].price ? 'RISE' : 'FALL') : 'HOLD', accuracy: accuracy40s.percentage },
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

  // O restante do componente permanece igual

  // ...
  return (
    // ... JSX
    <></>
  );
};
// ... resto do arquivo page.tsx
