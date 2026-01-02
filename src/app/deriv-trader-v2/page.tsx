'use client';

import React from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import DerivTraderInterfaceV2 from "@/features/trading/components/deriv-trader/deriv-trader-interface-v2";
import { AssetSelector } from "@/features/trading/components/deriv-trader/asset-selector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { useDerivApi } from "@/features/trading/hooks/use-deriv-api";
import { Skeleton } from "@/components/ui/skeleton";
import { OperationsLog } from "@/features/trading/components/deriv-trader/operations-log";
import { AIAnalysisInterface } from "@/features/trading/components/deriv-trader/ai-analysis-interface";
import { riseFallSchema, type RiseFallFormValues } from "@/features/trading/components/deriv-trader/deriv-trader-interface.types";
import { CouncilAutopilotInterfaceV2 } from "@/features/trading/components/deriv-trader/council-autopilot-interface-v2";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTradeAnalysis } from "@/features/trading/hooks/use-trade-analysis";
import { useRobotCouncilV2 } from "@/features/trading/hooks/use-robot-council-v2";
import { SystemStatusSummary } from "@/features/trading/components/deriv-trader/system-status-summary";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AITradeSuggestion } from "@/features/trading/components/deriv-trader/ai-trade-suggestion";
import { CouncilDashboard } from '@/features/trading/components/deriv-trader/CouncilDashboard';
import { TradingDeskV2 } from "@/features/trading/components/deriv-trader/trading-desk-v2";
import { TradingDecisionLogViewer } from "@/features/trading/components/deriv-trader/TradingDecisionLogViewer";


// --- Sub-componentes para melhor organização ---

const Header = () => {
    const { 
        accountType, setAccountType, accountBalance, clearActiveContracts, 
        operationsLog, isConnecting, isAssetsLoading, assetGroups, 
        activeSymbol, setActiveSymbol 
    } = useDerivApi();

    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
                <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0">
                    Deriv Trader 2.0
                </h1>
                <AssetSelector 
                    selectedAsset={activeSymbol || ""} 
                    onAssetChange={(asset) => setActiveSymbol(asset)} 
                    assetGroups={assetGroups}
                    isAssetsLoading={isAssetsLoading}
                />
            </div>
            <div className="flex items-center justify-end gap-4">
                <ToggleGroup type="single" value={accountType} onValueChange={(value: any) => value && setAccountType(value)} defaultValue="demo" aria-label="Tipo de Conta">
                    <ToggleGroupItem value="demo" aria-label="Usar conta demo">Demo</ToggleGroupItem>
                    <ToggleGroupItem value="real" aria-label="Usar conta real">Real</ToggleGroupItem>
                </ToggleGroup>
                <div className="text-right h-6 w-40">
                    {accountBalance.loading || isConnecting ? (
                        <Skeleton className="h-5 w-full" />
                    ) : accountBalance.balance !== null ? (
                        <p className="text-sm font-medium text-muted-foreground truncate">
                            Saldo: <span className="font-bold text-foreground">{new Intl.NumberFormat('en-US', { style: 'currency', currency: accountBalance.currency || 'USD' }).format(accountBalance.balance)}</span>
                        </p>
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
    );
};

const MainDashboard = ({ robotCouncil }: { robotCouncil: ReturnType<typeof useRobotCouncilV2> }) => {
    const { 
        operationsLog, chartData, isChartLoading, chartError, 
        chartType, setChartType, timePeriod, setTimePeriod, activeSymbol, tradeAnnotations
    } = useDerivApi();
    
    return (
        <div className="space-y-6">
             {robotCouncil.isCouncilAutopilotOn && robotCouncil.dashboardData && (
                <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                    <CouncilDashboard data={robotCouncil.dashboardData} />
                </div>
            )}
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
                        indicators={robotCouncil.indicators}
                        tradeAnnotations={tradeAnnotations}
                    />
                </CardContent>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <DerivTraderInterfaceV2 symbol={activeSymbol || ""} />
                <AITradeSuggestion 
                    councilDecision={robotCouncil.consensusDecision.direction}
                    consensusSum={{rise: robotCouncil.consensusDecision.probability, fall: 1 - robotCouncil.consensusDecision.probability}} 
                    consensusThreshold={0.65} // Limiar Bayesiano Fixo
                    supervisionStatus={{status: 'approved', message: `Probabilidade Bayesiana: ${(robotCouncil.consensusDecision.probability * 100).toFixed(1)}%`}}
                    activeCommittee={robotCouncil.currentRegime.regime}
                    isAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                />
            </div>
        </div>
    );
};

const SidePanel = ({ robotCouncil }: { robotCouncil: ReturnType<typeof useRobotCouncilV2> }) => {
    const { activeSymbol, operationsLog } = useDerivApi();
    const tradeAnalysis = useTradeAnalysis(activeSymbol, operationsLog);

    return (
        <div className="space-y-6">
            <CouncilAutopilotInterfaceV2 {...robotCouncil} />
            <Tabs defaultValue="desk">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="desk">Arena V2</TabsTrigger>
                    <TabsTrigger value="log">Operações</TabsTrigger>
                    <TabsTrigger value="analysis">Análise IA</TabsTrigger>
                    <TabsTrigger value="audit">Auditoria</TabsTrigger>
                </TabsList>
                <TabsContent value="desk" className="mt-4">
                    <TradingDeskV2 
                        robotPerformance={robotCouncil.robotPerformance}
                        isCouncilAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                        resetArenaPerformance={robotCouncil.resetArenaPerformance}
                    />
                </TabsContent>
                <TabsContent value="log" className="mt-4">
                    <OperationsLog operations={operationsLog} />
                </TabsContent>
                <TabsContent value="analysis" className="mt-4">
                    <AIAnalysisInterface symbol={activeSymbol}/>
                </TabsContent>
                <TabsContent value="audit" className="mt-4">
                   <TradingDecisionLogViewer logs={robotCouncil.tradeDecisionLog} />
                </TabsContent>
            </Tabs>
        </div>
    );
};

// --- Componente Principal da Página ---
const DerivTraderV2Core = () => {
    const { activeSymbol, priceTicks, dataVersion } = useDerivApi();
    const robotCouncil = useRobotCouncilV2(activeSymbol, priceTicks, dataVersion);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
            <div className="lg:col-span-2 space-y-6">
                <MainDashboard robotCouncil={robotCouncil} />
            </div>
            <div className="space-y-6">
                <SidePanel robotCouncil={robotCouncil} />
            </div>
        </div>
    );
};

export default function DerivTraderV2Page() {
    const form = useForm<RiseFallFormValues>({
        resolver: zodResolver(riseFallSchema),
        defaultValues: {
            stake: 1,
            duration: 5,
            duration_unit: "t",
            allowEquals: false,
        },
    });

    return (
        <FormProvider {...form}>
            <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
                <Header />
                <SystemStatusSummary />
                <DerivTraderV2Core />
            </div>
        </FormProvider>
    );
}
