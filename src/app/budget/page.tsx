// /src/app/budget/page.tsx
import { BudgetOverview } from "@/components/budget/budget-overview";

export default function BudgetPage() {
  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Orçamento Mensal
        </h1>
      </div>
      <p className="text-muted-foreground">
        Acompanhe e ajuste seus gastos em relação às metas de orçamento.
      </p>
      <BudgetOverview />
    </div>
  );
}
