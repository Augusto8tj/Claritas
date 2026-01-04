// src/features/trading/components/deriv-trader/DebugCouncilView.tsx
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { CouncilVotes, BayesianVote } from '../../hooks/use-robot-council-v2';
import type { MarketRegime } from '@/lib/types';
import {
  BrainCircuit, Activity, Waves, CandlestickChart, Bot, LayoutGrid, BarChart,
  TrendingUp, Cloud, HelpCircle, CheckCircle, XCircle, Users, Sigma, Gauge, Trophy
} from 'lucide-react';

// ============================================================================
// TIPOS E ÍCONES
// ============================================================================

interface DebugCouncilViewProps {
  votes: CouncilVotes;
  regime: {
    regime: MarketRegime;
    confidence: number;
    probabilities: Record<MarketRegime, number>;
  };
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
  // Mapeamento completo...
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

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export function DebugCouncilView({ votes, regime, isCouncilAutopilotOn }: DebugCouncilViewProps) {

  // 🔥 FIX: Adiciona guarda de segurança para props nulas ou indefinidas
  if (!isCouncilAutopilotOn || !votes || !regime || Object.keys(votes).length === 0) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                    <Gauge className="h-5 w-5 text-primary" />
                    Depuração da Mesa V2.0
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

  const sortedVotes = Object.entries(votes).sort(([, a], [, b]) => {
    const weightA = a.vote === 'HOLD' ? -1 : a.weight;
    const weightB = b.vote === 'HOLD' ? -1 : b.weight;
    if(weightB !== weightA) return weightB - weightA;
    return b.bayesianProbability - a.bayesianProbability;
  });

  const regimeProbabilities = Object.entries(regime.probabilities)
    .map(([key, value]) => ({ regime: key as MarketRegime, probability: value }))
    .sort((a,b) => b.probability - a.probability);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
          <Gauge className="h-5 w-5 text-primary" />
          Depuração da Mesa V2.0: Votos e Análise
        </CardTitle>
        <CardDescription>
          Visão em tempo real da votação de cada robô, ordenada por performance ajustada ao risco (Sharpe Ratio).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        {/* Seção de Análise de Regime */}
        <div>
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

        <div className="border-t pt-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2 text-base">
            <Sigma className="h-5 w-5" />
            Votação Individual dos Robôs
          </h3>
          <ScrollArea className="h-[300px] w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estratégia</TableHead>
                  <TableHead className="text-center">Voto Atual</TableHead>
                  <TableHead className="text-right">Confiança</TableHead>
                  <TableHead className="text-right">Prob. Bayesiana</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedVotes.map(([robotId, voteData]) => (
                  <TableRow key={robotId}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {indicatorIcons[voteData.strategy?.strategyType || 'DEFAULT'] || <Bot className="h-4 w-4" />}
                        <span>{voteData.strategy?.strategyType}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {voteIcons[voteData.vote]}
                        <span className="font-semibold">{voteData.vote}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {voteData.rawConfidence.toFixed(0)}%
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-primary">
                      {voteData.vote !== 'HOLD' ? (voteData.bayesianProbability * 100).toFixed(1) : '0.0'}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
