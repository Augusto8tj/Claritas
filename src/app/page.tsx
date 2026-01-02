// /src/app/page.tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AIInsightCard } from "@/features/financials/components/dashboard/ai-insight-card";
import { NetWorthChart } from "@/features/financials/components/dashboard/net-worth-chart";
import { MonthlyBalance } from "@/features/financials/components/dashboard/monthly-balance";
import { UpcomingBills } from "@/features/financials/components/dashboard/upcoming-bills";
import { MainGoal } from "@/features/financials/components/dashboard/main-goal";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getFinancialSummary, getTransactions } from "@/services/financial-data-service";
import { auth } from "@/lib/firebase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Lightbulb, Sparkles } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const revalidate = 0; // Force dynamic rendering

// --- Skeletons for Loading State ---

function MainGoalSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </CardHeader>
      <CardContent className="flex items-center justify-center p-6">
        <Skeleton className="h-36 w-36 rounded-full" />
      </CardContent>
    </Card>
  )
}

function ChartSkeleton() {
    return (
        <Card className="col-span-4">
            <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent className="pl-2">
                <Skeleton className="h-[350px] w-full" />
            </CardContent>
        </Card>
    )
}

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

// --- Guia para Novos Utilizadores ---

function FirstTransactionGuide() {
  return (
    <Alert className="bg-primary/5 border-primary/20 col-span-1 md:col-span-2 lg:col-span-4">
      <Lightbulb className="h-4 w-4 text-primary" />
      <AlertTitle className="text-primary font-headline">Bem-vindo ao Claritas Copilot!</AlertTitle>
      <AlertDescription className="text-primary/90 space-y-2">
        <p>
          O seu painel parece vazio. Para começar, adicione suas receitas e despesas conversando com a nossa IA.
        </p>
        <p>
          Vá para a página <b>Chat IA Claritas</b> e diga, por exemplo: <b>"Adicionar uma despesa de R$80 com jantar"</b> ou <b>"Recebi meu salário de R$5000"</b>.
        </p>
        <div className="pt-2">
          <Button asChild variant="outline" className="bg-transparent text-primary border-primary/50 hover:bg-primary/10 hover:text-primary">
            <Link href="/chat-insights">
              <Sparkles className="mr-2 h-4 w-4" />
              Ir para o Chat IA
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

export default async function DashboardPage() {
  const userId = auth.currentUser?.uid;
  let summary = { income: 0, expenses: 0 };
  let transactions = [];
  
  if (userId) {
      try {
        [summary, transactions] = await Promise.all([
          getFinancialSummary(userId),
          getTransactions(userId)
        ]);
      } catch (e) {
        console.error("Failed to fetch dashboard data on server:", e);
        // Resiliente: Se falhar, os valores padrão (zero/vazio) serão usados.
      }
  }

  const hasTransactions = transactions.length > 0;

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Painel
        </h1>
      </div>
      
      {!hasTransactions && <FirstTransactionGuide />}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Suspense fallback={<Skeleton className="h-36 w-full col-span-4" />}>
           <AIInsightCard />
        </Suspense>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Suspense fallback={<ChartSkeleton/>}>
            <NetWorthChart transactions={transactions} />
        </Suspense>
        <div className="col-span-4 lg:col-span-3 space-y-4">
          <Suspense fallback={<BalanceSkeleton />}>
            <MonthlyBalance income={summary.income} expenses={summary.expenses} />
          </Suspense>
          <Suspense fallback={<MainGoalSkeleton />}>
            <MainGoal />
          </Suspense>
        </div>
      </div>
       <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <UpcomingBills transactions={transactions} />
       </Suspense>
    </div>
  );
}
