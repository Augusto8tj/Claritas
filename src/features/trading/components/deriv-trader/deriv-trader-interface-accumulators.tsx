// src/features/trading/components/deriv-trader/deriv-trader-interface-accumulators.tsx
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
  FormMessage,
} from "@/components/ui/form";
import { Loader2, Minus, Plus, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { OperationInitiator } from "@/lib/types";
import { Slider } from "@/components/ui/slider";
import type { AccumulatorFormValues } from "./deriv-trader-interface-accumulators.types";
import { useDerivApiAccumulators } from "@/features/trading/hooks/use-deriv-api-accumulators";
import { cn } from "@/lib/utils";

interface DerivTraderInterfaceProps {
  symbol: string;
}

const growthRateOptions = [0.01, 0.02, 0.03, 0.04, 0.05];

export default function DerivTraderInterfaceAccumulators({ symbol }: DerivTraderInterfaceProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const { isConnected, executeTrade } = useDerivApiAccumulators();
  const form = useFormContext<AccumulatorFormValues>();
  const growthRateValue = form.watch('growth_rate');

  const handleStakeChange = (amount: number) => {
    const currentStake = form.getValues('stake') || 0;
    let newStake = currentStake + amount;
    newStake = Math.max(1.0, newStake);
    form.setValue('stake', parseFloat(newStake.toFixed(2)));
    form.trigger('stake');
  };

  const handleTrade = async () => {
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

    setLoading(true);
    const data = form.getValues();
    
    const result = await executeTrade(
        data.stake,
        data.growth_rate,
        symbol,
        'Manual' as OperationInitiator
    );
    
    setLoading(false);

    if (result.success) {
      toast({
        title: "Contrato Acumulador Comprado!",
        description: `Sua posição em ${symbol} foi aberta.`,
      });
    } else {
      toast({
        variant: "destructive",
        title: "Falha na Compra",
        description: result.message || "Não foi possível comprar o contrato.",
      });
    }
  };

  const isButtonDisabled = !!loading || !isConnected;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Negociar Acumuladores</CardTitle>
        <CardDescription>
          Aposte na estabilidade da volatilidade e acumule ganhos.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 space-y-6">
        <Form {...form}>
          <form className="space-y-6">
            <FormField
              control={form.control}
              name="stake"
              render={({ field }) => (
                <FormItem>
                  <Label>Valor da Aposta (USD)</Label>
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
            
            <Separator />

            <FormField
                control={form.control}
                name="growth_rate"
                render={({ field }) => (
                    <FormItem>
                         <div className="flex justify-between items-center mb-2">
                            <Label>Taxa de Crescimento</Label>
                            <span className="font-mono text-lg font-bold text-primary">{(growthRateValue * 100).toFixed(0)}%</span>
                        </div>
                        <FormControl>
                            <Slider
                                min={0.01}
                                max={0.05}
                                step={0.01}
                                value={[field.value]}
                                onValueChange={(value) => field.onChange(value[0])}
                                disabled={isButtonDisabled}
                            />
                        </FormControl>
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                           <span>1%</span>
                           <span>5%</span>
                        </div>
                        <FormMessage />
                    </FormItem>
                )}
            />
          </form>
        </Form>
        
        <div className="space-y-2 pt-4">
            <Button
                className="w-full h-14"
                onClick={handleTrade}
                disabled={isButtonDisabled}
            >
                {loading ? ( <Loader2 className="h-5 w-5 animate-spin" /> ) : (
                    <div className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" />
                        <span className="font-semibold text-base">Comprar Contrato Acumulador</span>
                    </div>
                )}
            </Button>
        </div>
      </CardContent>
    </Card>
  );
}