// src/features/trading/components/deriv-trader/operations-log-digits.tsx
'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Operation, OperationInitiator, TickData, Asset } from "@/lib/types";
import { Bot, User, Users, MoveRight, Clock, Trash2, Zap, Repeat, Wand2 } from "lucide-react";
import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface OperationsLogDigitsProps {
  operations: Operation[];
  priceTicks: TickData[];
  activeAsset: Asset | null;
  clearActiveContracts: () => void;
}

const initiatorIcons: Record<OperationInitiator, React.ReactNode> = {
    Manual: <User className="h-3 w-3" />,
    Piloto: <Bot className="h-3 w-3" />,
    Conselho: <Users className="h-3 w-3" />,
    HF_Strike: <Zap className="h-3 w-3" />,
    "Repetition Trigger": <Repeat className="h-3 w-3" />,
    Vagalume: <Wand2 className="h-3 w-3" />
};

const formatTime = (isoString: string | undefined): string => {
    if (!isoString) return "--:--:--";
    try {
        return new Date(isoString).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return "--:--:--";
    }
};

const getContractDisplayName = (contractType?: string) => {
    if (!contractType) return 'Dígito';
    if (contractType === 'DIGITMATCH') return 'Combina';
    if (contractType === 'DIGITDIFF') return 'Difere';
    if (contractType === 'DIGITOVER') return 'Acima';
    if (contractType === 'DIGITUNDER') return 'Abaixo';
    if (contractType === 'DIGITEVEN') return 'Par';
    if (contractType === 'DIGITODD') return 'Ímpar';
    return contractType;
};

const StatCard = ({ title, value, subtext, colorClass }: { title: string, value: string, subtext?: string, colorClass?: string }) => (
    <div className="p-2 sm:p-3 border rounded-lg bg-background shadow-sm text-center flex flex-col justify-center">
        <p className="text-xs text-muted-foreground truncate">{title}</p>
        <p className={cn("text-lg sm:text-xl font-bold leading-tight", colorClass)}>{value}</p>
        {subtext && <p className="text-[10px] md:text-[11px] text-muted-foreground mt-0.5">{subtext}</p>}
    </div>
);

export function OperationsLogDigits({ operations, priceTicks, activeAsset, clearActiveContracts }: OperationsLogDigitsProps) {
    const stats = useMemo(() => {
        const finishedOps = operations.filter(op => op.status !== 'pending');
        
        const totalTrades = finishedOps.length;
        if (totalTrades === 0) {
            return {
                totalTrades: 0,
                totalStaked: 0,
                pnl: 0,
                winRate: 0,
                wins: 0,
                losses: 0,
                payoffRatio: 0,
            };
        }

        const wins = finishedOps.filter(op => op.status === 'won');
        const losses = finishedOps.filter(op => op.status === 'lost');

        const totalStaked = finishedOps.reduce((sum, op) => sum + op.stake, 0);
        const pnl = finishedOps.reduce((sum, op) => {
            if(op.status === 'won') return sum + (op.result || 0);
            if(op.status === 'lost') return sum - op.stake;
            return sum;
        }, 0);

        const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

        const totalWinAmount = wins.reduce((sum, op) => sum + (op.result || 0), 0);
        const totalLossAmount = losses.reduce((sum, op) => sum + op.stake, 0);

        const avgWin = wins.length > 0 ? totalWinAmount / wins.length : 0;
        const avgLoss = losses.length > 0 ? totalLossAmount / losses.length : 0;
        
        const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0;

        return {
            totalTrades,
            totalStaked,
            pnl,
            winRate,
            wins: wins.length,
            losses: losses.length,
            payoffRatio,
        };
    }, [operations]);

    const getLastDigit = (price: number | undefined): string => {
        if (price === undefined) return '...';
        const pip = activeAsset?.pip ?? 2;
        return price.toFixed(pip).slice(-1);
    };

    return (
        <Card className="h-full flex flex-col">
            <CardHeader>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                    <div>
                        <CardTitle className="font-headline text-xl lg:text-2xl">Dashboard de Dígitos</CardTitle>
                        <CardDescription>
                            Análise de desempenho da sua sessão atual.
                        </CardDescription>
                    </div>
                     {operations.length > 0 && (
                        <Button variant="outline" size="sm" onClick={clearActiveContracts} className="w-full sm:w-auto">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Limpar Log
                        </Button>
                    )}
                </div>
                 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-4">
                    <StatCard 
                        title="Resultado Total" 
                        value={stats.pnl.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
                        colorClass={stats.pnl >= 0 ? 'text-green-600' : 'text-red-600'}
                    />
                    <StatCard 
                        title="Win Rate" 
                        value={`${stats.winRate.toFixed(1)}%`} 
                        colorClass={stats.winRate >= 50 ? 'text-green-600' : 'text-red-600'}
                        subtext={`${stats.wins}V / ${stats.losses}D`}
                    />
                    <StatCard 
                        title="Payoff Ratio" 
                        value={stats.payoffRatio.toFixed(2)}
                        subtext="Lucro/Prejuízo Médio"
                    />
                    <StatCard 
                        title="Total Apostado" 
                        value={stats.totalStaked.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
                        subtext={`${stats.totalTrades} trades`}
                    />
                </div>
            </CardHeader>
            <CardContent className="flex-1 p-0">
                <ScrollArea className="h-[200px] sm:h-[240px] lg:h-[calc(100%-1rem)]">
                    <TooltipProvider>
                        <div className="p-6 pt-0 space-y-4">
                            {operations.length === 0 ? (
                            <div className="text-center text-muted-foreground pt-10">
                                <p>Nenhuma operação recente.</p>
                            </div>
                            ) : (
                            operations
                                .filter(op => op && op.id != null)
                                .map((op) => {
                                const displayName = getContractDisplayName(op.contractType);
                                return (
                                    <div key={op.id} className="flex items-center gap-4">
                                        <div className="flex-shrink-0">
                                            <Tooltip>
                                                <TooltipTrigger>
                                                    <div className="p-2 bg-muted rounded-full">
                                                        {initiatorIcons[op.initiator]}
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>Iniciado por: {op.initiator}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                                            <div className="col-span-2 md:col-span-4">
                                                <p className="text-sm font-medium leading-none">{op.asset} - {displayName}</p>
                                            </div>
                                            <div className="text-muted-foreground">
                                                <p>Entrada: <span className="font-semibold text-foreground">${op.stake.toFixed(2)}</span></p>
                                                <p>Duração: <span className="font-semibold text-foreground">{op.duration} ticks</span></p>
                                            </div>
                                            <div className="text-muted-foreground">
                                                <p className="flex items-center gap-1"><Clock className="h-3 w-3"/><span>{formatTime(op.timestamp)}</span></p>
                                                <p className="flex items-center gap-1"><MoveRight className="h-3 w-3"/><span>{formatTime(op.exitTimestamp)}</span></p>
                                            </div>
                                            <div className="text-muted-foreground font-mono col-span-2 md:col-span-1">
                                                <p>Previsão: <span className="font-bold text-primary">{(op as any).last_digit_prediction ?? '-'}</span></p>
                                                <p>Resultado: @{getLastDigit(op.exitPrice)}</p>
                                            </div>
                                        </div>
                                        <div className="w-28 text-right">
                                            {op.status === 'pending' ? (
                                                <Badge variant="secondary">Pendente</Badge>
                                            ) : (
                                                 <Badge variant={op.status === 'won' ? 'default' : 'destructive'} className={cn(op.status === 'won' && "bg-green-600/20 text-green-800 border-green-600/30")}>
                                                    {op.status === "won" ? `+${op.result?.toFixed(2)}` : `-${op.stake.toFixed(2)}`} USD
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                            )}
                        </div>
                    </TooltipProvider>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
