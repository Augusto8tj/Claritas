// src/features/trading/components/deriv-trader/deriv-trader-interface-reset.tsx
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import type { OperationInitiator } from "@/lib/types";
import type { ResetFormValues } from "./deriv-trader-interface-reset.types";
import { useDerivApiReset } from "@/features/trading/hooks/use-deriv-api-reset";

interface DerivTraderInterfaceProps {
  symbol: string;
}

export default function DerivTraderInterfaceReset({ symbol }: DerivTraderInterfaceProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<'call' | 'put' | null>(null);
  const { isConnected, executeTrade } = useDerivApiReset();
  const form = useFormContext<ResetFormValues>();

  const handleTrade = async (tradeDirection: 'call' | 'put') => {
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
    const contractType = tradeDirection === 'call' ? 'RESETCALL' : 'RESETPUT';
    
    const result = await executeTrade(
        contractType,
        data.stake,
        symbol,
        data.reset_barrier_offset,
        'Manual' as OperationInitiator
    );
    
    setLoading(null);

    if (result.success) {
      toast({
        title: `Contrato ${contractType} Executado!`,
        description: `Sua posição em ${symbol} foi aberta.`,
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
        <CardTitle className="font-headline">Negociar Reset Call/Put</CardTitle>
        <CardDescription>
          Abra posições com uma barreira de reset para uma segunda chance.
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
                  <FormLabel>Valor da Aposta (USD)</FormLabel>
                   <FormControl>
                      <Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="reset_barrier_offset"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Offset da Barreira de Reset</FormLabel>
                  <FormControl>
                      <Input type="text" placeholder="+0.1234" {...field} />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Ex: "+0.05" ou "-1.2". O sinal é obrigatório.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        
        <div className="grid grid-cols-2 gap-4 pt-4">
            <Button
                variant="outline"
                className="w-full h-14 bg-green-500/10 text-green-600 border-green-500/30 hover:bg-green-500/20 hover:text-green-700 flex flex-col items-center"
                onClick={() => handleTrade("call")}
                disabled={isButtonDisabled}
            >
                {loading === "call" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
                <span className="font-semibold text-base">Reset Call</span>
            </Button>
            <Button
                variant="outline"
                className="w-full h-14 bg-red-500/10 text-red-600 border-red-500/30 hover:bg-red-500/20 hover:text-red-700 flex flex-col items-center"
                onClick={() => handleTrade("put")}
                disabled={isButtonDisabled}
            >
                {loading === "put" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowDown className="h-5 w-5" />}
                <span className="font-semibold text-base">Reset Put</span>
            </Button>
        </div>
      </CardContent>
    </Card>
  );
}