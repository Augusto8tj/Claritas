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
import { Archive, ArrowDown, ArrowUp, Trash2, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StrategyType, strategyMetadata } from '@/features/trading/services/hf-strike-logic';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface HFExecutionLogProps {
  operations: Operation[];
  clearActiveContracts: () => void;
}

const formatTime = (isoString: string | undefined): string => {
    if (!isoString) return "--:--:--";
    try {
        return new Date(isoString).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return "--:--:--";
    }
};

const getStrategyDisplay = (strategyString: string | undefined): string => {
    if (!strategyString) return 'N/A';
    return strategyString
        .split(', ')
        .map(s => strategyMetadata[s as StrategyType]?.label || s.replace(/_/g, ' ').toLowerCase())
        .join(' + ');
};

export function HFExecutionLog({ operations, clearActiveContracts }: HFExecutionLogProps) {
    const [strategyFilter, setStrategyFilter] = useState<StrategyType | 'all'>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'won' | 'lost' | 'pending'>('all');

    const hfOperations = useMemo(
        () => operations.filter(op => op.initiator === 'HF_Strike').sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        [operations]
    );

    const filteredOps = useMemo(() => {
        return hfOperations.filter(op => {
            if (strategyFilter !== 'all' && op.strategy?.includes(strategyFilter) === false) return false;
            if (statusFilter !== 'all' && op.status !== statusFilter) return false;
            return true;
        });
    }, [hfOperations, strategyFilter, statusFilter]);

    const summary = useMemo(() => {
        const finishedTrades = filteredOps.filter(op => op.status !== 'pending');
        const pnl = finishedTrades.reduce((sum, op) => {
            const stakeVal = Number(op.stake) || 0;
            const resultVal = Number(op.result) || 0;
            if (op.status === 'lost') return sum - stakeVal;
            return sum + resultVal;
        }, 0);
        return { pnl };
    }, [filteredOps]);

    const exportToCSV = () => {
        const headers = ['Timestamp', 'Asset', 'Strategy', 'Direction', 'Stake', 'Duration', 'Result', 'Status'];
        const rows = filteredOps.map(op => [
            new Date(op.timestamp).toISOString(),
            op.asset,
            `"${op.strategy || 'N/A'}"`,
            op.direction,
            Number(op.stake),
            `${op.duration}${op.durationUnit}`,
            Number(op.result || 0),
            op.status
        ]);
        
        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hf-execution-log-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };
    
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
                    <div className="flex items-center gap-2">
                        <div className="text-right">
                            <p className="text-xs text-muted-foreground">P&L (Filtrado)</p>
                            <p className={cn(
                                "text-lg font-bold",
                                summary.pnl >= 0 && "text-green-600",
                                summary.pnl < 0 && "text-destructive"
                            )}>
                                {summary.pnl.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
                            </p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={exportToCSV} title="Exportar para CSV">
                            <Download className="h-4 w-4" />
                        </Button>
                        {operations.length > 0 && (
                            <Button variant="ghost" size="icon" onClick={clearActiveContracts} title="Limpar Log de Execuções">
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
                 <div className="flex gap-2 mt-4">
                  <Select value={strategyFilter} onValueChange={(v) => setStrategyFilter(v as any)}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Filtrar por estratégia" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">🎯 Todas</SelectItem>
                      {Object.entries(strategyMetadata).map(([key, meta]) => (
                        <SelectItem key={key} value={key}>{meta.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">📊 Todos</SelectItem>
                      <SelectItem value="won">✅ Ganhos</SelectItem>
                      <SelectItem value="lost">❌ Perdas</SelectItem>
                      <SelectItem value="pending">⏳ Pendentes</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <Badge variant="outline" className="ml-auto">
                    {filteredOps.length} / {hfOperations.length} ops
                  </Badge>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <ScrollArea className="h-[300px]">
                    <div className="p-6 pt-0 space-y-4">
                        {filteredOps.length === 0 ? (
                            <div className="text-center text-muted-foreground pt-10 h-full flex items-center justify-center">
                                <p>Nenhuma operação com os filtros selecionados.</p>
                            </div>
                        ) : (
                            filteredOps.map((op) => (
                                    <div key={op.id} className="flex items-center gap-4 border-b pb-3 last:border-b-0">
                                        <div className="flex-shrink-0">
                                            <div className={cn("p-2 rounded-full", op.direction === 'rise' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600')}>
                                                {op.direction === 'rise' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                                            </div>
                                        </div>
                                        <div className="flex-1 grid grid-cols-2 text-xs">
                                            <div>
                                                <p className="font-bold text-sm">{op.asset}</p>
                                                {op.strategy && (
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <p className="text-muted-foreground text-[11px] capitalize truncate" title={op.strategy}>
                                                                    {getStrategyDisplay(op.strategy)}
                                                                </p>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                <p>{getStrategyDisplay(op.strategy)}</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                )}
                                                <p className="text-muted-foreground">Entrada: ${Number(op.stake).toFixed(2)}</p>
                                            </div>
                                             <div className="text-right">
                                                <p className="text-muted-foreground">{new Date(op.timestamp).toLocaleDateString('pt-BR')}</p>
                                                <p className="text-muted-foreground">{formatTime(op.timestamp)}</p>
                                                {op.duration && op.duration > 0 && (
                                                    <p className="text-muted-foreground">Duração: {op.duration}{op.durationUnit}</p>
                                                )}
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
                                                    {op.status === 'won' 
                                                        ? `+${Number(op.result).toFixed(2)}` 
                                                        : `${(Number(op.result) || -Number(op.stake)).toFixed(2)}`} USD
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                ))
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
