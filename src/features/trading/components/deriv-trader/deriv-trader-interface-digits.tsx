// src/features/trading/components/deriv-trader/deriv-trader-interface-digits.tsx
"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Loader2, Minus, Plus, BrainCircuit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { OperationInitiator } from "@/lib/types";
import type { DigitFormValues, DurationUnit } from "./deriv-trader-interface-digits.types";
import { useDerivApiDigits } from "@/features/trading/hooks/use-deriv-api-digits";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type TradeCategory = 'matches_differs' | 'over_under' | 'even_odd';
type DigitContractType = 'DIGITMATCH' | 'DIGITDIFF' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';

interface DerivTraderInterfaceProps {
  symbol: string;
}

const DigitPredictionSelector = () => {
  const form = useFormContext<DigitFormValues>();
  return (
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
              {Array.from({ length: 10 }, (_, i) => (
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
  );
}

function DerivTraderInterfaceDigits({ symbol }: DerivTraderInterfaceProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<DigitContractType | null>(null);
  const { isConnected, executeTrade } = useDerivApiDigits();
  const form = useFormContext<DigitFormValues>();

  const handleStakeChange = (amount: number) => {
    const currentStake = form.getValues('stake') || 0;
    let newStake = currentStake + amount;
    newStake = Math.max(0.35, newStake);
    form.setValue('stake', parseFloat(newStake.toFixed(2)));
    form.trigger('stake');
  }

  const handleTrade = async (tradeType: DigitContractType) => {
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
        description: "Verifique sua conexão com a API Deriv.",
      });
      return;
    }

    const data = form.getValues();

    if ((tradeType !== 'DIGITEVEN' && tradeType !== 'DIGITODD') && (data.last_digit_prediction === undefined || data.last_digit_prediction === null)) {
      toast({
          variant: "destructive",
          title: "Dígito Necessário",
          description: "Por favor, selecione um dígito para esta operação.",
      });
      return;
    }
    
    setLoading(tradeType);

    const result = await executeTrade(
        tradeType,
        data.stake,
        symbol,
        data.duration,
        data.duration_unit,
        'Manual' as OperationInitiator,
        data.last_digit_prediction
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
        description: result.message || "Não foi possível executar a ordem.",
      });
    }
  };

  const isButtonDisabled = !!loading || !isConnected;

  return (
    <Card className="bg-card/50">
      <CardHeader>
        <CardTitle className="font-headline">Negociar Dígitos</CardTitle>
        <CardDescription>Selecione o tipo de contrato e execute sua operação.</CardDescription>
      </CardHeader>
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
          </form>
        </Form>
        <Tabs defaultValue="matches_differs" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="matches_differs">Combina/Difere</TabsTrigger>
            <TabsTrigger value="over_under">Acima/Abaixo</TabsTrigger>
            <TabsTrigger value="even_odd">Par/Ímpar</TabsTrigger>
          </TabsList>
          
          <TabsContent value="matches_differs" className="pt-4 space-y-4">
            <DigitPredictionSelector />
            <div className="grid grid-cols-2 gap-4">
              <Button
                variant="outline"
                className="w-full h-14 bg-blue-500/10 text-blue-600 border-blue-500/30 hover:bg-blue-500/20 hover:text-blue-700 flex flex-col items-center"
                onClick={() => handleTrade("DIGITMATCH")}
                disabled={isButtonDisabled}
              >
                {loading === "DIGITMATCH" ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                  <>
                    <span className="font-semibold text-lg">Combina</span>
                    <span className="text-xs">O último dígito SERÁ {form.watch('last_digit_prediction') ?? '?'}</span>
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full h-14 bg-red-500/10 text-red-600 border-red-500/30 hover:bg-red-500/20 hover:text-red-700 flex flex-col items-center"
                onClick={() => handleTrade("DIGITDIFF")}
                disabled={isButtonDisabled}
              >
                {loading === "DIGITDIFF" ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                  <>
                    <span className="font-semibold text-lg">Difere</span>
                    <span className="text-xs">O último dígito NÃO SERÁ {form.watch('last_digit_prediction') ?? '?'}</span>
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="over_under" className="pt-4 space-y-4">
            <Alert>
              <BrainCircuit className="h-4 w-4" />
              <AlertTitle>Lógica da Estratégia</AlertTitle>
              <AlertDescription className="text-xs">
                Para negociação manual, o dígito que você selecionar abaixo será a barreira. Para o piloto automático, ele usa uma lógica fixa (Acima de 4 / Abaixo de 5) baseada na análise de probabilidade.
              </AlertDescription>
            </Alert>
            <DigitPredictionSelector />
            <div className="grid grid-cols-2 gap-4">
              <Button
                variant="outline"
                className="w-full h-14 bg-green-500/10 text-green-600 border-green-500/30 hover:bg-green-500/20 hover:text-green-700 flex flex-col items-center"
                onClick={() => handleTrade("DIGITOVER")}
                disabled={isButtonDisabled}
              >
                {loading === "DIGITOVER" ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                  <>
                    <span className="font-semibold text-lg">Acima</span>
                    <span className="text-xs">O último dígito será &gt; {form.watch('last_digit_prediction') ?? '?'}</span>
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full h-14 bg-orange-500/10 text-orange-600 border-orange-500/30 hover:bg-orange-500/20 hover:text-orange-700 flex flex-col items-center"
                onClick={() => handleTrade("DIGITUNDER")}
                disabled={isButtonDisabled}
              >
                {loading === "DIGITUNDER" ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                  <>
                    <span className="font-semibold text-lg">Abaixo</span>
                    <span className="text-xs">O último dígito será &lt; {form.watch('last_digit_prediction') ?? '?'}</span>
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="even_odd" className="pt-4 space-y-4">
            <div className="text-center text-sm text-muted-foreground p-4 bg-muted/50 rounded-md">
                Para este tipo de contrato, não é necessário selecionar um dígito de previsão.
            </div>
             <div className="grid grid-cols-2 gap-4">
              <Button
                variant="outline"
                className="w-full h-14 bg-purple-500/10 text-purple-600 border-purple-500/30 hover:bg-purple-500/20 hover:text-purple-700 flex flex-col items-center"
                onClick={() => handleTrade("DIGITEVEN")}
                disabled={isButtonDisabled}
              >
                {loading === "DIGITEVEN" ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                  <>
                    <span className="font-semibold text-lg">Par</span>
                    <span className="text-xs">O último dígito será par</span>
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full h-14 bg-teal-500/10 text-teal-600 border-teal-500/30 hover:bg-teal-500/20 hover:text-teal-700 flex flex-col items-center"
                onClick={() => handleTrade("DIGITODD")}
                disabled={isButtonDisabled}
              >
                {loading === "DIGITODD" ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                  <>
                    <span className="font-semibold text-lg">Ímpar</span>
                    <span className="text-xs">O último dígito será ímpar</span>
                  </>
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export default DerivTraderInterfaceDigits;
