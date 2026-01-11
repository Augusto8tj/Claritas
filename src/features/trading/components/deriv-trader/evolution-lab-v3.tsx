// src/features/trading/components/deriv-trader/evolution-lab-v3.tsx
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dna, TrendingUp, TrendingDown, Target, Zap, Award, AlertCircle, TestTube, ChevronsRight, Brain, RefreshCw, Bot, Swords, Timer, Skull, Medal, Activity, LayoutGrid, BarChart, Cloud, CandlestickChart, Waves, BrainCircuit, Trash2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { EVOLUTION_CONFIG } from '@/features/trading/config/trader-config';
import { Button } from '@/components/ui/button';
import { EnhancedRobotPerformance as RobotPerformance } from '@/lib/types';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';


// Tipo importado do hook de evolução
interface EvolutionEvent {
  timestamp: Date;
  generation: number;
  totalTrades: number;
  elitePerformers: {
    id: string;
    strategyType: string;
    sharpeRatio: number;
    winRate: number;
    totalProfit: number;
    effectiveRegimes: string[];
  }[];
  mutations: {
    robotId: string;
    robotType: string;
    parentId: string;
    parentType: string;
    diagnosis: string;
    prescription: string;
    expectedImprovement: string;
    mutatedGenes: string[];
  }[];
  populationStats: {
    avgSharpe: number;
    avgWinRate: number;
    totalProfit: number;
    bestRegimes: string[];
  };
}

interface EvolutionLabV3Props {
  history: EvolutionEvent[];
  isEvolving?: boolean;
  evolutionProgress?: number;
  currentGeneration?: number;
  tradesUntilEvolution?: number;
  tradeCounts?: { real: number; virtual: number };
  robotPerformance?: RobotPerformance[];
  evolveTrigger?: (performanceData: RobotPerformance[], tradeType: 'real' | 'virtual', count?: number) => void;
  resetEvolutionHistory?: () => void;
  deleteSingleEvolution?: (timestamp: string) => void;
}

export default function EvolutionLabV3({ 
  history = [], 
  isEvolving = false,
  evolutionProgress = 0,
  currentGeneration = 0,
  tradesUntilEvolution = EVOLUTION_CONFIG.TRIGGER_THRESHOLD,
  tradeCounts = { real: 0, virtual: 0 },
  robotPerformance,
  evolveTrigger,
  resetEvolutionHistory,
  deleteSingleEvolution,
}: EvolutionLabV3Props) {
  
  const latestEvent = history[0];
  
  return (
    <div className="space-y-4">
      {/* Header com Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Dna className="h-5 w-5 text-purple-500" />
                Laboratório de Evolução Genética V3.0
              </CardTitle>
              <CardDescription>
                por que o botão Apagar Histórico está desabilitado?
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-purple-600">Gen {currentGeneration}</div>
               <div className="text-xs text-muted-foreground">
                {tradesUntilEvolution > 0 ? (
                  <span>
                    🔄 {tradesUntilEvolution} trades até evolução ({tradeCounts.real}R + {tradeCounts.virtual}V)
                  </span>
                ) : (
                  <span>✅ Limite atingido</span>
                )}
              </div>
            </div>
          </div>
            {/* DEBUG BUTTONS */}
            <div className="flex gap-2 mt-4">
                 <AlertDialog>
                    <AlertDialogTrigger asChild>
                         <Button 
                            variant="destructive" 
                            size="sm"
                            disabled={!resetEvolutionHistory}
                          >
                            <Trash2 className="mr-2 h-4 w-4"/>
                            Apagar Histórico
                          </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                        <AlertDialogTitle>Tem a certeza absoluta?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta ação irá apagar permanentemente TODO o histórico de evolução genética da sua conta no Firebase. A contagem de gerações será reiniciada para 0.
                        </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={resetEvolutionHistory} className="bg-destructive hover:bg-destructive/90">
                            Sim, apagar tudo
                        </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </CardHeader>
        
        {isEvolving && (
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Evoluindo população...</span>
                <span className="text-muted-foreground">{evolutionProgress}%</span>
              </div>
              <Progress value={evolutionProgress} className="h-2" />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Estatísticas da População Atual */}
      {latestEvent && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Sharpe Médio</p>
                  <p className="text-2xl font-bold">{latestEvent.populationStats.avgSharpe.toFixed(2)}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Win Rate Médio</p>
                  <p className="text-2xl font-bold">{latestEvent.populationStats.avgWinRate.toFixed(1)}%</p>
                </div>
                <Target className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Lucro Total</p>
                  <p className="text-2xl font-bold">${latestEvent.populationStats.totalProfit.toFixed(2)}</p>
                </div>
                <Award className="h-8 w-8 text-yellow-500" />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Trades</p>
                  <p className="text-2xl font-bold">{latestEvent.totalTrades}</p>
                </div>
                <Zap className="h-8 w-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Elite Performers */}
      {latestEvent && latestEvent.elitePerformers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Award className="h-4 w-4 text-yellow-500" />
              Elite Performers (Top 3)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {latestEvent.elitePerformers.map((elite, index) => (
                <div key={elite.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 text-white font-bold text-sm">
                      {index + 1}
                    </div>
                    <div>
                      <div className="font-semibold">{elite.strategyType}</div>
                      <div className="text-xs text-muted-foreground">
                        {elite.effectiveRegimes.length > 0 && (
                          <span>Efetivo em: {elite.effectiveRegimes.join(', ')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        Sharpe: {elite.sharpeRatio.toFixed(2)}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        WR: {elite.winRate.toFixed(0)}%
                      </Badge>
                    </div>
                    <div className={cn("text-sm font-bold", elite.totalProfit >= 0 ? 'text-green-600' : 'text-red-600')}>
                      ${elite.totalProfit.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Histórico de Mutações */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-500" />
            Relatório de Aprendizado ({history.length} gerações)
          </CardTitle>
          <CardDescription>
            Análise de causa-raiz e mutações direcionadas para otimização contínua.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px] pr-4">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <AlertCircle className="h-12 w-12 mb-2" />
                <p className="text-sm">Aguardando primeira geração...</p>
                <p className="text-xs">Mínimo de {EVOLUTION_CONFIG.TRIGGER_THRESHOLD} trades necessários</p>
              </div>
            ) : (
              <div className="space-y-4">
                {history.map((event, eventIndex) => (
                  <div key={eventIndex} className="border-l-2 border-purple-500 pl-4 pb-4">
                    {/* Header da Geração */}
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-semibold text-sm">
                          Geração {event.generation}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(event.timestamp).toLocaleString('pt-BR')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {event.mutations.length} mutações
                          </Badge>
                           <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!deleteSingleEvolution}>
                                        <Trash2 className="h-4 w-4 text-destructive/70" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                    <AlertDialogTitle>Apagar Geração {event.generation}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Esta ação irá apagar permanentemente o registo desta geração. Não pode ser desfeita.
                                    </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteSingleEvolution?.(event.timestamp.toISOString())} className="bg-destructive hover:bg-destructive/90">
                                        Apagar Geração
                                    </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                      </div>
                    </div>

                    {/* Lista de Mutações */}
                    <div className="space-y-3">
                      {event.mutations.map((mutation, mutIndex) => (
                        <Card key={mutIndex} className="bg-background/80 overflow-hidden">
                          <CardHeader className="p-3 bg-muted/30">
                              <div className="flex items-center gap-3 text-sm">
                                <span className="font-mono text-red-600 line-through">{mutation.robotType}</span>
                                <ChevronsRight className="h-4 w-4 text-muted-foreground flex-shrink-0"/>
                                <span className="font-mono font-bold text-green-600">{mutation.parentType} (Clone)</span>
                              </div>
                          </CardHeader>
                          <CardContent className="p-4 space-y-3">
                              {/* Diagnóstico */}
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground mb-1">1. Diagnóstico do Robô Descartado:</p>
                                <Alert variant="destructive" className="py-2 px-3">
                                  <AlertDescription className="text-xs">
                                      {mutation.diagnosis}
                                  </AlertDescription>
                                </Alert>
                              </div>
                              
                              {/* Prescrição */}
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground mb-1">2. Prescrição da IA e Genes Mutados:</p>
                                <Alert className="py-2 px-3 border-blue-500/50 bg-blue-500/10 text-blue-700">
                                  <TestTube className="h-4 w-4 !text-blue-600" />
                                  <AlertTitle className="text-xs !text-blue-800 font-bold">Ação Corretiva: {mutation.prescription}</AlertTitle>
                                  <AlertDescription>
                                     <div className="flex flex-wrap gap-1 mt-2">
                                        {mutation.mutatedGenes.map((gene, geneIndex) => (
                                          <Badge 
                                            key={geneIndex} 
                                            variant="outline" 
                                            className="text-xs font-mono bg-blue-100 dark:bg-blue-950 border-blue-300 dark:border-blue-700"
                                          >
                                            {gene}
                                          </Badge>
                                        ))}
                                      </div>
                                  </AlertDescription>
                                </Alert>
                              </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
