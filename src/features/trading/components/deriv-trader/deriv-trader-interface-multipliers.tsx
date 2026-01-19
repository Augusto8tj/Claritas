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
import { ArrowDown, ArrowUp, Loader2, Minus, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { OperationInitiator } from "@/lib/types";
import type { MultipliersFormValues } from "./deriv-trader-interface-multipliers.types";
import { useDerivApiMultipliers } from "@/features/trading/hooks/use-deriv-api-multipliers";

interface DerivTraderInterfaceProps {
  symbol: string;
}

export default function DerivTraderInterfaceMultipliers({ symbol }: DerivTraderInterfaceProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<"up" | "down" | null>(null);
  const { isConnected, executeTrade } = useDerivApiMultipliers();
  const form = useFormContext<MultipliersFormValues>();

  const handleStakeChange = (amount: number) => {
    const currentStake = form.getValues('stake') || 0;
    let newStake = currentStake + amount;
    newStake = Math.max(0.35, newStake);
    form.setValue('stake', parseFloat(newStake.toFixed(2)));
    form.trigger('stake');
  };

  const handleMultiplierChange = (amount: number) => {
    const currentMultiplier = form.getValues('multiplier') || 1;
    let newMultiplier = currentMultiplier + amount;
    newMultiplier = Math.max(1, newMultiplier);
    form.setValue('multiplier', newMultiplier);
    form.trigger('multiplier');
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
        description: result.message || "Não foi possível executar a ordem.",
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
                   <div className="flex items-center justify-center gap-2">
                      <Button type="button" variant="outline" size="icon" onClick={() => handleMultiplierChange(-10)}><Minus className="h-4 w-4"/></Button>
                      <div className="relative flex-1">
                          <FormControl>
                            <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value) || 0)} className="text-center font-bold text-lg pr-12"/>
                          </FormControl>
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">x</span>
                      </div>
                      <Button type="button" variant="outline" size="icon" onClick={() => handleMultiplierChange(10)}><Plus className="h-4 w-4"/></Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />
            
            <div className="grid grid-cols-2 gap-4">
               <FormField
                  control={form.control}
                  name="takeProfit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Take Profit (Opcional)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Ex: 20" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} />
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
                      <FormLabel>Stop Loss (Opcional)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Ex: 5" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} />
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
