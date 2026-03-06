// src/features/trading/components/deriv-trader/council-autopilot-interface-digits.tsx
'use client';

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Bot, TestTube, Settings, Repeat, Wand2, BrainCircuit, SlidersHorizontal, ChevronsUpDown, UploadCloud, Loader2, ArrowRight, Database, Users, AlertTriangle, Check, Wallet, Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import type { useRobotCouncilDigits } from '@/features/trading/hooks/use-robot-council-digits';
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
import type { TickData } from "@/lib/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert } from "@/components/ui/alert";
import type { CalibrationResult, StrategyBacktestResult } from "../../hooks/use-robot-council-digits";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


interface DigitsOptimizationPanelProps {
  backtestTicks: TickData[];
  isDataLoading: boolean;
  loadDataForBacktest: () => Promise<void>;
  backtestResults: Record<string, StrategyBacktestResult> | null;
  isBacktesting: boolean;
  runBacktestForAllStrategies: () => void;
  calibrationResults: Record<string, CalibrationResult> | null;
  isCalibrating: boolean;
  runCalibration: () => Promise<void>;
  applyCalibration: () => void;
}

const DigitsOptimizationPanel: React.FC<DigitsOptimizationPanelProps> = ({
  backtestTicks, isDataLoading, loadDataForBacktest,
  backtestResults, isBacktesting, runBacktestForAllStrategies,
  calibrationResults, isCalibrating, runCalibration, applyCalibration
}) => {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Passo 1: Carregar Dados Históricos
          </CardTitle>
          <CardDescription>
            Busque até 5000 ticks salvos para usar nas simulações.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={loadDataForBacktest} disabled={isDataLoading} className="w-full">
            {isDataLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
            {isDataLoading ? 'A carregar...' : `Carregar Dados (${backtestTicks.length} ticks disponíveis)`}
          </Button>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TestTube className="h-5 w-5" />
            Passo 2: Backtest Rápido
          </CardTitle>
          <CardDescription>
            Simule todas as estratégias com os parâmetros atuais nos últimos 1000 ticks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={runBacktestForAllStrategies} disabled={isBacktesting || backtestTicks.length < 1000} className="w-full">
            {isBacktesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
            Rodar Backtest
          </Button>
          {backtestResults && (
            <ScrollArea className="h-64">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estratégia</TableHead>
                    <TableHead className="text-center">WR</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.values(backtestResults).sort((a,b) => b.totalProfit - a.totalProfit).map(res => (
                    <TableRow key={res.strategyId}>
                      <TableCell className="text-xs font-medium">{strategyLabels[res.strategyId] || res.strategyId}</TableCell>
                      <TableCell className={cn("text-center font-mono text-xs", res.winrate > 51 ? 'text-green-600' : 'text-red-600')}>{res.winrate.toFixed(1)}%</TableCell>
                      <TableCell className={cn("text-right font-mono text-xs", res.totalProfit > 0 ? 'text-green-600' : 'text-red-600')}>${res.totalProfit.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5" />
            Passo 3: Calibração Automática
          </CardTitle>
          <CardDescription>
            Execute uma busca "Grid Search" para encontrar os melhores parâmetros e aplique-os.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={runCalibration} disabled={isCalibrating || backtestTicks.length < 5000} className="w-full">
            {isCalibrating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrainCircuit className="mr-2 h-4 w-4" />}
            Encontrar Parâmetros Ótimos
          </Button>
          {calibrationResults && (
            <>
              <div className="space-y-2">
                <Label>Resultados da Otimização:</Label>
                <ScrollArea className="h-48 border rounded-md">
                   <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Estratégia</TableHead>
                          <TableHead>Trades</TableHead>
                          <TableHead>P&L</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                          {Object.values(calibrationResults).map(res => (
                              <TableRow key={res.bestSummary.strategyId}>
                                <TableCell className="text-xs">{strategyLabels[res.bestSummary.strategyId]}</TableCell>
                                <TableCell className="text-xs font-mono">{res.initialSummary.totalTrades} → {res.bestSummary.totalTrades}</TableCell>
                                <TableCell className="text-xs font-mono">{res.initialSummary.totalProfit.toFixed(2)} → <span className="font-bold text-primary">{res.bestSummary.totalProfit.toFixed(2)}</span></TableCell>
                              </TableRow>
                          ))}
                      </TableBody>
                   </Table>
                </ScrollArea>
              </div>
              <Button onClick={applyCalibration} className="w-full">
                <Check className="mr-2 h-4 w-4"/>
                Aplicar Parâmetros Otimizados
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};


// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

interface DigitsAutopilotManagerProps extends ReturnType<typeof useRobotCouncilDigits> {}

interface PilotControlRowProps {
    pilotDef: (typeof STRATEGY_DEFINITIONS)[0];
    pilotState: PilotState;
    toggleAutopilot: (type: PilotType) => void;
    togglePilotMartingale: (type: PilotType) => void;
    setPilotMartingaleInstallments: (type: PilotType, value: number) => void;
    children?: React.ReactNode;
}

// ============================================================================
// 2. COMPONENTES AUXILIARES (UI)
// ============================================================================
type PilotState = ReturnType<typeof useRobotCouncilDigits>['pilots'][keyof ReturnType<typeof useRobotCouncilDigits>['pilots']];

const getConfidence = (z: number) => {
    return (100 - (100 * Math.exp(-0.5 * z * z))).toFixed(0);
}

const PilotControlRow: React.FC<PilotControlRowProps> = ({
    pilotDef,
    pilotState,
    toggleAutopilot,
    togglePilotMartingale,
    setPilotMartingaleInstallments,
    children,
}) => {
    const { isOn, status, currentTarget, consecutiveLosses } = pilotState;

    const statusInfo = {
        'PAUSED': { text: 'Pausado', color: 'bg-gray-500' },
        'TRADING': { text: 'Ativo', color: 'bg-green-500' },
        'COOLDOWN': { text: `Cooldown`, color: 'bg-orange-500' },
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
                <>
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
                    <div className="text-xs text-muted-foreground mt-2 flex items-center gap-2 border-t pt-2">
                        <Info className="h-3 w-3 shrink-0"/>
                        <span className="truncate" title={currentTarget || ''}>{currentTarget || 'Aguardando sinal...'}</span>
                    </div>
                </>
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
            
            <Collapsible>
              <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-start text-xs text-muted-foreground gap-2 h-8">
                      <Wallet className="h-4 w-4"/>
                      Gestão de Risco (Recuperação)
                      <ChevronsUpDown className="h-3 w-3 ml-auto"/>
                  </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4 space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm bg-background/50">
                    <Label htmlFor={`${pilotDef.id}-martingale-switch`} className="flex flex-col space-y-1">
                        <span>Ativar Recuperação Gradual</span>
                        <span className="font-normal leading-snug text-muted-foreground text-xs">
                            Aumenta a aposta após perdas para recuperar o valor em parcelas.
                        </span>
                    </Label>
                    <Switch
                        id={`${pilotDef.id}-martingale-switch`}
                        checked={pilotState.isMartingaleEnabled}
                        onCheckedChange={() => togglePilotMartingale(pilotDef.id)}
                    />
                </div>
                 {pilotState.isMartingaleEnabled && (
                    <div className="space-y-2 pl-2">
                        <Label htmlFor={`${pilotDef.id}-installments-slider`}>Parcelas de Recuperação ({pilotState.martingaleRecoveryInstallments})</Label>
                        <Slider
                            id={`${pilotDef.id}-installments-slider`}
                            min={1} max={10} step={1}
                            value={[pilotState.martingaleRecoveryInstallments]}
                            onValueChange={(v) => setPilotMartingaleInstallments(pilotDef.id, v[0])}
                        />
                         <p className="text-xs text-muted-foreground pt-1">
                            O valor total perdido na sequência será dividido por este número de parcelas. Cada trade subsequente tentará recuperar uma parcela, diluindo o risco. Se uma nova perda ocorrer, as parcelas podem ser dobradas.
                        </p>
                    </div>
                )}
              </CollapsibleContent>
            </Collapsible>
        </div>
    );
};

const LookbackSlider = ({ title, value, setValue, min, max, step }: { title: string, value: number, setValue: (v: number) => void, min: number, max: number, step: number }) => (
  <div className="space-y-2">
    <Label htmlFor={`${title}-slider`}>{title} ({value} ticks)</Label>
    <Slider
      id={`${title}-slider`}
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={v => setValue(v[0])}
    />
  </div>
);

// ============================================================================
// 3. COMPONENTE PRINCIPAL (MANAGER)
// ============================================================================

export function DigitsAutopilotManager(props: DigitsAutopilotManagerProps) {
  const { 
    pilots, toggleAutopilot, togglePilotMartingale, setPilotMartingaleInstallments, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
    isSmartMartingale,
    cooldownTime, setCooldownTime,
    maxLosses, setMaxLosses, executionCooldown, setExecutionCooldown, resetSession,
    consensusThreshold, setConsensusThreshold, overUnderThreshold, setOverUnderThreshold,
    evenOddThreshold, setEvenOddThreshold, underdogThreshold, setUnderdogThreshold,
    isUnderdogInverse, setIsUnderdogInverse, overUnderUnderdogThreshold, setOverUnderUnderdogThreshold,
    evenOddUnderdogThreshold, setEvenOddUnderdogThreshold, sherlockThreshold, setSherlockThreshold,
    sherlockLookback, setSherlockLookback, disableSherlockCompensation, setDisableSherlockCompensation,
    sherlockWinRateThreshold, setSherlockWinRateThreshold, vagalumeConfig, setVagalumeConfig,
    backtestTicks, isDataLoading, loadDataForBacktest, backtestResults, isBacktesting,
    runBacktestForAllStrategies, calibrationResults, isCalibrating, runCalibration, applyCalibration,
    isConsensusMode, setIsConsensusMode, minConsensus, setMinConsensus,
    matchesDiffersLookback, setMatchesDiffersLookback,
    overUnderLookback, setOverUnderLookback,
    evenOddLookback, setEvenOddLookback,
    underdogLookback, setUnderdogLookback,
    underdogOverUnderLookback, setUnderdogOverUnderLookback,
    dynamicUnderdogOverUnderLookback, setDynamicUnderdogOverUnderLookback,
    underdogEvenOddLookback, setUnderdogEvenOddLookback
 } = props;

  const renderPilotParams = (pilotDef: typeof STRATEGY_DEFINITIONS[0]) => {
      const pilotState = pilots[pilotDef.id];
      if (!pilotState) return null;

      const lookbackControl = (() => {
        switch(pilotDef.id) {
          case 'matchesDiffers': return <LookbackSlider title="Janela de Análise" value={matchesDiffersLookback} setValue={setMatchesDiffersLookback} min={50} max={1000} step={50} />;
          case 'overUnder': return <LookbackSlider title="Janela de Análise" value={overUnderLookback} setValue={setOverUnderLookback} min={50} max={1000} step={50} />;
          case 'evenOdd': return <LookbackSlider title="Janela de Análise" value={evenOddLookback} setValue={setEvenOddLookback} min={50} max={1000} step={50} />;
          case 'underdog': return <LookbackSlider title="Janela de Análise" value={underdogLookback} setValue={setUnderdogLookback} min={50} max={500} step={25} />;
          case 'underdogOverUnder': return <LookbackSlider title="Janela de Análise" value={underdogOverUnderLookback} setValue={setUnderdogOverUnderLookback} min={50} max={1000} step={50} />;
          case 'dynamicUnderdogOverUnder': return <LookbackSlider title="Janela de Análise" value={dynamicUnderdogOverUnderLookback} setValue={setDynamicUnderdogOverUnderLookback} min={50} max={1000} step={50} />;
          case 'underdogEvenOdd': return <LookbackSlider title="Janela de Análise" value={underdogEvenOddLookback} setValue={setUnderdogEvenOddLookback} min={50} max={1000} step={50} />;
          default: return null;
        }
      })();
      
      const specificParams = (() => {
        switch (pilotDef.id) {
            case 'matchesDiffers':
                return (
                    <div className="space-y-2">
                        <Label htmlFor="z-score-threshold">Limiar de Anormalidade (Z-Score Ponderado) ({consensusThreshold.toFixed(1)})</Label>
                        <Slider id="z-score-threshold" min={1.5} max={8.0} step={0.1} value={[consensusThreshold]} onValueChange={v => setConsensusThreshold(v[0])} />
                        <p className="text-xs text-muted-foreground">Operar se o Z-score ponderado de um dígito exceder este valor.</p>
                    </div>
                );
            case 'overUnder':
                return (
                    <div className="space-y-2">
                        <Label htmlFor="ou-zscore-threshold">Limiar de Z-Score de Bloco ({overUnderThreshold.toFixed(1)})</Label>
                        <Slider id="ou-zscore-threshold" min={1.0} max={4.0} step={0.1} value={[overUnderThreshold]} onValueChange={v => setOverUnderThreshold(v[0])} />
                        <p className="text-xs text-muted-foreground">Opera quando a probabilidade do bloco se desvia significativamente do esperado (50%). Z-Score {'>'} 2 é estatisticamente significativo.</p>
                    </div>
                );
            case 'evenOdd':
                 return (
                    <div className="space-y-2">
                        <Label htmlFor="eo-zscore-threshold">Limiar de Z-Score de Bloco ({evenOddThreshold.toFixed(1)})</Label>
                        <Slider id="eo-zscore-threshold" min={1.0} max={4.0} step={0.1} value={[evenOddThreshold]} onValueChange={v => setEvenOddThreshold(v[0])} />
                        <p className="text-xs text-muted-foreground">Mesma lógica do Acima/Abaixo, mas para blocos Par/Ímpar.</p>
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
                          <Label htmlFor="sherlock-threshold">Limiar de Confiança do Bloco ({sherlockThreshold}%)</Label>
                          <Slider id="sherlock-threshold" min={51} max={85} step={1} value={[sherlockThreshold]} onValueChange={v => setSherlockThreshold(v[0])} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="sherlock-lookback">Janela de Análise Histórica ({sherlockLookback} ticks)</Label>
                          <Slider id="sherlock-lookback" min={100} max={1000} step={50} value={[sherlockLookback]} onValueChange={v => setSherlockLookback(v[0])} />
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
                          <Label htmlFor="vagalume-context-threshold">Limiar de Confiança Contextual ({vagalumeConfig.contextualThreshold}%)</Label>
                          <Slider
                            id="vagalume-context-threshold"
                            min={51}
                            max={75}
                            step={1}
                            value={[vagalumeConfig.contextualThreshold]}
                            onValueChange={(v) => setVagalumeConfig(c => ({...c, contextualThreshold: v[0]}))}
                          />
                          <p className="text-xs text-muted-foreground pt-1">
                              Define a confiança mínima para o "Contextual Alternator" operar em blocos (Par/Ímpar, etc).
                          </p>
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor="vagalume-zscore-threshold">Limiar de Z-Score (Blocos)</Label>
                            <Slider
                                id="vagalume-zscore-threshold"
                                min={1.0}
                                max={2.5}
                                step={0.1}
                                value={[vagalumeConfig.zScoreThreshold]}
                                onValueChange={(v) => setVagalumeConfig(c => ({...c, zScoreThreshold: v[0]}))}
                            />
                            <p className="text-xs text-muted-foreground pt-1">
                                Define o desvio estatístico mínimo para operar em blocos (Par/Ímpar, etc.).
                                Valor atual: {vagalumeConfig.zScoreThreshold.toFixed(1)}σ (~{getConfidence(vagalumeConfig.zScoreThreshold)}% de confiança).
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="vagalume-min-sequence">Comprimento Mínimo da Sequência (Repetição)</Label>
                            <Select
                                value={String(vagalumeConfig.minSequenceLength)}
                                onValueChange={(value) => setVagalumeConfig(c => ({ ...c, minSequenceLength: parseInt(value, 10) }))}
                            >
                                <SelectTrigger id="vagalume-min-sequence">
                                    <SelectValue placeholder="Selecione..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">1 Dígito (Apenas Contextual)</SelectItem>
                                    <SelectItem value="2">2 Dígitos Iguais</SelectItem>
                                    <SelectItem value="3">3 Dígitos Iguais</SelectItem>
                                    <SelectItem value="4">4 Dígitos Iguais</SelectItem>
                                    <SelectItem value="5">5 Dígitos Iguais</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground pt-1">
                                Selecione "1" para usar apenas o modo contextual.
                            </p>
                        </div>
                        <div className="space-y-3 pt-4 border-t">
                            <Label>Contratos Permitidos (Contextual)</Label>
                            <div className="flex items-center space-x-2">
                                <Switch
                                    id="vagalume-matchdiffers"
                                    checked={vagalumeConfig.allowedContracts.MATCHDIFFERS}
                                    onCheckedChange={(checked) => setVagalumeConfig(c => ({ ...c, allowedContracts: { ...c.allowedContracts, MATCHDIFFERS: !!checked } }))}
                                />
                                <Label htmlFor="vagalume-matchdiffers" className="text-sm font-normal">
                                    Combina/Difere (Repetição)
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch
                                    id="vagalume-evenodd"
                                    checked={vagalumeConfig.allowedContracts.EVENODD}
                                    onCheckedChange={(checked) => setVagalumeConfig(c => ({ ...c, allowedContracts: { ...c.allowedContracts, EVENODD: !!checked } }))}
                                />
                                <Label htmlFor="vagalume-evenodd" className="text-sm font-normal">
                                    Par/Ímpar (Contextual)
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch
                                    id="vagalume-overunder"
                                    checked={vagalumeConfig.allowedContracts.OVERUNDER}
                                    onCheckedChange={(checked) => setVagalumeConfig(c => ({ ...c, allowedContracts: { ...c.allowedContracts, OVERUNDER: !!checked } }))}
                                />
                                <Label htmlFor="vagalume-overunder" className="text-sm font-normal">
                                    Acima/Abaixo (Contextual)
                                </Label>
                            </div>
                        </div>
                         <div className="flex items-center justify-between rounded-lg border p-3">
                          <Label htmlFor="vagalume-predictive" className="text-sm">Análise Preditiva (Latência)</Label>
                          <Switch id="vagalume-predictive" checked={vagalumeConfig.usePredictiveAnalysis} onCheckedChange={(c) => setVagalumeConfig(cfg => ({...cfg, usePredictiveAnalysis: c}))} />
                        </div>
                         <div className="flex items-center justify-between rounded-lg border p-3">
                          <Label htmlFor="vagalume-ranging" className="text-sm">Exigir Regime Lateral</Label>
                          <Switch id="vagalume-ranging" checked={vagalumeConfig.requireRangingRegime} onCheckedChange={(c) => setVagalumeConfig(cfg => ({...cfg, requireRangingRegime: c}))} />
                        </div>
                     </div>
                );
            default:
                return null;
        }
      })();
      
      return (
        <div className="space-y-4">
            {specificParams}
            {lookbackControl && <Separator />}
            {lookbackControl}
        </div>
      );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Mesa de Comando de Estratégias
        </CardTitle>
        <CardDescription>
          Controle os pilotos, a gestão de risco e as otimizações.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs defaultValue="pilots" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="pilots" className="text-xs sm:text-sm"><Users className="h-4 w-4 mr-1.5"/>Pilotos</TabsTrigger>
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
                        togglePilotMartingale={togglePilotMartingale}
                        setPilotMartingaleInstallments={setPilotMartingaleInstallments}
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
                
                <div className="space-y-4 pt-4 border-t">
                    <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                        <Label htmlFor="consensus-mode-switch" className="flex flex-col space-y-1 flex-1 pr-4">
                            <span>Modo Consenso</span>
                            <span className="font-normal text-xs text-muted-foreground">Exigir acordo entre múltiplos pilotos para operar.</span>
                        </Label>
                        <Switch id="consensus-mode-switch" checked={isConsensusMode} onCheckedChange={setIsConsensusMode} />
                    </div>
                    {isConsensusMode && (
                        <div className="space-y-2 pl-2">
                            <Label htmlFor="min-consensus-slider">Limiar de Consenso ({minConsensus} pilotos)</Label>
                            <Slider id="min-consensus-slider" min={2} max={5} step={1} value={[minConsensus]} onValueChange={v => setMinConsensus(v[0])} />
                            <p className="text-xs text-muted-foreground pt-1">Número mínimo de pilotos que devem concordar para executar um trade.</p>
                        </div>
                    )}
                </div>
                
                 <Separator />
                 <Alert>
                    <Info className="h-4 w-4"/>
                    <CardDescription>
                        A gestão de recuperação (Martingale) foi movida para o controle individual de cada piloto no separador "Pilotos".
                    </CardDescription>
                 </Alert>
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
}
