// src/features/trading/components/hf-trader/institutional-metrics-dashboard.tsx
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { calculateInstitutionalMetrics } from '../../analytics/performance-metrics';
import { useAuth } from '@/features/auth/hooks/use-auth';
import type { StrategyType } from '../../services/hf-strike-logic';
import { strategyMetadata } from '../../services/hf-strike-logic';
import { cn } from '@/lib/utils';
import { AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

const MetricCard = ({ 
  label, 
  value, 
  threshold, 
  trend 
}: { 
  label: string, 
  value: string | number,
  threshold?: { good: number, excellent: number },
  trend?: 'up' | 'down' | 'neutral'
}) => {
  const numValue = typeof value === 'string' ? parseFloat(value.replace('%', '')) : value;
  
  const getColor = () => {
    if (!threshold) return 'text-foreground';
    if (label.toLowerCase().includes('drawdown')) { // Inverse logic for drawdown
        if (numValue <= threshold.excellent) return 'text-green-600';
        if (numValue <= threshold.good) return 'text-amber-600';
        return 'text-red-600';
    }
    if (numValue >= threshold.excellent) return 'text-green-600';
    if (numValue >= threshold.good) return 'text-amber-600';
    return 'text-red-600';
  };
  
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
      <p className={cn("text-lg font-bold", getColor())}>{value}</p>
    </div>
  );
};


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

    const pnlDistribution = useMemo(() => {
        if (!metrics || !metrics.trades) return [];
        const trades = metrics.trades;
        const maxAbsPnl = Math.max(...trades.map((t: any) => Math.abs(t.pnl || 0)), 1);
        const bucketCount = 10;
        const bucketSize = (maxAbsPnl * 2) / bucketCount;
        
        const buckets = Array(bucketCount).fill(0).map((_, i) => -maxAbsPnl + i * bucketSize);
        const counts = Array(bucketCount).fill(0);
        
        trades.forEach((trade: any) => {
            for (let i = 0; i < buckets.length; i++) {
              if (trade.pnl >= buckets[i] && (i === buckets.length - 1 || trade.pnl < buckets[i + 1])) {
                  counts[i]++;
                  break;
              }
            }
        });
        
        return buckets.map((bucket, i) => ({
            range: `${bucket.toFixed(1)}~${(bucket + bucketSize).toFixed(1)}`,
            count: counts[i]
        }));
    }, [metrics]);


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
          <MetricCard label="Sharpe Ratio" value={metrics.sharpeRatio.toFixed(2)} threshold={{ good: 1.0, excellent: 1.5 }} />
          <MetricCard label="Sortino Ratio" value={metrics.sortinoRatio.toFixed(2)} threshold={{ good: 1.5, excellent: 2.5 }}/>
          <MetricCard label="Calmar Ratio" value={metrics.calmarRatio.toFixed(2)} threshold={{ good: 1.0, excellent: 2.0 }}/>
          <MetricCard label="Max Drawdown" value={`${metrics.maxDrawdown.toFixed(1)}%`} threshold={{ good: 20, excellent: 10 }} />
          <MetricCard label="Profit Factor" value={metrics.profitFactor.toFixed(2)} threshold={{ good: 1.5, excellent: 2.0 }}/>
          <MetricCard label="Expectancy" value={`$${metrics.expectancy.toFixed(2)}`} />
          <MetricCard label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`} threshold={{ good: 55, excellent: 65 }}/>
          <MetricCard label="Total Trades" value={metrics.totalTrades} />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {metrics.strategyBreakdown?.length > 0 && (
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

            {pnlDistribution.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">📊 Distribuição de P&L</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={pnlDistribution}>
                            <XAxis dataKey="range" fontSize={10} angle={-30} textAnchor="end" height={40}/>
                            <YAxis fontSize={12}/>
                            <RechartsTooltip contentStyle={{ backgroundColor: 'hsl(var(--background))' }}/>
                            <Bar dataKey="count" fill="hsl(var(--primary))" />
                        </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            )}
        </div>
      </CardContent>
    </Card>
  );
}
