// src/app/deriv-trader/page.tsx
'use client';

import React from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import DerivTraderInterfaceV1 from "@/features/trading/components/deriv-trader/deriv-trader-interface-v1";
import { AssetSelectorV1 } from "@/features/trading/components/deriv-trader/asset-selector-v1";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { Button } from "@/components/ui/button";
import { Trash2, Bot, NotepadText, LayoutGrid, Trophy, Dna, CandlestickChart, Archive } from "lucide-react";
import { DerivApiProviderV1, useDerivApiV1 } from "@/features/trading/hooks/use-deriv-api-v1";
import { Skeleton } from "@/components/ui/skeleton";
import { OperationsLogV1 } from "@/features/trading/components/deriv-trader/operations-log-v1";
import { AIAnalysisInterfaceV1 } from "@/features/trading/components/deriv-trader/ai-analysis-interface-v1";
import { riseFallSchema, type RiseFallFormValues } from "@/features/trading/components/deriv-trader/deriv-trader-interface-v1.types";
import { CouncilAutopilotInterfaceV1 } from "@/features/trading/components/deriv-trader/council-autopilot-interface-v1";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useRobotCouncilV1 } from "@/features/trading/hooks/use-robot-council-v1";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AITradeSuggestionV1 } from "@/features/trading/components/deriv-trader/ai-trade-suggestion-v1";
import { IndicatorPanel } from "@/features/trading/components/deriv-trader/indicator-panel";
import { TradingDesk } from "@/features/trading/components/deriv-trader/trading-desk";
import { HallOfFame } from "@/features/trading/components/deriv-trader/hall-of-fame";
import { ApiStatusIndicatorLegacy } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorLegacy";
import { EvolutionLabV1 } from "@/features/trading/components/deriv-trader/evolution-lab-v1";
import TradingDecisionLogViewer from "@/components/deriv-trader/TradingDecisionLogViewer";
import { AssetIntelligenceCard } from "@/features/trading/components/deriv-trader/asset-intelligence-card";


function DerivTraderPageContent() {
    const {
        accountType, 
        setAccountType, 
        accountBalance, 
        clearActiveContracts, 
        operationsLog,
        isConnecting,
        isAssetsLoading,
        assetGroups,
        activeSymbol,
        setActiveSymbol,
        chartData,
        isChartLoading,
        chartError,
        chartType,
        setChartType,
        timePeriod,
        setTimePeriod,
        tradeAnnotations,
        priceTicks,
        sellContract,
    } = useDerivApiV1();
    
    const robotCouncil = useRobotCouncilV1(activeSymbol, priceTicks, chartData, 0); // dataVersion is 0 for v1
    const [desktopTab, setDesktopTab] = React.useState("log");


    const handleAssetChange = (asset: string) => {
        setActiveSymbol(asset);
    };

    return (
        <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left">
                    Deriv Trader V1
                </h1>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                    <div className="flex justify-center">
                        <AssetSelectorV1
                            selectedAsset={activeSymbol || ""} 
                            onAssetChange={handleAssetChange} 
                            assetGroups={assetGroups}
                            isAssetsLoading={isAssetsLoading}
                        />
                    </div>
                    <div className="flex justify-center">
                        <ApiStatusIndicatorLegacy />
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

             <>
                <div className="space-y-6">
                    {robotCouncil.indicators && <IndicatorPanel indicators={robotCouncil.indicators} latestDataPoint={chartData[chartData.length -1]} />}
                    
                    <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <div>
                            <CardTitle className="font-headline text-lg">
                                Gráfico ({activeSymbol})
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Desempenho em tempo real do ativo.
                            </CardDescription>
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
                </div>
                
                <div className="hidden lg:grid lg:grid-cols-3 gap-6 mt-6">
                        <div className="lg:col-span-2 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <DerivTraderInterfaceV1 symbol={activeSymbol || ""} />
                                <div className="space-y-6">
                                    <AITradeSuggestionV1
                                    councilDecision={robotCouncil.consensusDecision}
                                    consensusSum={robotCouncil.consensusSum}
                                    consensusThreshold={robotCouncil.consensusThreshold}
                                    supervisionStatus={robotCouncil.supervisionStatus}
                                    activeCommittee={robotCouncil.activeCommittee}
                                    isAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                                    />
                                    <AssetIntelligenceCard
                                        profile={robotCouncil.assetProfile}
                                        isLoading={robotCouncil.isAssetProfileLoading}
                                        onAnalyze={robotCouncil.analyzeAndSaveLearnings}
                                    />
                                </div>
                            </div>
                            <div className="mt-6">
                                <Tabs defaultValue={"log"} value={desktopTab} onValueChange={setDesktopTab}>
                                    <TabsList className="grid w-full grid-cols-5">
                                        <TabsTrigger value="log"><NotepadText className="w-4 h-4 mr-2"/>Registo</TabsTrigger>
                                        <TabsTrigger value="desk"><LayoutGrid className="w-4 h-4 mr-2"/>Arena</TabsTrigger>
                                        <TabsTrigger value="audit"><Archive className="w-4 h-4 mr-2"/>Auditoria</TabsTrigger>
                                        <TabsTrigger value="fame"><Trophy className="w-4 h-4 mr-2"/>Fama</TabsTrigger>
                                        <TabsTrigger value="evolution"><Dna className="w-4 h-4 mr-2"/>Evolução</TabsTrigger>
                                    </TabsList>
                                    <TabsContent value="log" className="mt-4">
                                        <OperationsLogV1 operations={operationsLog} sellContract={sellContract} priceTicks={priceTicks} />
                                    </TabsContent>
                                    <TabsContent value="desk" className="mt-4">
                                        <TradingDesk 
                                            isMeritocracyOn={robotCouncil.isMeritocracyOn}
                                            setIsMeritocracyOn={robotCouncil.setIsMeritocracyOn}
                                            isCouncilAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                                            robotPerformance={robotCouncil.robotPerformance}
                                            councilVotes={robotCouncil.councilVotes}
                                        />
                                    </TabsContent>
                                     <TabsContent value="audit" className="mt-4">
                                        <TradingDecisionLogViewer logs={robotCouncil.tradeDecisionLog || []} />
                                     </TabsContent>
                                    <TabsContent value="fame" className="mt-4">
                                        <HallOfFame />
                                    </TabsContent>
                                    <TabsContent value="evolution" className="mt-4">
                                        <EvolutionLabV1 history={robotCouncil.evolutionHistory} activeSymbol={activeSymbol} />
                                    </TabsContent>
                                </Tabs>
                            </div>
                        </div>
                        <div className="space-y-6">
                            <CouncilAutopilotInterfaceV1 {...robotCouncil} />
                            <AIAnalysisInterfaceV1 symbol={activeSymbol} />
                        </div>
                </div>

                <div className="lg:hidden mt-6 space-y-6">
                    <DerivTraderInterfaceV1 symbol={activeSymbol || ""} />
                    <AITradeSuggestionV1
                        councilDecision={robotCouncil.consensusDecision}
                        consensusSum={robotCouncil.consensusSum}
                        consensusThreshold={robotCouncil.consensusThreshold}
                        supervisionStatus={robotCouncil.supervisionStatus}
                        activeCommittee={robotCouncil.activeCommittee}
                        isAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                    />
                    <AssetIntelligenceCard
                        profile={robotCouncil.assetProfile}
                        isLoading={robotCouncil.isAssetProfileLoading}
                        onAnalyze={robotCouncil.analyzeAndSaveLearnings}
                    />
                    <CouncilAutopilotInterfaceV1 {...robotCouncil} />
                    <AIAnalysisInterfaceV1 symbol={activeSymbol} />
                    <OperationsLogV1 operations={operationsLog} sellContract={sellContract} priceTicks={priceTicks} />
                    <TradingDesk 
                        isMeritocracyOn={robotCouncil.isMeritocracyOn}
                        setIsMeritocracyOn={robotCouncil.setIsMeritocracyOn}
                        isCouncilAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                        robotPerformance={robotCouncil.robotPerformance}
                        councilVotes={robotCouncil.councilVotes}
                    />
                    <TradingDecisionLogViewer logs={robotCouncil.tradeDecisionLog || []} />
                    <HallOfFame />
                    <EvolutionLabV1 history={robotCouncil.evolutionHistory} activeSymbol={activeSymbol} />
                </div>
            </>

        </div>
    );
}


export default function DerivTraderPage() {
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
    <DerivApiProviderV1>
        <FormProvider {...form}>
            <DerivTraderPageContent />
        </FormProvider>
    </DerivApiProviderV1>
  );
}
