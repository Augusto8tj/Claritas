// /src/app/deriv-trader-reset/page.tsx
'use client';

import React from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import DerivTraderInterfaceReset from "@/features/trading/components/deriv-trader/deriv-trader-interface-reset";
import { AssetSelectorReset } from "@/features/trading/components/deriv-trader/asset-selector-reset";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { DerivApiProviderReset, useDerivApiReset } from "@/features/trading/hooks/use-deriv-api-reset";
import { Skeleton } from "@/components/ui/skeleton";
import OperationsLogReset from "@/features/trading/components/deriv-trader/operations-log-reset";
import { resetSchema, type ResetFormValues } from "@/features/trading/components/deriv-trader/deriv-trader-interface-reset.types";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiStatusIndicatorReset } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorReset";
import { useResetCallPutStrategy } from "@/features/trading/hooks/use-reset-call-put-strategy";
import { ResetAutopilotInterface } from "@/features/trading/components/deriv-trader/reset-autopilot-interface";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


function Header() {
    const {
        accountType, 
        setAccountType, 
        accountBalance, 
        isConnecting,
        isAssetsLoading,
        assetGroups,
        activeSymbol,
        setActiveSymbol,
    } = useDerivApiReset();
    
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left">
                Deriv Reset Call/Put
            </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="flex justify-center">
                    <AssetSelectorReset
                        selectedAsset={activeSymbol || ""} 
                        onAssetChange={(asset) => setActiveSymbol(asset)} 
                        assetGroups={assetGroups}
                        isAssetsLoading={isAssetsLoading}
                    />
                </div>
                <div className="flex justify-center">
                    <ApiStatusIndicatorReset />
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

function IsolatedMarketChart() {
    const { 
        activeSymbol, operationsLog, chartData, isChartLoading, chartError, 
        chartType, setChartType, timePeriod, setTimePeriod, tradeAnnotations
    } = useDerivApiReset();
    
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                    <CardTitle className="font-headline text-lg">Gráfico ({activeSymbol})</CardTitle>
                    <CardDescription className="text-xs">Desempenho em tempo real do ativo.</CardDescription>
                </div>
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
                    indicators={null}
                    tradeAnnotations={tradeAnnotations}
                />
            </CardContent>
        </Card>
    );
};

function MainContent() {
    const { activeSymbol, operationsLog, sellContract, clearActiveContracts, botCandleData, accountBalance } = useDerivApiReset();
    const strategy = useResetCallPutStrategy(activeSymbol, botCandleData, accountBalance.balance);
    
    return (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 space-y-6">
                 <DerivTraderInterfaceReset symbol={activeSymbol || ""} />
            </div>
            <div className="lg:col-span-3 space-y-6">
                <ResetAutopilotInterface {...strategy} />
                <OperationsLogReset operations={operationsLog} sellContract={sellContract} clearActiveContracts={clearActiveContracts} />
            </div>
        </div>
    );
};

function DerivResetPageContent() {
    return (
        <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
            <Header />
            <IsolatedMarketChart />
            <MainContent />
        </div>
    );
}

export default function DerivResetPage() {
  const form = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: {
      stake: 1.00,
      duration: 1,
      duration_unit: 'm',
      reset_barrier_offset: '+0.0'
    },
  });

  return (
    <DerivApiProviderReset>
        <FormProvider {...form}>
            <DerivResetPageContent />
        </FormProvider>
    </DerivApiProviderReset>
  );
}
