// src/features/trading/components/deriv-trader/ai-trade-suggestion-digits.tsx
'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, HelpCircle, Eye } from "lucide-react";
import type { useRobotCouncilDigits } from "../../hooks/use-robot-council-digits";

interface AITradeSuggestionDigitsProps extends Partial<ReturnType<typeof useRobotCouncilDigits>> {}

export function AITradeSuggestionDigits({ 
    councilDecision, 
    consensusSum,
    isAutopilotOn,
}: AITradeSuggestionDigitsProps) {

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
            Probabilidade dos Dígitos
        </CardTitle>
        <CardDescription>
          Análise estatística em tempo real do último dígito.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* A ser implementado: Gráfico de barras com as probabilidades de cada dígito */}
         <div className="text-center text-muted-foreground p-4 border rounded-md bg-muted/50">
            A lógica de análise de dígitos será implementada aqui.
        </div>
      </CardContent>
    </Card>
  );
}
