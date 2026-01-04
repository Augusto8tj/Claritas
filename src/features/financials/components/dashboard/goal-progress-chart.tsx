// /src/features/financials/components/dashboard/goal-progress-chart.tsx
"use client";

import type { Goal } from "@/lib/types";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Label, Pie, PieChart, Cell } from "recharts";

const chartConfig = {
  progress: {
    label: "Progresso",
    color: "hsl(var(--accent))",
  },
  remaining: {
    label: "Restante",
    color: "hsl(var(--muted))",
  },
};

interface GoalProgressChartProps {
  goal: Goal;
}

export function GoalProgressChart({ goal }: GoalProgressChartProps) {
  const progress = (goal.currentAmount / goal.targetAmount) * 100;
  const chartData = [
    { name: "progress", value: progress, fill: "var(--color-progress)" },
    {
      name: "remaining",
      value: 100 - progress,
      fill: "var(--color-remaining)",
    },
  ];

  return (
    <ChartContainer
      config={chartConfig}
      className="mx-auto aspect-square h-[150px]"
    >
      <PieChart>
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          innerRadius={50}
          outerRadius={70}
          startAngle={90}
          endAngle={450}
          cornerRadius={50}
        >
          {chartData.map((entry) => (
            <Cell key={`cell-${entry.name}`} fill={entry.fill} />
          ))}
          <Label
            content={({ viewBox }) => {
              if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                return (
                  <text
                    x={viewBox.cx}
                    y={viewBox.cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    <tspan
                      x={viewBox.cx}
                      y={viewBox.cy}
                      className="fill-foreground text-3xl font-bold"
                    >
                      {progress.toFixed(0)}%
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
