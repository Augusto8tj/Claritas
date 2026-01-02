// src/features/financials/components/dashboard/ai-insight-card.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getFinancialInsights } from "@/services/financial-data-service";
import { Lightbulb, Loader2 } from "lucide-react";
import { useAuth } from '@/features/auth/hooks/use-auth';
import { Skeleton } from '@/components/ui/skeleton';

export function AIInsightCard() {
  const { user } = useAuth();
  const [insights, setInsights] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setInsights(["Faça login para ver seus insights."]);
      setLoading(false);
      return;
    }

    const fetchInsights = async () => {
      setLoading(true);
      try {
        const fetchedInsights = await getFinancialInsights(user.uid);
        setInsights(fetchedInsights);
      } catch (error) {
        console.error("Failed to fetch AI insights:", error);
        setInsights(["Não foi possível carregar os insights no momento."]);
      } finally {
        setLoading(false);
      }
    };

    fetchInsights();
  }, [user]);

  return (
    <Card className="col-span-4 bg-primary/5 border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-medium text-primary font-headline">
          O Insight da IA está se atualizando com os dados reais do Claritas
        </CardTitle>
        <Lightbulb className="w-5 h-5 text-primary" />
      </CardHeader>
      <CardContent>
        {loading ? (
           <div className="space-y-2">
             <Skeleton className="h-4 w-full" />
             <Skeleton className="h-4 w-5/6" />
             <Skeleton className="h-4 w-3/4" />
           </div>
        ) : insights.length > 0 ? (
          <ul className="space-y-2 text-sm text-primary/80">
            {insights.map((insight, index) => (
              <li key={index} className="flex items-start gap-2">
                <span className="mt-1.5">&#8226;</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Adicione transações para receber insights personalizados.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
