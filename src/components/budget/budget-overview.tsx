// src/components/budget/budget-overview.tsx
"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getBudgetData } from "@/services/financial-data-service";
import type { BudgetCategory } from "@/lib/types";
import { useAuth } from "@/features/auth/hooks/use-auth";
import {
  Home,
  Utensils,
  Car,
  Ticket,
  ShoppingCart,
  MoreHorizontal,
  LucideIcon,
  Loader2,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditBudgetDialog } from "./edit-budget-dialog";

const categoryIcons: { [key: string]: LucideIcon } = {
  Moradia: Home,
  Alimentação: Utensils,
  Transporte: Car,
  Lazer: Ticket,
  Compras: ShoppingCart,
  Outros: MoreHorizontal,
};

export function BudgetOverview() {
  const { user } = useAuth();
  const [budgetData, setBudgetData] = React.useState<BudgetCategory[]>([]);
  const [loading, setLoading] = React.useState(true);

  const fetchBudgetData = React.useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const data = await getBudgetData(user.uid);
    setBudgetData(data);
    setLoading(false);
  }, [user]);

  React.useEffect(() => {
    fetchBudgetData();
  }, [fetchBudgetData]);

  const handleBudgetUpdated = (updatedCategory: BudgetCategory) => {
    setBudgetData(currentData =>
      currentData.map(cat =>
        cat.name === updatedCategory.name ? updatedCategory : cat
      )
    );
  };

  const getProgressColor = (progress: number) => {
    if (progress > 90) return "bg-destructive";
    if (progress > 75) return "bg-accent";
    return "bg-primary";
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Acompanhamento do Orçamento</CardTitle>
          <CardDescription>
            Veja como seus gastos se comparam aos seus limites.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center items-center p-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Acompanhamento do Orçamento</CardTitle>
        <CardDescription>
          Veja como seus gastos se comparam aos seus limites. Clique no lápis para ajustar um limite.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {budgetData.map((category) => {
            const progress = category.budgeted > 0 ? (category.spent / category.budgeted) * 100 : 0;
            const Icon = categoryIcons[category.name] || MoreHorizontal;
            return (
              <div key={category.name}>
                <div className="flex items-center gap-3 mb-2">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <h3 className="font-medium flex-1">{category.name}</h3>
                  <div className="text-sm text-muted-foreground text-right">
                    <span className="font-semibold text-foreground">
                      R${category.spent.toLocaleString("pt-BR")}
                    </span>{" "}
                    / R${category.budgeted.toLocaleString("pt-BR")}
                  </div>
                   <EditBudgetDialog category={category} onBudgetUpdated={handleBudgetUpdated}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </EditBudgetDialog>
                </div>
                <Progress value={progress} className="h-2" indicatorClassName={getProgressColor(progress)} />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
