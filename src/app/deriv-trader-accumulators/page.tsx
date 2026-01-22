// src/app/deriv-trader-accumulators/page.tsx
'use client';

import React from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import DerivTraderInterfaceAccumulators from "@/features/trading/components/deriv-trader/deriv-trader-interface-accumulators";
import { AssetSelectorAccumulators } from "@/features/trading/components/deriv-trader/asset-selector-accumulators";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { DerivApiProviderAccumulators, useDerivApiAccumulators } from "@/features/trading/hooks/use-deriv-api-accumulators";
import { Skeleton } from "@/components/ui/skeleton";
import OperationsLogAccumulators from "@/features/trading/components/deriv-trader/operations-log-accumulators";
import { accumulatorSchema, type AccumulatorFormValues } from "@/features/trading/components/deriv-trader/deriv-trader-interface-accumulators.types";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiStatusIndicatorAccumulators } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorAccumulators";
import { useAccumulatorsCouncil } from "@/features/trading/hooks/use-accumulators-council";
import { AccumulatorsAutopilotInterface } from "@/features/trading/components/deriv-trader/accumulators-autopilot-interface";


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
    } = useDerivApiAccumulators();
    
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left">
                Deriv Accumulators
            </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="flex justify-center">
                    <AssetSelectorAccumulators
                        selectedAsset={activeSymbol || ""} 
                        onAssetChange={(asset) => setActiveSymbol(asset)} 
                        assetGroups={assetGroups}
                        isAssetsLoading={isAssetsLoading}
                    />
                </div>
                <div className="flex justify-center">
                    <ApiStatusIndicatorAccumulators />
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
    } = useDerivApiAccumulators();
    
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
    const { activeSymbol, operationsLog, sellContract, priceTicks, clearActiveContracts } = useDerivApiAccumulators();
    const council = useAccumulatorsCouncil();
    
    return (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-6">
                 <DerivTraderInterfaceAccumulators symbol={activeSymbol || ""} />
                 <AccumulatorsAutopilotInterface {...council} />
            </div>
            <div className="lg:col-span-2">
                <OperationsLogAccumulators operations={operationsLog} sellContract={sellContract} priceTicks={priceTicks} clearActiveContracts={clearActiveContracts} />
            </div>
        </div>
    );
};

function DerivAccumulatorsPageContent() {
    return (
        <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
            <Header />
            <IsolatedMarketChart />
            <MainContent />
        </div>
    );
}

export default function DerivAccumulatorsPage() {
  const form = useForm<AccumulatorFormValues>({
    resolver: zodResolver(accumulatorSchema),
    defaultValues: {
      stake: 1.00,
      growth_rate: 0.01,
    },
  });

  return (
    <DerivApiProviderAccumulators>
        <FormProvider {...form}>
            <DerivAccumulatorsPageContent />
        </FormProvider>
    </DerivApiProviderAccumulators>
  );
}
