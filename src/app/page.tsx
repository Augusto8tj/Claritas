// /src/app/page.tsx
"use client";

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
import { Suspense, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb, Sparkles } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getTransactions } from "@/services/financial-data-service";
import { useAuth } from "@/features/auth/hooks/use-auth";

function FirstTransactionGuide() {
    const { user } = useAuth();
    const [hasTransactions, setHasTransactions] = useState<boolean | null>(null);

    useEffect(() => {
        if (!user) {
            setHasTransactions(false);
            return;
        }

        let isMounted = true;

        async function checkTransactions() {
            try {
                const transactions = await getTransactions(user.uid);
                if (isMounted) {
                    setHasTransactions(transactions.length > 0);
                }
            } catch (e) {
                console.error("FirstTransactionGuide: Falha ao buscar transações, o guia pode não ser exibido.", e);
                if (isMounted) {
                    setHasTransactions(true); // Assumimos que tem transações para não mostrar o guia em caso de erro.
                }
            }
        }

        checkTransactions();

        return () => {
            isMounted = false;
        };
    }, [user]);

    if (hasTransactions === null || hasTransactions === true) {
        return null;
    }

    return (
        <Card className="col-span-1 md:col-span-2 lg:col-span-4 bg-primary/5 border-primary/20">
            <CardHeader className="flex flex-row items-center gap-4">
                <Lightbulb className="h-6 w-6 text-primary" />
                <div>
                    <CardTitle className="text-primary font-headline">Bem-vindo ao Claritas Copilot!</CardTitle>
                    <CardDescription className="text-primary/90">
                        Para começar, adicione suas receitas e despesas conversando com a nossa IA.
                    </CardDescription>
                </div>
            </CardHeader>
            <CardContent>
                <p className="text-sm mb-4">
                    Vá para a página <b>Chat IA Claritas</b> e diga, por exemplo: <b>"Adicionar uma despesa de R$80 com jantar"</b> ou <b>"Recebi meu salário de R$5000"</b>.
                </p>
                <Button asChild variant="outline" className="bg-transparent text-primary border-primary/50 hover:bg-primary/10 hover:text-primary">
                    <Link href="/chat-insights">
                        <Sparkles className="mr-2 h-4 w-4" />
                        Ir para o Chat IA
                    </Link>
                </Button>
            </CardContent>
        </Card>
    )
}

export default function DashboardPage() {
  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Painel
        </h1>
      </div>
      
      <Suspense fallback={null}>
         <FirstTransactionGuide />
      </Suspense>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Suspense fallback={<Skeleton className="h-36 w-full col-span-4" />}>
           <AIInsightCard />
        </Suspense>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Suspense fallback={
            <Card className="col-span-4">
                <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent className="pl-2">
                    <Skeleton className="h-[350px] w-full" />
                </CardContent>
            </Card>
        }>
            <NetWorthChart />
        </Suspense>
        <div className="col-span-4 lg:col-span-3 space-y-4">
          <Suspense fallback={
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
          }>
            <MonthlyBalance />
          </Suspense>
          <Suspense fallback={
             <Card>
                <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                </CardHeader>
                <CardContent className="flex items-center justify-center p-6">
                    <Skeleton className="h-36 w-36 rounded-full" />
                </CardContent>
            </Card>
          }>
            <MainGoal />
          </Suspense>
        </div>
      </div>
       <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <UpcomingBills />
       </Suspense>
    </div>
  );
}
