// src/features/trading/components/deriv-trader/volatility-trader-interface.tsx
'use client';

import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import type { OperationInitiator } from "@/lib/types";
import { useDerivApiV2 } from "@/features/trading/hooks/use-deriv-api-v2";
import type { VolatilityTraderFormValues } from './volatility-trader-interface.types';

interface VolatilityTraderInterfaceProps {
  symbol: string;
}

export default function VolatilityTraderInterface({ symbol }: VolatilityTraderInterfaceProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<'rise' | 'fall' | null>(null);
  const { isConnected, executeTrade } = useDerivApiV2();
  const form = useFormContext<VolatilityTraderFormValues>();

  const handleTrade = async (tradeDirection: 'rise' | 'fall') => {
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
    
    const result = await executeTrade(
        tradeDirection === 'rise' ? 'CALL' : 'PUT',
        data.stake,
        symbol,
        tradeDirection,
        data.duration,
        's', // Hardcoded to seconds
        'Manual' as OperationInitiator
    );
    
    setLoading(null);

    if (result.success) {
      toast({
        title: "Ordem Executada!",
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
        <CardTitle className="font-headline">Negociação Rápida</CardTitle>
        <CardDescription>Execute trades com base na sua análise.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Form {...form}>
          <form className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="stake"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valor (USD)</FormLabel>
                      <FormControl>
                          <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="duration"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duração (Segundos)</FormLabel>
                      <FormControl>
                           <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
            </div>
             <div className="grid grid-cols-2 gap-4">
                 <Button
                    variant="outline"
                    className="h-12 bg-green-500/10 text-green-600 border-green-500/30 hover:bg-green-500/20 hover:text-green-700"
                    onClick={() => handleTrade("rise")}
                    disabled={isButtonDisabled}
                >
                    {loading === "rise" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5 mr-2" />}
                    <span className="font-semibold">Rise</span>
                </Button>
                <Button
                    variant="outline"
                    className="h-12 bg-red-500/10 text-red-600 border-red-500/30 hover:bg-red-500/20 hover:text-red-700"
                    onClick={() => handleTrade("fall")}
                    disabled={isButtonDisabled}
                >
                    {loading === "fall" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowDown className="h-5 w-5 mr-2" />}
                    <span className="font-semibold">Fall</span>
                </Button>
             </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
