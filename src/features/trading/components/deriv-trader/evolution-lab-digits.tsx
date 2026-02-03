// src/features/trading/components/deriv-trader/evolution-lab-digits.tsx
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
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
          A evolução para contratos de dígitos ainda não foi implementada.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex h-[400px] items-center justify-center text-muted-foreground">
          Em desenvolvimento...
        </div>
      </CardContent>
    </Card>
  );
}
