// src/features/trading/components/deriv-trader/deriv-trader-interface-digits.tsx
"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Loader2, Minus, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { OperationInitiator } from "@/lib/types";
import type { DigitFormValues, DurationUnit } from "./deriv-trader-interface-digits.types";
import { useDerivApiDigits } from "@/features/trading/hooks/use-deriv-api-digits";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface DerivTraderInterfaceProps {
  symbol: string;
}

function DerivTraderInterfaceDigits({ symbol }: DerivTraderInterfaceProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<'match' | 'diff' | null>(null);
  const { isConnected, executeTrade } = useDerivApiDigits();
  const form = useFormContext<DigitFormValues>();

  const handleStakeChange = (amount: number) => {
    const currentStake = form.getValues('stake') || 0;
    let newStake = currentStake + amount;
    newStake = Math.max(0.35, newStake);
    form.setValue('stake', parseFloat(newStake.toFixed(2)));
    form.trigger('stake');
  }

  const handleTrade = async (tradeType: 'DIGITMATCH' | 'DIGITDIFF') => {
    const isValid = await form.trigger();
    if (!isValid) {
        toast({
            variant: "destructive",
            title: "Entrada Inválida",
            description: "Por favor, corrija os erros no formulário antes de negociar.",
        });
        return;
    }
     if (!isConnected) {
      toast({
        variant: "destructive",
        title: "Não Conectado",
        description: "Não é possível negociar. Verifique sua conexão e token de API.",
      });
      return;
    }

    const data = form.getValues();
    setLoading(tradeType === 'DIGITMATCH' ? 'match' : 'diff');

    const result = await executeTrade(
        tradeType,
        data.stake,
        symbol,
        data.last_digit_prediction,
        data.duration,
        data.duration_unit,
        'Manual' as OperationInitiator
    );
    
    setLoading(null);

    if (result.success && result.contractId) {
      toast({
        title: "Ordem de Dígito Executada!",
        description: `Sua negociação para ${symbol} foi aberta.`,
      });
    } else {
      toast({
        variant: "destructive",
        title: "Falha na Negociação",
        description: result.message || "Não foi possível executar a ordem. Tente novamente.",
      });
    }
  };

  const isButtonDisabled = !!loading || !isConnected;

  return (
    <div className="space-y-6">
      <Card className="bg-card/50">
        <CardContent className="p-4 space-y-4">
            <Form {...form}>
                <form className="space-y-4">
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
                      name="last_digit_prediction"
                      render={({ field }) => (
                        <FormItem>
                            <Label>Previsão do Último Dígito</Label>
                            <FormControl>
                                <ToggleGroup 
                                    type="single" 
                                    className="grid grid-cols-5 gap-1"
                                    value={String(field.value)}
                                    onValueChange={(value) => {
                                        if (value) field.onChange(parseInt(value, 10));
                                    }}
                                >
                                    {Array.from({length: 10}, (_, i) => (
                                        <ToggleGroupItem key={i} value={String(i)} className="text-lg font-bold h-12 w-full">
                                            {i}
                                        </ToggleGroupItem>
                                    ))}
                                </ToggleGroup>
                            </FormControl>
                             <FormMessage />
                        </FormItem>
                      )}
                    />
                </form>
            </Form>
            
            <div className="grid grid-cols-2 gap-4 pt-2">
                <Button
                    variant="outline"
                    className="w-full h-14 bg-blue-500/10 text-blue-600 border-blue-500/30 hover:bg-blue-500/20 hover:text-blue-700 flex flex-col items-center"
                    onClick={() => handleTrade("DIGITMATCH")}
                    disabled={isButtonDisabled}
                >
                    {loading === "match" ? ( <Loader2 className="h-5 w-5 animate-spin" /> ) : (
                        <>
                            <span className="font-semibold text-lg">Combina</span>
                            <span className="text-xs">O último dígito será {form.getValues('last_digit_prediction')}</span>
                        </>
                    )}
                </Button>
                
                <Button
                    variant="outline"
                    className="w-full h-14 bg-red-500/10 text-red-600 border-red-500/30 hover:bg-red-500/20 hover:text-red-700 flex flex-col items-center"
                    onClick={() => handleTrade("DIGITDIFF")}
                    disabled={isButtonDisabled}
                >
                    {loading === "diff" ? ( <Loader2 className="h-5 w-5 animate-spin" /> ) : (
                        <>
                            <span className="font-semibold text-lg">Difere</span>
                            <span className="text-xs">O último dígito NÃO será {form.getValues('last_digit_prediction')}</span>
                        </>
                    )}
                </Button>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default DerivTraderInterfaceDigits;
