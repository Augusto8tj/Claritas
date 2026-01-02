// /src/components/backtesting/backtesting-interface.tsx
"use client";

import { useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, TestTube, Bot, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getChatbotInsightsResponse } from "@/app/actions";
import { useAuth } from "@/features/auth/hooks/use-auth";

const strategySchema = z.object({
  strategyDescription: z.string().min(10, "A descrição da estratégia é muito curta."),
});
type StrategyFormValues = z.infer<typeof strategySchema>;

const mqlSchema = z.object({
  mqlCode: z.string().min(50, "O código MQL5 parece muito curto."),
});
type MqlFormValues = z.infer<typeof mqlSchema>;

export function BacktestingInterface() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const strategyForm = useForm<StrategyFormValues>({
    resolver: zodResolver(strategySchema),
    defaultValues: { strategyDescription: "" },
  });

  const mqlForm = useForm<MqlFormValues>({
    resolver: zodResolver(mqlSchema),
    defaultValues: { mqlCode: "" },
  });

  // Função genérica para chamar a IA
  const callAI = async (query: string) => {
    if (!user) {
        setResult("Erro: Utilizador não autenticado.");
        return;
    }
    const response = await getChatbotInsightsResponse({ 
      query, 
      history: [], 
      userId: user.uid 
    });
    
    if (response.success) {
      setResult(response.success);
    } else {
      setResult(`Erro na análise da IA: ${response.error}`);
    }
  };

  const onStrategySubmit: SubmitHandler<StrategyFormValues> = async (data) => {
    setLoading(true);
    setResult(null);
    const query = `Por favor, faça um backtest da seguinte estratégia: ${data.strategyDescription}. Simule os resultados, P&L e taxa de acerto.`;
    // ATENÇÃO: A funcionalidade de backtesting real não está implementada.
    // A IA irá gerar uma resposta simulada/descritiva com base na query.
    await callAI(query);
    setLoading(false);
  };

  const onMqlSubmit: SubmitHandler<MqlFormValues> = async (data) => {
    setAnalyzing(true);
    setResult(null);
    const query = `Analise o seguinte código MQL5 e descreva a estratégia de negociação em detalhes:\n\n${"```mql5"}
${data.mqlCode}
${"```"}`;
    await callAI(query);
    setAnalyzing(false);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full">
      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle className="font-headline">Simulador de Estratégia</CardTitle>
          <CardDescription>
            Teste estratégias de investimento descrevendo-as ou colando o código de um robô MQL5.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col flex-1">
          <Tabs defaultValue="describe" className="flex-1 flex flex-col">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="describe">Descrever Estratégia</TabsTrigger>
              <TabsTrigger value="mql">Analisar Robô MQL5</TabsTrigger>
            </TabsList>
            <TabsContent value="describe" className="flex-1 flex flex-col">
              <Form {...strategyForm}>
                <form onSubmit={strategyForm.handleSubmit(onStrategySubmit)} className="space-y-4 flex flex-col flex-1">
                  <FormField
                    control={strategyForm.control}
                    name="strategyDescription"
                    render={({ field }) => (
                      <FormItem className="flex-1 flex flex-col">
                        <FormLabel>Descrição da Estratégia</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Ex: Comprar PETR4 se a média móvel de 10 dias cruzar acima da de 30 dias e vender o oposto. Começar com R$10.000, período de 1 ano."
                            className="flex-1 resize-none"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
                    Rodar Simulação com IA
                  </Button>
                </form>
              </Form>
            </TabsContent>
            <TabsContent value="mql" className="flex-1 flex flex-col space-y-4">
              <Form {...mqlForm}>
                <form onSubmit={mqlForm.handleSubmit(onMqlSubmit)} className="space-y-4 flex flex-col flex-1">
                  <FormField
                    control={mqlForm.control}
                    name="mqlCode"
                    render={({ field }) => (
                      <FormItem className="flex-1 flex flex-col">
                        <FormLabel>Código do Robô (.mq5)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Cole o código-fonte do seu robô MQL5 aqui..."
                            className="flex-1 resize-none font-mono text-xs"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                   <Alert className="bg-primary/5 border-primary/20">
                    <Lightbulb className="h-4 w-4 text-primary" />
                    <AlertTitle className="text-primary font-headline">Dica</AlertTitle>
                    <AlertDescription className="text-primary/90">
                      Para robôs com muitas linhas de código, foque em colar as partes principais da lógica, como as funções `OnTick()`, `OnTrade()` e as condições de entrada/saída para uma análise mais precisa.
                    </AlertDescription>
                  </Alert>
                  <Button type="submit" disabled={analyzing} className="w-full" variant="outline">
                    {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
                    Analisar com IA
                  </Button>
                </form>
              </Form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      
      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle className="font-headline">Resultados da Análise da IA</CardTitle>
           <CardDescription>
            A IA analisará sua estratégia e retornará um resumo do resultado.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1">
          {loading || analyzing ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="ml-4 text-muted-foreground">{loading ? "Simulando..." : "Analisando código..."}</p>
            </div>
          ) : result ? (
            <Alert className="bg-primary/5 border-primary/20 h-full">
                <TestTube className="h-4 w-4 text-primary" />
                <AlertTitle className="text-primary font-headline">Análise da IA</AlertTitle>
                <AlertDescription className="text-primary/90 whitespace-pre-wrap">
                    {result}
                </AlertDescription>
            </Alert>
          ) : (
             <div className="flex items-center justify-center h-full text-center text-muted-foreground">
                <p>Os resultados da sua simulação aparecerão aqui.</p>
            </div>
           )}
        </CardContent>
      </Card>
    </div>
  );
}
