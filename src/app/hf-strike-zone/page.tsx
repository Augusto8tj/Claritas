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
import { HFConfigPanel, type HFConfig } from '@/features/trading/components/hf-trader/hf-config-panel';
import { saveHFTradeLog } from '@/services/hf-data-service';
import { Target, TrendingUp, BarChart, Brain, Activity, Zap, ShieldAlert, Bot, TestTube, GitCompareArrows, Dice5, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Operation, CandleData, TimePeriod, InstitutionalBacktestResult, WalkForwardResult, MonteCarloResult, DurationUnit } from '@/lib/types';
import { InstitutionalMetricsDashboard } from '@/features/trading/components/hf-trader/institutional-metrics-dashboard';
import { HFSignalCard } from '@/features/trading/components/hf-trader/champion-signal-card';
import { Skeleton } from '@/components/ui/skeleton';
import { runAllStrategiesBacktest, runWalkForwardAnalysis, runMonteCarloSimulation } from '@/features/trading/backtest/hf-backtest-engine';
import { StrategyType } from '@/features/trading/services/hf-strike-logic';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { BacktestPanel } from '@/features/trading/components/hf-trader/BacktestPanel';
import { StrategySignalMonitor } from '@/features/trading/components/hf-trader/StrategySignalMonitor';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';


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
    enabled: true, minConfidence: 70, autoExecute: false, maxConcurrentTrades: 1, preferredDuration: 20,
    minConsensusSignals: 2, martingaleMultiplier: 1.0, maxConsecutiveLosses: 5, cooldownSeconds: 30,
  });

  const [dailyBalance, setDailyBalance] = useState(100.0);
  const [dailyTarget, setDailyTarget] = useState(50.0);
  const [stakeValue, setStakeValue] = useState(1.0);

  const hfOperations = useMemo(() => operationsLog.filter(op => op.initiator === 'HF_Strike'), [operationsLog]);

  const {
    activeStrikeZone,
    marketRegime,
    positionSizing,
    fullIndicators,
    supplyDemandZones,
    allSignals,
    strategyCounts,
    consecutiveLosses,
    isCooldownActive,
    isExecuting,
  } = useHFStrikeZone(
      activeSymbol, 
      priceTicks, 
      botCandleData, 
      timePeriod, 
      hfConfig, 
      (newConfig) => setHFConfig(prev => ({...prev, ...newConfig})),
      { 
        dailyBalance, 
        dailyTarget, 
        operationsLog: hfOperations,
        manualStake: stakeValue,
      }
  ); 

  const handleExecuteStrike = useCallback(async () => {
    if (!activeStrikeZone || !positionSizing || positionSizing.recommendedStake === 0 || !user || !activeSymbol) {
      toast({ title: 'Sinal Inválido', description: 'Não há sinal válido para executar.', variant: 'destructive' });
      return;
    }
    // The execution logic in useHFStrikeZone will handle this
  }, [activeStrikeZone, positionSizing, user, activeSymbol, toast]);
  
  
  // ... backtesting logic remains the same ...
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [backtestData, setBacktestData] = useState<CandleData[]>([]);
  const [backtestResults, setBacktestResults] = useState<Record<string, InstitutionalBacktestResult> | null>(null);
  const [walkForwardResults, setWalkForwardResults] = useState<WalkForwardResult[] | null>(null);
  const [monteCarloResult, setMonteCarloResult] = useState<MonteCarloResult | null>(null);

  const handleRunBacktest = useCallback(async () => {
    if (!activeSymbol) { toast({ title: "Selecione um ativo", variant: 'destructive' }); return; }
    setIsBacktesting(true); setBacktestResults(null); setWalkForwardResults(null); setMonteCarloResult(null); setBacktestData([]); 
    try {
      toast({ title: "Iniciando Backtest...", description: "Buscando 1500 velas históricas..." });
      const historicalData = await getHistoricalData(activeSymbol, 'candles', 1500, '1m') as CandleData[];
      setBacktestData(historicalData);
      if (historicalData.length < 100) throw new Error("Dados históricos insuficientes para o backtest.");
      toast({ title: "Dados recebidos", description: `Analisando ${historicalData.length} velas...` });
      await new Promise(resolve => setTimeout(resolve, 50)); 
      const results = runAllStrategiesBacktest(historicalData, hfConfig, activeSymbol);
      setBacktestResults(results);
      toast({ title: "Backtest Concluído!", description: "Resultados da simulação estão disponíveis." });
    } catch (e: any) { toast({ title: "Erro no Backtest", description: e.message, variant: 'destructive' });
    } finally { setIsBacktesting(false); }
  }, [activeSymbol, getHistoricalData, toast, hfConfig]);
  
  const handleRunWalkForward = useCallback(async () => {
    if (!activeSymbol || !backtestData || backtestData.length < 1500) { toast({ title: "Dados insuficientes", description: "Execute o Backtest Simples primeiro.", variant: 'destructive' }); return; }
    setIsBacktesting(true); setBacktestResults(null); setWalkForwardResults(null); setMonteCarloResult(null);
    try {
      toast({ title: "Iniciando Walk-Forward...", description: "Rodando 3 folds..." });
      await new Promise(resolve => setTimeout(resolve, 50));
      const strategyToTest = 'STD_TREND_FOLLOW'; 
      const results = runWalkForwardAnalysis(backtestData, hfConfig, strategyToTest, activeSymbol);
      setWalkForwardResults(results);
      toast({ title: "Análise Walk-Forward Concluída!" });
    } catch (e: any) { toast({ title: "Erro na Análise Walk-Forward", description: e.message, variant: 'destructive' });
    } finally { setIsBacktesting(false); }
  }, [activeSymbol, backtestData, toast, hfConfig]);
  
  const handleRunMonteCarlo = useCallback(async () => {
      if (!backtestResults || backtestData.length === 0) { toast({ title: "Execute o Backtest Simples Primeiro", variant: 'destructive' }); return; }
      const bestStrategyKey = Object.entries(backtestResults).sort(([, a], [, b]) => (b.metrics?.sharpeRatio || 0) - (a.metrics?.sharpeRatio || 0))[0][0];
      if (!bestStrategyKey) { toast({ title: "Nenhuma estratégia para analisar", variant: 'destructive' }); return; }
      setIsBacktesting(true); setMonteCarloResult(null);
      toast({ title: "Iniciando Simulação de Monte Carlo...", description: `Rodando 1000 iterações...` });
      await new Promise(resolve => setTimeout(resolve, 50));
      try {
          const result = runMonteCarloSimulation(backtestResults[bestStrategyKey as StrategyType], backtestData, 1000);
          setMonteCarloResult(result);
          toast({ title: "Simulação de Monte Carlo Concluída!" });
      } catch(e: any) { toast({ title: "Erro na Simulação", description: e.message, variant: 'destructive' });
      } finally { setIsBacktesting(false); }
  }, [backtestResults, backtestData, toast]);


  return (
    <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-headline">⚡ HF Strike Zone</h1>
          <p className="text-sm text-muted-foreground mt-1">Trading de Alta Frequência com Consenso de IA.</p>
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

            <HFExecutionLog operations={hfOperations} clearActiveContracts={clearActiveContracts} />
            
             <Collapsible>
                <CollapsibleTrigger asChild>
                   <Button variant="outline" className="w-full" type="button">
                        <TestTube className="mr-2 h-4 w-4" />
                        Painel de Backtesting Avançado
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
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5"/>Gestão da Sessão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label htmlFor="stake-value">Valor do Contrato (USD)</Label>
                    <Input id="stake-value" type="number" value={stakeValue} onChange={e => setStakeValue(Number(e.target.value))} step="0.01" min="0.35" />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="daily-balance">Banca Diária (USD)</Label>
                      <Input id="daily-balance" type="number" value={dailyBalance} onChange={e => setDailyBalance(Number(e.target.value))} />
                  </div>
              </div>
              <div className="space-y-2">
                  <Label htmlFor="daily-target">Alvo de Lucro Diário (USD)</Label>
                  <Input id="daily-target" type="number" value={dailyTarget} onChange={e => setDailyTarget(Number(e.target.value))} />
              </div>
            </CardContent>
          </Card>
          <HFSignalCard signal={activeStrikeZone} onExecute={handleExecuteStrike} isExecuting={isExecuting} consecutiveLosses={consecutiveLosses} isCooldown={isCooldownActive}/>
          <StrategySignalMonitor signals={allSignals} counts={strategyCounts} />
          <HFConfigPanel
            config={hfConfig}
            onConfigChange={updates => setHFConfig((prev: any) => ({ ...prev, ...updates }))}
          />
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
