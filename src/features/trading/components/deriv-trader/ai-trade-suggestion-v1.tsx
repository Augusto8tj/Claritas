// src/features/trading/components/deriv-trader/ai-trade-suggestion-v1.tsx
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
import { TrendingUp, TrendingDown, HelpCircle, ShieldCheck, ShieldX, Group, Eye, Sigma, Wallet } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface AITradeSuggestionV1Props {
    councilDecision: 'RISE' | 'FALL' | 'HOLD';
    consensusSum: { rise: number; fall: number };
    consensusThreshold: number;
    supervisionStatus: { status: 'inactive' | 'approved' | 'veto'; message: string; analysis?: string };
    activeCommittee: string | null;
    isAutopilotOn: boolean;
    bayesianProbability?: number; // Propriedade opcional para V2
    kellyStake?: number; // Propriedade opcional para V2
}

const suggestionIcons = {
    RISE: <TrendingUp className="h-6 w-6 text-green-500" />,
    FALL: <TrendingDown className="h-6 w-6 text-red-500" />,
    HOLD: <HelpCircle className="h-6 w-6 text-yellow-500" />,
};

const supervisionIcons = {
    'inactive': <HelpCircle className="h-4 w-4 text-muted-foreground" />,
    'veto': <ShieldX className="h-4 w-4 text-destructive" />,
    'approved': <ShieldCheck className="h-4 w-4 text-green-600" />,
};

export function AITradeSuggestionV1({ 
    councilDecision, 
    consensusSum,
    consensusThreshold,
    supervisionStatus,
    activeCommittee,
    isAutopilotOn,
    bayesianProbability,
    kellyStake
}: AITradeSuggestionV1Props) {

    if (!consensusSum && bayesianProbability === undefined) {
        return (
             <Card>
                <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-2">
                        <Eye className="h-5 w-5 text-primary" />
                        Consenso da Mesa Operacional
                    </CardTitle>
                    <CardDescription>
                      Aguardando inicialização do conselho...
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="text-center text-muted-foreground p-4 border rounded-md bg-muted/50">
                        A calcular...
                    </div>
                </CardContent>
            </Card>
        )
    }

    const isV2 = bayesianProbability !== undefined;

    // LÓGICA CORRIGIDA: As percentagens V1 são relativas ao limiar para mostrar o progresso até a decisão.
    const risePercentage = isV2
      ? (councilDecision === 'RISE' ? bayesianProbability * 100 : 0)
      : consensusThreshold > 0 ? ((consensusSum?.rise || 0) / consensusThreshold) * 100 : 0;
    const fallPercentage = isV2
      ? (councilDecision === 'FALL' ? bayesianProbability * 100 : 0)
      : consensusThreshold > 0 ? ((consensusSum?.fall || 0) / consensusThreshold) * 100 : 0;


    if (!isAutopilotOn) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-2">
                        <Eye className="h-5 w-5 text-primary" />
                        Consenso da Mesa Operacional
                    </CardTitle>
                    <CardDescription>
                        Ative a Mesa Operacional para ver o consenso em tempo real.
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
            Consenso da Mesa {isV2 && "V2.0"}
        </CardTitle>
        <CardDescription>
          Análise em tempo real do conselho de robôs-analistas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className={cn(
            "text-center",
            councilDecision === "RISE" && "border-green-500/50 bg-green-500/10 text-green-700",
            councilDecision === "FALL" && "border-red-500/50 bg-red-500/10 text-red-700",
            councilDecision === "HOLD" && "border-yellow-500/50 bg-yellow-500/10 text-yellow-700",
        )}>
            <AlertTitle className={cn("flex items-center justify-center gap-2 font-bold text-lg",
                 councilDecision === "RISE" && "text-green-800",
                 councilDecision === "FALL" && "text-red-800",
                 councilDecision === "HOLD" && "text-yellow-800",
            )}>
                {suggestionIcons[councilDecision]}
                Decisão do Consenso: {councilDecision}
            </AlertTitle>
        </Alert>

        <div className="space-y-3">
            <div>
                <div className="flex justify-between items-center mb-1 text-xs font-medium">
                    <span className="text-green-600">Confiança RISE: <span className="font-mono">{Math.round(consensusSum?.rise || 0)}</span></span>
                    <span className="text-red-600">Confiança FALL: <span className="font-mono">{Math.round(consensusSum?.fall || 0)}</span></span>
                </div>
                <div className="flex items-center gap-2">
                    <Progress value={risePercentage} className="h-3 rounded-l-full" indicatorClassName="bg-green-500" />
                    <Progress value={fallPercentage} className="h-3 rounded-r-full scale-x-[-1]" indicatorClassName="bg-red-500" />
                </div>
                {!isV2 && (
                    <div className="text-center text-xs text-muted-foreground mt-1">
                        Limiar de Consenso: {consensusThreshold}
                    </div>
                )}
            </div>

            <div className="text-sm border-t pt-3 space-y-2">
                 {isV2 && bayesianProbability !== undefined && (
                     <div className="flex items-center justify-between">
                        <span className="font-semibold flex items-center gap-2"><Sigma className="h-4 w-4"/>Probabilidade Bayesiana:</span>
                        <span className="font-mono font-bold text-primary">{(bayesianProbability * 100).toFixed(1)}%</span>
                    </div>
                 )}
                 {isV2 && kellyStake !== undefined && (
                     <div className="flex items-center justify-between">
                        <span className="font-semibold flex items-center gap-2"><Wallet className="h-4 w-4"/>Stake (Kelly Criterion):</span>
                        <span className="font-mono font-bold text-primary">${kellyStake.toFixed(2)}</span>
                    </div>
                 )}
                <div className="flex items-start gap-2">
                    <div className="mt-1">{supervisionIcons[supervisionStatus.status]}</div>
                    <div className="flex-1">
                        <span className="font-semibold">Direção de Risco:</span>
                        <span className="text-muted-foreground ml-1">{supervisionStatus.message}</span>
                        {supervisionStatus.analysis && (
                            <p className="text-xs text-muted-foreground italic mt-0.5">{supervisionStatus.analysis}</p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Group className="h-4 w-4 text-muted-foreground"/>
                    <span className="font-semibold">Comité Ativo:</span>
                    <span className="text-muted-foreground">{activeCommittee || 'Aguardando...'}</span>
                </div>
            </div>
        </div>
      </CardContent>
    </Card>
  );
}
