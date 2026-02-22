// src/features/trading/components/deriv-trader/digits-backtest-panel.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, TestTube, GitCompareArrows, Check, X, Shield, BarChart, TrendingUp, TrendingDown, HelpCircle, Sigma } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StrategyBacktestResult } from '../../backtest/digits-backtest-engine';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { WalkForwardResult } from '../../optimization/digits-calibration-engine';
import { Separator } from '@/components/ui/separator';

interface DigitsBacktestPanelProps {
  backtestResults: Record<string, StrategyBacktestResult> | null;
  walkForwardResults: Record<string, WalkForwardResult[]> | null;
  isBacktesting: boolean;
  isWalkForwardMode: boolean;
  onRunBacktest: () => void;
  onSetWalkForwardMode: (value: boolean) => void;
  calibrationResults: any; 
  isCalibrating: boolean;
  onRunCalibration: () => void;
  onApplyCalibration: () => void;
}

const strategyLabels: Record<string, string> = {
    matchesDiffers: 'Contra-Tendência',
    overUnder: 'Acima/Abaixo',
    evenOdd: 'Par/Ímpar',
    underdog: 'Caçador de Azarão',
    underdogOverUnder: 'Azarão Acima/Abaixo',
    underdogEvenOdd: 'Azarão Par/Ímpar',
};

const WalkForwardTable: React.FC<{ results: WalkForwardResult[] }> = ({ results }) => (
    <div className='mt-4'>
        <h4 className='text-sm font-semibold mb-2'>Resultados Walk-Forward</h4>
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Fold</TableHead>
                    <TableHead>P&L (In-Sample)</TableHead>
                    <TableHead>P&L (Out-of-Sample)</TableHead>
                    <TableHead>Degradação</TableHead>
                    <TableHead>Robusto?</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {results.map((fold, index) => (
                    <TableRow key={index}>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell className='text-green-600 font-mono'>${fold.inSampleSummary.totalProfit.toFixed(2)}</TableCell>
                        <TableCell className={cn('font-mono', fold.outOfSampleSummary.totalProfit > 0 ? 'text-green-600' : 'text-red-600')}>
                            ${fold.outOfSampleSummary.totalProfit.toFixed(2)}
                        </TableCell>
                        <TableCell className={cn(fold.degradationPercent > 30 ? 'text-red-500' : 'text-green-500')}>
                            {fold.degradationPercent.toFixed(1)}%
                        </TableCell>
                        <TableCell>{fold.isRobust ? <Check className="h-4 w-4 text-green-500"/> : <X className="h-4 w-4 text-red-500"/>}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    </div>
);

export function DigitsBacktestPanel({
  backtestResults,
  walkForwardResults,
  isBacktesting,
  isWalkForwardMode,
  onRunBacktest,
  onSetWalkForwardMode,
  calibrationResults,
  isCalibrating,
  onRunCalibration,
  onApplyCalibration
}: DigitsBacktestPanelProps) {
  const sortedResults = React.useMemo(() => {
    if (!backtestResults) return [];
    return Object.entries(backtestResults).sort(([, a], [, b]) => b.totalProfit - a.totalProfit);
  }, [backtestResults]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
          <TestTube className="h-5 w-5 text-primary" />
          Simulador & Otimizador de Estratégias
        </CardTitle>
        <CardDescription>
          Execute backtests e calibrações para validar e otimizar as estratégias de dígitos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
          <Label htmlFor="walk-forward-switch" className="flex flex-col space-y-1">
            <span>Otimização Walk-Forward</span>
            <span className="font-normal text-xs text-muted-foreground">
              Usa validação cruzada para evitar overfitting. Mais lento, porém mais robusto.
            </span>
          </Label>
          <Switch 
            id="walk-forward-switch"
            checked={isWalkForwardMode}
            onCheckedChange={onSetWalkForwardMode}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
            <Button onClick={onRunBacktest} disabled={isBacktesting} className="w-full">
              <TestTube className="mr-2 h-4 w-4" />
              {isWalkForwardMode ? 'Rodar Walk-Forward' : 'Rodar Backtest Simples'}
            </Button>
             <Button onClick={onRunCalibration} disabled={isCalibrating || isBacktesting} variant="outline" className="w-full">
              <Sigma className="mr-2 h-4 w-4" />
              {isCalibrating ? "Calibrando..." : "Calibrar Parâmetros"}
            </Button>
        </div>
        
        {isBacktesting && (
          <div className="flex justify-center items-center p-8 text-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
            <span>{isWalkForwardMode ? 'Executando otimização Walk-Forward...' : 'Simulando...'}</span>
          </div>
        )}
        
        {backtestResults && !isWalkForwardMode && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estratégia</TableHead>
                  <TableHead>Win Rate</TableHead>
                  <TableHead>P&L</TableHead>
                  <TableHead>EV vs Random</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedResults.map(([strategyKey, result]) => {
                  const strategyName = strategyLabels[strategyKey] || strategyKey;
                  return (
                      <TableRow key={strategyKey}>
                          <TableCell>{strategyName}</TableCell>
                          <TableCell className={cn(result.winrate > 52 ? 'text-green-600' : 'text-red-600')}>
                              {result.winrate.toFixed(1)}%
                          </TableCell>
                          <TableCell className={cn(result.totalProfit > 0 ? 'text-green-600' : 'text-red-600')}>
                              {result.totalProfit.toFixed(2)}
                          </TableCell>
                           <TableCell className={cn(result.isProfitableVsRandom ? 'text-green-600' : 'text-red-600')}>
                               {result.isProfitableVsRandom ? 'Superior' : 'Inferior'}
                           </TableCell>
                      </TableRow>
                  );
                })}
              </TableBody>
            </Table>
        )}

        {walkForwardResults && isWalkForwardMode && (
             Object.entries(walkForwardResults).map(([key, results]) => (
                <div key={key}>
                    <h3 className="font-bold my-2">{strategyLabels[key]}</h3>
                    <WalkForwardTable results={results} />
                </div>
            ))
        )}

        {calibrationResults && !isCalibrating && (
             <div className="space-y-4 pt-4 border-t">
                <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-primary">Resultados da Calibração</h3>
                    <Button size="sm" onClick={onApplyCalibration}>Aplicar Parâmetros Otimizados</Button>
                </div>
                 {Object.entries(calibrationResults).map(([key, result]) => (
                    <Alert key={key} variant="default">
                        <AlertTitle>{strategyLabels[key]}</AlertTitle>
                        <AlertDescription>
                            Melhores Params: {JSON.stringify(result.bestParams)}
                            <br />
                            P&L: ${result.bestSummary.totalProfit.toFixed(2)} | Winrate: {result.bestSummary.winrate.toFixed(1)}%
                        </AlertDescription>
                    </Alert>
                ))}
             </div>
        )}
      </CardContent>
    </Card>
  );
}

```