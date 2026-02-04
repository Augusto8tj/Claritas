// src/app/hf-strike-zone/page.tsx
'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { Target, TrendingUp, BarChart, Brain, Activity, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Operation, TradeResult } from '@/lib/types';

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
  } = useDerivApi();

  // HF Configuration State
  const [hfConfig, setHFConfig] = useState<HFConfig>({
    enabled: true,
    minConfidence: 70,
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

  // Strike Zone Hook
  const { currentZone, strikeHistory, stats, bbAnalysis, rsiAnalysis } = useHFStrikeZone(
    priceTicks,
    chartData,
    hfConfig.enabled
  );

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

    // Verificar trades concorrentes
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

      // Executar trade via Deriv API
      const tradeResult: TradeResult = await executeTrade(
        contractType,
        1.0, // Stake fixo para HF
        activeSymbol,
        direction,
        hfConfig.preferredDuration,
        's',
        'HF_Strike' as any // Marcador especial
      );
      
      if (!tradeResult.success) {
        throw new Error(tradeResult.message);
      }

      // Salvar log no Firebase
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
        description: `${contractType} ${direction.toUpperCase()} - ${hfConfig.preferredDuration}s`,
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
  }, [currentZone, user, activeSymbol, hfConfig, operationsLog, executeTrade, toast]);

  // Auto-execute quando habilitado
  useEffect(() => {
    if (!hfConfig.autoExecute || !hfConfig.enabled) return;
    if (!currentZone || currentZone.type === 'NEUTRAL') return;
    if (currentZone.confidence < hfConfig.minConfidence) return;

    // Debounce de 5 segundos para evitar execuções duplicadas
    const timeout = setTimeout(() => {
      handleExecuteStrike();
    }, 5000);

    return () => clearTimeout(timeout);
  }, [currentZone, hfConfig, handleExecuteStrike]);

  // Filtar zonas por confiança mínima
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
            High Frequency Trading baseado em reversão estatística
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

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Total Strikes</span>
              <BarChart className="h-3 w-3" />
            </div>
            <p className="text-2xl font-bold">{stats.totalStrikes}</p>
            <p className="text-xs text-muted-foreground mt-1">
              L:{stats.strikesByType.long} S:{stats.strikesByType.short}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Win Rate</span>
              <TrendingUp className="h-3 w-3" />
            </div>
            <p className={cn('text-2xl font-bold', hfStats.winRate > 60 ? 'text-green-600' : 'text-red-600')}>
              {hfStats.winRate.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">{hfStats.totalTrades} trades</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>P&L Total</span>
              <Target className="h-3 w-3" />
            </div>
            <p className={cn('text-2xl font-bold', hfStats.totalPnL > 0 ? 'text-green-600' : 'text-red-600')}>
              ${Math.abs(hfStats.totalPnL).toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Sharpe Ratio</span>
              <Brain className="h-3 w-3" />
            </div>
            <p className="text-2xl font-bold">{hfStats.sharpeRatio.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Avg Confiança</span>
              <Activity className="h-3 w-3" />
            </div>
            <p className="text-2xl font-bold">{stats.avgConfidence}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Market Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            Gráfico de Mercado ({activeSymbol})
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
            indicators={{
              bb: bbAnalysis ? {
                upper: bbAnalysis.upper,
                middle: bbAnalysis.middle,
                lower: bbAnalysis.lower,
              } : null,
              rsi: rsiAnalysis ? rsiAnalysis.value : null,
            }}
            tradeAnnotations={tradeAnnotations}
          />
        </CardContent>
      </Card>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Strike Zone Card */}
        <div className="lg:col-span-2">
          <StrikeZoneCard
            zone={filteredZone}
            onExecute={handleExecuteStrike}
            isExecuting={isExecuting}
          />
        </div>

        {/* Config Panel */}
        <div>
          <HFConfigPanel
            config={hfConfig}
            onConfigChange={updates => setHFConfig(prev => ({ ...prev, ...updates }))}
            disabled={isExecuting}
          />
        </div>
      </div>

      {/* Alert */}
      {hfConfig.autoExecute && hfConfig.enabled && (
        <Alert className="bg-yellow-50 border-yellow-300">
          <Zap className="h-4 w-4 text-yellow-600" />
          <AlertTitle className="text-yellow-900">🤖 Auto-Execute Ativo</AlertTitle>
          <AlertDescription className="text-yellow-800">
            O sistema executará automaticamente strikes com confiança ≥ {hfConfig.minConfidence}%.
            Limite de {hfConfig.maxConcurrentTrades} posições simultâneas.
          </AlertDescription>
        </Alert>
      )}
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
