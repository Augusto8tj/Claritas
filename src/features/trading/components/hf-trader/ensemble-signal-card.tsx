// src/features/trading/components/hf-trader/ensemble-signal-card.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Brain } from 'lucide-react';
import type { EnsembleSignal } from '../../ensemble/strategy-ensemble';
import type { RegimeCharacteristics } from '../../ml/market-regime-detector';
import { strategyMetadata } from '../../services/hf-strike-logic';
import { cn } from '@/lib/utils';

interface EnsembleSignalCardProps {
  signal: EnsembleSignal | null;
  regime: RegimeCharacteristics | null;
  onExecute: () => void;
  isExecuting: boolean;
}

export function EnsembleSignalCard({ signal, regime, onExecute, isExecuting }: EnsembleSignalCardProps) {
  if (!signal || signal.direction === 'NEUTRAL' || !regime) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>🧠 Ensemble Intelligence</CardTitle>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground">
          <p>Aguardando consenso das estratégias...</p>
          {regime && <Badge className="mt-2">{regime.regime}</Badge>}
        </CardContent>
      </Card>
    );
  }

  const { direction, confidence, participants, reasoning, expectedWinRate, suggestedStake } = signal;
  const isLong = direction === 'LONG';

  return (
    <Card className={cn('border-2', isLong ? 'border-green-500' : 'border-red-500', isLong ? 'bg-green-50' : 'bg-red-50')}>
      <CardHeader>
        <div className="flex justify-between items-center">
            <CardTitle>🧠 Ensemble Intelligence</CardTitle>
            <Badge>{regime.regime}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Alert variant={isLong ? 'default' : 'destructive'}>
          <AlertTitle>
            Sinal: {direction} ({confidence.toFixed(0)}% confiança)
          </AlertTitle>
          <AlertDescription>
            <p>Consenso: {reasoning}</p>
            <p>Win Rate Esperado: {(expectedWinRate * 100).toFixed(1)}%</p>
            <p>Stake Sugerido: ${suggestedStake.toFixed(2)}</p>
          </AlertDescription>
        </Alert>
        
        <div className="mt-4">
          <Label>Votos das Estratégias:</Label>
          <div className="space-y-1 mt-2">
            {participants.map(p => (
              <div key={p.strategy} className="flex justify-between items-center text-xs p-1 bg-background/50 rounded">
                <span>{strategyMetadata[p.strategy]?.label || p.strategy}</span>
                <Badge variant={p.vote === direction ? 'default' : 'secondary'}>
                  {p.vote} (Conf: {p.confidence.toFixed(0)}%, Peso: {(p.weight*100).toFixed(0)}%)
                </Badge>
              </div>
            ))}
          </div>
        </div>
        
        <Button onClick={onExecute} className="w-full mt-4" variant={isLong ? 'default' : 'destructive'} disabled={isExecuting}>
          Executar com Ensemble
        </Button>
      </CardContent>
    </Card>
  );
}
