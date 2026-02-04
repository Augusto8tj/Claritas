// /src/app/deriv-trader-digits/page.tsx
'use client';

import React from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import DerivTraderInterfaceDigits from "@/features/trading/components/deriv-trader/deriv-trader-interface-digits";
import { AssetSelectorDigits } from "@/features/trading/components/deriv-trader/asset-selector-digits";
import { Skeleton } from "@/components/ui/skeleton";
import { DerivApiProviderDigits, useDerivApiDigits } from "@/features/trading/hooks/use-deriv-api-digits";
import { OperationsLogDigits } from "@/features/trading/components/deriv-trader/operations-log-digits";
import { digitSchema, type DigitFormValues } from "@/features/trading/components/deriv-trader/deriv-trader-interface-digits.types";
import { CouncilAutopilotInterfaceDigits } from "@/features/trading/components/deriv-trader/council-autopilot-interface-digits";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useRobotCouncilDigits } from "@/features/trading/hooks/use-robot-council-digits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TradingDeskDigits } from "@/features/trading/components/deriv-trader/trading-desk-digits";
import { EvolutionLabDigits } from "@/features/trading/components/deriv-trader/evolution-lab-digits";
import { AITradeSuggestionDigits } from "@/features/trading/components/deriv-trader/ai-trade-suggestion-digits";
import { ApiStatusIndicatorDigits } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorDigits";
import { DigitStatsChart } from "@/features/trading/components/deriv-trader/digit-stats-chart";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BrainCircuit, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";


function HeaderDigits() {
    const {
        accountType, 
        setAccountType, 
        accountBalance, 
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
                </div>
            </div>
        </div>
    );
};

function CurrentPriceDisplay() {
    const { priceTicks } = useDerivApiDigits();
    const lastTick = priceTicks.length > 0 ? priceTicks[priceTicks.length - 1] : null;
    const prevTick = priceTicks.length > 1 ? priceTicks[priceTicks.length - 2] : null;

    if (!lastTick) {
        return (
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="font-headline text-lg">Preço Atual</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-center h-32">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </CardContent>
            </Card>
        );
    }
    
    const change = prevTick ? lastTick.price - prevTick.price : 0;
    const isUp = change > 0;
    const isDown = change < 0;

    // Split the price to style the last digit differently
    const priceString = lastTick.price.toFixed(4); // Ensure consistent decimal places
    const lastDigit = priceString.slice(-1);
    const mainPart = priceString.slice(0, -1);

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="font-headline text-lg">Preço Atual</CardTitle>
                <CardDescription>O último preço recebido para o ativo selecionado.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex items-baseline justify-center gap-2">
                    <p className="text-5xl font-bold tracking-tighter text-foreground">{mainPart}</p>
                    <p className="text-6xl font-bold text-primary animate-pulse">{lastDigit}</p>
                </div>
                <div className={cn(
                    "flex items-center justify-center gap-1 text-sm font-semibold mt-1",
                    isUp && "text-green-600",
                    isDown && "text-red-600",
                    !isUp && !isDown && "text-muted-foreground"
                )}>
                    {isUp && <TrendingUp className="h-4 w-4" />}
                    {isDown && <TrendingDown className="h-4 w-4" />}
                    <span>{change.toFixed(4)}</span>
                </div>
            </CardContent>
        </Card>
    );
}

function DerivTraderPageContentDigits() {
    const { activeSymbol, priceTicks, operationsLog, sellContract } = useDerivApiDigits();
    const robotCouncil = useRobotCouncilDigits(activeSymbol, priceTicks);

    return (
        <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
            <HeaderDigits />
             <Alert className="bg-primary/5 border-primary/10">
                <BrainCircuit className="h-4 w-4 text-primary" />
                <AlertTitle className="text-primary font-headline">Foco em Índices Sintéticos</AlertTitle>
                <AlertDescription className="text-primary/90">
                    Esta plataforma foca-se nos Índices de Volatilidade (Sintéticos) porque a sua geração algorítmica constante permite uma análise estatística mais pura e previsível, livre de ruídos de eventos económicos externos.
                </AlertDescription>
            </Alert>
            
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-6">
                {/* --- Coluna da Esquerda (Controles) --- */}
                <div className="lg:col-span-2 space-y-6">
                    <CurrentPriceDisplay />
                    <DerivTraderInterfaceDigits symbol={activeSymbol || ""} />
                    <CouncilAutopilotInterfaceDigits {...robotCouncil} />
                </div>

                {/* --- Coluna da Direita (Dados e Logs) --- */}
                <div className="lg:col-span-3 space-y-6">
                    <DigitStatsChart priceTicks={priceTicks} />
                    <AITradeSuggestionDigits
                        digitStats={robotCouncil.digitStats}
                        isAutopilotOn={robotCouncil.isCouncilAutopilotOn}
                    />
                    <Tabs defaultValue="logs" className="w-full">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="logs">Registo</TabsTrigger>
                            <TabsTrigger value="arena">Arena</TabsTrigger>
                            <TabsTrigger value="evolucao">Evolução</TabsTrigger>
                        </TabsList>
                        <TabsContent value="logs" className="mt-4">
                            <OperationsLogDigits operations={operationsLog} sellContract={sellContract} priceTicks={priceTicks} />
                        </TabsContent>
                        <TabsContent value="arena" className="mt-4">
                            <TradingDeskDigits {...robotCouncil} />
                        </TabsContent>
                        <TabsContent value="evolucao" className="mt-4">
                            <EvolutionLabDigits history={robotCouncil.evolutionHistory} activeSymbol={activeSymbol} />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
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
