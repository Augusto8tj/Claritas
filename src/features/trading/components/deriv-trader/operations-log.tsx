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
import { ArrowDown, ArrowUp, Bot, User, Users, MoveRight, Clock, DollarSign, Loader2, XSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { PendingOperationCounter } from "./pending-operation-counter";


interface OperationsLogProps {
  operations: Operation[];
  // Funções para V1
  sellContractV1?: (contractId: number) => Promise<any>;
  priceTicksV1?: TickData[];
  // Funções para V2
  sellContractV2?: (contractId: number) => Promise<any>;
  priceTicksV2?: TickData[];
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

export function OperationsLog({ operations, sellContractV1, priceTicksV1, sellContractV2, priceTicksV2 }: OperationsLogProps) {
  const { toast } = useToast();
  const [sellingContractId, setSellingContractId] = useState<number | null>(null);

  // Usa a função de venda e os ticks apropriados com base no que foi passado
  const sellContract = sellContractV1 || sellContractV2;
  const priceTicks = priceTicksV1 || priceTicksV2 || [];

  const dailySummary = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return operations
      .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today.toDateString())
      .reduce((sum, op) => {
        if (op.status === 'lost') {
            return sum - op.stake; 
        }
        return sum + (op.result || 0);
    }, 0);
  }, [operations]);

  const handleSell = async (contractId: number) => {
    if (!sellContract) return;
    setSellingContractId(contractId);
    const result = await sellContract(contractId);
    if (result.success) {
      toast({ title: "Ordem de Venda Enviada", description: `O contrato ${contractId} será encerrado ao preço de mercado.` });
    } else {
      toast({ title: "Falha na Venda", description: result.message, variant: "destructive" });
    }
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
                    <div key={op.id} className="flex items-center gap-4">
                        {/* Ícone e Título da Operação */}
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
                        
                        {/* Grid de Detalhes */}
                        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                            <div className="col-span-2 md:col-span-4">
                                <p className="text-sm font-medium leading-none">{op.asset} - {op.direction === "rise" ? "Rise" : "Fall"}</p>
                            </div>
                            
                            {/* Detalhes do Contrato */}
                            <div className="text-muted-foreground">
                                <p>Entrada: <span className="font-semibold text-foreground">${op.stake.toFixed(2)}</span></p>
                                <p>Duração: <span className="font-semibold text-foreground">{op.duration} {durationUnitLabels[op.durationUnit] || op.durationUnit}</span></p>
                            </div>

                            {/* Timeline */}
                            <div className="text-muted-foreground">
                                <p className="flex items-center gap-1">
                                    <Clock className="h-3 w-3"/>
                                    <span>{formatTime(op.timestamp)}</span>
                                </p>
                                 <p className="flex items-center gap-1">
                                    <MoveRight className="h-3 w-3"/>
                                    <span>{op.exitTimestamp ? formatTime(op.exitTimestamp) : '--:--:--'}</span>
                                </p>
                            </div>
                            
                             {/* Preços */}
                            <div className="text-muted-foreground font-mono col-span-2 md:col-span-1">
                                <p>Entrada: @{op.entryPrice?.toFixed(4) || '...'}</p>
                                <p>Saída: @{op.exitPrice?.toFixed(4) || '...'}</p>
                            </div>

                        </div>
                        
                        {/* Resultado Final */}
                        <div className={cn("flex items-center gap-1.5 text-sm font-semibold w-28 justify-end",
                            op.status === "pending" && "text-muted-foreground",
                            op.status === "won" && "text-green-600",
                            op.status === "lost" && "text-destructive"
                        )}>
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
