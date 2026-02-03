// src/app/deriv-trader-digits/page.tsx
'use client';

import React from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import DerivTraderInterfaceDigits from "@/features/trading/components/deriv-trader/deriv-trader-interface-digits";
import { AssetSelectorDigits } from "@/features/trading/components/deriv-trader/asset-selector-digits";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { Button } from "@/components/ui/button";
import { Trash2, Bot, NotepadText, LayoutGrid, Trophy, Dna, Swords, Archive, BrainCircuit, Brain, Briefcase } from "lucide-react";
import { DerivApiProviderDigits, useDerivApiDigits } from "@/features/trading/hooks/use-deriv-api-digits";
import { Skeleton } from "@/components/ui/skeleton";
import { OperationsLogDigits } from "@/features/trading/components/deriv-trader/operations-log-digits";
import { AIAnalysisInterfaceDigits } from "@/features/trading/components/deriv-trader/ai-analysis-interface-digits";
import { digitSchema, type DigitFormValues } from "@/features/trading/components/deriv-trader/deriv-trader-interface-digits.types";
import { CouncilAutopilotInterfaceDigits } from "@/features/trading/components/deriv-trader/council-autopilot-interface-digits";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useRobotCouncilDigits } from "@/features/trading/hooks/use-robot-council-digits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AITradeSuggestionDigits } from "@/features/trading/components/deriv-trader/ai-trade-suggestion-digits";
import { IndicatorPanel } from "@/features/trading/components/deriv-trader/indicator-panel";
import { TradingDeskDigits } from "@/features/trading/components/deriv-trader/trading-desk-digits";
import { HallOfFameDigits } from "@/features/trading/components/deriv-trader/hall-of-fame-digits";
import { ApiStatusIndicatorDigits } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorDigits";
import { EvolutionLabDigits } from "@/features/trading/components/deriv-trader/evolution-lab-digits";
import TradingDecisionLogViewer from "@/components/deriv-trader/TradingDecisionLogViewer";
import { AssetIntelligenceCard } from "@/features/trading/components/deriv-trader/asset-intelligence-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


function HeaderDigits() {
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
    } = useDerivApiDigits();
    
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left">
                Deriv Digits
            </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="flex justify-center">
                    <AssetSelectorDigits
                        selectedAsset={activeSymbol || ""} 
                        onAssetChange={(asset) => setActiveSymbol(asset)} 
                        assetGroups={assetGroups}
                        isAssetsLoading={isAssetsLoading}
                    />
                </div>
                <div className="flex justify-center">
                    <ApiStatusIndicatorDigits />
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
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={clearActiveContracts}>
                                        <Trash2 className="h-4 w-4" />
                                        <span className="sr-only">Limpar negociações</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Limpar log de negociações</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>
            </div>
        </div>
    );
};

function IsolatedMarketChartDigits() {
    const { 
        activeSymbol, operationsLog, chartData, isChartLoading, chartError, 
        chartType, setChartType, timePeriod, setTimePeriod, tradeAnnotations
    } = useDerivApiDigits();
    
    const { indicators: councilIndicators } = useRobotCouncilDigits(activeSymbol, [], chartData, 0);

    return (
        <>
            {councilIndicators && <IndicatorPanel indicators={councilIndicators} latestDataPoint={chartData[chartData.length -1]} />}
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
        </>
    );
};

function MainContentDigits() {
    const { activeSymbol, priceTicks, operationsLog, sellContract, chartData } = useDerivApiDigits();
    const robotCouncil = useRobotCouncilDigits(activeSymbol, priceTicks, chartData, 0);
    
    return (
        <div className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <DerivTraderInterfaceDigits symbol={activeSymbol || ""} />
               <AITradeSuggestionDigits
                    councilDecision={robotCouncil.consensusDecision}
                    consensusSum={robotCouncil.consensusSum}
                    consensusThreshold={robotCouncil.consensusThreshold}
                    supervisionStatus={robotCouncil.supervisionStatus}
                    activeCommittee={robotCouncil.activeCommittee}
                    isAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                />
            </div>
            <CouncilAutopilotInterfaceDigits {...robotCouncil} />
            <Tabs defaultValue="logs" className="w-full mt-6">
                 <TabsList className="grid w-full grid-cols-5">
                    <TabsTrigger value="logs"><NotepadText className="w-4 h-4 mr-2"/>Registo</TabsTrigger>
                    <TabsTrigger value="arena"><LayoutGrid className="w-4 h-4 mr-2"/>Arena</TabsTrigger>
                    <TabsTrigger value="analise"><BrainCircuit className="w-4 h-4 mr-2"/>Análise IA</TabsTrigger>
                    <TabsTrigger value="auditoria"><Archive className="w-4 h-4 mr-2"/>Auditoria</TabsTrigger>
                    <TabsTrigger value="evolucao"><Dna className="w-4 h-4 mr-2"/>Evolução</TabsTrigger>
                </TabsList>
                <TabsContent value="logs" className="mt-4"><OperationsLogDigits operations={operationsLog} sellContract={sellContract} priceTicks={priceTicks} /></TabsContent>
                <TabsContent value="arena" className="mt-4"><TradingDeskDigits {...robotCouncil} /></TabsContent>
                <TabsContent value="analise" className="mt-4"><AIAnalysisInterfaceDigits symbol={activeSymbol} /></TabsContent>
                <TabsContent value="auditoria" className="mt-4"><TradingDecisionLogViewer logs={robotCouncil.tradeDecisionLog || []} /></TabsContent>
                <TabsContent value="evolucao" className="mt-4"><EvolutionLabDigits history={robotCouncil.evolutionHistory} activeSymbol={activeSymbol} /></TabsContent>
            </Tabs>
        </div>
    );
};


function DerivTraderPageContentDigits() {
    return (
        <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
            <HeaderDigits />
            <IsolatedMarketChartDigits />
            <MainContentDigits />
        </div>
    );
}

export default function DerivTraderDigitsPage() {
  const form = useForm<DigitFormValues>({
    resolver: zodResolver(digitSchema),
    defaultValues: {
      stake: 0.35,
      duration: 5,
      duration_unit: "t",
      last_digit_prediction: 5,
      contract_type: 'DIGITMATCH',
    },
  });

  return (
    <DerivApiProviderDigits>
        <FormProvider {...form}>
            <DerivTraderPageContentDigits />
        </FormProvider>
    </DerivApiProviderDigits>
  );
}
