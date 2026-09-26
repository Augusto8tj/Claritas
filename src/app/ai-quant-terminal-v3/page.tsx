
'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { 
    BrainCircuit, Zap, ShieldCheck, Terminal as TerminalIcon, 
    Timer, LineChart, PlayCircle, PauseCircle, Cpu, RefreshCw,
    Database, Activity, History, ArrowUpCircle, ArrowDownCircle,
    TestTube, Scale, Brain, Trash2, Radar, TrendingUp, TrendingDown, 
    Minus, Check, ChevronsUpDown, Settings2, Wallet, Target, Layers,
    MessageSquare, Send, Gauge, Laptop
} from "lucide-react";
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 as AssetSelector } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { useAIQuantTerminalV3, type AllowedContractsV3 } from "@/features/trading/hooks/use-ai-quant-terminal-v3";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function TerminalV3Content() {
    const { 
        activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading, 
        chartData, isConnected, operationsLog, tradeAnnotations, priceTicks,
        isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod,
        accountType, accountBalance
    } = useDerivApi();

    const v3 = useAIQuantTerminalV3(activeSymbol, priceTicks, chartData as any);
    const { 
        lastDecision, reasoningLog, memoryBuffer, isAutoMode, isShadowMode, 
        timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        radarStatus, watchedSymbols, setWatchedSymbols, resetSession,
        allowedContracts, setAllowedContracts, maxConcurrentTrades, setMaxConcurrentTrades,
        stakeValue, setStakeValue, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
        sessionStats, chatMessages, isChatLoading, sendMessage, telemetry
    } = v3;

    const [isSelectorOpen, setIsSelectorOpen] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [chatTarget, setChatTarget] = useState('CHAIRMAN');
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
            sendMessage(chatInput, chatTarget);
            setChatInput('');
        }
    };

    return (
        <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6 bg-background min-h-screen text-foreground">
            
            {/* RADAR SUPERIOR */}
            <Card className="bg-purple-500/5 border-purple-500/20 shadow-sm overflow-hidden">
                <CardHeader className="py-3 px-6 bg-purple-500/10 border-b border-purple-500/20 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-purple-700">
                        <Radar className="h-4 w-4 animate-spin-slow" /> Radar do Conselho Multi-Persona
                    </CardTitle>
                    <div className="flex items-center gap-4">
                        <Popover open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7 text-[10px] uppercase font-bold border-purple-200">
                                    Configurar Monitoramento <ChevronsUpDown className="ml-2 h-3 w-3" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[300px] p-0" align="end">
                                <Command>
                                    <CommandInput placeholder="Filtrar ativos..." />
                                    <CommandList>
                                        <CommandEmpty>Nenhum ativo encontrado.</CommandEmpty>
                                        {assetGroups.map((group) => (
                                            <CommandGroup key={group.label} heading={group.label}>
                                                {group.options.map((asset) => (
                                                    <CommandItem
                                                        key={asset.value}
                                                        onSelect={() => {
                                                            const newSymbols = watchedSymbols.includes(asset.value)
                                                                ? watchedSymbols.filter(s => s !== asset.value)
                                                                : [...watchedSymbols, asset.value];
                                                            setWatchedSymbols(newSymbols);
                                                        }}
                                                    >
                                                        <Check className={cn("mr-2 h-4 w-4", watchedSymbols.includes(asset.value) ? "opacity-100" : "opacity-0")} />
                                                        {asset.label}
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        ))}
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                        <Badge variant="outline" className="text-[9px] border-purple-500/30 text-purple-700 uppercase">
                            {watchedSymbols.length} Ativos em Scan
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {watchedSymbols.map((symbol) => {
                            const status = radarStatus[symbol];
                            return (
                                <div 
                                    key={symbol} 
                                    onClick={() => setActiveSymbol(symbol)}
                                    className={cn(
                                        "p-3 rounded-lg border transition-all cursor-pointer group hover:scale-105",
                                        symbol === activeSymbol ? "bg-purple-600 border-purple-600 text-white shadow-md" : "bg-card border-border hover:border-purple-400",
                                        status?.isQualified && symbol !== activeSymbol && "animate-pulse border-green-500 bg-green-50/10"
                                    )}
                                >
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[10px] font-bold font-mono">{symbol}</span>
                                        {status?.isQualified && <Zap className="h-3 w-3 text-yellow-500 fill-current" />}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {status?.lastAction === 'RISE' ? <TrendingUp className="h-4 w-4 text-green-500" /> : 
                                         status?.lastAction === 'FALL' ? <TrendingDown className="h-4 w-4 text-red-500" /> : 
                                         <Minus className="h-4 w-4 text-muted-foreground" />}
                                        <span className="text-sm font-black">{status?.lastAction || 'SCAN'}</span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-[9px] opacity-60">
                                        <span className="truncate">{status?.executedVia || 'Monitorando...'}</span>
                                        <span className="font-mono">{status?.confidence ? `${status.confidence.toFixed(0)}%` : '--'}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* HEADER */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
                <div className="flex items-center gap-3">
                    <div className="bg-purple-500/10 p-2 rounded-xl border border-purple-500/20 shadow-sm">
                        <TestTube className="h-8 w-8 text-purple-600 animate-pulse" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight font-headline text-purple-700">Quant Lab V3.0</h1>
                        <div className="flex items-center gap-2">
                             <Badge variant="secondary" className="font-mono text-xs flex items-center gap-1.5">
                                <Wallet className="h-3 w-3"/> {accountBalance.loading ? '...' : formatCurrency(accountBalance.balance || 0)}
                             </Badge>
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
                {/* COLUNA ESQUERDA: CONTROLE DO CONSELHO */}
                <div className="lg:col-span-1 space-y-6">
                    <Card className="border-purple-200 bg-purple-50/10 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-purple-600 flex items-center gap-2">
                                <Zap className="h-4 w-4" /> Cockpit do Laboratório
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between p-3 rounded-lg bg-card border shadow-sm">
                                <Label htmlFor="shadow-mode" className="flex flex-col gap-0.5">
                                    <span className="text-xs font-bold uppercase">Modo Sombra</span>
                                    <span className="text-[10px] text-muted-foreground">Simular execuções no background</span>
                                </Label>
                                <Switch id="shadow-mode" checked={isShadowMode} onCheckedChange={v3.toggleShadowMode} />
                            </div>

                            <div className="space-y-3 p-3 rounded-lg border border-purple-200 bg-card/50">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-muted-foreground flex items-center gap-1.5"><Timer className="h-3.5 w-3.5"/> Ciclo de Análise</span>
                                    <span className="font-mono text-purple-700 font-bold">{analysisInterval}s</span>
                                </div>
                                <Slider 
                                    value={[analysisInterval]} 
                                    min={30} max={3000} step={30} 
                                    onValueChange={(v) => setAnalysisInterval(v[0])}
                                    disabled={isAutoMode}
                                />
                                <div className="space-y-1.5 pt-2">
                                    <div className="flex justify-between text-[10px] text-muted-foreground uppercase font-bold">
                                        <span>Execução em</span>
                                        <span>{timeToNextAnalysis}s</span>
                                    </div>
                                    <Progress value={(timeToNextAnalysis / analysisInterval) * 100} className="h-1" />
                                </div>
                            </div>

                            <div className="space-y-3 p-3 rounded-lg border border-purple-200 bg-card/50">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                                    <Layers className="h-3 w-3" /> Contratos Permitidos
                                </Label>
                                <div className="grid grid-cols-2 gap-2">
                                    {Object.keys(allowedContracts).map((contract) => (
                                        <div key={contract} className="flex items-center space-x-2">
                                            <Checkbox 
                                                id={`contract-${contract}`} 
                                                checked={allowedContracts[contract as keyof AllowedContractsV3]}
                                                onCheckedChange={(checked) => {
                                                    setAllowedContracts(prev => ({ ...prev, [contract]: !!checked }));
                                                }}
                                                disabled={isAutoMode}
                                            />
                                            <Label htmlFor={`contract-${contract}`} className="text-[10px] font-medium leading-none cursor-pointer">
                                                {contract.replace('_', '/')}
                                            </Label>
                                        </div>
                                    ))}
                                </div>
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

                    {/* MONITOR DE TELEMETRIA QUANT (NERD STATS) */}
                    <Card className="bg-slate-950 text-slate-300 border-slate-800 shadow-xl overflow-hidden font-mono">
                        <CardHeader className="py-3 bg-slate-900 border-b border-slate-800">
                             <CardTitle className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 text-cyan-500">
                                <Gauge className="h-3.5 w-3.5" /> Ollama Telemetry (Nerd Stats)
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 space-y-4 text-[11px]">
                             <div className="space-y-2">
                                <div className="flex justify-between">
                                    <span className="opacity-60 uppercase">Hardware Pressure:</span>
                                    <span className={cn("font-bold", telemetry.avgTokensPerSec > 40 ? "text-green-500" : "text-amber-500")}>
                                        {telemetry.avgTokensPerSec.toFixed(1)} <span className="text-[9px]">TOK/S</span>
                                    </span>
                                </div>
                                <Progress value={telemetry.avgTokensPerSec * 2} className="h-1 bg-slate-800" indicatorClassName="bg-cyan-500" />
                            </div>

                            <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-3">
                                <div className="space-y-1">
                                    <p className="opacity-50 uppercase text-[9px]">Entropy H(x):</p>
                                    <p className={cn("text-xs font-bold", telemetry.consensusEntropy < 0.4 ? "text-green-500" : "text-red-500")}>
                                        {telemetry.consensusEntropy.toFixed(3)}
                                    </p>
                                </div>
                                <div className="space-y-1">
                                    <p className="opacity-50 uppercase text-[9px]">V-Jitter:</p>
                                    <p className="text-xs font-bold text-slate-100">{telemetry.jitterMs}ms</p>
                                </div>
                            </div>

                            <div className="space-y-1.5 border-t border-slate-800 pt-3">
                                <div className="flex justify-between items-center">
                                    <span className="opacity-60 text-[9px] uppercase">Node Health:</span>
                                    <span className="font-bold text-green-500">{telemetry.inferenceHealth}%</span>
                                </div>
                                <div className="flex gap-0.5">
                                    {Array.from({ length: 10 }).map((_, i) => (
                                        <div key={i} className={cn("h-2 flex-1 rounded-sm", i < (telemetry.inferenceHealth/10) ? "bg-green-500" : "bg-slate-800")} />
                                    ))}
                                </div>
                            </div>
                            
                            <p className="text-[9px] text-slate-500 italic mt-2">
                                [STRICT] Entropy > 0.7 triggers stake penalty.
                            </p>
                        </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <Activity className="h-4 w-4" /> Gestão de Risco & PnL
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
                                        value={stakeValue} 
                                        onChange={(e) => setStakeValue(Number(e.target.value))}
                                        className="h-8 text-xs font-mono bg-background/50"
                                        disabled={isAutoMode}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                                        <Target className="h-3 w-3" /> Máx Ordens
                                    </Label>
                                    <Input 
                                        type="number" 
                                        value={maxConcurrentTrades} 
                                        onChange={(e) => setMaxConcurrentTrades(Number(e.target.value))}
                                        className="h-8 text-xs font-mono bg-background/50"
                                        disabled={isAutoMode}
                                    />
                                </div>
                            </div>
                            
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
                                onClick={resetSession}
                            >
                                <RefreshCw className="h-4 w-4" />
                                Reiniciar Laboratório
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* COLUNA CENTRAL: GRÁFICO E CHAT */}
                <div className="lg:col-span-2 space-y-6">
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

                    {/* INTERAÇÃO COM O CONSELHO (CHAT) */}
                    <Card className="bg-card border-border h-[400px] flex flex-col shadow-sm">
                        <CardHeader className="py-3 border-b border-border bg-purple-50/10">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <MessageSquare className="h-4 w-4 text-purple-600" />
                                    Diálogo com o Conselho V3
                                </CardTitle>
                                <Select value={chatTarget} onValueChange={setChatTarget}>
                                    <SelectTrigger className="h-7 w-[160px] text-[10px] font-bold uppercase border-purple-200">
                                        <SelectValue placeholder="Destinatário" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="CHAIRMAN">Chairman (Líder)</SelectItem>
                                        <SelectItem value="MOMENTUM">Quant Momentum</SelectItem>
                                        <SelectItem value="RISK_CRITIC">Risk Critic</SelectItem>
                                        <SelectItem value="ARCHIVIST">Pattern Archivist</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-hidden p-0 relative bg-muted/5">
                            <ScrollArea className="h-full p-4">
                                <div className="space-y-4">
                                    {chatMessages.length === 0 && (
                                        <div className="text-center py-10 opacity-30">
                                            <Brain className="h-10 w-10 mx-auto mb-2 text-purple-600"/>
                                            <p className="text-xs font-mono">Conselho aguardando instruções...</p>
                                        </div>
                                    )}
                                    {chatMessages.map((msg, i) => (
                                        <div key={i} className={cn(
                                            "flex flex-col max-w-[85%] rounded-lg p-3 text-xs leading-relaxed border shadow-sm",
                                            msg.role === 'user' ? "bg-primary/10 ml-auto border-primary/20" : "bg-card mr-auto border-border"
                                        )}>
                                            <span className="font-bold uppercase text-[9px] mb-1 opacity-50 flex items-center gap-2">
                                                {msg.role === 'user' ? 'OPERADOR' : (msg.agentName || 'CONSELHO')} • {msg.time}
                                                {msg.role === 'assistant' && <Badge variant="outline" className="h-3 text-[7px] py-0 px-1 border-purple-200">Verified</Badge>}
                                            </span>
                                            <p className="font-mono text-foreground">{msg.content}</p>
                                        </div>
                                    ))}
                                    {isChatLoading && (
                                        <div className="flex items-center gap-2 text-xs text-purple-600 animate-pulse font-mono">
                                            <RefreshCw className="h-3 w-3 animate-spin"/> {chatTarget} está processando a resposta...
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
                                    placeholder={`Falar com ${chatTarget.toLowerCase()}...`}
                                    className="bg-background border-border h-9 text-xs"
                                    disabled={isChatLoading}
                                />
                                <Button type="submit" size="icon" className="h-9 w-9 bg-purple-600 hover:bg-purple-700" disabled={isChatLoading || !chatInput.trim()}>
                                    <Send className="h-4 w-4" />
                                </Button>
                            </form>
                        </CardFooter>
                    </Card>
                </div>

                {/* COLUNA DIREITA: VEREDITO E MEMÓRIA */}
                <div className="lg:col-span-1 space-y-6">
                    <Card className="border-purple-600/30 shadow-md">
                        <CardHeader className="bg-purple-600/5 border-b py-3">
                            <CardTitle className="text-sm flex items-center gap-2 text-purple-600">
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
                                    {isShadowMode && lastDecision.finalAction !== 'HOLD' && (
                                        <Button 
                                            onClick={v3.executeManualDecision} 
                                            className="w-full bg-purple-600 text-white hover:bg-purple-700 font-bold"
                                        >
                                            Simular Ordem Sombra
                                        </Button>
                                    )}
                                </>
                            ) : (
                                <div className="text-center py-10 opacity-30">
                                    <RefreshCw className="h-10 w-10 mx-auto mb-2 animate-spin" />
                                    <p className="text-xs font-mono uppercase tracking-widest">Sincronizando Conselho...</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="shadow-sm border-purple-100">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <Database className="h-4 w-4" /> Memória de Curto Prazo
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="p-3 rounded-lg bg-green-50/50 border border-green-100 text-center">
                                    <span className="text-[10px] uppercase font-bold text-green-600 block mb-1">Wins</span>
                                    <p className="text-lg font-black text-green-700">{memoryBuffer.wins.length}/20</p>
                                </div>
                                <div className="p-3 rounded-lg bg-red-50/50 border border-red-100 text-center">
                                    <span className="text-[10px] uppercase font-bold text-red-600 block mb-1">Losses</span>
                                    <p className="text-lg font-black text-red-700">{memoryBuffer.losses.length}/20</p>
                                </div>
                            </div>
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
