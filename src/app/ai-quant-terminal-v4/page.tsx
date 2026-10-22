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
import { buildPerformanceReport } from '@/features/trading/services/performance-report';
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
                            const rigor = resilience.thresholds[symbol] || (confidenceThreshold / 100);
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

