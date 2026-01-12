// src/features/trading/components/deriv-trader/CouncilDashboardV3.tsx
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
import { TrendingUp, TrendingDown, HelpCircle, ShieldCheck, ShieldX, Group, Eye, Sigma, Wallet, Brain } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { useRobotCouncilV3 } from "../../hooks/use-robot-council-v3";
import type { MarketRegime } from '@/lib/types';


type CouncilDashboardV3Props = {
    councilState: ReturnType<typeof useRobotCouncilV3>;
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

const regimeLabels: Record<MarketRegime, string> = {
  trending_bull: 'Tendência de Alta',
  trending_bear: 'Tendência de Baixa',
  ranging: 'Lateralizado (Ranging)',
  high_volatility: 'Alta Volatilidade',
  breakout: 'Rompimento (Breakout)'
};


export function CouncilDashboardV3({ councilState }: CouncilDashboardV3Props) {

    const {
        consensusDecision,
        supervisionStatus,
        isCouncilAutopilotOn,
        currentRegime,
        microstructure
    } = councilState;

    if (!isCouncilAutopilotOn) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-2">
                        <Eye className="h-5 w-5 text-primary" />
                        Consenso da Mesa V3.0
                    </CardTitle>
                    <CardDescription>
                        Ative a Mesa Operacional V3.0 para ver o consenso em tempo real.
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
    
    const risePercentage = consensusDecision.direction === 'RISE' ? consensusDecision.probability * 100 : 0;
    const fallPercentage = consensusDecision.direction === 'FALL' ? consensusDecision.probability * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            Consenso da Mesa V3.0
        </CardTitle>
        <CardDescription>
          Análise Hierárquica em tempo real do Cérebro Cognitivo.
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
                <div className="flex items-center gap-0.5">
                    <Progress value={risePercentage} className="h-3 rounded-l-full rounded-r-none" indicatorClassName="bg-green-500 rounded-l-full" />
                    <Progress value={fallPercentage} className="h-3 rounded-r-full scale-x-[-1]" indicatorClassName="bg-red-500 rounded-r-full" />
                </div>
            </div>

            <div className="text-sm border-t pt-3 space-y-2">
                <div className="flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-2"><Sigma className="h-4 w-4"/>Prob. Bayesiana:</span>
                    <span className="font-mono font-bold text-primary">{(consensusDecision.probability * 100).toFixed(1)}%</span>
                </div>
                 <div className="flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-2"><Wallet className="h-4 w-4"/>Stake (Kelly):</span>
                    <span className="font-mono font-bold text-primary">${consensusDecision.stake.toFixed(2)}</span>
                </div>
                 <div className="flex items-center gap-2">
                    <span className="font-semibold flex items-center gap-2"><Brain className="h-4 w-4" />Regime:</span>
                    <span className="text-muted-foreground">{regimeLabels[currentRegime.regime] || 'Aguardando...'} ({(currentRegime.confidence * 100).toFixed(0)}%)</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs pl-6">Micro: {microstructure?.pressure} | {microstructure?.tickVelocity.toFixed(1)} ticks/s</span>
                </div>
            </div>
        </div>
      </CardContent>
    </Card>
  );
}
