// /src/app/volatility-analysis/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useForm, FormProvider, useFormContext } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TrendingUp, TrendingDown, HelpCircle, Bot, FlaskConical, Target, Info, Settings, Sigma, Power, PlayCircle, PauseCircle, Skull, ChevronsUpDown, Activity, BarChart, Brain, TestTube, FilePieChart, CheckCheck, Loader2, Gauge, XCircle } from 'lucide-react';
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
import PredictiveLogViewer from '@/components/deriv-trader/PredictiveLogViewer';
import { getPredictiveTradeLogs, savePredictiveTradeLog, archiveOldLogs, saveBacktestRun } from '@/services/financial-data-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { db } from '@/lib/firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import { errorEmitter, FirestorePermissionError } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { useMasterAutopilot } from '@/features/trading/hooks/use-master-autopilot';
import type { AssertivenessData, SignalQuality } from '@/features/trading/hooks/use-master-autopilot';
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from '@/components/ui/skeleton';
import { useStochasticModels, type ExpertProjection, type StrongestSignal, type MarketStats, type VolatilityRegime, type MeanReversionSignal } from '@/features/trading/hooks/use-stochastic-models';
import { runStochasticBacktest, type BacktestResult } from '@/features/trading/backtest/backtest-engine';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from '@/components/ui/badge';


// --- TYPE DEFINITIONS ---

interface ConsensusData {
    strongestSignal: StrongestSignal;
    projectionExperts: ExpertProjection[];
    meanReversionSignal: MeanReversionSignal;
    volatilityRegime: VolatilityRegime;
}


// --- UI COMPONENTS ---

const getProgressColor = (percentage: number) => {
    if (percentage > 55) return 'bg-green-500';
    if (percentage > 50) return 'bg-blue-500';
    if (percentage < 45) return 'bg-red-500';
    return 'bg-gray-400';
};

const StatItem = ({ label, value }: { label: string; value: string | number }) => (
    <div className="flex flex-col p-2 border-l-2 pl-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-bold font-mono">{value}</span>
    </div>
);

const StrongestSignalCard = ({ signal, meanReversion, regime, className }: { signal: StrongestSignal, meanReversion: MeanReversionSignal, regime: VolatilityRegime, className?: string }) => {
    const isLowVol = regime.type === 'LOW';
    const effectiveSignal = isLowVol && meanReversion.direction !== 'HOLD' ? 
        { ...meanReversion, horizon: 'Z-Score' } : 
        { ...signal, direction: signal.direction as 'LONG' | 'SHORT' | 'HOLD' };

    const displayDirection = effectiveSignal.direction === 'LONG' ? 'RISE' : (effectiveSignal.direction === 'SHORT' ? 'FALL' : 'HOLD');
    const isHold = displayDirection === 'HOLD';
    const displayAccuracy = 'rawWinRate' in effectiveSignal ? Math.max(effectiveSignal.rawWinRate, 100 - effectiveSignal.rawWinRate) : ('confidence' in effectiveSignal ? effectiveSignal.confidence : 0);

    return (
        <Card className={cn("p-4 flex flex-col justify-center", 
            isHold ? 'bg-slate-50' : displayDirection === 'RISE' ? 'bg-green-50' : 'bg-red-50',
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
                    {displayDirection === 'RISE' ? <TrendingUp className="mx-auto h-8 w-8 text-green-500 mb-2" /> : <TrendingDown className="mx-auto h-8 w-8 text-red-500 mb-2" />}
                    <p className={cn("font-bold text-lg", displayDirection === 'RISE' ? 'text-green-600' : 'text-red-600')}>
                        {displayDirection} para {effectiveSignal.horizon}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        Confiança: <span className="font-bold">{displayAccuracy.toFixed(1)}%</span>
                        {isLowVol && <Badge variant="outline" className="ml-2">Mean Reversion</Badge>}
                    </p>
                </div>
            )}
        </Card>
    );
};

const SignalQualityCard = ({ quality }: { quality: SignalQuality | null }) => {
  if (!quality) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-headline flex items-center gap-2"><Gauge className="h-4 w-4" />Qualidade do Sinal</CardTitle>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground">
          <Loader2 className="animate-spin h-6 w-6 mx-auto" />
          <p className="text-sm mt-2">A avaliar...</p>
        </CardContent>
      </Card>
    );
  }

  const { score, reasons, shouldTrade } = quality;
  const scoreColor = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-blue-600' : 'text-red-600';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-headline flex items-center gap-2"><Gauge className="h-4 w-4" />Qualidade do Sinal</CardTitle>
        <div className="flex items-center gap-3 pt-2">
          <Progress value={score} className="h-2 flex-1" />
          <span className={cn("font-bold text-xl", scoreColor)}>{score.toFixed(0)}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="text-xs space-y-1 text-muted-foreground list-disc pl-4">
          {reasons.map((reason, i) => <li key={i}>{reason}</li>)}
        </ul>
        <Alert variant={shouldTrade ? "default" : "destructive"} className={cn("p-3", shouldTrade && "bg-green-500/10 border-green-500/20")}>
          <AlertTitle className="flex items-center gap-2 font-bold">
            {shouldTrade ? <CheckCheck className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4" />}
            Veredito: {shouldTrade ? "Aprovado para Execução" : "Sinal Rejeitado"}
          </AlertTitle>
        </Alert>
      </CardContent>
    </Card>
  );
};

const VolatilityRegimeBadge = ({ regime }: { regime: VolatilityRegime | null }) => {
    if (!regime) return <Badge variant="secondary">Analisando...</Badge>;
    
    const regimeConfig = {
        'LOW': { text: 'Baixa Volatilidade', color: 'bg-blue-500/10 text-blue-700 border-blue-500/20' },
        'NORMAL': { text: 'Normal', color: 'bg-green-500/10 text-green-700 border-green-500/20' },
        'HIGH': { text: 'Alta Volatilidade', color: 'bg-red-500/10 text-red-700 border-red-500/20' }
    };
    
    return (
        <Badge className={cn("text-xs", regimeConfig[regime.type].color)}>
            {regimeConfig[regime.type].text}
        </Badge>
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


interface StochasticLabProps {
  predictiveLogs: PredictiveTradeLog[];
  onDeletePredictiveLog: (logId: string) => void;
  deletingPredictiveLogId: string | null;
  operationsLog: Operation[];
  activeSymbol: string | null;
  initialPerformance: BacktestResult | null;
  isWarmingUp: boolean;
}

const BacktestResultViewer = ({ result }: { result: BacktestResult | null }) => {
    if (!result) return null;
    
    const sortedHorizons = Object.entries(result.metricsByHorizon)
        .sort(([, a], [, b]) => b.winRate - a.winRate);
        
    const overallWinRate = sortedHorizons.reduce((sum, [, h]) => sum + h.wins, 0) /
                           sortedHorizons.reduce((sum, [, h]) => sum + h.total, 0) * 100;

    return (
        <div className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground">Total de Passos</p>
                    <p className="text-2xl font-bold">{result.totalSteps}</p>
                </Card>
                <Card className="p-4">
                    <p className="text-xs text-muted-foreground">Win Rate Geral</p>
                    <p className={cn("text-2xl font-bold", overallWinRate > 51 ? 'text-green-600' : 'text-red-600')}>
                        {overallWinRate.toFixed(2)}%
                    </p>
                </Card>
            </div>
            
            <Card>
                <CardHeader><CardTitle className="text-base">Performance por Horizonte</CardTitle></CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Horizonte</TableHead>
                                <TableHead className="text-right">Win Rate</TableHead>
                                <TableHead className="text-right">Trades</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedHorizons.map(([horizon, metrics]) => (
                                <TableRow key={horizon}>
                                    <TableCell className="font-mono font-semibold">{horizon}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span>{metrics.winRate.toFixed(1)}%</span>
                                            <Progress value={metrics.winRate} className="w-20 h-1.5" />
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right font-mono">{metrics.total}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
};

function StochasticLab({ 
    predictiveLogs,
    onDeletePredictiveLog,
    deletingPredictiveLogId,
    operationsLog,
    activeSymbol,
    initialPerformance,
    isWarmingUp,
}: StochasticLabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { getHistoricalData, chartData: realData, priceTicks } = useDerivApi();
  
  const { 
    projectionExperts, 
    strongestSignal, 
    stats, 
    adaptiveDrifts, 
    meanReversionSignal, 
    volatilityRegime 
  } = useStochasticModels(realData, priceTicks, operationsLog, initialPerformance);
  
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [backtestPoints, setBacktestPoints] = useState(20000);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);

  const horizonsConfigForBacktest = useMemo(() => [
    { name: '1t', ticks: 1 }, { name: '3t', ticks: 3 }, { name: '6t', ticks: 6 }, 
    { name: '10t', ticks: 10 }, { name: '15s', ticks: 15 }, { name: '20s', ticks: 20 },
    { name: '30s', ticks: 30 }, { name: '40s', ticks: 40 }, { name: '50s', ticks: 50 },
  ], []);

  const handleRunBacktest = async () => {
    if (!user || !activeSymbol) {
      toast({ title: "Autenticação/Ativo Necessários", variant: "destructive" });
      return;
    }
    setIsBacktesting(true);
    setBacktestResult(null);

    toast({ title: "Iniciando Backtest...", description: `A obter ${backtestPoints} pontos de dados históricos...` });

    try {
      const historicalData = await getHistoricalData(activeSymbol, 'candles', backtestPoints, '1m');

      if (historicalData.length < 500) {
        throw new Error(`Dados insuficientes. Obtidos apenas ${historicalData.length} pontos de dados.`);
      }

      toast({ title: "Dados Obtidos!", description: "A processar simulação. Isto pode demorar alguns segundos." });

      await new Promise(resolve => setTimeout(resolve, 50));
      
      const result = runStochasticBacktest(historicalData, {
          horizons: horizonsConfigForBacktest
      });
      
      await saveBacktestRun(user.uid, activeSymbol, { ...result, id: `run_${Date.now()}`, timestamp: new Date().toISOString() });

      setBacktestResult(result);
      toast({ title: "Backtest Concluído!", description: `Análise de ${historicalData.length} pontos de dados finalizada.` });
    } catch (e: any) {
      toast({ title: "Erro no Backtest", description: e.message, variant: "destructive" });
      console.error("Backtest error:", e);
    } finally {
      setIsBacktesting(false);
    }
  };
  
  const MetricCard = ({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color?: string }) => (
      <div className="flex flex-col p-3 border rounded-lg bg-background shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>{label}</span>
              {icon}
          </div>
          <span className={cn("font-bold text-2xl", color)}>{value}</span>
      </div>
  );

  const systemHealthStats = useMemo(() => {
    const projectionExpertsList = projectionExperts || [];
    const finishedTrades = operationsLog.filter(op => op.status !== 'pending');
    const wins = finishedTrades.filter(op => op.result && op.result > 0).length;
    const totalTrades = finishedTrades.length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    
    const totalPnL = finishedTrades.reduce((sum, op) => sum + (op.result || 0), 0);
    
    const activeExperts = projectionExpertsList.filter(e => e.status === 'active').length;
    
    return { 
        totalTrades, 
        winRate, 
        totalPnL,
        activeExperts,
        totalExperts: projectionExpertsList.length,
    };
  }, [operationsLog, projectionExperts]);

  const isSystemViable = systemHealthStats.totalTrades >= 200 && systemHealthStats.winRate > 51;

  if (isWarmingUp) {
    return (
        <Card className="h-full flex flex-col col-span-1 lg:col-span-3 items-center justify-center text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
            <p className="font-semibold">Aquecendo Cérebro Preditivo...</p>
            <p className="text-sm">Calibrando confiança inicial com dados históricos.</p>
        </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col col-span-1 lg:col-span-3">
        <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-purple-600" />
                Laboratório Preditivo (Cérebro Cético V2.1)
            </CardTitle>
            <CardDescription className="flex justify-between items-center">
                <span>O cientista usa GBM, Mean Reversion e gestão de risco para projetar o futuro.</span>
                <VolatilityRegimeBadge regime={volatilityRegime} />
            </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col min-h-0">
          <ScrollArea className="flex-1">
                <div className="p-1 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                         <StrongestSignalCard signal={strongestSignal} meanReversion={meanReversionSignal} regime={volatilityRegime} className="md:col-span-1" />
                         <ProjectionExpertsPanel experts={projectionExperts} adaptiveDrifts={adaptiveDrifts} className="md:col-span-3" />
                    </div>
                    
                     <Card className="mt-6">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Activity className="h-5 w-5" />
                                Saúde e Estatísticas do Sistema
                            </CardTitle>
                            <CardDescription>Métricas de performance do piloto e do mercado.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <MetricCard
                                    label="Total de Trades"
                                    value={systemHealthStats.totalTrades}
                                    icon={<BarChart className="h-4 w-4 text-muted-foreground" />}
                                />
                                <MetricCard
                                    label="Win Rate"
                                    value={`${systemHealthStats.winRate.toFixed(1)}%`}
                                    icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
                                    color={systemHealthStats.winRate > 52 ? 'text-green-600' : systemHealthStats.winRate < 48 ? 'text-red-600' : 'text-yellow-600'}
                                />
                                <MetricCard
                                    label="Lucro/Prejuízo"
                                    value={`${systemHealthStats.totalPnL < 0 ? '-' : ''}$${Math.abs(systemHealthStats.totalPnL).toFixed(2)}`}
                                    icon={<Target className="h-4 w-4 text-muted-foreground" />}
                                    color={systemHealthStats.totalPnL > 0 ? 'text-green-600' : systemHealthStats.totalPnL < 0 ? 'text-red-600' : 'text-foreground'}
                                />
                                <MetricCard
                                    label="Especialistas Ativos"
                                    value={`${systemHealthStats.activeExperts} / ${systemHealthStats.totalExperts}`}
                                    icon={<Brain className="h-4 w-4 text-muted-foreground" />}
                                />
                            </div>
                            
                            {systemHealthStats.totalTrades >= 200 && (
                                <Alert className={cn(
                                    "col-span-full",
                                    isSystemViable ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"
                                )}>
                                    <AlertTitle className="font-bold flex items-center gap-2">
                                        {isSystemViable ? '✅ Sistema Viável' : '⚠️ Sistema Abaixo do Breakeven'}
                                    </AlertTitle>
                                    <AlertDescription>
                                        {isSystemViable 
                                            ? 'Taxa de acerto acima de 51% com dados estatisticamente significativos.'
                                            : 'Taxa de acerto abaixo de 51%. Considere pausar operações e revisar parâmetros.'
                                        }
                                    </AlertDescription>
                                </Alert>
                            )}

                            <Separator />
                            
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm pt-2">
                                <StatItem label="Volatilidade Anualizada" value={`${stats.annualizedVol}%`} />
                                <StatItem label="Assimetria (Skewness)" value={stats.skewness} />
                                <StatItem label="Curtose (Kurtosis)" value={stats.kurtosis} />
                            </div>
                        </CardContent>
                    </Card>
                    
                     <Accordion type="single" collapsible className="w-full mt-4">
                        <AccordionItem value="audit">
                            <AccordionTrigger className="text-base font-semibold px-1">Log de Auditoria Preditiva</AccordionTrigger>
                            <AccordionContent className="pt-2">
                               <PredictiveLogViewer logs={predictiveLogs} onDeleteLog={onDeletePredictiveLog} deletingPredictiveLogId={deletingPredictiveLogId} />
                            </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="backtest">
                             <AccordionTrigger className="text-base font-semibold px-1">Backtest do Modelo</AccordionTrigger>
                             <AccordionContent className="pt-2">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2"><FilePieChart className="h-5 w-5"/>Motor de Backtesting</CardTitle>
                                        <CardDescription>Simule a performance do modelo em milhares de pontos de dados históricos para validar a sua viabilidade a longo prazo.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="backtest-points">Pontos de Dados para Testar</Label>
                                            <div className="flex items-center gap-4">
                                                <Slider
                                                    id="backtest-points"
                                                    min={1000}
                                                    max={Math.min(50000, realData.length)}
                                                    step={1000}
                                                    value={[backtestPoints]}
                                                    onValueChange={(value) => setBacktestPoints(value[0])}
                                                    disabled={isBacktesting}
                                                />
                                                <span className="font-mono text-primary font-bold w-20 text-center">{backtestPoints}</span>
                                            </div>
                                        </div>
                                        <Button className="w-full" onClick={handleRunBacktest} disabled={isBacktesting}>
                                            {isBacktesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
                                            {isBacktesting ? 'A Simular...' : 'Rodar Backtest'}
                                        </Button>
                                        {isBacktesting && <p className="text-xs text-center text-muted-foreground">Isso pode levar alguns segundos e pode congelar a interface brevemente...</p>}
                                        <BacktestResultViewer result={backtestResult} />
                                    </CardContent>
                                </Card>
                             </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </div>
            </ScrollArea>
        </CardContent>
    </Card>
  );
}

const IsolatedMarketChart = () => {
    const { 
        activeSymbol, operationsLog, chartData, isChartLoading, chartError, 
        chartType, setChartType, timePeriod, setTimePeriod, tradeAnnotations
    } = useDerivApi();
    
    const autopilot = useMasterAutopilot();

    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline text-lg">Gráfico de Mercado ({activeSymbol})</CardTitle>
                <CardDescription>Análise de preço em tempo real.</CardDescription>
            </CardHeader>
            <CardContent>
                <MarketChart
                    activeSymbol={activeSymbol || ''}
                    chartData={chartData}
                    isChartLoading={isChartLoading}
                    chartError={chartError}
                    chartType={chartType}
                    setChartType={setChartType}
                    timePeriod={timePeriod}
                    setTimePeriod={setTimePeriod}
                    operations={operationsLog}
                    indicators={autopilot.masterState.indicators}
                    tradeAnnotations={tradeAnnotations}
                />
            </CardContent>
        </Card>
    );
};

function PageContent() {
  const { 
    activeSymbol, chartData, operationsLog, sellContract, clearActiveContracts,
    priceTicks, durationLimits, getHistoricalData,
  } = useDerivApi();
  const { toast } = useToast();
  const [predictiveLogs, setPredictiveLogs] = useState<PredictiveTradeLog[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(true);
  const [deletingPredictiveLogId, setDeletingPredictiveLogId] = useState<string | null>(null);
  const { user } = useAuth();
  const [initialPerformance, setInitialPerformance] = useState<BacktestResult | null>(null);
  const [isWarmingUp, setIsWarmingUp] = useState(true);
  
  const autopilot = useMasterAutopilot();
  const form = useFormContext<VolatilityTraderFormValues>();

  const horizonsConfigForBacktest = useMemo(() => [
    { name: '1t', ticks: 1, type: 'tick', window: 6 }, { name: '3t', ticks: 3, type: 'tick', window: 6 },
    { name: '6t', ticks: 6, type: 'tick', window: 6 }, { name: '10t', ticks: 10, type: 'tick', window: 10 },
    { name: '15s', ticks: 15, type: 'second', window: 10 }, { name: '20s', ticks: 20, type: 'second', window: 10 },
    { name: '30s', ticks: 30, type: 'second', window: 75 }, { name: '40s', ticks: 40, type: 'second', window: 75 },
    { name: '50s', ticks: 50, type: 'second', window: 75 },
  ], []);

  const handleInitialWarmup = useCallback(async () => {
    if (!user || !activeSymbol) {
        setIsWarmingUp(false);
        return;
    };
    setIsWarmingUp(true);
    try {
        const historicalData = await getHistoricalData(activeSymbol, 'candles', 5000, '1m');
        if (historicalData.length < 500) {
            throw new Error("Dados históricos insuficientes para o aquecimento.");
        }
        const result = runStochasticBacktest(historicalData, { horizons: horizonsConfigForBacktest });
        setInitialPerformance(result);
        toast({ title: "Cérebro Preditivo Aquecido", description: "Confiança inicial calibrada com dados históricos." });
    } catch (e: any) {
        toast({ title: "Erro no Aquecimento", description: e.message, variant: 'destructive' });
        setInitialPerformance(null);
    } finally {
        setIsWarmingUp(false);
    }
  }, [user, activeSymbol, getHistoricalData, toast, horizonsConfigForBacktest]);

  useEffect(() => {
    handleInitialWarmup();
  }, [activeSymbol, handleInitialWarmup]);

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

  useEffect(() => {
    if (!user) return;
    
    const hasArchivedThisSession = sessionStorage.getItem('log_archiver_run');
    if (!hasArchivedThisSession) {
        console.log("📦 Verificando logs antigos para arquivamento...");
        archiveOldLogs(user.uid).then(count => {
            if (count > 0) {
                console.log(`[Log Archiver] Sucesso! ${count} logs antigos foram arquivados.`);
            }
            sessionStorage.setItem('log_archiver_run', 'true');
        });
    }
  }, [user]);

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
    const { finalSignal } = autopilot.masterState;
    if (!finalSignal || finalSignal.horizon === 'N/A' || !durationLimits) {
      toast({ variant: 'destructive', title: 'Nenhum Sinal Forte', description: 'Aguarde um sinal preditivo forte para sincronizar.' });
      return;
    }

    const durationMatch = finalSignal.horizon.match(/(\d+)([st])/);
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
    
    if (durationUnit === 't') {
        duration = Math.max(15, duration * 2); 
    }
    form.setValue('duration', duration);

    toast({
      title: 'Duração Sincronizada!',
      description: `Duração definida para ${duration} segundos, com base no sinal de ${finalSignal.horizon}.`,
    });
  };
  
  useEffect(() => {
    if (autopilot.kellyStake > 0) {
        form.setValue('stake', autopilot.kellyStake);
    }
  }, [autopilot.kellyStake, form]);

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <Header />
      <IsolatedMarketChart />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <StochasticLab 
          predictiveLogs={predictiveLogs}
          onDeletePredictiveLog={handleDeletePredictiveLog}
          deletingPredictiveLogId={deletingPredictiveLogId}
          operationsLog={operationsLog}
          activeSymbol={activeSymbol}
          initialPerformance={initialPerformance}
          isWarmingUp={isWarmingUp}
        />
        <div className="lg:col-span-2 space-y-6">
          <VolatilityTraderInterface 
            symbol={activeSymbol || ''} 
            consensus={autopilot.masterState.finalSignal}
            onSyncDuration={handleSyncDuration}
          />
          <VolatilityAutopilotInterface 
            autopilot={autopilot}
            projectionExperts={autopilot.masterState.projectionExperts || []}
            signalQuality={autopilot.signalQuality}
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
  signalQuality,
}: { 
  autopilot: ReturnType<typeof useMasterAutopilot>;
  children?: React.ReactNode,
  projectionExperts: ExpertProjection[],
  signalQuality: SignalQuality | null,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          Piloto Automático Preditivo
        </CardTitle>
        <CardDescription>
          Executa trades automaticamente com base na confirmação e qualidade do sinal.
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
        <SignalQualityCard quality={signalQuality} />
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
      </CardContent>
    </Card>
  );
}

const Header = () => {
    const { 
        activeSymbol, 
        setActiveSymbol, 
        assetGroups, 
        isAssetsLoading, 
        accountType, 
        setAccountType, 
        accountBalance,
        isConnecting 
    } = useDerivApi();
    
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left">
                Análise de Volatilidade
            </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="flex justify-center">
                    <AssetSelector
                        selectedAsset={activeSymbol || ""} 
                        onAssetChange={(asset) => setActiveSymbol(asset)} 
                        assetGroups={assetGroups}
                        isAssetsLoading={isAssetsLoading}
                    />
                </div>
                <div className="flex justify-center">
                    <ApiStatusIndicator />
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
                                <p className="text-xs text-muted-foreground capitalize">Saldo ({accountType})</p>
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
