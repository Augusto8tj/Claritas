'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
    BrainCircuit, Zap, ShieldCheck, Terminal as TerminalIcon, 
    Timer, LineChart, PlayCircle, PauseCircle, Cpu, RefreshCw,
    Database, Activity, History, ArrowUpCircle, ArrowDownCircle,
    TestTube, Scale, Brain, Trash2
} from "lucide-react";
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 as AssetSelector } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { useAIQuantTerminalV3 } from "@/features/trading/hooks/use-ai-quant-terminal-v3";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

function TerminalV3Content() {
    const { 
        activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading, 
        chartData, isConnected, operationsLog, tradeAnnotations, priceTicks,
        isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod,
    } = useDerivApi();

    const v3 = useAIQuantTerminalV3(activeSymbol, priceTicks, chartData as any);
    const { lastDecision, reasoningLog, memoryBuffer, isAutoMode, isShadowMode, timeToNextAnalysis, analysisInterval, clearMemory } = v3;

    return (
        <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6 bg-background min-h-screen text-foreground">
            {/* HEADER */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
                <div className="flex items-center gap-3">
                    <div className="bg-purple-500/10 p-2 rounded-xl border border-purple-500/20 shadow-sm">
                        <TestTube className="h-8 w-8 text-purple-600 animate-pulse" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight font-headline text-purple-700">Quant Lab V3.0</h1>
                        <p className="text-muted-foreground text-sm font-mono">Parallel Council Edition (Fan-Out/Fan-In)</p>
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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* COLUNA ESQUERDA: CONTROLE DO CONSELHO */}
                <div className="space-y-6">
                    <Card className="border-purple-200 bg-purple-50/10 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-purple-600 flex items-center gap-2">
                                <Zap className="h-4 w-4" /> Cockpit do Laboratório
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                             <div className="flex items-center justify-between p-3 rounded-lg bg-card border shadow-sm">
                                <Label htmlFor="shadow-mode" className="flex flex-col gap-0.5">
                                    <span className="text-xs font-bold uppercase">Modo Sombra</span>
                                    <span className="text-[10px] text-muted-foreground">Simular execuções no background</span>
                                </Label>
                                <Switch id="shadow-mode" checked={isShadowMode} onCheckedChange={v3.toggleShadowMode} />
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>Próximo Ciclo de Consenso</span>
                                    <span className="font-mono">{timeToNextAnalysis}s</span>
                                </div>
                                <Progress value={(timeToNextAnalysis / analysisInterval) * 100} className="h-1" />
                            </div>

                            <Button 
                                onClick={v3.toggleAutoMode} 
                                className={cn("w-full h-12 font-bold shadow-md", isAutoMode ? "bg-destructive text-destructive-foreground" : "bg-purple-600 text-white hover:bg-purple-700")}
                            >
                                {isAutoMode ? <PauseCircle className="mr-2 h-5 w-5" /> : <PlayCircle className="mr-2 h-5 w-5" />}
                                {isAutoMode ? 'Pausar Automação' : 'Ativar Conselho V3'}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="shadow-sm border-purple-100">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <Database className="h-4 w-4" /> Memória Viva de Curto Prazo
                            </CardTitle>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6 text-muted-foreground hover:text-destructive" 
                                onClick={clearMemory}
                                title="Limpar Memória de V3"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="p-3 rounded-lg bg-green-50/50 border border-green-100 text-center">
                                    <span className="text-[10px] uppercase font-bold text-green-600 block mb-1">Wins Buffer</span>
                                    <p className="text-lg font-black text-green-700">{memoryBuffer.wins.length}/20</p>
                                </div>
                                <div className="p-3 rounded-lg bg-red-50/50 border border-red-100 text-center">
                                    <span className="text-[10px] uppercase font-bold text-red-600 block mb-1">Losses Buffer</span>
                                    <p className="text-lg font-black text-red-700">{memoryBuffer.losses.length}/20</p>
                                </div>
                            </div>
                            <p className="text-[10px] text-muted-foreground italic text-center leading-tight">
                                Dados isolados da V3 injetados via In-Context Learning para os agentes.
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* COLUNA CENTRAL: GRÁFICO E OPINIÕES */}
                <div className="space-y-6">
                    <Card className="min-h-[400px] shadow-sm">
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

                    {/* VOTOS DO CONSELHO PARALELO */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {['MOMENTUM', 'RISK_CRITIC', 'ARCHIVIST'].map((agentName) => {
                            const opinion = lastDecision?.opinions.find(o => o.agentName === agentName);
                            return (
                                <Card key={agentName} className={cn("border-l-4 shadow-sm", 
                                    opinion?.action === 'CALL' ? 'border-l-green-500' : 
                                    opinion?.action === 'PUT' ? 'border-l-red-500' : 'border-l-muted'
                                )}>
                                    <CardContent className="p-3">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-[9px] font-bold text-muted-foreground">{agentName}</span>
                                            {opinion?.vetoTriggered && <Badge variant="destructive" className="h-4 text-[8px] font-bold">VETO</Badge>}
                                        </div>
                                        <div className="text-xs font-bold">{opinion?.action || 'HOLD'}</div>
                                        <div className="text-[9px] text-muted-foreground line-clamp-2 mt-1">{opinion?.reasoning || 'Aguardando ciclo...'}</div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </div>

                {/* COLUNA DIREITA: VEREDITO E RACIOCÍNIO */}
                <div className="space-y-6">
                    <Card className="border-purple-600/30 shadow-md">
                        <CardHeader className="bg-purple-600/5 border-b py-3">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-purple-600" /> Chairman Veredict
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6 space-y-4">
                            {lastDecision ? (
                                <>
                                    <div className={cn(
                                        "p-4 rounded-xl text-center border shadow-inner transition-all",
                                        lastDecision.finalAction === 'CALL' ? "bg-green-50 border-green-200 text-green-700" :
                                        lastDecision.finalAction === 'PUT' ? "bg-red-50 border-red-200 text-red-700" : "bg-muted border-border"
                                    )}>
                                        <p className="text-[10px] uppercase font-bold mb-1 opacity-70">Consenso Final ({lastDecision.executedVia})</p>
                                        <p className="text-3xl font-black">{lastDecision.finalAction}</p>
                                        <p className="text-xs mt-2 font-mono font-bold">Confiança: {lastDecision.consensusConfidence}%</p>
                                    </div>
                                    <div className="bg-muted/30 p-3 rounded-lg border text-[11px] text-muted-foreground italic text-center">
                                        "{lastDecision.zenThought}"
                                    </div>
                                </>
                            ) : (
                                <div className="text-center py-10 opacity-30">
                                    <RefreshCw className="h-10 w-10 mx-auto mb-2 animate-spin" />
                                    <p className="text-xs font-mono uppercase tracking-widest">Sincronizando Conselho...</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="bg-muted/30 border-dashed font-mono shadow-inner border-purple-200">
                        <CardHeader className="py-2 px-4 border-b bg-card/50">
                            <CardTitle className="text-[10px] flex items-center gap-2 uppercase tracking-widest font-bold text-muted-foreground">
                                <TerminalIcon className="h-3 w-3" /> Reasoning Engine Log
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <ScrollArea className="h-64 p-4 text-[10px]">
                                {reasoningLog.length === 0 ? (
                                    <p className="animate-pulse text-muted-foreground italic">Aguardando auditoria do laboratório...</p>
                                ) : (
                                    reasoningLog.map((log, i) => (
                                        <div key={i} className="mb-1 border-l-2 border-purple-500/30 pl-2">
                                            <span className="opacity-50">[{log.time}]</span>{' '}
                                            <span className={cn(
                                                "font-medium",
                                                log.type === 'decision' ? "text-purple-600 font-bold" : 
                                                log.type === 'execution' ? "text-green-600 font-bold" : "text-muted-foreground"
                                            )}>{log.message}</span>
                                        </div>
                                    ))
                                )}
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

export default function AIQuantTerminalV3Page() {
    return (
        <DerivApiProvider>
            <TerminalV3Content />
        </DerivApiProvider>
    );
}
