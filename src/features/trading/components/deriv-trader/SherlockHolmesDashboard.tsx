// src/features/trading/components/deriv-trader/SherlockHolmesDashboard.tsx
'use client';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { SherlockAnalysis } from '@/features/trading/hooks/use-robot-council-digits';
import { BrainCircuit } from 'lucide-react';

interface SherlockHolmesDashboardProps {
  analysis: SherlockAnalysis | null;
}

export function SherlockHolmesDashboard({ analysis }: SherlockHolmesDashboardProps) {
  if (!analysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-amber-600" />
            Sherlock Holmes
          </CardTitle>
          <CardDescription>Aguardando dados suficientes (500 ticks) para iniciar a investigação...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { lastDigit, probabilities, recommendedBlock, blockProbability, compensationSteps } = analysis;

  // FIX: Create a sorted copy of the probabilities array.
  const sortedProbabilities = [...probabilities].sort((a, b) => b.probability - a.probability);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-amber-600" />
          Análise de Sherlock Holmes
        </CardTitle>
        <CardDescription className="flex justify-between items-center">
          <span>
            Dado que o último dígito foi <span className="font-bold text-primary">{lastDigit}</span>...
          </span>
          <Badge variant="outline">Compensação: {compensationSteps} tick(s)</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 border rounded-lg bg-background text-center col-span-full md:col-span-2">
                <p className="text-xs font-semibold text-muted-foreground">Recomendação do Sherlock</p>
                <div className="flex items-center justify-center gap-2 mt-1">
                    <Badge variant="default" className="text-lg bg-amber-600">
                        {recommendedBlock}
                    </Badge>
                    <span className="text-xl font-bold text-amber-700">
                        {(blockProbability * 100).toFixed(1)}%
                    </span>
                </div>
            </div>
            {/* FIX: Use the sorted array to show the top 2 most probable digits. */}
            {sortedProbabilities.slice(0, 2).map((prob, index) => (
                <div key={prob.digit} className="p-3 border rounded-lg bg-muted/50 text-center">
                    <p className="text-xs text-muted-foreground">{index === 0 ? 'Mais Provável' : '2º Mais Provável'}</p>
                    <div className="flex items-center justify-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-lg">{prob.digit}</Badge>
                        <span className="text-lg font-bold">
                            {(prob.probability * 100).toFixed(1)}%
                        </span>
                    </div>
                </div>
            ))}
        </div>
        
        <div className="space-y-3 pt-3">
          {/* FIX: Render the full list sorted by probability. */}
          {sortedProbabilities.map(p => (
            <div key={p.digit} className="grid grid-cols-[20px_1fr_50px] items-center gap-3 text-sm">
              <span className="font-mono font-bold text-primary">{p.digit}</span>
              <Progress value={p.probability * 100} className="h-2" />
              <span className="font-mono text-xs text-right text-muted-foreground">
                {(p.probability * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
