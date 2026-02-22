// src/features/trading/components/deriv-trader/digits-backtest-panel.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, TestTube, ChevronsUpDown, Check, X, Shield, BarChart, TrendingUp, TrendingDown, HelpCircle, Sigma, Database, Upload, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StrategyBacktestResult, CalibrationResult } from '@/features/trading/hooks/use-robot-council-digits';
import { strategyLabels } from '@/app/deriv-trader-digits/strategies-config';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';


interface DigitsOptimizationPanelProps {
  backtestTicks: any[];
  isDataLoading: boolean;
  loadDataForBacktest: () => void;
  backtestResults: Record<string, StrategyBacktestResult> | null;
  isBacktesting: boolean;
  runBacktestForAllStrategies: () => void;
  calibrationResults: Record<string, CalibrationResult> | null;
  isCalibrating: boolean;
  runCalibration: () => void;
  applyCalibration: () => void;
}

const ResultRow: React.FC<{ label: string; value: number; unit?: string; isCurrency?: boolean; isGood?: (v: number) => boolean }> = ({ label, value, unit, isCurrency, isGood }) => {
    const colorClass = isGood ? (isGood(value) ? 'text-green-600' : 'text-red-600') : 'text-foreground';
    return (
        <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{label}:</span>
            <span className={cn("font-mono font-semibold", colorClass)}>
                {isCurrency ? `$${value.toFixed(2)}` : `${value.toFixed(2)}${unit || ''}`}
            </span>
        </div>
    );
};

export function DigitsOptimizationPanel({
  backtestTicks,
  isDataLoading,
  loadDataForBacktest,
  backtestResults,
  isBacktesting,
  runBacktestForAllStrategies,
  calibrationResults,
  isCalibrating,
  runCalibration,
  applyCalibration
}: DigitsOptimizationPanelProps) {
  
  const sortedBacktestResults = React.useMemo(() => {
    if (!backtestResults) return [];
    return Object.entries(backtestResults).sort(([, a], [, b]) => b.totalProfit - a.totalProfit);
  }, [backtestResults]);

  const sortedCalibrationResults = React.useMemo(() => {
    if (!calibrationResults) return [];
    return Object.entries(calibrationResults).sort(([, a], [, b]) => (b.bestSummary?.totalProfit ?? -Infinity) - (a.bestSummary?.totalProfit ?? -Infinity));
  }, [calibrationResults]);

  return (
    <Collapsible>
        <CollapsibleTrigger asChild>
            <div className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm font-semibold shadow-sm hover:bg-accent/50 cursor-pointer">
                <span>Laboratório de Otimização e Backtest</span>
                <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
            </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
            <Card className="border-t-0 rounded-t-none">
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                <TestTube className="h-5 w-5 text-primary" />
                Otimizador de Estratégias
                </CardTitle>
                <CardDescription>
                Carregue dados históricos para executar simulações e encontrar os melhores parâmetros.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Card className="bg-muted/30">
                    <CardContent className="p-4 space-y-3">
                         <div className="flex flex-col sm:flex-row items-center gap-4">
                            <Button onClick={loadDataForBacktest} disabled={isDataLoading} className="w-full sm:w-auto">
                                {isDataLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Database className="mr-2 h-4 w-4"/>}
                                {isDataLoading ? 'A carregar...' : 'Carregar Dados para Análise'}
                            </Button>
                            {backtestTicks.length > 0 && (
                                <div className="text-sm text-green-600 flex items-center gap-2">
                                    <Check className="h-4 w-4"/>
                                    <span className="font-semibold">{backtestTicks.length}</span> ticks históricos carregados.
                                </div>
                            )}
                         </div>
                         <p className="text-xs text-muted-foreground">Busca os últimos 5000 ticks salvos no Firestore para usar nas simulações abaixo.</p>
                    </CardContent>
                </Card>

                <Tabs defaultValue="calibration" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="calibration">Otimização (Calibração)</TabsTrigger>
                        <TabsTrigger value="backtest">Backtest Rápido</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="calibration" className="pt-4 space-y-4">
                         <Button onClick={runCalibration} disabled={isCalibrating || backtestTicks.length < 5000} className="w-full">
                            <Wand2 className="mr-2 h-4 w-4" />
                            {isCalibrating ? "A Otimizar..." : "Iniciar Otimização"}
                         </Button>

                         {calibrationResults && (
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-sm font-semibold">Resultados da Otimização</h3>
                                    <Button size="sm" onClick={applyCalibration}>
                                        <Upload className="mr-2 h-4 w-4"/>
                                        Aplicar Parâmetros Otimizados
                                    </Button>
                                </div>
                                <ScrollArea className="h-72 border rounded-md">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Estratégia</TableHead>
                                                <TableHead>P&L (Antes/Depois)</TableHead>
                                                <TableHead>WR% (Antes/Depois)</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {sortedCalibrationResults.map(([key, result]) => (
                                                <TableRow key={key}>
                                                    <TableCell className="font-medium text-xs">{strategyLabels[key]}</TableCell>
                                                    <TableCell className="font-mono text-xs">
                                                        <span className={cn(result.initialSummary.totalProfit > 0 ? "text-green-600" : "text-red-600")}>
                                                            ${result.initialSummary.totalProfit.toFixed(2)}
                                                        </span> → 
                                                        <span className={cn("font-bold", result.bestSummary.totalProfit > 0 ? "text-green-600" : "text-red-600")}>
                                                            ${result.bestSummary.totalProfit.toFixed(2)}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs">
                                                        <span className={cn(result.initialSummary.winrate > 50 ? "text-green-600" : "text-red-600")}>
                                                          {result.initialSummary.winrate.toFixed(0)}%
                                                        </span> → 
                                                        <span className={cn("font-bold", result.bestSummary.winrate > 50 ? "text-green-600" : "text-red-600")}>
                                                            {result.bestSummary.winrate.toFixed(0)}%
                                                        </span>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </ScrollArea>
                            </div>
                         )}
                    </TabsContent>
                    
                    <TabsContent value="backtest" className="pt-4 space-y-4">
                        <Button onClick={runBacktestForAllStrategies} disabled={isBacktesting || backtestTicks.length < 1000} className="w-full">
                            <TestTube className="mr-2 h-4 w-4" />
                            {isBacktesting ? "A simular..." : "Rodar Backtest com Params Atuais"}
                        </Button>
                         {backtestResults && (
                            <div>
                                <h3 className="text-sm font-semibold mb-2">Resultados do Backtest</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {sortedBacktestResults.map(([key, result]) => (
                                    <div key={key} className="p-3 border rounded-md bg-background space-y-2">
                                        <p className="font-semibold text-xs">{strategyLabels[key]}</p>
                                        <ResultRow label="Trades" value={result.totalTrades} />
                                        <ResultRow label="Win Rate" value={result.winrate} unit="%" isGood={v => v > 50} />
                                        <ResultRow label="P&L" value={result.totalProfit} isCurrency isGood={v => v > 0} />
                                        <ResultRow label="Profit Factor" value={result.profitFactor} isGood={v => v > 1} />
                                    </div>
                                ))}
                                </div>
                            </div>
                         )}
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
        </CollapsibleContent>
    </Collapsible>
  );
}
