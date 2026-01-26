// src/features/trading/components/master-autopilot/master-autopilot-interface.tsx
'use client';

import React from 'react';
import { useMasterAutopilot } from '../../hooks/use-master-autopilot';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Crosshair, Target, Bot, Power, BarChart, TrendingUp, TrendingDown, ShieldQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

export function MasterAutopilotInterface() {
  const {
    isAutopilotOn,
    toggleAutopilot,
    contractType,
    setContractType,
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
    masterState,
    riskManager,
    macroTrend,
  } = useMasterAutopilot();

  const getProgressColor = (percentage: number) => {
    if (percentage > 80) return 'bg-green-500';
    if (percentage > 60) return 'bg-blue-500';
    if (percentage < 40) return 'bg-red-500';
    return 'bg-gray-400';
  };
  
  const trigger = masterState.trigger;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Coluna de Controle */}
      <div className="lg:col-span-1 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary"/>
                Controlo do Piloto Mestre
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
             <div className="flex items-center justify-between rounded-lg border p-4">
                <Label htmlFor="master-autopilot-switch" className="font-semibold text-base flex items-center gap-2">
                  <Power className={cn("h-5 w-5 transition-colors", isAutopilotOn ? "text-green-500" : "text-muted-foreground")} />
                  Status do Piloto
                </Label>
                <Switch
                    id="master-autopilot-switch"
                    checked={isAutopilotOn}
                    onCheckedChange={toggleAutopilot}
                />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contract-type">Tipo de Contrato</Label>
              <Select value={contractType} onValueChange={setContractType} disabled={isAutopilotOn}>
                <SelectTrigger id="contract-type">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Accumulators">Accumulators (Foco em Estabilidade)</SelectItem>
                  <SelectItem value="Multipliers">Multipliers (Foco em Tendência)</SelectItem>
                  <SelectItem value="Rise/Fall">Rise/Fall (Opções Digitais)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
        <Card>
            <CardHeader>
                <CardTitle className="font-headline">Gestão de Risco Diário</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="daily-balance">Banca do Dia (USD)</Label>
                    <Input id="daily-balance" type="number" value={dailyBalance} onChange={e => setDailyBalance(Number(e.target.value))} disabled={isAutopilotOn}/>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="daily-target">Alvo de Lucro (USD)</Label>
                    <Input id="daily-target" type="number" value={dailyTarget} onChange={e => setDailyTarget(Number(e.target.value))} disabled={isAutopilotOn}/>
                </div>
            </CardContent>
        </Card>
        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                    <ShieldQuestion className="h-5 w-5 text-primary"/>
                    Gestor de Risco Adaptativo
                </CardTitle>
            </CardHeader>
             <CardContent className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Modo Atual:</span>
                    <Badge variant={riskManager.mode === 'Cautious' ? 'destructive' : 'secondary'}>{riskManager.mode}</Badge>
                </div>
                <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Limiar de Assertividade:</span>
                    <span className="font-bold text-primary">{riskManager.assertivenessThreshold}%</span>
                </div>
                <Alert variant="outline" className="text-xs">
                    <AlertTitle className="font-semibold">Último Ajuste</AlertTitle>
                    <AlertDescription>
                        {riskManager.lastAdjustmentReason}
                    </AlertDescription>
                </Alert>
            </CardContent>
        </Card>
      </div>

      {/* Coluna de Status e Análise */}
      <div className="lg:col-span-2 space-y-6">
        <Card>
            <CardHeader>
                 <CardTitle className="font-headline flex items-center gap-2">
                    <Crosshair className="h-5 w-5 text-primary"/>
                    Gatilho de Execução Preditiva
                </CardTitle>
                <CardDescription>
                    O sistema aguarda uma alta convicção preditiva para agir.
                </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {isAutopilotOn ? (
                    <Alert className={cn(
                        "col-span-1 md:col-span-2",
                        trigger.signal === 'HOLD' && 'bg-amber-500/10 border-amber-500/30 text-amber-800',
                        trigger.signal === 'RISE' && 'bg-green-500/10 border-green-500/30 text-green-800 animate-pulse',
                        trigger.signal === 'FALL' && 'bg-red-500/10 border-red-500/30 text-red-800 animate-pulse'
                    )}>
                        <Target className="h-4 w-4" />
                        <AlertTitle className="font-bold flex items-center gap-2">
                            {trigger.signal === 'HOLD' ? 'Aguardando Gatilho' : `GATILHO DETETADO: ${trigger.signal}`}
                        </AlertTitle>
                        <AlertDescription className="text-xs">
                           {trigger.reason}
                        </AlertDescription>
                    </Alert>
                ) : (
                    <Alert className="col-span-1 md:col-span-2">
                        <Bot className="h-4 w-4" />
                        <AlertTitle>Piloto Desativado</AlertTitle>
                        <AlertDescription>
                            Ative o piloto para iniciar a monitorização de gatilhos.
                        </AlertDescription>
                    </Alert>
                )}
                 <div className="p-4 border rounded-lg bg-muted/30">
                    <h4 className="text-sm font-medium mb-2">Análise de Tendência Macro (EMA 100)</h4>
                    <div className={cn(
                        "p-3 rounded-md text-center font-bold text-lg flex items-center justify-center gap-2",
                        macroTrend === 'UP' && 'bg-green-500/20 text-green-700',
                        macroTrend === 'DOWN' && 'bg-red-500/20 text-red-700',
                        macroTrend === 'NONE' && 'bg-gray-500/20 text-gray-700'
                    )}>
                         {macroTrend === 'UP' ? <TrendingUp className="h-5 w-5"/> : macroTrend === 'DOWN' ? <TrendingDown className="h-5 w-5"/> : <BarChart className="h-5 w-5"/>}
                         <span>Modo {macroTrend === 'UP' ? 'Compra' : macroTrend === 'DOWN' ? 'Venda' : 'Indefinido'}</span>
                    </div>
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                    <BarChart className="h-5 w-5 text-primary"/>
                    Painel de Assertividade
                </CardTitle>
                <CardDescription>
                    Desempenho direcional de cada especialista preditivo.
                </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {masterState.assertiveness && Object.keys(masterState.assertiveness).length > 0 ? (
                  Object.entries(masterState.assertiveness).map(([horizon, data]) => (
                      <div key={horizon} className="p-3 border rounded-lg bg-muted/50">
                          <div className="flex justify-between items-center text-xs text-muted-foreground">
                              <span className="font-semibold">{horizon}</span>
                              <div className={cn(
                                  'font-bold flex items-center gap-1',
                                  data.vote === 'RISE' && 'text-green-600',
                                  data.vote === 'FALL' && 'text-red-600',
                              )}>
                                  {data.vote === 'RISE' ? <TrendingUp className="h-3 w-3"/> : <TrendingDown className="h-3 w-3"/>}
                                  {data.vote}
                              </div>
                          </div>
                          <Progress value={data.accuracy} className="h-1.5 my-2" indicatorClassName={getProgressColor(data.accuracy)}/>
                          <div className="text-right text-sm font-bold">{data.accuracy.toFixed(1)}%</div>
                      </div>
                  ))
                ) : (
                  <div className="col-span-full text-center text-muted-foreground p-4">
                    Aguardando dados de assertividade...
                  </div>
                )}
            </CardContent>
        </Card>
      </div>
    </div>
  );
}
