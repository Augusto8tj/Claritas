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
import { Bot, Binary, TrendingUp, HelpCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import type { useRobotCouncilDigits, PilotType } from "@/features/trading/hooks/use-robot-council-digits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DigitsAutopilotManagerProps extends ReturnType<typeof useRobotCouncilDigits> {}

const PilotTabContent: React.FC<{
    pilotKey: PilotType;
    title: string;
    description: string;
    pilotState: ReturnType<typeof useRobotCouncilDigits>['pilots'][PilotType];
    toggleAutopilot: (type: PilotType) => void;
}> = ({ pilotKey, title, description, pilotState, toggleAutopilot }) => {
    const { isOn, status, championId } = pilotState;

    const statusInfo = {
        'PAUSED': { text: 'Pausado', color: 'bg-gray-500' },
        'WARMING_UP': { text: 'Aquecendo Arena...', color: 'bg-blue-500 animate-pulse' },
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
                <div className="grid grid-cols-2 gap-3 text-center text-xs">
                    <div className="p-2 border rounded-lg bg-muted/50">
                        <p className="text-muted-foreground font-semibold mb-1">Status</p>
                        <Badge variant="outline" className="flex items-center justify-center gap-1.5">
                            <div className={cn("h-2 w-2 rounded-full", statusInfo[status].color)}></div>
                            {statusInfo[status].text}
                        </Badge>
                    </div>
                     <div className="p-2 border rounded-lg bg-muted/50">
                        <p className="text-muted-foreground font-semibold mb-1">Campeão</p>
                        <p className="font-bold text-sm truncate" title={championId || ''}>{championId || 'Aguardando...'}</p>
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
            <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="matchesDiffers" className="text-xs sm:text-sm"><HelpCircle className="h-4 w-4 mr-1.5"/>Combina/Difere</TabsTrigger>
                <TabsTrigger value="overUnder" className="text-xs sm:text-sm"><TrendingUp className="h-4 w-4 mr-1.5"/>Acima/Abaixo</TabsTrigger>
                <TabsTrigger value="evenOdd" className="text-xs sm:text-sm"><Binary className="h-4 w-4 mr-1.5"/>Par/Ímpar</TabsTrigger>
            </TabsList>
            <TabsContent value="matchesDiffers" className="pt-4">
                <PilotTabContent
                    pilotKey="matchesDiffers"
                    title="Piloto Combina/Difere"
                    description="Opera 'Difere' no dígito mais provável ou 'Combina' no menos provável."
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
