// src/features/trading/components/deriv-trader/evolution-lab-digits.tsx
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dna } from 'lucide-react';
import type { EvolutionEvent } from '@/features/trading/hooks/use-strategy-evolution-digits';

interface EvolutionLabDigitsProps {
  history: EvolutionEvent[];
  activeSymbol: string | null;
}

export function EvolutionLabDigits({ history, activeSymbol }: EvolutionLabDigitsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
            <Dna className="h-5 w-5 text-purple-500" />
            Laboratório de Evolução (Digits)
        </CardTitle>
        <CardDescription>
          Otimização de estratégias com base no desempenho da Arena Virtual.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex h-[200px] items-center justify-center text-muted-foreground text-center p-4 border-2 border-dashed rounded-lg">
          <div className="flex flex-col items-center gap-2">
            <Dna className="h-10 w-10 text-muted-foreground/50"/>
            <div>
              <p className="font-semibold">Evolução Genética é o Próximo Passo</p>
              <p className="text-sm">Após a Arena Virtual coletar dados, este laboratório usará os resultados para evoluir e otimizar as estratégias.</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
