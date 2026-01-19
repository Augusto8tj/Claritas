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
import { ArrowDown, ArrowUp, Briefcase, Clock } from "lucide-react";

interface OpenPositionsProps {
  operations: Operation[];
  title: string;
  description: string;
}

const formatTime = (isoString: string | undefined): string => {
    if (!isoString) return "--:--:--";
    try {
        return new Date(isoString).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return "--:--:--";
    }
};

export function OpenPositions({ operations, title, description }: OpenPositionsProps) {
    const openOperations = operations.filter(op => op.status === 'pending');

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="font-headline flex items-center gap-2">
                           <Briefcase className="h-5 w-5 text-primary" />
                           {title} ({openOperations.length})
                        </CardTitle>
                        <CardDescription>
                            {description}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <ScrollArea className="h-[240px]">
                    <div className="p-6 pt-0 space-y-4">
                        {openOperations.length === 0 ? (
                            <div className="text-center text-muted-foreground pt-10 h-full flex items-center justify-center">
                                <p>Nenhuma posição aberta no momento.</p>
                            </div>
                        ) : (
                            openOperations.map((op) => {
                                const isMultiplier = op.contractType?.startsWith('MULT');
                                return (
                                    <div key={op.id} className="flex items-center gap-4 border-b pb-3 last:border-b-0 last:pb-0">
                                        <div className="flex-shrink-0">
                                            <div className={cn("p-2 rounded-full", op.direction === 'rise' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600')}>
                                                {op.direction === 'rise' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                                            </div>
                                        </div>
                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                                            <div>
                                                <p className="font-bold text-sm">{op.asset}</p>
                                                <p className="text-muted-foreground">{isMultiplier ? `Multiplicador x${op.multiplier}` : 'Opção Digital'}</p>
                                            </div>
                                            <div className="text-muted-foreground">
                                                <p>Entrada: <span className="font-semibold text-foreground">${op.stake.toFixed(2)}</span></p>
                                                <p className="flex items-center gap-1"><Clock className="h-3 w-3"/><span>{formatTime(op.timestamp)}</span></p>
                                            </div>
                                            <div className="text-muted-foreground">
                                                {isMultiplier ? (
                                                     <p>Contrato: <span className="font-semibold text-foreground">MULTIPLICADOR</span></p>
                                                ) : (
                                                    <p>Duração: <span className="font-semibold text-foreground">{op.duration} {op.durationUnit}</span></p>
                                                )}
                                                <p>Entrada: <span className="font-mono text-foreground">@{op.entryPrice?.toFixed(4)}</span></p>
                                            </div>
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
