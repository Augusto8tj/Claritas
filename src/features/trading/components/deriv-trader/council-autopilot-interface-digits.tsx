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
import { Bot, Binary, TrendingUp, HelpCircle, Trophy, Settings, AlertTriangle, ShieldCheck, Power, Clock, Repeat, TestTube, Wand2, BrainCircuit, SlidersHorizontal, ChevronsUpDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import type { useRobotCouncilDigits, PilotType, PilotState, StrategyBacktestResult, CalibrationResult } from '@/features/trading/hooks/use-robot-council-digits';
import { useVagalumeAlternante, type VagalumeConfig, type VagalumeSignal, type DigitContractType } from '@/features/trading/hooks/use-vagalume-alternante';
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
import { STRATEGY_DEFINITIONS, strategyLabels } from '@/app/deriv-trader-digits/strategies-config';
import { DigitsOptimizationPanel } from './digits-backtest-panel';

// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

interface DigitsAutopilotManagerProps extends ReturnType<typeof useRobotCouncilDigits> {}

interface PilotControlRowProps {
    pilotDef: (typeof STRATEGY_DEFINITIONS)[0];
    pilotState: PilotState;
    toggleAutopilot: (type: PilotType) => void;
    children?: React.ReactNode;
}

// ============================================================================
// 2. COMPONENTES AUXILIARES (UI)
// ============================================================================

const PilotControlRow: React.FC<PilotControlRowProps> = ({
    pilotDef,
    pilotState,
    toggleAutopilot,
    children,
}) => {
    const { isOn, status, currentTarget, consecutiveLosses } = pilotState;

    const statusInfo = {
        'PAUSED': { text: 'Pausado', color: 'bg-gray-500' },
        'TRADING': { text: 'Ativo', color: 'bg-green-500' },
        'COOLDOWN': { text: `Cooldown (${currentTarget})`, color: 'bg-orange-500' },
        'CIRCUIT_BREAKER': { text: 'Pausa de Risco', color: 'bg-red-500' },
    };

    return (
        <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-start justify-between">
                <div className="flex-1 pr-4">
                    <Label htmlFor={`${pilotDef.id}-switch`} className="font-semibold">{pilotDef.name}</Label>
                    <p className="text-xs text-muted-foreground">{pilotDef.description}</p>
                </div>
                <Switch
                    id={`${pilotDef.id}-switch`}
                    checked={isOn}
                    onCheckedChange={() => toggleAutopilot(pilotDef.id)}
                    className="data-[state=checked]:bg-green-600"
                />
            </div>

            {isOn && (
                <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-3">
                    <Badge variant="outline" className="flex items-center gap-1.5">
                        <div className={cn("h-2 w-2 rounded-full", statusInfo[status]?.color || 'bg-gray-500')}></div>
                        {statusInfo[status]?.text || status}
                    </Badge>
                     <Badge variant="destructive" className={cn(consecutiveLosses > 0 ? "flex" : "hidden", "items-center gap-1")}>
                        <AlertTriangle className="h-3 w-3"/>
                        {consecutiveLosses} Perdas
                    </Badge>
                </div>
            )}
             {children && (
                <Collapsible>
                    <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-full justify-start text-xs text-muted-foreground gap-2 h-8">
                            <SlidersHorizontal className="h-4 w-4"/>
                            Ajuste Fino
                            <ChevronsUpDown className="h-3 w-3 ml-auto"/>
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-4 space-y-4">
                         {children}
                    </CollapsibleContent>
                </Collapsible>
            )}
        </div>
    );
};

// ============================================================================
// 3. COMPONENTE PRINCIPAL (MANAGER)
// ============================================================================

export const DigitsAutopilotManager: React.FC<DigitsAutopilotManagerProps> = (props) => {
  const { 
    pilots, toggleAutopilot, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
    isMartingaleEnabled, setIsMartingaleEnabled, isSmartMartingale, setIsSmartMartingale,
    martingaleRecoveryFactor, setMartingaleRecoveryFactor, cooldownTime, setCooldownTime,
    maxLosses, setMaxLosses, executionCooldown, setExecutionCooldown, resetSession,
    // Props para os sliders
    consensusThreshold, setConsensusThreshold, overUnderThreshold, setOverUnderThreshold,
    evenOddThreshold, setEvenOddThreshold, underdogThreshold, setUnderdogThreshold,
    isUnderdogInverse, setIsUnderdogInverse, overUnderUnderdogThreshold, setOverUnderUnderdogThreshold,
    evenOddUnderdogThreshold, setEvenOddUnderdogThreshold, sherlockThreshold, setSherlockThreshold,
    sherlockLookback, setSherlockLookback, disableSherlockCompensation, setDisableSherlockCompensation,
    sherlockWinRateThreshold, setSherlockWinRateThreshold, vagalumeConfig, setVagalumeConfig,
    // Props para o painel de otimização
    backtestTicks, isDataLoading, loadDataForBacktest, backtestResults, isBacktesting,
    runBacktestForAllStrategies, calibrationResults, isCalibrating, runCalibration, applyCalibration
 } = props;

  const renderPilotParams = (pilotDef: typeof STRATEGY_DEFINITIONS[0]) => {
      switch (pilotDef.id) {
          case 'matchesDiffers':
              return (
                  <div className="space-y-2">
                      <Label htmlFor="z-score-threshold">Limiar de Anormalidade (Z-Score) ({consensusThreshold.toFixed(1)})</Label>
                      <Slider id="z-score-threshold" min={1.5} max={5.0} step={0.1} value={[consensusThreshold]} onValueChange={v => setConsensusThreshold(v[0])} />
                      <p className="text-xs text-muted-foreground">Operar se o Z-score ponderado de um dígito exceder este valor.</p>
                  </div>
              );
          case 'overUnder':
              return (
                  <div className="space-y-2">
                      <Label htmlFor="ou-threshold">Limiar de Prob. de Bloco ({overUnderThreshold.toFixed(1)}%)</Label>
                      <Slider id="ou-threshold" min={55} max={80} step={1} value={[overUnderThreshold]} onValueChange={v => setOverUnderThreshold(v[0])} />
                  </div>
              );
          case 'evenOdd':
               return (
                  <div className="space-y-2">
                      <Label htmlFor="eo-threshold">Limiar de Prob. de Bloco ({evenOddThreshold.toFixed(1)}%)</Label>
                      <Slider id="eo-threshold" min={55} max={80} step={1} value={[evenOddThreshold]} onValueChange={v => setEvenOddThreshold(v[0])} />
                  </div>
              );
          case 'underdog':
                return (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="underdog-threshold">Limiar de Frequência de Disparo ({underdogThreshold.toFixed(1)}%)</Label>
                            <Slider id="underdog-threshold" min={1.0} max={10.0} step={0.5} value={[underdogThreshold]} onValueChange={v => setUnderdogThreshold(v[0])} />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border p-3">
                            <Label htmlFor="underdog-inverse-switch" className="flex flex-col space-y-1">
                                <span>Inverter Lógica (Apostar 'Difere')</span>
                            </Label>
                            <Switch id="underdog-inverse-switch" checked={isUnderdogInverse} onCheckedChange={setIsUnderdogInverse} />
                        </div>
                    </div>
                );
          case 'underdogOverUnder':
              return (
                  <div className="space-y-2">
                      <Label htmlFor="underdog-ou-threshold">Limiar de Frequência de Bloco ({overUnderUnderdogThreshold.toFixed(1)}%)</Label>
                      <Slider id="underdog-ou-threshold" min={30} max={48} step={1} value={[overUnderUnderdogThreshold]} onValueChange={v => setOverUnderUnderdogThreshold(v[0])} />
                  </div>
              );
          case 'underdogEvenOdd':
               return (
                  <div className="space-y-2">
                      <Label htmlFor="underdog-eo-threshold">Limiar de Frequência de Bloco ({evenOddUnderdogThreshold.toFixed(1)}%)</Label>
                      <Slider id="underdog-eo-threshold" min={30} max={48} step={1} value={[evenOddUnderdogThreshold]} onValueChange={v => setEvenOddUnderdogThreshold(v[0])} />
                  </div>
              );
          case 'sherlock':
              return (
                  <div className="space-y-6">
                      <div className="space-y-2">
                        <Label htmlFor="sherlock-threshold">Limiar de Confiança do Bloco ({sherlockThreshold.toFixed(0)}%)</Label>
                        <Slider id="sherlock-threshold" min={51} max={85} step={1} value={[sherlockThreshold]} onValueChange={setSherlockThreshold} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="sherlock-lookback">Janela de Análise Histórica ({sherlockLookback} ticks)</Label>
                        <Slider id="sherlock-lookback" min={100} max={1000} step={50} value={[sherlockLookback]} onValueChange={setSherlockLookback} />
                      </div>
                       <div className="space-y-2">
                          <Label htmlFor="sherlock-winrate-threshold">Limiar de Win Rate da Sessão ({sherlockWinRateThreshold.toFixed(0)}%)</Label>
                          <Slider id="sherlock-winrate-threshold" min={1} max={100} step={1} value={[sherlockWinRateThreshold]} onValueChange={v => setSherlockWinRateThreshold(v[0])} />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <Label htmlFor="sherlock-compensation" className="text-sm">Compensação de Latência</Label>
                        <Switch id="sherlock-compensation" checked={!disableSherlockCompensation} onCheckedChange={(checked) => setDisableSherlockCompensation(!checked)} />
                      </div>
                  </div>
              );
          case 'vagalume':
              return (
                   <div className="space-y-6">
                      <div className="space-y-2">
                        <Label htmlFor="vagalume-threshold">Limiar de Confiança Contextual ({vagalumeConfig.contextualThreshold}%)</Label>
                        <Slider id="vagalume-threshold" min={51} max={75} step={1} value={[vagalumeConfig.contextualThreshold]} onValueChange={v => setVagalumeConfig(c => ({...c, contextualThreshold: v[0]}))} />
                      </div>
                       <div className="flex items-center justify-between rounded-lg border p-3">
                        <Label htmlFor="vagalume-predictive" className="text-sm">Análise Preditiva (Latência)</Label>
                        <Switch id="vagalume-predictive" checked={vagalumeConfig.usePredictiveAnalysis} onCheckedChange={(c) => setVagalumeConfig(cfg => ({...cfg, usePredictiveAnalysis: c}))} />
                      </div>
                   </div>
              );
          default:
              return null;
      }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Mesa de Comando (Digits)
        </CardTitle>
        <CardDescription>
          Controle os pilotos automáticos, a gestão de risco e as otimizações.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs defaultValue="pilots" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="pilots" className="text-xs sm:text-sm"><Bot className="h-4 w-4 mr-1.5"/>Pilotos</TabsTrigger>
                <TabsTrigger value="optimization" className="text-xs sm:text-sm"><TestTube className="h-4 w-4 mr-1.5"/>Otimização</TabsTrigger>
                <TabsTrigger value="risk" className="text-xs sm:text-sm"><Settings className="h-4 w-4 mr-1.5"/>Risco</TabsTrigger>
            </TabsList>
            <TabsContent value="pilots" className="pt-6 space-y-4">
                {STRATEGY_DEFINITIONS.map(def => (
                    <PilotControlRow
                        key={def.id}
                        pilotDef={def}
                        pilotState={pilots[def.id]}
                        toggleAutopilot={toggleAutopilot}
                    >
                        {renderPilotParams(def)}
                    </PilotControlRow>
                ))}
            </TabsContent>

            <TabsContent value="optimization" className="pt-4">
                <DigitsOptimizationPanel
                    backtestTicks={backtestTicks}
                    isDataLoading={isDataLoading}
                    loadDataForBacktest={loadDataForBacktest}
                    backtestResults={backtestResults}
                    isBacktesting={isBacktesting}
                    runBacktestForAllStrategies={runBacktestForAllStrategies}
                    calibrationResults={calibrationResults}
                    isCalibrating={isCalibrating}
                    runCalibration={runCalibration}
                    applyCalibration={applyCalibration}
                />
            </TabsContent>

            <TabsContent value="risk" className="pt-6 space-y-6">
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="council-daily-balance-digits">Banca do Dia (USD)</Label>
                        <Input id="council-daily-balance-digits" type="number" value={dailyBalance} onChange={e => setDailyBalance(Number(e.target.value))} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="council-daily-target-digits">Alvo de Lucro (USD)</Label>
                        <Input id="council-daily-target-digits" type="number" value={dailyTarget} onChange={e => setDailyTarget(Number(e.target.value))} />
                    </div>
                </div>
                 <Separator />
                <div className="space-y-2">
                    <Label htmlFor="execution-cooldown-slider">Intervalo Mínimo Entre Ordens ({executionCooldown}s)</Label>
                    <Slider id="execution-cooldown-slider" min={0} max={10} step={1} value={[executionCooldown]} onValueChange={v => setExecutionCooldown(v[0])} />
                </div>
                 <Separator />
                <div className="flex items-center justify-between rounded-lg border p-3">
                    <Label htmlFor="martingale-switch">Ativar Martingale</Label>
                    <Switch id="martingale-switch" checked={isMartingaleEnabled} onCheckedChange={setIsMartingaleEnabled} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                    <Label htmlFor="smart-martingale-switch">Martingale Inteligente (Kelly)</Label>
                    <Switch id="smart-martingale-switch" checked={isSmartMartingale} onCheckedChange={setIsSmartMartingale} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="martingale-recovery-slider">Fator de Recuperação ({martingaleRecoveryFactor.toFixed(1)}x)</Label>
                    <Slider id="martingale-recovery-slider" min={1.1} max={2.5} step={0.1} value={[martingaleRecoveryFactor]} onValueChange={v => setMartingaleRecoveryFactor(v[0])} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="cooldown-slider">Cooldown Pós-Perda ({cooldownTime}s)</Label>
                    <Slider id="cooldown-slider" min={0} max={60} step={1} value={[cooldownTime]} onValueChange={v => setCooldownTime(v[0])} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="max-losses-slider">Limite de Perdas Seguidas ({maxLosses})</Label>
                    <Slider id="max-losses-slider" min={3} max={40} step={1} value={[maxLosses]} onValueChange={v => setMaxLosses(v[0])} />
                </div>
                <Separator />
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive" className="w-full">
                            <Repeat className="mr-2 h-4 w-4" />
                            Reiniciar Sessão de Pilotos
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Tem a certeza?</AlertDialogTitle>
                            <AlertDialogDescription>Esta ação irá apagar o histórico de lucros/perdas e o estado de Martingale de todos os pilotos de dígitos para a sessão atual.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={resetSession}>Sim, Reiniciar</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
