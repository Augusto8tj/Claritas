// src/app/hf-strike-zone/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi } from '@/features/trading/hooks/use-deriv-api-v2';
import { AssetSelectorV2 as AssetSelector } from '@/features/trading/components/deriv-trader/asset-selector-v2';
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from '@/features/trading/components/deriv-trader/ApiStatusIndicatorV2';
import { MarketChart } from '@/features/trading/components/deriv-trader/market-chart';
import { useHFStrikeZone } from '@/features/trading/hooks/use-hf-strike-zone';
import { StrikeZoneCard } from '@/features/trading/components/hf-trader/strike-zone-card';
import { HFConfigPanel, type HFConfig } from '@/features/trading/components/hf-trader/hf-config-panel';
import { saveHFTradeLog, calculateHFStats } from '@/services/hf-data-service';
import { Target, TrendingUp, BarChart, Brain, Activity, Zap, ShieldAlert, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Operation, TradeResult, DurationUnit, CandleData } from '@/lib/types';
import { HFExecutionLog } from '@/features/trading/components/hf-trader/hf-execution-log';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StrategyType } from '@/features/trading/services/hf-strike-logic';


const MetricCard = ({ icon, label, value, subtext, color }: { icon: React.ReactNode; label: string; value: string | number; subtext?: string; color?: string }) => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span className="font-semibold">{label}</span>
          {icon}
        </div>
        <p className={cn('text-2xl font-bold', color)}>{value}</p>
        {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
      </CardContent>
    </Card>
);

const strategyDetails: Record<StrategyType, { label: string; description: string; optimalTimeframe: '1m' | '5m' | '15m' }> = {
  HF_MEAN_REVERSION: { label: 'Reversão à Média (HF)', description: 'Otimizado para reversão à média em 15-45s em ativos sintéticos.', optimalTimeframe: '1m' },
  STD_TREND_FOLLOW: { label: 'Seguidor de Tendência (Padrão)', description: 'Otimizado para seguir tendências em velas de 15m, ideal para Forex.', optimalTimeframe: '15m' },
  BOLLINGER_SQUEEZE: { label: 'Caçador de Breakouts (Squeeze)', description: 'Detecta compressão de volatilidade e opera no rompimento.', optimalTimeframe: '1m' },
  VOLUME_ABSORPTION: { label: 'Absorção de Volume (PA)', description: 'Analisa o clímax de volume e a absorção para prever reversões.', optimalTimeframe: '15m' },
  MICROSTRUCTURE_SCALP: { label: 'Scalper de Microestrutura', description: 'Analisa o fluxo de ordens para trades de 5 ticks.', optimalTimeframe: '1m' },
};


function PageContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    activeSymbol,
    setActiveSymbol,
    assetGroups,
    isAssetsLoading,
    accountType,
    setAccountType,
    accountBalance,
    isConnecting,
    chartData,
    botCandleData,
    priceTicks,
    isChartLoading,
    chartError,
    chartType,
    setChartType,
    timePeriod,
    setTimePeriod,
    operationsLog,
    tradeAnnotations,
    executeTrade,
    clearActiveContracts,
  } = useDerivApi();

  const [hfConfig, setHFConfig] = useState<HFConfig>({
    enabled: true,
    minConfidence: 60,
    autoExecute: false,
    maxConcurrentTrades: 2,
    preferredDuration: 20,
  });

  const [isExecuting, setIsExecuting] = useState(false);
  const [hfStats, setHFStats] = useState({
    totalTrades: 0,
    winRate: 0,
    totalPnL: 0,
    avgConfidence: 0,
    sharpeRatio: 0,
  });

  const [strategy, setStrategy] = useState<StrategyType>('HF_MEAN_REVERSION');
  
  const uiChartData = useMemo(() => chartData.filter((d): d is CandleData => 'close' in d), [chartData]);

  const {
    currentZone,
    strikeHistory,
    stats,
    fullIndicators,
    supplyDemandZones,
  } = useHFStrikeZone(
    priceTicks,
    botCandleData,
    uiChartData,
    hfConfig.enabled,
    strategy
  );
  
  const handleStrategyChange = (newStrategy: StrategyType) => {
    setStrategy(newStrategy);
    const details = strategyDetails[newStrategy];
    if (details) {
        setTimePeriod(details.optimalTimeframe);
    }
  };

  useEffect(() => {
    if (!hfConfig.autoExecute) return;
    const last3Trades = operationsLog
      .filter(op => op.initiator === 'HF_Strike' && op.status !== 'pending')
      .slice(-3);
    if (last3Trades.length === 3) {
      const allLost = last3Trades.every(t => t.result !== undefined && t.result < 0);
      if (allLost) {
        setHFConfig(prev => ({ ...prev, autoExecute: false }));
        toast({
          title: '🛑 Kill Switch Ativado',
          description: '3 perdas consecutivas detectadas. Auto-execute pausado.',
          variant: 'destructive',
        });
      }
    }
  }, [operationsLog, hfConfig.autoExecute, toast]);

  useEffect(() => {
    if (!user) return;
    const loadStats = async () => {
      const stats = await calculateHFStats(user.uid);
      setHFStats(stats);
    };
    loadStats();
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const handleExecuteStrike = useCallback(async () => {
    if (!currentZone || !user || !activeSymbol) {
      toast({ title: 'Erro', description: 'Dados insuficientes para executar', variant: 'destructive' });
      return;
    }
    if (currentZone.confidence < hfConfig.minConfidence) {
      toast({
        title: 'Confiança Insuficiente',
        description: `Sinal com ${currentZone.confidence.toFixed(0)}%, mínimo: ${hfConfig.minConfidence}%`,
        variant: 'destructive',
      });
      return;
    }
    const pendingHFTrades = operationsLog.filter(
      (op: Operation) => op.status === 'pending' && op.initiator === 'HF_Strike'
    );
    if (pendingHFTrades.length >= hfConfig.maxConcurrentTrades) {
      toast({
        title: 'Limite Atingido',
        description: `Máximo de ${hfConfig.maxConcurrentTrades} trades simultâneos`,
        variant: 'destructive',
      });
      return;
    }
    setIsExecuting(true);
    try {
      const direction = currentZone.type === 'LONG_ENTRY' ? 'rise' : 'fall';
      const contractType = currentZone.type === 'LONG_ENTRY' ? 'CALL' : 'PUT';
      
      let duration: number;
      let durationUnit: DurationUnit;

      if (strategy === 'MICROSTRUCTURE_SCALP') {
        duration = 5;
        durationUnit = 't';
      } else if (strategy === 'STD_TREND_FOLLOW' || strategy === 'VOLUME_ABSORPTION') {
        duration = 3;
        durationUnit = 'm';
      } else {
        duration = currentZone.duration;
        durationUnit = 's';
      }

      const tradeResult: TradeResult = await executeTrade(
        contractType,
        1.0,
        activeSymbol,
        direction,
        duration,
        durationUnit,
        'HF_Strike' as any
      );
      if (!tradeResult.success) {
        throw new Error(tradeResult.message);
      }
      await saveHFTradeLog(user.uid, {
        symbol: activeSymbol,
        strikeZone: currentZone,
        execution: {
          contractId: String(tradeResult.contractId),
          entryPrice: currentZone.entry.price,
          status: 'pending',
          executedAt: new Date().toISOString(),
        },
      });
      toast({
        title: '⚡ Strike Executado!',
        description: `${contractType} ${direction.toUpperCase()} - ${duration}${durationUnit}`,
      });
    } catch (error: any) {
      toast({ title: 'Erro na Execução', description: error.message || 'Falha ao executar strike', variant: 'destructive' });
    } finally {
      setIsExecuting(false);
    }
  }, [currentZone, user, activeSymbol, hfConfig, operationsLog, executeTrade, toast, strategy]);

  useEffect(() => {
    if (!hfConfig.autoExecute || !hfConfig.enabled || isExecuting) return;
    const lastStrike = strikeHistory[strikeHistory.length - 1];
    if (!currentZone || currentZone.type === 'NEUTRAL' || (lastStrike && lastStrike.entry.timestamp === currentZone.entry.timestamp)) return;
    if (currentZone.confidence >= hfConfig.minConfidence) {
      handleExecuteStrike();
    }
  }, [currentZone, hfConfig.autoExecute, hfConfig.enabled, hfConfig.minConfidence, handleExecuteStrike, isExecuting, strikeHistory]);

  const filteredZone = useMemo(() => {
    if (!currentZone) {
      return null;
    }
    if (currentZone.type === 'NEUTRAL') {
      const isVetoed = currentZone.triggers?.some(t => t.startsWith('VETO'));
      return isVetoed ? currentZone : null;
    }
    if (currentZone.confidence < hfConfig.minConfidence) {
      return null;
    }
    return currentZone;
  }, [currentZone, hfConfig.minConfidence]);

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-headline">⚡ HF Strike Zone</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Trading de Alta Frequência e Padrão para Sintéticos e Forex.
          </p>
        </div>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          <div className="flex justify-center">
            <AssetSelector
              selectedAsset={activeSymbol || ''}
              onAssetChange={asset => setActiveSymbol(asset)}
              assetGroups={assetGroups}
              isAssetsLoading={isAssetsLoading}
            />
          </div>
          <div className="flex justify-center">
            <ApiStatusIndicator />
          </div>
          <div className="flex items-center justify-center md:justify-end gap-4">
            <ToggleGroup
              type="single"
              value={accountType}
              onValueChange={(value: any) => value && setAccountType(value)}
            >
              <ToggleGroupItem value="demo">Demo</ToggleGroupItem>
              <ToggleGroupItem value="real">Real</ToggleGroupItem>
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
                  <p className="text-lg font-bold">
                    {new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: accountBalance.currency || 'USD',
                    }).format(accountBalance.balance)}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

       <div className="flex items-center justify-center">
        <Select value={strategy} onValueChange={(v) => handleStrategyChange(v as StrategyType)}>
          <SelectTrigger className="w-full md:w-[480px]">
            <SelectValue placeholder="Selecione uma estratégia..." />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(strategyDetails).map(([key, details]) => (
              <SelectItem key={key} value={key}>{details.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
       </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard icon={<BarChart className="h-4 w-4" />} label="Total Strikes" value={stats.totalStrikes} subtext={`L:${stats.strikesByType.long} S:${stats.strikesByType.short}`} />
        <MetricCard icon={<TrendingUp className="h-4 w-4" />} label="Win Rate" value={`${hfStats.winRate.toFixed(1)}%`} subtext={`${hfStats.totalTrades} trades`} color={hfStats.winRate > 53 ? 'text-green-600' : 'text-red-600'} />
        <MetricCard icon={<Target className="h-4 w-4" />} label="P&L Total" value={`${hfStats.totalPnL >= 0 ? '+' : '-'}$${Math.abs(hfStats.totalPnL).toFixed(2)}`} subtext={hfStats.totalPnL > 0 ? 'Lucro' : 'Prejuízo'} color={hfStats.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'} />
        <MetricCard icon={<Brain className="h-4 w-4" />} label="Sharpe Ratio" value={hfStats.sharpeRatio.toFixed(2)} subtext="Risco-Retorno" />
        <MetricCard icon={<Activity className="h-4 w-4" />} label="Avg Confiança" value={`${stats.avgConfidence}%`} subtext="Qualidade do Sinal" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Gráfico de Mercado ({activeSymbol})
          </CardTitle>
          <CardDescription>
            Análise em tempo real com overlays de indicadores e zonas de interesse.
          </CardDescription>
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
            indicators={fullIndicators}
            tradeAnnotations={tradeAnnotations}
            supplyDemandZones={supplyDemandZones}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <StrikeZoneCard
            zone={filteredZone}
            strategy={strategy}
            onExecute={handleExecuteStrike}
            isExecuting={isExecuting}
          />
        </div>
        <div>
          <HFConfigPanel
            config={hfConfig}
            onConfigChange={updates => setHFConfig(prev => ({ ...prev, ...updates }))}
            disabled={isExecuting}
            strategy={strategy}
          />
        </div>
      </div>
      
      <div className="pt-6">
        <Alert className={cn("bg-yellow-50 border-yellow-200", !hfConfig.autoExecute && "hidden")}>
          <Bot className="h-4 w-4 text-yellow-600" />
          <AlertTitle className="text-yellow-900">🤖 Auto-Execute Ativo</AlertTitle>
          <AlertDescription className="text-yellow-800">
            O sistema executará automaticamente strikes com confiança ≥ {hfConfig.minConfidence}%.
            Limite de {hfConfig.maxConcurrentTrades} posições simultâneas.
          </AlertDescription>
        </Alert>
        <HFExecutionLog operations={operationsLog} clearActiveContracts={clearActiveContracts} />
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