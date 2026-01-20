// /src/app/deriv-trader-multipliers/page.tsx
'use client';

import React, { useEffect, useMemo } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import DerivTraderInterfaceMultipliers from "@/features/trading/components/deriv-trader/deriv-trader-interface-multipliers";
import { AssetSelectorMultipliers } from "@/features/trading/components/deriv-trader/asset-selector-multipliers";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { useDerivApiMultipliers, DerivApiProviderMultipliers } from "@/features/trading/hooks/use-deriv-api-multipliers";
import { Skeleton } from "@/components/ui/skeleton";
import OperationsLogMultipliers from "@/features/trading/components/deriv-trader/operations-log-multipliers";
import { multipliersSchema, type MultipliersFormValues } from "@/features/trading/components/deriv-trader/deriv-trader-interface-multipliers.types";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiStatusIndicatorMultipliers } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorMultipliers";
// NEW IMPORTS
import { useMultipliersCouncil } from "@/features/trading/hooks/use-multipliers-council";
import { MultipliersAutopilotInterface } from "@/features/trading/components/deriv-trader/multipliers-autopilot-interface";
import { IndicatorPanel } from "@/features/trading/components/deriv-trader/indicator-panel";
import { calculateAllIndicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';
import type { CandleData, ChartData } from '@/lib/types';


const Header = () => {
    const { 
        accountType, setAccountType, accountBalance, clearActiveContracts, 
        operationsLog, isConnecting, isAssetsLoading, assetGroups, 
        activeSymbol, setActiveSymbol 
    } = useDerivApiMultipliers();

    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left">
                Deriv Multipliers
            </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                 <div className="flex justify-center">
                    <AssetSelectorMultipliers
                        selectedAsset={activeSymbol || ""} 
                        onAssetChange={(asset) => setActiveSymbol(asset)} 
                        assetGroups={assetGroups}
                        isAssetsLoading={isAssetsLoading}
                    />
                 </div>
                <div className="flex justify-center">
                    <ApiStatusIndicatorMultipliers />
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
                    {operationsLog.length > 0 && (
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={clearActiveContracts}>
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Limpar negociações</span>
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

const IsolatedMarketChart = () => {
    const { 
        activeSymbol, operationsLog, chartData, isChartLoading, chartError, 
        chartType, setChartType, timePeriod, setTimePeriod, tradeAnnotations
    } = useDerivApiMultipliers();

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

const isCandle = (d: ChartData): d is CandleData => d != null && 'close' in d;

const MultipliersTraderCore = () => {
    const { activeSymbol, operationsLog, sellContract, botCandleData, accountBalance, chartData, timePeriod } = useDerivApiMultipliers();
    const multipliersCouncil = useMultipliersCouncil(activeSymbol, botCandleData, accountBalance.balance);
    const latestDataPoint = chartData.length > 0 ? chartData[chartData.length - 1] : null;
    
    const uiIndicators = useMemo(() => {
        if (chartData.length < 2) return null;

        // If chartData is ticks, convert them to 1-tick candles for calculation.
        const candlesForIndicators: CandleData[] = chartData.map(d => {
            if (isCandle(d)) {
                return d;
            }
            // It's TickData, create a pseudo-candle
            return { epoch: d.epoch, open: d.price, high: d.price, low: d.price, close: d.price, volume: 1 };
        });

        return calculateAllIndicators(candlesForIndicators, initialCouncilStrategies, timePeriod, {duration: 15, unit: 's'});
    }, [chartData, timePeriod]);
    
    return (
        <div className="space-y-6 mt-6">
            {uiIndicators && <IndicatorPanel indicators={uiIndicators} latestDataPoint={latestDataPoint} />}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                    <DerivTraderInterfaceMultipliers symbol={activeSymbol || ""} />
                </div>
                <div className="space-y-6">
                    <MultipliersAutopilotInterface {...multipliersCouncil} />
                </div>
            </div>
             <OperationsLogMultipliers operations={operationsLog} sellContract={sellContract} />
        </div>
    );
};


const PageContent = () => {
    const form = useForm<MultipliersFormValues>({
        resolver: zodResolver(multipliersSchema),
        defaultValues: {
            stake: 1.0,
            multiplier: 50,
            cancellation: 'none',
            takeProfit: undefined,
            stopLoss: undefined,
        },
    });

    const { multiplierOptions } = useDerivApiMultipliers();

    useEffect(() => {
        if (multiplierOptions && multiplierOptions.length > 0) {
            const currentMultiplier = form.getValues('multiplier');
            if (!multiplierOptions.includes(currentMultiplier)) {
                form.setValue('multiplier', multiplierOptions[0]);
            }
        }
    }, [multiplierOptions, form]);

    return (
        <FormProvider {...form}>
            <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
                <Header />
                <IsolatedMarketChart />
                <MultipliersTraderCore />
            </div>
        </FormProvider>
    );
};

export default function DerivMultipliersPage() {
    return (
        <DerivApiProviderMultipliers>
            <PageContent />
        </DerivApiProviderMultipliers>
    );
}
