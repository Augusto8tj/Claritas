'use client';

/**
 * @fileOverview TERMINAL QUANT V4 - CRYPTO LAB
 * Dashboard especializado em inteligência de correlação Bitcoin.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { 
    BrainCircuit, Zap, ShieldCheck, Terminal as TerminalIcon, 
    Timer, LineChart, PlayCircle, PauseCircle, Cpu, RefreshCw,
    Database, Activity, History, ArrowUpCircle, ArrowDownCircle,
    TestTube, Radar, TrendingUp, TrendingDown, 
    Minus, Check, ChevronsUpDown, Wallet, Target, Layers,
    MessageSquare, Send, Gauge, Info, ChevronRight, Copy, Globe, Coins
} from "lucide-react";
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi, type AccountType } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 as AssetSelector } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { useCryptoRadarV4 } from "@/features/trading/hooks/use-crypto-radar-v4";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from '@/hooks/use-toast';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

function CryptoLabContent() {
    const { 
        activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading, 
        chartData, isConnected, operationsLog, tradeAnnotations, priceTicks,
        isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod,
        accountType, accountBalance, setAccountType, watchedSymbols, setWatchedSymbols
    } = useDerivApi();

    const v4 = useCryptoRadarV4(activeSymbol, priceTicks, chartData as any);
    const { toast } = useToast();
    const { 
        lastDecision, reasoningLog, memoryBuffer, isAutoMode, setIsAutoMode, isShadowMode, setIsShadowMode,
        radarStatus, sentinel, telemetry, resetSession, analysisInterval, setAnalysisInterval
    } = v4;

    const [isSelectorOpen, setIsSelectorOpen] = useState(false);
    const [expandedLogTs, setExpandedLogTs] = useState<string | null>(null);

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

    return (
        <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6 bg-background min-h-screen text-foreground">
            
            {/* RADAR DE GRAVIDADE BITCOIN (V4) */}
            <Card className="bg-orange-500/5 border-orange-500/20 shadow-sm overflow-hidden">
                <CardHeader className="py-3 px-6 bg-orange-500/10 border-b border-orange-500/20 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-orange-700">
                        <Radar className="h-4 w-4 animate-spin-slow" /> Bitcoin Gravity Radar (V4.2)
                    </CardTitle>
                    <div className="flex items-center gap-4">
                        <Popover open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7 text-[10px] uppercase font-bold border-orange-200">
                                    Monitorar Criptos <ChevronsUpDown className="ml-2 h-3 w-3" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[300px] p-0" align="end">
                                <Command>
                                    <CommandInput placeholder="Filtrar criptos (prefixo 'cry')..." />
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
                        <Badge variant="outline" className="text-[9px] border-orange-500/30 text-orange-700 uppercase">
                            Concorrência Ativa
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {watchedSymbols.map((symbol) => {
                            const status = radarStatus[symbol];
                            const gravity = status?.gravity;
                            
                            return (
                                <div 
                                    key={symbol} 
                                    onClick={() => setActiveSymbol(symbol)}
                                    className={cn(
                                        "p-3 rounded-lg border transition-all cursor-pointer group hover:scale-105",
                                        symbol === activeSymbol ? "bg-orange-600 border-orange-600 text-white shadow-md" : "bg-card border-border hover:border-orange-400",
                                        status?.isQualified && symbol !== activeSymbol && "animate-pulse border-green-500 bg-green-50/10"
                                    )}
                                >
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[10px] font-bold font-mono">{symbol}</span>
                                        {gravity?.isBtcExploding && <Zap className="h-3 w-3 text-yellow-400 fill-current animate-pulse" />}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {status?.finalAction === 'RISE' || status?.finalAction === 'CALL' ? <TrendingUp className="h-4 w-4 text-green-500" /> : 
                                         status?.finalAction === 'FALL' || status?.finalAction === 'PUT' ? <TrendingDown className="h-4 w-4 text-red-500" /> : 
                                         <Minus className="h-4 w-4 text-muted-foreground" />}
                                        <span className="text-sm font-black">{status?.finalAction || 'SCAN'}</span>
                                    </div>
                                    
                                    {gravity && (
                                        <div className="mt-2 pt-2 border-t border-current/10 space-y-1">
                                            <div className="flex justify-between text-[8px] uppercase font-black">
                                                <span className="opacity-70">BTC Vector:</span>
                                                <span className={cn(
                                                    gravity.btcVector === 'BULL_DRAG' ? "text-green-500" :
                                                    gravity.btcVector === 'BEAR_DRAG' ? "text-red-500" : "text-muted-foreground"
                                                )}>{gravity.btcVector}</span>
                                            </div>
                                            <div className="flex justify-between text-[8px] uppercase font-black">
                                                <span className="opacity-70">Beta Score:</span>
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

            {/* HEADER CANÔNICO V4 */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
                <div className="flex items-center gap-3">
                    <div className="bg-orange-500/10 p-2 rounded-xl border border-orange-500/20 shadow-sm">
                        <Zap className="h-8 w-8 text-orange-600 animate-pulse" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight font-headline text-orange-700">Crypto Lab V4.2</h1>
                        <div className="flex items-center gap-2">
                             <Badge variant="secondary" className="font-mono text-xs flex items-center gap-1.5">
                                <Coins className="h-3 w-3"/> Saldo: {accountBalance.loading ? '...' : formatCurrency(accountBalance.balance || 0)}
                             </Badge>
                             <Badge className={cn("text-[10px] font-bold", isAutoMode ? "bg-green-600" : "bg-blue-600")}>
                                {isAutoMode ? 'AUTOPILOT ON' : 'MONITOR MODE'}
                             </Badge>
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
                        <ToggleGroupItem value="demo" className="text-[10px] h-7 px-3 font-bold uppercase">Demo</ToggleGroupItem>
                        <ToggleGroupItem value="real" className="text-[10px] h-7 px-3 font-bold uppercase">Real</ToggleGroupItem>
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
                {/* COLUNA ESQUERDA: CONTROLE */}
                <div className="lg:col-span-3 space-y-6">
                    <Card className="border-orange-200 bg-orange-50/10 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-orange-600 flex items-center gap-2">
                                <Zap className="h-4 w-4" /> Cockpit do Laboratório
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between p-3 rounded-lg bg-card border shadow-sm">
                                <Label htmlFor="shadow-mode" className="flex flex-col gap-0.5">
                                    <span className="text-xs font-bold uppercase">Shadow Trading</span>
                                    <span className="text-[10px] text-muted-foreground">Execuções teóricas V4</span>
                                </Label>
                                <Switch id="shadow-mode" checked={isShadowMode} onCheckedChange={setIsShadowMode} />
                            </div>

                            <div className="space-y-3 p-3 rounded-lg border border-orange-200 bg-card/50">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-muted-foreground flex items-center gap-1.5"><Timer className="h-3.5 w-3.5"/> Ciclo de Inferência</span>
                                    <span className="font-mono text-orange-700 font-bold">{analysisInterval}s</span>
                                </div>
                                <Slider 
                                    value={[analysisInterval]} 
                                    min={30} max={600} step={30} 
                                    onValueChange={(v) => setAnalysisInterval(v[0])}
                                />
                            </div>

                            <Button 
                                onClick={() => setIsAutoMode(!isAutoMode)} 
                                className={cn("w-full h-12 font-bold shadow-md", isAutoMode ? "bg-destructive text-white" : "bg-orange-600 text-white hover:bg-orange-700")}
                            >
                                {isAutoMode ? <PauseCircle className="mr-2 h-5 w-5" /> : <PlayCircle className="mr-2 h-5 w-5" />}
                                {isAutoMode ? 'Parar Automação' : 'Ativar Radar V4'}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="bg-slate-950 text-slate-300 border-slate-800 shadow-xl font-mono">
                        <CardHeader className="py-3 bg-slate-900 border-b border-slate-800">
                             <CardTitle className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 text-cyan-500">
                                <Gauge className="h-3.5 w-3.5" /> Telemetria Concorrente
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 space-y-4 text-[11px]">
                             <div className="space-y-2">
                                <div className="flex justify-between">
                                    <span className="opacity-60 uppercase">TPS Intensity:</span>
                                    <span className="text-green-500 font-bold">{telemetry.avgTokensPerSec.toFixed(1)} <span className="text-[9px]">TOK/S</span></span>
                                </div>
                                <Progress value={telemetry.avgTokensPerSec * 2} className="h-1 bg-slate-800" indicatorClassName="bg-cyan-500" />
                            </div>
                            <div className="flex justify-between border-t border-slate-800 pt-3">
                                <span className="opacity-50 uppercase text-[9px]">Consensus Entropy:</span>
                                <span className="text-xs font-bold text-slate-100">{telemetry.consensusEntropy.toFixed(3)}</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* COLUNA CENTRAL: GRÁFICO */}
                <div className="lg:col-span-6 space-y-6">
                    <Card className="min-h-[450px] shadow-sm">
                        <CardHeader className="py-3 border-b flex flex-row items-center justify-between">
                             <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
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

                    <Card className="bg-muted/30 border-dashed font-mono shadow-inner border-orange-200">
                        <CardHeader className="py-2 px-4 border-b bg-card/50">
                            <CardTitle className="text-[10px] flex items-center gap-2 uppercase tracking-widest font-bold text-muted-foreground">
                                <TerminalIcon className="h-3 w-3" /> Reasoning Engine Log (V4.2)
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <ScrollArea className="h-48 p-4 text-[10px]">
                                {reasoningLog.length === 0 ? (
                                    <p className="animate-pulse text-muted-foreground italic">Sincronizando nó de inferência paralela...</p>
                                ) : (
                                    reasoningLog.map((log, i) => (
                                        <div key={log.ts} className="mb-1 border-l-2 border-orange-500/30 pl-2">
                                            <span className="opacity-40">[{log.time}]</span>{' '}
                                            {log.symbol && <Badge variant="outline" className="text-[8px] h-3 px-1 border-orange-200 text-orange-600">{log.symbol}</Badge>}
                                            <span className={cn(
                                                "font-medium",
                                                log.type === 'decision' ? "text-orange-600 font-bold" : 
                                                log.type === 'execution' ? "text-green-600 font-bold" : "text-muted-foreground"
                                            )}>{log.message}</span>
                                        </div>
                                    ))
                                )}
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>

                {/* COLUNA DIREITA: VEREDITO */}
                <div className="lg:col-span-3 space-y-6">
                    <Card className="border-orange-600/30 shadow-md">
                        <CardHeader className="bg-orange-600/5 border-b py-3">
                            <CardTitle className="text-sm flex items-center gap-2 text-orange-600">
                                <ShieldCheck className="h-4 w-4 text-orange-600" /> Chairman Veredict V4
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
                                    <div className="bg-muted/30 p-3 rounded-lg border text-[11px] text-muted-foreground italic text-center">
                                        "{lastDecision.zenThought}"
                                    </div>
                                </>
                            ) : (
                                <div className="text-center py-10 opacity-30">
                                    <RefreshCw className="h-10 w-10 mx-auto mb-2 animate-spin" />
                                    <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Analizando Vetores...</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="shadow-sm border-orange-100">
                        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <Database className="h-4 w-4" /> Lab Memory
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="p-3 rounded-lg bg-green-50/50 border border-green-100 text-center">
                                    <span className="text-[10px] uppercase font-bold text-green-600 block mb-1">Wins</span>
                                    <p className="text-lg font-black text-green-700">{memoryBuffer.wins.length}</p>
                                </div>
                                <div className="p-3 rounded-lg bg-red-50/50 border border-red-100 text-center">
                                    <span className="text-[10px] uppercase font-bold text-red-600 block mb-1">Losses</span>
                                    <p className="text-lg font-black text-red-700">{memoryBuffer.losses.length}</p>
                                </div>
                            </div>
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
