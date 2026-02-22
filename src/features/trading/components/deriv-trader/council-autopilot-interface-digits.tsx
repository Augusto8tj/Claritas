// src/features/trading/components/deriv-trader/council-autopilot-interface-digits.tsx
'use client';

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Bot, Binary, TrendingUp, HelpCircle, Trophy, Settings, AlertTriangle, ShieldCheck, Power, Clock, Repeat, TestTube } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import type { useRobotCouncilDigits, PilotType, PilotState } from "@/features/trading/hooks/use-robot-council-digits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DigitsBacktestPanel } from "./digits-backtest-panel";


interface DigitsAutopilotManagerProps extends ReturnType<typeof useRobotCouncilDigits> {}

const PilotTabContent: React.FC<{
    pilotKey: PilotType;
    title: string;
    description: string;
    pilotState: PilotState;
    toggleAutopilot: (type: PilotType) => void;
}> = ({ pilotKey, title, description, pilotState, toggleAutopilot }) => {
    const { isOn, status, currentTarget, consecutiveLosses, accumulatedLoss } = pilotState;

    const statusInfo = {
        'PAUSED': { text: 'Pausado', color: 'bg-gray-500' },
        'TRADING': { text: 'Operando', color: 'bg-green-500' },
        'COOLDOWN': { text: 'Cooldown Pós-Perda', color: 'bg-orange-500' },
        'CIRCUIT_BREAKER': { text: 'Pausa de Risco', color: 'bg-red-500' },
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                    <Label htmlFor={`${pilotKey}-switch`} className="font-semibold">{title}</Label>
                    <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                 <Switch
                    id={`${pilotKey}-switch`}
                    checked={isOn}
                    onCheckedChange={() => toggleAutopilot(pilotKey)}
                    className="data-[state=checked]:bg-green-600"
                />
            </div>

            {isOn && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-center text-xs">
                    <div className="p-2 border rounded-lg bg-muted/50">
                        <p className="text-muted-foreground font-semibold mb-1">Status</p>
                        <Badge variant="outline" className="flex items-center justify-center gap-1.5">
                            <div className={cn("h-2 w-2 rounded-full", statusInfo[status]?.color || 'bg-gray-500')}></div>
                            {statusInfo[status]?.text || status}
                        </Badge>
                    </div>
                     <div className="p-2 border rounded-lg bg-muted/50">
                        <p className="text-muted-foreground font-semibold mb-1">
                            Alvo Atual
                        </p>
                        <p className="font-bold text-sm truncate" title={currentTarget || ''}>
                            {currentTarget || 'Aguardando...'}
                        </p>
                    </div>
                     <div className="p-2 border rounded-lg bg-muted/50 col-span-2 md:col-span-1">
                        <p className="text-muted-foreground font-semibold mb-1">Perdas Seguidas</p>
                        <p className="font-bold text-sm text-red-600">
                           {consecutiveLosses} {accumulatedLoss > 0 && `($${accumulatedLoss.toFixed(2)})`}
                        </p>
                    </div>
                </div>
            )}
             {status === 'CIRCUIT_BREAKER' && (
                 <div className="text-xs text-destructive flex items-center gap-2 p-2 rounded-md bg-destructive/10">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{currentTarget}</span>
                 </div>
            )}
        </div>
    );
};


export const DigitsAutopilotManager: React.FC<DigitsAutopilotManagerProps> = (props) => {
  const { 
    pilots,
    toggleAutopilot,
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
    consensusThreshold,
    setConsensusThreshold,
    overUnderThreshold,
    setOverUnderThreshold,
    evenOddThreshold,
    setEvenOddThreshold,
    underdogThreshold,
    setUnderdogThreshold,
    isUnderdogInverse,
    setIsUnderdogInverse,
    overUnderUnderdogThreshold,
    setOverUnderUnderdogThreshold,
    evenOddUnderdogThreshold,
    setEvenOddUnderdogThreshold,
    isMartingaleEnabled,
    setIsMartingaleEnabled,
    isSmartMartingale,
    setIsSmartMartingale,
    martingaleRecoveryFactor,
    setMartingaleRecoveryFactor,
    cooldownTime,
    setCooldownTime,
    maxLosses,
    setMaxLosses,
    executionCooldown,
    setExecutionCooldown,
    resetSession,
    backtestResults,
    isBacktesting,
    runBacktestForAllStrategies,
 } = props;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Pilotos Automáticos (Digits)
        </CardTitle>
        <CardDescription>
          Controle os especialistas que operam com base na frequência estatística de cada tipo de contrato.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        <div className="space-y-2">
            <Tabs defaultValue="standard" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="standard" className="text-xs sm:text-sm"><Bot className="h-4 w-4 mr-1.5"/>Pilotos de Estratégia</TabsTrigger>
                    <TabsTrigger value="risk" className="text-xs sm:text-sm"><Settings className="h-4 w-4 mr-1.5"/>Gestão de Risco</TabsTrigger>
                </TabsList>
                <TabsContent value="standard" className="pt-4 space-y-4">
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold text-muted-foreground">Estratégias Padrão</Label>
                        <Tabs defaultValue="matchesDiffers" className="w-full">
                            <TabsList className="grid w-full grid-cols-3">
                                <TabsTrigger value="matchesDiffers" className="text-xs sm:text-sm"><HelpCircle className="h-4 w-4 mr-1.5"/>Difere</TabsTrigger>
                                <TabsTrigger value="overUnder" className="text-xs sm:text-sm"><TrendingUp className="h-4 w-4 mr-1.5"/>Acima/Abaixo</TabsTrigger>
                                <TabsTrigger value="evenOdd" className="text-xs sm:text-sm"><Binary className="h-4 w-4 mr-1.5"/>Par/Ímpar</TabsTrigger>
                            </TabsList>
                            <TabsContent value="matchesDiffers" className="pt-4">
                                <PilotTabContent
                                    pilotKey="matchesDiffers"
                                    title="Piloto Contra-Tendência"
                                    description="Opera 'Difere' no dígito mais frequente, apostando na regressão à média."
                                    pilotState={pilots.matchesDiffers}
                                    toggleAutopilot={toggleAutopilot}
                                />
                            </TabsContent>
                            <TabsContent value="overUnder" className="pt-4">
                                <PilotTabContent
                                    pilotKey="overUnder"
                                    title="Piloto Acima/Abaixo (Padrão)"
                                    description="Analisa a probabilidade do dígito final ser maior ou menor que uma barreira."
                                    pilotState={pilots.overUnder}
                                    toggleAutopilot={toggleAutopilot}
                                />
                            </TabsContent>
                            <TabsContent value="evenOdd" className="pt-4">
                                <PilotTabContent
                                    pilotKey="evenOdd"
                                    title="Piloto Par/Ímpar"
                                    description="Opera na probabilidade do dígito final ser par ou ímpar."
                                    pilotState={pilots.evenOdd}
                                    toggleAutopilot={toggleAutopilot}
                                />
                            </TabsContent>
                        </Tabs>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-sm font-semibold text-muted-foreground">Estratégias de Azarão (Regressão à Média)</Label>
                        <Tabs defaultValue="underdog" className="w-full">
                            <TabsList className="grid w-full grid-cols-4">
                                <TabsTrigger value="underdog" className="text-xs sm:text-sm"><Trophy className="h-4 w-4 mr-1.5"/>Dígito</TabsTrigger>
                                <TabsTrigger value="underdogOverUnder" className="text-xs sm:text-sm"><Trophy className="h-4 w-4 mr-1.5"/>A/A Fixo</TabsTrigger>
                                <TabsTrigger value="dynamicUnderdogOverUnder" className="text-xs sm:text-sm"><Trophy className="h-4 w-4 mr-1.5"/>A/A Dinâmico</TabsTrigger>
                                <TabsTrigger value="underdogEvenOdd" className="text-xs sm:text-sm"><Trophy className="h-4 w-4 mr-1.5"/>Par/Ímpar</TabsTrigger>
                            </TabsList>
                            <TabsContent value="underdog" className="pt-4">
                                <PilotTabContent
                                    pilotKey="underdog"
                                    title="Piloto Caçador de Azarão"
                                    description="Aposta 'Combina' no dígito menos frequente, explorando a regressão à média."
                                    pilotState={pilots.underdog}
                                    toggleAutopilot={toggleAutopilot}
                                />
                                <div className="space-y-4 pt-4 mt-4 border-t">
                                    <h4 className="text-xs font-semibold text-muted-foreground">Configuração Fina (Azarão)</h4>
                                    <div className="space-y-2">
                                        <Label htmlFor="underdog-threshold">Limiar de Frequência de Disparo ({underdogThreshold.toFixed(1)}%)</Label>
                                        <Slider
                                            id="underdog-threshold"
                                            min={1.0} max={10.0} step={0.5}
                                            value={[underdogThreshold]}
                                            onValueChange={(value) => setUnderdogThreshold(value[0])}
                                        />
                                        <p className="text-xs text-muted-foreground">Operar 'Combina' se a frequência de um dígito cair abaixo deste valor.</p>
                                    </div>
                                    <div className="flex items-center justify-between rounded-lg border p-3">
                                        <Label htmlFor="underdog-inverse-switch" className="flex flex-col space-y-1">
                                            <span>Inverter Lógica</span>
                                            <span className="font-normal text-xs text-muted-foreground">
                                                Apostar 'Difere' no dígito menos frequente (alto risco).
                                            </span>
                                        </Label>
                                        <Switch
                                            id="underdog-inverse-switch"
                                            checked={isUnderdogInverse}
                                            onCheckedChange={setIsUnderdogInverse}
                                        />
                                    </div>
                                </div>
                            </TabsContent>
                            <TabsContent value="underdogOverUnder" className="pt-4">
                                <PilotTabContent
                                    pilotKey="underdogOverUnder"
                                    title="Piloto Azarão Acima/Abaixo (Fixo)"
                                    description="Aposta no bloco (0-4 ou 5-9) que está estatisticamente 'atrasado'."
                                    pilotState={pilots.underdogOverUnder}
                                    toggleAutopilot={toggleAutopilot}
                                />
                                <div className="space-y-4 pt-4 mt-4 border-t">
                                    <h4 className="text-xs font-semibold text-muted-foreground">Configuração Fina (Azarão A/A)</h4>
                                    <div className="space-y-2">
                                        <Label htmlFor="underdog-ou-threshold">Limiar de Frequência de Bloco ({overUnderUnderdogThreshold.toFixed(1)}%)</Label>
                                        <Slider
                                            id="underdog-ou-threshold"
                                            min={30} max={48} step={1}
                                            value={[overUnderUnderdogThreshold]}
                                            onValueChange={(value) => setOverUnderUnderdogThreshold(value[0])}
                                        />
                                        <p className="text-xs text-muted-foreground">Ambos os pilotos A/A Azarão usarão este limiar para operar.</p>
                                    </div>
                                </div>
                            </TabsContent>
                            <TabsContent value="dynamicUnderdogOverUnder" className="pt-4">
                                <PilotTabContent
                                    pilotKey="dynamicUnderdogOverUnder"
                                    title="Piloto Azarão Acima/Abaixo (Dinâmico)"
                                    description="Analisa a composição dos 5 dígitos menos prováveis para apostar no bloco oposto."
                                    pilotState={pilots.dynamicUnderdogOverUnder}
                                    toggleAutopilot={toggleAutopilot}
                                />
                            </TabsContent>
                            <TabsContent value="underdogEvenOdd" className="pt-4">
                                <PilotTabContent
                                    pilotKey="underdogEvenOdd"
                                    title="Piloto Azarão Par/Ímpar"
                                    description="Aposta no bloco (Par ou Ímpar) que está estatisticamente 'atrasado'."
                                    pilotState={pilots.underdogEvenOdd}
                                    toggleAutopilot={toggleAutopilot}
                                />
                                <div className="space-y-4 pt-4 mt-4 border-t">
                                    <h4 className="text-xs font-semibold text-muted-foreground">Configuração Fina (Azarão P/I)</h4>
                                    <div className="space-y-2">
                                        <Label htmlFor="underdog-eo-threshold">Limiar de Frequência de Bloco ({evenOddUnderdogThreshold.toFixed(1)}%)</Label>
                                        <Slider
                                            id="underdog-eo-threshold"
                                            min={30} max={48} step={1}
                                            value={[evenOddUnderdogThreshold]}
                                            onValueChange={(value) => setEvenOddUnderdogThreshold(value[0])}
                                        />
                                        <p className="text-xs text-muted-foreground">Operar em um bloco se a probabilidade dele cair abaixo deste valor.</p>
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                </TabsContent>
                <TabsContent value="risk" className="pt-4 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="council-daily-balance-digits">Banca do Dia (USD)</Label>
                            <Input 
                                id="council-daily-balance-digits"
                                type="number"
                                value={dailyBalance}
                                onChange={(e) => setDailyBalance(Number(e.target.value))}
                                placeholder="Ex: 10"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="council-daily-target-digits">Alvo de Lucro (USD)</Label>
                            <Input 
                                id="council-daily-target-digits"
                                type="number"
                                value={dailyTarget}
                                onChange={(e) => setDailyTarget(Number(e.target.value))}
                                placeholder="Ex: 5"
                            />
                        </div>
                    </div>
                     <Separator />
                    <div className="space-y-2">
                        <Label htmlFor="execution-cooldown-slider">Intervalo Mínimo Entre Ordens ({executionCooldown}s)</Label>
                        <Slider
                            id="execution-cooldown-slider"
                            min={0} max={10} step={1}
                            value={[executionCooldown]}
                            onValueChange={(value) => setExecutionCooldown(value[0])}
                        />
                        <p className="text-xs text-muted-foreground pt-1">Define um cooldown global entre o envio de ordens para evitar disparos muito rápidos e respeitar limites da API.</p>
                    </div>
                     <Separator />
                    <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                        <Label htmlFor="martingale-switch" className="flex flex-col space-y-1">
                            <span>Ativar Martingale</span>
                            <span className="font-normal text-xs text-muted-foreground">Aumenta a aposta após uma perda para acelerar a recuperação.</span>
                        </Label>
                        <Switch id="martingale-switch" checked={isMartingaleEnabled} onCheckedChange={setIsMartingaleEnabled} />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                        <Label htmlFor="smart-martingale-switch" className="flex flex-col space-y-1">
                            <span>Ativar Martingale Inteligente</span>
                            <span className="font-normal text-xs text-muted-foreground">Só aumenta a aposta se o próximo sinal for de alta confiança.</span>
                        </Label>
                        <Switch id="smart-martingale-switch" checked={isSmartMartingale} onCheckedChange={setIsSmartMartingale} disabled={!isMartingaleEnabled} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="martingale-recovery-slider" className={cn(!isMartingaleEnabled && "text-muted-foreground/50")}>Fator de Recuperação ({martingaleRecoveryFactor.toFixed(1)}x)</Label>
                        <Slider
                            id="martingale-recovery-slider" min={1.1} max={2.5} step={0.1}
                            value={[martingaleRecoveryFactor]}
                            onValueChange={(value) => setMartingaleRecoveryFactor(value[0])}
                            disabled={!isMartingaleEnabled}
                        />
                        <p className={cn("text-xs text-muted-foreground", !isMartingaleEnabled && "opacity-50")}>Define a agressividade para recuperar perdas. Cuidado com valores altos.</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="cooldown-slider">Cooldown Pós-Perda ({cooldownTime}s)</Label>
                        <Slider id="cooldown-slider" min={0} max={60} step={1} value={[cooldownTime]} onValueChange={(value) => setCooldownTime(value[0])} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="max-losses-slider">Limite de Perdas Seguidas ({maxLosses})</Label>
                        <Slider id="max-losses-slider" min={3} max={40} step={1} value={[maxLosses]} onValueChange={(value) => setMaxLosses(value[0])} />
                    </div>
                    <Separator />
                    <div className="space-y-2">
                        <Label>Reiniciar Sessão</Label>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" className="w-full">
                                    <Repeat className="mr-2 h-4 w-4" />
                                    Reiniciar P&L e Histórico da Sessão
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Tem a certeza?</AlertDialogTitle>
                                    <AlertDialogDescription>Esta ação irá apagar o histórico de lucros/perdas e o estado de Martingale de todos os pilotos de dígitos para a sessão atual. As ordens na corretora não serão afetadas.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={resetSession}>Sim, Reiniciar</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                        <p className="text-xs text-muted-foreground pt-1">Use isto para resetar o cálculo de P&L diário e o estado do Martingale sem ter que recarregar a página.</p>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
      </CardContent>
    </Card>
  );
}
