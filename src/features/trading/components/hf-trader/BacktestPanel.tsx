// src/features/trading/components/hf-trader/BacktestPanel.tsx
'use client';

import React, { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, TestTube, TrendingUp, HelpCircle, GitCompareArrows, Dice5 } from 'lucide-react';
import type { InstitutionalBacktestResult, WalkForwardResult, MonteCarloResult } from '@/lib/types';
import { StrategyType, strategyMetadata } from '@/features/trading/services/hf-strike-logic';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface BacktestPanelProps {
  results: Record<string, InstitutionalBacktestResult> | null;
  walkForwardResults: WalkForwardResult[] | null;
  monteCarloResult: MonteCarloResult | null;
  onRunBacktest: () => void;
  isBacktesting: boolean;
  onRunWalkForward: () => void;
  onRunMonteCarlo: () => void;
}

const MetricCard = ({ label, value }: { label: string, value: string | number }) => (
    <div className="bg-muted/50 p-3 rounded-lg text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
);

const WalkForwardResultsDisplay = ({ results }: { results: WalkForwardResult[] }) => (
    <Card>
        <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
                <GitCompareArrows className="h-4 w-4" /> Análise Walk-Forward
            </CardTitle>
            <CardDescription>Validação da robustez da estratégia em diferentes períodos de mercado (In-Sample vs. Out-of-Sample).</CardDescription>
        </CardHeader>
        <CardContent>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Fold</TableHead>
                        <TableHead>Sharpe (IS / OOS)</TableHead>
                        <TableHead>Win Rate (IS / OOS)</TableHead>
                        <TableHead>% Degradação</TableHead>
                        <TableHead>Robusto?</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {results.map((fold, index) => (
                        <TableRow key={index}>
                            <TableCell>{index + 1}</TableCell>
                            <TableCell>{fold.inSample.metrics.sharpeRatio.toFixed(2)} / {fold.outOfSample.metrics.sharpeRatio.toFixed(2)}</TableCell>
                            <TableCell>{fold.inSample.winRate.toFixed(1)}% / {fold.outOfSample.winRate.toFixed(1)}%</TableCell>
                            <TableCell className={cn(fold.degradation.sharpeRatio > 25 && "text-red-500 font-bold")}>{fold.degradation.sharpeRatio.toFixed(1)}%</TableCell>
                            <TableCell>{fold.isRobust ? '✅ Sim' : '❌ Não'}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </CardContent>
    </Card>
);

const MonteCarloResultsDisplay = ({ result }: { result: MonteCarloResult }) => (
    <Card>
        <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
                <Dice5 className="h-4 w-4" /> Simulação de Monte Carlo
            </CardTitle>
            <CardDescription>Validação estatística da estratégia embaralhando a ordem dos trades 1000 vezes.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Sharpe Médio" value={result.statistics.meanSharpe.toFixed(2)} />
            <MetricCard label="Prob. de Lucro" value={`${result.probabilityOfProfit.toFixed(1)}%`} />
            <MetricCard label="Pior Cenário (5%)" value={result.statistics.percentile5.toFixed(2)} />
            <MetricCard label="VaR 95%" value={`-$${Math.abs(result.valueAtRisk95).toFixed(2)}`} />
        </CardContent>
    </Card>
);

export function BacktestPanel({ 
  results, 
  walkForwardResults, 
  monteCarloResult, 
  onRunBacktest, 
  isBacktesting, 
  onRunWalkForward, 
  onRunMonteCarlo 
}: BacktestPanelProps) {
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
        <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={onRunBacktest} disabled={isBacktesting} className="flex-1">
                <TestTube className="mr-2 h-4 w-4" />
                Backtest Simples
            </Button>
            <Button onClick={onRunWalkForward} disabled={isBacktesting} variant="secondary" className="flex-1">
                <GitCompareArrows className="mr-2 h-4 w-4" /> Walk-Forward
            </Button>
            <Button onClick={onRunMonteCarlo} disabled={isBacktesting || !results} variant="outline" className="flex-1">
                <Dice5 className="mr-2 h-4 w-4" /> Monte Carlo
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
                          <Tooltip>
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
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </TableHead>
                    <TableHead className="text-center">
                       <div className="flex items-center justify-center gap-1">
                        Max DD
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <HelpCircle className="h-3 w-3 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs max-w-xs">
                                <strong>Maximum Drawdown:</strong> A maior queda percentual do pico ao vale do capital.
                              </p>
                            </TooltipContent>
                          </Tooltip>
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
                    Equity Curve - {strategyMetadata[selectedStrategy as StrategyType].label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={results[selectedStrategy].equityCurve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis 
                        dataKey="candle" 
                        label={{ value: 'Trade #', position: 'insideBottom', offset: -5 }} 
                        fontSize={10}
                      />
                      <YAxis 
                        yAxisId="left"
                        label={{ value: 'Equity ($)', angle: -90, position: 'insideLeft' }} 
                        fontSize={10}
                        tickFormatter={(value) => `$${value}`}
                      />
                      <YAxis 
                        yAxisId="right" 
                        orientation="right"
                        label={{ value: 'Drawdown (%)', angle: 90, position: 'insideRight' }} 
                        fontSize={10}
                        tickFormatter={(value) => `${value}%`}
                      />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb' }}
                        formatter={(value: number, name: string) => {
                          if (name === 'Equity') return [`$${value.toFixed(2)}`, name];
                          if (name === 'Drawdown') return [`${value.toFixed(1)}%`, name];
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
        
        {walkForwardResults && <WalkForwardResultsDisplay results={walkForwardResults} />}
        {monteCarloResult && <MonteCarloResultsDisplay result={monteCarloResult} />}
      </CardContent>
    </Card>
  );
}
