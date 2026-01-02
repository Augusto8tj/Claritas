// /src/features/financials/components/dashboard/monthly-balance.tsx
'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { getFinancialSummary } from "@/services/financial-data-service";
import { useEffect, useState, useCallback } from "react";
import { Skeleton } from "@/components/ui/skeleton";

function BalanceSkeleton() {
    return (
         <Card>
            <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent>
                <div className="space-y-2">
                   <Skeleton className="h-4 w-full" />
                   <Skeleton className="h-2 w-full" />
                   <Skeleton className="h-4 w-full" />
                </div>
            </CardContent>
        </Card>
    )
}

export function MonthlyBalance() {
  const { user } = useAuth();
  const [summary, setSummary] = useState({ income: 0, expenses: 0 });
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getFinancialSummary(user.uid);
      setSummary(data);
    } catch (error) {
      console.error("Failed to fetch financial summary:", error);
      // Don't emit error here, as getTransactions will do it.
      // Set to zero to prevent UI crash.
      setSummary({ income: 0, expenses: 0 });
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  if (loading) {
    return <BalanceSkeleton />;
  }

  const { income, expenses } = summary;
  const progress = income > 0 ? (expenses / income) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Balanço Mensal</CardTitle>
        <CardDescription>Sua receita vs. despesas este mês.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium text-muted-foreground">Despesas</span>
            <span className="font-bold">
              R${expenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <Progress value={progress} />
          <div className="flex justify-between text-sm">
            <span className="font-medium text-muted-foreground">Receita</span>
            <span className="font-bold text-green-600">
              R${income.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
