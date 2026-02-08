// src/features/trading/components/deriv-trader/digits-backtest-panel.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, TestTube } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StrategyBacktestResult } from '../../backtest/digits-backtest-engine';

interface DigitsBacktestPanelProps {
  results: Record<string, StrategyBacktestResult> | null;
  onRunBacktest: () => void;
  isBacktesting: boolean;
}

const strategyLabels: Record<string, string> = {
    matchesDiffers: 'Combina / Difere',
    overUnder: 'Acima / Abaixo',
    evenOdd: 'Par / Ímpar',
};

export function DigitsBacktestPanel({ results, onRunBacktest, isBacktesting }: DigitsBacktestPanelProps) {
  const sortedResults = React.useMemo(() => {
    if (!results) return [];
    return Object.entries(results).sort(([, a], [, b]) => b.totalPnl - a.totalPnl);
  }, [results]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
          <TestTube className="h-5 w-5 text-primary" />
          Simulador de Estratégias de Dígitos
        </CardTitle>
        <CardDescription>
          Execute as estratégias de dígitos contra os últimos 1000 ticks para avaliar a performance histórica.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={onRunBacktest} disabled={isBacktesting} className="w-full">
          {isBacktesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
          {isBacktesting ? "A Simular..." : "Rodar Backtest de Dígitos"}
        </Button>
        
        {isBacktesting && (
          <div className="flex justify-center items-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        
        {results && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">Estratégia</TableHead>
                  <TableHead className="text-center">Win Rate</TableHead>
                  <TableHead className="text-center">Total Trades</TableHead>
                  <TableHead className="text-right">P&L Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedResults.map(([strategyKey, result]) => {
                  const strategyName = strategyLabels[strategyKey] || strategyKey;
                  const isProfitable = result.totalPnl > 0;
                  return (
                      <TableRow key={strategyKey}>
                          <TableCell className="font-medium">{strategyName}</TableCell>
                          <TableCell className="text-center">
                              <span className={cn("font-semibold", result.winRate > 52 ? 'text-green-600' : 'text-red-600')}>
                                  {result.winRate.toFixed(1)}%
                              </span>
                          </TableCell>
                          <TableCell className="text-center font-mono">{result.totalTrades}</TableCell>
                          <TableCell className={cn("text-right font-bold font-mono", isProfitable ? 'text-green-600' : 'text-red-600')}>
                              {result.totalPnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                          </TableCell>
                      </TableRow>
                  );
                })}
              </TableBody>
            </Table>
        )}
      </CardContent>
    </Card>
  );
}
