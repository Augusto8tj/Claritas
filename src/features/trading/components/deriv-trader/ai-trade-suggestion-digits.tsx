// src/features/trading/components/deriv-trader/ai-trade-suggestion-digits.tsx
'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Eye, TrendingDown, TrendingUp } from "lucide-react";
import type { DigitStats } from "../../hooks/use-robot-council-digits";
import { cn } from "@/lib/utils";

interface AITradeSuggestionDigitsProps {
    digitStats: DigitStats[];
    isAutopilotOn: boolean;
}

export function AITradeSuggestionDigits({ 
    digitStats, 
    isAutopilotOn,
}: AITradeSuggestionDigitsProps) {

    const sortedByProb = [...digitStats].sort((a, b) => b.probability - a.probability);
    const mostProbable = sortedByProb[0];
    const leastProbable = sortedByProb[sortedByProb.length - 1];

    if (!isAutopilotOn) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-2">
                        <Eye className="h-5 w-5 text-primary" />
                        Análise de Dígitos
                    </CardTitle>
                    <CardDescription>
                        Ative a Mesa Operacional para ver as probabilidades em tempo real.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="text-center text-muted-foreground p-4 border rounded-md bg-muted/50">
                        O sistema está a aguardar ativação.
                    </div>
                </CardContent>
            </Card>
        );
    }
    
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            Análise Estatística da IA
        </CardTitle>
        <CardDescription>
          Sugestões com base na frequência dos últimos dígitos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
            <div className={cn(
                "p-4 rounded-lg border text-center",
                "bg-red-500/10 border-red-500/30 text-red-700"
            )}>
                <h4 className="font-bold flex items-center justify-center gap-2">
                    <TrendingDown className="h-5 w-5" />
                    Sugestão: DIFERE
                </h4>
                <p className="text-4xl font-bold mt-1">{mostProbable.digit}</p>
                <p className="text-xs">Probabilidade de {mostProbable.probability.toFixed(1)}%</p>
            </div>
             <div className={cn(
                "p-4 rounded-lg border text-center",
                "bg-green-500/10 border-green-500/30 text-green-700"
            )}>
                <h4 className="font-bold flex items-center justify-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Sugestão: COMBINA
                </h4>
                <p className="text-4xl font-bold mt-1">{leastProbable.digit}</p>
                 <p className="text-xs">Probabilidade de {leastProbable.probability.toFixed(1)}%</p>
            </div>
        </div>
      </CardContent>
    </Card>
  );
}
