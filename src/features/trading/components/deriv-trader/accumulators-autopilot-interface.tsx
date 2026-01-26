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
import { Bot, Zap, Wallet, ShieldCheck, AlertCircle, Clock, CheckCircle, XCircle, BarChartHorizontal, Power } from "lucide-react";
import { cn } from "@/lib/utils";
import type { useAccumulatorsCouncil } from "../../hooks/use-accumulators-council";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";


interface AccumulatorsAutopilotInterfaceProps extends ReturnType<typeof useAccumulatorsCouncil> {}

const ConditionCheck = ({ label, isMet }: { label: string, isMet: boolean }) => (
    <div className={cn(
        "flex items-center justify-between text-xs p-2 rounded-md",
        isMet ? 'bg-green-500/10 text-green-800 dark:text-green-300' : 'bg-red-500/10 text-red-800 dark:text-red-300'
    )}>
        <span className="font-medium">{label}</span>
        {isMet ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
    </div>
);


export function AccumulatorsAutopilotInterface({
  isAutopilotOn,
  toggleAutopilot,
  botStatus,
  dailyBalance,
  setDailyBalance,
  dailyTarget,
  setDailyTarget,
  dailyPnL,
  riskManager,
  survivalProbability,
  entryConditions,
  timeMaster,
  calculatedStake,
  optimizedGrowthRate,
  virtualArenaStats,
}: AccumulatorsAutopilotInterfaceProps) {
  
  const statusInfo = {
    'PAUSED': { text: 'Pausado', color: 'bg-gray-500' },
    'MONITORING': { text: 'A Monitorizar Volatilidade...', color: 'bg-blue-500' },
    'CALM_DETECTED': { text: 'Oportunidade Detectada! A Abrir Posição...', color: 'bg-green-500 animate-pulse' },
    'POSITION_OPEN': { text: 'Posição Aberta. A Gerir Risco...', color: 'bg-yellow-500' },
    'ANALYZING_LOSS': { text: 'Analisando Perda...', color: 'bg-orange-500' },
    'COOLDOWN': { text: 'Cooldown Pós-Perda', color: 'bg-red-500' },
  };

  const survivalProbPercent = survivalProbability * 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Piloto Automático (Acumuladores)
        </CardTitle>
        <CardDescription>
          O sistema avalia a probabilidade de sobrevivência para abrir posições.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/50">
            <div>
                <Label htmlFor="accumulator-autopilot-switch" className="font-semibold text-base flex items-center gap-2">
                  <Power className={cn("h-5 w-5 transition-colors", isAutopilotOn ? "text-green-500" : "text-muted-foreground")} />
                  Status do Piloto
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                    {isAutopilotOn ? "O sistema está operando." : "Ative para começar a negociar."}
                </p>
            </div>
            <Switch
                id="accumulator-autopilot-switch"
                checked={isAutopilotOn}
                onCheckedChange={toggleAutopilot}
                className="data-[state=checked]:bg-green-600"
            />
        </div>

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
                      <p className="text-muted-foreground">Stake (Kelly)</p>
                       <p className="font-bold text-sm text-primary">
                          {calculatedStake.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })}
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
        
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 border rounded-lg">
            <p className="text-xs text-muted-foreground">Prob. Sobrevivência</p>
            <p className="text-2xl font-bold text-primary">{survivalProbPercent.toFixed(1)}%</p>
            <Progress value={survivalProbPercent} className="mt-2" />
          </div>
          
          <div className="p-4 border rounded-lg">
            <p className="text-xs text-muted-foreground">Stake Calculado (Kelly)</p>
            <p className="text-2xl font-bold font-mono">${calculatedStake.toFixed(2)}</p>
          </div>
          
          <div className="p-4 border rounded-lg">
            <p className="text-xs text-muted-foreground">Growth Rate Ótimo</p>
            <p className="text-2xl font-bold">{(optimizedGrowthRate * 100).toFixed(0)}%</p>
          </div>
          
          <div className="p-4 border rounded-lg">
            <p className="text-xs text-muted-foreground">Win Rate Arena</p>
            <p className={cn("text-2xl font-bold", virtualArenaStats.winRate >= 75 ? "text-green-600" : "text-destructive")}>
              {virtualArenaStats.winRate.toFixed(1)}%
            </p>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
            <Label className="font-semibold">Checklist de Entrada</Label>
            <ConditionCheck label="Probabilidade de Sobrevivência" isMet={entryConditions.survivalProb} />
            <ConditionCheck label="Microestrutura Segura" isMet={entryConditions.microstructure} />
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
                             <p className="text-muted-foreground font-semibold mb-1">Kill Switch Ativo</p>
                             <p className="font-bold text-sm text-foreground">{riskManager.adaptiveDuration}s</p>
                        </div>
                    </div>
                     {riskManager.lastLossReason && (
                        <Alert variant="destructive" className="text-xs">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Motivo do Ajuste</AlertTitle>
                            <AlertDescription>
                                {riskManager.lastLossReason}
                            </AlertDescription>
                        </Alert>
                    )}
                </div>
                 <Separator />
                <div className="space-y-3">
                    <h4 className="font-headline flex items-center gap-2">
                        <Clock className="h-5 w-5 text-primary/80" />
                        Mestre do Tempo (IA Sentinela)
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-center text-xs">
                        <div className="p-2 border rounded-lg bg-muted/50">
                            <p className="text-muted-foreground font-semibold mb-1">Regime de Volatilidade</p>
                            <p className="font-bold text-sm text-foreground capitalize">{timeMaster.regime.regime.replace('_', ' ')}</p>
                        </div>
                        <div className="p-2 border rounded-lg bg-muted/50">
                            <p className="text-muted-foreground font-semibold mb-1">Tempo de Saída Seguro</p>
                            <p className="font-bold text-sm text-foreground">{timeMaster.safeExitTime.toFixed(0)}s</p>
                        </div>
                    </div>
                </div>
            </>
        )}

      </CardContent>
    </Card>
  );
}
