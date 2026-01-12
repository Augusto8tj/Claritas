// src/features/trading/components/deriv-trader/evolution-lab.tsx
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dna, TrendingUp, TrendingDown, ChevronsRight, Award } from 'lucide-react';
import type { EvolutionEvent } from '@/features/trading/hooks/use-strategy-evolution-v1';

interface EvolutionLabProps {
  history: EvolutionEvent[];
}

export function EvolutionLab({ history }: EvolutionLabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
            <Dna className="h-5 w-5 text-purple-500" />
            Laboratório de Evolução V1
        </CardTitle>
        <CardDescription>
          Histórico de mutações genéticas do conselho de robôs a cada 50 trades.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          {history.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Aguardando o primeiro ciclo de evolução...
            </div>
          ) : (
            <div className="space-y-6">
              {history.map((event, index) => (
                <div key={index} className="space-y-4 rounded-lg border p-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-primary">Geração {history.length - index}</h3>
                    <span className="text-xs text-muted-foreground">
                      {event.timestamp.toLocaleString('pt-BR')}
                    </span>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Award className="h-4 w-4 text-amber-500"/>Elite Performers</h4>
                    <div className="space-y-1 text-xs">
                      {event.elitePerformers.map(p => (
                        <div key={p.id} className="flex justify-between items-center rounded bg-muted/50 p-1.5 px-2">
                          <span>{p.strategyType}</span>
                          <span className="font-mono text-green-600">${p.totalProfit.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><ChevronsRight className="h-4 w-4 text-purple-500"/>Mutações</h4>
                     <div className="space-y-2 text-xs">
                        {event.mutations.map(m => (
                            <div key={m.replacedBotId} className="flex items-center gap-2 rounded bg-muted/50 p-1.5 px-2">
                                <span className="line-through text-red-500">{m.replacedBotType}</span>
                                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                                <span className="font-semibold text-green-600">{m.parentBotType}</span>
                            </div>
                        ))}
                     </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
