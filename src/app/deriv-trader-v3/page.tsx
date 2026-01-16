// /src/app/deriv-trader-v3/page.tsx
'use client';

import React from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import DerivTraderInterfaceV3 from "@/features/trading/components/deriv-trader/deriv-trader-interface-v3";
import { AssetSelectorV3 } from "@/features/trading/components/deriv-trader/asset-selector-v3";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { Button } from "@/components/ui/button";
import { Trash2, Dna, Archive, Bot, Swords, CandlestickChart, BrainCircuit } from "lucide-react";
import { useDerivApiV3, DerivApiProviderV3 } from "@/features/trading/hooks/use-deriv-api-v3";
import { Skeleton } from "@/components/ui/skeleton";
import OperationsLogV3 from "@/features/trading/components/deriv-trader/operations-log-v3";
import { riseFallSchema, type RiseFallFormValues } from "@/features/trading/components/deriv-trader/deriv-trader-interface-v3.types";
import { useRobotCouncilV3 } from "@/features/trading/hooks/use-robot-council-v3";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CouncilDashboardV3 } from '@/features/trading/components/deriv-trader/CouncilDashboardV3';
import { TradingDeskV2 } from "@/features/trading/components/deriv-trader/trading-desk-v2";
import EvolutionLabV3 from "@/features/trading/components/deriv-trader/evolution-lab-v3";
import { DebugCouncilViewV3 } from "@/features/trading/components/deriv-trader/DebugCouncilView-v3";
import TradingDecisionLogViewer from "@/components/deriv-trader/TradingDecisionLogViewer";
import { CouncilAutopilotInterfaceV3 } from "@/features/trading/components/deriv-trader/council-autopilot-interface-v3";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiStatusIndicatorV3 } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV3";

const Header = () => {
    const { 
        accountType, setAccountType, accountBalance, clearActiveContracts, 
        operationsLog, isConnecting, isAssetsLoading, assetGroups, 
        activeSymbol, setActiveSymbol 
    } = useDerivApiV3();

    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left">
                Deriv Trader 3.0 (IA Lab)
            </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                 <div className="flex justify-center">
                    <AssetSelectorV3
                        selectedAsset={activeSymbol || ""} 
                        onAssetChange={(asset) => setActiveSymbol(asset)} 
                        assetGroups={assetGroups}
                        isAssetsLoading={isAssetsLoading}
                    />
                 </div>
                <div className="flex justify-center">
                    <ApiStatusIndicatorV3 />
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
    } = useDerivApiV3();
    
    const { indicators: councilIndicators } = useRobotCouncilV3(activeSymbol, [], chartData, 0);

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
                    indicators={councilIndicators}
                    tradeAnnotations={tradeAnnotations}
                />
            </CardContent>
        </Card>
    );
};

const DerivTraderV3Core = () => {
    const { activeSymbol, priceTicks, dataVersion, operationsLog, sellContract } = useDerivApiV3();
    const robotCouncil = useRobotCouncilV3(activeSymbol, priceTicks, chartData, dataVersion);
    const [mobileTab, setMobileTab] = React.useState("negociar");
    const [desktopTab, setDesktopTab] = React.useState("arena");

    return (
        <div className="space-y-6 mt-6">
            {/* Mobile View */}
            <div className="lg:hidden">
                <Tabs value={mobileTab} onValueChange={setMobileTab}>
                    <TabsList className="grid w-full grid-cols-6">
                        <TabsTrigger value="negociar" aria-label="Negociar"><CandlestickChart className="h-4 w-4" /></TabsTrigger>
                        <TabsTrigger value="piloto" aria-label="Piloto IA"><Bot className="h-4 w-4" /></TabsTrigger>
                        <TabsTrigger value="arena" aria-label="Arena"><Swords className="h-4 w-4" /></TabsTrigger>
                        <TabsTrigger value="logs" aria-label="Logs"><Archive className="h-4 w-4" /></TabsTrigger>
                        <TabsTrigger value="debug" aria-label="Debug"><BrainCircuit className="h-4 w-4" /></TabsTrigger>
                        <TabsTrigger value="evolucao" aria-label="Evolução"><Dna className="h-4 w-4" /></TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="negociar" className="mt-4 space-y-6">
                        <DerivTraderInterfaceV3 symbol={activeSymbol || ""} />
                        <CouncilDashboardV3 councilState={robotCouncil} />
                    </TabsContent>
                    <TabsContent value="piloto" className="mt-4">
                        <CouncilAutopilotInterfaceV3 {...robotCouncil} />
                    </TabsContent>
                    <TabsContent value="arena" className="mt-4">
                        <TradingDeskV2 councilState={robotCouncil} />
                    </TabsContent>
                    <TabsContent value="logs" className="mt-4 space-y-6">
                        <OperationsLogV3 operations={operationsLog} sellContract={sellContract} />
                        <TradingDecisionLogViewer logs={robotCouncil.tradeDecisionLog} showFilters={false} />
                    </TabsContent>
                    <TabsContent value="debug" className="mt-4">
                        <DebugCouncilViewV3 councilState={robotCouncil} isCouncilAutopilotOn={robotCouncil.isCouncilAutopilotOn} />
                    </TabsContent>
                    <TabsContent value="evolucao" className="mt-4">
                        <EvolutionLabV3 {...robotCouncil} />
                    </TabsContent>
                </Tabs>
            </div>

            {/* Desktop View */}
            <div className="hidden lg:grid lg:grid-cols-3 gap-6">
                {/* Coluna 1: Negociação e Painel de Decisão */}
                 <div className="space-y-6">
                    <DerivTraderInterfaceV3 symbol={activeSymbol || ""} />
                    <CouncilDashboardV3 councilState={robotCouncil} />
                </div>
                
                {/* Coluna 2: Autopilot e Debug */}
                 <div className="space-y-6">
                    <CouncilAutopilotInterfaceV3 {...robotCouncil} />
                    <DebugCouncilViewV3 councilState={robotCouncil} isCouncilAutopilotOn={robotCouncil.isCouncilAutopilotOn} />
                </div>

                {/* Coluna 3: Logs, Arena e Evolução */}
                <div className="space-y-6">
                     <Tabs defaultValue="arena" className="h-full">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="arena">Arena</TabsTrigger>
                            <TabsTrigger value="operacoes">Operações</TabsTrigger>
                            <TabsTrigger value="evolucao">Evolução</TabsTrigger>
                        </TabsList>
                        <TabsContent value="arena" className="mt-4">
                            <TradingDeskV2 councilState={robotCouncil} />
                        </TabsContent>
                         <TabsContent value="operacoes" className="mt-4">
                            <OperationsLogV3 operations={operationsLog} sellContract={sellContract} />
                        </TabsContent>
                        <TabsContent value="evolucao" className="mt-4">
                            <EvolutionLabV3 {...robotCouncil} />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
};

const PageContent = () => {
    const form = useForm<RiseFallFormValues>({
        resolver: zodResolver(riseFallSchema),
        defaultValues: {
            stake: 1,
            duration: 28,
            duration_unit: "s",
            allowEquals: false,
        },
    });

    return (
        <FormProvider {...form}>
            <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
                <Header />
                <IsolatedMarketChart />
                <DerivTraderV3Core />
            </div>
        </FormProvider>
    );
};


export default function DerivTraderV3Page() {
    return (
        <DerivApiProviderV3>
            <PageContent />
        </DerivApiProviderV3>
    );
}
