// src/features/trading/components/deriv-trader/RepetitionTriggerDashboard.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Repeat, CheckCircle, ShieldAlert, XCircle, BarChart2 } from 'lucide-react';
import type { RepetitionSignal, RepetitionStats } from '../../types/repetition-trigger';

interface RepetitionTriggerDashboardProps {
  signal: RepetitionSignal | null;
  stats: RepetitionStats;
  isPaused: boolean;
  pauseReason: string;
}

export function RepetitionTriggerDashboard({ signal, stats, isPaused, pauseReason }: RepetitionTriggerDashboardProps) {
  
  const SignalDisplay = () => {
    if (!signal) {
      return <p className="text-sm text-muted-foreground">Aguardando sequência...</p>;
    }
    const isDiffers = signal.contract === 'DIGITDIFF';
    const colorClass = isDiffers ? 'text-red-600' : 'text-green-600';
    
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Sinal Ativo</h4>
        <div className="flex justify-between items-center p-3 border rounded-lg bg-background">
          <div className="flex flex-col">
            <span className={`font-bold text-lg ${colorClass}`}>
              {signal.contract.replace('DIGIT', '')} {signal.digit}
            </span>
            <span className="text-xs text-muted-foreground">{signal.reason}</span>
          </div>
          <Badge className="font-mono text-base">{(signal.confidence * 100).toFixed(1)}%</Badge>
        </div>
      </div>
    );
  };
  
  const StatsDisplay = () => (
    <div className="grid grid-cols-2 gap-4 text-center">
      <div className="p-2 border rounded-lg">
        <p className="text-xs text-muted-foreground">Trades</p>
        <p className="text-lg font-bold">{stats.totalTrades}</p>
      </div>
      <div className="p-2 border rounded-lg">
        <p className="text-xs text-muted-foreground">Win Rate</p>
        <p className={`text-lg font-bold ${stats.overallWinRate > 0.5 ? 'text-green-600' : 'text-red-600'}`}>
          {(stats.overallWinRate * 100).toFixed(1)}%
        </p>
      </div>
      <div className="p-2 border rounded-lg">
        <p className="text-xs text-muted-foreground">P&L</p>
        <p className={`text-lg font-bold ${stats.profitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          ${stats.profitLoss.toFixed(2)}
        </p>
      </div>
      <div className="p-2 border rounded-lg">
        <p className="text-xs text-muted-foreground">Sequências</p>
        <p className="text-lg font-bold">{stats.totalSequences}</p>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Repeat className="h-5 w-5 text-blue-500" />
          Repetition Trigger
        </CardTitle>
        <CardDescription>Detecta e opera contra sequências de dígitos repetidos.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPaused ? (
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-center text-yellow-700">
            <ShieldAlert className="h-6 w-6 mx-auto mb-2" />
            <p className="font-semibold text-sm">Bot Pausado</p>
            <p className="text-xs">{pauseReason}</p>
          </div>
        ) : (
          <SignalDisplay />
        )}
        <StatsDisplay />
      </CardContent>
    </Card>
  );
}
