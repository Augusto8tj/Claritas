// src/features/trading/components/deriv-trader/reset-autopilot-interface.tsx
'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bot, Power, TrendingUp, TrendingDown, HelpCircle, Activity, BarChart3, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { useResetCallPutStrategy } from "../../hooks/use-reset-call-put-strategy";

interface ResetAutopilotInterfaceProps extends ReturnType<typeof useResetCallPutStrategy> {}

export function ResetAutopilotInterface({
    isAutopilotOn,
    toggleAutopilot,
    botStatus,
    trend,
    calculatedBarrier,
}: ResetAutopilotInterfaceProps) {
  
  const statusInfo = {
    'PAUSED': { text: 'Pausado', color: 'bg-gray-500' },
    'MONITORING': { text: 'Monitorando Tendência...', color: 'bg-blue-500' },
    'SIGNAL_FOUND': { text: 'Sinal Encontrado, Executando...', color: 'bg-green-500 animate-pulse' },
    'EXECUTING': { text: 'Executando Ordem...', color: 'bg-yellow-500' },
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <CardTitle className="font-headline flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                Piloto Automático (Reset)
            </CardTitle>
            <Badge variant={isAutopilotOn ? "default" : "secondary"}>
                {isAutopilotOn ? "Ativo" : "Inativo"}
            </Badge>
        </div>
        <CardDescription>
          Deixe a IA gerenciar suas posições de Reset Call/Put.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/50">
            <div>
                <Label htmlFor="autopilot-switch" className="font-semibold text-base flex items-center gap-2">
                  <Power className={cn("h-5 w-5 transition-colors", isAutopilotOn ? "text-green-500" : "text-muted-foreground")} />
                  Status do Piloto
                </Label>
            </div>
            <Switch
                id="autopilot-switch"
                checked={isAutopilotOn}
                onCheckedChange={toggleAutopilot}
                className="data-[state=checked]:bg-green-600"
            />
        </div>

        {isAutopilotOn && (
           <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-xs">
                <div className="p-2 border rounded-lg bg-muted/50">
                    <p className="text-muted-foreground font-semibold mb-1 flex items-center justify-center gap-1.5"><Activity className="h-4 w-4"/>Status</p>
                    <Badge variant="outline" className="flex items-center gap-1.5">
                        <div className={cn("h-2 w-2 rounded-full", statusInfo[botStatus].color)}></div>
                        {statusInfo[botStatus].text}
                    </Badge>
                </div>
                 <div className="p-2 border rounded-lg bg-muted/50">
                    <p className="text-muted-foreground font-semibold mb-1 flex items-center justify-center gap-1.5"><BarChart3 className="h-4 w-4"/>Tendência</p>
                     <Badge variant="outline" className={cn(
                         trend === 'UP' && "border-green-500 text-green-600",
                         trend === 'DOWN' && "border-red-500 text-red-600"
                     )}>
                        {trend === 'UP' ? <TrendingUp className="h-4 w-4 mr-1.5"/> : trend === 'DOWN' ? <TrendingDown className="h-4 w-4 mr-1.5"/> : <HelpCircle className="h-4 w-4 mr-1.5"/>}
                        {trend}
                    </Badge>
                </div>
                <div className="p-2 border rounded-lg bg-muted/50 col-span-2">
                    <p className="text-muted-foreground font-semibold mb-1 flex items-center justify-center gap-1.5"><Shield className="h-4 w-4"/>Barreira de Reset (ATR)</p>
                     <p className="font-bold text-sm text-foreground">{calculatedBarrier}</p>
                </div>
            </div>
        )}
      </CardContent>
    </Card>
  );
}
