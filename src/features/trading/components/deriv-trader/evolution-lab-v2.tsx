// src/features/trading/components/deriv-trader/evolution-lab-v2.tsx
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dna, TrendingUp, ChevronsRight, Award, Trash2, Loader2, AlertCircle } from 'lucide-react';
import type { EvolutionEvent, TradeCounts } from '@/features/trading/hooks/use-strategy-evolution-v2';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
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

// Carregado do arquivo de configuração para garantir consistência
import { EVOLUTION_CONFIG } from '@/features/trading/config/trader-config';

interface EvolutionLabV2Props {
  evolutionHistory: EvolutionEvent[];
  resetEvolutionHistory?: () => void;
  deleteSingleEvolution?: (timestamp: string) => void;
  currentGeneration?: number;
  tradesUntilEvolution?: number;
  tradeCounts?: TradeCounts;
  evolveTrigger?: () => void; // Para o botão de debug
  isEvolving?: boolean;
  evolutionProgress?: number;
}

export function EvolutionLabV2({ 
    evolutionHistory,
    resetEvolutionHistory, 
    deleteSingleEvolution, 
    currentGeneration = 0,
    tradesUntilEvolution = EVOLUTION_CONFIG.TRIGGER_THRESHOLD,
    tradeCounts = { real: 0, virtual: 0, total: 0 },
    evolveTrigger,
    isEvolving = false,
    evolutionProgress = 0,
}: EvolutionLabV2Props) {
  const history = evolutionHistory || [];
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
                A evolução ocorre a cada {EVOLUTION_CONFIG.TRIGGER_THRESHOLD} trades virtuais ou a cada trade real.
                </CardDescription>
            </div>
            <div className="text-right space-y-2">
                <div className="text-2xl font-bold text-purple-600">Geração {currentGeneration}</div>
                 <div className="text-xs text-muted-foreground">
                    {tradesUntilEvolution > 0 ? (
                    <span>
                        🔄 {tradesUntilEvolution} trades até evolução ({tradeCounts.real}R + {tradeCounts.virtual}V)
                    </span>
                    ) : (
                    <span>✅ Limite atingido</span>
                    )}
                </div>
                 {resetEvolutionHistory && (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="h-7 text-xs">
                                <Trash2 className="mr-1.5 h-3 w-3"/>
                                Resetar Histórico
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
        {isEvolving && (
             <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-purple-600">Evoluindo população...</span>
                <span className="text-muted-foreground">{evolutionProgress}%</span>
              </div>
              <Progress value={evolutionProgress} className="h-2" />
            </div>
        )}
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          {history.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-muted-foreground">
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
                    <h3 className="font-semibold text-primary">Geração {event.generation}</h3>
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
                            <div key={m.robotId} className="flex items-center gap-2 rounded bg-muted/50 p-1.5 px-2">
                                <span className="line-through text-red-500">{m.robotType}</span>
                                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                                <span className="font-semibold text-green-600">{m.parentType}</span>
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
