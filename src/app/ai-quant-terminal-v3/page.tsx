'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
    MessageSquare, Send, Gauge, Laptop, HardDrive, Coins, AlertCircle, ChevronDown, Copy, ChevronRight, FilePieChart, Loader2, Info, X
} from "lucide-react";
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi, type AccountType } from "@/features/trading/hooks/use-deriv-api-v2";
import { AssetSelectorV2 as AssetSelector } from "@/features/trading/components/deriv-trader/asset-selector-v2";
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorV2";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { useAIQuantTerminalV3 } from "@/features/trading/hooks/use-ai-quant-terminal-v3";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { groupOf } from '@/features/trading/services/report-builders';

function TerminalV3Content() {
    const { 
        activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading, 
        chartData, isConnected, operationsLog, tradeAnnotations, priceTicks,
        isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod,
        accountType, accountBalance, setAccountType
    } = useDerivApi();

    const v3 = useAIQuantTerminalV3(activeSymbol, priceTicks, chartData as any);
    const { toast } = useToast();
    const { 
        lastDecision, reasoningLog, memoryBuffer, isAutoMode, setIsAutoMode, isShadowMode, setIsShadowMode,
        timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        backgroundIntervalSec, setBackgroundIntervalSec, sentinelIntervalSec, setSentinelIntervalSec,
        radarStatus, sentinel, watchedSymbols, setWatchedSymbols, resetSession, clearMemory,
        allowedActions, setAllowedActions,
        allowedContracts, setAllowedContracts, 
        maxConcurrentTrades, setMaxConcurrentTrades,
        stakeValue, setStakeValue, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
        sessionStats, councilStats, chatMessages, isChatLoading, sendMessage, telemetry, ollamaConfig,
        updateOllamaConfig, backtest, runBacktest, buildBacktestReport, staleMinutes
    } = v3;

    const [isSelectorOpen, setIsSelectorOpen] = useState(false);
    const [isBacktestSelectorOpen, setIsBacktestSelectorOpen] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [chatTarget, setChatTarget] = useState('CHAIRMAN');
    const [logFilter, setLogFilter] = useState<'all' | 'decision' | 'sentinel' | 'execution' | 'error'>('all');
    const [expandedLogTs, setExpandedLogTs] = useState<string | null>(null);
    
    // Backtest Config
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

    const handleChatSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (chatInput.trim()) {
            sendMessage(chatInput, chatTarget);
            setChatInput('');
        }
    };

    const copyLogs = () => {
        if (filteredLogs.length === 0) {
            toast({ title: "Nada para copiar", description: "O log de raciocínio está vazio no momento.", variant: "destructive" });
            return;
        }

        const text = filteredLogs.map(l => {
            let s = `[${l.time}] ${l.message}`;
            if (l.details && l.details.length > 0) s += `\n  ` + l.details.join('\n  ');
            return s;
        }).join('\n\n');

        navigator.clipboard.writeText(text).then(() => {
            toast({ title: "Log copiado", description: `${filteredLogs.length} entradas enviadas para a área de transferência.` });
        }).catch(err => {
            console.error("Falha ao copiar logs:", err);
            toast({ title: "Erro ao copiar", description: "Não foi possível acessar a área de transferência.", variant: "destructive" });
        });
    };

    const filteredLogs = useMemo(() => {
        if (logFilter === 'all') return reasoningLog;
        if (logFilter === 'error') return reasoningLog.filter(l => l.type === 'error' || l.type === 'warning');
        return reasoningLog.filter(l => l.type === logFilter);
    }, [reasoningLog, logFilter]);

    const scanEstimateSec = Math.round(watchedSymbols.length * (councilStats.avgLatencyMs || 4000) / 1000);
    const isScanOverloaded = backgroundIntervalSec < scanEstimateSec;

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
                            <AccordionTrigger className="py-1 px-2 text-[10px] bg-purple-500/5 hover:bg-purple-500/10 rounded-md hover:no-underline text-purple-600 font-bold uppercase tracking-widest">
                                <div className="flex items-center gap-2">
                                    <Brain className="h-3 w-3" /> Raciocínio Interno
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-2 px-2 text-[11px] font-mono text-muted-foreground border-l-2 border-purple-500/30 whitespace-pre-wrap leading-relaxed">
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

    const handleShadowModeToggle = (checked: boolean) => {
        if (isShadowMode && !checked) { 
            const confirmed = window.confirm(`Ativar MODO REAL? Ordens reais (conta ${accountType}) serão enviadas quando o piloto for ligado.`);
            if (!confirmed) return;
        }
        setIsShadowMode(checked);
    };

    const handleAutoModeToggle = () => {
        if (!isAutoMode && !isShadowMode) { 
            const confirmed = window.confirm(`Ligar o piloto em modo REAL (conta ${accountType})?`);
            if (!confirmed) return;
        }
        setIsAutoMode(!isAutoMode);
    };

    const handleRunBacktest = () => {
        runBacktest(payoutInput, targetCount, extraBacktestSymbols);
    };

    return (
        <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6 bg-background min-h-screen text-foreground">
            
            {/* ALERTAS DE RISCO (MODO REAL) */}
            {!isShadowMode && (
              <Alert className="bg-red-500/10 border-red-500/30 text-red-600">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle className="font-black uppercase tracking-tighter">MODO REAL: ORDENS REAIS SERÃO ENVIADAS</AlertTitle>
                <AlertDescription className="text-xs">
                  A execução automática em conta real está ativa. 
                  {(allowedContracts.ACCUMULATORS || allowedContracts.MULTIPLIERS) && (
                    <span className="font-bold block mt-1">⚠️ ATENÇÃO: Contratos do tipo Acumuladores e Multiplicadores ainda não possuem rotina de saída automática (TP/SL) nesta versão do Lab V3.</span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* RADAR DE OPORTUNIDADES V3 */}
            <Card className="bg-purple-500/5 border-purple-500/20 shadow-sm overflow-hidden">
                <CardHeader className="py-3 px-6 bg-purple-500/10 border-b border-purple-500/20 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-purple-700">
                        <Radar className="h-4 w-4 animate-spin-slow" /> Radar de Oportunidades V3
                    </CardTitle>
                    <div className="flex items-center gap-4">
                        <Popover open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7 text-[10px] uppercase font-bold border-purple-200">
                                    Monitorar Ativos <ChevronsUpDown className="ml-2 h-3 w-3" />
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
                            {watchedSymbols.length} Scan Ativo
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="p-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {watchedSymbols.map((symbol) => {
                            const status = radarStatus[symbol];
                            const sent = sentinel[symbol];
                            const isStale = sent?.isStale;
                            return (
                                <div 
                                    key={symbol} 
                                    onClick={() => setActiveSymbol(symbol)}
                                    title={isStale ? `Mercado Defasado: ${sent?.staleMin} min` : `${status?.debugVotes ?? ''} ${status?.holdReason ?? ''}`}
                                    className={cn(
                                        "p-3 rounded-lg border transition-all cursor-pointer group hover:scale-105",
                                        symbol === activeSymbol ? "bg-purple-600 border-purple-600 text-white shadow-md" : "bg-card border-border hover:border-purple-400",
                                        status?.isQualified && !isStale && symbol !== activeSymbol && "animate-pulse border-green-500 bg-green-50/10",
                                        isStale && "opacity-60 grayscale-[0.5]"
                                    )}
                                >
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[10px] font-bold font-mono">{symbol}</span>
                                        {status?.isQualified && !isStale && <Zap className="h-3 w-3 text-yellow-500 fill-current" />}
                                        {isStale && <Badge variant="outline" className="h-3.5 px-1 text-[8px] bg-red-50 text-red-600 border-red-200">OFFLINE</Badge>}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {isStale ? (
                                            <Minus className="h-4 w-4 text-muted-foreground" />
                                        ) : (
                                            <>
                                                {status?.lastAction === 'RISE' || status?.lastAction === 'CALL' ? <TrendingUp className="h-4 w-4 text-green-500" /> : 
                                                 status?.lastAction === 'FALL' || status?.lastAction === 'PUT' ? <TrendingDown className="h-4 w-4 text-red-500" /> : 
                                                 <Minus className="h-4 w-4 text-muted-foreground" />}
                                            </>
                                        )}
                                        <span className="text-sm font-black">{isStale ? 'FECHADO' : (status?.lastAction || 'SCAN')}</span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between text-[9px] opacity-60">
                                        <span className="truncate">{isStale ? `${sent?.staleMin} min atrás` : (status?.lastAction === 'HOLD' ? '—' : (status?.recommendedContract || 'Analisando...'))}</span>
                                        <span className="font-mono">{!isStale && status?.confidence ? `${status.confidence.toFixed(0)}%` : '--'}</span>
                                    </div>
                                    
                                    <div className="flex gap-1 mt-1.5 pt-1.5 border-t border-current/10">
                                        {['OPTIONS', 'MULTIPLIERS', 'ACCUMULATORS'].map((cat) => {
                                            const cand = sent?.candidates.find(c => c.contract === cat);
                                            const score = isStale ? 'fechado' : (cand?.score ?? '--');
                                            const isHigh = !isStale && typeof score === 'number' && score >= 55;
                                            return (
                                                <Badge 
                                                    key={cat} 
                                                    variant="outline" 
                                                    className={cn(
                                                        "text-[9px] px-1 h-3.5 border-none", 
                                                        isHigh ? "bg-green-500/20 text-green-600" : "bg-muted/30 text-muted-foreground opacity-50"
                                                    )}
                                                >
                                                    {cat[0]} {score}
                                                </Badge>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* BARRA DE CONTROLE COMPACTA (MOBILE/TABLET) */}
            <div className="lg:hidden flex flex-wrap items-center gap-3 p-3 bg-muted/30 rounded-xl border">
                <div className="flex items-center gap-2 bg-background p-2 rounded-lg border shadow-sm">
                    <Label htmlFor="mobile-shadow-mode" className="text-[10px] font-black uppercase">Shadow</Label>
                    <Switch id="mobile-shadow-mode" checked={isShadowMode} onCheckedChange={handleShadowModeToggle} />
                </div>
                <Button 
                    onClick={handleAutoModeToggle} 
                    size="sm"
                    className={cn("flex-1 h-9 font-bold text-[10px] uppercase tracking-tighter", isAutoMode ? "bg-destructive text-white" : "bg-purple-600 text-white")}
                >
                    {isAutoMode ? <PauseCircle className="mr-1.5 h-4 w-4" /> : <PlayCircle className="mr-1.5 h-4 w-4" />}
                    {isAutoMode ? 'Parar Conselho' : 'Ativar Conselho'}
                </Button>
                <div className="flex gap-1.5">
                    <Badge variant={isShadowMode ? "outline" : "destructive"} className="text-[9px] h-9 px-3 border-2 uppercase font-black">
                        {isShadowMode ? 'Shadow' : 'Real'}
                    </Badge>
                    <Badge variant={isAutoMode ? "default" : "secondary"} className="text-[9px] h-9 px-3 uppercase font-black">
                        PILOTO {isAutoMode ? 'ON' : 'OFF'}
                    </Badge>
                </div>
            </div>

            {/* HEADER CANÔNICO V3 */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
                <div className="flex items-center gap-3">
                    <div className="bg-purple-500/10 p-2 rounded-xl border border-purple-500/20 shadow-sm">
                        <TestTube className="h-8 w-8 text-purple-600 animate-pulse" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight font-headline text-purple-700">Quant Lab V3.9.6</h1>
                        <div className="flex items-center gap-2">
                             <Badge variant="secondary" className="font-mono text-xs flex items-center gap-1.5">
                                <Coins className="h-3 w-3"/> Saldo: {accountBalance.loading ? '...' : formatCurrency(accountBalance.balance || 0)}
                             </Badge>
                             <Badge variant="outline" className="font-mono text-xs flex items-center gap-1.5">
                                <Wallet className="h-3 w-3"/> P&L: {formatCurrency(sessionStats.pnl)}
                             </Badge>
                             <Badge className={cn("text-[10px] font-bold", isAutoMode ? "bg-green-600" : "bg-blue-600")}>
                                {isAutoMode ? 'AUTOPILOT ON' : 'SENTINELA MODE'}
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
                        <ToggleGroupItem value="demo" className="text-[10px] h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm font-bold uppercase">Demo</ToggleGroupItem>
                        <ToggleGroupItem value="real" className="text-[10px] h-7 px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm font-bold uppercase">Real</ToggleGroupItem>
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
                {/* COLUNA ESQUERDA: CONTROLE DO CONSELHO */}
                <div className="lg:col-span-3 space-y-6">
                    <Card className="border-purple-200 bg-purple-50/10 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-purple-600 flex items-center gap-2">
                                <Zap className="h-4 w-4" /> Cockpit do Laboratório
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between p-3 rounded-lg bg-card border shadow-sm">
                                <Label htmlFor="shadow-mode" className="flex flex-col gap-0.5">
                                    <span className="text-xs font-bold uppercase">Shadow Trading</span>
                                    <span className="text-[10px] text-muted-foreground">Execuções teóricas para validação</span>
                                </Label>
                                <Switch id="shadow-mode" checked={isShadowMode} onCheckedChange={handleShadowModeToggle} />
                            </div>

                            <div className="space-y-4 p-3 rounded-lg border border-purple-200 bg-card/50">
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-muted-foreground flex items-center gap-1.5"><BrainCircuit className="h-3.5 w-3.5"/> Foco (Inferência)</span>
                                        <span className="font-mono text-purple-700 font-bold">{analysisInterval}s</span>
                                    </div>
                                    <Slider value={[analysisInterval]} min={10} max={600} step={5} onValueChange={(v) => setAnalysisInterval(v[0])} />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-muted-foreground flex items-center gap-1.5"><Radar className="h-3.5 w-3.5"/> Background Scan</span>
                                        <span className="font-mono text-purple-700 font-bold">{backgroundIntervalSec}s</span>
                                    </div>
                                    <Slider value={[backgroundIntervalSec]} min={10} max={600} step={5} onValueChange={(v) => setBackgroundIntervalSec(v[0])} />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-muted-foreground flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5"/> Sentinel Frequency</span>
                                    </div>
                                    <Select value={String(sentinelIntervalSec)} onValueChange={(v) => setSentinelIntervalSec(Number(v))}>
                                        <SelectTrigger className="h-8 text-xs font-mono">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="1">1s (Real-time)</SelectItem>
                                            <SelectItem value="2">2s (Balanced)</SelectItem>
                                            <SelectItem value="5">5s (Conservative)</SelectItem>
                                            <SelectItem value="10">10s (Eco)</SelectItem>
                                            <SelectItem value="30">30s (Static)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <Separator />
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] text-muted-foreground uppercase font-bold">
                                        <span>Scan Estimado</span>
                                        <span className="font-mono text-primary font-bold">~{scanEstimateSec}s</span>
                                    </div>
                                    {isScanOverloaded && (
                                        <p className="text-[9px] text-amber-600 font-medium italic animate-pulse">
                                            ⚠️ Ativos serão analisados em fila contínua.
                                        </p>
                                    )}
                                    <div className="flex justify-between text-[10px] text-muted-foreground uppercase font-bold pt-1">
                                        <span>Focus Inference em</span>
                                        <span className="font-mono text-primary font-bold">{timeToNextAnalysis}s</span>
                                    </div>
                                    <Progress value={((analysisInterval - timeToNextAnalysis) / analysisInterval) * 100} className="h-1" />
                                </div>
                            </div>

                            <div className="space-y-4 p-3 rounded-lg border border-purple-200 bg-card/50">
                                <div className="space-y-3">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                                        <TrendingUp className="h-3 w-3" /> Ações Permitidas
                                    </Label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {Object.keys(allowedActions).map((action) => (
                                            <div key={action} className="flex items-center space-x-2">
                                                <Checkbox 
                                                    id={`action-${action}`} 
                                                    checked={allowedActions[action as keyof typeof allowedActions]}
                                                    onCheckedChange={(checked) => {
                                                        setAllowedActions(prev => ({ ...prev, [action]: !!checked }));
                                                    }}
                                                    disabled={isAutoMode}
                                                />
                                                <Label htmlFor={`action-${action}`} className="text-[10px] font-medium leading-none cursor-pointer">
                                                    {action}
                                                </Label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <Separator />
                                <div className="space-y-3">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                                        <Layers className="h-3 w-3" /> Categorias Permitidas
                                    </Label>
                                    <div className="grid grid-cols-1 gap-2">
                                        {Object.keys(allowedContracts).map((contract) => (
                                            <div key={contract} className="flex items-center space-x-2">
                                                <Checkbox 
                                                    id={`contract-${contract}`} 
                                                    checked={allowedContracts[contract as keyof typeof allowedContracts]}
                                                    onCheckedChange={(checked) => {
                                                        setAllowedContracts(prev => ({ ...prev, [contract]: !!checked }));
                                                    }}
                                                    disabled={isAutoMode}
                                                />
                                                <Label htmlFor={`contract-${contract}`} className="text-[10px] font-medium leading-none cursor-pointer">
                                                    {contract}
                                                </Label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <Button 
                                onClick={handleAutoModeToggle} 
                                className={cn("w-full h-12 font-bold shadow-md", isAutoMode ? "bg-destructive text-white" : "bg-purple-600 text-white hover:bg-purple-700")}
                            >
                                {isAutoMode ? <PauseCircle className="mr-2 h-5 w-5" /> : <PlayCircle className="mr-2 h-5 w-5" />}
                                {isAutoMode ? 'Parar Automação' : 'Ativar Conselho V3'}
                            </Button>
                        </CardContent>
                    </Card>

                    {/* HARDWARE NODE */}
                    <Accordion type="single" collapsible defaultValue="hardware" className="w-full">
                        <AccordionItem value="hardware" className="border-none">
                            <Card className="bg-slate-950 text-slate-300 border-slate-800 shadow-xl overflow-hidden font-mono">
                                <AccordionTrigger className="py-3 px-4 hover:no-underline hover:bg-slate-900 border-b border-slate-800">
                                    <div className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 text-cyan-500">
                                        <Gauge className="h-3.5 w-3.5" /> Hardware Node
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="p-4 space-y-4 text-[11px]">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Select 
                                                value={ollamaConfig?.model || ""} 
                                                onValueChange={(val) => {
                                                    if (val !== "none") updateOllamaConfig({ model: val });
                                                }}
                                            >
                                                <SelectTrigger className="h-7 bg-slate-900 border-slate-700 text-[10px] font-mono hover:bg-slate-800 transition-colors py-0 px-2 flex-1">
                                                    <SelectValue placeholder="Model..." />
                                                </SelectTrigger>
                                                <SelectContent className="bg-slate-950 border-slate-800 text-slate-300">
                                                    {v3.availableModels && v3.availableModels.length > 0 ? (
                                                        v3.availableModels
                                                            .filter((model: any, index: number, self: any[]) => 
                                                                index === self.findIndex((m) => m.name === model.name)
                                                            )
                                                            .map((m: any) => (
                                                                <SelectItem key={m.name} value={m.name} className="text-[10px] font-mono">
                                                                    {m.name}
                                                                </SelectItem>
                                                            ))
                                                    ) : (
                                                        <SelectItem value="none" disabled>Nenhum modelo (Clique em 🔄)</SelectItem>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-7 w-7 text-cyan-500 hover:text-cyan-400 hover:bg-slate-800" 
                                                onClick={() => v3.fetchAvailableModels()}
                                                title="Sincronizar"
                                            >
                                                <RefreshCw className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="opacity-60 uppercase">TPS Intensity:</span>
                                            <span className={cn("font-bold", telemetry.avgTokensPerSec > 40 ? "text-green-500" : "text-amber-500")}>
                                                {telemetry.avgTokensPerSec.toFixed(1)} <span className="text-[9px]">TOK/S</span>
                                            </span>
                                        </div>
                                        <Progress value={telemetry.avgTokensPerSec * 2} className="h-1 bg-slate-800" indicatorClassName="bg-cyan-500" />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-3">
                                        <div className="space-y-1">
                                            <p className="opacity-50 uppercase text-[9px]">Consensus Entropy:</p>
                                            <p className={cn("text-xs font-bold", telemetry.consensusEntropy < 0.4 ? "text-green-500" : "text-red-500")}>
                                                {telemetry.consensusEntropy.toFixed(3)}
                                            </p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="opacity-50 uppercase text-[9px]">Cycle Jitter:</p>
                                            <p className="text-xs font-bold text-slate-100">{telemetry.jitterMs}ms</p>
                                        </div>
                                    </div>
                                    
                                    <p className="text-[9px] text-slate-500 italic mt-2">
                                        [STRICT] High entropy (&gt;0.7) prevents autopilot entry.
                                    </p>
                                </AccordionContent>
                            </Card>
                        </AccordionItem>
                    </Accordion>

                    {/* RISCO E SESSÃO */}
                    <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="risk" className="border-none">
                            <Card className="bg-card/50 border-border shadow-sm">
                                <AccordionTrigger className="py-3 px-4 hover:no-underline hover:bg-muted/50 border-b">
                                    <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                        <Activity className="h-4 w-4" /> Risco e sessão
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="p-4 space-y-4">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                                                <Wallet className="h-3 w-3" /> Stake
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
                                                <Target className="h-3 w-3" /> Max Orders
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
                                            <p className="text-[10px] text-muted-foreground uppercase font-bold">WR Session</p>
                                            <p className="text-lg font-bold">
                                              {sessionStats.winRate === null ? '—' : `${sessionStats.winRate.toFixed(1)}%`}
                                            </p>
                                        </div>
                                        <div className="p-3 rounded-lg bg-muted/20 border border-border text-center flex items-center justify-center">
                                            <Button 
                                                variant="outline" 
                                                size="sm"
                                                className="h-8 gap-2 text-[10px] font-bold border-destructive/20 text-destructive hover:bg-destructive/10"
                                                onClick={resetSession}
                                            >
                                                <RefreshCw className="h-3 w-3" />
                                                RESET LAB
                                            </Button>
                                        </div>
                                    </div>
                                    
                                    <div className="flex gap-2 pt-2">
                                        <div className="flex-1 p-2 rounded bg-green-50/50 border border-green-100 flex items-center justify-between">
                                            <span className="text-[9px] uppercase font-black text-green-600">Wins</span>
                                            <span className="text-xs font-black text-green-700">{memoryBuffer.wins.length}</span>
                                        </div>
                                        <div className="flex-1 p-2 rounded bg-red-50/50 border border-red-100 flex items-center justify-between">
                                            <span className="text-[9px] uppercase font-black text-red-600">Losses</span>
                                            <span className="text-xs font-black text-red-700">{memoryBuffer.losses.length}</span>
                                        </div>
                                    </div>

                                    <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        className="w-full h-8 text-[9px] font-bold uppercase text-muted-foreground"
                                        onClick={clearMemory}
                                    >
                                        Limpar Memória Tática
                                    </Button>
                                </AccordionContent>
                            </Card>
                        </AccordionItem>
                    </Accordion>
                </div>

                {/* COLUNA CENTRAL: GRÁFICO E CHAT */}
                <div className="lg:col-span-6 space-y-6">
                    <Card className="min-h-[400px] shadow-sm overflow-hidden">
                        <CardHeader className="bg-muted/10 py-3 border-b flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                                <LineChart className="h-4 w-4 text-purple-600" /> Ativo em Foco: {activeSymbol}
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

                    <Card className="bg-card border-border flex flex-col shadow-sm">
                        <CardHeader className="py-3 border-b border-border bg-purple-50/10">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <MessageSquare className="h-4 w-4 text-purple-600" />
                                    Diálogo Tático com o Conselho
                                </CardTitle>
                                <Select value={chatTarget} onValueChange={setChatTarget}>
                                    <SelectTrigger className="h-7 w-[160px] text-[10px] font-bold uppercase border-purple-200">
                                        <SelectValue placeholder="Personagem" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="CHAIRMAN">Chairman (Síntese)</SelectItem>
                                        <SelectItem value="MOMENTUM">Quant Momentum</SelectItem>
                                        <SelectItem value="RISK_CRITIC">Risk Critic</SelectItem>
                                        <SelectItem value="ARCHIVIST">Pattern Archivist</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardHeader>
                        <CardContent className="h-[350px] overflow-hidden p-0 relative bg-muted/5">
                            <ScrollArea className="h-full p-4">
                                <div className="space-y-4 pb-4">
                                    {chatMessages.length === 0 && (
                                        <div className="text-center py-10 opacity-30">
                                            <Brain className="h-10 w-10 mx-auto mb-2 text-purple-600"/>
                                            <p className="text-xs font-mono">Conselho em prontidão operacional.</p>
                                        </div>
                                    )}
                                    {chatMessages.map((msg, i) => (
                                        <div key={i} className={cn(
                                            "flex flex-col max-w-[85%] rounded-lg p-3 text-xs leading-relaxed border shadow-sm",
                                            msg.role === 'user' ? "bg-primary/10 ml-auto border-primary/20" : 
                                            msg.isError ? "bg-red-50 border-red-200 text-red-700 mr-auto" : "bg-card mr-auto border-border"
                                        )}>
                                            <div className="font-bold uppercase text-[9px] mb-1 opacity-50 flex items-center gap-2">
                                                {msg.role === 'user' ? 'COMANDO' : (msg.agentName || 'CONSELHO')} • {msg.time}
                                                {msg.role === 'assistant' && !msg.isError && (
                                                  <Badge variant="outline" className="h-3 text-[7px] py-0 px-1 border-purple-200 uppercase font-black tracking-tighter">
                                                    {msg.agentName === 'SISTEMA' ? 'Dados do sistema' : 'IA · não verificado'}
                                                  </Badge>
                                                )}
                                                {msg.isError && <AlertCircle className="h-3 w-3 text-red-500" />}
                                            </div>
                                            {msg.role === 'assistant' && !msg.isError ? renderMessageContent(msg.content) : <p className="font-mono whitespace-pre-wrap">{msg.content}</p>}
                                        </div>
                                    ))}
                                    {isChatLoading && (
                                        <div className="flex items-center gap-2 text-xs text-purple-600 animate-pulse p-3 font-mono">
                                            <RefreshCw className="h-3 w-3 animate-spin"/> {chatTarget} está processando...
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
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

                {/* COLUNA DIREITA: VEREDITO E LOG ENGINE */}
                <div className="lg:col-span-3 space-y-6">
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
                                        <p className="text-[10px] uppercase font-bold mb-1 opacity-70">Consenso ({lastDecision.executedVia})</p>
                                        <p className="text-3xl font-black">{lastDecision.finalAction}</p>
                                        <p className="text-xs mt-2 font-mono font-bold">Certainty: {lastDecision.consensusConfidence}%</p>
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
                                    <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Sincronizando Conselho...</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border-purple-200 bg-purple-50/5 shadow-sm">
                        <CardHeader className="py-3 border-b flex flex-row items-center justify-between space-y-0">
                            <CardTitle className="text-xs font-bold uppercase tracking-widest text-purple-600 flex items-center gap-2">
                                <TestTube className="h-4 w-4" /> Backtest das regras (1m)
                            </CardTitle>
                            {Object.keys(backtest.merged).length > 0 && (
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-6 w-6 text-purple-600 hover:text-purple-700 hover:bg-purple-100"
                                    onClick={() => {
                                        const report = buildBacktestReport();
                                        navigator.clipboard.writeText(report).then(() => {
                                            toast({ title: "Relatório Copiado", description: "O sumário estatístico foi enviado para a área de transferência." });
                                        });
                                    }}
                                    title="Copiar Relatório Completo"
                                >
                                    <Copy className="h-3.5 w-3.5" />
                                </Button>
                            )}
                        </CardHeader>
                        <CardContent className="p-4 space-y-4">
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label className="text-[10px] uppercase font-bold text-muted-foreground">Payout (%)</Label>
                                        <Input 
                                            type="number" 
                                            value={payoutInput} 
                                            onChange={(e) => {
                                              const val = Math.max(50, Math.min(100, Number(e.target.value)));
                                              setPayoutInput(val);
                                            }}
                                            className="h-8 text-xs font-mono"
                                            min={50} max={100}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-[10px] uppercase font-bold text-muted-foreground">Candles por ativo</Label>
                                        <Select value={String(targetCount)} onValueChange={v => setTargetCount(Number(v))}>
                                            <SelectTrigger className="h-8 text-xs font-mono">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="5000">5k</SelectItem>
                                                <SelectItem value="20000">20k</SelectItem>
                                                <SelectItem value="40000">40k</SelectItem>
                                                <SelectItem value="50000">50k</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Ativos extra para análise</Label>
                                    <Popover open={isBacktestSelectorOpen} onOpenChange={setIsBacktestSelectorOpen}>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" size="sm" className="w-full h-8 text-[10px] uppercase font-bold border-purple-200 justify-between">
                                                <span>{extraBacktestSymbols.length > 0 ? `${extraBacktestSymbols.length} ativos selecionados` : 'Selecionar Ativos'}</span>
                                                <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[300px] p-0" align="end">
                                            <Command>
                                                <CommandInput placeholder="Buscar ativos (Forex, Cripto...)" />
                                                <CommandList>
                                                    <CommandEmpty>Nenhum ativo encontrado.</CommandEmpty>
                                                    {assetGroups.map((group) => (
                                                        <CommandGroup key={group.label} heading={group.label}>
                                                            {group.options.map((asset) => (
                                                                <CommandItem
                                                                    key={asset.value}
                                                                    onSelect={() => {
                                                                        const newSymbols = extraBacktestSymbols.includes(asset.value)
                                                                            ? extraBacktestSymbols.filter(s => s !== asset.value)
                                                                            : [...extraBacktestSymbols, asset.value];
                                                                        setExtraBacktestSymbols(newSymbols);
                                                                    }}
                                                                >
                                                                    <Check className={cn("mr-2 h-4 w-4", extraBacktestSymbols.includes(asset.value) ? "opacity-100" : "opacity-0")} />
                                                                    {asset.label} ({asset.value})
                                                                </CommandItem>
                                                            ))}
                                                        </CommandGroup>
                                                    ))}
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    
                                    {extraBacktestSymbols.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2">
                                            {extraBacktestSymbols.map(sym => (
                                                <Badge key={sym} variant="secondary" className="text-[9px] h-5 pl-1 pr-0.5 flex items-center gap-1">
                                                    {sym}
                                                    <Button 
                                                        variant="ghost" 
                                                        size="icon" 
                                                        className="h-4 w-4 rounded-full hover:bg-muted"
                                                        onClick={() => setExtraBacktestSymbols(prev => prev.filter(s => s !== sym))}
                                                    >
                                                        <X className="h-2.5 w-2.5" />
                                                    </Button>
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <Button 
                                    onClick={handleRunBacktest} 
                                    disabled={backtest.running}
                                    size="sm"
                                    className="w-full h-8 bg-purple-600 text-white font-bold"
                                >
                                    {backtest.running ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rodar backtest"}
                                </Button>
                            </div>

                            {backtest.progress && <p className="text-[10px] text-center text-purple-600 animate-pulse font-bold uppercase">{backtest.progress}</p>}
                            
                            {Object.keys(backtest.merged).length > 0 && (
                                <div className="space-y-4">
                                    <Alert className="bg-muted/30 border-dashed p-2">
                                        <Info className="h-3 w-3" />
                                        <AlertDescription className="text-[9px] leading-tight">
                                            O período Anterior não foi inspecionado antes. Efeito que aparece no Recente e some no Anterior é ruído. Resultados brutos, sem spread nem comissão.
                                        </AlertDescription>
                                    </Alert>

                                    <Tabs defaultValue="SINTETICOS" className="w-full">
                                        <TabsList className="grid w-full grid-cols-2 h-7">
                                            <TabsTrigger value="SINTETICOS" className="text-[9px] uppercase font-bold">Sintéticos</TabsTrigger>
                                            <TabsTrigger value="REAIS" className="text-[9px] uppercase font-bold">Mercados Reais</TabsTrigger>
                                        </TabsList>
                                        
                                        {['SINTETICOS', 'REAIS'].map(group => (
                                            <TabsContent key={group} value={group} className="mt-2 space-y-4">
                                                {['recent', 'older'].map(period => {
                                                    const reports = backtest.merged[group]?.[period as 'recent' | 'older'];
                                                    if (!reports) return null;

                                                    const groupMeta = Object.entries(backtest.assetMeta)
                                                      .filter(([sym]) => groupOf(sym) === group)
                                                      .map(([, m]) => m);
                                                    
                                                    const minDate = groupMeta.reduce((acc, m) => {
                                                      const d = (period === 'recent' ? (m.mid || m.from) : m.from);
                                                      return !acc || d < acc ? d : acc;
                                                    }, "");
                                                    
                                                    const maxDate = groupMeta.reduce((acc, m) => {
                                                      const d = (period === 'recent' ? m.to : (m.mid || m.from));
                                                      return !acc || d > acc ? d : acc;
                                                    }, "");

                                                    return (
                                                        <div key={period} className="space-y-2">
                                                            <div className="text-[10px] font-black uppercase text-muted-foreground flex items-center justify-between">
                                                                <div className="flex items-center gap-1">
                                                                  {period === 'recent' ? 'Recente (50%)' : 'Anterior (Confirmação 50%)'}
                                                                  <Badge variant="outline" className="h-3.5 text-[8px] py-0 px-1">n total: {reports.reduce((s,r)=>s+r.stat.n, 0)}</Badge>
                                                                </div>
                                                                <span className="opacity-60">{minDate} - {maxDate}</span>
                                                            </div>
                                                            <div className="border rounded-md overflow-hidden">
                                                                <Table>
                                                                    <TableHeader className="bg-muted/30">
                                                                        <TableRow className="h-7">
                                                                            <TableHead className="text-[8px] h-7 px-2 uppercase">Regra</TableHead>
                                                                            <TableHead className="text-[8px] h-7 px-1 uppercase text-center">n</TableHead>
                                                                            <TableHead className="text-[8px] h-7 px-1 uppercase text-center">Acerto [IC95]</TableHead>
                                                                            <TableHead className="text-[8px] h-7 px-1 uppercase text-center">Acaso</TableHead>
                                                                            <TableHead className="text-[8px] h-7 px-1 uppercase text-center">Eq.</TableHead>
                                                                            <TableHead className="text-[8px] h-7 px-1 uppercase text-center">Mov. ATR (t)</TableHead>
                                                                            <TableHead className="text-right text-[8px] h-7 px-2 uppercase">Leitura</TableHead>
                                                                        </TableRow>
                                                                    </TableHeader>
                                                                    <TableBody>
                                                                        {reports.map(r => {
                                                                            const verdictLower = r.verdict.toLowerCase();
                                                                            const isBad = verdictLower.includes('abaixo do ponto de equilibrio') || verdictLower.includes('abaixo do acaso');
                                                                            const isGood = verdictLower.includes('acima do ponto de equilibrio') || verdictLower.includes('acima do acaso');
                                                                            
                                                                            let verdictColor = "text-muted-foreground";
                                                                            if (isBad) verdictColor = "text-red-600 font-bold";
                                                                            else if (isGood) verdictColor = "text-green-600 font-bold";

                                                                            return (
                                                                                <TableRow key={r.rule} className="h-8">
                                                                                    <TableCell className="text-[9px] font-bold p-1.5">{r.rule}</TableCell>
                                                                                    <TableCell className="text-[9px] text-center p-1 font-mono">{r.stat.n}</TableCell>
                                                                                    <TableCell className="text-[9px] text-center p-1 font-mono">
                                                                                        {(r.stat.rate * 100).toFixed(1)}%
                                                                                        <div className="text-[7px] text-muted-foreground">
                                                                                            [{(r.stat.lo * 100).toFixed(0)}-{(r.stat.hi * 100).toFixed(0)}]
                                                                                        </div>
                                                                                    </TableCell>
                                                                                    <TableCell className="text-[9px] text-center p-1 font-mono">{(r.baseline * 100).toFixed(1)}%</TableCell>
                                                                                    <TableCell className="text-[9px] text-center p-1 font-mono">{r.breakeven ? (r.breakeven * 100).toFixed(1) + '%' : '—'}</TableCell>
                                                                                    <TableCell className="text-[9px] text-center p-1 font-mono">
                                                                                        {r.move ? (
                                                                                            <>
                                                                                                {r.move.mean.toFixed(3)}
                                                                                                <div className="text-[7px] text-muted-foreground">t={r.move.t.toFixed(1)}</div>
                                                                                            </>
                                                                                        ) : '—'}
                                                                                    </TableCell>
                                                                                    <TableCell className={cn("text-right p-1.5 text-[8px] leading-tight", verdictColor)}>
                                                                                        {r.stat.n < 50 ? 'n < 50' : 
                                                                                         verdictLower.includes('abaixo do ponto de equilibrio') ? 'ABAIXO do equilíbrio' :
                                                                                         verdictLower.includes('acima do ponto de equilibrio') ? 'ACIMA do equilíbrio' :
                                                                                         verdictLower.includes('indistinguivel') ? 'Indistinguível' :
                                                                                         verdictLower.includes('acima do acaso') ? 'Acima do acaso' :
                                                                                         verdictLower.includes('abaixo do acaso') ? 'Abaixo do acaso' : r.verdict}
                                                                                    </TableCell>
                                                                                </TableRow>
                                                                            );
                                                                        })}
                                                                    </TableBody>
                                                                </Table>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </TabsContent>
                                        ))}
                                    </Tabs>
                                    
                                    <Accordion type="single" collapsible className="w-full">
                                        <AccordionItem value="breakdown" className="border-none">
                                            <AccordionTrigger className="py-1 text-[10px] font-bold uppercase hover:no-underline">Faixas e por ativo</AccordionTrigger>
                                            <AccordionContent className="pt-2">
                                                <ScrollArea className="h-64 border rounded-md p-2 bg-muted/20 text-[9px] font-mono">
                                                    {Object.entries(backtest.merged).map(([group, periods]) => (
                                                      <div key={group} className="mb-6">
                                                        <p className="font-black text-purple-700 mb-2 underline">MERCADO: {group}</p>
                                                        {['recent', 'older'].map(pKey => {
                                                          const reps = periods[pKey as 'recent' | 'older'];
                                                          if (!reps) return null;
                                                          return (
                                                            <div key={pKey} className="ml-2 mb-4">
                                                              <p className="font-bold text-muted-foreground mb-1">[{pKey.toUpperCase()}]</p>
                                                              {reps.map(r => (
                                                                <div key={r.rule} className="ml-2 mb-3 border-l pl-2 border-purple-200">
                                                                  <p className="font-bold">{r.rule}</p>
                                                                  <div className="flex gap-4 opacity-70 mb-1">
                                                                    {r.buckets.map(b => <span key={b.label}>{b.label}: {(b.stat.rate*100).toFixed(1)}% (n={b.stat.n})</span>)}
                                                                  </div>
                                                                  <div className="space-y-0.5">
                                                                    {Object.keys(backtest.perAsset).filter(sym => groupOf(sym) === group).map(sym => {
                                                                      const assetRep = (pKey === 'recent' ? backtest.perAsset[sym].recent : backtest.perAsset[sym].older)?.find(x => x.rule === r.rule);
                                                                      return (
                                                                        <div key={sym} className="flex justify-between max-w-[200px]">
                                                                          <span>{sym}:</span>
                                                                          <span className="font-bold">{assetRep ? `${((assetRep.stat.rate ?? 0) * 100).toFixed(1)}% (n=${assetRep.stat.n})` : "sem período anterior"}</span>
                                                                        </div>
                                                                      );
                                                                    })}
                                                                  </div>
                                                                </div>
                                                              ))}
                                                            </div>
                                                          )
                                                        })}
                                                      </div>
                                                    ))}
                                                </ScrollArea>
                                            </AccordionContent>
                                        </AccordionItem>
                                    </Accordion>
                                    
                                    <p className="text-[9px] text-muted-foreground italic leading-tight border-t pt-2">
                                        n conta episódios (anti-sobreposição de 5 candles).
                                        Opções = direção do candle de 60s seguinte; Multiplicadores = direção após 5 candles (sem TP/SL); Acumuladores = proxy de
                                        calma (não é o contrato real). Payout assumido {backtest.payoutPct}%. Várias regras/faixas aumentam a chance de falso positivo.
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="bg-muted/30 border-dashed font-mono shadow-inner border-purple-200 h-96 flex flex-col">
                        <CardHeader className="py-2 px-4 border-b bg-card/50 flex flex-row items-center justify-between">
                            <CardTitle className="text-[10px] flex items-center gap-2 uppercase tracking-widest font-bold text-muted-foreground">
                                <TerminalIcon className="h-3 w-3" /> Reasoning Engine
                            </CardTitle>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={copyLogs} title="Copiar log">
                                <Copy className="h-3.5 w-3.5" />
                            </Button>
                        </CardHeader>
                        <div className="bg-card/30 px-4 py-2 border-b flex flex-col gap-2">
                             <div className="flex flex-wrap gap-2 text-[9px] font-mono text-muted-foreground leading-tight">
                                <span>{councilStats.total} evals</span>
                                <span>| HOLD {councilStats.total > 0 ? Math.round(councilStats.hold/councilStats.total*100) : 0}%</span>
                                <span>| CALL {councilStats.call}</span>
                                <span>| PUT {councilStats.put}</span>
                                <span>| vetos {councilStats.vetoes}</span>
                                <span>| fallbacks {councilStats.fallbacks}</span>
                                <span>| {(councilStats.avgLatencyMs/1000).toFixed(1)}s/ativo</span>
                             </div>
                             <div className="flex gap-2">
                                {['all', 'decision', 'sentinel', 'execution', 'error'].map(f => (
                                    <Badge 
                                        key={f} 
                                        variant={logFilter === f ? 'default' : 'outline'} 
                                        className="text-[8px] cursor-pointer h-4 px-1.5 uppercase font-black tracking-tighter"
                                        onClick={() => setLogFilter(f as any)}
                                    >
                                        {f === 'decision' ? 'Conselho' : f === 'sentinel' ? 'Sentinela' : f === 'execution' ? 'Execução' : f === 'error' ? 'Erros' : 'Todos'}
                                    </Badge>
                                ))}
                             </div>
                        </div>
                        <CardContent className="p-0 flex-1 overflow-hidden relative">
                            <ScrollArea className="h-full p-4 text-[10px]">
                                {filteredLogs.length === 0 ? (
                                    <p className="animate-pulse text-muted-foreground italic">Aguardando auditoria...</p>
                                ) : (
                                    filteredLogs.map((log, i) => (
                                        <div key={log.ts} className="mb-1.5 border-l-2 border-purple-500/30 pl-2">
                                            <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setExpandedLogTs(expandedLogTs === log.ts ? null : log.ts)}>
                                                <span className="opacity-40 shrink-0">[{log.time}]</span>{' '}
                                                {log.symbol && <Badge variant="outline" className="text-[8px] h-3 px-1 border-purple-200 text-purple-600">{log.symbol}</Badge>}
                                                <span className={cn(
                                                    "font-medium break-words",
                                                    log.type === 'decision' ? "text-purple-600 font-bold" : 
                                                    log.type === 'execution' ? "text-green-600 font-bold" : 
                                                    log.type === 'sentinel' ? "text-blue-500" :
                                                    (log.type === 'error' || log.type === 'warning') ? "text-red-600" : "text-muted-foreground"
                                                )}>{log.message}</span>
                                                {log.details && log.details.length > 0 && <ChevronRight className={cn("h-2.5 w-2.5 transition-transform opacity-30 group-hover:opacity-100", expandedLogTs === log.ts && "rotate-90")} />}
                                            </div>
                                            {expandedLogTs === log.ts && log.details && (
                                                <div className="mt-1 py-1 px-2 bg-muted/40 rounded border-l border-purple-200 font-mono text-[9px] text-muted-foreground whitespace-pre-wrap leading-relaxed animate-in slide-in-from-top-1">
                                                    {log.details.join('\n')}
                                                </div>
                                            )}
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
