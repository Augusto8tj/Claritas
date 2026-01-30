// src/features/trading/components/deriv-trader/volatility-trader-interface.tsx
'use client';

import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ArrowDown, ArrowUp, Loader2, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import type { OperationInitiator } from "@/lib/types";
import { useDerivApiV2 } from "@/features/trading/hooks/use-deriv-api-v2";
import type { VolatilityTraderFormValues } from './volatility-trader-interface.types';
import { getConsensusGradientStyle } from './utils/get-consensus-gradient-style';

interface VolatilityTraderInterfaceProps {
  symbol: string;
  consensus?: {
    horizon: string;
    direction: 'RISE' | 'FALL' | 'HOLD';
    certaintyScore: number;
  } | null;
  onSyncDuration: () => void;
}

export default function VolatilityTraderInterface({ symbol, consensus, onSyncDuration }: VolatilityTraderInterfaceProps) {
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
    
    // FIX: A unidade da duração é enviada como 's' para corresponder ao que o formulário usa
    const result = await executeTrade(
        tradeDirection === 'rise' ? 'CALL' : 'PUT',
        data.stake,
        symbol,
        tradeDirection,
        data.duration,
        's', 
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
  const certaintyScore = consensus?.certaintyScore ?? 0;
  const riseButtonStyle = getConsensusGradientStyle(certaintyScore, 'rise');
  const fallButtonStyle = getConsensusGradientStyle(certaintyScore, 'fall');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Negociação Rápida</CardTitle>
        <CardDescription>Execute trades com base na sua análise e no consenso da IA.</CardDescription>
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
                          <Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} />
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
                      <div className="flex items-center gap-2">
                        <FormControl>
                            <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value) || 0)} />
                        </FormControl>
                        <Button type="button" variant="outline" size="icon" onClick={onSyncDuration} title="Sincronizar com tempo ótimo do sinal mais forte">
                            <Zap className="h-4 w-4" />
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
            </div>
             <div className="grid grid-cols-2 gap-4">
                 <Button
                    style={riseButtonStyle}
                    className="h-16 text-white border-none flex flex-col"
                    onClick={() => handleTrade("rise")}
                    disabled={isButtonDisabled}
                >
                    {loading === "rise" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
                    <span className="font-semibold">Rise</span>
                    <span className="text-xs opacity-80 font-mono">({certaintyScore > 0 ? `+${certaintyScore.toFixed(0)}` : certaintyScore.toFixed(0)}%)</span>
                </Button>
                <Button
                    style={fallButtonStyle}
                    className="h-16 text-white border-none flex flex-col"
                    onClick={() => handleTrade("fall")}
                    disabled={isButtonDisabled}
                >
                    {loading === "fall" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowDown className="h-5 w-5" />}
                    <span className="font-semibold">Fall</span>
                    <span className="text-xs opacity-80 font-mono">({certaintyScore < 0 ? certaintyScore.toFixed(0) : `+${certaintyScore.toFixed(0)}`}%)</span>
                </Button>
             </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
