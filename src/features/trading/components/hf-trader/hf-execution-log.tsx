// src/features/trading/components/hf-trader/hf-execution-log.tsx
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
import type { Operation } from "@/lib/types";
import { Archive, ArrowDown, ArrowUp } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";

interface HFExecutionLogProps {
  operations: Operation[];
}

const formatTime = (isoString: string | undefined): string => {
    if (!isoString) return "--:--:--";
    try {
        return new Date(isoString).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return "--:--:--";
    }
};

export function HFExecutionLog({ operations }: HFExecutionLogProps) {
    const hfOperations = useMemo(
        () => operations.filter(op => op.initiator === 'HF_Strike').sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        [operations]
    );

    const summary = useMemo(() => {
        const finishedTrades = hfOperations.filter(op => op.status !== 'pending');
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const losses = finishedTrades.filter(op => op.status === 'lost').length;
        const total = wins + losses;
        const winRate = total > 0 ? (wins / total) * 100 : 0;
        const pnl = finishedTrades.reduce((sum, op) => {
            if (op.status === 'lost') return sum - op.stake;
            return sum + (op.result || 0);
        }, 0);
        return { wins, losses, total, winRate, pnl };
    }, [hfOperations]);
    
    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="font-headline flex items-center gap-2">
                           <Archive className="h-5 w-5 text-primary" />
                           Log de Execuções HF
                        </CardTitle>
                        <CardDescription>
                            Histórico de todas as operações executadas pelo sistema HF Strike Zone.
                        </CardDescription>
                    </div>
                    <div className="text-right">
                        <p className="text-xs text-muted-foreground">P&L da Sessão</p>
                        <p className={cn(
                            "text-lg font-bold",
                            summary.pnl >= 0 && "text-green-600",
                            summary.pnl < 0 && "text-destructive"
                        )}>
                            {summary.pnl.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <ScrollArea className="h-[300px]">
                    <div className="p-6 pt-0 space-y-4">
                        {hfOperations.length === 0 ? (
                            <div className="text-center text-muted-foreground pt-10 h-full flex items-center justify-center">
                                <p>Nenhuma operação HF executada ainda.</p>
                            </div>
                        ) : (
                            hfOperations.map((op) => {
                                return (
                                    <div key={op.id} className="flex items-center gap-4 border-b pb-3 last:border-b-0">
                                        <div className="flex-shrink-0">
                                            <div className={cn("p-2 rounded-full", op.direction === 'rise' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600')}>
                                                {op.direction === 'rise' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                                            </div>
                                        </div>
                                        <div className="flex-1 grid grid-cols-2 text-xs">
                                            <div>
                                                <p className="font-bold text-sm">{op.asset}</p>
                                                <p className="text-muted-foreground">Entrada: ${op.stake.toFixed(2)}</p>
                                            </div>
                                             <div className="text-right">
                                                <p className="text-muted-foreground">{new Date(op.timestamp).toLocaleDateString('pt-BR')}</p>
                                                <p className="text-muted-foreground">{formatTime(op.timestamp)}</p>
                                            </div>
                                        </div>
                                        <div className="w-28 text-right">
                                            {op.status === 'pending' ? (
                                                <Badge variant="secondary">Pendente</Badge>
                                            ) : (
                                                <Badge variant={op.status === 'won' ? 'default' : 'destructive'} className={cn(
                                                    'font-mono',
                                                    op.status === 'won' && 'bg-green-100 text-green-800 border-green-200'
                                                )}>
                                                    {op.result! >= 0 ? `+${op.result?.toFixed(2)}` : (op.result || -op.stake).toFixed(2)} USD
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
