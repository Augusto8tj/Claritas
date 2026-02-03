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
import { Loader2, LayoutGrid, Power, PowerOff } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { useRobotCouncilDigits } from "@/features/trading/hooks/use-robot-council-digits";

interface CouncilAutopilotInterfaceDigitsProps extends ReturnType<typeof useRobotCouncilDigits> {}

export const CouncilAutopilotInterfaceDigits: React.FC<CouncilAutopilotInterfaceDigitsProps> = (props) => {
  const { 
    isCouncilAutopilotOn,
    isFetchingCouncil,
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
    consensusThreshold,
    setConsensusThreshold,
    fetchStrategyCouncil,
    dissolveCouncil,
 } = props;

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <CardTitle className="font-headline flex items-center gap-2">
                <LayoutGrid className="h-5 w-5 text-primary" />
                Mesa Operacional (Digits)
            </CardTitle>
            <Badge variant={isCouncilAutopilotOn ? "default" : "secondary"}>
                {isCouncilAutopilotOn ? "Ativada" : "Desativada"}
            </Badge>
        </div>
        <CardDescription>
          Controle a análise estatística e execução automática para contratos de dígitos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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

        <Separator />

        {isCouncilAutopilotOn ? (
            <Button variant="destructive" className="w-full" onClick={dissolveCouncil} disabled={isFetchingCouncil}>
                <PowerOff className="mr-2 h-4 w-4" />
                Desativar Piloto
            </Button>
        ) : (
             <Button className="w-full" onClick={fetchStrategyCouncil} disabled={isFetchingCouncil}>
                {isFetchingCouncil ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4" />}
                {isFetchingCouncil ? 'Analisando...' : 'Ativar Piloto (Digits)'}
            </Button>
        )}
      </CardContent>
    </Card>
  );
}
