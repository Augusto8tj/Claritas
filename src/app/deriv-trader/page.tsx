// /src/app/deriv-trader/page.tsx
'use client';

import React, { useState, useEffect } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import DerivTraderInterface from "@/components/deriv-trader/deriv-trader-interface";
import { AssetSelector } from "@/components/deriv-trader/asset-selector";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketChart } from "@/components/deriv-trader/market-chart";
import { Button } from "@/components/ui/button";
import { Trash2, Bot, NotepadText, LayoutGrid, Trophy, Dna } from "lucide-react";
import { useDerivApi } from "@/hooks/use-deriv-api";
import { Skeleton } from "@/components/ui/skeleton";
import { OperationsLog } from "@/components/deriv-trader/operations-log";
import { AIAnalysisInterface } from "@/components/deriv-trader/ai-analysis-interface";
import { riseFallSchema, type RiseFallFormValues } from "@/components/deriv-trader/deriv-trader-interface.types";
import { CouncilAutopilotInterface } from "@/components/deriv-trader/council-autopilot-interface";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTradeAnalysis } from "@/hooks/use-trade-analysis";
import { useRobotCouncil } from "@/hooks/use-robot-council";
import { SystemStatusSummary } from "@/components/deriv-trader/system-status-summary";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AITradeSuggestion } from "@/components/deriv-trader/ai-trade-suggestion";
import { IndicatorPanel } from "@/components/deriv-trader/indicator-panel";
import { TradingDesk } from "@/components/deriv-trader/trading-desk";
import { HallOfFame } from "@/components/deriv-trader/hall-of-fame";
import { EvolutionLab } from "@/components/deriv-trader/evolution-lab";
import { CouncilDashboard } from "@/components/deriv-trader/CouncilDashboard";


/**
 * This core component is now separate to ensure that all hooks using
 * `useFormContext` are called within the <FormProvider> of the parent page.
 */
function DerivTraderCore({ activeSymbol }: { activeSymbol: string | null }) {
  const { 
    operationsLog,
    chartData,
    priceTicks, // Get price ticks here
    isChartLoading,
    chartError,
    chartType,
    setChartType,
    timePeriod,
    setTimePeriod,
    tradeAnnotations,
  } = useDerivApi();
  
  // CENTRALIZED HOOKS - Pass priceTicks to robotCouncil
  const robotCouncil = useRobotCouncil(activeSymbol, priceTicks);
  const tradeAnalysis = useTradeAnalysis(activeSymbol, operationsLog);

  const [activeTab, setActiveTab] = useState("log");

  useEffect(() => {
    // Automatically switch to the Arena Virtual tab when the council is activated
    if (robotCouncil.isCouncilAutopilotOn) {
      setActiveTab("desk");
    }
  }, [robotCouncil.isCouncilAutopilotOn]);


  const latestDataPoint = chartData.length > 0 ? chartData[chartData.length - 1] : null;

  return (
    <>
      <CouncilDashboard data={robotCouncil.dashboardData} />
      <div className="space-y-6">
        <IndicatorPanel indicators={robotCouncil.indicators} latestDataPoint={latestDataPoint} />
        
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
      
       {/* Layout para telas maiores */}
       <div className="hidden lg:grid lg:grid-cols-3 gap-6 mt-6">
            <div className="lg:col-span-2 space-y-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <DerivTraderInterface symbol={activeSymbol || ""} />
                     <div className="space-y-6">
                        <AITradeSuggestion 
                          councilDecision={robotCouncil.consensusDecision}
                          consensusSum={robotCouncil.consensusSum}
                          consensusThreshold={robotCouncil.consensusThreshold}
                          supervisionStatus={robotCouncil.supervisionStatus}
                          activeCommittee={robotCouncil.activeCommittee}
                          isAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                        />
                    </div>
                </div>
                 <div className="mt-6">
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                        <TabsList className="grid w-full grid-cols-5">
                            <TabsTrigger value="log">Registo de Operações</TabsTrigger>
                            <TabsTrigger value="desk">Arena Virtual</TabsTrigger>
                            <TabsTrigger value="fame">Hall da Fama</TabsTrigger>
                            <TabsTrigger value="evolution">Evolução</TabsTrigger>
                            <TabsTrigger value="analysis">Análise com IA</TabsTrigger>
                        </TabsList>
                        <TabsContent value="log" className="mt-4">
                            <OperationsLog operations={operationsLog} />
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
                        <TabsContent value="fame" className="mt-4">
                            <HallOfFame />
                        </TabsContent>
                         <TabsContent value="evolution" className="mt-4">
                            <EvolutionLab history={robotCouncil.evolutionHistory} />
                        </TabsContent>
                         <TabsContent value="analysis" className="mt-4">
                             <AIAnalysisInterface analyzeSessionPerformance={tradeAnalysis.analyzeSessionPerformance} />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
             <div className="space-y-6">
                <CouncilAutopilotInterface {...robotCouncil} />
            </div>
       </div>

       {/* Layout com Abas para telas pequenas */}
       <div className="lg:hidden mt-6">
           <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-6">
                    <TabsTrigger value="trade">Negociar</TabsTrigger>
                    <TabsTrigger value="autopilot"><Bot className="w-4 h-4"/></TabsTrigger>
                    <TabsTrigger value="desk"><LayoutGrid className="w-4 h-4"/></TabsTrigger>
                    <TabsTrigger value="fame"><Trophy className="w-4 h-4"/></TabsTrigger>
                    <TabsTrigger value="evolution"><Dna className="w-4 h-4"/></TabsTrigger>
                    <TabsTrigger value="log"><NotepadText className="w-4 h-4"/></TabsTrigger>
                </TabsList>

                <TabsContent value="trade" className="mt-4 space-y-6">
                    <DerivTraderInterface symbol={activeSymbol || ""} />
                    <AITradeSuggestion 
                      councilDecision={robotCouncil.consensusDecision}
                      consensusSum={robotCouncil.consensusSum}
                      consensusThreshold={robotCouncil.consensusThreshold}
                      supervisionStatus={robotCouncil.supervisionStatus}
                      activeCommittee={robotCouncil.activeCommittee}
                      isAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                    />
                </TabsContent>

                <TabsContent value="autopilot" className="mt-4 space-y-6">
                    <CouncilAutopilotInterface {...robotCouncil} />
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
                
                 <TabsContent value="fame" className="mt-4">
                    <HallOfFame />
                </TabsContent>

                 <TabsContent value="evolution" className="mt-4">
                    <EvolutionLab history={robotCouncil.evolutionHistory} />
                </TabsContent>

                 <TabsContent value="log" className="mt-4 space-y-6">
                    <OperationsLog operations={operationsLog} />
                    <AIAnalysisInterface analyzeSessionPerformance={tradeAnalysis.analyzeSessionPerformance} />
                </TabsContent>
           </Tabs>
       </div>
    </>
  );
}


export default function DerivTraderPage() {
  const form = useForm<RiseFallFormValues>({
    resolver: zodResolver(riseFallSchema),
    defaultValues: {
      stake: 1,
      duration: 25,
      duration_unit: "s",
      allowEquals: false,
    },
  });

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
  } = useDerivApi();
  
  const handleAssetChange = (asset: string) => {
    setActiveSymbol(asset);
  };

  return (
    <FormProvider {...form}>
      <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1">
              <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0">
                Deriv Trader
              </h1>
              <AssetSelector 
                selectedAsset={activeSymbol || ""} 
                onAssetChange={handleAssetChange} 
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

        <SystemStatusSummary />

        <DerivTraderCore activeSymbol={activeSymbol} />
      </div>
    </FormProvider>
  );
}
