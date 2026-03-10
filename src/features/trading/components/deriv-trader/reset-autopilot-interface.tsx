// src/features/trading/components/deriv-trader/reset-autopilot-interface.tsx
'use client';

import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Power, TrendingUp, TrendingDown, HelpCircle, Activity,
  BarChart3, Shield, Settings, Repeat, AlertTriangle, SlidersHorizontal,
  ChevronsUpDown, Zap, Target, Clock
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { useResetCallPutStrategy, SignalStrength, ResetMode } from "../../hooks/use-reset-call-put-strategy";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface ResetAutopilotInterfaceProps extends ReturnType<typeof useResetCallPutStrategy> {}

export function ResetAutopilotInterface({
    isAutopilotOn, toggleAutopilot, botStatus, trend, calculatedBarrier,
    isMartingaleEnabled, setIsMartingaleEnabled,
    martingaleMultiplier, setMartingaleMultiplier,
    maxConsecutiveLosses, setMaxConsecutiveLosses,
    consecutiveLosses, isPausedByRisk, currentStake, resetRiskSession,
    adxThreshold, setAdxThreshold, atrMultiplier, setAtrMultiplier,
    // Novos props
    signalStrength,
    confirmationCount,
    currentRsi,
    currentAdx,
    useAdaptiveDuration, setUseAdaptiveDuration,
    resetMode, setResetMode,
    minConfirmations, setMinConfirmations,
}: ResetAutopilotInterfaceProps) {

  const statusInfo = {
    'PAUSED':        { text: 'Pausado',               color: 'bg-gray-400' },
    'MONITORING':    { text: 'Monitorando...',         color: 'bg-blue-500 animate-pulse' },
    'SIGNAL_FOUND':  { text: 'Sinal! Executando...',  color: 'bg-green-500 animate-pulse' },
    'EXECUTING':     { text: 'Executando Ordem...',   color: 'bg-yellow-500' },
    'RISK_PAUSE':    { text: 'Pausado por Risco',     color: 'bg-red-500' },
  };

  const strengthConfig = {
    'STRONG': { label: '🔥 FORTE',   variant: 'default'     as const, color: 'text-green-600' },
    'MEDIUM': { label: '⚡ MÉDIO',   variant: 'secondary'   as const, color: 'text-yellow-600' },
    'WEAK':   { label: '💤 FRACO',   variant: 'outline'     as const, color: 'text-gray-500' },
    'NONE':   { label: '⏳ Aguard.', variant: 'outline'     as const, color: 'text-gray-400' },
  };

  const rsiColor =
    currentRsi === null ? 'text-muted-foreground' :
    currentRsi > 70 ? 'text-red-500 font-bold' :
    currentRsi < 30 ? 'text-green-500 font-bold' :
    currentRsi > 60 ? 'text-orange-400' :
    currentRsi < 40 ? 'text-blue-400' :
    'text-foreground';

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="font-headline flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Piloto Automático (Reset)
          </CardTitle>
          <Badge variant={isAutopilotOn ? "default" : "secondary"}>
            {isAutopilotOn ? "Ativo" : "Inativo"}
          </Badge>
        </div>
        <CardDescription>
          Gerencie posições de Reset Call/Put com análise multi-indicador.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">

        {/* --- SWITCH PRINCIPAL --- */}
        <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/50">
          <Label htmlFor="autopilot-switch" className="font-semibold text-base flex items-center gap-2">
            <Power className={cn("h-5 w-5 transition-colors", isAutopilotOn ? "text-green-500" : "text-muted-foreground")} />
            Status do Piloto
          </Label>
          <Switch
            id="autopilot-switch"
            checked={isAutopilotOn}
            onCheckedChange={toggleAutopilot}
            className="data-[state=checked]:bg-green-600"
          />
        </div>

        {/* --- ALERTA DE RISCO --- */}
        {isPausedByRisk && (
          <Alert variant="destructive" className="my-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Piloto Pausado!</AlertTitle>
            <AlertDescription>
              Limite de {maxConsecutiveLosses} perdas consecutivas atingido. Reinicie a sessão para continuar.
            </AlertDescription>
          </Alert>
        )}

        {/* --- MODO DE ESTRATÉGIA --- */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-sm font-semibold">
            <Target className="h-4 w-4" /> Modo de Estratégia
          </Label>
          <ToggleGroup
            type="single"
            value={resetMode}
            onValueChange={(v: any) => v && setResetMode(v)}
            className="w-full"
          >
            <ToggleGroupItem value="CLASSIC" className="flex-1 text-xs">
              📊 Clássico (Zona RSI)
            </ToggleGroupItem>
            <ToggleGroupItem value="HARVESTING" className="flex-1 text-xs">
              🌾 Harvesting (Reset)
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground pt-1">
            {resetMode === 'CLASSIC'
              ? 'Opera em zonas de sobrevenda/sobrecompra na direção da tendência.'
              : 'Aproveita o mecanismo de reset entrando em padrões de reversão.'}
          </p>
        </div>

        {/* --- PAINEL DE STATUS (quando ativo) --- */}
        {isAutopilotOn && (
          <div className="space-y-3">
            <Separator />
            {/* Linha 1: Status + Tendência */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 border rounded-lg bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground font-semibold mb-1.5 flex items-center justify-center gap-1">
                  <Activity className="h-3 w-3" /> Status
                </p>
                <Badge variant="outline" className="text-xs flex items-center justify-center gap-1.5">
                  <div className={cn("h-2 w-2 rounded-full shrink-0", statusInfo[botStatus].color)} />
                  {statusInfo[botStatus].text}
                </Badge>
              </div>

              <div className="p-3 border rounded-lg bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground font-semibold mb-1.5 flex items-center justify-center gap-1">
                  <BarChart3 className="h-3 w-3" /> Tendência
                </p>
                <Badge variant="outline" className={cn(
                  "text-xs flex items-center justify-center gap-1",
                  trend === 'UP' && "border-green-500 text-green-600",
                  trend === 'DOWN' && "border-red-500 text-red-600"
                )}>
                  {trend === 'UP'   ? <TrendingUp className="h-3 w-3" />   :
                   trend === 'DOWN' ? <TrendingDown className="h-3 w-3" /> :
                                      <HelpCircle className="h-3 w-3" />}
                  {trend}
                </Badge>
              </div>
            </div>

            {/* Linha 2: RSI + ADX */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 border rounded-lg bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground font-semibold mb-1">RSI Atual</p>
                <p className={cn("text-lg font-bold", rsiColor)}>
                  {currentRsi !== null ? currentRsi.toFixed(1) : '—'}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {currentRsi !== null
                    ? currentRsi > 70 ? 'Sobrecomprado'
                    : currentRsi < 30 ? 'Sobrevendido'
                    : currentRsi > 60 ? 'Alta'
                    : currentRsi < 40 ? 'Baixa'
                    : 'Neutro'
                    : ''}
                </p>
              </div>

              <div className="p-3 border rounded-lg bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground font-semibold mb-1">ADX (Força)</p>
                <p className={cn("text-lg font-bold",
                  currentAdx !== null && currentAdx > 40 ? 'text-green-500' :
                  currentAdx !== null && currentAdx > 25 ? 'text-yellow-500' : 'text-muted-foreground'
                )}>
                  {currentAdx !== null ? currentAdx.toFixed(1) : '—'}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {currentAdx !== null
                    ? currentAdx > 40 ? 'Forte'
                    : currentAdx > 25 ? 'Moderada'
                    : 'Fraca'
                    : ''}
                </p>
              </div>
            </div>

            {/* Linha 3: Força do Sinal */}
            <div className="p-3 border rounded-lg bg-muted/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground">Força do Sinal</span>
                </div>
                <Badge variant={strengthConfig[signalStrength].variant}>
                  {strengthConfig[signalStrength].label}
                </Badge>
              </div>
              {/* Barra de confirmações */}
              <div className="mt-2 flex gap-1">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    className={cn(
                      "h-1.5 flex-1 rounded-full transition-colors",
                      i < confirmationCount ? 'bg-primary' : 'bg-muted'
                    )}
                  />
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {confirmationCount}/4 confirmações — mínimo: {minConfirmations}
              </p>
            </div>

            {/* Linha 4: Barreira + Stake + Perdas */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 border rounded-lg bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground font-semibold mb-1 flex items-center justify-center gap-1">
                  <Shield className="h-3 w-3" /> Barreira
                </p>
                <p className="font-bold text-sm">{calculatedBarrier}</p>
              </div>
              <div className="p-3 border rounded-lg bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground font-semibold mb-1">Próx. Aposta</p>
                <p className="font-bold text-sm text-primary">${currentStake.toFixed(2)}</p>
              </div>
              <div className="p-3 border rounded-lg bg-muted/50 text-center">
                <p className="text-xs text-muted-foreground font-semibold mb-1">Perdas</p>
                <p className={cn("font-bold text-sm", consecutiveLosses > 0 && "text-destructive")}>
                  {consecutiveLosses}/{maxConsecutiveLosses}
                </p>
              </div>
            </div>
            <Separator />
          </div>
        )}

        {/* --- AJUSTES DA ESTRATÉGIA --- */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground">
              <SlidersHorizontal className="h-4 w-4" />
              Ajustes da Estratégia
              <ChevronsUpDown className="h-4 w-4 ml-auto" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-5 pt-4">

            <div className="space-y-2">
              <Label>ADX — Limiar de Tendência ({adxThreshold})</Label>
              <Slider min={15} max={50} step={1} value={[adxThreshold]} onValueChange={v => setAdxThreshold(v[0])} />
              <p className="text-xs text-muted-foreground">Força mínima de tendência para operar. Maior = mais seletivo.</p>
            </div>

            <div className="space-y-2">
              <Label>ATR — Multiplicador da Barreira ({atrMultiplier.toFixed(1)}x)</Label>
              <Slider min={0.5} max={5.0} step={0.1} value={[atrMultiplier]} onValueChange={v => setAtrMultiplier(v[0])} />
              <p className="text-xs text-muted-foreground">Distância do reset em relação ao preço atual. Maior = mais seguro, menor payout.</p>
            </div>

            <div className="space-y-2">
              <Label>Mínimo de Confirmações ({minConfirmations}/4)</Label>
              <Slider min={1} max={4} step={1} value={[minConfirmations]} onValueChange={v => setMinConfirmations(v[0])} />
              <p className="text-xs text-muted-foreground">
                {minConfirmations === 1 ? '⚡ 1 — Agressivo: mais trades, menor win rate' :
                 minConfirmations === 2 ? '⚖️ 2 — Balanceado: recomendado' :
                 minConfirmations === 3 ? '🎯 3 — Conservador: poucos trades, maior win rate' :
                 '🔒 4 — Ultra conservador: apenas sinais perfeitos'}
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="adaptive-duration-switch" className="flex flex-col gap-1">
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Duração Adaptativa
                </span>
                <span className="font-normal text-xs text-muted-foreground">
                  Ajusta automaticamente a duração do contrato baseado na volatilidade (ATR).
                </span>
              </Label>
              <Switch
                id="adaptive-duration-switch"
                checked={useAdaptiveDuration}
                onCheckedChange={setUseAdaptiveDuration}
              />
            </div>

          </CollapsibleContent>
        </Collapsible>

        {/* --- GESTÃO DE RISCO --- */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground">
              <Settings className="h-4 w-4" />
              Gerenciamento de Risco
              <ChevronsUpDown className="h-4 w-4 ml-auto" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-5 pt-4">

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="martingale-switch" className="flex flex-col gap-1 flex-1 pr-4">
                <span>Ativar Martingale</span>
                <span className="font-normal text-xs text-muted-foreground">Aumenta aposta após perdas para recuperar valor.</span>
              </Label>
              <Switch id="martingale-switch" checked={isMartingaleEnabled} onCheckedChange={setIsMartingaleEnabled} />
            </div>

            {isMartingaleEnabled && (
              <div className="space-y-4 pl-2">
                <div className="space-y-2">
                  <Label>Multiplicador ({martingaleMultiplier.toFixed(2)}x)</Label>
                  <Slider min={1.1} max={3.0} step={0.1} value={[martingaleMultiplier]} onValueChange={v => setMartingaleMultiplier(v[0])} />
                </div>
                <div className="space-y-2">
                  <Label>Máx. Perdas Seguidas ({maxConsecutiveLosses})</Label>
                  <Slider min={2} max={10} step={1} value={[maxConsecutiveLosses]} onValueChange={v => setMaxConsecutiveLosses(v[0])} />
                </div>
              </div>
            )}

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="w-full">
                  <Repeat className="mr-2 h-4 w-4" />
                  Reiniciar Sessão de Risco
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reiniciar Sessão?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Zera o contador de perdas e reseta a aposta para o valor base. Use após uma série de perdas.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={resetRiskSession}>Sim, Reiniciar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

          </CollapsibleContent>
        </Collapsible>

      </CardContent>
    </Card>
  );
}
