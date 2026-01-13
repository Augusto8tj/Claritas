// src/features/trading/components/deriv-trader/evolution-lab-v2.tsx
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dna, TrendingUp, ChevronsRight, Award } from 'lucide-react';
import type { EvolutionEvent } from '@/features/trading/hooks/use-strategy-evolution-v2';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

interface EvolutionLabV2Props {
  history: EvolutionEvent[];
  resetEvolutionHistory?: () => void;
  deleteSingleEvolution?: (timestamp: string) => void;
  currentGeneration?: number;
}

export function EvolutionLabV2({ history, resetEvolutionHistory, deleteSingleEvolution, currentGeneration = 0 }: EvolutionLabV2Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
            <div>
                <CardTitle className="font-headline flex items-center gap-2">
                    <Dna className="h-5 w-5 text-purple-500" />
                    Laboratório de Evolução V2.5
                </CardTitle>
                <CardDescription>
                Histórico de mutações genéticas do conselho de robôs. A evolução ocorre a cada 50 trades.
                </CardDescription>
            </div>
             <div className="text-right">
                <div className="text-2xl font-bold text-purple-600">Geração {currentGeneration}</div>
                 {resetEvolutionHistory && (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" className="mt-2">
                                <Trash2 className="mr-2 h-4 w-4"/>
                                Limpar Histórico
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                            <AlertDialogTitle>Tem a certeza absoluta?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Esta ação irá apagar permanentemente TODO o histórico de evolução (V2.5) da sua conta.
                            </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={resetEvolutionHistory} className="bg-destructive hover:bg-destructive/90">
                                Sim, apagar
                            </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                 )}
            </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          {history.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-center">
                 <div className="flex flex-col items-center gap-2">
                    <AlertCircle className="h-10 w-10 text-muted-foreground/50"/>
                    <span>Aguardando o primeiro ciclo de evolução...</span>
                </div>
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
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Award className="h-4 w-4 text-amber-500"/>Robôs de Elite</h4>
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
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><ChevronsRight className="h-4 w-4 text-purple-500"/>Mutações Realizadas</h4>
                     <div className="space-y-2 text-xs">
                        {event.mutations.map(m => (
                            <div key={m.replacedBotId} className="flex items-center gap-2 rounded bg-muted/50 p-1.5 px-2">
                                <span className="line-through text-red-500">{m.replacedBotType}</span>
                                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                                <span className="font-semibold text-green-600">{m.parentBotType}</span>
                                <Badge variant="outline" className="ml-auto">{m.analysis}</Badge>
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
