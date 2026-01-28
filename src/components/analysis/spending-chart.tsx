// /src/components/analysis/spending-chart.tsx
"use client";

import * as React from "react";
import { Label, Pie, PieChart, Cell } from "recharts";
import { getTransactions, getExpenseCategories } from "@/services/financial-data-service";
import type { Transaction } from "@/lib/types";
import { useAuth } from "@/features/auth/hooks/use-auth";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { FirestorePermissionError, errorEmitter } from "@/firebase";
import { useToast } from "@/hooks/use-toast";

const chartConfig = {
  amount: {
    label: "Valor",
  },
  Moradia: { label: "Moradia", color: "hsl(var(--chart-1))" },
  Alimentação: { label: "Alimentação", color: "hsl(var(--chart-2))" },
  Transporte: { label: "Transporte", color: "hsl(var(--chart-3))" },
  Lazer: { label: "Lazer", color: "hsl(var(--chart-4))" },
  Compras: { label: "Compras", color: "hsl(var(--chart-5))" },
  Outros: { label: "Outros", color: "hsl(var(--muted))" },
  Contas: { label: "Contas", color: "hsl(var(--chart-3))" }
};

type ChartConfigKey = keyof typeof chartConfig;

export function SpendingChart() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [chartData, setChartData] = React.useState<any[]>([]);
  const [totalAmount, setTotalAmount] = React.useState(0);

  React.useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      try {
        const [transactions, categories] = await Promise.all([
          getTransactions(user.uid),
          getExpenseCategories(user.uid)
        ]);
        
        const expenses = transactions.filter(t => t.type === 'expense');
        const total = expenses.reduce((acc, curr) => acc + curr.amount, 0);
        setTotalAmount(total);

        const dataByCategory = categories.map(category => {
          const amount = expenses
            .filter(t => t.category === category)
            .reduce((acc, curr) => acc + curr.amount, 0);
          const colorKey = category as ChartConfigKey;
          // Fallback para a cor de 'Outros' se a categoria não estiver no chartConfig
          const configEntry = chartConfig[colorKey] || chartConfig.Outros;
          return {
            category,
            amount,
            fill: configEntry.color,
          };
        }).filter(item => item.amount > 0);

        setChartData(dataByCategory);
      } catch (err) {
        console.error("Error fetching spending chart data:", err);
        toast({
            title: "Erro ao Carregar Gráfico",
            description: "Não foi possível buscar os dados de despesas.",
            variant: "destructive"
        });
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `users/${user.uid}/transactions`,
            operation: 'list'
        }));
      }
    };

    fetchData();
  }, [user, toast]);

  if (chartData.length === 0) {
    return (
        <div className="flex h-[300px] w-full items-center justify-center">
            <p className="text-muted-foreground">Nenhuma despesa registrada para exibir no gráfico.</p>
        </div>
    )
  }

  return (
      <ChartContainer
        config={chartConfig as any}
        className="mx-auto aspect-square h-[300px]"
      >
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel />}
          />
          <Pie
            data={chartData}
            dataKey="amount"
            nameKey="category"
            innerRadius={80}
            strokeWidth={5}
          >
            {chartData.map((entry) => (
                <Cell key={`cell-${entry.category}`} fill={entry.fill} />
            ))}
            <Label
              content={({ viewBox }) => {
                if (viewBox && "cx" in viewBox && "cy" in viewBox && viewBox.cx !== undefined && viewBox.cy !== undefined) {
                  return (
                    <text
                      x={viewBox.cx}
                      y={viewBox.cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy || 0) - 12}
                        className="fill-muted-foreground text-sm"
                      >
                        Gasto Total
                      </tspan>
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy || 0) + 12}
                        className="fill-foreground text-2xl font-bold"
                      >
                        R${totalAmount.toLocaleString('pt-BR')}
                      </tspan>
                    </text>
                  );
                }
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
  );
}
