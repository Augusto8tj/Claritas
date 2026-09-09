'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { 
    BrainCircuit, Zap, ShieldCheck, Terminal as TerminalIcon, 
    Timer, LineChart, PlayCircle, 
    PauseCircle, Cpu, RefreshCw, MessageSquare, Send, 
    Settings2, Activity, Brain
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

    const quant = useAIQuantTerminal(activeSymbol, priceTicks, botCandleData);
    const { indicators: councilIndicators } = useRobotCouncilV2(activeSymbol, [], botCandleData, dataVersion);
    
    const [chatInput, setChatInput] = useState('');
    const chatScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [quant.chatMessages]);

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

    const handleChatSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (chatInput.trim()) {
            quant.sendMessage(chatInput);
            setChatInput('');
        }
    };

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
                            
                            {/* AJUSTE DINÂMICO DE TEMPO */}
                            <div className="space-y-3 p-3 rounded-lg border border-slate-800 bg-black/20">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-slate-400 flex items-center gap-1.5"><Timer className="h-3.5 w-3.5"/> Ciclo de Análise</span>
                                    <span className="font-mono text-primary font-bold">{quant.analysisInterval}s</span>
                                </div>
                                <Slider 
                                    value={[quant.analysisInterval]} 
                                    min={30} 
                                    max={600} 
                                    step={30} 
                                    onValueChange={(v) => quant.setAnalysisInterval(v[0])}
                                    disabled={quant.isAutoMode}
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between text-xs text-slate-500">
                                    <span>Próxima Janela de Decisão</span>
                                    <span>{quant.timeToNextAnalysis}s</span>
                                </div>
                                <Progress value={(quant.timeToNextAnalysis / quant.analysisInterval) * 100} className="h-1 bg-slate-800" />
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

                    {/* INTERAÇÃO COM O CIO (CHAT) */}
                    <Card className="bg-[#0D1117] border-slate-800 h-[400px] flex flex-col">
                        <CardHeader className="py-3 border-b border-slate-800">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <MessageSquare className="h-4 w-4 text-primary" />
                                Interface de Diálogo com o CIO
                            </CardTitle>
                            <CardDescription className="text-[10px]">Consulte o modelo local sobre a estratégia atual.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-hidden p-0 relative">
                            <ScrollArea className="h-full p-4">
                                <div className="space-y-4">
                                    {quant.chatMessages.length === 0 && (
                                        <div className="text-center py-10 opacity-30">
                                            <Brain className="h-10 w-10 mx-auto mb-2"/>
                                            <p className="text-xs font-mono">Aguardando seu comando estratégico...</p>
                                        </div>
                                    )}
                                    {quant.chatMessages.map((msg, i) => (
                                        <div key={i} className={cn(
                                            "flex flex-col max-w-[85%] rounded-lg p-3 text-xs leading-relaxed",
                                            msg.role === 'user' ? "bg-primary/20 ml-auto border border-primary/20" : "bg-slate-800 mr-auto border border-slate-700"
                                        )}>
                                            <span className="font-bold uppercase text-[9px] mb-1 opacity-50">
                                                {msg.role === 'user' ? 'OPERADOR' : 'CIO'} • {msg.time}
                                            </span>
                                            <p className="font-mono">{msg.content}</p>
                                        </div>
                                    ))}
                                    {quant.isChatLoading && (
                                        <div className="flex items-center gap-2 text-xs text-primary animate-pulse font-mono">
                                            <RefreshCw className="h-3 w-3 animate-spin"/> O CIO está processando a resposta...
                                        </div>
                                    )}
                                    <div ref={chatScrollRef} />
                                </div>
                            </ScrollArea>
                        </CardContent>
                        <CardFooter className="p-3 border-t border-slate-800">
                            <form onSubmit={handleChatSubmit} className="flex w-full gap-2">
                                <Input 
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                    placeholder="Pergunte ao CIO..."
                                    className="bg-black/40 border-slate-800 h-9 text-xs"
                                    disabled={quant.isChatLoading}
                                />
                                <Button type="submit" size="icon" className="h-9 w-9" disabled={quant.isChatLoading || !chatInput.trim()}>
                                    <Send className="h-4 w-4" />
                                </Button>
                            </form>
                        </CardFooter>
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
                    
                    {/* LOG DE RACIOCÍNIO - AGORA NO FINAL DA COLUNA */}
                    <Card className="bg-[#05070A] border-slate-800 font-mono overflow-hidden">
                        <div className="bg-slate-900/80 px-4 py-2 flex items-center justify-between border-b border-slate-800">
                            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-2">
                                <TerminalIcon className="h-3 w-3" /> REASONING LOG
                            </span>
                        </div>
                        <CardContent className="p-0">
                            <ScrollArea className="h-48 p-4 text-[10px] leading-relaxed text-blue-400/80">
                                {quant.reasoningLog.length === 0 ? (
                                    <p className="animate-pulse">Aguardando auditoria...</p>
                                ) : (
                                    quant.reasoningLog.map((log, i) => (
                                        <div key={i} className="mb-1">
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
