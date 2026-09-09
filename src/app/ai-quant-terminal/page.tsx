'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { 
    BrainCircuit, Zap, ShieldCheck, Terminal as TerminalIcon, 
    Timer, LineChart, PlayCircle, 
    PauseCircle, Cpu, RefreshCw, MessageSquare, Send, 
    Settings2, Activity, Brain, Wallet, Target, History,
    ArrowUpCircle, ArrowDownCircle, Clock, ShieldAlert,
    TrendingUp, BarChart3, Binary, Trash2
} from "lucide-react";
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 as AssetSelector } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { useAIQuantTerminal, type StrategicProfile } from "@/features/trading/hooks/use-ai-quant-terminal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useRobotCouncilV2 } from '@/features/trading/hooks/use-robot-council-v2';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

function TerminalContent() {
    const { 
        activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading, 
        chartData, botCandleData, isConnected, operationsLog, tradeAnnotations, priceTicks,
        isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod, dataVersion,
        clearActiveContracts
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

    const terminalTrades = operationsLog.filter(op => op.initiator === 'Conselho');

    const getDurationLabel = (unit: string) => {
        const labels: Record<string, string> = {
            t: 'Ticks',
            s: 'Segundos',
            m: 'Minutos',
            h: 'Horas'
        };
        return labels[unit] || unit;
    };

    return (
        <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6 bg-background min-h-screen text-foreground transition-colors duration-300">
            {/* HEADER E SELECTOR */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-2 rounded-xl border border-primary/20 shadow-sm">
                        <BrainCircuit className="h-8 w-8 text-primary animate-pulse" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight font-headline">Terminal Quant Neuro-Adaptativo</h1>
                        <p className="text-muted-foreground text-sm font-mono">Ollama CIO: {quant.config.model}</p>
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
                    <Card className="bg-card/50 border-border shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <Zap className="h-4 w-4 text-yellow-500" /> Cockpit do Piloto
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
                                <span className="text-xs font-medium">Estado do Sistema</span>
                                <Badge className={cn("font-bold", quant.isAutoMode ? "bg-green-600 hover:bg-green-600" : "bg-blue-600 hover:bg-blue-600")}>
                                    {quant.isAutoMode ? 'AUTOPILOT' : 'SENTINELA'}
                                </Badge>
                            </div>

                            {/* PERFIL ESTRATÉGICO */}
                            <div className="space-y-2">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Perfil de Risco</Label>
                                <ToggleGroup 
                                    type="single" 
                                    value={quant.strategicProfile} 
                                    onValueChange={(v: StrategicProfile) => v && quant.setStrategicProfile(v)}
                                    className="grid grid-cols-3 gap-1"
                                    disabled={quant.isAutoMode}
                                >
                                    <ToggleGroupItem value="conservative" className="text-[10px] h-7">CONSER</ToggleGroupItem>
                                    <ToggleGroupItem value="balanced" className="text-[10px] h-7">BALANC</ToggleGroupItem>
                                    <ToggleGroupItem value="aggressive" className="text-[10px] h-7 text-destructive">AGRESS</ToggleGroupItem>
                                </ToggleGroup>
                            </div>
                            
                            {/* AJUSTE DINÂMICO DE TEMPO */}
                            <div className="space-y-3 p-3 rounded-lg border border-border bg-muted/10">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-muted-foreground flex items-center gap-1.5"><Timer className="h-3.5 w-3.5"/> Ciclo de Análise</span>
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
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>Próxima Inferência</span>
                                    <span className="font-mono">{quant.timeToNextAnalysis}s</span>
                                </div>
                                <Progress value={(quant.timeToNextAnalysis / quant.analysisInterval) * 100} className="h-1" />
                            </div>
                            <Button 
                                onClick={quant.toggleAutoMode} 
                                className={cn("w-full h-12 font-bold shadow-md", quant.isAutoMode ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90")}
                            >
                                {quant.isAutoMode ? <PauseCircle className="mr-2 h-5 w-5" /> : <PlayCircle className="mr-2 h-5 w-5" />}
                                {quant.isAutoMode ? 'Pausar Automação' : 'Ativar Automação'}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <Binary className="h-4 w-4" /> Gestão Financeira
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                                        <Wallet className="h-3 w-3" /> Stake (USD)
                                    </Label>
                                    <Input 
                                        type="number" 
                                        value={quant.stakeValue} 
                                        onChange={(e) => quant.setStakeValue(Number(e.target.value))}
                                        className="h-8 text-xs font-mono bg-background/50"
                                        disabled={quant.isAutoMode}
                                        step="0.5"
                                        min="0.35"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                                        <Target className="h-3 w-3" /> Alvo Lucro
                                    </Label>
                                    <Input 
                                        type="number" 
                                        value={quant.profitTarget} 
                                        onChange={(e) => quant.setProfitTarget(Number(e.target.value))}
                                        className="h-8 text-xs font-mono bg-background/50"
                                        disabled={quant.isAutoMode}
                                        step="1"
                                        min="1"
                                    />
                                </div>
                            </div>

                            <Separator className="opacity-50" />

                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 rounded-lg bg-muted/20 border border-border text-center">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Sessão P&L</p>
                                    <p className={cn("text-lg font-bold", Number(quant.sessionStats.pnl) >= 0 ? "text-green-600" : "text-destructive")}>
                                        {formatCurrency(Number(quant.sessionStats.pnl))}
                                    </p>
                                </div>
                                <div className="p-3 rounded-lg bg-muted/20 border border-border text-center">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Win Rate</p>
                                    <p className="text-lg font-bold">{Number(quant.sessionStats.winRate).toFixed(1)}%</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border shadow-sm flex-1">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <History className="h-4 w-4 text-primary" /> Histórico de Trades
                            </CardTitle>
                            {terminalTrades.length > 0 && (
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-6 w-6 text-muted-foreground hover:text-destructive" 
                                    onClick={clearActiveContracts}
                                    title="Limpar Histórico"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            )}
                        </CardHeader>
                        <CardContent className="p-0">
                            <ScrollArea className="h-64">
                                <div className="divide-y divide-border">
                                    {terminalTrades.length === 0 ? (
                                        <div className="p-8 text-center text-muted-foreground opacity-40">
                                            <Activity className="h-8 w-8 mx-auto mb-2" />
                                            <p className="text-[10px] font-mono">Sem execuções registradas</p>
                                        </div>
                                    ) : (
                                        terminalTrades.map((op) => (
                                            <div key={op.id} className="p-3 hover:bg-muted/10 transition-colors">
                                                <div className="flex items-center justify-between mb-1">
                                                    <div className="flex items-center gap-2">
                                                        {op.direction === 'rise' ? (
                                                            <ArrowUpCircle className="h-3.5 w-3.5 text-green-600" />
                                                        ) : (
                                                            <ArrowDownCircle className="h-3.5 w-3.5 text-destructive" />
                                                        )}
                                                        <span className="text-[11px] font-bold uppercase">{op.direction}</span>
                                                    </div>
                                                    <Badge variant={op.status === 'won' ? 'default' : op.status === 'lost' ? 'destructive' : 'outline'} className="text-[9px] h-4 py-0">
                                                        {op.status.toUpperCase()}
                                                    </Badge>
                                                </div>
                                                <div className="flex justify-between text-[10px] font-mono">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-muted-foreground">Stake: {formatCurrency(Number(op.stake))}</span>
                                                        <span className={cn(
                                                            "font-bold",
                                                            (Number(op.result) || 0) >= 0 ? "text-green-600" : "text-destructive"
                                                        )}>
                                                            PnL: {formatCurrency(Number(op.result) || -Number(op.stake))}
                                                        </span>
                                                        <span className="text-muted-foreground italic">
                                                            Tempo: {op.duration} {getDurationLabel(op.durationUnit)}
                                                        </span>
                                                    </div>
                                                    <div className="text-right text-muted-foreground flex flex-col gap-0.5">
                                                        <span className="flex items-center justify-end gap-1"><Clock className="h-2.5 w-2.5" /> {new Date(op.timestamp).toLocaleTimeString()}</span>
                                                        <span>{new Date(op.timestamp).toLocaleDateString()}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>

                {/* COLUNA CENTRAL: VISUALIZAÇÃO E DECISÃO */}
                <div className="lg:col-span-2 space-y-6">
                    <Card className="bg-card/50 border-border shadow-sm min-h-[450px]">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <LineChart className="h-5 w-5 text-primary" /> Radar de Ativos
                                </CardTitle>
                                <CardDescription>Fluxo em tempo real processado para IA</CardDescription>
                            </div>
                            <Badge variant="outline" className="border-border text-muted-foreground">{timePeriod.toUpperCase()} Resolution</Badge>
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
                    <Card className="bg-card border-border h-[400px] flex flex-col shadow-sm">
                        <CardHeader className="py-3 border-b border-border">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <MessageSquare className="h-4 w-4 text-primary" />
                                Interface de Diálogo com o CIO
                            </CardTitle>
                            <CardDescription className="text-[10px]">Consulte o modelo local sobre a estratégia atual.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-hidden p-0 relative bg-muted/5">
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
                                            "flex flex-col max-w-[85%] rounded-lg p-3 text-xs leading-relaxed border shadow-sm",
                                            msg.role === 'user' ? "bg-primary/10 ml-auto border-primary/20" : "bg-card mr-auto border-border"
                                        )}>
                                            <span className="font-bold uppercase text-[9px] mb-1 opacity-50">
                                                {msg.role === 'user' ? 'OPERADOR' : 'CIO'} • {msg.time}
                                            </span>
                                            <p className="font-mono text-foreground">{msg.content}</p>
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
                        <CardFooter className="p-3 border-t border-border">
                            <form onSubmit={handleChatSubmit} className="flex w-full gap-2">
                                <Input 
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                    placeholder="Pergunte ao CIO..."
                                    className="bg-background border-border h-9 text-xs"
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
                    <Card className="bg-card/50 border-border border-l-4 border-l-primary shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-sm flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-primary" /> Veredito Atual
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {quant.lastDecision ? (
                                <div className="space-y-4">
                                    <div className={cn(
                                        "p-4 rounded-xl text-center border shadow-inner",
                                        quant.lastDecision.action === 'RISE' ? "bg-green-500/10 border-green-500/20 text-green-600" :
                                        quant.lastDecision.action === 'FALL' ? "bg-destructive/10 border-destructive/20 text-destructive" :
                                        "bg-muted border-border text-muted-foreground"
                                    )}>
                                        <p className="text-[10px] uppercase font-bold mb-1 opacity-70">Recomendação</p>
                                        <p className="text-3xl font-black">{quant.lastDecision.action}</p>
                                        <p className="text-xs mt-2 font-mono font-bold">Confiança: {quant.lastDecision.confidence}%</p>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground italic bg-muted/30 p-3 rounded-lg border border-border">
                                        "{quant.lastDecision.reasoning}"
                                    </div>
                                    {!quant.isAutoMode && quant.lastDecision.action !== 'HOLD' && (
                                        <Button 
                                            onClick={quant.executeManualDecision} 
                                            className="w-full bg-foreground text-background hover:bg-foreground/90 font-bold"
                                        >
                                            Autorizar Investimento
                                        </Button>
                                    )}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin opacity-20" />
                                    <p className="text-xs">Sincronizando com Ollama...</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-sm flex items-center gap-2">
                                <Cpu className="h-4 w-4 text-muted-foreground" /> Telemetria Local
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-xs">
                             <div className="flex justify-between">
                                <span className="text-muted-foreground">Latency (Decision):</span>
                                <span className="font-mono font-bold">{quant.telemetry.latency}ms</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Tokens/Sec:</span>
                                <span className="font-mono font-bold">{quant.telemetry.tps}</span>
                            </div>
                            <Separator className="bg-border" />
                            <div className="space-y-2">
                                <p className="text-[10px] text-muted-foreground uppercase font-bold">Convergência de Sinais</p>
                                <div className="grid grid-cols-3 gap-1">
                                    <Badge variant="outline" className="text-[9px] border-border bg-background">GBM: OK</Badge>
                                    <Badge variant="outline" className="text-[9px] border-border bg-background">HMM: OK</Badge>
                                    <Badge variant="outline" className="text-[9px] border-border bg-background">V1: OK</Badge>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    
                    {/* LOG DE RACIOCÍNIO */}
                    <Card className="bg-muted/30 border-border font-mono overflow-hidden shadow-inner">
                        <div className="bg-card/50 px-4 py-2 flex items-center justify-between border-b border-border">
                            <span className="text-[10px] font-bold text-muted-foreground flex items-center gap-2">
                                <TerminalIcon className="h-3 w-3" /> REASONING LOG
                            </span>
                        </div>
                        <CardContent className="p-0">
                            <ScrollArea className="h-48 p-4 text-[10px] leading-relaxed">
                                {quant.reasoningLog.length === 0 ? (
                                    <p className="animate-pulse text-muted-foreground">Aguardando auditoria...</p>
                                ) : (
                                    quant.reasoningLog.map((log, i) => (
                                        <div key={i} className="mb-1">
                                            <span className="text-muted-foreground/60">[{log.time}]</span>{' '}
                                            <span className={cn(
                                                "font-medium",
                                                log.type === 'decision' ? "text-primary" : 
                                                log.type === 'execution' ? "text-green-600" : 
                                                log.type === 'error' ? "text-destructive" : "text-muted-foreground"
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
