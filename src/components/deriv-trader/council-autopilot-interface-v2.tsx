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
import { Loader2, LayoutGrid, Power, PowerOff, Clock, TrendingUp, TrendingDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Separator } from "../ui/separator";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import type { useRobotCouncilV2 } from "@/hooks/use-robot-council-v2";
import { Slider } from "../ui/slider";

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
    consensusSensitivity,
    setConsensusSensitivity,
    confidenceFactor,
    setConfidenceFactor,
    durationRange,
    setDurationRange,
    takeProfitThreshold,
    setTakeProfitThreshold,
    stopLossThreshold,
    setStopLossThreshold,
    effectiveThreshold, // NOVO: valor efetivo
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

        <div className="space-y-6 rounded-lg border bg-card p-4">
            <div className="space-y-2">
                <div className="flex justify-between items-center mb-1">
                    <Label htmlFor="duration-range-slider" className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Horizonte Temporal
                    </Label>
                    <span className="text-sm font-mono">{durationRange[0]}s - {durationRange[1]}s</span>
                </div>
                <Slider
                    id="duration-range-slider"
                    min={1}
                    max={600}
                    step={5}
                    value={durationRange}
                    onValueChange={(value: [number, number]) => setDurationRange(value)}
                    disabled={isCouncilAutopilotOn}
                />
                <p className="text-xs text-muted-foreground pt-1">Filtra os robôs cujo tempo ótimo de operação está dentro deste intervalo.</p>
            </div>
            
            <div className="space-y-2">
                <div className="flex justify-between items-center mb-1">
                    <Label htmlFor="take-profit-slider" className="flex items-center gap-2 text-green-600">
                        <TrendingUp className="h-4 w-4" />
                        Take Profit
                    </Label>
                    <span className="text-sm font-mono text-green-600">{takeProfitThreshold}%</span>
                </div>
                <Slider
                    id="take-profit-slider"
                    min={5}
                    max={100}
                    step={5}
                    value={[takeProfitThreshold]}
                    onValueChange={(value) => setTakeProfitThreshold(value[0])}
                    disabled={!isCouncilAutopilotOn}
                    className="[&>span]:bg-green-500 [&>div>span]:border-green-600"
                />
                <p className="text-xs text-muted-foreground pt-1">Percentual do lucro máximo para realizar o ganho.</p>
            </div>

            <div className="space-y-2">
                <div className="flex justify-between items-center mb-1">
                    <Label htmlFor="stop-loss-slider" className="flex items-center gap-2 text-red-600">
                        <TrendingDown className="h-4 w-4" />
                        Stop Loss
                    </Label>
                    <span className="text-sm font-mono text-red-600">{stopLossThreshold}%</span>
                </div>
                <Slider
                    id="stop-loss-slider"
                    min={5}
                    max={100}
                    step={5}
                    value={[stopLossThreshold]}
                    onValueChange={(value) => setStopLossThreshold(value[0])}
                    disabled={!isCouncilAutopilotOn}
                    className="[&>span]:bg-red-500 [&>div>span]:border-red-600"
                />
                <p className="text-xs text-muted-foreground pt-1">Percentual de perda máxima para fechar a operação.</p>
            </div>
        </div>

        <Separator />
        
        <div className="space-y-4">
             <div className="flex items-center justify-between">
                <Label htmlFor="dynamic-consensus-switch" className="flex-1">Consenso Dinâmico</Label>
                <Switch id="dynamic-consensus-switch" checked={isDynamicConsensusOn} onCheckedChange={setIsDynamicConsensusOn} disabled={isCouncilAutopilotOn} />
            </div>

            {isDynamicConsensusOn && (
                <div className="space-y-6 rounded-lg border bg-muted/50 p-4">
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <Label htmlFor="consensus-sensitivity">Sensibilidade do Consenso</Label>
                            <div className="flex items-center gap-2 text-sm">
                                <span>Definido:</span>
                                <span className="font-mono text-primary font-semibold">{consensusSensitivity}</span>
                            </div>
                        </div>
                        <Slider
                            id="consensus-sensitivity"
                            min={10}
                            max={100}
                            step={5}
                            value={[consensusSensitivity]}
                            onValueChange={(value) => setConsensusSensitivity(value[0])}
                            disabled={isCouncilAutopilotOn}
                        />
                         <div className="flex justify-between items-center text-xs text-muted-foreground mt-2">
                             <span>Limiar Efetivo (Calculado):</span>
                             <span className="font-mono font-bold text-foreground">{effectiveThreshold.toFixed(0)}</span>
                         </div>
                    </div>
                     <div>
                        <div className="flex justify-between items-center mb-1">
                            <Label htmlFor="confidence-factor">Fator de Confiança</Label>
                            <span className="text-sm font-mono text-primary font-semibold">{confidenceFactor.toFixed(1)}</span>
                        </div>
                        <Slider
                            id="confidence-factor"
                            min={0.5}
                            max={2.0}
                            step={0.1}
                            value={[confidenceFactor]}
                            onValueChange={(value) => setConfidenceFactor(value[0])}
                            disabled={isCouncilAutopilotOn}
                        />
                         <p className="text-xs text-muted-foreground mt-2">Ajusta o peso da confiança dos robôs no consenso final.</p>
                    </div>
                </div>
            )}

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
