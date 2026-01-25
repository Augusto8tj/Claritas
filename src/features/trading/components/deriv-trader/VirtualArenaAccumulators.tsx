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
import type { VirtualOperation } from "@/features/trading/hooks/use-accumulators-council";
import { Swords, CheckCircle, XCircle, Timer, BarChart2 } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";

interface VirtualArenaAccumulatorsProps {
  virtualOperations: VirtualOperation[];
}

const formatTime = (epoch: number): string => {
    if (!epoch) return "--:--:--";
    return new Date(epoch * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export function VirtualArenaAccumulators({ virtualOperations }: VirtualArenaAccumulatorsProps) {

    const summary = useMemo(() => {
        const wins = virtualOperations.filter(op => op.status === 'win').length;
        const losses = virtualOperations.filter(op => op.status === 'loss').length;
        const total = wins + losses;
        const winRate = total > 0 ? (wins / total) * 100 : 0;
        return { wins, losses, total, winRate };
    }, [virtualOperations]);

    return (
        <Card className="h-full flex flex-col">
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="font-headline flex items-center gap-2">
                           <Swords className="h-5 w-5 text-primary" />
                           Arena Virtual ({summary.total})
                        </CardTitle>
                        <CardDescription>
                            Simulações em tempo real para validar a eficácia dos sinais de entrada.
                        </CardDescription>
                    </div>
                     <div className="text-right">
                        <p className="text-xs text-muted-foreground">Taxa de Acerto Virtual</p>
                        <p className={cn(
                            "text-lg font-bold",
                            summary.winRate >= 75 && "text-green-600",
                            summary.winRate < 75 && "text-destructive"
                        )}>
                            {summary.winRate.toFixed(1)}%
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex-1 p-0">
                <ScrollArea className="h-full">
                    <div className="p-6 pt-0 space-y-3">
                        {virtualOperations.length === 0 ? (
                            <div className="text-center text-muted-foreground pt-10 h-full flex items-center justify-center">
                                <p>Nenhuma simulação concluída ainda.</p>
                            </div>
                        ) : (
                            virtualOperations.map((op) => {
                                const duration = op.exitTime - op.entryTime;
                                return (
                                <div key={op.id} className="flex items-center justify-between gap-4 border-b pb-2 last:border-b-0 last:pb-0">
                                    <div className="flex-1 space-y-1">
                                        <p className="font-mono text-xs text-muted-foreground">ID: {op.id}</p>
                                        <div className="flex items-center gap-4 text-xs">
                                             <div className="flex items-center gap-1"><Timer className="h-3 w-3"/><span>Entrada: {formatTime(op.entryTime)}</span></div>
                                             <div className="flex items-center gap-1"><BarChart2 className="h-3 w-3"/><span>Prob. Sobrev.: {(op.initialConditions.survivalProbability * 100).toFixed(0)}%</span></div>
                                             <div className="flex items-center gap-1"><Timer className="h-3 w-3"/><span>Duração: {duration}s</span></div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <Badge variant={op.status === 'win' ? 'default' : 'destructive'} className={cn(
                                            op.status === 'win' && 'bg-green-500/10 text-green-700 border-green-500/20'
                                        )}>
                                            {op.status === 'win' ? <CheckCircle className="h-3.5 w-3.5 mr-1.5"/> : <XCircle className="h-3.5 w-3.5 mr-1.5"/>}
                                            {op.status === 'win' ? 'Vitória' : 'Derrota'}
                                        </Badge>
                                        <p className="text-[10px] text-muted-foreground mt-1">{op.reason}</p>
                                    </div>
                                </div>
                            )})
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
