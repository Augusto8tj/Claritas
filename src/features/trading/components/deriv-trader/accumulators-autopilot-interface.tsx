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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Bot, Zap, Waves, TrendingUp, Wallet, ShieldCheck, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { useAccumulatorsCouncil } from "../../hooks/use-accumulators-council";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";


interface AccumulatorsAutopilotInterfaceProps extends ReturnType<typeof useAccumulatorsCouncil> {}

export function AccumulatorsAutopilotInterface({
  isAutopilotOn,
  toggleAutopilot,
  botStatus,
  volatilityMetrics,
  dailyBalance,
  setDailyBalance,
  dailyTarget,
  setDailyTarget,
  dailyPnL,
  riskManager,
  calmnessScore,
}: AccumulatorsAutopilotInterfaceProps) {
  
  const statusInfo = {
    'PAUSED': { text: 'Pausado', color: 'bg-gray-500' },
    'MONITORING': { text: 'A Monitorizar Volatilidade...', color: 'bg-blue-500' },
    'CALM_DETECTED': { text: 'Calmaria Detectada! A Abrir Posição...', color: 'bg-green-500 animate-pulse' },
    'POSITION_OPEN': { text: 'Posição Aberta. A Gerir Risco...', color: 'bg-yellow-500' },
    'ANALYZING_LOSS': { text: 'Analisando Perda...', color: 'bg-orange-500' },
    'COOLDOWN': { text: 'Cooldown Pós-Perda', color: 'bg-red-500' },
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
        {isAutopilotOn && (
           <div className="space-y-3 rounded-lg border bg-card p-4">
              <h4 className="font-headline flex items-center gap-2 text-primary"><Wallet className="h-5 w-5"/>Gestão de Risco do Dia</h4>
              <div className="grid grid-cols-3 gap-3 text-center text-xs">
                  <div>
                      <p className="text-muted-foreground">P&L (Piloto)</p>
                      <p className={cn("font-bold text-sm", dailyPnL > 0 && "text-green-600", dailyPnL < 0 && "text-destructive")}>
                          {dailyPnL.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
                      </p>
                  </div>
                   <div>
                      <p className="text-muted-foreground">Meta de Lucro</p>
                      <p className="font-bold text-sm text-green-600">
                          {dailyTarget.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
                      </p>
                  </div>
                   <div>
                      <p className="text-muted-foreground">Limite de Perda</p>
                      <p className="font-bold text-sm text-destructive">
                          {dailyBalance.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
                      </p>
                  </div>
              </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <Label htmlFor="autopilot-daily-balance">Banca do Dia (USD)</Label>
                <Input 
                    id="autopilot-daily-balance"
                    type="number"
                    value={dailyBalance}
                    onChange={(e) => setDailyBalance(parseFloat(e.target.value) || 0)}
                    placeholder="Ex: 10"
                    disabled={isAutopilotOn}
                />
            </div>
            <div className="space-y-2">
                <Label htmlFor="autopilot-daily-target">Alvo de Lucro (USD)</Label>
                <Input 
                    id="autopilot-daily-target"
                    type="number"
                    value={dailyTarget}
                    onChange={(e) => setDailyTarget(parseFloat(e.target.value) || 0)}
                    placeholder="Ex: 5"
                    disabled={isAutopilotOn}
                />
            </div>
        </div>

        <Separator />

         <div className="space-y-2">
            <div className="flex justify-between items-center mb-1">
                <Label htmlFor="calmness-progress" className="font-semibold">
                    Nível de Calmaria do Mercado
                </Label>
                <span className="font-mono text-lg font-bold text-primary">{calmnessScore.toFixed(0)} / 100</span>
            </div>
            <Progress value={calmnessScore} className="h-3" />
            <div className="h-1 relative mt-1">
                <div 
                    className="absolute top-0 h-full w-1 bg-destructive rounded-full" 
                    style={{ left: `${riskManager.calmnessScoreThreshold}%` }}
                >
                    <div className="absolute -top-5 -translate-x-1/2 text-xs text-destructive font-bold">
                        {riskManager.calmnessScoreThreshold}
                    </div>
                </div>
            </div>
            <p className="text-xs text-muted-foreground pt-1 text-center">
                O piloto entrará quando o nível de calmaria (azul) ultrapassar o limiar de entrada (vermelho).
            </p>
        </div>

        <Separator />

        <div className="flex items-center justify-between rounded-lg border p-3">
          <Label htmlFor="autopilot-status" className="font-semibold">
            Status do Piloto:
          </Label>
          <Badge variant="outline" className="flex items-center gap-1.5 text-sm">
            <div className={cn("h-2.5 w-2.5 rounded-full", statusInfo[botStatus].color)}></div>
            {botStatus === 'COOLDOWN' ? <Clock className="h-3 w-3 mr-1" /> : null}
            {statusInfo[botStatus].text}
          </Badge>
        </div>
        
        {isAutopilotOn && (
            <>
                <Separator />
                <div className="space-y-3">
                    <h4 className="font-headline flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-primary/80" />
                        Gerente de Estratégia
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-center text-xs">
                        <div className="p-2 border rounded-lg bg-muted/50">
                            <p className="text-muted-foreground font-semibold mb-1">Modo Atual</p>
                            <Badge variant={riskManager.mode === 'Cautious' ? 'destructive' : 'secondary'}>{riskManager.mode}</Badge>
                        </div>
                        <div className="p-2 border rounded-lg bg-muted/50">
                             <p className="text-muted-foreground font-semibold mb-1">Duração Adaptativa</p>
                             <p className="font-bold text-sm text-foreground">{riskManager.adaptiveDuration}s</p>
                        </div>
                    </div>
                    {riskManager.mode === 'Cautious' && (
                        <Alert variant="destructive" className="text-xs">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Parâmetros Ajustados!</AlertTitle>
                            <AlertDescription>
                                {riskManager.lastLossReason}
                            </AlertDescription>
                        </Alert>
                    )}
                </div>
            </>
        )}

      </CardContent>
    </Card>
  );
}
