'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
    BrainCircuit, Zap, ShieldCheck, Terminal as TerminalIcon, 
    Timer, LineChart, PlayCircle, 
    PauseCircle, Cpu, RefreshCw
} from "lucide-react";
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 as AssetSelector } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { useAIQuantTerminal } from "@/features/trading/hooks/use-ai-quant-terminal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useRobotCouncilV2 } from '@/features/trading/hooks/use-robot-council-v2';

function TerminalContent() {
    const { 
        activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading, 
        chartData, botCandleData, isConnected, operationsLog, tradeAnnotations, priceTicks,
        isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod, dataVersion
    } = useDerivApi();

    // O motor de IA utiliza botCandleData para garantir velas de 1m precisas para análise.
    const quant = useAIQuantTerminal(activeSymbol, priceTicks, botCandleData);

    // Calculamos os indicadores técnicos para exibição no gráfico
    const { indicators: councilIndicators } = useRobotCouncilV2(activeSymbol, [], botCandleData, dataVersion);

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

    return (
        <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6 bg-[#0B0E14] min-h-screen text-slate-200">
            {/* HEADER E SELECTOR */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/20 p-2 rounded-xl border border-primary/30">
                        <BrainCircuit className="h-8 w-8 text-primary animate-pulse" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight font-headline text-white">Terminal Quant Neuro-Adaptativo</h1>
                        <p className="text-slate-500 text-sm font-mono">Ollama CIO: {quant.config.model}</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                    <AssetSelector 
                        selectedAsset={activeSymbol || ''} 
                        onAssetChange={setActiveSymbol} 
                        assetGroups={assetGroups} 
                        isAssetsLoading={isAssetsLoading}
                    />
                    <ApiStatusIndicator />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* COLUNA ESQUERDA: COCKPIT DE COMANDO */}
                <div className="lg:col-span-1 space-y-6">
                    <Card className="bg-slate-900/50 border-slate-800">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                <Zap className="h-4 w-4 text-yellow-500" /> Status do Motor
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-3 rounded-lg bg-black/40 border border-slate-800">
                                <span className="text-xs">Modo Operacional</span>
                                <Badge className={cn(quant.isAutoMode ? "bg-green-600" : "bg-blue-600")}>
                                    {quant.isAutoMode ? 'AUTOPILOT' : 'SENTINELA'}
                                </Badge>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs text-slate-500">
                                    <span>Próxima Janela de Decisão</span>
                                    <span>{quant.timeToNextAnalysis}s</span>
                                </div>
                                <Progress value={(quant.timeToNextAnalysis / 120) * 100} className="h-1 bg-slate-800" />
                            </div>
                            <Button 
                                onClick={quant.toggleAutoMode} 
                                className={cn("w-full h-12 font-bold", quant.isAutoMode ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary/90")}
                            >
                                {quant.isAutoMode ? <PauseCircle className="mr-2 h-5 w-5" /> : <PlayCircle className="mr-2 h-5 w-5" />}
                                {quant.isAutoMode ? 'Pausar Automação' : 'Ativar Automação'}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="bg-slate-900/50 border-slate-800">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400">Performance Quant</CardTitle>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 gap-3">
                            <div className="p-3 rounded-lg bg-black/40 border border-slate-800 text-center">
                                <p className="text-[10px] text-slate-500 uppercase">Sessão P&L</p>
                                <p className={cn("text-lg font-bold", quant.sessionStats.pnl >= 0 ? "text-green-500" : "text-red-500")}>
                                    {formatCurrency(quant.sessionStats.pnl)}
                                </p>
                            </div>
                            <div className="p-3 rounded-lg bg-black/40 border border-slate-800 text-center">
                                <p className="text-[10px] text-slate-500 uppercase">Win Rate</p>
                                <p className="text-lg font-bold text-white">{quant.sessionStats.winRate.toFixed(1)}%</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* COLUNA CENTRAL: VISUALIZAÇÃO E DECISÃO */}
                <div className="lg:col-span-2 space-y-6">
                    <Card className="bg-slate-900/50 border-slate-800 min-h-[450px]">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-white flex items-center gap-2">
                                    <LineChart className="h-5 w-5 text-primary" /> Radar de Ativos
                                </CardTitle>
                                <CardDescription>Fluxo em tempo real processado para IA</CardDescription>
                            </div>
                            <Badge variant="outline" className="border-slate-700 text-slate-400">{timePeriod.toUpperCase()} Resolution</Badge>
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

                    {/* TERMINAL DE PENSAMENTO DA IA */}
                    <Card className="bg-[#05070A] border-slate-800 font-mono overflow-hidden">
                        <div className="bg-slate-900/80 px-4 py-2 flex items-center justify-between border-b border-slate-800">
                            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-2">
                                <TerminalIcon className="h-3 w-3" /> NEURO-REASONING LOG
                            </span>
                            <div className="flex gap-2">
                                <div className="h-2 w-2 rounded-full bg-red-500/50" />
                                <div className="h-2 w-2 rounded-full bg-yellow-500/50" />
                                <div className="h-2 w-2 rounded-full bg-green-500/50" />
                            </div>
                        </div>
                        <CardContent className="p-0">
                            <ScrollArea className="h-64 p-4 text-xs leading-relaxed text-blue-400/80">
                                {quant.reasoningLog.length === 0 ? (
                                    <p className="animate-pulse">Aguardando próximo ciclo de inferência...</p>
                                ) : (
                                    quant.reasoningLog.map((log, i) => (
                                        <div key={i} className="mb-2">
                                            <span className="text-slate-600">[{log.time}]</span>{' '}
                                            <span className={cn(
                                                log.type === 'decision' ? "text-primary font-bold" : 
                                                log.type === 'execution' ? "text-green-500" : 
                                                log.type === 'error' ? "text-red-500" : "text-slate-400"
                                            )}>
                                                {log.message}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>

                {/* COLUNA DIREITA: INTEGRIDADE E CONFIG */}
                <div className="lg:col-span-1 space-y-6">
                    <Card className="bg-slate-900/50 border-slate-800 border-l-4 border-l-primary">
                        <CardHeader>
                            <CardTitle className="text-sm flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-primary" /> Veredito Atual
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {quant.lastDecision ? (
                                <div className="space-y-4">
                                    <div className={cn(
                                        "p-4 rounded-xl text-center border",
                                        quant.lastDecision.action === 'RISE' ? "bg-green-500/10 border-green-500/20 text-green-500" :
                                        quant.lastDecision.action === 'FALL' ? "bg-red-500/10 border-red-500/20 text-red-500" :
                                        "bg-slate-800 border-slate-700 text-slate-400"
                                    )}>
                                        <p className="text-[10px] uppercase font-bold mb-1">Recomendação</p>
                                        <p className="text-3xl font-black">{quant.lastDecision.action}</p>
                                        <p className="text-xs mt-2 font-mono">Confiança: {quant.lastDecision.confidence}%</p>
                                    </div>
                                    <div className="text-[11px] text-slate-400 italic bg-black/20 p-3 rounded-lg border border-slate-800">
                                        "{quant.lastDecision.reasoning}"
                                    </div>
                                    {!quant.isAutoMode && quant.lastDecision.action !== 'HOLD' && (
                                        <Button 
                                            onClick={quant.executeManualDecision} 
                                            className="w-full bg-white text-black hover:bg-slate-200"
                                        >
                                            Autorizar Investimento
                                        </Button>
                                    )}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-slate-600">
                                    <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin opacity-20" />
                                    <p className="text-xs">Sincronizando com Ollama...</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="bg-slate-900/50 border-slate-800">
                        <CardHeader>
                            <CardTitle className="text-sm flex items-center gap-2">
                                <Cpu className="h-4 w-4 text-slate-500" /> Telemetria Local
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-xs">
                             <div className="flex justify-between">
                                <span className="text-slate-500">Latency (Decision):</span>
                                <span className="text-white font-mono">{quant.telemetry.latency}ms</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Tokens/Sec:</span>
                                <span className="text-white font-mono">{quant.telemetry.tps}</span>
                            </div>
                            <Separator className="bg-slate-800" />
                            <div className="space-y-2">
                                <p className="text-[10px] text-slate-500 uppercase font-bold">Convergência de Sinais</p>
                                <div className="grid grid-cols-3 gap-1">
                                    <Badge variant="outline" className="text-[9px] border-slate-700">GBM: OK</Badge>
                                    <Badge variant="outline" className="text-[9px] border-slate-700">HMM: OK</Badge>
                                    <Badge variant="outline" className="text-[9px] border-slate-700">V1: OK</Badge>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

export default function AIQuantTerminalPage() {
    return (
        <DerivApiProvider>
            <TerminalContent />
        </DerivApiProvider>
    );
}
