// src/features/trading/components/deriv-trader/operations-log.tsx
"use client";

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
import { ArrowDown, ArrowUp, Bot, User, Users, MoveRight, Clock, DollarSign } from "lucide-react";
import { useMemo, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDerivApiV2 as useDerivApi } from "@/features/trading/hooks/use-deriv-api-v2";
import { useToast } from "@/hooks/use-toast";
import { PendingOperationCounter } from "./pending-operation-counter";


interface OperationsLogProps {
  operations: Operation[];
}

const durationUnitLabels: { [key: string]: string } = {
  t: "ticks",
  s: "segundos",
  m: "minutos",
  h: "horas",
  d: "dias",
};

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

export function OperationsLog({ operations }: OperationsLogProps) {
  const { sellContract, priceTicks } = useDerivApi();
  const { toast } = useToast();
  const [sellingContractId, setSellingContractId] = useState<number | null>(null);

  const dailySummary = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return operations
      .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today.toDateString())
      .reduce((sum, op) => {
        if (op.status === 'lost') {
            return sum - op.stake; // Subtrai o stake em caso de perda
        }
        return sum + (op.result || 0); // Soma o lucro em caso de vitória
    }, 0);
  }, [operations]);

  const handleSell = async (contractId: number) => {
    setSellingContractId(contractId);
    const result = await sellContract(contractId);
    if (result.success) {
      toast({ title: "Ordem de Venda Enviada", description: `O contrato ${contractId} será encerrado ao preço de mercado.` });
    } else {
      toast({ title: "Falha na Venda", description: result.message, variant: "destructive" });
    }
    // O status será atualizado via WebSocket, não precisamos remover o loading state aqui
  };

  const latestTick = useMemo(() => {
    return priceTicks.length > 0 ? priceTicks[priceTicks.length - 1] : null;
  }, [priceTicks]);
  
  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex justify-between items-start">
            <div>
                <CardTitle className="font-headline">Operações</CardTitle>
                <CardDescription>
                Histórico e status das suas negociações.
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
                operations.map((op) => {
                  
                  const currentStatus = (() => {
                    if (op.status !== 'pending' || !latestTick || !op.entryPrice) return 'even';
                    if (op.direction === 'rise') {
                      return latestTick.price > op.entryPrice ? 'winning' : 'losing';
                    } else { // 'fall'
                      return latestTick.price < op.entryPrice ? 'winning' : 'losing';
                    }
                  })();

                  return (
                    <div key={op.id} className="flex items-center">
                    <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium leading-none flex items-center gap-1.5">
                         <Tooltip>
                            <TooltipTrigger>
                                <div className="p-1 bg-muted rounded-full">
                                    {initiatorIcons[op.initiator]}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Iniciado por: {op.initiator}</p>
                            </TooltipContent>
                        </Tooltip>
                        <span>{op.asset} - {op.direction === "rise" ? "Rise" : "Fall"}</span>
                        </p>
                        <div className="text-xs text-muted-foreground pl-9 space-y-1">
                            <p>Entrada: ${op.stake.toFixed(2)} | Duração: {op.duration} {durationUnitLabels[op.durationUnit] || op.durationUnit}</p>
                             <div className="flex items-center gap-1.5">
                                <Clock className="h-3 w-3" />
                                <span>{formatTime(op.timestamp)}</span>
                                {op.exitTimestamp && (
                                    <span className="flex items-center gap-1.5"><MoveRight className="h-3 w-3" /> {formatTime(op.exitTimestamp)}</span>
                                )}
                            </div>
                            {op.entryPrice && (
                                <div className="flex items-center gap-1.5 font-mono">
                                    <DollarSign className="h-3 w-3"/>
                                    <span>{op.entryPrice.toFixed(4)}</span>
                                    {op.exitPrice && (
                                       <span className="flex items-center gap-1.5"><MoveRight className="h-3 w-3" /> {op.exitPrice.toFixed(4)}</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <div
                        className={cn(
                        "flex items-center gap-1.5 text-sm font-semibold",
                        op.status === "pending" && "text-muted-foreground",
                        op.status === "won" && "text-green-600",
                        op.status === "lost" && "text-destructive"
                        )}
                    >
                        {op.status === "pending" ? (
                        <PendingOperationCounter
                          operation={op}
                          onSell={() => handleSell(op.id)}
                          isSelling={sellingContractId === op.id}
                          currentStatus={currentStatus}
                        />
                        ) : op.status === "won" ? (
                        <>
                            <ArrowUp className="h-4 w-4" />
                            <span>+${op.result?.toFixed(2)}</span>
                        </>
                        ) : (
                        <>
                            <ArrowDown className="h-4 w-4" />
                            <span>-${op.stake.toFixed(2)}</span>
                        </>
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
