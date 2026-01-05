// /src/app/deriv-trader-v2/page.tsx
'use client';

import React from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import DerivTraderInterface from "@/features/trading/components/deriv-trader/deriv-trader-interface-v2";
import { AssetSelector } from "@/features/trading/components/deriv-trader/asset-selector";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { Button } from "@/components/ui/button";
import { Trash2, Dna, Archive, Brain } from "lucide-react";
import { useDerivApi } from "@/features/trading/hooks/use-deriv-api";
import { Skeleton } from "@/components/ui/skeleton";
import { OperationsLog } from "@/features/trading/components/deriv-trader/operations-log";
import { riseFallSchema, type RiseFallFormValues } from "@/lib/types";
import { CouncilAutopilotInterfaceV2 } from "@/features/trading/components/deriv-trader/council-autopilot-interface-v2";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useRobotCouncilV2 } from "@/features/trading/hooks/use-robot-council-v2";
import { SystemStatusSummary } from "@/features/trading/components/deriv-trader/system-status-summary";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CouncilDashboardV2 } from '@/features/trading/components/deriv-trader/CouncilDashboardV2';
import { TradingDeskV2 } from "@/features/trading/components/deriv-trader/trading-desk-v2";
import { EvolutionLab } from "@/features/trading/components/deriv-trader/evolution-lab";
import { DebugCouncilView } from "@/features/trading/components/deriv-trader/DebugCouncilView";
import TradingDecisionLogViewer from "@/components/deriv-trader/TradingDecisionLogViewer";

// ============================================================================
// COMPONENTES REORGANIZADOS PARA PERFORMANCE
// ============================================================================

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
                    Deriv Trader 2.5
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

const IsolatedMarketChart = () => {
    const { 
        activeSymbol, operationsLog, chartData, isChartLoading, chartError, 
        chartType, setChartType, timePeriod, setTimePeriod, tradeAnnotations,
        indicators // Supondo que indicators venha do useDerivApi ou de um hook separado. Se vem do council, precisa de refatoração.
    } = useDerivApi();

    // NOTA: Para uma otimização completa, os 'indicators' deveriam vir de um hook que não re-renderiza com o `useRobotCouncilV2`
    // Por agora, vamos assumir que `useDerivApi` os providencia ou que o impacto é menor.
    // Se `indicators` vier do `useRobotCouncilV2`, ele deve ser passado como prop aqui.
    // Para esta correção, vamos assumir que está no `useDerivApi` ou é nulo.
    const { indicators: councilIndicators } = useRobotCouncilV2(activeSymbol, [], 0); // Passamos dados vazios para não recalcular

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
                    indicators={councilIndicators} // Usamos os indicadores do conselho aqui
                    tradeAnnotations={tradeAnnotations}
                />
            </CardContent>
        </Card>
    );
};

const DerivTraderV2Core = () => {
    const { activeSymbol, priceTicks, dataVersion, operationsLog } = useDerivApi();
    const robotCouncil = useRobotCouncilV2(activeSymbol, priceTicks, dataVersion);
    const [activeTab, setActiveTab] = React.useState("desk");
    
    return (
        <div className="space-y-6 mt-6">
            <IsolatedMarketChart />
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-6">
                    <DerivTraderInterface symbol={activeSymbol || ""} />
                     <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                        <CouncilDashboardV2
                            consensusDecision={robotCouncil.consensusDecision}
                            supervisionStatus={robotCouncil.supervisionStatus}
                            activeCommittee={robotCouncil.currentRegime.regime}
                            isCouncilAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                        />
                    </div>
                     <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                        <DebugCouncilView 
                            votes={robotCouncil.bayesianVotes}
                            regime={robotCouncil.currentRegime}
                            isCouncilAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                            systemMetrics={robotCouncil.systemMetrics}
                            robotPerformance={robotCouncil.robotPerformance}
                        />
                    </div>
                </div>
                <CouncilAutopilotInterfaceV2 {...robotCouncil} />
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="desk">Arena V2</TabsTrigger>
                    <TabsTrigger value="log">Operações</TabsTrigger>
                    <TabsTrigger value="audit">Auditoria</TabsTrigger>
                    <TabsTrigger value="evolution">Evolução</TabsTrigger>
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
                <TabsContent value="audit" className="mt-4">
                    <TradingDecisionLogViewer logs={robotCouncil.tradeDecisionLog} showFilters={false} />
                </TabsContent>
                <TabsContent value="evolution" className="mt-4">
                    <EvolutionLab history={robotCouncil.evolutionHistory} />
                </TabsContent>
            </Tabs>
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
