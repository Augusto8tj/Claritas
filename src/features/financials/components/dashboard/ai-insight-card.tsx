// /src/features/financials/components/dashboard/ai-insight-card.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getFinancialInsights } from "@/services/financial-data-service";
import { Lightbulb, Loader2, Wand2 } from "lucide-react";
import { useAuth } from '@/features/auth/hooks/use-auth';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

export function AIInsightCard() {
  const { user } = useAuth();
  const [insights, setInsights] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInsights = async () => {
    if (!user) {
      setError("Utilizador não autenticado.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const fetchedInsights = await getFinancialInsights(user.uid);
      setInsights(fetchedInsights);
    } catch (error: any) {
      console.error("Failed to fetch AI insights:", error);
      setError(error.message || "Não foi possível carregar os insights.");
      setInsights([]);
    } finally {
      setLoading(false);
    }
  };
  
  const renderContent = () => {
    if (loading) {
      return (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      );
    }

    if (error) {
      return <p className="text-sm text-destructive">{error}</p>;
    }
    
    if (insights.length > 0) {
      return (
        <ul className="space-y-2 text-sm text-primary/80">
          {insights.map((insight, index) => (
            <li key={index} className="flex items-start gap-2">
              <span className="mt-1.5">&#8226;</span>
              <span>{insight}</span>
            </li>
          ))}
        </ul>
      );
    }
    
    return (
      <p className="text-sm text-muted-foreground">
        Clique no botão abaixo para gerar insights financeiros personalizados com base nos seus dados.
      </p>
    );
  };

  return (
    <Card className="col-span-4 bg-primary/5 border-primary/20">
      <CardHeader className="pb-2">
          <div className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-medium text-primary font-headline">
              Copiloto de IA
            </CardTitle>
            <Lightbulb className="w-5 h-5 text-primary" />
          </div>
          <CardDescription className="text-primary/90 !mt-2">
            Obtenha sugestões personalizadas da Claritas para otimizar suas finanças.
          </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="min-h-[6rem] rounded-md border border-dashed border-primary/20 bg-background/50 p-4">
            {renderContent()}
        </div>
        <Button onClick={fetchInsights} disabled={loading} className="w-full">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Wand2 className="mr-2 h-4 w-4"/>}
            {loading ? "A Pensar..." : "Gerar Insight com IA"}
        </Button>
      </CardContent>
    </Card>
  );
}
