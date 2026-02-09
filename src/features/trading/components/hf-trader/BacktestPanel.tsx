// src/features/trading/components/hf-trader/BacktestPanel.tsx
'use client';

import React, { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, TestTube, TrendingUp, HelpCircle } from 'lucide-react';
import type { InstitutionalBacktestResult } from '@/lib/types';
import { StrategyType, strategyMetadata } from '@/features/trading/services/hf-strike-logic';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip as ShadTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface BacktestPanelProps {
  results: Record<string, InstitutionalBacktestResult> | null;
  onRunBacktest: () => void;
  isBacktesting: boolean;
  onRunWalkForward?: () => void; // Optional for now
  onRunMonteCarlo?: () => void; // Optional for now
}

export function BacktestPanel({ results, onRunBacktest, isBacktesting, onRunWalkForward, onRunMonteCarlo }: BacktestPanelProps) {
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyType | null>(null);
  
  const sortedResults = useMemo(() => {
    if (!results) return [];
    return Object.entries(results).sort(([, a], [, b]) => (b.metrics?.sharpeRatio || -1) - (a.metrics?.sharpeRatio || -1));
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
      <CardContent className="space-y-6">
        <div className="flex gap-2">
            <Button 
                onClick={onRunBacktest} 
                disabled={isBacktesting} 
                className="flex-1"
            >
                <TestTube className="mr-2 h-4 w-4" />
                Backtest Simples
            </Button>
            
            <Button 
                onClick={onRunWalkForward} 
                disabled={true} // Disabled until implemented
                variant="secondary"
                className="flex-1"
            >
                🔄 Walk-Forward (Em Breve)
            </Button>
            
            <Button 
                onClick={onRunMonteCarlo} 
                disabled={true} // Disabled until implemented
                variant="outline"
                className="flex-1"
            >
                🎲 Monte Carlo (Em Breve)
            </Button>
        </div>
        
        {(isBacktesting && !results) && (
          <div className="flex justify-center items-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        
        {results && (
          <>
            <ScrollArea className="h-[300px] w-full">
              <Table>
                <TableHeader className="sticky top-0 bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[150px]">Estratégia</TableHead>
                    <TableHead className="text-center">Trades</TableHead>
                    <TableHead className="text-center">Win Rate</TableHead>
                    <TableHead className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        Sharpe
                        <TooltipProvider>
                          <ShadTooltip>
                            <TooltipTrigger>
                              <HelpCircle className="h-3 w-3 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs max-w-xs">
                                <strong>Sharpe Ratio:</strong> Mede retorno ajustado ao risco.
                                <br/>• &gt;2.0 = Excelente
                                <br/>• 1.0-2.0 = Bom
                                <br/>• &lt;1.0 = Marginal
                              </p>
                            </TooltipContent>
                          </ShadTooltip>
                        </TooltipProvider>
                      </div>
                    </TableHead>
                    <TableHead className="text-center">
                       <div className="flex items-center justify-center gap-1">
                        Max DD
                        <TooltipProvider>
                          <ShadTooltip>
                            <TooltipTrigger>
                              <HelpCircle className="h-3 w-3 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs max-w-xs">
                                <strong>Maximum Drawdown:</strong> A maior queda percentual do pico ao vale do capital.
                              </p>
                            </TooltipContent>
                          </ShadTooltip>
                        </TooltipProvider>
                      </div>
                    </TableHead>
                    <TableHead className="text-right">P&L Total</TableHead>
                    <TableHead className="text-left w-[150px]">Notas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedResults.map(([strategyKey, result]) => {
                     const strategyName = strategyMetadata[strategyKey as StrategyType]?.label || strategyKey;
                     const isProfitable = result.totalPnl > 0;
                    return (
                        <TableRow 
                          key={strategyKey}
                          onClick={() => setSelectedStrategy(strategyKey as StrategyType)}
                          className={cn(
                            "cursor-pointer transition-colors",
                            selectedStrategy === strategyKey ? "bg-primary/10" : "hover:bg-muted/50"
                          )}
                        >
                            <TableCell className="font-medium">{strategyName}</TableCell>
                            <TableCell className="text-center font-mono">{result.totalTrades}</TableCell>
                            <TableCell className="text-center">
                                <span className={cn("font-semibold", result.winRate > 52 ? 'text-green-600' : 'text-red-600')}>
                                    {result.totalTrades > 0 ? `${result.winRate.toFixed(1)}%` : '-'}
                                </span>
                            </TableCell>
                            <TableCell className="text-center font-mono">{result.metrics?.sharpeRatio?.toFixed(2) ?? 'N/A'}</TableCell>
                             <TableCell className="text-center font-mono text-red-600">{result.metrics?.maxDrawdown?.toFixed(1) ?? 'N/A'}%</TableCell>
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
            
            {selectedStrategy && results[selectedStrategy]?.equityCurve && (
              <Card className="border-2 border-primary">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Equity Curve - {strategyMetadata[selectedStrategy].label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={results[selectedStrategy].equityCurve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="candle" 
                        label={{ value: 'Trade #', position: 'insideBottom', offset: -5 }} 
                      />
                      <YAxis 
                        yAxisId="left"
                        label={{ value: 'Equity ($)', angle: -90, position: 'insideLeft' }} 
                      />
                      <YAxis 
                        yAxisId="right" 
                        orientation="right"
                        label={{ value: 'Drawdown (%)', angle: 90, position: 'insideRight' }} 
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb' }}
                        formatter={(value: number, name: string) => {
                          if (name === 'Equity') return [`$${value.toFixed(2)}`, name];
                          if (name === 'Drawdown') return [`${value.toFixed(1)}%`, 'Drawdown'];
                          return [value, name];
                        }}
                      />
                      <Legend />
                      <Line 
                        yAxisId="left"
                        type="monotone" 
                        dataKey="equity" 
                        stroke="#10b981" 
                        strokeWidth={2}
                        dot={false}
                        name="Equity"
                      />
                      <Line 
                        yAxisId="right"
                        type="monotone" 
                        dataKey="drawdown" 
                        stroke="#ef4444" 
                        strokeWidth={2}
                        dot={false}
                        name="Drawdown"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {selectedStrategy && results[selectedStrategy]?.monthlyPerformance && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">📅 Performance Mensal</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                        {results[selectedStrategy].monthlyPerformance.map((m) => (
                            <div 
                                key={m.month}
                                className={cn(
                                    "p-3 rounded-lg border text-center",
                                    m.pnl > 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
                                )}
                            >
                                <p className="text-xs font-semibold text-muted-foreground">{m.month}</p>
                                <p className={cn(
                                    "text-lg font-bold",
                                    m.pnl > 0 ? "text-green-600" : "text-red-600"
                                )}>
                                    ${m.pnl.toFixed(0)}
                                </p>
                                <p className="text-xs text-muted-foreground">{m.trades} trades</p>
                                <p className="text-xs text-muted-foreground">{m.winRate.toFixed(0)}% WR</p>
                            </div>
                        ))}
                        </div>
                    </CardContent>
                </Card>
            )}

          </>
        )}
      </CardContent>
    </Card>
  );
}
