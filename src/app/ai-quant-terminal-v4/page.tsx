// src/app/ai-quant-terminal-v4/page.tsx
'use client';

/**
 * @fileOverview TERMINAL QUANT V4.2 - CRYPTO LAB (SUPREME EDITION)
 * V13: Integrado controle de Piloto Demo e Dashboard de Execução.
 * V5.8: Calibração Lead-Lag e Telemetria Observed vs Expected.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { 
    BrainCircuit, Zap, ShieldCheck, Terminal as TerminalIcon, 
    Timer, LineChart, PlayCircle, PauseCircle, Cpu, RefreshCw,
    Database, Activity, History, ArrowUpCircle, ArrowDownCircle,
    Radar, TrendingUp, TrendingDown, 
    Minus, Plus, Check, ChevronsUpDown, Wallet, Target, Layers,
    MessageSquare, Send, Gauge, Brain, AlertCircle, ShieldAlert, Lock, SlidersHorizontal, ChevronRight, Copy, FilePieChart, Loader2, X,
    TestTube, HardDrive, Info, ShieldX, User as UserIcon, Shield
} from "lucide-react";
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi, type AccountType } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 as AssetSelector } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { useCryptoRadarV4, type StrategicProfile } from "@/features/trading/hooks/use-crypto-radar-v4";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RadarResilienceBadges } from '@/components/RadarResilienceBadges';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Asset, Operation } from '@/lib/types';
import { buildLeadLagReport } from '@/features/trading/services/report-builders';

type AssetGroup = { label: string; options: Asset[] };

function CryptoLabContent() {
    const { 
        activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading, 
        chartData, isConnected, operationsLog, tradeAnnotations, priceTicks,
        isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod,
        accountType, accountBalance, setAccountType, watchedSymbols, setWatchedSymbols
    } = useDerivApi();

    const { toast } = useToast();
    const v4 = useCryptoRadarV4(activeSymbol, priceTicks, chartData as any);
    
    const { 
        lastDecision, reasoningLog, memoryBuffer, isAutoMode, toggleAutoMode, 
        pilotMode, setPilotMode,
        isShadowMode, toggleShadowMode, radarStatus, telemetry, sendMessage, 
        isChatLoading, chatMessages, strategicProfile, setStrategicProfile,
        confidenceThreshold, setConfidenceThreshold, analysisInterval, setAnalysisInterval, 
        resilience, stakeValue, setStakeValue,
        dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
        maxConcurrentTrades, setMaxConcurrentTrades,
        multiplier, setMultiplier,
        allowedActions, setAllowedActions, allowedContracts, setAllowedContracts,
        councilStats, runBacktest, runLeadLagBacktest, backtest, buildBacktestReport, staleMinutes,
        ollamaConfig, availableModels, updateOllamaConfig, fetchAvailableModels,
        resetSession, sessionStats, lockedProfitFloor, calibration
    } = v4;

    const [isSelectorOpen, setIsSelectorOpen] = useState(false);
    const [isBacktestSelectorOpen, setIsBacktestSelectorOpen] = useState(false);
    const [logFilter, setLogFilter] = useState<'all' | 'decision' | 'sentinel' | 'execution' | 'error'>('all');
    const [expandedLogTs, setExpandedLogTs] = useState<string | null>(null);
    const [chatInput, setChatInput] = useState('');
    const [chatTarget, setChatTarget] = useState('CHAIRMAN');

    const [payoutInput, setPayoutInput] = useState(85);
    const [targetCount, setTargetCount] = useState(40000);
    const [extraBacktestSymbols, setExtraBacktestSymbols] = useState<string[]>([]);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = useCallback(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, []);

    useEffect(() => { scrollToBottom(); }, [chatMessages, isChatLoading, scrollToBottom]);

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

    const filteredLogs = useMemo(() => {
        if (logFilter === 'all') return reasoningLog;
        if (logFilter === 'error') return (reasoningLog as any[]).filter((l: any) => l.type === 'error' || l.type === 'warning');
        return (reasoningLog as any[]).filter((l: any) => l.type === logFilter);
    }, [reasoningLog, logFilter]);

    const handleChatSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (chatInput.trim()) {
            sendMessage(chatInput, chatTarget);
            setChatInput('');
        }
    };

    const handleRunBacktest = useCallback(async () => {
        const uniqueSymbols = Array.from(new Set([...watchedSymbols, ...extraBacktestSymbols])).filter(s => !!s);
        
        if (uniqueSymbols.length === 0) {
            toast({
                title: "Ativos necessários",
                description: "Selecione pelo menos um ativo para rodar o backtest.",
                variant: "destructive"
            });
            return;
        }

        await runBacktest(uniqueSymbols, payoutInput, targetCount);
    }, [runBacktest, watchedSymbols, extraBacktestSymbols, payoutInput, targetCount, toast]);

    const copyLogs = () => {
        const text = (filteredLogs as any[]).map((l: any) => `[${l.time}] ${l.message}`).join('\n');
        navigator.clipboard.writeText(text);
        toast({ title: "Logs copiados!" });
    };

    const renderMessageContent = (content: string) => {
        const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
        const match = content.match(thinkRegex);

        if (match) {
            const thinkText = match[1].trim();
            const mainContent = content.replace(thinkRegex, '').trim();
            return (
                <div className="space-y-2">
                    <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="think" className="border-none">
                            <AccordionTrigger className="py-1 px-2 text-[10px] bg-orange-500/5 hover:bg-orange-500/10 rounded-md hover:no-underline text-orange-600 font-bold uppercase tracking-widest">
                                <div className="flex items-center gap-2">
                                    <Brain className="h-3 w-3" /> Raciocínio Interno (Deep Think)
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-2 px-2 text-[11px] font-mono text-muted-foreground border-l-2 border-orange-500/30 whitespace-pre-wrap leading-relaxed">
                                {thinkText}
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                    <p className="font-mono whitespace-pre-wrap">{mainContent}</p>
                </div>
            );
        }
        return <p className="font-mono whitespace-pre-wrap">{content}</p>;
    };

    return (
        <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6 bg-background min-h-screen text-foreground">
            
            {/* RADAR DE GRAVIDADE BITCOIN V5 */}
            <Card className="bg-orange-500/5 border-orange-500/20 shadow-sm overflow-hidden">
                <CardHeader className="py-3 px-6 bg-orange-500/10 border-b border-orange-500/20 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-orange-700">
                        <Radar className="h-4 w-4 animate-spin-slow" /> Radar de Gravidade Bitcoin V5 (Supreme)
                    </CardTitle>
                    <div className="flex items-center gap-4">
                        <Popover open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7 text-[10px] uppercase font-bold border-orange-200">
                                    Selecionar Ativos <ChevronsUpDown className="ml-2 h-4 w-4" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[300px] p-0" align="end">
                                <Command>
                                    <CommandInput placeholder="Filtrar criptos..." />
                                    <CommandList>
                                        <CommandEmpty>Nenhum ativo encontrado.</CommandEmpty>
                                        {(assetGroups as any).map((group: AssetGroup) => (
                                            <CommandGroup key={group.label} heading={group.label}>
                                                {group.options.map((asset: Asset) => (
                                                    <CommandItem
                                                        key={asset.value}
                                                        onSelect={() => {
                                                            const newSymbols = watchedSymbols.includes(asset.value)
                                                                ? watchedSymbols.filter((s: string) => s !== asset.value)
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
                        <Badge variant="outline" className="text-[9px] border-orange-500/30 text-orange-700 uppercase">
                            cryBTCUSD LÍDER ATIVO
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {watchedSymbols.map((symbol: any) => {
                            const status = radarStatus[symbol];
                            const gravity = status?.gravity;
                            const isStable = resilience.checkStability(symbol);
                            const rigor = resilience.thresholds[symbol] || 0.65;
                            const min = staleMinutes(symbol);
                            const isStale = min !== null && min > 2.5;

                            return (
                                <div 
                                    key={String(symbol)} 
                                    onClick={() => setActiveSymbol(symbol)}
                                    className={cn(
                                        "p-3 rounded-lg border transition-all cursor-pointer group hover:scale-105",
                                        symbol === activeSymbol ? "bg-orange-600 border-orange-600 text-white shadow-md" : "bg-card border-border hover:border-orange-400",
                                        status?.isQualified && !isStale && symbol !== activeSymbol && "animate-pulse border-green-500 bg-green-50/10",
                                        isStale && "opacity-60 grayscale-[0.5]"
                                    )}
                                >
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[10px] font-bold font-mono">{String(symbol)}</span>
                                        {gravity?.isBtcExploding && !isStale && <Zap className="h-3 w-3 text-yellow-400 fill-current animate-pulse" />}
                                        {isStale && <Badge variant="outline" className="h-3.5 px-1 text-[8px] bg-red-50 text-red-600 border-red-200">OFFLINE</Badge>}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {isStale ? (
                                            <Minus className="h-4 w-4 text-muted-foreground" />
                                        ) : (
                                            <>
                                                {status?.finalAction === 'CALL' || status?.finalAction === 'MULTUP' ? <TrendingUp className="h-4 w-4 text-green-500" /> : 
                                                 status?.finalAction === 'FALL' || status?.finalAction === 'PUT' ? <TrendingDown className="h-4 w-4 text-red-500" /> : 
                                                 <Minus className="h-4 w-4 text-muted-foreground" />}
                                            </>
                                        )}
                                        <span className="text-sm font-black">{isStale ? 'FECHADO' : (status?.finalAction || 'SCAN')}</span>
                                    </div>
                                    
                                    {!isStale && <RadarResilienceBadges rigor={rigor} isStable={isStable} />}

                                    <div className="mt-2 pt-2 border-t border-current/10 space-y-1">
                                        {status?.isQualified ? (
                                            <Badge variant="outline" className="text-green-600 border-green-200 flex gap-1 items-center font-bold">
                                                <ShieldCheck className="h-3 w-3" /> PRONTO PARA LIVE
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-red-600 border-red-200 flex gap-1 items-center font-bold">
                                                <ShieldX className="h-3 w-3" /> BLOQUEIO: RIGOR
                                            </Badge>
                                        )}
                                    </div>

                                    {gravity && !isStale && (
                                        <div className="mt-2 pt-2 border-t border-current/10 space-y-1">
                                            <div className="flex justify-between text-[8px] uppercase font-black">
                                                <span className="opacity-70">Pearson Corr:</span>
                                                <span className={cn(gravity.correlation > 0.8 ? "text-green-500" : "text-muted-foreground")}>
                                                    {gravity.correlation.toFixed(2)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between text-[8px] uppercase font-black">
                                                <span className="opacity-70">Beta Dyn:</span>
                                                <span className="text-primary">{gravity.beta.toFixed(2)}</span>
                                            </div>
                                            {gravity.slingshotDetected && (
                                                <Badge className="w-full text-[7px] bg-purple-600 h-3 py-0">SLINGSHOT_READY</Badge>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* HEADER CANÔNICO V5 */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
                <div className="flex items-center gap-3">
                    <div className="bg-orange-500/10 p-2 rounded-xl border border-orange-500/20 shadow-sm">
                        <Zap className="h-8 w-8 text-orange-600 animate-pulse" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight font-headline text-orange-700">Crypto Lab V4.2 (Supreme)</h1>
                        <div className="flex items-center gap-2">
                             <Badge variant="outline" className="font-mono text-xs flex items-center gap-1.5">
                                <Wallet className="h-3 w-3"/> P&L: {formatCurrency(sessionStats.pnl)}
                             </Badge>
                             {lockedProfitFloor > 0 && (
                                 <Badge variant="outline" className="font-mono text-xs flex items-center gap-1.5 border-green-600 text-green-600">
                                    <Lock className="h-3 w-3"/> Floor: {formatCurrency(lockedProfitFloor)}
                                 </Badge>
                             )}
                             <Badge className={cn("text-[10px] font-bold shadow-sm border", pilotMode === 'SHADOW' ? "bg-purple-600 text-white" : "bg-red-600 text-white")}>
                                {pilotMode === 'SHADOW' ? 'SHADOW TESTING' : 'DEMO LIVE ACTIVE'}
                             </Badge>
                        </div>
                    </div>
                </div>
                <div className="flex wrap items-center gap-4">
                    <ToggleGroup 
                        type="single" 
                        value={accountType} 
                        onValueChange={(v: AccountType) => v && setAccountType(v)} 
                        className="bg-muted p-1 rounded-lg border border-border"
                        disabled={isAutoMode}
                    >
                        <ToggleGroupItem value="demo" className="text-[10px] h-7 px-3 font-bold uppercase">Demo</ToggleGroupItem>
                        <ToggleGroupItem value="real" className="text-[10px] h-7 px-3 font-bold uppercase" disabled>Real (Bloqueado)</ToggleGroupItem>
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

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* COLUNA ESQUERDA */}
                <div className="lg:col-span-3 space-y-6">
                    <Card className="border-orange-200 bg-orange-50/10 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-orange-600 flex items-center gap-2">
                                <Zap className="h-4 w-4" /> Cockpit do Laboratório
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-3">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Modo de Operação do Piloto</Label>
                                <ToggleGroup 
                                    type="single" 
                                    value={pilotMode} 
                                    onValueChange={(v: any) => v && setPilotMode(v)}
                                    className="grid grid-cols-2 gap-1"
                                    disabled={isAutoMode}
                                >
                                    <ToggleGroupItem value="SHADOW" className="text-[10px] h-7">SHADOW</ToggleGroupItem>
                                    <ToggleGroupItem value="DEMO_LIVE" className="text-[10px] h-7 border-red-200 text-red-600">DEMO LIVE</ToggleGroupItem>
                                </ToggleGroup>
                            </div>

                            <div className="space-y-3">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Perfil Estratégico (Conselho)</Label>
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

                            <div className="space-y-4 p-3 rounded-lg border border-orange-200 bg-card/50">
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-muted-foreground flex items-center gap-1.5"><BrainCircuit className="h-3.5 w-3.5"/> Confiança Mínima</span>
                                        <span className="font-mono text-orange-700 font-bold">{confidenceThreshold}%</span>
                                    </div>
                                    <Slider value={[confidenceThreshold]} min={40} max={95} step={5} onValueChange={(v: any) => setConfidenceThreshold(v[0])} disabled={isAutoMode} />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-muted-foreground flex items-center gap-1.5"><Timer className="h-3.5 w-3.5"/> Ciclo de Análise</span>
                                        <span className="font-mono text-orange-700 font-bold">{analysisInterval}s</span>
                                    </div>
                                    <Slider value={[analysisInterval]} min={15} max={600} step={15} onValueChange={(v: any) => setAnalysisInterval(v[0])} disabled={isAutoMode} />
                                </div>
                            </div>

                            <Button onClick={toggleAutoMode} className={cn("w-full h-12 font-bold shadow-md", isAutoMode ? "bg-destructive text-white" : "bg-orange-600 text-white hover:bg-orange-700")}>
                                {isAutoMode ? <PauseCircle className="mr-2 h-5 w-5" /> : <PlayCircle className="mr-2 h-5 w-5" />}
                                {isAutoMode ? 'Parar Automação' : 'Ativar Piloto V14'}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="bg-muted/30 border-orange-200 shadow-inner">
                        <CardHeader className="py-3 bg-orange-600/5 border-b border-orange-200">
                             <CardTitle className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 text-orange-700">
                                <Shield className="h-3.5 w-3.5" /> Estatísticas do Piloto
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 space-y-3 text-[11px]">
                             <div className="flex justify-between items-center">
                                <span className="opacity-60 uppercase">Divergência Shadow/Demo:</span>
                                <Badge variant="outline" className="text-[10px] h-4 font-mono">0.12%</Badge>
                             </div>
                             <Separator className="opacity-50" />
                             {calibration ? (
                                <div className="space-y-2">
                                    <p className="text-primary font-bold uppercase text-[9px]">Calibração Ativa (V5.8):</p>
                                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                                        <span>zBtc: {calibration.zBtc}</span>
                                        <span>zMax: {calibration.zTargetMax}</span>
                                        <span>Corr: {calibration.corrMin}</span>
                                        <span>WR (BT): {(calibration.testWinRate * 100).toFixed(1)}%</span>
                                    </div>
                                </div>
                             ) : (
                                <p className="text-destructive font-black text-[9px] animate-pulse uppercase">⚠️ Sistema não calibrado</p>
                             )}
                        </CardContent>
                    </Card>

                    <Card className="bg-card/50 border-border shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <ShieldAlert className="h-4 w-4 text-orange-600" /> Governança de Risco
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] uppercase font-black text-muted-foreground flex items-center gap-1">
                                        <Target className="h-3 w-3" /> Banca (USD)
                                    </Label>
                                    <Input 
                                        type="number" 
                                        value={dailyBalance} 
                                        onChange={(e) => setDailyBalance(parseFloat(e.target.value) || 10)} 
                                        className="h-8 font-mono text-xs text-center" 
                                        disabled={isAutoMode} 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] uppercase font-black text-muted-foreground flex items-center gap-1">
                                        <TrendingUp className="h-3 w-3" /> Meta (USD)
                                    </Label>
                                    <Input 
                                        type="number" 
                                        value={dailyTarget} 
                                        onChange={(e) => setDailyTarget(parseFloat(e.target.value) || 5)} 
                                        className="h-8 font-mono text-xs text-center" 
                                        disabled={isAutoMode} 
                                    />
                                </div>
                            </div>
                            
                            {lockedProfitFloor > 0 && (
                                <Alert className="bg-green-600/10 border-green-600/20 py-2">
                                    <Lock className="h-3 w-3 text-green-600" />
                                    <AlertDescription className="text-[10px] font-bold text-green-700 uppercase">
                                        Piso Protegido: {formatCurrency(lockedProfitFloor)}
                                    </AlertDescription>
                                </Alert>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* COLUNA CENTRAL */}
                <div className="lg:col-span-6 space-y-6">
                    <Card className="min-h-[450px] shadow-sm">
                        <CardHeader className="py-3 border-b flex flex-row items-center justify-between">
                             <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-orange-600">
                                <LineChart className="h-4 w-4 text-orange-600" /> Ativo: {activeSymbol}
                            </CardTitle>
                            <Badge variant="outline" className="text-[10px] font-mono">{timePeriod}</Badge>
                        </CardHeader>
                        <CardContent className="p-0">
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

                    <Card className="bg-card border-border h-[400px] flex flex-col shadow-sm">
                        <CardHeader className="py-3 border-b border-border bg-orange-50/10">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm flex items-center gap-2 text-orange-700">
                                    <MessageSquare className="h-4 w-4 text-orange-600" />
                                    Interface de Diálogo Tático
                                </CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-hidden p-0 relative bg-muted/5">
                            <ScrollArea className="h-full p-4">
                                <div className="space-y-4">
                                    {(chatMessages as any[]).length === 0 && (
                                        <div className="text-center py-10 opacity-30">
                                            <Brain className="h-10 w-10 mx-auto mb-2 text-orange-600"/>
                                            <p className="text-xs font-mono">Aguardando comando institucional.</p>
                                        </div>
                                    )}
                                    {(chatMessages as any[]).map((msg: any, i: number) => (
                                        <div key={i} className={cn(
                                            "flex flex-col max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed border shadow-sm",
                                            msg.role === 'user' ? "bg-primary/10 ml-auto border-primary/20" : "bg-card mr-auto border-border"
                                        )}>
                                            <span className="font-bold uppercase text-[9px] mb-1 opacity-50">
                                                {msg.role === 'user' ? 'OPERADOR' : (msg.agentName || 'CIO')} • {msg.time}
                                            </span>
                                            {msg.role === 'assistant' ? renderMessageContent(msg.content) : <p className="font-mono whitespace-pre-wrap">{msg.content}</p>}
                                        </div>
                                    ))}
                                    <div ref={messagesEndRef} />
                                </div>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>

                {/* COLUNA DIREITA */}
                <div className="lg:col-span-3 space-y-6">
                    <Card className="border-orange-600/30 shadow-md">
                        <CardHeader className="bg-orange-600/5 border-b py-3">
                            <CardTitle className="text-sm flex items-center gap-2 text-orange-700">
                                <ShieldCheck className="h-4 w-4 text-orange-600" /> Chairman Veredict
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
                                        <p className="text-[10px] uppercase font-bold mb-1 opacity-70">Consenso ({lastDecision.executedVia})</p>
                                        <p className="text-3xl font-black">{lastDecision.finalAction}</p>
                                        <p className="text-xs mt-2 font-mono font-bold">Confiança: {lastDecision.consensusConfidence}%</p>
                                    </div>
                                    <div className="bg-muted/30 p-2 rounded border text-[10px] text-center uppercase font-bold">
                                        Motor: {lastDecision.recommendedContract}
                                    </div>
                                    <Button onClick={v4.executeManualDecision} className="w-full bg-orange-600 text-white font-bold" disabled={!lastDecision || lastDecision.finalAction === 'HOLD'}>
                                        Executar Sinal Manual
                                    </Button>
                                </>
                            ) : (
                                <div className="text-center py-10 opacity-30">
                                    <RefreshCw className="h-10 w-10 mx-auto mb-2 animate-spin" />
                                    <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Sincronizando...</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border-purple-600 shadow-sm bg-purple-50/5">
                        <CardHeader className="py-3 border-b flex flex-row items-center justify-between">
                            <CardTitle className="text-xs font-bold uppercase tracking-widest text-purple-700 flex items-center gap-2">
                                <TestTube className="h-4 w-4" /> Aprendizado Lead-Lag
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 space-y-4">
                            <div className="space-y-2">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Candles por ativo</Label>
                                <Select value={String(targetCount)} onValueChange={v => setTargetCount(Number(v))}>
                                    <SelectTrigger className="h-8 text-xs font-mono">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="20000">20k</SelectItem>
                                        <SelectItem value="40000">40k</SelectItem>
                                        <SelectItem value="60000">60k</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button 
                                onClick={() => runLeadLagBacktest(targetCount)} 
                                disabled={backtest.running}
                                size="sm"
                                className="w-full h-8 bg-purple-600 text-white font-bold"
                            >
                                {backtest.running ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rodar Lead-Lag BT"}
                            </Button>
                            
                            {backtest.leadLagReport && (
                                <div className="mt-4 p-3 bg-white rounded border border-purple-200">
                                    <p className="text-xs font-bold text-purple-700 mb-1">Veredito V5.8:</p>
                                    <p className="text-sm font-black uppercase">{backtest.leadLagReport.horizons[0].veredito}</p>
                                    <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        className="w-full h-7 mt-2 text-[10px] font-bold text-purple-600 border border-purple-100"
                                        onClick={() => {
                                            const report = buildLeadLagReport(backtest.leadLagReport);
                                            navigator.clipboard.writeText(report);
                                            toast({ title: "Relatório Copiado!" });
                                        }}
                                    >
                                        <Copy className="h-3 w-3 mr-1.5"/> Copiar Relatório
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="bg-muted/30 border-dashed font-mono shadow-inner border-orange-200 h-96 flex flex-col">
                        <CardHeader className="py-2 px-4 border-b bg-card/50 flex flex-row items-center justify-between">
                            <CardTitle className="text-[10px] flex items-center gap-2 uppercase tracking-widest font-bold text-muted-foreground">
                                <TerminalIcon className="h-3 w-3" /> Reasoning Engine
                            </CardTitle>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={copyLogs}>
                                <Copy className="h-3.5 w-3.5" />
                            </Button>
                        </CardHeader>
                        <CardContent className="p-0 flex-1 overflow-hidden relative">
                            <ScrollArea className="h-full p-4 text-[10px]">
                                {(filteredLogs as any[]).map((log: any) => (
                                    <div key={log.ts} className="mb-1.5 border-l-2 border-orange-500/30 pl-2">
                                        <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setExpandedLogTs(expandedLogTs === log.ts ? null : log.ts)}>
                                            <span className="opacity-40 shrink-0">[{log.time}]</span>{' '}
                                            <span className={cn(
                                                "font-medium break-words",
                                                log.type === 'decision' ? "text-orange-600 font-bold" : 
                                                log.type === 'execution' ? "text-green-600 font-bold" : 
                                                (log.type === 'error' || log.type === 'warning') ? "text-red-600" : "text-muted-foreground"
                                            )}>{log.message}</span>
                                        </div>
                                    </div>
                                ))}
                            </ScrollArea>
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



=====


// src/features/trading/hooks/use-crypto-radar-v4.tsx
'use client';

/**
 * @fileOverview TERMINAL QUANT V4.2 - CRYPTO LAB (SUPREME EDITION)
 * V13: Implementado Piloto Automático DEMO_LIVE com Guardrails, Payout Filter e HWM.
 * V5.6/V5.7: Alpha Decay Guard, Cálculo Real de EV (Veredito Institucional) e Resiliência Adaptativa.
 * V14: Hardening de Duração, Payout Dinâmico e Registro de Fechamento Automático.
 * V5.8: Calibração Lead-Lag Walk-Forward e Bloqueio de Piloto Não-Calibrado.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi, type AccountType } from './use-deriv-api-v2';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { TradeMemoryManager } from '../services/trade-memory-service';
import { runCryptoCouncil } from '../services/crypto-council-engine';
import { CouncilDecision, TradeMemoryBuffer, CouncilTelemetry, AssetExecutionPermission, PortfolioRiskState, AllowedContractsV3, AllowedActionsV3, RuleCalibration } from '../types/council';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../services/council-strategies';
import { evaluateCryptoSignals, type CryptoSignalFeatures, SENTINEL_MIN_SCORE } from '../services/crypto-signal-engine';
import { calculateBitcoinGravity, type BitcoinGravity } from '../services/crypto-gravity-engine';
import { useAdaptiveResilience } from '@/hooks/useAdaptiveResilience';
import { getOllamaResponse } from '@/app/actions';
import { useBacktestRunner } from './use-backtest-runner';
import { buildStatusReport, buildAssetReport, buildBacktestReport, buildShortContext } from '../services/report-builders';
import { CryptoShadowEngine } from '../services/crypto-shadow-engine';
import { buildAssetFeatures } from '../services/asset-features';
import { checkGuardrails, DEFAULT_GUARDRAILS, parseDurationToSeconds } from '../services/pilot-guardrails';
import { logLiveTrade, updateLiveTradeResult } from '../services/live-trade-log';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { CalibrationService } from '../services/calibration-service';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    time: string;
    agentName?: string;
    isError?: boolean;
}

export interface LogEntry {
    ts: string; 
    time: string;
    message: string;
    type: 'info' | 'decision' | 'execution' | 'error' | 'warning' | 'radar' | 'sentinel';
    details?: string[];
    symbol?: string;
}

export interface CouncilStats {
    total: number;
    call: number;
    put: number;
    hold: number;
    vetoes: number;
    fallbacks: number;
    avgLatencyMs: number;
}

export type StrategicProfile = 'conservative' | 'balanced' | 'aggressive';

const SETTINGS_KEY = 'cryptoLabV4Settings';
const DEFAULT_ANALYSIS_INTERVAL = 120;
const SHADOW_COOLDOWN_SEC = 60;

const AGENT_PERSONAS = {
  CHAIRMAN: "o CHAIRMAN do conselho supremo: sua resposta deve ser executiva, fundamentada no DOSSIER DE TELEMETRIA fornecido. Você sintetiza a decisão final.",
  MOMENTUM: "o analista QUANT MOMENTUM: sua função é calcular unicamente a força do preço usando RSI, ER e Mom5 do dossier. Ignore sentimentos, foque na velocidade.",
  RISK_CRITIC: "o RISK CRITIC: você é unicamente cético. Use o Beta, a Correlação e o Piso Travado para alertar sobre perigos de divergência ou ganância.",
  ARCHIVIST: "o PATTERN ARCHIVIST: você compara unicamente o snapshot atual com a MEMÓRIA DE APRENDIZADO injetada. Identifique se este setup já falhou antes."
};

/**
 * Calcula o Valor Esperado (EV) de uma operação. (V5.6)
 */
function calculateTradeEV(confidencePct: number, buffer: TradeMemoryBuffer, payoutRatioDecimal: number): number {
    const wins = buffer.wins.length;
    const losses = buffer.losses.length;
    const total = wins + losses;
    // Laplace smoothing: (wins + 2) / (total + 4)
    const empiricalProb = (wins + 2) / (total + 4);
    
    // Combine com a confiança do conselho (peso 50/50 se houver histórico)
    const prob = total >= 5 ? (empiricalProb * 0.5) + ((confidencePct / 100) * 0.5) : (confidencePct / 100);
    
    // EV = (P * Payout) - (1 - P)
    return Number(((prob * payoutRatioDecimal) - (1 - prob)).toFixed(4));
}

export function useCryptoRadarV4(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { 
        isConnected, executeTrade, operationsLog, accountBalance, 
        watchedSymbols, setWatchedSymbols, multiAssetCandles, 
        clearActiveContracts, accountType, setAccountType,
        botCandleData, getHistoricalData, getContractsFor, getProposal 
    } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();
    const resilience = useAdaptiveResilience();

    const DEFAULT_CLUSTER = ['cryBTCUSD', 'cryETHUSD'];
    const initializedRef = useRef(false);

    const [reasoningLog, setReasoningLog] = useState<LogEntry[]>([]);
    const [councilStats, setCouncilStats] = useState<CouncilStats>({ total: 0, call: 0, put: 0, hold: 0, vetoes: 0, fallbacks: 0, avgLatencyMs: 0 });
    const [telemetry, setTelemetry] = useState<CouncilTelemetry>({ 
        avgTokensPerSec: 0, 
        totalTokens: 0, 
        consensusEntropy: 0, 
        jitterMs: 0, 
        inferenceHealth: 100 
    });

    const [calibration, setCalibration] = useState<RuleCalibration | null>(null);

    // ETAPA 14: Registro de Trades Reais para atualização de resultados
    const [liveTradeRegistry, setLiveTradeRegistry] = useState<Record<number, string>>({});

    const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', details?: string[], symbol?: string) => {
        setReasoningLog(prev => [{
            ts: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
            time: new Date().toLocaleTimeString(),
            message, type, details, symbol
        }, ...prev].slice(0, 300));
    }, []);

    const [isAutoMode, setIsAutoMode] = useState(false);
    const [pilotMode, setPilotMode] = useState<'SHADOW' | 'DEMO_LIVE'>('SHADOW');
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [analysisInterval, setAnalysisInterval] = useState(DEFAULT_ANALYSIS_INTERVAL); 
    const [backgroundIntervalSec, setBackgroundIntervalSec] = useState(60);
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    const [confidenceThreshold, setConfidenceThreshold] = useState(65);
    const [requireSentinelCandidate] = useState(true);

    const [lockedProfitFloor, setLockedProfitFloor] = useState(0);
    const dailyHighWaterMark = useRef(0);

    const [stakeValue, setStakeValue] = useState(1.0);
    const [multiplier, setMultiplier] = useState(400);

    const [dailyBalance, setDailyBalance] = useState(100.0);
    const [dailyTarget, setDailyTarget] = useState(50.0);
    const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(3);
    const [allowedActions, setAllowedActions] = useState<AllowedActionsV3>({ 'CALL': true, 'PUT': true });
    const [allowedContracts, setAllowedContracts] = useState<AllowedContractsV3>({ 'OPTIONS': true, 'ACCUMULATORS': false, 'MULTIPLIERS': true });

    const { backtest, runBacktest, runLeadLagBacktest } = useBacktestRunner(getHistoricalData);

    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [radarStatus, setRadarStatus] = useState<Record<string, any>>({});
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    
    const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>({
        baseUrl: "",
        apiKey: "",
        model: "",
        temperature: 0.1,
        keepAlive: "5m"
    });
    
    const [availableModels, setAvailableModels] = useState<any[]>([]);

    const activeSymbolRef = useRef(activeSymbol);
    const executionLockRef = useRef(false);
    const scheduleRef = useRef<Record<string, number>>({});
    const lastDecisionBySymbolRef = useRef<Record<string, { ts: number, decision: CouncilDecision }>>({});
    const shadowExecutionTimestampsRef = useRef<Record<string, number>>({});

    const operationsLogRef = useRef(operationsLog);
    useEffect(() => { operationsLogRef.current = operationsLog; }, [operationsLog]);

    // V5.8: CARREGA CALIBRAÇÃO AO INICIAR
    useEffect(() => {
        if (user) {
            CalibrationService.get(user.uid).then(cal => {
                if (cal) {
                    setCalibration(cal);
                    addLog(`[V5.8] Calibração carregada: zBtc=${cal.zBtc} | zTargetMax=${cal.zTargetMax} | Corr=${cal.corrMin}`, 'info');
                } else {
                    addLog(`[V5.8] SISTEMA NÃO CALIBRADO. Usando limiares padrão.`, 'warning');
                }
            });
        }
    }, [user, addLog]);

    // ETAPA 14: Monitoramento de Fechamento de Trades Reais
    useEffect(() => {
        if (!user || !operationsLog.length || !Object.keys(liveTradeRegistry).length) return;
        
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && 
            op.id in liveTradeRegistry
        );

        finishedTrades.forEach(async (op) => {
            const docId = liveTradeRegistry[op.id];
            if (docId) {
                await updateLiveTradeResult(user.uid, docId, {
                    status: op.status === 'won' ? 'won' : 'lost',
                    profit: op.result || 0,
                    exitSpot: op.exitPrice || 0,
                    closedTs: Date.now()
                });
                setLiveTradeRegistry(prev => {
                    const next = { ...prev };
                    delete next[op.id];
                    return next;
                });
                addLog(`[V14-SYNC] Trade #${op.id} finalizado. Log atualizado no Firestore.`, 'info', undefined, op.asset);
            }
        });
    }, [operationsLog, user, liveTradeRegistry, addLog]);

    const updateOllamaConfig = useCallback((updates: Partial<OllamaConfig>) => {
        setOllamaConfig(prev => {
            const next = { ...prev, ...updates };
            localStorage.setItem('ollamaConfig', JSON.stringify(next));
            return next;
        });
    }, []);

    const fetchAvailableModels = useCallback(async () => {
        if (!ollamaConfig?.baseUrl) return;
        try {
            const url = ollamaConfig.baseUrl.replace(/\/+$/, '') + '/api/tags';
            const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
            if (ollamaConfig.apiKey) headers['Authorization'] = `Bearer ${ollamaConfig.apiKey}`;
            const res = await fetch(url, { headers });
            if (res.ok) {
                const data = await res.json();
                setAvailableModels(data.models || []);
            }
        } catch (e) {}
    }, [ollamaConfig]);

    const calculateDynamicStake = useCallback((baseStake: number, symbol: string, decision: CouncilDecision): number => {
        let finalStake = baseStake;
        const symbolTrades = [...operationsLogRef.current]
            .filter(op => op.asset === symbol && op.status !== 'pending')
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        if (symbolTrades.length > 0) {
            const lastTrade = symbolTrades[0]; 
            if (lastTrade.status === 'lost') {
                finalStake *= 0.5;
            }
        }
        
        if (decision.telemetry.consensusEntropy < 0.2 && finalStake === baseStake) {
            finalStake *= 1.15;
        }

        if (decision.executedVia === 'MATH_FALLBACK') {
            finalStake *= (decision.stakeRatio || 0.5);
        }
        
        return Math.max(0.35, Number(finalStake.toFixed(2)));
    }, []);

    const resetSession = useCallback(() => {
        setIsAutoMode(false);
        setIsShadowMode(true);
        setPilotMode('SHADOW');
        clearActiveContracts();
        setRadarStatus({});
        setReasoningLog([]);
        setChatMessages([]);
        setLockedProfitFloor(0);
        setCouncilStats({ total: 0, call: 0, put: 0, hold: 0, vetoes: 0, fallbacks: 0, avgLatencyMs: 0 });
        scheduleRef.current = {};
        shadowExecutionTimestampsRef.current = {};
        setLastDecision(null);
        toast({ title: "Sessão Reiniciada", description: "Todos os dados foram resetados." });
    }, [clearActiveContracts, toast]);

    const sessionStats = useMemo(() => {
        const finishedTrades = (operationsLog as Operation[]).filter((op: Operation) => 
            op.status !== 'pending' && op.initiator.startsWith('Conselho')
        );
        const wins = finishedTrades.filter((op: Operation) => op.status === 'won').length;
        const total = finishedTrades.length;
        const winRate = total > 0 ? (wins / total) * 100 : null;
        const pnl = finishedTrades.reduce((acc: number, op: Operation) => acc + (Number(op.result) || 0), 0);
        return { pnl: Number(pnl) || 0, winRate, total };
    }, [operationsLog]);

    useEffect(() => { activeSymbolRef.current = activeSymbol; }, [activeSymbol]);

    useEffect(() => {
        if (activeSymbol && priceTicks.length > 0) resilience.recordPulse(activeSymbol);
    }, [priceTicks, activeSymbol, resilience]);

    useEffect(() => {
        Object.keys(multiAssetCandles).forEach((symbol: string) => {
            if (watchedSymbols.includes(symbol)) resilience.recordPulse(symbol);
        });
    }, [multiAssetCandles, watchedSymbols, resilience]);

    useEffect(() => {
        const savedOllama = localStorage.getItem('ollamaConfig');
        if (savedOllama) {
            try { setOllamaConfig(JSON.parse(savedOllama)); } catch (e) {}
        }
    }, []);

    useEffect(() => {
        if (!initializedRef.current && isConnected) {
            const isSyntheticDefault = watchedSymbols.length === 5 && watchedSymbols.includes('1HZ10V');
            if (watchedSymbols.length === 0 || isSyntheticDefault) {
                setWatchedSymbols(DEFAULT_CLUSTER);
                addLog("Cluster Institucional cryBTCUSD/cryETHUSD configurado como padrão.", "info");
            }
            initializedRef.current = true;
        }
    }, [isConnected, watchedSymbols, setWatchedSymbols, addLog, DEFAULT_CLUSTER]);

    useEffect(() => {
        if (sessionStats.pnl > dailyHighWaterMark.current) dailyHighWaterMark.current = sessionStats.pnl;
        const profitRatio = sessionStats.pnl / dailyTarget;
        if (profitRatio >= 0.8) {
            const floor = sessionStats.pnl * 0.5;
            if (floor > lockedProfitFloor) setLockedProfitFloor(floor);
        } else if (profitRatio >= 0.5) {
            if (lockedProfitFloor < 0.01) setLockedProfitFloor(0.01);
        }
    }, [sessionStats.pnl, dailyTarget, lockedProfitFloor]);

    const getCandlesFor = useCallback((symbol: string): CandleData[] => {
        const multi = multiAssetCandles[symbol];
        if (multi && multi.length >= 30) return multi as CandleData[];
        if (symbol === activeSymbol && botCandleData.length >= 30) return botCandleData;
        return (multi ?? []) as CandleData[];
    }, [multiAssetCandles, activeSymbol, botCandleData]);

    const staleMinutes = useCallback((symbol: string): number | null => {
        const candles = getCandlesFor(symbol);
        if (candles.length === 0) return null;
        const last = candles[candles.length - 1];
        return (Date.now() / 1000 - last.epoch) / 60;
    }, [getCandlesFor]);

    const getCandlesForRef = useRef(getCandlesFor);
    const resilienceRef = useRef(resilience);
    useEffect(() => {
        getCandlesForRef.current = getCandlesFor;
        resilienceRef.current = resilience;
    });

    useEffect(() => {
        if (!user || !isShadowMode) return;
        
        const settleInterval = setInterval(() => {
            CryptoShadowEngine.settlePending(user.uid!, 
                (sym: string) => {
                    const c = getCandlesForRef.current(sym);
                    return c.length > 0 ? c[c.length - 1].close : null;
                },
                async (sym: string, win: boolean, pnl: number, trade: any) => {
                    if (trade.lateSettle) {
                        addLog(`[SHADOW] ${sym}: liquidação tardia (${Math.round((trade.settleDelayMs || 0) / 1000)}s de atraso) excluída das estatísticas.`, 'warning', undefined, sym);
                        return;
                    }
                    resilienceRef.current.processResult(sym, win);
                    
                    await TradeMemoryManager.addTrade(user.uid, sym, {
                        id: `shadow_${trade.id}`,
                        timestamp: trade.entryTs || Date.now(),
                        contract: trade.contract,
                        result: win ? 'WIN' : 'LOSS',
                        pnl,
                        rsi: trade.rsiAtEntry || 50,
                        volatilityYangZhang: trade.bbwAtEntry || 0,
                        candlePattern: 'SHADOW_SIM',
                        btcRegime: trade.gravityState,
                        gravityCorrelation: trade.correlationAtEntry || 0,
                        councilEntropy: trade.entropyAtEntry || 0,
                        failureDiagnosis: win ? undefined : 'Vencimento em simulado sombra'
                    });
                }
            );
        }, 2000);

        return () => clearInterval(settleInterval);
    }, [user, isShadowMode, addLog]);

    const sendMessage = async (content: string, targetAgent: string = 'CHAIRMAN') => {
        if (!content.trim() || !ollamaConfig) return;
        const time = new Date().toLocaleTimeString();
        setChatMessages(prev => [...prev, { role: 'user', content, time }]);
        setIsChatLoading(true);

        try {
            const context = buildShortContext({ 
                sentinel: radarStatus, 
                lastDecisions: lastDecisionBySymbolRef.current, 
                staleMinutes,
                financialState: { pnl: sessionStats.pnl, floor: lockedProfitFloor, balance: accountBalance.balance || 0 }
            });

            const persona = (AGENT_PERSONAS as any)[targetAgent] || AGENT_PERSONAS.CHAIRMAN;
            const systemPrompt = `VOCÊ É UNICAMENTE ${persona.toUpperCase()}. RESPONDA EXCLUSIVAMENTE NESTE PAPEL. Responda em português do Brasil.

DIRETRIZES RÍGIDAS DE DADOS (V5.3):
1. USE APENAS OS DADOS DO DOSSIER DE TELEMETRIA ABAIXO.
2. PROIBIDO ALUCINAR: Nunca invente ativos (como 'Ativo A') ou preços (como '$100').
3. Se um valor não estiver no dossier, diga "Dados Não Disponíveis no Snapshot".
4. Baseie seu rigor de risco no P&L de $${sessionStats.pnl.toFixed(2)} e no Piso de $${lockedProfitFloor.toFixed(2)}.

${context}`;

            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: systemPrompt }, 
                ...chatMessages.slice(-8).map((m: any) => ({ role: m.role, content: m.content }))
            ]);

            if (response.success) {
                setChatMessages(prev => [...prev, { role: 'assistant', content: response.success!, time: new Date().toLocaleTimeString(), agentName: targetAgent }]);
            }
        } catch (error: any) {
            setChatMessages(prev => [...prev, { role: 'assistant', content: `Erro: ${error.message}.`, time: new Date().toLocaleTimeString(), agentName: 'SISTEMA', isError: true }]);
        } finally {
            setIsChatLoading(false);
        }
    };

    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManual: boolean = false) => {
        if (!isConnected || !user || !ollamaConfig || executionLockRef.current) return;
        const analysisStartTs = Date.now();
        const min = staleMinutes(symbol);
        if (min !== null && min > 2.5) return;

        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            if (!indicators) return;

            const baseFeats = buildAssetFeatures(symbol, candles);
            if (!baseFeats) return;

            let gravity: BitcoinGravity | null = null;
            if (symbol !== 'cryBTCUSD') {
                const btcCandles = getCandlesFor('cryBTCUSD');
                if (btcCandles.length >= 30) {
                    const btcFeats = buildAssetFeatures('cryBTCUSD', btcCandles);
                    if (btcFeats) gravity = calculateBitcoinGravity(btcFeats as any, baseFeats as any);
                }
            }

            if (gravity) {
                addLog(`[RADAR] ${symbol} vs BTC: ${gravity.btcVector} | Corr: ${gravity.correlation.toFixed(3)} | SlingShot: ${gravity.slingshotDetected}`, 'radar', undefined, symbol);
                if (symbol !== 'cryBTCUSD' && gravity.vetoReason) {
                    addLog(`[GRAVITY-VETO] ${symbol}: ${gravity.vetoReason}`, 'warning', undefined, symbol);
                    setRadarStatus(prev => ({
                        ...prev,
                        [symbol]: {
                            symbol, finalAction: 'HOLD', lastAction: 'HOLD', consensusConfidence: 0, confidence: 0,
                            timestamp: Date.now(), holdReason: gravity.vetoReason,
                            indicators: { rsi: baseFeats.rsi, adx: indicators.adx, bbw: indicators.bbw }
                        }
                    }));
                    return;
                }
            }

            const cryptoFeats: CryptoSignalFeatures = { ...baseFeats as any, gravity, vwapDist: baseFeats.bbPos };
            const candidates = evaluateCryptoSignals(symbol, cryptoFeats);
            
            // ETAPA 14: Todas as regras (incluindo Slingshot) devem respeitar SENTINEL_MIN_SCORE
            const bestCandidate = candidates
                .filter((c: any) => c.direction !== 'NONE' && c.score >= SENTINEL_MIN_SCORE)
                .sort((a: any, b: any) => b.score - a.score)[0];

            if (!bestCandidate && requireSentinelCandidate) {
                addLog(`[SENTINEL] ${symbol}: Sem candidato qualificado (min: ${SENTINEL_MIN_SCORE}).`, 'sentinel', undefined, symbol);
                setRadarStatus(prev => ({
                    ...prev,
                    [symbol]: { symbol, finalAction: 'HOLD', lastAction: 'HOLD', consensusConfidence: 0, confidence: 0, timestamp: Date.now(), holdReason: 'SENTINEL_LOW_SCORE', indicators: { rsi: baseFeats.rsi, adx: indicators.adx, bbw: indicators.bbw } }
                }));
                return;
            }

            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);
            const portfolio: PortfolioRiskState = { openPositions: (operationsLog as any[]).filter((op: Operation) => op.status === 'pending').length, maxConcurrentPositions: maxConcurrentTrades, totalExposure: (operationsLog as any[]).filter((op: Operation) => op.status === 'pending').reduce((s: number, o: Operation) => s + o.stake, 0), maxTotalExposure: dailyBalance, lockedSymbols: new Set() };
            const permissions: AssetExecutionPermission = { symbol, enabled: true, userId: user.uid, maxStake: stakeValue * 5, allowedContracts: Object.keys(allowedContracts).filter(k => allowedContracts[k as keyof typeof allowedContracts]) as any[], allowedActions: Object.keys(allowedActions).filter(k => allowedActions[k as keyof typeof allowedActions]) as any[] };

            executionLockRef.current = true;
            const decision = await runCryptoCouncil({ ...cryptoFeats, symbol, price: candles[candles.length - 1].close, strategicProfile, sentinel: bestCandidate } as any, buffer, ollamaConfig, isShadowMode, isManual || symbol === activeSymbolRef.current, permissions, portfolio);
            const analysisEndTs = Date.now();
            
            if (bestCandidate && decision.finalAction !== 'HOLD' && decision.finalAction !== bestCandidate.direction) {
                const originalCouncilAction = decision.finalAction;
                decision.finalAction = 'HOLD';
                addLog(`[WARNING] ${symbol}: Divergência detectada. Sentinel=${bestCandidate.direction} vs Conselho=${originalCouncilAction}. Forçando HOLD.`, 'warning', undefined, symbol);
                decision.holdReason = `DIVERGENCE: Sentinel(${bestCandidate.direction}) vs Conselho(${originalCouncilAction}).`;
            }

            lastDecisionBySymbolRef.current[symbol] = { ts: Date.now(), decision };

            if (symbol === activeSymbol) { setLastDecision(decision); setTelemetry(decision.telemetry); setMemoryBuffer(buffer); }

            setCouncilStats(prev => ({ total: prev.total + 1, call: prev.call + (decision.finalAction === 'CALL' ? 1 : 0), put: prev.put + (decision.finalAction === 'PUT' ? 1 : 0), hold: prev.hold + (decision.finalAction === 'HOLD' ? 1 : 0), vetoes: prev.vetoes + (decision.executedVia === 'COUNCIL_VETO' ? 1 : 0), fallbacks: prev.fallbacks + (decision.executedVia === 'MATH_FALLBACK' ? 1 : 0), avgLatencyMs: (prev.avgLatencyMs * 0.8) + (decision.t2tLatencyMs * 0.2) }));

            const currentRigor = resilience.thresholds[symbol] || (confidenceThreshold / 100);
            const isStable = resilience.checkStability(symbol);
            const effectiveThreshold = Math.max(confidenceThreshold, currentRigor * 100);
            const hwmCheckTriggered = lockedProfitFloor > 0 && sessionStats.pnl <= lockedProfitFloor;

            const shouldExecute = isManual || (
                isAutoMode &&
                !hwmCheckTriggered &&
                decision.finalAction !== 'HOLD' &&
                decision.consensusConfidence >= effectiveThreshold &&
                isStable
            );

            setRadarStatus(prev => ({ ...prev, [symbol]: { ...decision, features: cryptoFeats, gravity, timestamp: Date.now(), isQualified: shouldExecute, indicators: { rsi: baseFeats.rsi, adx: indicators.adx, bbw: indicators.bbw } } }));

            if (hwmCheckTriggered && isAutoMode) {
                addLog(`[HWM-STOP] Piso de lucro diário atingido ($${lockedProfitFloor.toFixed(2)}). Sessão protegida.`, 'warning', undefined, symbol);
                toast({ title: "🛡️ HWM Protect", description: `Piso de lucro ($${lockedProfitFloor.toFixed(2)}) atingido. Automação desativada.`, variant: "destructive" });
                setIsAutoMode(false);
                executionLockRef.current = false;
                return;
            }

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                const finalStake = calculateDynamicStake(stakeValue, symbol, decision);
                
                const freshCandles = getCandlesFor(symbol);
                const currentSpot = freshCandles.length > 0 ? freshCandles[freshCandles.length - 1].close : candles[candles.length - 1].close;

                // Alpha Decay Guard (Etapa 5.6)
                if (!isManual && decision.t2tLatencyMs > 4000) {
                    addLog(`[ALPHA-DECAY] ${symbol}: Latência LLM excessiva (${decision.t2tLatencyMs}ms) para contrato de 15s. Abortando execução.`, 'warning', undefined, symbol);
                    executionLockRef.current = false;
                    return;
                }

                if (pilotMode === 'SHADOW') {
                    if (symbol === 'cryBTCUSD') { addLog(`[SHADOW] ${symbol}: BTC é âncora; simulação ignorada.`, 'radar', undefined, symbol); executionLockRef.current = false; return; }
                    
                    const pending = CryptoShadowEngine.getPendingFromCache().filter((t: any) => t.symbol === symbol);
                    const hasSamePending = pending.some((t: any) => t.direction === decision.finalAction);
                    const now = Date.now();
                    const lastExec = shadowExecutionTimestampsRef.current[symbol] || 0;

                    if (hasSamePending) { executionLockRef.current = false; return; }

                    if (now - lastExec < SHADOW_COOLDOWN_SEC * 1000) {
                        addLog(`[SHADOW-BLOCK] ${symbol}: Cooldown sombra ativo (${Math.ceil((SHADOW_COOLDOWN_SEC * 1000 - (now - lastExec)) / 1000)}s restantes).`, 'radar', undefined, symbol);
                        executionLockRef.current = false;
                        return;
                    }

                    const entryTs = Date.now();
                    const ev = calculateTradeEV(decision.consensusConfidence, buffer, (backtest.payoutPct || 85) / 100);
                    addLog(`[SHADOW] ${symbol}: ${decision.finalAction} simulado com stake adaptativo $${finalStake} (EV: ${ev}).`, 'radar', undefined, symbol);
                    shadowExecutionTimestampsRef.current[symbol] = entryTs;
                    
                    await CryptoShadowEngine.logTrade(user.uid!, {
                        symbol, direction: decision.finalAction, contract: decision.recommendedContract,
                        entryPrice: currentSpot, rule: bestCandidate?.rule || 'COUNCIL_DISCRETION',
                        score: decision.consensusConfidence, gravityState: gravity?.btcVector || 'CHOP',
                        confidence: decision.consensusConfidence, payoutRatio: backtest.payoutPct || 85,
                        duration: 15, durationUnit: 's', ev, stake: finalStake,
                        timestamp: new Date(entryTs).toISOString(),
                        decisionTs: analysisStartTs, entryTs, llmLatencyMs: decision.t2tLatencyMs,
                        rsiAtEntry: baseFeats.rsi, bbwAtEntry: indicators.bbw || 0,
                        correlationAtEntry: gravity?.correlation, entropyAtEntry: decision.telemetry.consensusEntropy
                    });
                } else if (pilotMode === 'DEMO_LIVE') {
                    // V5.8: BLOQUEIO DE PILOTO NÃO-CALIBRADO
                    if (!calibration || calibration.verdict === 'SEM EDGE') {
                        addLog(`[EXEC-ABORT] ${symbol}: Execução Demo Live bloqueada por falta de calibração válida.`, 'warning', undefined, symbol);
                        executionLockRef.current = false;
                        return;
                    }

                    const guard = checkGuardrails(symbol, accountType, finalStake, operationsLog, staleMinutes(symbol));
                    if (!guard.allowed) { addLog(`[GUARDRAIL-BLOCK] ${symbol}: ${guard.reason}`, 'warning', undefined, symbol); executionLockRef.current = false; return; }

                    try {
                        const contractsRes = await getContractsFor(symbol);
                        const available = contractsRes.contracts_for?.available || [];
                        const callPuts = available.filter((c: any) => c.contract_category === 'callput');
                        
                        let finalDurVal: number | null = null;
                        let finalDurUnit: DurationUnit | null = null;
                        let minFoundSec = Infinity;

                        for (const c of callPuts) {
                            const durSec = parseDurationToSeconds(c.min_contract_duration);
                            if (durSec !== null && durSec >= 15) {
                                if (durSec < minFoundSec) {
                                    minFoundSec = durSec;
                                    const match = c.min_contract_duration.match(/^(\d+)([tsmhd])$/);
                                    if (match) {
                                        finalDurVal = parseInt(match[1], 10);
                                        finalDurUnit = match[2] as DurationUnit;
                                    }
                                }
                            }
                        }

                        if (!finalDurVal || !finalDurUnit) {
                            addLog(`[EXEC-ABORT] ${symbol}: Nenhuma duração temporal >= 15s disponível.`, 'warning', undefined, symbol);
                            executionLockRef.current = false;
                            return;
                        }

                        const propRes = await getProposal({ 
                            contract_type: decision.finalAction === 'CALL' ? 'CALL' : 'PUT', 
                            currency: 'USD', 
                            symbol, 
                            amount: finalStake, 
                            basis: 'stake', 
                            duration: finalDurVal, 
                            duration_unit: finalDurUnit 
                        });
                        
                        if (propRes.error) throw new Error(propRes.error.message);
                        const actualPayout = (propRes.proposal.payout - propRes.proposal.ask_price) / propRes.proposal.ask_price;
                        
                        if (actualPayout < DEFAULT_GUARDRAILS.minPayout) { 
                            addLog(`[EXEC-ABORT] ${symbol}: Payout ${(actualPayout*100).toFixed(1)}% < ${DEFAULT_GUARDRAILS.minPayout * 100}%`, 'warning', undefined, symbol); 
                            executionLockRef.current = false; 
                            return; 
                        }

                        const realEv = calculateTradeEV(decision.consensusConfidence, buffer, actualPayout);
                        if (!isManual && realEv <= 0) {
                            addLog(`[EV-ABORT] ${symbol}: Expectativa matemática negativa/nula (EV=${realEv}). Operação abortada.`, 'warning', undefined, symbol);
                            executionLockRef.current = false;
                            return;
                        }

                        const tradeDirection: 'rise' | 'fall' = decision.finalAction === 'CALL' ? 'rise' : 'fall';
                        const finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';

                        const res = await executeTrade(finalContractType, finalStake, symbol, tradeDirection, finalDurVal, finalDurUnit, 'Conselho' as OperationInitiator, `V14_DEMO_${decision.executedVia}`);
                        const purchaseTs = Date.now();
                        const signalTs = (freshCandles.length > 0 ? freshCandles[freshCandles.length - 1].epoch : candles[candles.length - 1].epoch) * 1000;

                        if (res.success) {
                            addLog(`[EXEC-DEMO] ${symbol} ${decision.finalAction} enviado via API. Stake: $${finalStake}`, 'execution', undefined, symbol);
                            const executionPrice = res.entryPrice || propRes.proposal.spot || currentSpot;
                            
                            const docId = await logLiveTrade(user.uid!, {
                                symbol, direction: decision.finalAction as any, contract: decision.recommendedContract,
                                stake: finalStake, payout: actualPayout, duration: finalDurVal, durationUnit: finalDurUnit,
                                spotAtDecision: candles[candles.length - 1].close,
                                spotAtPurchase: executionPrice,
                                slippagePips: executionPrice - (propRes.proposal.spot || currentSpot),
                                decisionLatencyMs: Math.round(decision.t2tLatencyMs),
                                executionLatencyMs: Math.round(purchaseTs - analysisEndTs),
                                totalLatencyMs: Math.round(purchaseTs - analysisStartTs),
                                rule: bestCandidate?.rule || 'V14_DISCRETION', gravityState: gravity?.btcVector || 'CHOP',
                                confidence: decision.consensusConfidence, sentinelScore: bestCandidate?.score || 0,
                                entropy: decision.telemetry.consensusEntropy, 
                                signalTs, 
                                decisionTs: analysisEndTs, 
                                purchaseTs,
                                status: 'pending', accountType
                            });

                            if (docId && res.contractId) {
                                setLiveTradeRegistry(prev => ({ ...prev, [res.contractId!]: docId }));
                            }

                            // Parallel Shadow Trade (Etapa 13.4) com EV real e Preço Pareado
                            await CryptoShadowEngine.logTrade(user.uid!, {
                                symbol, direction: decision.finalAction, contract: decision.recommendedContract,
                                entryPrice: executionPrice, rule: bestCandidate?.rule || 'V14_PARALLEL',
                                score: decision.consensusConfidence, gravityState: gravity?.btcVector || 'CHOP',
                                confidence: decision.consensusConfidence, payoutRatio: Math.round(actualPayout * 100),
                                duration: finalDurVal, durationUnit: finalDurUnit, ev: realEv, stake: finalStake,
                                timestamp: new Date(purchaseTs).toISOString(),
                                decisionTs: analysisStartTs, entryTs: purchaseTs, llmLatencyMs: decision.t2tLatencyMs,
                                rsiAtEntry: baseFeats.rsi, bbwAtEntry: indicators.bbw || 0,
                                correlationAtEntry: gravity?.correlation, entropyAtEntry: decision.telemetry.consensusEntropy
                            });
                        }
                    } catch (e: any) { addLog(`Falha DEMO_LIVE (${symbol}): ${e.message}`, 'error', undefined, symbol); }
                }
            }
        } catch (e: any) { addLog(`Erro V5 em ${symbol}: ${e.message}`, 'error'); } finally { executionLockRef.current = false; }
    }, [isConnected, user, ollamaConfig, isShadowMode, isAutoMode, activeSymbol, operationsLog, confidenceThreshold, strategicProfile, getCandlesFor, addLog, executeTrade, stakeValue, dailyBalance, maxConcurrentTrades, allowedContracts, allowedActions, staleMinutes, requireSentinelCandidate, pilotMode, accountType, getContractsFor, getProposal, lockedProfitFloor, calculateDynamicStake, resilience, toast, backtest.payoutPct, liveTradeRegistry, calibration]);

    const runMultiAssetCycle = useCallback(async () => {
        if (!isConnected || executionLockRef.current) return;
        const now = Date.now();
        const symbols = Array.from(new Set([...watchedSymbols, activeSymbol].filter(Boolean) as string[]));
        const dueSymbols = symbols.filter((sym: string) => {
            const nextRun = scheduleRef.current[sym] || 0;
            const isFoco = sym === activeSymbol;
            
            if (isFoco && isAutoMode) {
                const candles = getCandlesFor(sym);
                const feats = buildAssetFeatures(sym, candles);
                if (feats) {
                  let gravity = null;
                  if (sym !== 'cryBTCUSD') {
                      const btcCandles = getCandlesFor('cryBTCUSD');
                      if (btcCandles.length >= 30) {
                          const btcFeats = buildAssetFeatures('cryBTCUSD', btcCandles);
                          if (btcFeats) gravity = calculateBitcoinGravity(btcFeats as any, feats as any);
                      }
                  }
                  const cryptoFeats: CryptoSignalFeatures = { ...feats as any, gravity, vwapDist: feats.bbPos };
                  const candidates = evaluateCryptoSignals(sym, cryptoFeats);
                  const hasStrongSetup = candidates.some(c => c.score >= SENTINEL_MIN_SCORE && c.direction !== 'NONE');
                  if (hasStrongSetup && (now - nextRun) > -15000) return true;
                }
            }
            return nextRun <= now;
        });
        
        if (dueSymbols.length > 0) {
            dueSymbols.sort((a, b) => (a === activeSymbol ? -1 : (b === activeSymbol ? 1 : 0)));
            for (const sym of dueSymbols) {
                const candles = getCandlesFor(sym);
                if (candles.length >= 30) {
                    await runAnalysisForSymbol(sym, candles);
                    const interval = sym === activeSymbol ? analysisInterval : backgroundIntervalSec;
                    scheduleRef.current[sym] = Date.now() + interval * 1000;
                }
            }
        }
    }, [isConnected, watchedSymbols, activeSymbol, analysisInterval, backgroundIntervalSec, isAutoMode, getCandlesFor, runAnalysisForSymbol, calibration]);

    useEffect(() => {
        const id = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(id);
    }, [runMultiAssetCycle]);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        setIsAutoMode,
        pilotMode, setPilotMode,
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        setIsShadowMode,
        strategicProfile, setStrategicProfile,
        confidenceThreshold, setConfidenceThreshold,
        stakeValue, setStakeValue, multiplier, setMultiplier,
        dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
        maxConcurrentTrades, setMaxConcurrentTrades,
        allowedActions, setAllowedActions, allowedContracts, setAllowedContracts,
        lastDecision, radarStatus, reasoningLog, telemetry, memoryBuffer,
        analysisInterval, setAnalysisInterval,
        backgroundIntervalSec, setBackgroundIntervalSec,
        chatMessages, isChatLoading, sendMessage,
        resetSession, sessionStats, lockedProfitFloor,
        resilience, councilStats, runBacktest, runLeadLagBacktest, backtest, buildBacktestReport: () => buildBacktestReport(backtest as any), staleMinutes,
        ollamaConfig, availableModels, updateOllamaConfig, fetchAvailableModels,
        executeManualDecision: () => activeSymbol && runAnalysisForSymbol(activeSymbol, getCandlesFor(activeSymbol), true),
        calibration
    };
}
