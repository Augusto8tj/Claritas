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
import { Bot, Binary, TrendingUp, HelpCircle, Trophy } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import type { useRobotCouncilDigits, PilotType } from "@/features/trading/hooks/use-robot-council-digits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";

interface DigitsAutopilotManagerProps extends ReturnType<typeof useRobotCouncilDigits> {}

const PilotTabContent: React.FC<{
    pilotKey: PilotType;
    title: string;
    description: string;
    pilotState: ReturnType<typeof useRobotCouncilDigits>['pilots'][PilotType];
    toggleAutopilot: (type: PilotType) => void;
}> = ({ pilotKey, title, description, pilotState, toggleAutopilot }) => {
    const { isOn, status, currentTarget, consecutiveLosses } = pilotState;

    const statusInfo = {
        'PAUSED': { text: 'Pausado', color: 'bg-gray-500' },
        'TRADING': { text: 'Operando', color: 'bg-green-500' },
        'COOLDOWN': { text: 'Cooldown Pós-Perda', color: 'bg-orange-500' },
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
                            {consecutiveLosses} / 5
                        </p>
                    </div>
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
    underdogThreshold,
    setUnderdogThreshold,
    isUnderdogInverse,
    setIsUnderdogInverse,
 } = props;

  const isAnyPilotOn = Object.values(pilots).some(p => p.isOn);

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
      <CardContent className="space-y-4">
        <Tabs defaultValue="matchesDiffers" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="matchesDiffers" className="text-xs sm:text-sm"><HelpCircle className="h-4 w-4 mr-1.5"/>Difere</TabsTrigger>
                <TabsTrigger value="overUnder" className="text-xs sm:text-sm"><TrendingUp className="h-4 w-4 mr-1.5"/>Acima/Abaixo</TabsTrigger>
                <TabsTrigger value="evenOdd" className="text-xs sm:text-sm"><Binary className="h-4 w-4 mr-1.5"/>Par/Ímpar</TabsTrigger>
                <TabsTrigger value="underdog" className="text-xs sm:text-sm"><Trophy className="h-4 w-4 mr-1.5"/>Azarão</TabsTrigger>
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
                    title="Piloto Acima/Abaixo"
                    description="Analisa a probabilidade de o dígito final ser maior ou menor que uma barreira."
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
            <TabsContent value="underdog" className="pt-4">
                <PilotTabContent
                    pilotKey="underdog"
                    title="Piloto Caçador de Azarão"
                    description="Aposta 'Combina' no dígito menos frequente, explorando a regressão à média."
                    pilotState={pilots.underdog}
                    toggleAutopilot={toggleAutopilot}
                />
                 {pilots.underdog.isOn && (
                    <div className="space-y-4 pt-4 mt-4 border-t">
                        <h4 className="text-xs font-semibold text-muted-foreground">Configuração Fina (Azarão)</h4>
                        <div className="space-y-2">
                            <Label htmlFor="underdog-threshold">Limiar de Frequência de Disparo ({underdogThreshold.toFixed(1)}%)</Label>
                            <Slider
                                id="underdog-threshold"
                                min={1.0} max={10.0} step={0.5}
                                value={[underdogThreshold]}
                                onValueChange={(value) => setUnderdogThreshold(value[0])}
                                disabled={!pilots.underdog.isOn}
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
                                disabled={!pilots.underdog.isOn}
                            />
                        </div>
                    </div>
                )}
            </TabsContent>
        </Tabs>
        
        <Separator />

        <div className="space-y-4">
            <h4 className="font-semibold text-sm">Configurações Gerais dos Pilotos</h4>
             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="council-daily-balance-digits">Banca do Dia (USD)</Label>
                    <Input 
                        id="council-daily-balance-digits"
                        type="number"
                        value={dailyBalance}
                        onChange={(e) => setDailyBalance(Number(e.target.value))}
                        placeholder="Ex: 10"
                        disabled={isAnyPilotOn}
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
                        disabled={isAnyPilotOn}
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor="council-consensus-digits">Limiar de Probabilidade (%)</Label>
                <Input 
                    id="council-consensus-digits"
                    type="number"
                    min={10} max={90}
                    value={consensusThreshold}
                    onChange={(e) => setConsensusThreshold(Number(e.target.value))}
                    placeholder="Ex: 25"
                    disabled={isAnyPilotOn}
                />
                <p className="text-xs text-muted-foreground">O piloto irá operar se a probabilidade do sinal superar este valor.</p>
            </div>
        </div>
      </CardContent>
    </Card>
  );
}
