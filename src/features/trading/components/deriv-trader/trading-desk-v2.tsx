// src/features/trading/components/deriv-trader/trading-desk-v2.tsx
'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { useRobotCouncilV2 } from '../../hooks/use-robot-council-v2';
import type { RobotStrategy } from '@/lib/types';
import { VirtualTradeTimer } from './VirtualTradeTimer';

import {
    BrainCircuit, Activity, Waves, CandlestickChart, Bot, LayoutGrid, BarChart,
    TrendingUp, Cloud, CheckCircle, XCircle, Trophy, AlertTriangle, RefreshCw,
    Swords, Timer, Skull, TrendingDown, Medal, Zap
} from 'lucide-react';

// ============================================================================
// 1. DEFINIÇÃO DE TIPOS E PROPS
// ============================================================================

interface TradingDeskV2Props {
    councilState: ReturnType<typeof useRobotCouncilV2>;
}

// ============================================================================
// 2. MAPA DE ÍCONES E HELPERS VISUAIS
// ============================================================================

const indicatorIcons: { [key: string]: React.ReactNode } = {
    RSI: <BrainCircuit className="h-4 w-4 text-amber-500" />,
    STOCHASTIC: <BrainCircuit className="h-4 w-4 text-slate-400" />,
    MOVING_AVERAGE_CROSS: <Activity className="h-4 w-4 text-blue-500" />,
    BOLLINGER_BANDS: <Waves className="h-4 w-4 text-cyan-500" />,
    MACD_CROSS: <Activity className="h-4 w-4 text-indigo-500" />,
    PRICE_ACTION_PATTERN: <CandlestickChart className="h-4 w-4 text-emerald-500" />,
    ADX_TREND: <TrendingUp className="h-4 w-4 text-purple-500" />,
    ICHIMOKU_CLOUD: <Cloud className="h-4 w-4 text-sky-500" />,
    AWESOME_OSCILLATOR: <BarChart className="h-4 w-4 text-orange-500" />,
    VOLUME_PROFILE: <Activity className="h-4 w-4 text-pink-500" />,
    KAMA: <Activity className="h-4 w-4" />,
    VWAP: <Activity className="h-4 w-4" />,
    Z_SCORE: <BrainCircuit className="h-4 w-4" />,
    STOCH_RSI: <BrainCircuit className="h-4 w-4" />,
    MFI: <BrainCircuit className="h-4 w-4" />,
    TRIX: <Activity className="h-4 w-4" />,
    ROC: <Activity className="h-4 w-4" />,
    DONCHIAN_CHANNELS: <Waves className="h-4 w-4" />,
    RVI: <BrainCircuit className="h-4 w-4" />,
    PARABOLIC_SAR: <TrendingUp className="h-4 w-4" />,
    CHANDELIER_EXIT: <TrendingUp className="h-4 w-4" />,
    OBV: <Activity className="h-4 w-4" />,
    DEFAULT: <Bot className="h-4 w-4 text-muted-foreground" />
};

function renderStrategyParams(robot: RobotStrategy): string {
    if (!robot) return 'N/A'; // Proteção contra robot undefined
    
    switch (robot.strategyType) {
        case 'RSI':
        case 'STOCHASTIC':
        case 'MFI':
        case 'RVI':
            return `Forte < ${robot.strongBuyThreshold}, Fraco < ${robot.weakBuyThreshold}`;
        case 'STOCH_RSI':
            return `Forte < ${robot.strongBuyThreshold?.toFixed(2)}, Fraco < ${robot.weakBuyThreshold?.toFixed(2)}`;
        case 'MOVING_AVERAGE_CROSS':
            return `Cruzamento SMA/EMA ${robot.shortPeriod}/${robot.longPeriod}`;
        case 'BOLLINGER_BANDS':
            return `Per: ${robot.period}, Desvio: ${robot.stdDev}`;
        case 'MACD_CROSS':
            return `MACD ${robot.fastPeriod}/${robot.slowPeriod}/${robot.signalPeriod}`;
        case 'ADX_TREND':
            return `Força Tendência > ${robot.trendStrengthThreshold}`;
        case 'PRICE_ACTION_PATTERN':
            const pattern = robot.pattern === 'hammer' ? 'Martelo' : 'Estrela Cadente';
            return `Padrão: ${pattern}`;
        case 'Z_SCORE':
            return `Desvio (Sigma): ${robot.zScoreThreshold}`;
        case 'VOLUME_PROFILE':
            return `POC Lookback: ${robot.profileBars} candles`;
        case 'PARABOLIC_SAR':
            return `Aceleração: ${robot.acceleration}, Máx: ${robot.maxAcceleration}`;
        case 'CHANDELIER_EXIT':
            return `Per: ${robot.chandelierPeriod}, Mult: ${robot.chandelierMultiplier}`;
        case 'TRIX':
        case 'ROC':
        case 'KAMA':
        case 'DONCHIAN_CHANNELS':
            return `Período Base: ${robot.period}`;
        default:
            return 'Parâmetros Padrão Otimizados';
    }
}

// ============================================================================
// 3. COMPONENTE PRINCIPAL (TRADING DESK V2)
// ============================================================================

export function TradingDeskV2({ councilState }: TradingDeskV2Props) {
    
    const { 
        robotPerformance, 
        isCouncilAutopilotOn, 
        resetArenaPerformance,
        virtualTradesRef, 
        systemMetrics 
    } = councilState;
    
    // Força re-render quando systemMetrics muda
    const [, setForceRender] = React.useState(0);
    React.useEffect(() => {
        setForceRender(prev => prev + 1);
    }, [systemMetrics]);

    const sortedPerformance = useMemo(() => {
        if (!robotPerformance) return [];
        return [...robotPerformance].sort((a, b) => {
            const sharpeA = a.sharpeRatio || -Infinity;
            const sharpeB = b.sharpeRatio || -Infinity;
            if (sharpeA !== sharpeB) return sharpeB - sharpeA;
            return (b.totalProfit || 0) - (a.totalProfit || 0);
        });
    }, [robotPerformance]);

    const activeTrades = virtualTradesRef?.current || [];

    return (
        <Card className="h-full flex flex-col shadow-md border-muted">
            <CardHeader className="pb-3 space-y-1">
                <div className="flex justify-between items-start">
                    <div className="flex flex-col gap-1">
                        <CardTitle className="font-headline flex items-center gap-2 text-xl">
                            <Swords className="h-6 w-6 text-primary" />
                            Arena Virtual V2.5
                        </CardTitle>
                        <CardDescription>
                            Torneio de algoritmos e classificação por Sharpe Ratio.
                        </CardDescription>
                    </div>
                    
                    <div className="flex items-center gap-2">
                         {isCouncilAutopilotOn && (
                            <Badge variant="outline" className="border-green-500 text-green-500 animate-pulse bg-green-500/10">
                                <Zap className="h-3 w-3 mr-1 fill-current" />
                                AO VIVO
                            </Badge>
                        )}
                        <Button 
                            onClick={resetArenaPerformance} 
                            variant="ghost" 
                            size="icon" 
                            disabled={!isCouncilAutopilotOn}
                            title="Resetar Estatísticas"
                        >
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="flex-1 overflow-hidden p-0">
                <Tabs defaultValue="arena" className="h-full flex flex-col">
                    
                    <div className="px-6 border-b">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="arena" className="flex items-center gap-2">
                                <Activity className="h-4 w-4" />
                                Combate Ativo ({activeTrades.length})
                            </TabsTrigger>
                            <TabsTrigger value="ranking" className="flex items-center gap-2">
                                <Trophy className="h-4 w-4" />
                                Classificação ({sortedPerformance.length})
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    {/* --- ABA 1: COMBATE ATIVO (PAPER TRADES) --- */}
                    <TabsContent value="arena" className="flex-1 overflow-hidden flex flex-col m-0 bg-muted/5">
                        <div className="px-6 py-2 bg-muted/20 border-b flex justify-between text-xs text-muted-foreground font-medium uppercase tracking-wider">
                            <span>Estratégia / Robô</span>
                            <span>Status</span>
                        </div>
                        <ScrollArea className="flex-1">
                            {activeTrades.length > 0 ? (
                                <div className="divide-y divide-border/50">
                                    {activeTrades.map((trade) => {
                                        const displayId = trade.robotId.includes('-') ? trade.robotId.split('-')[0] : trade.robotId;

                                        return (
                                            <div key={trade.id} className="px-6 py-4 flex items-center justify-between hover:bg-muted/10 transition-colors">
                                                
                                                <div className="flex items-center gap-4">
                                                    <div className={cn("p-2 rounded-full ring-1 ring-inset", 
                                                        trade.vote === 'RISE' ? "bg-green-500/10 text-green-600 ring-green-500/20" : "bg-red-500/10 text-red-600 ring-red-500/20"
                                                    )}>
                                                        {trade.vote === 'RISE' ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-sm flex items-center gap-2">
                                                            <span>Robô {displayId}</span>
                                                            <Badge variant="outline" className="text-[10px] h-4 px-1 py-0">{trade.regime}</Badge>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground mt-0.5">
                                                            Entrada: <span className="font-mono text-foreground">@{trade.entryPrice?.toFixed(2) || '---'}</span>
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="text-right">
                                                    <Badge variant={trade.vote === 'RISE' ? 'default' : 'destructive'} className="mb-1 font-bold">
                                                        {trade.vote}
                                                    </Badge>
                                                    <VirtualTradeTimer exitEpoch={trade.exitEpoch} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-3">
                                    <Bot className="h-12 w-12 opacity-10" />
                                    <div className="text-center">
                                        <p className="text-sm font-medium">A arena está silenciosa.</p>
                                        <p className="text-xs opacity-70">Aguardando sinais dos robôs analistas...</p>
                                    </div>
                                    {!isCouncilAutopilotOn && (
                                        <Badge variant="destructive" className="mt-2">Sistema Pausado</Badge>
                                    )}
                                </div>
                            )}
                        </ScrollArea>
                    </TabsContent>

                    {/* --- ABA 2: RANKING DETALHADO (LEADERBOARD) --- */}
                    <TabsContent value="ranking" className="flex-1 overflow-hidden flex flex-col m-0">
                         <ScrollArea className="h-full">
                            <Table>
                                <TableHeader className="bg-muted/50 sticky top-0 z-10">
                                    <TableRow>
                                        <TableHead className="w-[200px]">Estratégia</TableHead>
                                        <TableHead className="hidden md:table-cell">Parâmetros Ativos</TableHead>
                                        <TableHead className="text-center">Score (W/L)</TableHead>
                                        <TableHead className="text-center">Sharpe</TableHead>
                                        <TableHead className="text-right">P&L (USD)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedPerformance.length > 0 ? (
                                        sortedPerformance.map((robot, index) => {
                                            const totalTrades = (robot.wins || 0) + (robot.losses || 0);
                                            const isTop3 = index < 3;
                                            const winRate = robot.winRate ?? 0;
                                            
                                            return (
                                                <TableRow key={`${robot.id}-${index}`} className={cn(isTop3 ? "bg-muted/20" : "")}>
                                                    
                                                    <TableCell className="font-medium">
                                                        <div className="flex items-center gap-3">
                                                            <div className="relative">
                                                                {isTop3 && index === 0 && <Trophy className="absolute -top-3 -left-2 h-5 w-5 text-amber-500 drop-shadow-sm" />}
                                                                {indicatorIcons[robot.strategyType] || <Bot className="h-4 w-4" />}
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className={cn("text-sm", isTop3 && "font-bold text-primary")}>
                                                                    {robot.strategyType}
                                                                </span>
                                                                {isTop3 && <span className="text-[10px] text-amber-600 font-semibold">Top Performance</span>}
                                                            </div>
                                                        </div>
                                                    </TableCell>

                                                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[200px] truncate" title={renderStrategyParams(robot.strategy)}>
                                                        {renderStrategyParams(robot.strategy)}
                                                    </TableCell>

                                                    <TableCell>
                                                        <div className="flex flex-col gap-1 items-center w-24 mx-auto">
                                                            <div className="flex justify-between w-full text-[10px]">
                                                                <span className="text-green-600 font-bold">{robot.wins}W</span>
                                                                <span className="text-muted-foreground">{winRate.toFixed(0)}%</span>
                                                                <span className="text-red-600 font-bold">{robot.losses}L</span>
                                                            </div>
                                                            <Progress value={winRate} className={cn("h-1.5 w-full", winRate > 50 ? "bg-green-100" : "bg-red-100")} />
                                                        </div>
                                                    </TableCell>

                                                    <TableCell className="text-center font-mono text-sm">
                                                        {totalTrades > 5 && robot.sharpeRatio !== undefined && robot.sharpeRatio !== null ? (
                                                            <Badge variant="outline" className={cn(
                                                                robot.sharpeRatio > 1.5 ? "border-green-500 text-green-600 bg-green-50" : 
                                                                robot.sharpeRatio > 1.0 ? "border-blue-500 text-blue-600 bg-blue-50" : "border-gray-200"
                                                            )}>
                                                                {robot.sharpeRatio.toFixed(2)}
                                                            </Badge>
                                                        ) : (
                                                            <span className="text-muted-foreground text-xs">-</span>
                                                        )}
                                                    </TableCell>

                                                    <TableCell className={cn(
                                                        'text-right font-bold font-mono',
                                                        (robot.totalProfit || 0) > 0 ? 'text-green-600' : (robot.totalProfit || 0) < 0 ? 'text-red-600' : 'text-muted-foreground'
                                                    )}>
                                                        {(robot.totalProfit || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-32 text-center">
                                                <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                                    <AlertTriangle className="h-8 w-8 opacity-20" />
                                                    <p>Aguardando dados de performance...</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    </TabsContent>
                </Tabs>

                <div className="p-2 border-t bg-muted/30 text-[10px] text-muted-foreground flex justify-between items-center px-4">
                    <span className="flex items-center gap-1"><BrainCircuit className="h-3 w-3"/> Algoritmo Genético Ativo</span>
                    <span className="flex items-center gap-1"><Activity className="h-3 w-3"/> Atualização: Tempo Real</span>
                </div>
            </CardContent>
        </Card>
    );
}
