// src/features/trading/components/deriv-trader/ai-analysis-interface-digits.tsx
"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, BrainCircuit } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { getChatbotInsightsResponse } from "@/app/actions";

interface AIAnalysisInterfaceDigitsProps {
    symbol?: string | null;
}

export function AIAnalysisInterfaceDigits({ symbol }: AIAnalysisInterfaceDigitsProps) {
  const { user } = useAuth();
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    if (!user) {
        setAnalysisResult("Erro: Utilizador não autenticado.");
        return;
    }
    
    setIsAnalyzing(true);
    setAnalysisResult(null);

    const query = `Com base na geração algorítmica constante do ativo ${symbol || 'Volatility Index'}, analise a frequência dos últimos 1000 ticks. Identifique padrões de 'saturação' (dígitos que não saem há muito tempo) e sugira o dígito mais provável para um contrato 'Combina' (menos frequente) e o mais provável para um 'Difere' (mais frequente).`;

    const response = await getChatbotInsightsResponse({
        query,
        history: [],
        userId: user.uid,
    });
    
    setAnalysisResult(response.success || `Erro: ${response.error}`);
    setIsAnalyzing(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            Análise de Dígitos com IA
        </CardTitle>
        <CardDescription>
          Peça à IA para analisar a frequência dos últimos dígitos para o ativo selecionado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          variant="outline"
          className="w-full"
          onClick={handleAnalyze}
          disabled={isAnalyzing}
        >
          {isAnalyzing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Analisar Frequência de Dígitos
        </Button>
        {isAnalyzing && (
            <div className="flex items-center justify-center text-muted-foreground p-4">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span>Analisando...</span>
            </div>
        )}
        {analysisResult && (
          <Alert
            variant={
              analysisResult?.startsWith("Erro") ? "destructive" : "default"
            }
            className={
              analysisResult?.startsWith("Erro")
                ? ""
                : "bg-primary/5 border-primary/20"
            }
          >
            <AlertTitle
              className={
                analysisResult?.startsWith("Erro") ? "" : "text-primary"
              }
            >
              {analysisResult?.startsWith("Erro")
                ? "Erro na Análise"
                : "Análise Estatística da IA"}
            </AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">
              {analysisResult}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
