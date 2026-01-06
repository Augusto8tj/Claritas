// src/features/trading/components/deriv-trader/DebugCouncilView.tsx
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { CouncilState, SystemMetrics } from '../../hooks/use-robot-council-v2';
import type { MarketRegime, EnhancedRobotPerformance } from '@/lib/types';
import {
  BrainCircuit, Activity, Waves, CandlestickChart, Bot, LayoutGrid, BarChart,
  TrendingUp, Cloud, HelpCircle, CheckCircle, XCircle, Users, Sigma, Gauge, Trophy, Database, Timer, HardDrive, Brain
} from 'lucide-react';

// ============================================================================
// TIPOS E ÍCONES
// ============================================================================

interface DebugCouncilViewProps {
  councilState: CouncilState;
  isCouncilAutopilotOn: boolean;
}

const indicatorIcons: { [key: string]: React.ReactNode } = {
  RSI: <Trophy className="h-4 w-4 text-amber-500" />,
  STOCHASTIC: <Trophy className="h-4 w-4 text-slate-400" />,
  MACD_CROSS: <Activity className="h-4 w-4" />,
  ADX_TREND: <TrendingUp className="h-4 w-4" />,
  AWESOME_OSCILLATOR: <BarChart className="h-4 w-4" />,
  TRIX: <Activity className="h-4 w-4" />,
  ROC: <Activity className="h-4 w-4" />,
  DEFAULT: <Bot className="h-4 w-4" />
};

const voteIcons: { [key: string]: React.ReactNode } = {
  RISE: <CheckCircle className="h-4 w-4 text-green-500" />,
  FALL: <XCircle className="h-4 w-4 text-red-500" />,
  HOLD: <HelpCircle className="h-4 w-4 text-yellow-500" />,
};

const regimeLabels: Record<MarketRegime, string> = {
  trending_bull: 'Tendência de Alta',
  trending_bear: 'Tendência de Baixa',
  ranging: 'Lateralizado (Ranging)',
  high_volatility: 'Alta Volatilidade',
  breakout: 'Rompimento (Breakout)'
};

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
};


// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export function DebugCouncilView({ councilState, isCouncilAutopilotOn }: DebugCouncilViewProps) {
  
  const { bayesianVotes, currentRegime, systemMetrics, robotPerformance } = councilState || {};

  if (!isCouncilAutopilotOn || !currentRegime || !systemMetrics) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                    <Gauge className="h-5 w-5 text-primary" />
                    Diagnóstico Avançado da Mesa V2.5
                </CardTitle>
                 <CardDescription>
                    Aguardando ativação e o primeiro ciclo de análise...
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="text-center text-muted-foreground p-8">
                    <Bot className="h-10 w-10 mx-auto mb-2"/>
                    <p>Ative a Mesa Operacional para iniciar a depuração.</p>
                </div>
            </CardContent>
        </Card>
    );
  }

  const sortedVotes = bayesianVotes ? Object.entries(bayesianVotes).sort(([, a], [, b]) => {
    const weightA = a.vote === 'HOLD' ? -1 : a.weight;
    const weightB = b.vote === 'HOLD' ? -1 : b.weight;
    if(weightB !== weightA) return weightB - weightA;
    return b.bayesianProbability - a.bayesianProbability;
  }) : [];

  const regimeProbabilities = Object.entries(currentRegime.probabilities)
    .map(([key, value]) => ({ regime: key as MarketRegime, probability: value }))
    .sort((a,b) => b.probability - a.probability);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
          <Gauge className="h-5 w-5 text-primary" />
          Diagnóstico Avançado da Mesa V2.5
        </CardTitle>
        <CardDescription>
          Visão em tempo real da votação, performance e saúde do sistema de IA.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Seção de Métricas do Sistema */}
        <div>
            <h3 className="font-semibold mb-2 flex items-center gap-2 text-base">
                <Brain className="h-5 w-5" />
                Métricas do Sistema
            </h3>
             <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                 <div className="p-2 bg-muted rounded-md text-center">
                    <p className="flex items-center justify-center gap-1 text-muted-foreground"><Timer className="h-3 w-3"/>Sessão</p>
                    <p className="font-bold text-lg">{formatDuration(systemMetrics.sessionDuration)}</p>
                </div>
                <div className="p-2 bg-muted rounded-md text-center">
                    <p className="flex items-center justify-center gap-1 text-muted-foreground"><Database className="h-3 w-3"/>Trades Virtuais</p>
                    <p className="font-bold text-lg">{systemMetrics.activeVirtualTrades} / {systemMetrics.totalVirtualTrades}</p>
                    <p className="text-muted-foreground text-[10px]">(Ativos / Total Sessão)</p>
                </div>
                 <div className="p-2 bg-muted rounded-md text-center">
                    <p className="flex items-center justify-center gap-1 text-muted-foreground"><Users className="h-3 w-3"/>Robôs Ativos</p>
                    <p className="font-bold text-lg">{systemMetrics.activeRobotsCount}/{robotPerformance.length}</p>
                </div>
                 <div className="p-2 bg-muted rounded-md text-center">
                    <p className="flex items-center justify-center gap-1 text-muted-foreground"><Timer className="h-3 w-3"/>Logs de Decisão</p>
                    <p className="font-bold text-lg">{systemMetrics.decisionLogCount}</p>
                </div>
                 <div className="p-2 bg-muted rounded-md text-center">
                    <p className="flex items-center justify-center gap-1 text-muted-foreground"><HardDrive className="h-3 w-3"/>Memória (MB)</p>
                    <p className="font-bold text-lg">{systemMetrics.memoryUsageMB.toFixed(1)}</p>
                </div>
            </div>
        </div>

        {/* Seção de Análise de Regime */}
        <div className="border-t pt-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-base">
            <Users className="h-5 w-5" />
            Análise de Regime (Comités de Analistas)
          </h3>
          <div className="space-y-3 text-sm">
            {regimeProbabilities.map(({ regime, probability }) => (
              <div key={regime}>
                <div className="flex justify-between mb-1">
                  <span>{regimeLabels[regime]}</span>
                  <span className={cn("font-semibold", probability > 0.5 ? "text-primary" : "text-muted-foreground")}>
                    {(probability * 100).toFixed(1)}%
                  </span>
                </div>
                <Progress value={probability * 100} className="h-2" />
              </div>
            ))}
          </div>
        </div>

        <div className="border-t pt-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-base">
            <Sigma className="h-5 w-5" />
            Votação e Performance Individual
          </h3>
          <ScrollArea className="h-[300px] w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estratégia</TableHead>
                  <TableHead className="text-center">Trades (V/D)</TableHead>
                  <TableHead className="text-center">Voto Atual</TableHead>
                  <TableHead className="text-right">Prob. Bayesiana</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedVotes.length > 0 ? (
                  sortedVotes.map(([robotId, voteData], index) => {
                    const perf = robotPerformance.find(p => p.id === robotId);
                    const totalTrades = (perf?.wins || 0) + (perf?.losses || 0);

                    return (
                        <TableRow key={`${robotId}-${index}`}>
                        <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                                {indicatorIcons[voteData.strategy?.strategyType || 'DEFAULT'] || <Bot className="h-4 w-4" />}
                                <div>
                                    <span className="font-bold">{voteData.strategy?.strategyType}</span>
                                    <span className="text-xs text-muted-foreground ml-2">{robotId}</span>
                                </div>
                            </div>
                        </TableCell>
                        <TableCell className="text-center text-xs">
                             <span className="text-green-600 font-medium">{perf?.wins || 0}</span>
                             <span className="text-muted-foreground"> / </span>
                             <span className="text-red-600 font-medium">{perf?.losses || 0}</span>
                        </TableCell>
                        <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1.5">
                            {voteIcons[voteData.vote]}
                            <span className="font-semibold">{voteData.vote}</span>
                            </div>
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-primary">
                            {voteData.vote !== 'HOLD' ? (voteData.bayesianProbability * 100).toFixed(1) : '0.0'}%
                        </TableCell>
                        </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                      Aguardando o primeiro ciclo de votação...
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}