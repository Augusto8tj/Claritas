// src/app/hf-strike-zone/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { useHFStrikeZone, type StrikeZone } from '@/features/trading/hooks/use-hf-strike-zone';
import { StrikeZoneCard } from '@/features/trading/components/hf-trader/strike-zone-card';
import { HFConfigPanel, type HFConfig } from '@/features/trading/components/hf-trader/hf-config-panel';
import { saveHFTradeLog, calculateHFStats } from '@/services/hf-data-service';
import { Target, TrendingUp, BarChart, Brain, Activity, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Operation, TradeResult, DurationUnit } from '@/lib/types';
import { HFExecutionLog } from '@/features/trading/components/hf-trader/hf-execution-log';

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

  const [tradingMode, setTradingMode] = useState<'hf' | 'standard'>('hf');

  // HF Configuration State
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

  const prevZoneRef = useRef<StrikeZone | null>(null);

  // Auto-switch time period based on trading mode
  useEffect(() => {
    setTimePeriod(tradingMode === 'hf' ? '1m' : '15m');
  }, [tradingMode, setTimePeriod]);

  // Strike Zone Hook - NOW ACCEPTS TRADING MODE
  const { currentZone, strikeHistory, stats, fullIndicators } = useHFStrikeZone(
    priceTicks,
    botCandleData, // Always use 1-min candles for bot logic base
    chartData,      // Pass UI chart data for standard mode
    hfConfig.enabled,
    tradingMode
  );

  // Kill Switch Logic
  useEffect(() => {
    if (!hfConfig.autoExecute) return; // Only run if autopilot is on

    const last3Trades = operationsLog
      .filter(op => op.initiator === 'HF_Strike' && op.status !== 'pending')
      .slice(-3); // Get last 3 trades
    
    if (last3Trades.length === 3) {
      const allLost = last3Trades.every(t => t.result !== undefined && t.result < 0);
      if (allLost) {
        setHFConfig(prev => ({ ...prev, autoExecute: false }));
        toast({
          title: '🛑 Kill Switch Ativado',
          description: '3 perdas HF consecutivas detectadas. Auto-execute pausado.',
          variant: 'destructive',
        });
      }
    }
  }, [operationsLog, hfConfig.autoExecute, toast]);

  // Carregar estatísticas do Firebase
  useEffect(() => {
    if (!user) return;

    const loadStats = async () => {
      const stats = await calculateHFStats(user.uid);
      setHFStats(stats);
    };

    loadStats();
    const interval = setInterval(loadStats, 30000); // Atualizar a cada 30s
    return () => clearInterval(interval);
  }, [user]);

  // Executar Strike Zone
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
        description: `Máximo de ${hfConfig.maxConcurrentTrades} trades HF simultâneos`,
        variant: 'destructive',
      });
      return;
    }

    setIsExecuting(true);

    try {
      const direction = currentZone.type === 'LONG_ENTRY' ? 'rise' : 'fall';
      const contractType = currentZone.type === 'LONG_ENTRY' ? 'CALL' : 'PUT';
      
      const durationUnit = tradingMode === 'hf' ? 's' : 'm';
      const duration = tradingMode === 'hf' ? hfConfig.preferredDuration : 45; // 45 mins for standard

      const tradeResult: TradeResult = await executeTrade(
        contractType,
        1.0, // Stake fixo para HF
        activeSymbol,
        direction,
        duration,
        durationUnit as DurationUnit,
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
      console.error('[HF Strike] Execution error:', error);
      toast({
        title: 'Erro na Execução',
        description: error.message || 'Falha ao executar strike',
        variant: 'destructive',
      });
    } finally {
      setIsExecuting(false);
    }
  }, [currentZone, user, activeSymbol, hfConfig, operationsLog, executeTrade, toast, tradingMode]);

  // Auto-execute
  useEffect(() => {
    if (!hfConfig.autoExecute || !hfConfig.enabled) return;

    const justEnteredValidZone = 
        currentZone && 
        currentZone.type !== 'NEUTRAL' && 
        (!prevZoneRef.current || prevZoneRef.current.type === 'NEUTRAL' || prevZoneRef.current.type !== currentZone.type);
    
    if (justEnteredValidZone && currentZone.confidence >= hfConfig.minConfidence) {
      handleExecuteStrike();
    }

    prevZoneRef.current = currentZone;
  }, [currentZone, hfConfig.autoExecute, hfConfig.enabled, hfConfig.minConfidence, handleExecuteStrike]);


  const filteredZone = useMemo(() => {
    if (!currentZone || currentZone.type === 'NEUTRAL') return null;
    if (currentZone.confidence < hfConfig.minConfidence) return null;
    return currentZone;
  }, [currentZone, hfConfig.minConfidence]);

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      {/* Header */}
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
        <ToggleGroup 
            type="single"
            value={tradingMode}
            onValueChange={(value: 'hf' | 'standard') => value && setTradingMode(value)}
            className="border bg-background p-1 rounded-lg"
        >
            <ToggleGroupItem value="hf">Alta Frequência</ToggleGroupItem>
            <ToggleGroupItem value="standard">Padrão (15min)</ToggleGroupItem>
        </ToggleGroup>
       </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard
          icon={<BarChart className="h-4 w-4" />}
          label="Total Strikes"
          value={stats.totalStrikes}
          subtext={`L:${stats.strikesByType.long} S:${stats.strikesByType.short}`}
        />
        <MetricCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Win Rate"
          value={`${hfStats.winRate.toFixed(1)}%`}
          subtext={`${hfStats.totalTrades} trades`}
          color={hfStats.winRate > 53 ? 'text-green-600' : 'text-red-600'}
        />
        <MetricCard
          icon={<Target className="h-4 w-4" />}
          label="P&L Total"
          value={`${hfStats.totalPnL >= 0 ? '+' : '-'}$${Math.abs(hfStats.totalPnL).toFixed(2)}`}
          subtext={hfStats.totalPnL > 0 ? 'Lucro' : 'Prejuízo'}
          color={hfStats.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}
        />
        <MetricCard
          icon={<Brain className="h-4 w-4" />}
          label="Sharpe Ratio"
          value={hfStats.sharpeRatio.toFixed(2)}
          subtext="Risco-Retorno"
        />
        <MetricCard
          icon={<Activity className="h-4 w-4" />}
          label="Avg Confiança"
          value={`${stats.avgConfidence}%`}
          subtext="Qualidade do Sinal"
        />
      </div>


      {/* Market Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Gráfico de Mercado ({activeSymbol}) - {tradingMode === 'hf' ? '1 Minuto' : '15 Minutos'}
          </CardTitle>
          <CardDescription>
            Análise em tempo real com overlays de BB, RSI e Strike Zones
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
          />
        </CardContent>
      </Card>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <StrikeZoneCard
            zone={filteredZone}
            onExecute={handleExecuteStrike}
            isExecuting={isExecuting}
          />
        </div>
        <div>
          <HFConfigPanel
            config={hfConfig}
            onConfigChange={updates => setHFConfig(prev => ({ ...prev, ...updates }))}
            disabled={isExecuting}
            tradingMode={tradingMode}
          />
        </div>
      </div>
      
      <Alert className={cn("mt-6 bg-yellow-50 border-yellow-200", !hfConfig.autoExecute && "hidden")}>
        <Zap className="h-4 w-4 text-yellow-600" />
        <AlertTitle className="text-yellow-900">🤖 Auto-Execute Ativo</AlertTitle>
        <AlertDescription className="text-yellow-800">
          O sistema executará automaticamente strikes com confiança ≥ {hfConfig.minConfidence}%.
          Limite de {hfConfig.maxConcurrentTrades} posições simultâneas.
        </AlertDescription>
      </Alert>

      <div className="pt-6">
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
