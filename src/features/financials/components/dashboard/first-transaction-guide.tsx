// /src/features/financials/components/dashboard/first-transaction-guide.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lightbulb, Sparkles } from "lucide-react";
import { getTransactions } from "@/services/financial-data-service";
import { useAuth } from "@/features/auth/hooks/use-auth";

export function FirstTransactionGuide() {
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
                const transactions = await getTransactions(user!.uid);
                if (isMounted) {
                    setHasTransactions(transactions.length > 0);
                }
            } catch (e) {
                console.error("FirstTransactionGuide: Falha ao buscar transações, o guia pode não ser exibido.", e);
                if (isMounted) {
                    // Assumimos que tem transações para não mostrar o guia em caso de erro, evitando uma má experiência.
                    setHasTransactions(true); 
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
                    Vá para a página <b>Chat Claritas</b> e diga, por exemplo: <b>"Adicionar uma despesa de R$80 com jantar"</b> ou <b>"Recebi meu salário de R$5000"</b>.
                </p>
                <Button asChild variant="outline" className="bg-transparent text-primary border-primary/50 hover:bg-primary/10 hover:text-primary">
                    <Link href="/chat-insights">
                        <Sparkles className="mr-2 h-4 w-4" />
                        Ir para o Chat Claritas
                    </Link>
                </Button>
            </CardContent>
        </Card>
    );
}
