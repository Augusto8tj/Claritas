// src/features/trading/components/deriv-trader/accumulators-autopilot-interface.tsx
'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Bot, Zap, Waves, Sigma } from "lucide-react";
import { cn } from "@/lib/utils";
import type { useAccumulatorsCouncil } from "../../hooks/use-accumulators-council";

interface AccumulatorsAutopilotInterfaceProps extends ReturnType<typeof useAccumulatorsCouncil> {}

export function AccumulatorsAutopilotInterface({
  isAutopilotOn,
  toggleAutopilot,
  botStatus,
  volatilityMetrics,
}: AccumulatorsAutopilotInterfaceProps) {
  
  const statusInfo = {
    'PAUSED': { text: 'Pausado', color: 'bg-gray-500' },
    'MONITORING': { text: 'A Monitorizar Volatilidade...', color: 'bg-blue-500' },
    'CALM_DETECTED': { text: 'Calmaria Detectada! A Abrir Posição...', color: 'bg-green-500 animate-pulse' },
    'POSITION_OPEN': { text: 'Posição Aberta. A Gerir Risco...', color: 'bg-yellow-500' },
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="font-headline flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Piloto Automático (Acumuladores)
          </CardTitle>
          <Switch
            id="accumulator-autopilot-switch"
            checked={isAutopilotOn}
            onCheckedChange={toggleAutopilot}
          />
        </div>
        <CardDescription>
          O sistema procura períodos de baixa volatilidade para abrir posições automaticamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <Label htmlFor="autopilot-status" className="font-semibold">
            Status do Piloto:
          </Label>
          <Badge variant="outline" className="flex items-center gap-1.5 text-sm">
            <div className={cn("h-2.5 w-2.5 rounded-full", statusInfo[botStatus].color)}></div>
            {statusInfo[botStatus].text}
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-center text-xs">
          <div className="p-2 border rounded-lg bg-muted/50">
            <p className="text-muted-foreground font-semibold mb-1 flex items-center justify-center gap-1.5"><Waves className="h-4 w-4"/>BBW</p>
            <p className="font-bold text-sm text-foreground">{volatilityMetrics.bbw.toFixed(4)}</p>
          </div>
          <div className="p-2 border rounded-lg bg-muted/50">
            <p className="text-muted-foreground font-semibold mb-1 flex items-center justify-center gap-1.5"><Zap className="h-4 w-4"/>ATR Norm.</p>
            <p className="font-bold text-sm text-foreground">{volatilityMetrics.atr.toFixed(5)}</p>
          </div>
          <div className="p-2 border rounded-lg bg-muted/50">
            <p className="text-muted-foreground font-semibold mb-1 flex items-center justify-center gap-1.5"><Sigma className="h-4 w-4"/>Z-Score</p>
            <p className="font-bold text-sm text-foreground">{volatilityMetrics.zScore.toFixed(2)}</p>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
