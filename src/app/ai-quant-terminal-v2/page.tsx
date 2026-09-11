// src/app/ai-quant-terminal-v2/page.tsx
'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
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
    Activity, Brain, Wallet, Target, History,
    ArrowUpCircle, ArrowDownCircle, Clock, ShieldAlert,
    TrendingUp, Binary, Trash2, Microscope, Radar,
    TrendingDown, Minus, Coins
} from "lucide-react";
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 as AssetSelector } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { useAIQuantTerminalV2, type StrategicProfile } from "@/features/trading/hooks/use-ai-quant-terminal-v2";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useRobotCouncilV2 } from '@/features/trading/hooks/use-robot-council-v2';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function TerminalContentV2() {
    const { 
        activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading, 
        chartData, botCandleData, isConnected, operationsLog, tradeAnnotations, priceTicks,
        isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod, dataVersion,
        clearActiveContracts, accountType
    } = useDerivApi();

    const quant = useAIQuantTerminalV2(activeSymbol, priceTicks, botCandleData);
    const { indicators: councilIndicators } = useRobotCouncilV2(activeSymbol, [], botCandleData, dataVersion);
    
    const { chatMessages, isChatLoading, reasoningLog, telemetry, radarStatus, sessionStats, globalSessionStats, accountBalance } = quant;

    const [chatInput, setChatInput] = useState('');
    const [showRealAccountConfirm, setShowRealAccountConfirm] = useState(false);
    const chatScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chatMessages]);

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

    const handleChatSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (chatInput.trim()) {
            quant.sendMessage(chatInput);
            setChatInput('');
        }
    };

    const filteredTerminalTrades = useMemo(() => {
        return operationsLog.filter(op => op.initiator === 'Conselho' && op.asset === activeSymbol);
    }, [operationsLog, activeSymbol]);

    return (
        <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6 bg-background min-h-screen text-foreground">
            {/* NOVO: GLOBAL OPPORTUNITY RADAR */}
            <Card className="bg-primary/5 border-primary/20 shadow-sm overflow-hidden">
                <CardHeader className="py-3 px-6 bg-primary/10 border-b border-primary/20 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-primary">
                        <Radar className="h-4 w-4 animate-spin-slow" /> Radar de Oportunidades Estocásticas
                    </CardTitle>
                    <Badge variant="outline" className="text-[9px] border-primary/30 text-primary uppercase">Scan Ativo</Badge>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {Object.values(radarStatus).map((asset) => (
                            <div 
                                key={asset.symbol} 
                                onClick={() => setActiveSymbol(asset.symbol)}
                                className={cn(
                                    "p-3 rounded-lg border transition-all cursor-pointer group hover:scale-105",
                                    asset.symbol === activeSymbol ? "bg-primary border-primary text-primary-foreground shadow-md" : "bg-card border-border hover:border-primary/50",
                                    asset.lastAction !== 'HOLD' && asset.symbol !== activeSymbol && "animate-pulse border-green-500 bg-green-500/10"
                                )}
                            >
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-[10px] font-bold font-mono">{asset.symbol}</span>
                                    {asset.isQualified && <Zap className="h-3 w-3 text-yellow-500 fill-current" />}
                                </div>
                                <div className="flex items-center gap-2">
                                    {asset.lastAction === 'RISE' ? <TrendingUp className="h-4 w-4 text-green-500" /> : 
                                     asset.lastAction === 'FALL' ? <TrendingDown className="h-4 w-4 text-red-500" /> : 
                                     <Minus className="h-4 w-4 text-muted-foreground" />}
                                    <span className="text-sm font-black">{asset.lastAction}</span>
                                </div>
                                <div className="mt-1 flex items-center justify-between text-[9px] opacity-60">
                                    <span>Confiança:</span>
                                    <span className="font-mono">{asset.confidence.toFixed(0)}%</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* HEADER E SELECTOR */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-2 rounded-xl border border-primary/20 shadow-sm">
                        <BrainCircuit className="h-8 w-8 text-primary animate-pulse" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight font-headline">Terminal Quant V2 (Radar)</h1>
                        <div className="flex items-center gap-2">
                             <Badge variant="secondary" className="font-mono text-xs flex items-center gap-1.5">
                                <Coins className="h-3 w-3"/> Saldo: {accountBalance.loading ? '...' : formatCurrency(accountBalance.balance || 0)}
                             </Badge>
                             <p className="text-muted-foreground text-[10px] font-mono italic">Escalonador de Inferência Ativo</p>
                        </div>
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
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
                                <span className="text-xs font-medium">Estado do Sistema</span>
                                <Badge className={cn("font-bold", quant.isAutoMode ? "bg-green-600 hover:bg-green-600" : "bg-blue-600 hover:bg-blue-600")}>
                                    {quant.isAutoMode ? 'AUTOPILOT' : 'SENTINELA'}
                                </Badge>
                            </div>

                            <div className="space-y-3">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Perfil Estratégico (Mentalidade IA)</Label>
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

                            <div className="space-y-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-muted-foreground flex items-center gap-1.5"><Microscope className="h-3.5 w-3.5"/> Gatilho Confiança</span>
                                    <span className="font-mono text-primary font-bold">{quant.confidenceThreshold}%</span>
                                </div>
                                <Slider 
                                    value={[quant.confidenceThreshold]} 
                                    min={10} max={95} step={1} 
                                    onValueChange={(v) => quant.setConfidenceThreshold(v[0])}
                                    disabled={quant.isAutoMode}
                                />
                            </div>

                            <div className="space-y-3 p-3 rounded-lg border border-border bg-muted/10">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-muted-foreground flex items-center gap-1.5"><Timer className="h-3.5 w-3.5"/> Ciclo de Análise</span>
                                    <span className="font-mono text-primary font-bold">{quant.analysisInterval}s</span>
                                </div>
                                <Slider 
                                    value={[quant.analysisInterval]} 
                                    min={30} 
                                    max={3000} 
                                    step={30} 
                                    onValueChange={(v) => quant.setAnalysisInterval(v[0])}
                                    disabled={quant.isAutoMode}
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>Inferência Principal em</span>
                                    <span className="font-mono">{quant.timeToNextAnalysis}s</span>
                                </div>
                                <Progress value={(quant.timeToNextAnalysis / quant.analysisInterval) * 100} className="h-1" />
                            </div>

                            <Button 
                                onClick={() => {
                                    if (!quant.isAutoMode && accountType === 'real') {
                                        setShowRealAccountConfirm(true);
                                    } else {
                                        quant.toggleAutoMode();
                                    }
                                }} 
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
                                <Binary className="h-4 w-4" /> Gestão de Risco & Tesouraria
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Stake (USD)</Label>
                                    <Input type="number" value={quant.stakeValue} onChange={(e) => quant.setStakeValue(Number(e.target.value))} className="h-8 text-xs font-mono bg-background/50" disabled={quant.isAutoMode} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Alvo Lucro</Label>
                                    <Input type="number" value={quant.profitTarget} onChange={(e) => quant.setProfitTarget(Number(e.target.value))} className="h-8 text-xs font-mono bg-background/50" disabled={quant.isAutoMode} />
                                </div>
                            </div>
                            
                            <Separator className="opacity-50" />
                            
                            {/* NOVO: TOTALIZADOR GLOBAL */}
                            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                                <p className="text-[10px] text-primary uppercase font-bold text-center mb-2">Desempenho Global da Esquadra (Sessão)</p>
                                <div className="grid grid-cols-2 gap-2 text-center">
                                    <div>
                                        <p className="text-[9px] text-muted-foreground uppercase">P&L Acumulado</p>
                                        <p className={cn("text-base font-bold", globalSessionStats.pnl >= 0 ? "text-green-600" : "text-destructive")}>
                                            {formatCurrency(globalSessionStats.pnl)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] text-muted-foreground uppercase">Win Rate Global</p>
                                        <p className="text-base font-bold">
                                            {globalSessionStats.winRate === null ? '—' : `${globalSessionStats.winRate.toFixed(1)}%`}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-2 text-center text-[9px] text-muted-foreground font-mono">
                                    Total de Operações no Radar: {globalSessionStats.total}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 rounded-lg bg-muted/20 border border-border text-center">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">P&L Ativo: {activeSymbol}</p>
                                    <p className={cn("text-lg font-bold", sessionStats.pnl >= 0 ? "text-green-600" : "text-destructive")}>
                                        {formatCurrency(sessionStats.pnl)}
                                    </p>
                                </div>
                                <div className="p-3 rounded-lg bg-muted/20 border border-border text-center">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">WR: {activeSymbol}</p>
                                    <p className="text-lg font-bold">
                                      {sessionStats.winRate === null ? '—' : `${sessionStats.winRate.toFixed(1)}%`}
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border shadow-sm flex-1">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <History className="h-4 w-4 text-primary" /> Histórico Focado: {activeSymbol}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <ScrollArea className="h-64">
                                <div className="divide-y divide-border">
                                    {filteredTerminalTrades.length === 0 ? (
                                        <div className="p-8 text-center text-muted-foreground opacity-40">
                                            <Activity className="h-8 w-8 mx-auto mb-2" />
                                            <p className="text-[10px] font-mono">Sem trades em {activeSymbol}</p>
                                        </div>
                                    ) : (
                                        filteredTerminalTrades.map((op) => (
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
                                                    <span className={cn((op.result || 0) >= 0 ? "text-green-600" : "text-destructive")}>
                                                        Result: {formatCurrency(op.result || -op.stake)}
                                                    </span>
                                                    <span className="text-muted-foreground">{new Date(op.timestamp).toLocaleTimeString()}</span>
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
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <div>
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <LineChart className="h-5 w-5 text-primary" /> Ativo Focado: {activeSymbol}
                                </CardTitle>
                            </div>
                            <Badge variant="outline" className="border-border text-muted-foreground uppercase text-[10px]">{timePeriod} Res.</Badge>
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

                    <Card className="bg-card border-border h-[350px] flex flex-col shadow-sm">
                        <CardHeader className="py-3 border-b border-border bg-muted/5">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <MessageSquare className="h-4 w-4 text-primary" />
                                Interface de Diálogo com o CIO
                            </CardTitle>
                            <CardDescription className="text-[10px]">Análise expandida baseada em transações reais e decisões de todos os ativos do radar.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-hidden p-0 relative bg-muted/5">
                            <ScrollArea className="h-full p-4">
                                <div className="space-y-4">
                                    {chatMessages.map((msg, i) => (
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
                                    {isChatLoading && (
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
                                    placeholder="Pergunte sobre qualquer ativo ou sobre seu saldo global..."
                                    className="bg-background border-border h-9 text-xs"
                                    disabled={isChatLoading}
                                />
                                <Button type="submit" size="icon" className="h-9 w-9" disabled={isChatLoading || !chatInput.trim()}>
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
                                <ShieldCheck className="h-4 w-4 text-primary" /> Veredito: {activeSymbol}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {lastDecision ? (
                                <div className="space-y-4">
                                    <div className={cn(
                                        "p-4 rounded-xl text-center border shadow-inner",
                                        lastDecision.action === 'RISE' ? "bg-green-500/10 border-green-500/20 text-green-600" :
                                        lastDecision.action === 'FALL' ? "bg-destructive/10 border-destructive/20 text-destructive" :
                                        "bg-muted border-border text-muted-foreground"
                                    )}>
                                        <p className="text-[10px] uppercase font-bold mb-1 opacity-70">Recomendação</p>
                                        <p className="text-3xl font-black">{lastDecision.action}</p>
                                        <p className="text-xs mt-2 font-mono font-bold">Confiança: {lastDecision.confidence}%</p>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground italic bg-muted/30 p-3 rounded-lg border border-border">
                                        "{lastDecision.reasoning}"
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin opacity-20" />
                                    <p className="text-xs">Sincronizando com CIO...</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                                <Cpu className="h-4 w-4" /> Telemetria de Scan
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-xs">
                             <div className="flex justify-between">
                                <span className="text-muted-foreground">Latência Inferência:</span>
                                <span className="font-mono font-bold">{telemetry.latency}ms</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Tokens/Sec:</span>
                                <span className="font-mono font-bold">{telemetry.tps}</span>
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
                            <ScrollArea className="h-64 p-4 text-[10px] leading-relaxed">
                                {reasoningLog.length === 0 ? (
                                    <p className="animate-pulse text-muted-foreground">Aguardando varredura...</p>
                                ) : (
                                    reasoningLog.map((log, i) => (
                                        <div key={i} className="mb-1">
                                            <span className="text-muted-foreground/60">[{log.time}]</span>{' '}
                                            <span className={cn(
                                                "font-medium",
                                                log.type === 'decision' ? "text-primary" : 
                                                log.type === 'execution' ? "text-green-600" : 
                                                log.type === 'radar' ? "text-blue-500" : "text-muted-foreground"
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

            <AlertDialog open={showRealAccountConfirm} onOpenChange={setShowRealAccountConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Radar: Automação em Conta REAL</AlertDialogTitle>
                        <AlertDialogDescription>
                            Você está ativando a execução automática para o radar multi-ativo em conta REAL. 
                            O sistema poderá abrir ordens automaticamente sempre que o CIO detectar uma oportunidade superior a {quant.confidenceThreshold}% de confiança.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => {
                            quant.toggleAutoMode();
                            setShowRealAccountConfirm(false);
                        }}>
                            Confirmar e Ativar Radar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

export default function AIQuantTerminalV2Page() {
    return (
        <DerivApiProvider>
            <TerminalContentV2 />
        </DerivApiProvider>
    );
}
