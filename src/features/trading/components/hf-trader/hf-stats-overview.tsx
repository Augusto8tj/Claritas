// src/features/trading/components/hf-trader/hf-stats-overview.tsx
'use client';

import React, { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Operation } from '@/lib/types';
import { StrategyType, strategyMetadata } from '@/features/trading/services/hf-strike-logic';
import { cn } from '@/lib/utils';
import { AlertCircle, TrendingUp, TrendingDown, Minus, ListChecks, BarChartHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface HFStatsOverviewProps {
  operations: Operation[];
  strategyCounts: Record<StrategyType, number>;
}

const MetricCard = ({ 
  label, 
  value, 
  trend
}: { 
  label: string, 
  value: string | number,
  trend?: 'up' | 'down' | 'neutral'
}) => {
  const getTrendIcon = () => {
    if (trend === 'up') return <TrendingUp className="h-3 w-3 text-green-600" />;
    if (trend === 'down') return <TrendingDown className="h-3 w-3 text-red-600" />;
    return <Minus className="h-3 w-3 text-muted-foreground" />;
  };
  
  return (
    <div className="bg-muted/50 p-3 rounded-lg text-center hover:bg-muted transition-colors">
      <div className="flex items-center justify-center gap-1 mb-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        {trend && getTrendIcon()}
      </div>
      <p className={cn("text-lg font-bold", trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-foreground')}>{value}</p>
    </div>
  );
};


export function HFStatsOverview({ operations, strategyCounts }: HFStatsOverviewProps) {
    const sessionStats = useMemo(() => {
        const finishedTrades = operations.filter(op => op.status !== 'pending');
        const wins = finishedTrades.filter(t => t.result && Number(t.result) > 0);
        
        // Garante que a soma seja numérica convertendo explicitamente cada resultado
        const totalPnl = finishedTrades.reduce((sum, t) => sum + (Number(t.result) || 0), 0);
        const totalTradesCount = finishedTrades.length;
        const winRate = totalTradesCount > 0 ? (wins.length / totalTradesCount) * 100 : 0;
        
        const perStrategy = (Object.keys(strategyMetadata) as StrategyType[]).map(key => {
            const tradesForStrategy = finishedTrades.filter(op => op.strategy?.includes(key));
            const winsForStrategy = tradesForStrategy.filter(t => t.result && Number(t.result) > 0);
            
            const pnlForStrategy = tradesForStrategy.reduce((sum, t) => sum + (Number(t.result) || 0), 0);
            const tradeCount = tradesForStrategy.length;
            
            return {
                strategy: key,
                label: strategyMetadata[key].label,
                signals: strategyCounts[key] || 0,
                trades: tradeCount,
                pnl: pnlForStrategy,
                winRate: tradeCount > 0 ? (winsForStrategy.length / tradeCount) * 100 : 0,
            }
        }).sort((a,b) => b.signals - a.signals);

        return {
            totalTrades: totalTradesCount,
            totalPnl,
            winRate,
            perStrategy,
        }
    }, [operations, strategyCounts]);

  if (operations.length === 0 && Object.values(strategyCounts).every(c => c === 0)) {
      return (
          <Card className="col-span-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BarChartHorizontal className="h-5 w-5" /> Desempenho da Esquadra (Sessão)</CardTitle>
              </CardHeader>
              <CardContent className="text-center text-muted-foreground py-10">
                  <AlertCircle className="mx-auto h-8 w-8 mb-2" />
                  <p>Aguardando a primeira operação ou sinal da sessão.</p>
              </CardContent>
          </Card>
      );
  }
  
  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BarChartHorizontal className="h-5 w-5" />Desempenho da Esquadra (Sessão)</CardTitle>
        <CardDescription>Análise de performance e contagem de sinais por especialista na sessão atual.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
          <MetricCard 
            label="P&L Total" 
            value={`$${(Number(sessionStats.totalPnl) || 0).toFixed(2)}`} 
            trend={sessionStats.totalPnl > 0 ? 'up' : sessionStats.totalPnl < 0 ? 'down' : 'neutral'} 
          />
          <MetricCard label="Win Rate" value={`${(Number(sessionStats.winRate) || 0).toFixed(1)}%`} />
          <MetricCard label="Trades Executados" value={sessionStats.totalTrades} />
          <MetricCard label="Total Sinais Gerados" value={Object.values(strategyCounts).reduce((a,b)=>a+b, 0)} />
        </div>
        
        <div>
            <h3 className="font-semibold mb-2 text-sm flex items-center gap-2">
              <ListChecks className="h-4 w-4" />
              Análise por Estratégia
            </h3>
            <div className="border rounded-lg overflow-hidden">
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead className="w-[200px]">Especialista</TableHead>
                    <TableHead className="text-center">Sinais</TableHead>
                    <TableHead className="text-center">Trades</TableHead>
                    <TableHead className="text-center">Win Rate</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {sessionStats.perStrategy.map((s) => (
                    <TableRow key={s.strategy}>
                        <TableCell className="font-medium text-xs">{s.label}</TableCell>
                        <TableCell className="text-center font-mono">{s.signals}</TableCell>
                        <TableCell className="text-center font-mono">{s.trades}</TableCell>
                        <TableCell className="text-center font-mono">
                            {s.trades > 0 ? `${s.winRate.toFixed(0)}%` : '-'}
                        </TableCell>
                        <TableCell className={cn("text-right font-mono font-bold", s.pnl > 0 ? 'text-green-600' : s.pnl < 0 ? 'text-red-600' : 'text-muted-foreground')}>
                          {(Number(s.pnl) || 0).toFixed(2)}
                        </TableCell>
                    </TableRow>
                    ))}
                </TableBody>
                </Table>
            </div>
        </div>
      </CardContent>
    </Card>
  );
}
