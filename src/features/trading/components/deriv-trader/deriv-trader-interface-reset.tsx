// src/features/trading/components/deriv-trader/deriv-trader-interface-reset.tsx
"use client";

import { useState, useEffect } from "react";
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
import { ArrowDown, ArrowUp, Loader2, Minus, Plus, Wand2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import type { OperationInitiator } from "@/lib/types";
import type { ResetFormValues, DurationUnit } from "./deriv-trader-interface-reset.types";
import { useDerivApiReset, AllContractTypes } from "@/features/trading/hooks/use-deriv-api-reset";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

interface DerivTraderInterfaceProps {
  symbol: string;
  suggestedBarrier: string;
}

const durationUnitLabels: Record<DurationUnit, string> = {
  m: "Minutos",
  h: "Horas",
  d: "Dias",
  s: "Segundos",
  t: "Ticks"
};

export default function DerivTraderInterfaceReset({ symbol, suggestedBarrier }: DerivTraderInterfaceProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<'call' | 'put' | null>(null);
  const { isConnected, executeTrade, durationLimits } = useDerivApiReset();
  const form = useFormContext<ResetFormValues>();
  const durationUnit = form.watch('duration_unit');
  const [mode, setMode] = useState<'reset' | 'high_low' | 'touch'>('reset');

  useEffect(() => {
    // Apenas aplica a barreira sugerida no modo reset, que não tem input manual
    if (mode === 'reset' && suggestedBarrier) {
      form.setValue('barrierOffset', suggestedBarrier);
    }
  }, [suggestedBarrier, form, mode]);

  useEffect(() => {
    if (durationLimits) {
      const limits = durationLimits[durationUnit];
      if (limits) {
        const currentDuration = form.getValues('duration');
        const newDuration = Math.max(limits.min, Math.min(currentDuration, limits.max));
        if (newDuration !== currentDuration) {
          form.setValue('duration', newDuration);
          form.trigger('duration');
        }
      }
    }
  }, [durationUnit, durationLimits, form]);


  const handleTrade = async (direction: 'call' | 'put') => {
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

    setLoading(direction);
    const data = form.getValues();

    let contractType: AllContractTypes;
    switch (mode) {
      case 'reset':
        contractType = direction === 'call' ? 'RESETCALL' : 'RESETPUT';
        break;
      case 'high_low':
        contractType = direction === 'call' ? 'CALL' : 'PUT';
        break;
      case 'touch':
        contractType = direction === 'call' ? 'ONETOUCH' : 'NOTOUCH';
        break;
      default:
        toast({ variant: "destructive", title: "Modo inválido" });
        setLoading(null);
        return;
    }
    
    // Para Reset, o offset é calculado mas não enviado. Para outros, usa-se o valor do formulário.
    const barrierToSend = mode === 'reset' ? '' : (data.barrierOffset || '');
    
    const result = await executeTrade(
        contractType,
        data.stake,
        symbol,
        barrierToSend,
        data.duration,
        data.duration_unit,
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

  const buttonLabels = {
    reset: { call: "Reset Call", put: "Reset Put" },
    high_low: { call: "Higher", put: "Lower" },
    touch: { call: "Touch", put: "No Touch" }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Central de Negociação</CardTitle>
        <CardDescription>
          Execute contratos de Reset, Higher/Lower e Touch/No Touch.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 space-y-6">
        <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="reset">Reset</TabsTrigger>
            <TabsTrigger value="high_low">Higher/Lower</TabsTrigger>
            <TabsTrigger value="touch">Touch/No Touch</TabsTrigger>
          </TabsList>
        </Tabs>

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
            
            {mode !== 'reset' ? (
                <FormField
                control={form.control}
                name="barrierOffset"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel>Offset da Barreira</FormLabel>
                    <div className="flex items-center gap-2">
                        <FormControl>
                            <Input type="text" placeholder="+0.1234" {...field} />
                        </FormControl>
                        <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => form.setValue('barrierOffset', suggestedBarrier)}
                        title="Usar barreira sugerida pela IA"
                        >
                        <Wand2 className="h-4 w-4" />
                        </Button>
                    </div>
                    <FormDescription className="text-xs">
                        A IA sugere <span className="font-bold text-primary">{suggestedBarrier}</span> baseado na volatilidade.
                    </FormDescription>
                    <FormMessage />
                    </FormItem>
                )}
                />
            ) : (
                <div className="text-sm p-3 bg-muted/50 rounded-md border text-muted-foreground">
                    <p>Barreira de Reset é automática. A IA sugere <span className="font-bold text-primary">{suggestedBarrier}</span> como um offset ideal para outros tipos de contrato, baseado na volatilidade atual.</p>
                </div>
            )}

            <Separator />
            
            <Tabs defaultValue="duration" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="duration">Duração</TabsTrigger>
                  <TabsTrigger value="endtime" disabled>Hora de término</TabsTrigger>
              </TabsList>
              <TabsContent value="duration" className="pt-2">
                  <div className="flex gap-2">
                      <FormField
                          control={form.control}
                          name="duration_unit"
                          render={({ field }) => (
                              <FormItem className="w-2/5">
                                  <Select onValueChange={(value) => field.onChange(value as DurationUnit)} value={field.value}>
                                      <FormControl>
                                          <SelectTrigger>
                                              <SelectValue placeholder="Unidade" />
                                          </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                          {Object.entries(durationUnitLabels).map(([value, label]) => (
                                              <SelectItem 
                                                  key={value} 
                                                  value={value} 
                                                  disabled={!durationLimits || !durationLimits[value as DurationUnit]}
                                              >
                                                  {label}
                                              </SelectItem>
                                          ))}
                                      </SelectContent>
                                  </Select>
                              </FormItem>
                          )}
                      />
                      <FormField
                          control={form.control}
                          name="duration"
                          render={({ field }) => (
                          <FormItem className="w-3/5">
                              <div className="flex items-center justify-center gap-0.5">
                                  <FormControl>
                                      <Input 
                                          type="number"
                                          {...field}
                                          onChange={e => field.onChange(parseInt(e.target.value) || 0)}
                                          className="font-semibold text-lg text-center"
                                      />
                                  </FormControl>
                              </div>
                              <FormMessage />
                          </FormItem>
                          )}
                      />
                  </div>
              </TabsContent>
            </Tabs>
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
                <span className="font-semibold text-base">{buttonLabels[mode].call}</span>
            </Button>
            <Button
                variant="outline"
                className="w-full h-14 bg-red-500/10 text-red-600 border-red-500/30 hover:bg-red-500/20 hover:text-red-700 flex flex-col items-center"
                onClick={() => handleTrade("put")}
                disabled={isButtonDisabled}
            >
                {loading === "put" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowDown className="h-5 w-5" />}
                <span className="font-semibold text-base">{buttonLabels[mode].put}</span>
            </Button>
        </div>
      </CardContent>
    </Card>
  );
}
