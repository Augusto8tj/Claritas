// src/features/trading/components/deriv-trader/deriv-trader-interface-multipliers.tsx
"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ArrowDown, ArrowUp, Loader2, Minus, Plus, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { OperationInitiator } from "@/lib/types";
import type { MultipliersFormValues } from "./deriv-trader-interface-multipliers.types";
import { useDerivApiMultipliers } from "@/features/trading/hooks/use-deriv-api-multipliers";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


interface DerivTraderInterfaceProps {
  symbol: string;
}

export default function DerivTraderInterfaceMultipliers({ symbol }: DerivTraderInterfaceProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<"up" | "down" | null>(null);
  const { isConnected, executeTrade, multiplierOptions } = useDerivApiMultipliers();
  const form = useFormContext<MultipliersFormValues>();

  const handleStakeChange = (amount: number) => {
    const currentStake = form.getValues('stake') || 0;
    let newStake = currentStake + amount;
    newStake = Math.max(1.0, newStake);
    form.setValue('stake', parseFloat(newStake.toFixed(2)));
    form.trigger('stake');
  };

  const handleTrade = async (tradeDirection: "up" | "down") => {
    const isValid = await form.trigger();
    if (!isValid) {
      toast({
        variant: "destructive",
        title: "Entrada Inválida",
        description: "Por favor, corrija os erros no formulário.",
      });
      return;
    }
    if (!isConnected) {
      toast({
        variant: "destructive",
        title: "Não Conectado",
        description: "Verifique sua conexão com a API da Deriv.",
      });
      return;
    }

    setLoading(tradeDirection);
    const data = form.getValues();
    const contractType = tradeDirection === 'up' ? 'MULTUP' : 'MULTDOWN';
    
    const result = await executeTrade(
        contractType,
        data.stake,
        symbol,
        data.multiplier,
        data.takeProfit,
        data.stopLoss,
        data.cancellation,
        'Manual' as OperationInitiator
    );
    
    setLoading(null);

    if (result.success) {
      toast({
        title: "Ordem de Multiplicador Executada!",
        description: `Sua negociação para ${symbol} foi aberta.`,
      });
    } else {
      toast({
        variant: "destructive",
        title: "Falha na Negociação",
        description: result.message || "Não foi possível executar la ordem.",
      });
    }
  };

  const isButtonDisabled = !!loading || !isConnected;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Negociar Multiplicadores</CardTitle>
        <CardDescription>
          Abra posições com risco limitado e potencial de lucro multiplicado.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <Form {...form}>
          <form className="space-y-4">
            <FormField
              control={form.control}
              name="stake"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor da Aposta (USD)</FormLabel>
                  <div className="flex items-center justify-center gap-2">
                      <Button type="button" variant="outline" size="icon" onClick={() => handleStakeChange(-1)}><Minus className="h-4 w-4"/></Button>
                      <div className="relative flex-1">
                          <FormControl>
                              <Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} className="text-center font-bold text-lg pr-12"/>
                          </FormControl>
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">USD</span>
                      </div>
                      <Button type="button" variant="outline" size="icon" onClick={() => handleStakeChange(1)}><Plus className="h-4 w-4"/></Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="multiplier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Multiplicador</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(parseInt(value))}
                    value={String(field.value)}
                    disabled={isButtonDisabled || !multiplierOptions || multiplierOptions.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {multiplierOptions?.map(option => (
                        <SelectItem key={option} value={String(option)}>
                          x{option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />

            <FormField
              control={form.control}
              name="cancellation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5">
                    <span>Cancelamento (Opcional)</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Permite cancelar o seu contrato dentro<br/> do período selecionado para um reembolso parcial.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Escolha um período..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={'none'}>Sem cancelamento</SelectItem>
                      <SelectItem value="5m">5 minutos</SelectItem>
                      <SelectItem value="10m">10 minutos</SelectItem>
                      <SelectItem value="15m">15 minutos</SelectItem>
                      <SelectItem value="30m">30 minutos</SelectItem>
                      <SelectItem value="60m">60 minutos</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="grid grid-cols-2 gap-4">
               <FormField
                  control={form.control}
                  name="takeProfit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <span>Take Profit (Opcional)</span>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>O valor em USD. A posição fechará<br/>automaticamente se o lucro atingir este valor.</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                      </FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Ex: 0.10" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="stopLoss"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <span>Stop Loss (Opcional)</span>
                         <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>O valor em USD. A posição fechará<br/>automaticamente se a perda atingir este valor.<br/>Não pode ser maior que o valor da aposta.</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                      </FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Ex: 0.10" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
            </div>
          </form>
        </Form>
        
        <div className="space-y-2 pt-2">
            <Button
                variant="outline"
                className="w-full h-14 bg-green-500/10 text-green-600 border-green-500/30 hover:bg-green-500/20 hover:text-green-700 flex justify-center items-center"
                onClick={() => handleTrade("up")}
                disabled={isButtonDisabled}
            >
                {loading === "up" ? ( <Loader2 className="h-5 w-5 animate-spin" /> ) : (
                    <div className="flex items-center gap-2">
                        <ArrowUp className="h-5 w-5" />
                        <span className="font-semibold">Up</span>
                    </div>
                )}
            </Button>
            
            <Button
                variant="outline"
                className="w-full h-14 bg-red-500/10 text-red-600 border-red-500/30 hover:bg-red-500/20 hover:text-red-700 flex justify-center items-center"
                onClick={() => handleTrade("down")}
                disabled={isButtonDisabled}
            >
                {loading === "down" ? ( <Loader2 className="h-5 w-5 animate-spin" /> ) : (
                     <div className="flex items-center gap-2">
                        <ArrowDown className="h-5 w-5" />
                        <span className="font-semibold">Down</span>
                    </div>
                )}
            </Button>
        </div>
      </CardContent>
    </Card>
  );
}
