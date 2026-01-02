// src/features/financials/components/dashboard/ai-insight-card.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getFinancialInsights } from "@/services/financial-data-service";
import { Lightbulb } from "lucide-react";
import { auth } from '@/lib/firebase';


export async function AIInsightCard() {
  const user = auth.currentUser;
  // Os insights agora são buscados de forma dinâmica
  const insights = user ? await getFinancialInsights(user.uid) : ["Faça login para ver seus insights."];

  return (
    <Card className="col-span-4 bg-primary/5 border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-medium text-primary font-headline">
          O Insight da IA está se atualizando com os dados reais do Claritas
        </CardTitle>
        <Lightbulb className="w-5 h-5 text-primary" />
      </CardHeader>
      <CardContent>
        {insights.length > 0 ? (
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
