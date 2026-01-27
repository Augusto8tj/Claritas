// src/features/trading/hooks/use-master-autopilot.ts
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { useDerivApiAccumulators } from './use-deriv-api-accumulators';
import { useDerivApiMultipliers } from './use-deriv-api-multipliers';
import { useToast } from '@/hooks/use-toast';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { getCouncilStrategies } from '@/services/council-strategies';
import type { DurationUnit, Operation, OperationInitiator } from '@/lib/types';
import { extractMicrostructureFeatures, type MicrostructureFeatures } from '@/services/advanced-trading-services';


// --- LÓGICA COPIADA DO StochasticLab ---
const normalRandom = (): number => {
    let u1 = 0; while (u1 === 0) u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};
// --- FIM DA LÓGICA COPIADA ---

type ContractType = 'Accumulators' | 'Rise/Fall' | 'Multipliers';
type Signal = 'RISE' | 'FALL' | 'HOLD';
type TrendDirection = 'UP' | 'DOWN' | 'NONE';

interface AssertivenessData {
    accuracy: number;
    vote: Signal;
}

export interface RiskManagerStatus {
    mode: 'Normal' | 'Cautious';
    assertivenessThreshold: number;
    lastAdjustmentReason: string;
}

export interface MasterAutopilotState {
    isReady: boolean;
    assertiveness: Record<string, AssertivenessData>;
    trigger: {
        signal: Signal;
        reason: string;
        triggeredBy: [string, string] | null;
    };
    manualTrigger: { // NOVO para o botão manual
        signal: Signal;
        reason: string;
    };
    indicators: Indicators | null;
    microstructure: MicrostructureFeatures | null;
}

export function useMasterAutopilot() {
  const { 
    priceTicks: priceTicksV2, 
    botCandleData: botCandleDataV2, 
    executeTrade: executeRiseFallTrade,
    operationsLog: operationsLogV2,
    isConnected: isConnectedV2,
    activeSymbol: activeSymbolV2,
  } = useDerivApiV2();
  
  const { 
    executeTrade: executeAccumulatorTrade,
    operationsLog: operationsLogAccumulators,
    isConnected: isConnectedAccumulators,
    activeSymbol: activeSymbolAccumulators,
  } = useDerivApiAccumulators();

  const {
    executeTrade: executeMultiplierTrade,
    isConnected: isConnectedMultipliers,
    activeSymbol: activeSymbolMultipliers,
    operationsLog: operationsLogMultipliers,
  } = useDerivApiMultipliers();
  
  const { toast } = useToast();

  const [isAutopilotOn, setIsAutopilotOn] = useState(false);
  const [contractType, setContractType] = useState<ContractType>('Accumulators');
  const [dailyBalance, setDailyBalance] = useState(100.0);
  const [dailyTarget, setDailyTarget] = useState(20.0);
  
  const [riskManager, setRiskManager] = useState<RiskManagerStatus>({
      mode: 'Normal',
      assertivenessThreshold: 80,
      lastAdjustmentReason: 'N/A'
  });
  const processedTradesRef = useRef<Set<number>>(new Set());

  const [masterState, setMasterState] = useState<MasterAutopilotState>({
    isReady: false,
    assertiveness: {},
    trigger: {
        signal: 'HOLD',
        reason: 'Piloto desativado ou dados insuficientes.',
        triggeredBy: null,
    },
    manualTrigger: {
        signal: 'HOLD',
        reason: 'Aguardando consenso dos modelos.'
    },
    indicators: null,
    microstructure: null,
  });
  
  const masterStateRef = useRef(masterState);
  masterStateRef.current = masterState;

  const [macroTrend, setMacroTrend] = useState<TrendDirection>('NONE');
  const macroTrendRef = useRef(macroTrend);
  macroTrendRef.current = macroTrend;
  
  const isCoolingDownRef = useRef(false);
  
  const activeSymbol = 
      contractType === 'Accumulators' ? activeSymbolAccumulators : 
      contractType === 'Multipliers' ? activeSymbolMultipliers : 
      activeSymbolV2;
  const priceTicks = 
      contractType === 'Accumulators' ? priceTicksV2 :
      contractType === 'Multipliers' ? priceTicksV2 :
      priceTicksV2;
  const botCandleData = 
      contractType === 'Accumulators' ? botCandleDataV2 :
      contractType === 'Multipliers' ? botCandleDataV2 :
      botCandleDataV2;
  const operationsLog = 
      contractType === 'Accumulators' ? operationsLogAccumulators : 
      contractType === 'Multipliers' ? operationsLogMultipliers :
      operationsLogV2;
  const isConnected = 
      contractType === 'Accumulators' ? isConnectedAccumulators : 
      contractType === 'Multipliers' ? isConnectedMultipliers :
      isConnectedV2;
      
  const priceTicksRef = useRef(priceTicks);
  priceTicksRef.current = priceTicks;
  const botCandleDataRef = useRef(botCandleData);
  botCandleDataRef.current = botCandleData;
  const operationsLogRef = useRef(operationsLog);
  operationsLogRef.current = operationsLog;
  const riskManagerRef = useRef(riskManager);
  riskManagerRef.current = riskManager;

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

  const toggleAutopilot = useCallback((checked: boolean) => {
    setIsAutopilotOn(checked);
    toast({ title: `Master Autopilot ${checked ? 'Ativado' : 'Desativado'}` });
    if (!checked) {
        setMasterState(prev => ({...prev, trigger: { signal: 'HOLD', reason: 'Piloto desativado.', triggeredBy: null}}));
    }
  }, [toast]);
  
  const executeTradeAction = useCallback(async (initiator: OperationInitiator, signalOverride?: Signal) => {
      const { trigger, indicators } = masterStateRef.current;
      const currentMacroTrend = macroTrendRef.current;
      
      const signalToUse = signalOverride || trigger.signal;
      const { triggeredBy } = trigger;
      
      if (signalToUse === 'HOLD' || !activeSymbol) {
          toast({ title: "Nenhum sinal válido", description: "O gatilho preditivo não detectou uma oportunidade.", variant: "destructive"});
          return;
      }

      toast({ title: `🤖 Master Autopilot: Ordem ${initiator} ${signalToUse}!`, description: `Executando ${contractType} em ${activeSymbol}`});

      try {
          if (contractType === 'Accumulators') {
              await executeAccumulatorTrade(1.0, 0.03, activeSymbol, initiator);
          } else if (contractType === 'Rise/Fall' && triggeredBy) {
              const longerHorizon = triggeredBy[1]; 
              const durationMatch = longerHorizon.match(/(\d+)([st])/);
              if (durationMatch) {
                  const duration = parseInt(durationMatch[1], 10);
                  const durationUnit = durationMatch[2] as 's' | 't';
                  await executeRiseFallTrade(
                      signalToUse === 'RISE' ? 'CALL' : 'PUT',
                      1.0,
                      activeSymbol,
                      signalToUse.toLowerCase() as 'rise' | 'fall',
                      duration,
                      durationUnit,
                      initiator
                  );
              }
          } else if (contractType === 'Multipliers' && triggeredBy && indicators && indicators.atr) {
              const currentPrice = priceTicksRef.current[priceTicksRef.current.length-1].price;
              const baseStake = dailyBalance * 0.02;
              const volatilityFactor = Math.max(0.5, 1 - (indicators.atr / currentPrice * 100));
              const finalStake = parseFloat(Math.max(1.0, Math.min(baseStake * volatilityFactor, 5.0)).toFixed(2));
              const stopLoss = finalStake;
              const takeProfit = finalStake * 1.5;

              await executeMultiplierTrade(
                  signalToUse === 'RISE' ? 'MULTUP' : 'MULTDOWN',
                  finalStake,
                  activeSymbol,
                  100, 
                  takeProfit,
                  stopLoss,
                  undefined,
                  initiator
              );
          }
      } catch (error) {
          console.error("Master Autopilot Execution Error:", error);
          toast({ title: `❌ Erro na Execução ${initiator}`, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      }

  }, [contractType, activeSymbol, executeAccumulatorTrade, executeRiseFallTrade, executeMultiplierTrade, dailyBalance, toast]);

  const executeManualTrigger = useCallback(async () => {
    const { signal } = masterStateRef.current.manualTrigger;
    await executeTradeAction('Manual', signal);
  }, [executeTradeAction]);
  
  const setAssertivenessThreshold = useCallback((value: number) => {
      setRiskManager(prev => ({...prev, assertivenessThreshold: value}));
  }, []);

  useEffect(() => {
    if (!isAutopilotOn && !isConnected) {
        if(masterState.trigger.signal !== 'HOLD') {
            setMasterState(prev => ({...prev, trigger: { signal: 'HOLD', reason: 'Piloto desativado.', triggeredBy: null }}));
        }
        return;
    }
    
    if (priceTicksRef.current.length < 50) {
      if(!masterState.isReady || masterState.trigger.signal !== 'HOLD') {
        setMasterState(prev => ({
          ...prev,
          isReady: false,
          trigger: { signal: 'HOLD', reason: isAutopilotOn ? 'Aguardando dados suficientes...' : 'Piloto desativado.', triggeredBy: null }
        }));
      }
      return;
    }

    const interval = setInterval(() => {
        const currentPriceTicks = priceTicksRef.current;
        const currentBotCandleData = botCandleDataRef.current;
        const currentOperationsLog = operationsLogRef.current;
        const currentRiskManager = riskManagerRef.current;

        const lastClosedPilotTrade = currentOperationsLog.find(op => 
            op.initiator === 'Piloto' && 
            op.status !== 'pending' && 
            !processedTradesRef.current.has(op.id)
        );

        if (lastClosedPilotTrade) {
            processedTradesRef.current.add(lastClosedPilotTrade.id);
            if ((lastClosedPilotTrade.result || 0) < 0) {
                setRiskManager(prev => {
                    const newThreshold = Math.min(95, prev.assertivenessThreshold + 5);
                    return {
                        mode: 'Cautious',
                        assertivenessThreshold: newThreshold,
                        lastAdjustmentReason: `Perda de $${Math.abs(lastClosedPilotTrade.result || 0).toFixed(2)}. Aumentando limiar para ${newThreshold}%.`
                    };
                });
                toast({ title: "Master Autopilot: Modo Cauteloso Ativado", description: "Limiar de assertividade aumentado.", variant: "destructive" });
            } else {
                setRiskManager(prev => {
                    const newThreshold = Math.max(80, prev.assertivenessThreshold - 1);
                    return {
                        mode: 'Normal',
                        assertivenessThreshold: newThreshold,
                        lastAdjustmentReason: `Ganho de $${(lastClosedPilotTrade.result || 0).toFixed(2)}. Reduzindo limiar para ${newThreshold}%.`
                    };
                });
            }
        }
        
        if (isCoolingDownRef.current) {
            setMasterState(prev => ({...prev, trigger: { ...prev.trigger, reason: 'Em cooldown pós-trade.'}}))
            return;
        }
        const openMasterTrade = currentOperationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');
        if (openMasterTrade) {
            setMasterState(prev => ({...prev, trigger: { ...prev.trigger, reason: `Gerindo posição aberta #${openMasterTrade.id}.`}}))
            return;
        }

        const prices = currentPriceTicks.map(d => d.price);
        const VOL_WINDOW = 50;
        const lastPrice = prices[prices.length - 1];
        const logReturns: number[] = [];
        for (let i = Math.max(1, prices.length - VOL_WINDOW); i < prices.length; i++) {
            if(prices[i-1] > 0) logReturns.push(Math.log(prices[i] / prices[i - 1]));
        }

        if(logReturns.length === 0) return;

        const meanLastReturn = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
        const lastVariance = logReturns.reduce((s, r) => s + Math.pow(r - meanLastReturn, 2), 0) / (logReturns.length - 1);
        const lastSigma = Math.sqrt(lastVariance);
        
        const calculatedIndicators = calculateAllIndicators(currentBotCandleData, getCouncilStrategies(), '1m', {duration: 15, unit: 's'});
        const microFeatures = extractMicrostructureFeatures(currentPriceTicks, currentBotCandleData);

        if (calculatedIndicators && calculatedIndicators.ma.long) {
            const detectedTrend: TrendDirection = lastPrice > calculatedIndicators.ma.long ? 'UP' : 'DOWN';
            if (macroTrendRef.current !== detectedTrend) setMacroTrend(detectedTrend);
        }

        const projectPath = (steps: number) => {
            let currentSimPrice = lastPrice;
            const path: { time: number, price: number }[] = [];
            for (let i = 1; i <= steps; i++) {
                const Z = normalRandom();
                const drift_future = meanLastReturn;
                const diffusion_future = lastSigma * Math.sqrt(1) * Z;
                currentSimPrice = currentSimPrice * Math.exp(drift_future + diffusion_future);
                path.push({ time: prices.length - 1 + i, price: currentSimPrice });
            }
            return path;
        };

        const horizons = [
            { name: '3t', ticks: 3, window: 6 }, { name: '6t', ticks: 6, window: 6 },
            { name: '10s', ticks: 10, window: 10 }, { name: '20s', ticks: 20, window: 10 },
            { name: '30s', ticks: 30, window: 10 }, { name: '40s', ticks: 40, window: 10 },
        ];
        
        const newAssertiveness: Record<string, AssertivenessData> = {};

        horizons.forEach(h => {
            const { name, ticks, window } = h;
            const pendingRef = pendingPredictionsRefs[name as keyof typeof pendingPredictionsRefs];
            const historyRef = accuracyHistoryRefs[name as keyof typeof accuracyHistoryRefs];
            const newFuturePath = projectPath(ticks);
            const currentTimeIndex = prices.length - 1;
            let newHistory: boolean[] = [];

            const updatedPending = pendingRef.current.filter((pred) => {
                if (currentTimeIndex >= pred.startTimeIndex + ticks) {
                    const actualEndPrice = prices[pred.startTimeIndex + ticks];
                    if (actualEndPrice === undefined) return true;
                    const predictedDirection = pred.predictedEndPrice > pred.startPrice;
                    const actualDirection = actualEndPrice > pred.startPrice;
                    newHistory.push(predictedDirection === actualDirection);
                    return false;
                }
                return true;
            });
            pendingRef.current = updatedPending;
            if (newHistory.length > 0) historyRef.current = [...historyRef.current.slice(-window + newHistory.length), ...newHistory];
            if (newFuturePath.length === ticks) {
                pendingRef.current.push({
                    startTimeIndex: prices.length -1,
                    startPrice: lastPrice,
                    predictedEndPrice: newFuturePath[ticks - 1].price,
                });
            }
            const hits = historyRef.current.filter(h => h).length;
            const total = historyRef.current.length;
            const accuracy = total > 0 ? (hits / total) * 100 : 0;
            const vote: Signal = newFuturePath.length > 0 ? (newFuturePath[newFuturePath.length - 1].price > lastPrice ? 'RISE' : 'FALL') : 'HOLD';
            newAssertiveness[name] = { accuracy, vote };
        });

        // --- Lógica para Trigger Manual ---
        const votes = Object.values(newAssertiveness).map(a => a.vote);
        const riseVotes = votes.filter(v => v === 'RISE').length;
        const fallVotes = votes.filter(v => v === 'FALL').length;
        let manualSignal: Signal = 'HOLD';
        let manualReason = 'Aguardando consenso dos modelos.';
        if (riseVotes >= 4) {
            manualSignal = 'RISE';
            manualReason = `${riseVotes}/6 modelos concordam com alta.`;
        } else if (fallVotes >= 4) {
            manualSignal = 'FALL';
            manualReason = `${fallVotes}/6 modelos concordam com baixa.`;
        }
        
        // --- Lógica para Trigger do Piloto ---
        let triggerSignal: Signal = 'HOLD';
        let triggerReason = `Nenhuma confirmação dupla de assertividade (> ${currentRiskManager.assertivenessThreshold}%).`;
        let triggeredBy: [string, string] | null = null;
        
        for (let i = 1; i < horizons.length; i++) {
            const currentHorizon = horizons[i].name;
            const prevHorizon = horizons[i-1].name;
            if (newAssertiveness[currentHorizon].accuracy > currentRiskManager.assertivenessThreshold && newAssertiveness[prevHorizon].accuracy > currentRiskManager.assertivenessThreshold) {
                if (newAssertiveness[currentHorizon].vote === newAssertiveness[prevHorizon].vote && newAssertiveness[currentHorizon].vote !== 'HOLD') {
                    const signalCandidate = newAssertiveness[currentHorizon].vote;
                    if (contractType === 'Multipliers' || contractType === 'Rise/Fall') {
                        if ((signalCandidate === 'RISE' && macroTrendRef.current === 'UP') || (signalCandidate === 'FALL' && macroTrendRef.current === 'DOWN')) {
                           triggerSignal = signalCandidate;
                           triggeredBy = [prevHorizon, currentHorizon];
                           triggerReason = `Gatilho ${triggerSignal} confirmado por assertividade e alinhamento com a tendência macro.`;
                           break;
                        } else {
                           triggerReason = `Sinal ${signalCandidate} ignorado. Contra a tendência macro (${macroTrendRef.current}).`;
                        }
                    } else { // Accumulators
                        triggerSignal = 'RISE'; // Sinal de estabilidade
                        triggeredBy = [prevHorizon, currentHorizon];
                        triggerReason = `Gatilho de estabilidade detectado por assertividade em ${prevHorizon} e ${currentHorizon}.`;
                        break;
                    }
                }
            }
        }
        
        const currentState: Omit<MasterAutopilotState, 'isReady'> = { 
            assertiveness: newAssertiveness, 
            trigger: { signal: 'HOLD', reason: triggerReason, triggeredBy: null },
            manualTrigger: { signal: manualSignal, reason: manualReason },
            indicators: calculatedIndicators, 
            microstructure: microFeatures 
        };

        if (triggerSignal !== 'HOLD' && !isCoolingDownRef.current && !openMasterTrade && isAutopilotOn) {
            isCoolingDownRef.current = true;
            currentState.trigger = { signal: triggerSignal, reason: `Gatilho ${triggerSignal} detectado! Executando...`, triggeredBy };
            
            executeTradeAction('Piloto').finally(() => {
                setTimeout(() => { isCoolingDownRef.current = false; }, 60000);
            });
        } else {
             currentState.trigger = { signal: triggerSignal, reason: triggerReason, triggeredBy: triggeredBy };
        }

        setMasterState(prev => ({...prev, ...currentState, isReady: true }));

    }, 2000);

    return () => clearInterval(interval);

  }, [isAutopilotOn, isConnected, executeTradeAction, toast, dailyBalance]);
    
  return {
    isAutopilotOn,
    toggleAutopilot,
    contractType,
    setContractType,
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
    masterState,
    riskManager,
    setAssertivenessThreshold,
    macroTrend,
    executeManualTrigger,
  };
}

```
<content><![CDATA[// src/features/trading/components/master-autopilot/master-autopilot-interface.tsx
'use client';

import React, { useState } from 'react';
import { useMasterAutopilot } from '../../hooks/use-master-autopilot';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Crosshair, Target, Bot, Power, BarChart, TrendingUp, TrendingDown, ShieldQuestion, Brain, BarChart3, Scale, Zap, ChevronsUpDown, Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import type { MasterAutopilotState, RiskManagerStatus } from '../../hooks/use-master-autopilot';
import type { Indicators } from '@/services/indicator-service';
import type { MicrostructureFeatures } from '@/services/advanced-trading-services';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Slider } from '@/components/ui/slider';


const getProgressColor = (percentage: number) => {
    if (percentage > 80) return 'bg-green-500';
    if (percentage > 60) return 'bg-blue-500';
    if (percentage < 40) return 'bg-red-500';
    return 'bg-gray-400';
};

function MasterAutopilotDashboard({ state, riskManager, macroTrend }: { state: MasterAutopilotState, riskManager: RiskManagerStatus, macroTrend: 'UP' | 'DOWN' | 'NONE' }) {
    if (!state.isReady) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Painel Analítico Completo</CardTitle>
                </CardHeader>
                <CardContent className="text-center text-muted-foreground p-8">
                    Aguardando dados suficientes para a análise...
                </CardContent>
            </Card>
        );
    }
    
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Coluna 1: Assertividade */}
            <Card className="lg:col-span-1">
                <CardHeader>
                    <CardTitle className="text-lg font-headline flex items-center gap-2">
                        <Target className="h-5 w-5 text-primary" /> Assertividade Preditiva
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {Object.entries(state.assertiveness).map(([horizon, data]) => (
                        <div key={horizon}>
                            <div className="flex justify-between items-center text-xs text-muted-foreground mb-1">
                                <span className="font-semibold">{horizon}</span>
                                <div className={cn('font-bold flex items-center gap-1', data.vote === 'RISE' && 'text-green-600', data.vote === 'FALL' && 'text-red-600')}>
                                    {data.vote === 'RISE' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {data.vote}
                                </div>
                            </div>
                            <Progress value={data.accuracy} className="h-1.5" indicatorClassName={getProgressColor(data.accuracy)} />
                            <div className="text-right text-xs font-bold mt-1">{data.accuracy.toFixed(1)}%</div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* Coluna 2: Análise e Risco */}
            <div className="lg:col-span-2 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg font-headline flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Tendência Macro</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className={cn(
                                "p-3 rounded-md text-center font-bold text-lg flex items-center justify-center gap-2",
                                macroTrend === 'UP' && 'bg-green-500/20 text-green-700',
                                macroTrend === 'DOWN' && 'bg-red-500/20 text-red-700',
                                macroTrend === 'NONE' && 'bg-gray-500/20 text-gray-700'
                            )}>
                                {macroTrend === 'UP' ? <TrendingUp className="h-5 w-5" /> : macroTrend === 'DOWN' ? <TrendingDown className="h-5 w-5" /> : <BarChart3 className="h-5 w-5" />}
                                <span>Modo {macroTrend === 'UP' ? 'Compra' : macroTrend === 'DOWN' ? 'Venda' : 'Indefinido'}</span>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg font-headline flex items-center gap-2"><ShieldQuestion className="h-5 w-5" /> Risco Adaptativo</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex justify-between items-center text-sm"><span className="text-muted-foreground">Modo:</span><Badge variant={riskManager.mode === 'Cautious' ? 'destructive' : 'secondary'}>{riskManager.mode}</Badge></div>
                            <div className="flex justify-between items-center text-sm"><span className="text-muted-foreground">Limiar Atual:</span><span className="font-bold text-primary">{riskManager.assertivenessThreshold}%</span></div>
                        </CardContent>
                    </Card>
                </div>
                 <Alert className={cn("col-span-1 md:col-span-2", state.trigger.signal === 'HOLD' && 'bg-amber-500/10 border-amber-500/30 text-amber-800', state.trigger.signal !== 'HOLD' && 'bg-primary/10 border-primary/30 text-primary')}>
                    <Zap className="h-4 w-4" />
                    <AlertTitle className="font-bold">Status do Gatilho do Piloto</AlertTitle>
                    <AlertDescription className="text-xs">{state.trigger.reason}</AlertDescription>
                </Alert>
                <div className="grid grid-cols-2 gap-4">
                    {state.indicators && <IndicatorCard indicators={state.indicators} />}
                    {state.microstructure && <MicrostructureCard microstructure={state.microstructure} />}
                </div>
            </div>
        </div>
    );
}

const IndicatorCard = ({ indicators }: { indicators: Indicators }) => (
    <Card>
        <CardHeader><CardTitle className="text-base font-headline">Indicadores Chave</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs font-mono">
            <div className="flex justify-between"><span>RSI(14):</span><span className="font-bold">{indicators.rsi?.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>ADX(14):</span><span className="font-bold">{indicators.adx?.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>BBW(%):</span><span className="font-bold">{indicators.bbw?.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>ATR:</span><span className="font-bold">{indicators.atr?.toFixed(4)}</span></div>
        </CardContent>
    </Card>
);

const MicrostructureCard = ({ microstructure }: { microstructure: MicrostructureFeatures }) => (
    <Card>
        <CardHeader><CardTitle className="text-base font-headline">Microestrutura</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs font-mono">
            <div className="flex justify-between"><span>Pressão:</span><span className="font-bold">{microstructure.pressure}</span></div>
            <div className="flex justify-between"><span>Velocidade:</span><span className="font-bold">{microstructure.tickVelocity.toFixed(1)} t/s</span></div>
            <div className="flex justify-between"><span>Vol. YZ:</span><span className="font-bold">{(microstructure.yangZhangVolatility*1000).toFixed(2)}</span></div>
            <div className="flex justify-between"><span>Spike?:</span><span className="font-bold">{microstructure.isSpike ? 'SIM' : 'NÃO'}</span></div>
        </CardContent>
    </Card>
);

export function MasterAutopilotInterface() {
  const autopilot = useMasterAutopilot();
  const [isExecutingManual, setIsExecutingManual] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);

  const handleManualExecution = async () => {
      setIsExecutingManual(true);
      await autopilot.executeManualTrigger();
      setIsExecutingManual(false);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-headline flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Controlo do Piloto Mestre
          </CardTitle>
          <CardDescription>
            Configure e ative o sistema de trading preditivo unificado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="contract-type">Tipo de Contrato</Label>
              <Select value={autopilot.contractType} onValueChange={(value) => autopilot.setContractType(value as any)} disabled={autopilot.isAutopilotOn}>
                <SelectTrigger id="contract-type"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Accumulators">Accumulators (Estabilidade)</SelectItem>
                  <SelectItem value="Multipliers">Multipliers (Tendência)</SelectItem>
                  <SelectItem value="Rise/Fall">Rise/Fall (Direcional)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-2">
                <Label htmlFor="daily-balance">Banca do Dia (USD)</Label>
                <Input id="daily-balance" type="number" value={autopilot.dailyBalance} onChange={e => autopilot.setDailyBalance(Number(e.target.value))} disabled={autopilot.isAutopilotOn} />
            </div>
             <div className="flex-1 space-y-2">
                <Label htmlFor="daily-target">Alvo de Lucro (USD)</Label>
                <Input id="daily-target" type="number" value={autopilot.dailyTarget} onChange={e => autopilot.setDailyTarget(Number(e.target.value))} disabled={autopilot.isAutopilotOn} />
            </div>
          </div>
           <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <div className="flex items-center space-x-2 rounded-lg border p-4">
                <Label htmlFor="master-autopilot-switch" className="font-semibold text-base flex items-center gap-2">
                  <Power className={cn("h-5 w-5 transition-colors", autopilot.isAutopilotOn ? "text-green-500" : "text-muted-foreground")} />
                  Piloto Automático
                </Label>
                <Switch id="master-autopilot-switch" checked={autopilot.isAutopilotOn} onCheckedChange={autopilot.toggleAutopilot} />
              </div>
               <Button 
                variant="outline" 
                className="h-14 flex-1"
                onClick={handleManualExecution}
                disabled={autopilot.masterState.manualTrigger.signal === 'HOLD' || isExecutingManual || autopilot.isAutopilotOn}
               >
                   {isExecutingManual ? <Loader2 className="h-5 w-5 animate-spin"/> : <Send className="h-5 w-5"/>}
                   <div className="ml-2 text-left">
                       <p className="font-bold">Executar Sinal Manual</p>
                       <p className="text-xs text-muted-foreground">Sinal: {autopilot.masterState.manualTrigger.signal} ({autopilot.masterState.manualTrigger.reason})</p>
                   </div>
               </Button>
           </div>
        </CardContent>
      </Card>
      
      <Collapsible>
            <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full">
                    <ChevronsUpDown className="h-4 w-4 mr-2"/>
                    Configurações Avançadas do Piloto
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
               <Card>
                  <CardHeader>
                    <CardTitle className="text-base font-headline">Ajuste de Risco do Piloto Automático</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                        <Label htmlFor="assertiveness-threshold">Limiar de Assertividade (%)</Label>
                        <div className="flex items-center gap-4">
                            <Slider
                                id="assertiveness-threshold"
                                min={65}
                                max={95}
                                step={5}
                                value={[autopilot.riskManager.assertivenessThreshold]}
                                onValueChange={(value) => autopilot.setAssertivenessThreshold(value[0])}
                                disabled={autopilot.isAutopilotOn}
                            />
                            <span className="font-mono text-primary font-bold">{autopilot.riskManager.assertivenessThreshold}%</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Define o quão 'confiante' o piloto deve estar para executar uma ordem. Valores mais altos = menos trades, mas teoricamente mais seguros.</p>
                    </div>
                  </CardContent>
               </Card>
            </CollapsibleContent>
      </Collapsible>

      <Collapsible open={isDashboardOpen} onOpenChange={setIsDashboardOpen}>
          <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full">
                  <ChevronsUpDown className="h-4 w-4 mr-2"/>
                  {isDashboardOpen ? "Ocultar" : "Mostrar"} Painel Analítico Completo
              </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
              <MasterAutopilotDashboard state={autopilot.masterState} riskManager={autopilot.riskManager} macroTrend={autopilot.macroTrend}/>
          </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
