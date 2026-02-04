// src/features/trading/hooks/use-robot-council-digits.ts
'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { RobotPerformance, TickData, Asset, Operation } from '@/lib/types';
import { useDerivApiDigits } from './use-deriv-api-digits';

// ============================================================================
// TIPOS E CONFIGURAÇÕES
// ============================================================================
export type DigitStats = {
    digit: number;
    count: number;
    probability: number;
};

export type PilotType = 'matchesDiffers' | 'overUnder' | 'evenOdd';

type CouncilStrategy = {
  id: string;
  type: 'DIGITDIFF' | 'DIGITMATCH' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';
  description: string;
  pilot: PilotType;
  prediction?: number;
};

type VirtualTrade = {
  id: string;
  robotId: string;
  contractType: CouncilStrategy['type'];
  prediction?: number;
  entryEpoch: number;
  exitEpoch: number;
};

export type AutopilotStatus = 'PAUSED' | 'WARMING_UP' | 'TRADING' | 'RECOVERING';
const WARMUP_DURATION_MS = 60000;

const councilStrategies: CouncilStrategy[] = [
  { id: 'diff_most_freq', type: 'DIGITDIFF', pilot: 'matchesDiffers', description: 'Difere do dígito mais frequente' },
  { id: 'match_least_freq', type: 'DIGITMATCH', pilot: 'matchesDiffers', description: 'Combina com o dígito menos frequente' },
  { id: 'over_4', type: 'DIGITOVER', pilot: 'overUnder', prediction: 4, description: 'Acima de 4' },
  { id: 'under_5', type: 'DIGITUNDER', pilot: 'overUnder', prediction: 5, description: 'Abaixo de 5' },
  { id: 'even', type: 'DIGITEVEN', pilot: 'evenOdd', description: 'O resultado é Par' },
  { id: 'odd', type: 'DIGITODD', pilot: 'evenOdd', description: 'O resultado é Ímpar' },
];

const getDecimalPlaces = (pipSize: number | undefined): number => {
    if (pipSize === undefined || pipSize === null || pipSize <= 0) return 2;
    if (Math.floor(pipSize) === pipSize && pipSize >= 1) return 0;
    const pipString = String(pipSize);
    if (pipString.includes('.')) return pipString.split('.')[1].length;
    return 0;
};

export interface PilotState {
  isOn: boolean;
  status: AutopilotStatus;
  championId: string | null;
  recoveryState: {
    isActive: boolean;
    martingaleLevel: number;
    stakeToRecover: number;
  };
}

// ============================================================================
// HOOK PRINCIPAL
// ============================================================================
export function useRobotCouncilDigits(activeSymbol: string | null, priceTicks: TickData[], activeAsset: Asset | null) {
  const { toast } = useToast();
  const { executeTrade, operationsLog } = useDerivApiDigits();

  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusThreshold, setConsensusThreshold] = useState(25);
  const [robotPerformance, setRobotPerformance] = useState<RobotPerformance[]>([]);
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  const performanceRef = useRef<RobotPerformance[]>([]);

  const initialPilotState: Record<PilotType, PilotState> = {
    matchesDiffers: { isOn: false, status: 'PAUSED', championId: 'diff_most_freq', recoveryState: { isActive: false, martingaleLevel: 0, stakeToRecover: 0 } },
    overUnder: { isOn: false, status: 'PAUSED', championId: 'over_4', recoveryState: { isActive: false, martingaleLevel: 0, stakeToRecover: 0 } },
    evenOdd: { isOn: false, status: 'PAUSED', championId: 'even', recoveryState: { isActive: false, martingaleLevel: 0, stakeToRecover: 0 } },
  };

  const [pilots, setPilots] = useState<Record<PilotType, PilotState>>(initialPilotState);
  const [warmupTimeLeft, setWarmupTimeLeft] = useState(WARMUP_DURATION_MS);

  const autopilotStartTimeRef = useRef<number | null>(null);
  const warmupIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const processedLossesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    performanceRef.current = robotPerformance;
  }, [robotPerformance]);
  
  useEffect(() => {
    const initialPerformance = councilStrategies.map(strat => ({
      id: strat.id,
      strategyType: strat.type,
      strategy: { ...strat } as any,
      wins: 0,
      losses: 0,
      totalProfit: 0,
      winRate: 0,
    }));
    setRobotPerformance(initialPerformance);
  }, []);

  const digitStats: DigitStats[] = useMemo(() => {
    if (priceTicks.length < 100) {
      return Array.from({ length: 10 }, (_, i) => ({ digit: i, count: 0, probability: 10 }));
    }
    const decimalPlaces = getDecimalPlaces(activeAsset?.pip);
    const counts = Array(10).fill(0);
    const last100Ticks = priceTicks.slice(-100);
    
    last100Ticks.forEach(tick => {
        const priceString = tick.price.toFixed(decimalPlaces);
        const lastChar = priceString.slice(-1);
        const digit = parseInt(lastChar, 10);
        if (!isNaN(digit)) {
            counts[digit]++;
        }
    });

    const total = counts.reduce((a, b) => a + b, 0);
    return counts.map((count, i) => ({
      digit: i,
      count: count,
      probability: total > 0 ? (count / total) * 100 : 10,
    }));
  }, [priceTicks, activeAsset]);

  const toggleAutopilot = useCallback((pilotType: PilotType) => {
    setPilots(prev => {
        const newPilots = { ...prev };
        const pilot = newPilots[pilotType];
        const isActivating = !pilot.isOn;

        if (isActivating) {
            pilot.status = 'WARMING_UP';
            autopilotStartTimeRef.current = Date.now();
            setWarmupTimeLeft(WARMUP_DURATION_MS);
            if (warmupIntervalRef.current) clearInterval(warmupIntervalRef.current);
            warmupIntervalRef.current = setInterval(() => {
                const elapsed = Date.now() - (autopilotStartTimeRef.current || Date.now());
                setWarmupTimeLeft(Math.max(0, WARMUP_DURATION_MS - elapsed));
            }, 1000);
            toast({ title: `Piloto ${pilotType} Ativado`, description: 'Período de aquecimento de 1 minuto iniciado.' });
        } else {
            pilot.status = 'PAUSED';
            if (warmupIntervalRef.current) clearInterval(warmupIntervalRef.current);
            pilot.championId = null;
            pilot.recoveryState = { isActive: false, martingaleLevel: 0, stakeToRecover: 0 };
            toast({ title: `Piloto ${pilotType} Desativado` });
        }
        pilot.isOn = isActivating;
        return newPilots;
    });
  }, [toast]);
  
  useEffect(() => {
    Object.entries(pilots).forEach(([type, state]) => {
      const pilotKey = type as PilotType;
      if (state.status === 'WARMING_UP' && warmupTimeLeft <= 0) {
        if (warmupIntervalRef.current) clearInterval(warmupIntervalRef.current);

        const pilotStrategies = councilStrategies.filter(s => s.pilot === pilotKey);
        const eligibleRobots = robotPerformance.filter(r => pilotStrategies.some(s => s.id === r.id) && (r.wins + r.losses) >= 5);
        
        if (eligibleRobots.length === 0) {
          toast({ title: `Aquecimento Estendido (${pilotKey})`, description: 'Nenhum robô com dados suficientes. Aguardando trades virtuais.' });
          autopilotStartTimeRef.current = Date.now();
          setWarmupTimeLeft(WARMUP_DURATION_MS);
          return;
        }

        const champion = eligibleRobots.reduce((best, current) => (current.totalProfit > best.totalProfit) ? current : best);

        setPilots(prev => ({
          ...prev,
          [pilotKey]: { ...prev[pilotKey], championId: champion.id, status: 'TRADING' }
        }));
        toast({ title: `🏆 Campeão Selecionado! (${pilotKey})`, description: `Robô '${champion.strategy.description}' assume o controlo.` });
      }
    });
  }, [warmupTimeLeft, pilots, robotPerformance, toast]);
  
  useEffect(() => {
    const lastPilotTrade = operationsLog.find(op => op.initiator?.startsWith('Piloto_') && !processedLossesRef.current.has(op.id) && op.status !== 'pending');
    if (!lastPilotTrade) return;

    processedLossesRef.current.add(lastPilotTrade.id);
    const pilotType = lastPilotTrade.initiator!.split('_')[1] as PilotType;
    const pilotState = pilots[pilotType];

    if (lastPilotTrade.status === 'lost') {
        const { recoveryState } = pilotState;
        if (recoveryState.isActive) {
            const nextLevel = recoveryState.martingaleLevel + 1;
            if (nextLevel > 2) {
                toast({ title: `🚨 Falha na Recuperação (${pilotType})`, variant: 'destructive' });
                setPilots(prev => ({ ...prev, [pilotType]: { ...pilotState, recoveryState: { isActive: false, martingaleLevel: 0, stakeToRecover: 0 }, status: 'TRADING' }}));
            } else {
                toast({ title: `⚠️ Recuperação Nível ${recoveryState.martingaleLevel} Falhou (${pilotType})`, variant: 'destructive' });
                setPilots(prev => ({ ...prev, [pilotType]: { ...pilotState, recoveryState: { ...recoveryState, martingaleLevel: nextLevel, stakeToRecover: recoveryState.stakeToRecover + lastPilotTrade.stake }}}));
            }
        } else {
            toast({ title: `📉 Perda Detectada! (${pilotType})`, variant: 'destructive' });
            setPilots(prev => ({ ...prev, [pilotType]: { ...pilotState, status: 'RECOVERING', recoveryState: { isActive: true, martingaleLevel: 1, stakeToRecover: lastPilotTrade.stake }}}));
        }
    } else if (lastPilotTrade.status === 'won' && pilotState.recoveryState.isActive) {
        toast({ title: `✅ Recuperação Bem-sucedida! (${pilotType})` });
        setPilots(prev => ({ ...prev, [pilotType]: { ...pilotState, recoveryState: { isActive: false, martingaleLevel: 0, stakeToRecover: 0 }, status: 'TRADING' }}));
    }
  }, [operationsLog, pilots, toast]);

  const autopilotExecutionRef = useRef(false);
  useEffect(() => {
    if (autopilotExecutionRef.current || !activeSymbol) return;

    const runAutopilots = async () => {
        autopilotExecutionRef.current = true;
        const sortedByProb = [...digitStats].sort((a, b) => b.probability - a.probability);

        for (const [type, state] of Object.entries(pilots)) {
            const pilotKey = type as PilotType;
            if (!state.isOn || (state.status !== 'TRADING' && state.status !== 'RECOVERING')) continue;
            
            const champion = robotPerformance.find(r => r.id === state.championId);
            if (!champion) continue;

            let signalType: CouncilStrategy['type'] | null = null;
            let predictionDigit: number | undefined;
            const threshold = state.recoveryState.isActive ? 40 : consensusThreshold;

            switch(champion.id) {
                case 'diff_most_freq':
                    if (sortedByProb[0].probability > threshold) { signalType = 'DIGITDIFF'; predictionDigit = sortedByProb[0].digit; }
                    break;
                case 'match_least_freq':
                    if (sortedByProb[9].probability < (100 - threshold) / 9) { signalType = 'DIGITMATCH'; predictionDigit = sortedByProb[9].digit; }
                    break;
                case 'over_4':
                    if (digitStats.filter(d => d.digit > 4).reduce((s, d) => s + d.probability, 0) > 55) signalType = 'DIGITOVER';
                    predictionDigit = 4;
                    break;
                case 'under_5':
                    if (digitStats.filter(d => d.digit < 5).reduce((s, d) => s + d.probability, 0) > 55) signalType = 'DIGITUNDER';
                    predictionDigit = 5;
                    break;
                case 'even':
                    if (digitStats.filter(d => d.digit % 2 === 0).reduce((s, d) => s + d.probability, 0) > 52) signalType = 'DIGITEVEN';
                    break;
                case 'odd':
                    if (digitStats.filter(d => d.digit % 2 !== 0).reduce((s, d) => s + d.probability, 0) > 52) signalType = 'DIGITODD';
                    break;
            }

            if (signalType) {
                const stake = state.recoveryState.isActive ? (0.35 * Math.pow(2, state.recoveryState.martingaleLevel)) : 0.35;
                await executeTrade(signalType, stake, activeSymbol, 1, 't', `Piloto_${pilotKey}`, predictionDigit);
            }
        }
        
        setTimeout(() => { autopilotExecutionRef.current = false; }, 2000);
    };

    runAutopilots();
  }, [pilots, digitStats, consensusThreshold, activeSymbol, executeTrade, robotPerformance]);

  useEffect(() => {
    if (priceTicks.length < 2) return;
    const currentTick = priceTicks[priceTicks.length - 1];
    const tradesToRemove: string[] = [];
    let performanceChanged = false;
    const decimalPlaces = getDecimalPlaces(activeAsset?.pip);

    virtualTradesRef.current.forEach(trade => {
      if (currentTick.epoch >= trade.exitEpoch) {
        tradesToRemove.push(trade.id);
        const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;
        const priceString = exitTick.price.toFixed(decimalPlaces);
        const lastDigit = parseInt(priceString.slice(-1), 10);
        
        let isWin = false;
        switch (trade.contractType) {
          case 'DIGITDIFF': isWin = lastDigit !== trade.prediction; break;
          case 'DIGITMATCH': isWin = lastDigit === trade.prediction; break;
          case 'DIGITOVER': isWin = lastDigit > trade.prediction!; break;
          case 'DIGITUNDER': isWin = lastDigit < trade.prediction!; break;
          case 'DIGITEVEN': isWin = lastDigit % 2 === 0; break;
          case 'DIGITODD': isWin = lastDigit % 2 !== 0; break;
        }

        const perfIndex = performanceRef.current.findIndex(p => p.id === trade.robotId);
        if (perfIndex !== -1) {
          const perf = performanceRef.current[perfIndex];
          const payoutRate = trade.contractType === 'DIGITMATCH' ? 8.09 : 0.099;
          perf.wins = (perf.wins || 0) + (isWin ? 1 : 0);
          perf.losses = (perf.losses || 0) + (isWin ? 0 : 1);
          perf.totalProfit = (perf.totalProfit || 0) + (isWin ? (0.35 * payoutRate) : -0.35);
          const total = perf.wins + perf.losses;
          perf.winRate = total > 0 ? (perf.wins / total) * 100 : 0;
          performanceChanged = true;
        }
      }
    });

    if (tradesToRemove.length > 0) {
      virtualTradesRef.current = virtualTradesRef.current.filter(t => !tradesToRemove.includes(t.id));
    }
    if(performanceChanged) {
        setRobotPerformance([...performanceRef.current]);
    }
  }, [priceTicks, activeAsset]);

  useEffect(() => {
    if (priceTicks.length < 100) return;

    const anyPilotOn = Object.values(pilots).some(p => p.isOn);
    if (!anyPilotOn) return;

    const currentTick = priceTicks[priceTicks.length - 1];
    const sortedByProb = [...digitStats].sort((a, b) => b.probability - a.probability);
    
    councilStrategies.forEach(strategy => {
      if (virtualTradesRef.current.some(t => t.robotId === strategy.id)) return;

      let shouldTrade = false;
      let prediction = strategy.prediction;

      switch (strategy.id) {
        case 'diff_most_freq': if (sortedByProb[0].probability > 15) { shouldTrade = true; prediction = sortedByProb[0].digit; } break;
        case 'match_least_freq': if (sortedByProb[9].probability < 8) { shouldTrade = true; prediction = sortedByProb[9].digit; } break;
        case 'over_4': if (digitStats.filter(d => d.digit > 4).reduce((s, d) => s + d.probability, 0) > 55) shouldTrade = true; break;
        case 'under_5': if (digitStats.filter(d => d.digit < 5).reduce((s, d) => s + d.probability, 0) > 55) shouldTrade = true; break;
        case 'even': if (digitStats.filter(d => d.digit % 2 === 0).reduce((s, d) => s + d.probability, 0) > 52) shouldTrade = true; break;
        case 'odd': if (digitStats.filter(d => d.digit % 2 !== 0).reduce((s, d) => s + d.probability, 0) > 52) shouldTrade = true; break;
      }
      
      if (shouldTrade) {
        virtualTradesRef.current.push({
          id: `vt_${strategy.id}_${Date.now()}`, robotId: strategy.id,
          contractType: strategy.type, prediction: prediction,
          entryEpoch: currentTick.epoch, exitEpoch: currentTick.epoch + 2,
        });
      }
    });
  }, [digitStats, pilots, priceTicks]);
  
  return {
    isCouncilAutopilotOn: Object.values(pilots).some(p => p.isOn),
    dailyBalance, setDailyBalance,
    dailyTarget, setDailyTarget,
    consensusThreshold, setConsensusThreshold,
    digitStats,
    robotPerformance,
    evolutionHistory: [], 
    toggleAutopilot,
    warmupTimeLeft,
    pilots,
  };
}
```
  <change>
    <file>/src/app/deriv-trader-digits/page.tsx</file>
    <content><![CDATA[// /src/app/deriv-trader-digits/page.tsx
'use client';

import React from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import DerivTraderInterfaceDigits from "@/features/trading/components/deriv-trader/deriv-trader-interface-digits";
import { AssetSelectorDigits } from "@/features/trading/components/deriv-trader/asset-selector-digits";
import { Skeleton } from "@/components/ui/skeleton";
import { DerivApiProviderDigits, useDerivApiDigits } from "@/features/trading/hooks/use-deriv-api-digits";
import { OperationsLogDigits } from "@/features/trading/components/deriv-trader/operations-log-digits";
import { digitSchema, type DigitFormValues } from "@/features/trading/components/deriv-trader/deriv-trader-interface-digits.types";
import { DigitsAutopilotManager } from "@/features/trading/components/deriv-trader/digits-autopilot-manager";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useRobotCouncilDigits } from "@/features/trading/hooks/use-robot-council-digits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TradingDeskDigits } from "@/features/trading/components/deriv-trader/trading-desk-digits";
import { EvolutionLabDigits } from "@/features/trading/components/deriv-trader/evolution-lab-digits";
import { AITradeSuggestionDigits } from "@/features/trading/components/deriv-trader/ai-trade-suggestion-digits";
import { ApiStatusIndicatorDigits } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorDigits";
import { DigitStatsChart } from "@/features/trading/components/deriv-trader/digit-stats-chart";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BrainCircuit, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const getDecimalPlaces = (pipSize: number | undefined): number => {
    if (pipSize === undefined || pipSize === null || pipSize <= 0) {
        return 2; 
    }
    if (Math.floor(pipSize) === pipSize && pipSize >= 1) {
        return 0;
    }
    const pipString = String(pipSize);
    if (pipString.includes('.')) {
        return pipString.split('.')[1].length;
    }
    return 0;
};

function HeaderDigits() {
    const {
        accountType, 
        setAccountType, 
        accountBalance, 
        isConnecting,
        isAssetsLoading,
        assetGroups,
        activeSymbol,
        setActiveSymbol,
    } = useDerivApiDigits();
    
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left">
                Deriv Digits
            </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="flex justify-center">
                    <AssetSelectorDigits
                        selectedAsset={activeSymbol || ""} 
                        onAssetChange={(asset) => setActiveSymbol(asset)} 
                        assetGroups={assetGroups}
                        isAssetsLoading={isAssetsLoading}
                    />
                </div>
                <div className="flex justify-center">
                    <ApiStatusIndicatorDigits />
                </div>
                <div className="flex items-center justify-center md:justify-end gap-4">
                    <ToggleGroup type="single" value={accountType} onValueChange={(value: any) => value && setAccountType(value)} defaultValue="demo" aria-label="Tipo de Conta">
                        <ToggleGroupItem value="demo" aria-label="Usar conta demo">Demo</ToggleGroupItem>
                        <ToggleGroupItem value="real" aria-label="Usar conta real">Real</ToggleGroupItem>
                    </ToggleGroup>
                    <div className="text-right">
                        {accountBalance.loading || isConnecting ? (
                            <div className="space-y-1">
                                <Skeleton className="h-4 w-16" />
                                <Skeleton className="h-5 w-24" />
                            </div>
                        ) : accountBalance.balance !== null ? (
                            <div>
                                <p className="text-xs text-muted-foreground">Saldo:</p>
                                <p className="text-lg font-bold text-foreground leading-tight">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: accountBalance.currency || 'USD' }).format(accountBalance.balance)}
                                </p>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
};

function CurrentPriceDisplay() {
    const { priceTicks, activeAsset } = useDerivApiDigits();
    const lastTick = priceTicks.length > 0 ? priceTicks[priceTicks.length - 1] : null;
    const prevTick = priceTicks.length > 1 ? priceTicks[priceTicks.length - 2] : null;

    if (!lastTick) {
        return (
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="font-headline text-lg">Preço Atual ({activeAsset?.label || 'A carregar...'})</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-center h-32">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </CardContent>
            </Card>
        );
    }
    
    const decimalPlaces = Math.max(2, getDecimalPlaces(activeAsset?.pip));
    const change = prevTick ? lastTick.price - prevTick.price : 0;
    const isUp = change > 0;
    const isDown = change < 0;

    const priceString = lastTick.price.toFixed(decimalPlaces);
    
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="font-headline text-lg">Preço Atual ({activeAsset?.label || 'A carregar...'})</CardTitle>
                <CardDescription>O último preço recebido para o ativo selecionado.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex items-baseline justify-center">
                    <p className="text-5xl font-bold font-mono text-foreground">{priceString}</p>
                </div>
                <div className={cn(
                    "flex items-center justify-center gap-1 text-sm font-semibold mt-1",
                    isUp && "text-green-600",
                    isDown && "text-red-600",
                    !isUp && !isDown && "text-muted-foreground"
                )}>
                    {isUp && <TrendingUp className="h-4 w-4" />}
                    {isDown && <TrendingDown className="h-4 w-4" />}
                    <span>{change.toFixed(decimalPlaces)}</span>
                </div>
            </CardContent>
        </Card>
    );
}

function DerivTraderPageContentDigits() {
    const { activeSymbol, priceTicks, operationsLog, sellContract, activeAsset, clearActiveContracts } = useDerivApiDigits();
    const robotCouncil = useRobotCouncilDigits(activeSymbol, priceTicks, activeAsset);

    return (
        <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
            <HeaderDigits />
             <Alert className="bg-primary/5 border-primary/10">
                <BrainCircuit className="h-4 w-4 text-primary" />
                <AlertTitle className="text-primary font-headline">Foco em Índices Sintéticos</AlertTitle>
                <AlertDescription className="text-primary/90">
                    Esta plataforma foca-se nos Índices de Volatilidade (Sintéticos) porque a sua geração algorítmica constante permite uma análise estatística mais pura e previsível, livre de ruídos de eventos económicos externos.
                </AlertDescription>
            </Alert>
            
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-6">
                {/* --- Coluna da Esquerda (Controles) --- */}
                <div className="lg:col-span-2 space-y-6">
                    <CurrentPriceDisplay />
                    <DerivTraderInterfaceDigits symbol={activeSymbol || ""} />
                    <DigitsAutopilotManager {...robotCouncil} />
                </div>

                {/* --- Coluna da Direita (Dados e Logs) --- */}
                <div className="lg:col-span-3 space-y-6">
                    <DigitStatsChart priceTicks={priceTicks} pip={activeAsset?.pip} />
                    <AITradeSuggestionDigits
                        digitStats={robotCouncil.digitStats}
                        isAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                    />
                    <Tabs defaultValue="logs" className="w-full">
                        <TabsList className="grid grid-cols-3">
                            <TabsTrigger value="logs">Registo</TabsTrigger>
                            <TabsTrigger value="arena">Arena</TabsTrigger>
                            <TabsTrigger value="evolucao">Evolução</TabsTrigger>
                        </TabsList>
                        <TabsContent value="logs" className="mt-4">
                            <OperationsLogDigits operations={operationsLog} sellContract={sellContract} priceTicks={priceTicks} activeAsset={activeAsset} clearActiveContracts={clearActiveContracts} />
                        </TabsContent>
                        <TabsContent value="arena" className="mt-4">
                            <TradingDeskDigits 
                                isCouncilAutopilotOn={robotCouncil.isCouncilAutopilotOn} 
                                robotPerformance={robotCouncil.robotPerformance}
                                championRobotId={null} // O conceito de campeão único foi removido
                            />
                        </TabsContent>
                        <TabsContent value="evolucao" className="mt-4">
                            <EvolutionLabDigits history={robotCouncil.evolutionHistory} activeSymbol={activeSymbol} />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}

export default function DerivTraderDigitsPage() {
  const form = useForm<DigitFormValues>({
    resolver: zodResolver(digitSchema),
    defaultValues: {
      stake: 0.35,
      duration: 1,
      duration_unit: "t",
      last_digit_prediction: 5,
    },
  });

  return (
    <DerivApiProviderDigits>
        <FormProvider {...form}>
            <DerivTraderPageContentDigits />
        </FormProvider>
    </DerivApiProviderDigits>
  );
}
