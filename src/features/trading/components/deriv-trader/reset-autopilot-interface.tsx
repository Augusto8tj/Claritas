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
import { Bot, Power, TrendingUp, TrendingDown, HelpCircle, Activity, BarChart3, Shield, Settings, Repeat, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { useResetCallPutStrategy } from "../../hooks/use-reset-call-put-strategy";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface ResetAutopilotInterfaceProps extends ReturnType<typeof useResetCallPutStrategy> {}

export function ResetAutopilotInterface({
    isAutopilotOn,
    toggleAutopilot,
    botStatus,
    trend,
    calculatedBarrier,
    isMartingaleEnabled,
    setIsMartingaleEnabled,
    martingaleMultiplier,
    setMartingaleMultiplier,
    maxConsecutiveLosses,
    setMaxConsecutiveLosses,
    consecutiveLosses,
    isPausedByRisk,
    currentStake,
    resetRiskSession,
}: ResetAutopilotInterfaceProps) {
  
  const statusInfo = {
    'PAUSED': { text: 'Pausado', color: 'bg-gray-500' },
    'MONITORING': { text: 'Monitorando Tendência...', color: 'bg-blue-500' },
    'SIGNAL_FOUND': { text: 'Sinal Encontrado, Executando...', color: 'bg-green-500 animate-pulse' },
    'EXECUTING': { text: 'Executando Ordem...', color: 'bg-yellow-500' },
    'RISK_PAUSE': { text: 'Pausado por Risco', color: 'bg-red-500' }
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

        {isPausedByRisk && (
          <Alert variant="destructive" className="my-4">
              <AlertTriangle className="h-4 w-4"/>
              <AlertTitle>Piloto Pausado!</AlertTitle>
              <AlertDescription>
                  O limite de {maxConsecutiveLosses} perdas consecutivas foi atingido. Reinicie a sessão de risco para continuar.
              </AlertDescription>
          </Alert>
        )}

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
                 <div className="p-2 border rounded-lg bg-muted/50 col-span-2">
                    <p className="text-muted-foreground font-semibold mb-1">Próxima Aposta</p>
                     <p className="font-bold text-sm text-primary">${currentStake.toFixed(2)}</p>
                </div>
                 <div className="p-2 border rounded-lg bg-muted/50 col-span-2">
                    <p className="text-muted-foreground font-semibold mb-1">Perdas Consecutivas</p>
                     <p className="font-bold text-sm text-destructive">{consecutiveLosses} / {maxConsecutiveLosses}</p>
                </div>
            </div>
        )}

        <Collapsible className="mt-4 pt-4 border-t">
            <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground">
                    <Settings className="h-4 w-4" />
                    Gerenciamento de Risco
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6 pt-4">
                 <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                    <Label htmlFor="martingale-switch" className="flex flex-col space-y-1 flex-1 pr-4">
                        <span>Ativar Martingale</span>
                        <span className="font-normal text-xs text-muted-foreground">Aumenta a aposta após perdas para recuperar o valor.</span>
                    </Label>
                    <Switch id="martingale-switch" checked={isMartingaleEnabled} onCheckedChange={setIsMartingaleEnabled} disabled={isAutopilotOn} />
                </div>
                {isMartingaleEnabled && (
                    <div className="space-y-4 pl-2">
                        <div className="space-y-2">
                            <Label>Multiplicador ({martingaleMultiplier.toFixed(2)}x)</Label>
                            <Slider min={1.1} max={3.0} step={0.1} value={[martingaleMultiplier]} onValueChange={v => setMartingaleMultiplier(v[0])} disabled={isAutopilotOn} />
                        </div>
                        <div className="space-y-2">
                            <Label>Máximo de Perdas Seguidas ({maxConsecutiveLosses})</Label>
                            <Slider min={2} max={10} step={1} value={[maxConsecutiveLosses]} onValueChange={v => setMaxConsecutiveLosses(v[0])} disabled={isAutopilotOn} />
                        </div>
                    </div>
                )}
                 <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="outline" className="w-full">
                            <Repeat className="mr-2 h-4 w-4" />
                            Reiniciar Sessão de Risco
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Reiniciar Sessão?</AlertDialogTitle>
                            <AlertDialogDescription>Isto irá zerar o contador de perdas consecutivas e resetar o valor da aposta para o padrão. Use após uma série de perdas para recomeçar.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={resetRiskSession}>Sim, Reiniciar</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
