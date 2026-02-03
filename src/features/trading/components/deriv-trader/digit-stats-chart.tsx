// src/features/trading/components/deriv-trader/digit-stats-chart.tsx
'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TickData } from '@/lib/types';
import { useMemo } from 'react';
import { BarChart as BarChartIcon } from 'lucide-react';

interface DigitStatsChartProps {
  priceTicks: TickData[];
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#a4de6c', '#d0ed57', '#ffc658'];

export function DigitStatsChart({ priceTicks }: DigitStatsChartProps) {
  const digitStats = useMemo(() => {
    if (priceTicks.length < 100) {
      return Array.from({ length: 10 }, (_, i) => ({ name: String(i), value: 0, probability: '0.0%' }));
    }
    
    const counts = Array(10).fill(0);
    const last1000Ticks = priceTicks.slice(-1000);
    
    last1000Ticks.forEach(tick => {
      const lastDigit = parseInt(String(tick.price).slice(-1));
      if (!isNaN(lastDigit)) {
        counts[lastDigit]++;
      }
    });

    const total = counts.reduce((a, b) => a + b, 0);
    
    return counts.map((count, i) => ({
      name: String(i),
      value: count,
      probability: total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '0.0%',
    }));
  }, [priceTicks]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
            <BarChartIcon className="h-5 w-5 text-primary" />
            Estatísticas do Último Dígito (Últimos 1000 Ticks)
        </CardTitle>
        <CardDescription>
          Frequência de ocorrência de cada dígito final.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={digitStats} margin={{ top: 20, right: 20, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
            <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="probability" position="top" fill="#666" fontSize={12} />
                 {digitStats.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
