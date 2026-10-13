'use client';

/**
 * @fileOverview CRYPTO LAB V4 - TERMINAL DE ALTA PERFORMANCE
 * Integração de Gravidade de Bitcoin e Radar Concorrente.
 */

import React from 'react';
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi } from "@/features/trading/hooks/use-deriv-api-v2";
import { useCryptoRadarV4 } from "@/features/trading/hooks/use-crypto-radar-v4";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radar, Zap, TrendingUp, TrendingDown, Info, BrainCircuit, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { ScrollArea } from "@/components/ui/scroll-area";

function CryptoLabContent() {
    const { activeSymbol, setActiveSymbol, chartData, priceTicks, operationsLog, tradeAnnotations, isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod } = useDerivApi();
    const v4 = useCryptoRadarV4(activeSymbol, priceTicks, chartData as any);

    return (
        <div className="flex-1 space-y-6 p-8 bg-background min-h-screen">
            {/* RADAR CRYPTO V4 */}
            <Card className="bg-orange-500/5 border-orange-500/20 shadow-sm overflow-hidden">
                <CardHeader className="py-3 px-6 bg-orange-500/10 border-b border-orange-500/20 flex flex-row items-center justify-between">
                    <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-orange-700">
                        <Radar className="h-4 w-4 animate-spin-slow" /> Crypto Lab V4: Bitcoin Gravity Radar
                    </CardTitle>
                    <Badge variant="outline" className="border-orange-500/30 text-orange-700 uppercase text-[9px]">Scan Concorrente Ativo</Badge>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {v4.watchedSymbols?.map((symbol) => {
                            const status = v4.radarStatus[symbol];
                            const gravity = status?.gravity;
                            return (
                                <div 
                                    key={symbol} 
                                    onClick={() => setActiveSymbol(symbol)}
                                    className={cn(
                                        "p-3 rounded-lg border transition-all cursor-pointer group",
                                        symbol === activeSymbol ? "bg-orange-600 border-orange-600 text-white shadow-md" : "bg-card border-border hover:border-orange-400"
                                    )}
                                >
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[10px] font-bold font-mono">{symbol}</span>
                                        {gravity?.isBtcExploding && <Zap className="h-3 w-3 text-yellow-400 fill-current animate-pulse" />}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-black">{status?.finalAction || 'SCAN'}</span>
                                        {gravity?.btcVector && (
                                            <Badge variant="outline" className="text-[8px] h-3.5 border-current px-1 font-bold">
                                                {gravity.btcVector}
                                            </Badge>
                                        )}
                                    </div>
                                    {gravity && (
                                        <div className="mt-2 pt-2 border-t border-current/10 text-[9px] opacity-70">
                                            <div className="flex justify-between">
                                                <span>Beta:</span>
                                                <span className="font-mono">{gravity.betaScore.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-3 space-y-6">
                    <Card>
                        <CardContent className="p-4">
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
                </div>

                <div className="lg:col-span-1 space-y-6">
                    <Card className="border-orange-600/30">
                        <CardHeader className="bg-orange-600/5 border-b py-3">
                             <CardTitle className="text-sm flex items-center gap-2 text-orange-600">
                                <BrainCircuit className="h-4 w-4" /> Veredito V4
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6">
                            {v4.lastDecision ? (
                                <div className="space-y-4">
                                    <div className="p-4 rounded-xl text-center bg-muted border font-bold text-2xl">
                                        {v4.lastDecision.finalAction}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground italic text-center">"{v4.lastDecision.zenThought}"</p>
                                </div>
                            ) : (
                                <div className="text-center py-10 opacity-30">
                                    <Activity className="h-8 w-8 mx-auto animate-pulse" />
                                    <p className="text-[10px] uppercase mt-2">Sincronizando Lab...</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

export default function CryptoLabV4Page() {
    return (
        <DerivApiProvider>
            <CryptoLabContent />
        </DerivApiProvider>
    );
}
