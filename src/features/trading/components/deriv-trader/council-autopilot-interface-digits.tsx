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
import { Button } from "@/components/ui/button";
import { Loader2, LayoutGrid, Power, PowerOff, Bot, Clock, ShieldAlert } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { useRobotCouncilDigits } from "@/features/trading/hooks/use-robot-council-digits";
import { cn } from "@/lib/utils";

interface CouncilAutopilotInterfaceDigitsProps extends ReturnType<typeof useRobotCouncilDigits> {}

const formatTime = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};


export const CouncilAutopilotInterfaceDigits: React.FC<CouncilAutopilotInterfaceDigitsProps> = (props) => {
  const { 
    isCouncilAutopilotOn,
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
    consensusThreshold,
    setConsensusThreshold,
    toggleAutopilot,
    autopilotStatus,
    warmupTimeLeft,
    championRobotId,
    recoveryState,
    robotPerformance,
 } = props;

  const champion = robotPerformance.find(r => r.id === championRobotId);

  const getStatusDisplay = () => {
    switch (autopilotStatus) {
        case 'PAUSED':
            return <p className="text-sm text-muted-foreground">Piloto desativado.</p>;
        case 'WARMING_UP':
            return (
                <div className="flex items-center gap-2 text-sm text-blue-600">
                    <Clock className="h-4 w-4" />
                    <span>Aquecendo Arena... <strong>{formatTime(warmupTimeLeft)}</strong> restantes.</span>
                </div>
            );
        case 'TRADING':
            return (
                <p className="text-sm text-green-600 font-semibold">
                    Operando com Campeão: {champion?.strategy.description || '...'}
                </p>
            );
        case 'RECOVERING':
            return (
                <div className="flex items-center gap-2 text-sm text-orange-500 font-semibold">
                    <ShieldAlert className="h-4 w-4" />
                    <span>Modo Recuperação (Nível {recoveryState.martingaleLevel})</span>
                </div>
            );
        default:
            return null;
    }
  };


  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <CardTitle className="font-headline flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                Piloto Automático (Digits)
            </CardTitle>
            <Badge variant={isCouncilAutopilotOn ? "default" : "secondary"}>
                {isCouncilAutopilotOn ? "Ativo" : "Inativo"}
            </Badge>
        </div>
        <CardDescription>
          Controle o piloto que opera com base na frequência estatística e probabilidade dos dígitos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/50">
            <div className="space-y-1">
                <Label htmlFor="council-autopilot-switch" className="font-semibold text-base">
                    Status do Piloto
                </Label>
                <div className="h-5">{getStatusDisplay()}</div>
            </div>
            <Switch
                id="council-autopilot-switch"
                checked={isCouncilAutopilotOn}
                onCheckedChange={toggleAutopilot}
                className="data-[state=checked]:bg-green-600"
            />
        </div>

        {recoveryState.isActive && (
            <div className="p-3 border rounded-lg bg-orange-500/10 text-orange-700 space-y-1">
                <p className="font-bold text-sm">Recuperação de Risco Ativa</p>
                <div className="flex justify-between text-xs">
                    <span>A recuperar:</span>
                    <span className="font-mono font-bold">${recoveryState.stakeToRecover.toFixed(2)}</span>
                </div>
                 <div className="flex justify-between text-xs">
                    <span>Próximo Stake (x{Math.pow(2, recoveryState.martingaleLevel)}):</span>
                    <span className="font-mono font-bold">${(0.35 * Math.pow(2, recoveryState.martingaleLevel)).toFixed(2)}</span>
                </div>
            </div>
        )}

        <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <Label htmlFor="council-daily-balance-digits">Banca do Dia (USD)</Label>
                <Input 
                    id="council-daily-balance-digits"
                    type="number"
                    value={dailyBalance}
                    onChange={(e) => setDailyBalance(Number(e.target.value))}
                    placeholder="Ex: 10"
                    disabled={isCouncilAutopilotOn}
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
                    disabled={isCouncilAutopilotOn}
                />
            </div>
        </div>

        <Separator />
        
        <div className="space-y-2">
            <Label htmlFor="council-consensus-digits">Limiar de Probabilidade (%)</Label>
            <Input 
                id="council-consensus-digits"
                type="number"
                min={10} max={90}
                value={consensusThreshold}
                onChange={(e) => setConsensusThreshold(Number(e.target.value))}
                placeholder="Ex: 25"
                disabled={isCouncilAutopilotOn}
            />
            <p className="text-xs text-muted-foreground">O piloto irá operar 'Difere' se um dígito superar esta probabilidade.</p>
        </div>
      </CardContent>
    </Card>
  );
}
