// src/features/trading/components/hf-trader/BacktestPanel.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, TestTube } from 'lucide-react';
import type { InstitutionalBacktestResult } from '@/lib/types';
import { StrategyType, strategyMetadata } from '@/features/trading/services/hf-strike-logic';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface BacktestPanelProps {
  results: Record<string, InstitutionalBacktestResult> | null;
  onRunBacktest: () => void;
  isBacktesting: boolean;
}

export function BacktestPanel({ results, onRunBacktest, isBacktesting }: BacktestPanelProps) {
  
  const sortedResults = React.useMemo(() => {
    if (!results) return [];
    return Object.entries(results).sort(([, a], [, b]) => b.metrics.sharpeRatio - a.metrics.sharpeRatio);
  }, [results]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
          <TestTube className="h-5 w-5 text-primary" />
          Simulador de Estratégias
        </CardTitle>
        <CardDescription>
          Execute todas as estratégias contra os últimos 1500 pontos de dados para avaliar a performance histórica.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={onRunBacktest} disabled={isBacktesting} className="w-full">
          {isBacktesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
          {isBacktesting ? "A Simular..." : "Rodar Backtest Institucional"}
        </Button>
        
        {isBacktesting && (
          <div className="flex justify-center items-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        
        {results && (
            <ScrollArea className="h-[300px] w-full">
              <Table>
                <TableHeader className="sticky top-0 bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[150px]">Estratégia</TableHead>
                    <TableHead className="text-center">Trades</TableHead>
                    <TableHead className="text-center">Win Rate</TableHead>
                    <TableHead className="text-center">Sharpe</TableHead>
                    <TableHead className="text-center">Max DD</TableHead>
                    <TableHead className="text-right">P&L Total</TableHead>
                    <TableHead className="text-left w-[150px]">Notas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedResults.map(([strategyKey, result]) => {
                    const strategyName = strategyMetadata[strategyKey as StrategyType]?.label || strategyKey;
                    const isProfitable = result.totalPnl > 0;
                    return (
                        <TableRow key={strategyKey}>
                            <TableCell className="font-medium">{strategyName}</TableCell>
                            <TableCell className="text-center font-mono">{result.totalTrades}</TableCell>
                            <TableCell className="text-center">
                                <span className={cn("font-semibold", result.winRate > 52 ? 'text-green-600' : 'text-red-600')}>
                                    {result.totalTrades > 0 ? `${result.winRate.toFixed(1)}%` : '-'}
                                </span>
                            </TableCell>
                            <TableCell className="text-center font-mono">{result.metrics.sharpeRatio.toFixed(2)}</TableCell>
                             <TableCell className="text-center font-mono text-red-600">{result.metrics.maxDrawdown.toFixed(1)}%</TableCell>
                            <TableCell className={cn("text-right font-bold font-mono", isProfitable ? 'text-green-600' : 'text-red-600')}>
                                {result.totalPnl.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{result.note || ''}</TableCell>
                        </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
