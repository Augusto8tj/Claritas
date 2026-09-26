
'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { 
    BrainCircuit, Zap, ShieldCheck, Terminal as TerminalIcon, 
    Timer, LineChart, PlayCircle, 
    PauseCircle, Cpu, RefreshCw, MessageSquare, Send, 
    Activity, Brain, Wallet, Target, History,
    ArrowUpCircle, ArrowDownCircle, Clock, ShieldAlert,
    TrendingUp, Binary, Trash2, Microscope, Radar,
    TrendingDown, Minus, Coins, Leaf, Sparkles, Layers,
    RotateCcw, Ghost, BarChartHorizontal
} from "lucide-react";
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi, type AccountType } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 as AssetSelector } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { useAIQuantTerminalV2, type StrategicProfile } from "@/features/trading/hooks/use-ai-quant-terminal-v2";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useRobotCouncilV2 } from '@/features/trading/hooks/use-robot-council-v2';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
        clearActiveContracts, accountType, setAccountType 
    } = useDerivApi();

    const quant = useAIQuantTerminalV2(activeSymbol, priceTicks, botCandleData);
    const { indicators: councilIndicators } = useRobotCouncilV2(activeSymbol, [], botCandleData, dataVersion);
    
    const { 
        lastDecision,
        timeToNextAnalysis,
        analysisInterval,
        setAnalysisInterval,
        strategicProfile,
        setStrategicProfile,
        confidenceThreshold,
        setConfidenceThreshold,
        stakeValue,
        setStakeValue,
        profitTarget,
        setProfitTarget,
        maxConsecutiveLosses,
        setMaxConsecutiveLosses,
        maxDailyLoss,
        setMaxDailyLoss,
        chatMessages, 
        isChatLoading, 
        reasoningLog, 
        telemetry, 
        radarStatus, 
        sessionStats, 
        globalSessionStats, 
        accountBalance,
        resetSession,
        isShadowMode,
        toggleShadowMode,
        shadowPnL,
        shadowTradesCount,
        isAutoMode,
        toggleAutoMode
    } = quant;

    const [chatInput, setChatInput] = useState('');
    const [showRealAccountConfirm, setShowRealAccountConfirm] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
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

    const terminalSessionTrades = useMemo(() => {
        const today = new Date().toDateString();
        return operationsLog.filter(op => 
            op.initiator === 'Conselho' && 
            new Date(op.timestamp).toDateString() === today
        );
    }, [operationsLog]);

    const activeAssetsWithTrades = useMemo(() => {
        const assets = new Set(terminalSessionTrades.map(op => op.asset));
        if (activeSymbol) assets.add(activeSymbol);
        return Array.from(assets).sort();
    }, [terminalSessionTrades, activeSymbol]);

    const zenThought = useMemo(() => {
        if (!lastDecision) return "O CIO está meditando sobre os fluxos de mercado...";
        return lastDecision.zenThought || "A fluidez do mercado exige disciplina e observação constante.";
    }, [lastDecision]);

    return (
        <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6 bg-background min-h-screen text-foreground">
            {/* GLOBAL OPPORTUNITY RADAR */}
            <Card className="bg-primary/5 border-primary/20 shadow-sm overflow-hidden">
                <CardHeader className="py-3 px-6 bg-primary/10 border-b border-primary/20 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-primary">
                        <Radar className="h-4 w-4 animate-spin-slow" /> Radar de Oportunidades Estocásticas
                    </CardTitle>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                             <Label htmlFor="shadow-mode" className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1">
                                <Ghost className="h-3 w-3" /> Modo Sombra
                             </Label>
                             <Switch id="shadow-mode" checked={isShadowMode} onCheckedChange={toggleShadowMode} className="scale-75" />
                        </div>
                        <Badge variant="outline" className="text-[9px] border-primary/30 text-primary uppercase">Scan Ativo</Badge>
                    </div>
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
                                    asset.isQualified && asset.symbol !== activeSymbol && "animate-pulse border-green-500 bg-green-50/10"
                                )}
                            >
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-[10px] font-bold font-mono">{asset.symbol}</span>
                                    {asset.isFallback && <Badge variant="outline" className="text-[8px] h-3 px-1 border-amber-500 text-amber-600">Fallback</Badge>}
                                    {asset.isQualified && <Zap className="h-3 w-3 text-yellow-500 fill-current" />}
                                </div>
                                <div className="flex items-center gap-2">
                                    {asset.lastAction === 'RISE' ? <TrendingUp className="h-4 w-4 text-green-500" /> : 
                                     asset.lastAction === 'FALL' ? <TrendingDown className="h-4 w-4 text-red-500" /> : 
                                     <Minus className="h-4 w-4 text-muted-foreground" />}
                                    <span className="text-sm font-black">{asset.lastAction}</span>
                                </div>
                                <div className="mt-1 flex items-center justify-between text-[9px] opacity-60">
                                    <span>{asset.recommendedContract || 'Dígitos'}</span>
                                    <span className="font-mono">{(asset.confidence ?? 0).toFixed(0)}%</span>
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
                        <h1 className="text-2xl font-bold tracking-tight font-headline">Terminal Quant Radar V2.6</h1>
                        <div className="flex items-center gap-2">
                             <Badge variant="secondary" className="font-mono text-xs flex items-center gap-1.5">
                                <Coins className="h-3 w-3"/> Saldo: {accountBalance.loading ? '...' : formatCurrency(accountBalance.balance || 0)}
                             </Badge>
                             {isShadowMode && (
                                 <Badge className="bg-purple-600 font-mono text-xs flex items-center gap-1.5">
                                    <Ghost className="h-3 w-3"/> Shadow: {formatCurrency(shadowPnL)} ({shadowTradesCount})
                                 </Badge>
                             )}
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                    <ToggleGroup 
                        type="single" 
                        value={accountType} 
                        onValueChange={(v: AccountType) => v && setAccountType(v)} 
                        className="bg-muted p-1 rounded-lg border border-border"
                        disabled={isAutoMode}
                    >
                        <ToggleGroupItem value="demo" className="text-[10px] h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm">Demo</ToggleGroupItem>
                        <ToggleGroupItem value="real" className="text-[10px] h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm">Real</ToggleGroupItem>
                    </ToggleGroup>
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
                                <Badge className={cn("font-bold", isAutoMode ? "bg-green-600" : "bg-blue-600")}>
                                    {isAutoMode ? 'AUTOPILOT' : 'SENTINELA'}
                                </Badge>
                            </div>

                            <div className="space-y-3">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Perfil Estratégico (LLM Context)</Label>
                                <ToggleGroup 
                                    type="single" 
                                    value={strategicProfile} 
                                    onValueChange={(v: StrategicProfile) => v && setStrategicProfile(v)}
                                    className="grid grid-cols-3 gap-1"
                                    disabled={isAutoMode}
                                >
                                    <ToggleGroupItem value="conservative" className="text-[10px] h-7">CONSER</ToggleGroupItem>
                                    <ToggleGroupItem value="balanced" className="text-[10px] h-7">BALANC</ToggleGroupItem>
                                    <ToggleGroupItem value="aggressive" className="text-[10px] h-7 text-destructive">AGRESS</ToggleGroupItem>
                                </ToggleGroup>
                            </div>

                            <div className="space-y-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-muted-foreground flex items-center gap-1.5"><Microscope className="h-3.5 w-3.5"/> Gatilho Confiança</span>
                                    <span className="font-mono text-primary font-bold">{confidenceThreshold}%</span>
                                </div>
                                <Slider 
                                    value={[confidenceThreshold]} 
                                    min={10} max={95} step={1} 
                                    onValueChange={(v) => setConfidenceThreshold(v[0])}
                                    disabled={isAutoMode}
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>Inferência Principal em</span>
                                    <span className="font-mono">{timeToNextAnalysis}s</span>
                                </div>
                                <Progress value={(timeToNextAnalysis / analysisInterval) * 100} className="h-1" />
                            </div>

                            <Button 
                                onClick={() => {
                                    if (!isAutoMode && accountType === 'real') setShowRealAccountConfirm(true);
                                    else toggleAutoMode();
                                }} 
                                className={cn("w-full h-12 font-bold shadow-md", isAutoMode ? "bg-destructive" : "bg-primary")}
                            >
                                {isAutoMode ? <PauseCircle className="mr-2 h-5 w-5" /> : <PlayCircle className="mr-2 h-5 w-5" />}
                                {isAutoMode ? 'Pausar Automação' : 'Ativar Automação'}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <Binary className="h-4 w-4" /> Gestão de Risco & Circuit Breaker
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Stake (USD)</Label>
                                    <Input type="number" value={stakeValue} onChange={(e) => setStakeValue(Number(e.target.value))} className="h-8 text-xs font-mono bg-background/50" disabled={isAutoMode} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Alvo Lucro</Label>
                                    <Input type="number" value={profitTarget} onChange={(e) => setProfitTarget(Number(e.target.value))} className="h-8 text-xs font-mono bg-background/50" disabled={isAutoMode} />
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Máx. Perdas (Dia)</Label>
                                    <Input type="number" value={maxConsecutiveLosses} onChange={(e) => setMaxConsecutiveLosses(Number(e.target.value))} className="h-8 text-xs font-mono bg-background/50" disabled={isAutoMode} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Stop Loss Dia</Label>
                                    <Input type="number" value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(Number(e.target.value))} className="h-8 text-xs font-mono bg-background/50" disabled={isAutoMode} />
                                </div>
                            </div>
                            
                            <Separator className="opacity-50" />
                            
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 rounded-lg bg-muted/20 border border-border text-center">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">P&L Sessão</p>
                                    <p className={cn("text-lg font-bold", sessionStats.pnl >= 0 ? "text-green-600" : "text-destructive")}>
                                        {formatCurrency(sessionStats.pnl)}
                                    </p>
                                </div>
                                <div className="p-3 rounded-lg bg-muted/20 border border-border text-center">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Win Rate</p>
                                    <p className="text-lg font-bold">
                                      {sessionStats.winRate === null ? '—' : `${sessionStats.winRate.toFixed(1)}%`}
                                    </p>
                                </div>
                            </div>

                            <Button 
                                variant="outline" 
                                className="w-full h-10 gap-2 text-xs font-bold border-destructive/20 text-destructive hover:bg-destructive/10"
                                onClick={() => setShowResetConfirm(true)}
                            >
                                <RotateCcw className="h-4 w-4" />
                                Reiniciar Sessão Ativa
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border shadow-sm flex-1 overflow-hidden flex flex-col">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <History className="h-4 w-4 text-primary" /> Históricos Segmentados
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
                            <Tabs defaultValue="ALL" className="w-full h-full flex flex-col">
                                <div className="px-2 border-b bg-muted/20 overflow-x-auto no-scrollbar">
                                    <TabsList className="h-8 justify-start bg-transparent p-0 flex-nowrap w-max">
                                        <TabsTrigger value="ALL" className="text-[9px] font-bold h-7 uppercase">Global</TabsTrigger>
                                        {activeAssetsWithTrades.map(asset => (
                                            <TabsTrigger key={asset} value={asset} className="text-[9px] font-bold h-7 uppercase">{asset}</TabsTrigger>
                                        ))}
                                    </TabsList>
                                </div>
                                
                                <ScrollArea className="flex-1 h-64">
                                    <TabsContent value="ALL" className="m-0 border-none">
                                        {renderTradeList(terminalSessionTrades, formatCurrency)}
                                    </TabsContent>
                                    {activeAssetsWithTrades.map(asset => (
                                        <TabsContent key={asset} value={asset} className="m-0 border-none">
                                            {renderTradeList(terminalSessionTrades.filter(op => op.asset === asset), formatCurrency)}
                                        </TabsContent>
                                    ))}
                                </ScrollArea>
                            </Tabs>
                        </CardContent>
                    </Card>
                </div>

                {/* COLUNA CENTRAL: VISUALIZAÇÃO E DECISÃO */}
                <div className="lg:col-span-2 space-y-6">
                    <Card className="bg-card/50 border-border shadow-sm min-h-[450px]">
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <div>
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <LineChart className="h-5 w-5 text-primary" /> Ativo: {activeSymbol}
                                </CardTitle>
                            </div>
                            <Badge variant="outline" className="border-border text-muted-foreground uppercase text-[10px] font-mono">T-Interval: {analysisInterval}s</Badge>
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
                                Interface CIO (Prompt de Comando)
                            </CardTitle>
                            <CardDescription className="text-[10px]">Diga "Compre 30s no 1HZ10V" para que o CIO arme a operação para você.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-hidden p-0 relative bg-muted/5">
                            <ScrollArea className="h-full p-4">
                                <div className="space-y-4">
                                    {chatMessages.map((msg, i) => (
                                        <div key={i} className={cn(
                                            "flex items-start gap-2 max-w-[85%]",
                                            msg.role === 'user' ? "ml-auto flex-row-reverse" : ""
                                        )}>
                                            <Badge variant="outline" className="h-6 w-6 rounded-full p-0 flex items-center justify-center shrink-0">
                                                {msg.role === 'user' ? 'U' : 'C'}
                                            </Badge>
                                            <div className={cn(
                                                "rounded-lg p-3 text-xs leading-relaxed border shadow-sm",
                                                msg.role === 'user' ? "bg-primary/10 border-primary/20" : "bg-card border-border"
                                            )}>
                                                <p className="font-mono text-foreground">{msg.content}</p>
                                                <div className="text-[9px] opacity-40 mt-1 text-right">{msg.time}</div>
                                            </div>
                                        </div>
                                    ))}
                                    {isChatLoading && (
                                        <div className="flex items-center gap-2 text-xs text-primary animate-pulse font-mono">
                                            <RefreshCw className="h-3 w-3 animate-spin"/> O CIO está auditando os fluxos...
                                        </div>
                                    )}
                                    <div ref={chatScrollRef} />
                                </div>
                            </ScrollArea>
                        </CardContent>
                        <CardFooter className="p-4 border-t border-border">
                            <form onSubmit={handleChatSubmit} className="flex w-full gap-2">
                                <Input 
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                    placeholder="Ex: 'Execute uma compra' ou 'Qual o P&L hoje?'"
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
                    <Card className="bg-primary/5 border-primary/20 shadow-md">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2 text-primary font-headline">
                                <Leaf className="h-4 w-4" /> Inteligência Meditativa
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="bg-background/80 p-4 rounded-xl border border-primary/10 shadow-inner">
                                <p className="text-xs italic leading-relaxed text-primary/80 font-medium">
                                    "{zenThought}"
                                </p>
                                <div className="mt-3 flex items-center gap-2">
                                    <Sparkles className="h-3 w-3 text-yellow-500" />
                                    <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Estado Cognitivo Ativo</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border border-l-4 border-l-primary shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-sm flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-primary" /> Veredito Atual
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
                                        <p className="text-[10px] uppercase font-bold mb-1 opacity-70">Recomendação {lastDecision._isFallback ? '(Fallback)' : ''}</p>
                                        <p className="text-3xl font-black">{lastDecision.action}</p>
                                        <p className="text-xs mt-2 font-mono font-bold">Confiança: {lastDecision.confidence}%</p>
                                    </div>
                                    <div className="bg-muted/30 p-3 rounded-lg border border-border flex items-center gap-3">
                                        <Layers className="h-4 w-4 text-primary" />
                                        <div className="flex-1">
                                            <p className="text-[10px] uppercase font-bold text-muted-foreground">Instrumento</p>
                                            <p className="text-xs font-bold">{lastDecision.recommendedContract}</p>
                                        </div>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground italic bg-muted/30 p-3 rounded-lg border border-border">
                                        "{lastDecision.reasoning}"
                                    </div>
                                    {(isShadowMode || !isAutoMode) && lastDecision.action !== 'HOLD' && (
                                        <Button 
                                            onClick={quant.executeManualDecision} 
                                            className="w-full bg-foreground text-background hover:bg-foreground/90 font-bold"
                                        >
                                            {isShadowMode ? 'Simular Ordem Sombra' : 'Autorizar Investimento'}
                                        </Button>
                                    )}
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
                                <Cpu className="h-4 w-4" /> Telemetria Tick-to-Trade
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-xs">
                             <div className="flex justify-between">
                                <span className="text-muted-foreground">Inference Delay:</span>
                                <span className="font-mono font-bold">{telemetry.latency}ms</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Tokens/Sec:</span>
                                <span className="font-mono font-bold">{telemetry.tps}</span>
                            </div>
                            <div className="flex justify-between text-primary font-bold">
                                <span className="">T2T Confirmed:</span>
                                <span className="font-mono">{telemetry.t2t}ms</span>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-muted/30 border-border font-mono overflow-hidden shadow-inner flex-1">
                        <div className="bg-card/50 px-4 py-2 flex items-center justify-between border-b border-border">
                            <span className="text-[10px] font-bold text-muted-foreground flex items-center gap-2">
                                <TerminalIcon className="h-3 w-3" /> REASONING LOG
                            </span>
                        </div>
                        <CardContent className="p-0">
                            <ScrollArea className="h-48 p-4 text-[10px] leading-relaxed">
                                {reasoningLog.map((log, i) => (
                                    <div key={i} className="mb-1 border-l-2 border-border pl-2">
                                        <span className="text-muted-foreground/60">[{log.time}]</span>{' '}
                                        <span className={cn(
                                            "font-medium",
                                            log.type === 'decision' ? "text-primary font-bold" : 
                                            log.type === 'execution' ? "text-green-600 font-bold" : 
                                            log.type === 'radar' ? "text-blue-500" : "text-muted-foreground"
                                        )}>
                                            {log.message}
                                        </span>
                                    </div>
                                ))}
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Reiniciar Sessão Operacional?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta ação irá zerar o P&L da sessão, limpar o radar sombra e resetar as travas de circuit breaker. Deseja continuar?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => {
                            resetSession();
                            setShowResetConfirm(false);
                        }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Reiniciar do Zero
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function renderTradeList(trades: any[], formatCurrency: (v: number) => string) {
    if (trades.length === 0) {
        return (
            <div className="p-8 text-center text-muted-foreground opacity-40">
                <Activity className="h-8 w-8 mx-auto mb-2" />
                <p className="text-[10px] font-mono uppercase">Sem atividade registrada</p>
            </div>
        );
    }
    return (
        <div className="divide-y divide-border">
            {trades.map((op) => (
                <div key={op.id} className="p-3 hover:bg-muted/10 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                            {op.direction === 'rise' ? (
                                <ArrowUpCircle className="h-3.5 w-3.5 text-green-600" />
                            ) : (
                                <ArrowDownCircle className="h-3.5 w-3.5 text-destructive" />
                            )}
                            <span className="text-[10px] font-black uppercase font-mono">{op.asset}</span>
                        </div>
                        <Badge variant={op.status === 'won' ? 'default' : op.status === 'lost' ? 'destructive' : 'outline'} className="text-[8px] h-4 py-0 px-1 font-bold">
                            {op.status.toUpperCase()}
                        </Badge>
                    </div>
                    <div className="flex justify-between text-[10px] font-mono leading-tight">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground">Stake: {formatCurrency(Number(op.stake))}</span>
                            <span className={cn(
                                "font-bold",
                                (Number(op.result) || 0) >= 0 ? "text-green-600" : "text-destructive"
                            )}>
                                PnL: {formatCurrency(Number(op.result) || -Number(op.stake))}
                            </span>
                        </div>
                        <div className="text-right text-muted-foreground flex flex-col gap-0.5">
                            <span className="flex items-center justify-end gap-1 font-bold"><Clock className="h-2.5 w-2.5" /> {new Date(op.timestamp).toLocaleTimeString()}</span>
                            <span className="italic opacity-70">{op.strategy?.split('_')[0] || 'Auto'}</span>
                        </div>
                    </div>
                </div>
            ))}
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
