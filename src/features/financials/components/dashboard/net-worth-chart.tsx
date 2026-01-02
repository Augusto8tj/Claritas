// src/features/financials/components/dashboard/net-worth-chart.tsx
'use client';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid
} from "recharts";
import type { Transaction } from "@/lib/types";
import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ChartDataPoint {
  name: string;
  netWorth: number;
}

const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function processData(transactions: Transaction[]): ChartDataPoint[] {
  const monthlyData: { [key: string]: { income: number, expenses: number } } = {};

  for (let i = 0; i < 12; i++) {
    const monthKey = `2024-${String(i + 1).padStart(2, '0')}`;
    monthlyData[monthKey] = { income: 0, expenses: 0 };
  }

  transactions.forEach(t => {
    try {
        const monthKey = t.date.substring(0, 7); // YYYY-MM
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { income: 0, expenses: 0 };
        }
        if (t.type === 'income') {
          monthlyData[monthKey].income += t.amount;
        } else {
          monthlyData[monthKey].expenses += t.amount;
        }
    } catch(e) {
        console.warn(`Could not process transaction date: ${t.date}`, e);
    }
  });

  let cumulativeNetWorth = 0;
  return months.map((monthName, index) => {
    const monthKey = `2024-${String(index + 1).padStart(2, '0')}`;
    const monthBalance = (monthlyData[monthKey]?.income || 0) - (monthlyData[monthKey]?.expenses || 0);
    cumulativeNetWorth += monthBalance;
    return {
      name: monthName,
      netWorth: cumulativeNetWorth,
    };
  });
}

// O componente agora recebe as transações como prop para ser mais resiliente
export function NetWorthChart({ transactions }: { transactions: Transaction[] }) {
    const data = useMemo(() => processData(transactions), [transactions]);

    if (!transactions || transactions.length === 0) {
       return (
         <Card className="col-span-4">
            <CardHeader>
                <CardTitle className="font-headline">Patrimônio Líquido</CardTitle>
                <CardDescription>Sua jornada financeira no último ano.</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
                <div className="flex h-[350px] w-full items-center justify-center text-center">
                    <p className="text-muted-foreground">Adicione suas receitas e despesas para ver a evolução do seu patrimônio aqui.</p>
                </div>
            </CardContent>
        </Card>
       )
    }
    
  return (
    <Card className="col-span-4">
        <CardHeader>
            <CardTitle className="font-headline">Patrimônio Líquido</CardTitle>
            <CardDescription>Sua jornada financeira no último ano.</CardDescription>
        </CardHeader>
        <CardContent className="pl-2">
            <ResponsiveContainer width="100%" height={350}>
                <LineChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                    dataKey="name"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    />
                    <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `R$${value / 1000}k`}
                    />
                    <Tooltip
                        formatter={(value: number) => `R$${value.toLocaleString('pt-BR')}`}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                        contentStyle={{
                            backgroundColor: 'hsl(var(--background))',
                            borderColor: 'hsl(var(--border))',
                            borderRadius: 'var(--radius)'
                        }}
                    />
                    <Line
                    type="monotone"
                    dataKey="netWorth"
                    name="Patrimônio Líquido"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "hsl(var(--primary))" }}
                    activeDot={{ r: 6 }}
                    />
                </LineChart>
            </ResponsiveContainer>
         </CardContent>
    </Card>
  );
}
