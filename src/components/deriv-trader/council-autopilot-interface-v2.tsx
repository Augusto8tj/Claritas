// src/components/deriv-trader/council-autopilot-interface-v2.tsx
'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "../ui/button";
import { Loader2, LayoutGrid, Power, PowerOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Separator } from "../ui/separator";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import type { useRobotCouncilV2 } from "@/hooks/use-robot-council-v2";

interface CouncilAutopilotInterfaceV2Props extends ReturnType<typeof useRobotCouncilV2> {}

export function CouncilAutopilotInterfaceV2(props: CouncilAutopilotInterfaceV2Props) {
  const { 
    isCouncilAutopilotOn,
    setIsCouncilAutopilotOn,
    fetchStrategyCouncil,
    dissolveCouncil,
    isFetchingCouncil,
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
    isDynamicConsensusOn,
    setIsDynamicConsensusOn,
    isDynamicRiskOn,
    setIsDynamicRiskOn,
    isMeritocracyOn,
    setIsMeritocracyOn,
    strategyCouncil,
 } = props;
  const { toast } = useToast();

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <CardTitle className="font-headline flex items-center gap-2">
                <LayoutGrid className="h-5 w-5 text-primary" />
                Mesa Operacional V2.0
            </CardTitle>
            <Badge variant={isCouncilAutopilotOn ? "default" : "secondary"}>
                {isCouncilAutopilotOn ? "Ativada" : "Desativada"}
            </Badge>
        </div>
        <CardDescription>
          Controle o sistema de trading adaptativo e consciente de regime.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <Label htmlFor="council-daily-balance">Banca do Dia (USD)</Label>
                <Input 
                    id="council-daily-balance"
                    type="number"
                    value={dailyBalance}
                    onChange={(e) => setDailyBalance(Number(e.target.value))}
                    placeholder="Ex: 100"
                    disabled={isCouncilAutopilotOn}
                />
                <p className="text-xs text-muted-foreground">Sua perda máxima no dia.</p>
            </div>
            <div className="space-y-2">
                <Label htmlFor="council-daily-target">Alvo de Lucro (USD)</Label>
                <Input 
                    id="council-daily-target"
                    type="number"
                    value={dailyTarget}
                    onChange={(e) => setDailyTarget(Number(e.target.value))}
                    placeholder="Ex: 50"
                    disabled={isCouncilAutopilotOn}
                />
                <p className="text-xs text-muted-foreground">Sua meta de lucro no dia.</p>
            </div>
        </div>

        <Separator />
        
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <Label htmlFor="dynamic-consensus-switch" className="flex-1">Consenso Dinâmico</Label>
                <Switch id="dynamic-consensus-switch" checked={isDynamicConsensusOn} onCheckedChange={setIsDynamicConsensusOn} disabled={isCouncilAutopilotOn} />
            </div>
             <div className="flex items-center justify-between">
                <Label htmlFor="dynamic-risk-switch" className="flex-1">Gestão de Risco Dinâmica</Label>
                <Switch id="dynamic-risk-switch" checked={isDynamicRiskOn} onCheckedChange={setIsDynamicRiskOn} disabled={isCouncilAutopilotOn} />
            </div>
            <div className="flex items-center justify-between">
                <Label htmlFor="meritocracy-switch" className="flex-1">Meritocracia (Ponderação)</Label>
                <Switch id="meritocracy-switch" checked={isMeritocracyOn} onCheckedChange={setIsMeritocracyOn} disabled={isCouncilAutopilotOn} />
            </div>
        </div>

        <Separator />

        {isCouncilAutopilotOn ? (
            <Button variant="destructive" className="w-full" onClick={dissolveCouncil} disabled={isFetchingCouncil}>
                <PowerOff className="mr-2 h-4 w-4" />
                Dispensar e Desativar
            </Button>
        ) : (
             <Button className="w-full" onClick={fetchStrategyCouncil} disabled={isFetchingCouncil}>
                {isFetchingCouncil ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4" />}
                {isFetchingCouncil ? 'Convocando...' : 'Convocar e Ativar Mesa V2.0'}
            </Button>
        )}

         <div className="flex justify-between items-center text-xs text-muted-foreground pt-2">
            <span>Analistas em Posição</span>
            <Badge variant="outline">{Array.isArray(strategyCouncil) ? strategyCouncil.length : 0}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
