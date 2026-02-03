// src/app/volatility-analysis/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm, FormProvider, useFormContext } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { TrendingUp, TrendingDown, HelpCircle, Bot, FlaskConical, Target, Info, Settings, Sigma, Power, PlayCircle, PauseCircle, Skull, ChevronsUpDown } from 'lucide-react';
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
import { getPredictiveTradeLogs, savePredictiveTradeLog } from '@/services/financial-data-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { db } from '@/lib/firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import { errorEmitter, FirestorePermissionError } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { useMasterAutopilot } from '@/features/trading/hooks/use-master-autopilot';
import type { AssertivenessData } from '@/features/trading/hooks/use-master-autopilot';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from '@/components/ui/skeleton';
import { useStochasticModels, type ExpertProjection, type StrongestSignal } from '@/features/trading/hooks/use-stochastic-models';

// --- TYPE DEFINITIONS ---

interface ConsensusData {
    strongestSignal: StrongestSignal;
    projectionExperts: ExpertProjection[];
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


// REFACTORED `StochasticLab` component - UI ONLY
function StochasticLab({ 
    realData, 
    onConsensusUpdate, 
    predictiveLogs,
    onDeletePredictiveLog,
    deletingPredictiveLogId,
}: {
  realData: ChartData[];
  onConsensusUpdate: (consensus: ConsensusData) => void;
  predictiveLogs: PredictiveTradeLog[];
  onDeletePredictiveLog: (logId: string) => void;
  deletingPredictiveLogId: string | null;
}) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('prediction');

  // Using the new hook to encapsulate all logic
  const { projectionExperts, strongestSignal, stats, adaptiveDrifts } = useStochasticModels(realData);
  
  useEffect(() => {
    onConsensusUpdate({strongestSignal, projectionExperts});
  }, [strongestSignal, onConsensusUpdate, projectionExperts]);

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
                         <ProjectionExpertsPanel experts={projectionExperts} adaptiveDrifts={adaptiveDrifts} className="md:col-span-3" />
                    </div>
                    
                     <Card className="mt-6">
                        <CardHeader>
                            <CardTitle>Estatísticas Descritivas dos Retornos</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                            <StatItem label="Volatilidade Anualizada" value={`${stats.annualizedVol}%`} />
                            <StatItem label="Assimetria (Skewness)" value={stats.skewness} />
                            <StatItem label="Curtose (Kurtosis)" value={stats.kurtosis} />
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
    priceTicks, durationLimits,
  } = useDerivApi();
  const { toast } = useToast();
  const [consensusData, setConsensusData] = useState<ConsensusData | null>(null);
  const [predictiveLogs, setPredictiveLogs] = useState<PredictiveTradeLog[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(true);
  const [deletingPredictiveLogId, setDeletingPredictiveLogId] = useState<string | null>(null);
  const { user } = useAuth();
  
  const autopilot = useMasterAutopilot();
  const { isAutopilotOn, runAutopilotCycle } = autopilot;
  
  const form = useFormContext<VolatilityTraderFormValues>();

  const handleConsensusUpdate = useCallback((data: ConsensusData) => {
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
    
    // We only have 's' in this form, so we convert ticks
    if (durationUnit === 't') {
        duration = Math.max(15, duration * 2); 
    }
    form.setValue('duration', duration);

    toast({
      title: 'Duração Sincronizada!',
      description: `Duração definida para ${duration} segundos, com base no sinal de ${horizon}.`,
    });
  };
  

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <Header />
      <IsolatedMarketChart />
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
