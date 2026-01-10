import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dna, TrendingUp, TrendingDown, Target, Zap, Award, AlertCircle } from 'lucide-react';

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
}

export default function EvolutionLabV3({ 
  history = [], 
  isEvolving = false,
  evolutionProgress = 0,
  currentGeneration = 0,
  tradesUntilEvolution = 5
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
                Sistema inteligente de mutação direcionada por análise de regime
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-purple-600">Gen {currentGeneration}</div>
              <div className="text-xs text-muted-foreground">
                {tradesUntilEvolution > 0 ? (
                  <span>🔄 {tradesUntilEvolution} trades até próxima evolução</span>
                ) : (
                  <span>✅ Limite atingido</span>
                )}
              </div>
            </div>
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
                    <div className={`text-sm font-bold ${elite.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
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
            <Dna className="h-4 w-4 text-purple-500" />
            Histórico de Mutações ({history.length} gerações)
          </CardTitle>
          <CardDescription>
            Mutações direcionadas baseadas em análise de causa-raiz
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px] pr-4">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <AlertCircle className="h-12 w-12 mb-2" />
                <p className="text-sm">Aguardando primeira geração...</p>
                <p className="text-xs">Mínimo de 5 trades necessários</p>
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
                      <Badge variant="secondary" className="text-xs">
                        {event.mutations.length} mutações
                      </Badge>
                    </div>

                    {/* Lista de Mutações */}
                    <div className="space-y-2">
                      {event.mutations.map((mutation, mutIndex) => (
                        <div 
                          key={mutIndex}
                          className="bg-background border rounded-lg p-3 space-y-2"
                        >
                          {/* Substituição */}
                          <div className="flex items-center gap-2 text-sm">
                            <TrendingDown className="h-4 w-4 text-red-500 flex-shrink-0" />
                            <span className="font-mono text-red-600">{mutation.robotType}</span>
                            <span className="text-muted-foreground">→</span>
                            <TrendingUp className="h-4 w-4 text-green-500 flex-shrink-0" />
                            <span className="font-mono text-green-600">{mutation.parentType}</span>
                          </div>

                          {/* Diagnóstico */}
                          <div className="text-xs space-y-1">
                            <div className="flex items-start gap-2">
                              <span className="font-semibold text-muted-foreground min-w-[80px]">Diagnóstico:</span>
                              <span className="text-foreground">{mutation.diagnosis}</span>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="font-semibold text-muted-foreground min-w-[80px]">Causa Raiz:</span>
                              <span className="text-orange-600">{mutation.expectedImprovement}</span>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="font-semibold text-muted-foreground min-w-[80px]">Prescrição:</span>
                              <span className="text-blue-600">{mutation.prescription}</span>
                            </div>
                          </div>

                          {/* Genes Mutados */}
                          <div className="flex flex-wrap gap-1">
                            {mutation.mutatedGenes.map((gene, geneIndex) => (
                              <Badge 
                                key={geneIndex} 
                                variant="outline" 
                                className="text-xs font-mono bg-purple-50 dark:bg-purple-950"
                              >
                                {gene}
                              </Badge>
                            ))}
                          </div>
                        </div>
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
