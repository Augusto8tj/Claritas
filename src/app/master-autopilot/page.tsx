// src/app/master-autopilot/page.tsx
'use client';

import React from "react";
import { DerivApiProviderV2, useDerivApiV2 } from "@/features/trading/hooks/use-deriv-api-v2";
import { DerivApiProviderAccumulators } from "@/features/trading/hooks/use-deriv-api-accumulators";
import { MasterAutopilotInterface } from "@/features/trading/components/master-autopilot/master-autopilot-interface";
import { AssetSelectorV2 } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";


function Header() {
    const { activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading } = useDerivApiV2();
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left">
                Central de Comando - Master Autopilot
            </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                 <div className="flex justify-center">
                    <AssetSelectorV2
                        selectedAsset={activeSymbol || ""} 
                        onAssetChange={(asset) => setActiveSymbol(asset)} 
                        assetGroups={assetGroups}
                        isAssetsLoading={isAssetsLoading}
                    />
                 </div>
                <div className="flex justify-center">
                    <ApiStatusIndicatorV2 />
                </div>
            </div>
        </div>
    );
};

function IsolatedMarketChart() {
    const { 
        activeSymbol, operationsLog, chartData, isChartLoading, chartError, 
        chartType, setChartType, timePeriod, setTimePeriod, tradeAnnotations
    } = useDerivApiV2();
    
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


function MasterAutopilotPageContent() {
    return (
        <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
            <Header />
            <p className="text-muted-foreground">
                Um painel unificado para gerir todos os ecossistemas de trading com base no motor preditivo de alta assertividade.
            </p>
            <IsolatedMarketChart />
            <MasterAutopilotInterface />
        </div>
    );
}

export default function MasterAutopilotPage() {
  return (
    <DerivApiProviderV2>
        <DerivApiProviderAccumulators>
            <MasterAutopilotPageContent />
        </DerivApiProviderAccumulators>
    </DerivApiProviderV2>
  );
}
