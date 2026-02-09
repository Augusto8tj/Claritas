// src/features/trading/components/hf-trader/institutional-metrics-dashboard.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { calculateInstitutionalMetrics } from '../../analytics/performance-metrics';
import { useAuth } from '@/features/auth/hooks/use-auth';
import type { StrategyType } from '../../services/hf-strike-logic';
import { strategyMetadata } from '../../services/hf-strike-logic';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';

const MetricCard = ({ label, value }: { label: string, value: string | number }) => (
  <div className="bg-muted/50 p-3 rounded-lg text-center">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-lg font-bold">{value}</p>
  </div>
);

export function InstitutionalMetricsDashboard() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    if (!user) {
        setIsLoading(false);
        return;
    };
    const load = async () => {
        setIsLoading(true);
        try {
            const m = await calculateInstitutionalMetrics(
                user.uid,
                new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                new Date()
            );
            setMetrics(m);
        } catch (error) {
            console.error("Failed to calculate institutional metrics:", error);
            setMetrics(null);
        } finally {
            setIsLoading(false);
        }
    };
    load();
  }, [user]);
  
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  
  if (!metrics || metrics.totalTrades === 0) return (
      <Card className="col-span-full">
          <CardHeader>
            <CardTitle>📊 Métricas Institucionais (30 dias)</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-muted-foreground py-10">
              <AlertCircle className="mx-auto h-8 w-8 mb-2" />
              <p>Dados insuficientes para calcular métricas.</p>
          </CardContent>
      </Card>
  );
  
  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle>📊 Métricas Institucionais (30 dias)</CardTitle>
        <CardDescription>Análise de performance com base no seu histórico de trades de alta frequência.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          <MetricCard label="Sharpe Ratio" value={metrics.sharpeRatio.toFixed(2)} />
          <MetricCard label="Sortino Ratio" value={metrics.sortinoRatio.toFixed(2)} />
          <MetricCard label="Calmar Ratio" value={metrics.calmarRatio.toFixed(2)} />
          <MetricCard label="Max Drawdown" value={`${metrics.maxDrawdown.toFixed(1)}%`} />
          <MetricCard label="Profit Factor" value={metrics.profitFactor.toFixed(2)} />
          <MetricCard label="Expectancy" value={`$${metrics.expectancy.toFixed(2)}`} />
          <MetricCard label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`} />
          <MetricCard label="Total Trades" value={metrics.totalTrades} />
        </div>
        
        {metrics.strategyBreakdown.length > 0 && (
          <div>
            <h3 className="font-semibold mb-2">Performance por Estratégia</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estratégia</TableHead>
                  <TableHead>Trades</TableHead>
                  <TableHead>Win Rate</TableHead>
                  <TableHead>P&L</TableHead>
                  <TableHead>Sharpe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.strategyBreakdown.map((s: any) => (
                  <TableRow key={s.strategy}>
                    <TableCell>{strategyMetadata[s.strategy as StrategyType]?.label || s.strategy}</TableCell>
                    <TableCell>{s.trades}</TableCell>
                    <TableCell>{s.winRate.toFixed(1)}%</TableCell>
                    <TableCell className={cn(s.profitLoss > 0 ? 'text-green-600' : 'text-red-600', "font-mono")}>
                      ${s.profitLoss.toFixed(2)}
                    </TableCell>
                    <TableCell className="font-mono">{s.sharpe.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
