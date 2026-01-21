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
import { ArrowDown, ArrowUp, Briefcase, Clock, Target, MoveUpRight, ShieldAlert, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface OpenPositionsProps {
  operations: (Operation & { source?: string })[];
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
    const openOperations = operations.filter(op => op && op.status === 'pending');

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
                <ScrollArea className="h-[400px]">
                    <div className="p-6 pt-0 space-y-4">
                        {openOperations.length === 0 ? (
                            <div className="text-center text-muted-foreground pt-10 h-full flex items-center justify-center">
                                <p>Nenhuma posição aberta no momento.</p>
                            </div>
                        ) : (
                            openOperations
                              .filter(op => op && typeof op.id !== 'undefined' && typeof op.stake === 'number')
                              .map((op) => {
                                const isMultiplier = (op.contractType || '').startsWith('MULT');
                                const targetValue = op.takeProfit;
                                const stopLossValue = op.stopLoss;
                                const key = `${op.source || 'op'}-${op.id}`;
                                const isAutopilotTrade = op.initiator === 'Piloto' || op.initiator === 'Conselho';
                                const trailingStop = op.trailingStop;
                                const isTrailingActive = isAutopilotTrade && op.status === 'pending' && trailingStop !== undefined && trailingStop > 0;

                                return (
                                    <div key={key} className="flex items-center gap-4 border-b pb-3 last:border-b-0 last:pb-0">
                                        <div className="flex-shrink-0">
                                            <div className={cn("p-2 rounded-full", op.direction === 'rise' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600')}>
                                                {op.direction === 'rise' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                                            </div>
                                        </div>
                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="font-bold text-sm">{op.asset}</p>
                                                    {op.source && <Badge variant="secondary" className="text-[10px]">{op.source}</Badge>}
                                                </div>
                                                <p className="text-muted-foreground">{isMultiplier ? `Multiplicador x${op.multiplier}` : 'Opção Digital'}</p>
                                            </div>
                                            <div className="text-muted-foreground">
                                                <p>Entrada: <span className="font-semibold text-foreground">${(op.stake || 0).toFixed(2)}</span></p>
                                                <p className="flex items-center gap-1"><Clock className="h-3 w-3"/><span>{formatTime(op.timestamp)}</span></p>
                                            </div>
                                            <div className="text-muted-foreground">
                                                <p>Entrada: <span className="font-mono text-foreground">@{op.entryPrice?.toFixed(4)}</span></p>
                                                {!isMultiplier && <p>Duração: <span className="font-semibold text-foreground">{op.duration} {op.durationUnit}</span></p>}
                                            </div>
                                            <div className="text-muted-foreground">
                                                {isMultiplier && (
                                                  <>
                                                    <p className="flex items-center gap-1.5 text-green-600"><Target className="h-3 w-3"/> Alvo: <span className="font-semibold">{targetValue ? `$${targetValue.toFixed(2)}` : 'N/A'}</span></p>
                                                    <p className="flex items-center gap-1.5 text-red-600"><ShieldAlert className="h-3 w-3"/> Stop: <span className="font-semibold">{stopLossValue ? `$${stopLossValue.toFixed(2)}` : 'N/A'}</span></p>
                                                    {isAutopilotTrade && (
                                                        <p className={cn(
                                                            "flex items-center gap-1.5 text-xs", 
                                                            isTrailingActive ? "text-cyan-600 font-semibold" : "text-muted-foreground/80 italic"
                                                        )}>
                                                            <MoveUpRight className="h-3 w-3" /> 
                                                            Stop Móvel: 
                                                            <span className="font-semibold">
                                                                {isTrailingActive ? `$${trailingStop.toFixed(2)}` : 'Ativará com lucro'}
                                                            </span>
                                                        </p>
                                                    )}
                                                  </>
                                                )}
                                            </div>
                                        </div>
                                         {op.initiator === 'Manual' && isMultiplier && (
                                            <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                                                <Settings className="h-4 w-4" />
                                            </Button>
                                        )}
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
