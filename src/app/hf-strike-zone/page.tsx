// src/app/hf-strike-zone/page.tsx
'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi } from '@/features/trading/hooks/use-deriv-api-v2';
import { AssetSelectorV2 as AssetSelector } from '@/features/trading/components/deriv-trader/asset-selector-v2';
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from '@/features/trading/components/deriv-trader/ApiStatusIndicatorV2';
import { MarketChart } from '@/features/trading/components/deriv-trader/market-chart';
import { useHFStrikeZone } from '@/features/trading/hooks/use-hf-strike-zone';
import { HFExecutionLog } from '@/features/trading/components/hf-trader/hf-execution-log';
import { HFConfig, HFConfigPanel } from '@/features/trading/components/hf-trader/hf-config-panel';
import { saveHFTradeLog } from '@/services/hf-data-service';
import { Target, TrendingUp, BarChart, Brain, Activity, Zap, ShieldAlert, Bot, TestTube } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Operation, CandleData, TimePeriod, InstitutionalBacktestResult, WalkForwardResult, MonteCarloResult } from '@/lib/types';
import { InstitutionalMetricsDashboard } from '@/features/trading/components/hf-trader/institutional-metrics-dashboard';
import { EnsembleSignalCard } from '@/features/trading/components/hf-trader/ensemble-signal-card';
import { Skeleton } from '@/components/ui/skeleton';
import { runAllStrategiesBacktest, runWalkForwardAnalysis, runMonteCarloSimulation } from '@/features/trading/backtest/hf-backtest-engine';
import { StrategyType } from '@/features/trading/services/hf-strike-logic';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { BacktestPanel } from '@/features/trading/components/hf-trader/BacktestPanel';


function PageContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading, accountType, setAccountType,
    accountBalance, isConnecting, chartData: rawChartData, botCandleData, priceTicks,
    isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod,
    operationsLog, tradeAnnotations, executeTrade, clearActiveContracts, getHistoricalData,
  } = useDerivApi();

  const [hfConfig, setHFConfig] = useState<HFConfig>({
    enabled: true, minConfidence: 70, autoExecute: false, maxConcurrentTrades: 1, preferredDuration: 20
  });
  const [isExecuting, setIsExecuting] = useState(false);
  const [previousZones, setPreviousZones] = useState<any[]>([]);

  const {
    ensembleSignal, marketRegime, positionSizing, riskManager,
    fullIndicators, supplyDemandZones, stats
  } = useHFStrikeZone(priceTicks, botCandleData, timePeriod, hfConfig.enabled, 'HF_MEAN_REVERSION'); 

  useEffect(() => {
    if (ensembleSignal && ensembleSignal.direction !== 'NEUTRAL') {
      setPreviousZones(prev => [ensembleSignal, ...prev].slice(0, 10));
    }
  }, [ensembleSignal]);

  const dailyPnL = useMemo(() => {
     return operationsLog.filter(op => op.initiator === 'HF_Strike' && op.status !== 'pending').reduce((sum, op) => sum + (op.result || 0), 0);
  }, [operationsLog]);
  
  useEffect(() => {
    if(accountBalance.balance) {
      riskManager.resetDaily(accountBalance.balance);
    }
  }, [accountBalance.balance, riskManager]);


  const handleExecuteStrike = useCallback(async () => {
    if (!ensembleSignal || !positionSizing || positionSizing.recommendedStake === 0 || !user || !activeSymbol) {
      toast({ title: 'Sinal Inválido', description: 'Não há sinal válido para executar.', variant: 'destructive' });
      return;
    }
    
    setIsExecuting(true);
    try {
      const duration = 20; 
      const durationUnit = 's';
      const direction = ensembleSignal.direction === 'LONG' ? 'rise' : 'fall';
      const contractType = ensembleSignal.direction === 'LONG' ? 'CALL' : 'PUT';

      const tradeResult = await executeTrade(
        contractType, positionSizing.recommendedStake, activeSymbol, direction,
        duration, durationUnit, 'HF_Strike', 'ENSEMBLE'
      );
      
      if (tradeResult.success && tradeResult.contractId) {
        toast({ title: '⚡ Ensemble Strike Executado!', description: `${contractType} ${direction.toUpperCase()} - $${positionSizing.recommendedStake}` });
        
        await saveHFTradeLog(user.uid, {
            symbol: activeSymbol,
            strikeZone: {} as any,
            execution: { contractId: String(tradeResult.contractId), entryPrice: tradeResult.entryPrice!, status: 'pending', executedAt: new Date().toISOString() },
            marketRegime: marketRegime?.regime || 'CALM_ACCUMULATION',
            ensembleParticipants: ensembleSignal.participants.map(p => p.strategy),
            positionSize: {
                recommended: positionSizing.recommendedStake,
                actual: positionSizing.recommendedStake,
                reasoning: positionSizing.reasoning,
            },
            riskMetrics: {
                sharpeContribution: positionSizing.sharpeContribution,
                portfolioExposure: 0,
            }
        });
        
        riskManager.updateAfterTrade({ profit: 0, balanceAfter: accountBalance.balance! });

      } else {
        throw new Error(tradeResult.message);
      }
    } catch (error: any) {
      toast({ title: 'Erro na Execução', description: error.message || 'Falha ao executar strike', variant: 'destructive' });
    } finally {
      setIsExecuting(false);
    }
  }, [ensembleSignal, positionSizing, user, activeSymbol, executeTrade, toast, riskManager, accountBalance.balance, marketRegime]);

  useEffect(() => {
    const last3Trades = operationsLog.filter(op => op.initiator === 'HF_Strike' && op.status !== 'pending').slice(-3);
    if (hfConfig.autoExecute && last3Trades.length === 3) {
      const allLost = last3Trades.every(t => t.result !== undefined && t.result < 0);
      if (allLost) {
        setHFConfig(prev => ({ ...prev, autoExecute: false }));
        toast({ title: '🛑 Kill Switch Ativado', description: '3 perdas consecutivas detectadas. Auto-execute pausado.', variant: 'destructive' });
      }
    }
  }, [operationsLog, hfConfig.autoExecute, toast]);

  useEffect(() => {
    if (!hfConfig.autoExecute || !hfConfig.enabled || isExecuting) return;
    if (ensembleSignal && ensembleSignal.direction !== 'NEUTRAL' && positionSizing && positionSizing.recommendedStake > 0) {
      handleExecuteStrike();
    }
  }, [ensembleSignal, positionSizing, hfConfig.autoExecute, hfConfig.enabled, isExecuting, handleExecuteStrike]);

  const [isBacktesting, setIsBacktesting] = useState(false);
  const [backtestResults, setBacktestResults] = useState<Record<string, InstitutionalBacktestResult> | null>(null);
  const [walkForwardResults, setWalkForwardResults] = useState<WalkForwardResult[] | null>(null);
  const [monteCarloResult, setMonteCarloResult] = useState<MonteCarloResult | null>(null);

  const handleRunBacktest = useCallback(async () => {
    if (!activeSymbol) {
        toast({ title: "Selecione um ativo", variant: 'destructive' });
        return;
    }
    setIsBacktesting(true);
    setBacktestResults(null);
    setWalkForwardResults(null);
    setMonteCarloResult(null);
    try {
        toast({ title: "Iniciando Backtest...", description: "Buscando 1500 velas históricas..." });
        
        const historicalData = await getHistoricalData(activeSymbol, 'candles', 1500, '1m') as CandleData[];
        
        if (historicalData.length < 100) {
            throw new Error("Dados históricos insuficientes para o backtest.");
        }
        
        toast({ title: "Dados recebidos", description: `Analisando ${historicalData.length} velas... Isso pode ser rápido.` });
        
        await new Promise(resolve => setTimeout(resolve, 50)); 
        
        const results = runAllStrategiesBacktest(historicalData, hfConfig, activeSymbol);
        setBacktestResults(results);
        
        toast({ title: "Backtest Concluído!", description: "Resultados da simulação estão disponíveis." });

    } catch (e: any) {
        toast({ title: "Erro no Backtest", description: e.message, variant: 'destructive' });
    } finally {
        setIsBacktesting(false);
    }
  }, [activeSymbol, getHistoricalData, toast, hfConfig]);
  
  const handleRunWalkForward = useCallback(async () => {
    if (!activeSymbol) {
        toast({ title: "Selecione um ativo", variant: 'destructive' });
        return;
    }
    setIsBacktesting(true);
    setBacktestResults(null);
    setWalkForwardResults(null);
    setMonteCarloResult(null);
    try {
        toast({ title: "Iniciando Walk-Forward...", description: "Buscando 5000 velas e rodando 3 folds..." });
        const historicalData = await getHistoricalData(activeSymbol, 'candles', 5000, '1m') as CandleData[];
        if (historicalData.length < 1500) throw new Error("Dados históricos insuficientes para análise Walk-Forward.");
        toast({ title: "Dados recebidos", description: `Analisando ${historicalData.length} velas...` });
        await new Promise(resolve => setTimeout(resolve, 50));
        const strategyToTest = 'STD_TREND_FOLLOW'; // Test a single robust strategy for this example
        const results = runWalkForwardAnalysis(historicalData, hfConfig, strategyToTest, activeSymbol);
        setWalkForwardResults(results);
        toast({ title: "Análise Walk-Forward Concluída!", description: "Resultados da robustez da estratégia estão disponíveis." });
    } catch (e: any) {
        toast({ title: "Erro na Análise Walk-Forward", description: e.message, variant: 'destructive' });
    } finally {
        setIsBacktesting(false);
    }
  }, [activeSymbol, getHistoricalData, toast, hfConfig]);
  
  const handleRunMonteCarlo = useCallback(async () => {
      if (!backtestResults) {
          toast({ title: "Execute o Backtest Simples Primeiro", description: "A Simulação de Monte Carlo precisa dos resultados de um backtest base.", variant: 'destructive' });
          return;
      }
      const bestStrategyKey = Object.entries(backtestResults).sort(([, a], [, b]) => (b.metrics?.sharpeRatio || 0) - (a.metrics?.sharpeRatio || 0))[0][0];
      if (!bestStrategyKey) {
          toast({ title: "Nenhuma estratégia para analisar", variant: 'destructive' });
          return;
      }
      
      setIsBacktesting(true);
      setMonteCarloResult(null);
      toast({ title: "Iniciando Simulação de Monte Carlo...", description: `Rodando 1000 iterações para a estratégia '${bestStrategyKey}'...` });
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      try {
          const result = runMonteCarloSimulation(backtestResults[bestStrategyKey], 1000);
          setMonteCarloResult(result);
          toast({ title: "Simulação de Monte Carlo Concluída!", description: "Resultados da validação estatística disponíveis." });
      } catch(e: any) {
          toast({ title: "Erro na Simulação", description: e.message, variant: 'destructive' });
      } finally {
          setIsBacktesting(false);
      }
  }, [backtestResults, toast]);


  return (
    <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-headline">⚡ HF Institucional</h1>
          <p className="text-sm text-muted-foreground mt-1">Trading de Alta Frequência com IA Adaptativa.</p>
        </div>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div className="flex justify-center"><AssetSelector selectedAsset={activeSymbol || ''} onAssetChange={asset => setActiveSymbol(asset)} assetGroups={assetGroups} isAssetsLoading={isAssetsLoading}/></div>
            <div className="flex justify-center"><ApiStatusIndicator /></div>
            <div className="flex items-center justify-center md:justify-end gap-4">
                <ToggleGroup type="single" value={accountType} onValueChange={(value: any) => value && setAccountType(value)}><ToggleGroupItem value="demo">Demo</ToggleGroupItem><ToggleGroupItem value="real">Real</ToggleGroupItem></ToggleGroup>
                <div className="text-right">
                    {accountBalance.loading || isConnecting ? <div className="space-y-1"><Skeleton className="h-4 w-16" /><Skeleton className="h-5 w-24" /></div> : 
                    accountBalance.balance !== null ? <div><p className="text-xs text-muted-foreground capitalize">Saldo ({accountType})</p><p className="text-lg font-bold">{new Intl.NumberFormat('en-US',{style:'currency',currency:accountBalance.currency || 'USD'}).format(accountBalance.balance)}</p></div> : null}
                </div>
            </div>
        </div>
      </div>
      
      {user && <InstitutionalMetricsDashboard />}
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-yellow-500" />Gráfico de Mercado ({activeSymbol})</CardTitle>
                    <CardDescription>Análise em tempo real com overlays.</CardDescription>
                </CardHeader>
                <CardContent><MarketChart activeSymbol={activeSymbol || ''} chartData={rawChartData} isChartLoading={isChartLoading} chartError={chartError} chartType={chartType} setChartType={setChartType} timePeriod={timePeriod} setTimePeriod={setTimePeriod} operations={operationsLog} indicators={fullIndicators} tradeAnnotations={tradeAnnotations} supplyDemandZones={supplyDemandZones}/></CardContent>
            </Card>

            <Collapsible>
                <CollapsibleTrigger asChild>
                    <Button variant="outline" className="w-full">
                        <TestTube className="mr-2 h-4 w-4" />
                        Painel de Backtesting
                    </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                    <BacktestPanel 
                        results={backtestResults} 
                        walkForwardResults={walkForwardResults}
                        monteCarloResult={monteCarloResult}
                        onRunBacktest={handleRunBacktest} 
                        isBacktesting={isBacktesting}
                        onRunWalkForward={handleRunWalkForward}
                        onRunMonteCarlo={handleRunMonteCarlo}
                    />
                </CollapsibleContent>
            </Collapsible>
            
            <HFExecutionLog operations={operationsLog} clearActiveContracts={clearActiveContracts} />
        </div>
        <div className="space-y-6">
          <EnsembleSignalCard signal={ensembleSignal} regime={marketRegime} onExecute={handleExecuteStrike} isExecuting={isExecuting} />
          <HFConfigPanel config={hfConfig} onConfigChange={updates => setHFConfig(prev => ({ ...prev, ...updates }))} disabled={isExecuting} strategy={'HF_MEAN_REVERSION'} />
        </div>
      </div>
    </div>
  );
}

export default function HFStrikeZonePage() {
  return (
    <DerivApiProvider>
      <PageContent />
    </DerivApiProvider>
  );
}
