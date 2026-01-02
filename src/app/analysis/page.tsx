// /src/app/analysis/page.tsx
import { SpendingChart } from "@/components/analysis/spending-chart";
import { TransactionsTable } from "@/components/analysis/transactions-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Lightbulb } from "lucide-react";

export default function AnalysisPage() {
  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Análise de Despesas
        </h1>
      </div>
       <Alert className="bg-primary/5 border-primary/20">
        <Lightbulb className="h-4 w-4 text-primary" />
        <AlertTitle className="text-primary font-headline">Dica</AlertTitle>
        <AlertDescription className="text-primary/90">
          Para adicionar uma nova transação, vá para a página <b>Chat IA Claritas</b> e peça à Claritas, por exemplo: "Adicione uma despesa de R$50 com transporte".
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Detalhamento de Despesas</CardTitle>
          <CardDescription>
            Seus gastos por categoria para o mês atual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SpendingChart />
        </CardContent>
      </Card>
      <TransactionsTable />
    </div>
  );
}
