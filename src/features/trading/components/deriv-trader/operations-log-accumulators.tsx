// src/features/trading/components/deriv-trader/operations-log-accumulators.tsx
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
import { Bot, User, Users, MoveRight, Clock, XSquare, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

interface OperationsLogAccumulatorsProps {
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

export default function OperationsLogAccumulators({ operations, sellContract }: OperationsLogAccumulatorsProps) {
    const [sellingContractId, setSellingContractId] = useState<number | null>(null);

    const dailySummary = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return operations
        .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today.toDateString())
        .reduce((sum, op) => sum + (op.result || 0), 0);
    }, [operations]);

    const handleSell = async (contractId: number) => {
        setSellingContractId(contractId);
        await sellContract(contractId);
        setTimeout(() => setSellingContractId(null), 10000);
    };

    return (
        <Card className="h-full flex flex-col">
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="font-headline">Posições (Acumuladores)</CardTitle>
                        <CardDescription>
                            Acompanhe suas posições abertas e o histórico de negociações.
                        </CardDescription>
                    </div>
                    <div className="text-right">
                        <p className="text-xs text-muted-foreground">Resultado do Dia</p>
                        <p className={cn(
                            "text-lg font-bold",
                            dailySummary >= 0 && "text-green-600",
                            dailySummary < 0 && "text-destructive"
                        )}>
                            {dailySummary.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex-1 p-0">
                <ScrollArea className="h-full">
                    <TooltipProvider>
                        <div className="p-6 pt-0 space-y-4">
                            {operations.length === 0 ? (
                                <div className="text-center text-muted-foreground pt-10 h-full flex items-center justify-center">
                                    <p>Nenhuma operação recente.</p>
                                </div>
                            ) : (
                                operations.filter(op => op && typeof op.id !== 'undefined' && typeof (op.stake || 0) === 'number').map((op) => {
                                    const currentProfit = op.result || 0;
                                    const isWinning = currentProfit >= 0;
                                    const isSelling = sellingContractId === op.id;
                                    
                                    return (
                                        <div key={op.id} className="flex items-center gap-4">
                                            <div className="flex-shrink-0">
                                                <Tooltip>
                                                    <TooltipTrigger>
                                                        <div className="p-2 bg-muted rounded-full">
                                                            {op.initiator ? initiatorIcons[op.initiator] : <User className="h-3 w-3" />}
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>Iniciado por: {op.initiator || 'Manual'}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </div>
                                            <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                                                <div className="col-span-2 md:col-span-4">
                                                    <p className="text-sm font-medium leading-none">{op.asset}</p>
                                                </div>
                                                <div className="text-muted-foreground">
                                                    <p>Entrada: <span className="font-semibold text-foreground">${(op.stake || 0).toFixed(2)}</span></p>
                                                    <p>Crescimento: <span className="font-semibold text-foreground">{((op as any).growth_rate * 100 || 1)}%</span></p>
                                                </div>
                                                <div className="text-muted-foreground">
                                                    <p className="flex items-center gap-1"><Clock className="h-3 w-3"/><span>{formatTime(op.timestamp)}</span></p>
                                                    {op.exitTimestamp && <p className="flex items-center gap-1"><MoveRight className="h-3 w-3"/><span>{formatTime(op.exitTimestamp)}</span></p>}
                                                </div>
                                                <div className="text-muted-foreground font-mono col-span-2 md:col-span-1">
                                                    <p>Entrada: @{op.entryPrice?.toFixed(4) || '...'}</p>
                                                     {op.exitPrice && <p>Saída: @{op.exitPrice?.toFixed(4) || '...'}</p>}
                                                </div>
                                            </div>
                                            <div className="w-48 flex justify-end">
                                                {op.status === 'pending' ? (
                                                    <div className="flex items-center gap-2">
                                                        <span className={cn(
                                                            "text-sm font-bold w-20 text-right",
                                                            isWinning ? "text-green-600" : "text-destructive"
                                                        )}>
                                                            {currentProfit.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
                                                        </span>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8"
                                                            onClick={() => handleSell(op.id)}
                                                            disabled={isSelling}
                                                        >
                                                            {isSelling ? <Loader2 className="h-4 w-4 animate-spin"/> : <XSquare className="h-4 w-4"/>}
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className={cn("flex items-center gap-1.5 text-sm font-semibold",
                                                        op.status === "won" && "text-green-600",
                                                        op.status === "lost" && "text-destructive"
                                                    )}>
                                                        <span>{currentProfit.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}</span>
                                                    </div>
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