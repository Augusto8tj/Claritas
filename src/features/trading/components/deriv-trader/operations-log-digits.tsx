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
import type { Operation, OperationInitiator, TickData } from "@/lib/types";
import { Bot, User, Users, MoveRight, Clock } from "lucide-react";
import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

interface OperationsLogDigitsProps {
  operations: Operation[];
  sellContract: (contractId: number) => Promise<any>;
  priceTicks: TickData[];
}

const initiatorIcons: Record<OperationInitiator, React.ReactNode> = {
    Manual: <User className="h-3 w-3" />,
    Piloto: <Bot className="h-3 w-3" />,
    Conselho: <Users className="h-3 w-3" />,
};

const formatTime = (isoString: string | undefined): string => {
    if (!isoString) return "--:--:--";
    try {
        return new Date(isoString).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return "--:--:--";
    }
};

export function OperationsLogDigits({ operations }: OperationsLogDigitsProps) {
    const dailySummary = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return operations
        .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today.toDateString())
        .reduce((sum, op) => sum + (op.result || 0), 0);
    }, [operations]);

    return (
        <Card className="h-full flex flex-col">
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="font-headline">Operações de Dígitos</CardTitle>
                        <CardDescription>
                            Histórico e status das suas negociações de dígitos.
                        </CardDescription>
                    </div>
                    <div className="text-right">
                        <p className="text-xs text-muted-foreground">Resultado do Dia</p>
                        <p className={cn(
                            "text-lg font-bold",
                            dailySummary > 0 && "text-green-600",
                            dailySummary < 0 && "text-destructive"
                        )}>
                            {dailySummary.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
                        </p>
                    </div>
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
                                const isMatch = op.contractType === 'DIGITMATCH';
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
                                                <p className="text-sm font-medium leading-none">{op.asset} - {isMatch ? 'Combina' : 'Difere'}</p>
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
                                                <p>Previsão: <span className="font-bold text-primary">{(op as any).last_digit_prediction}</span></p>
                                                <p>Resultado: @{op.exitPrice?.toFixed(0) || '...'}</p>
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
