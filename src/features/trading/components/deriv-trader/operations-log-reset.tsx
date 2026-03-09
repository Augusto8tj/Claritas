// src/features/trading/components/deriv-trader/operations-log-reset.tsx
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
import type { Operation, OperationInitiator } from "@/lib/types";
import { Bot, User, Users, MoveRight, Clock, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

interface OperationsLogResetProps {
  operations: Operation[];
  sellContract: (contractId: number) => Promise<any>;
  clearActiveContracts: () => void;
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

export default function OperationsLogReset({ operations, sellContract, clearActiveContracts }: OperationsLogResetProps) {
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
                        <CardTitle className="font-headline">Posições (Reset)</CardTitle>
                        <CardDescription>Acompanhe suas posições abertas e o histórico de negociações.</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="text-right">
                            <p className="text-xs text-muted-foreground">Resultado do Dia</p>
                            <p className={cn("text-lg font-bold", dailySummary >= 0 ? "text-green-600" : "text-destructive")}>
                                {dailySummary.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
                            </p>
                        </div>
                        {operations.length > 0 && (
                            <Button variant="ghost" size="icon" onClick={clearActiveContracts}><Trash2 className="h-4 w-4" /></Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex-1 p-0">
                <ScrollArea className="h-[400px]">
                    <TooltipProvider>
                        <div className="p-6 pt-0 space-y-4">
                            {operations.length === 0 ? (
                                <div className="text-center text-muted-foreground pt-10 h-full flex items-center justify-center">
                                    <p>Nenhuma operação recente.</p>
                                </div>
                            ) : (
                                operations.filter(op => op && op.id != null).map((op) => {
                                    const isWinning = (op.result || 0) >= 0;
                                    return (
                                        <div key={op.id} className="flex items-center gap-4">
                                            <div className="flex-shrink-0">
                                                <div className={cn("p-2 rounded-full", op.direction === 'rise' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600')}>
                                                    {op.direction === 'rise' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                                                </div>
                                            </div>
                                            <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                                                <div className="col-span-2 md:col-span-3"><p className="text-sm font-medium leading-none">{op.asset} - {op.contractType}</p></div>
                                                <div className="text-muted-foreground">Entrada: <span className="font-semibold text-foreground">${op.stake.toFixed(2)}</span></div>
                                                <div className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3"/><span>{formatTime(op.timestamp)}</span></div>
                                                <div className="text-muted-foreground font-mono col-span-2 md:col-span-1">Entrada: @{op.entryPrice?.toFixed(4) || '...'}</div>
                                            </div>
                                            <div className={cn("flex items-center gap-1.5 text-sm font-semibold w-28 justify-end",
                                                op.status === "pending" && "text-muted-foreground",
                                                op.status === "won" && "text-green-600",
                                                op.status === "lost" && "text-destructive"
                                            )}>
                                                {op.status === 'pending' ? 'Pendente' : op.result?.toFixed(2)}
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
