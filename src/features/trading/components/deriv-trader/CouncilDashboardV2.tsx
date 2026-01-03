// src/features/trading/components/deriv-trader/CouncilDashboardV2.tsx
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
import type { useRobotCouncilV2 } from "../../hooks/use-robot-council-v2";

type CouncilDashboardV2Props = {
    consensusDecision: ReturnType<typeof useRobotCouncilV2>['consensusDecision'];
    supervisionStatus: { status: 'inactive' | 'approved' | 'veto'; message: string };
    activeCommittee: string | null;
    isCouncilAutopilotOn: boolean;
};

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

export function CouncilDashboardV2({ 
    consensusDecision,
    supervisionStatus,
    activeCommittee,
    isCouncilAutopilotOn
}: CouncilDashboardV2Props) {

    if (!isCouncilAutopilotOn) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-2">
                        <Eye className="h-5 w-5 text-primary" />
                        Consenso da Mesa V2.0
                    </CardTitle>
                    <CardDescription>
                        Ative a Mesa Operacional V2.0 para ver o consenso em tempo real.
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
            Consenso da Mesa V2.0
        </CardTitle>
        <CardDescription>
          Análise em tempo real do Cérebro Quantitativo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className={cn(
            "text-center",
            consensusDecision.direction === "RISE" && "border-green-500/50 bg-green-500/10 text-green-700",
            consensusDecision.direction === "FALL" && "border-red-500/50 bg-red-500/10 text-red-700",
            consensusDecision.direction === "HOLD" && "border-yellow-500/50 bg-yellow-500/10 text-yellow-700",
        )}>
            <AlertTitle className={cn("flex items-center justify-center gap-2 font-bold text-lg",
                 consensusDecision.direction === "RISE" && "text-green-800",
                 consensusDecision.direction === "FALL" && "text-red-800",
                 consensusDecision.direction === "HOLD" && "text-yellow-800",
            )}>
                {suggestionIcons[consensusDecision.direction]}
                Decisão do Consenso: {consensusDecision.direction}
            </AlertTitle>
        </Alert>

        <div className="space-y-3">
            <div>
                <div className="flex justify-between items-center mb-1 text-xs font-medium">
                    <span className="text-green-600">Confiança RISE</span>
                    <span className="text-red-600">Confiança FALL</span>
                </div>
                <div className="flex items-center gap-2">
                    <Progress value={consensusDecision.direction === 'RISE' ? consensusDecision.probability * 100 : 0} className="h-3 rounded-l-full" indicatorClassName="bg-green-500 rounded-l-full" />
                    <Progress value={consensusDecision.direction === 'FALL' ? consensusDecision.probability * 100 : 0} className="h-3 rounded-r-full scale-x-[-1]" indicatorClassName="bg-red-500 rounded-r-full" />
                </div>
            </div>

            <div className="text-sm border-t pt-3 space-y-2">
                <div className="flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-2"><Sigma className="h-4 w-4"/>Probabilidade Bayesiana:</span>
                    <span className="font-mono font-bold text-primary">{(consensusDecision.probability * 100).toFixed(1)}%</span>
                </div>
                 <div className="flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-2"><Wallet className="h-4 w-4"/>Stake (Kelly Criterion):</span>
                    <span className="font-mono font-bold text-primary">${consensusDecision.stake.toFixed(2)}</span>
                </div>
                 <div className="flex items-center gap-2">
                    {supervisionIcons[supervisionStatus.status]}
                    <span className="font-semibold">Direção de Risco:</span>
                    <span className="text-muted-foreground">{supervisionStatus.message}</span>
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
