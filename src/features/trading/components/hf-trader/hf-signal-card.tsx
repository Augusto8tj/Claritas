// src/features/trading/components/hf-trader/hf-signal-card.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Target, Zap, ShieldAlert, Users, Loader2, CheckCheck } from 'lucide-react';
import type { StrikeZone } from '@/features/trading/hooks/use-hf-strike-zone';
import { cn } from '@/lib/utils';


interface HFSignalCardProps {
  signal: StrikeZone | null;
  onExecute: () => void;
  isExecuting: boolean;
  consecutiveLosses: number;
  isCooldown: boolean;
}

export function HFSignalCard({ signal, onExecute, isExecuting, consecutiveLosses, isCooldown }: HFSignalCardProps) {
  if (!signal || signal.type === 'NEUTRAL') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-muted-foreground" />
            Sinal de Consenso
          </CardTitle>
          <CardDescription>Aguardando acordo entre especialistas...</CardDescription>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground py-8">
          <p>Nenhuma oportunidade de alta confiança detectada no momento.</p>
          {consecutiveLosses > 0 && (
            <Badge variant="destructive" className="mt-4">Série de Perdas: {consecutiveLosses}</Badge>
          )}
          {isCooldown && (
             <Badge variant="secondary" className="mt-4 animate-pulse">Em Cooldown...</Badge>
          )}
        </CardContent>
      </Card>
    );
  }

  const isLong = signal.type === 'LONG_ENTRY';

  return (
    <Card className={cn(
      'border-2 transition-all',
      isLong ? 'border-green-500 bg-green-50/50' : 'border-red-500 bg-red-50/50',
    )}>
      <CardHeader>
        <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
                 <Users className="h-5 w-5"/>
                 Sinal de Consenso
            </CardTitle>
            <Badge>{signal.triggers.length} Especialistas</Badge>
        </div>
        <CardDescription>
          Um consenso foi atingido para uma oportunidade de trade.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        
        <Alert variant={isLong ? 'default' : 'destructive'} className={cn(isLong && "border-green-500/50 bg-green-500/10")}>
            <Zap className="h-4 w-4" />
            <AlertTitle className="font-bold flex items-center justify-between">
                <span>STRIKE ZONE DETECTADA!</span>
                <Badge variant="secondary">{signal.confidence.toFixed(0)}% Conf. Média</Badge>
            </AlertTitle>
            <AlertDescription className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="font-semibold">Direção:</span> {isLong ? 'LONG' : 'SHORT'}</div>
                    <div><span className="font-semibold">Duração Ótima:</span> {signal.duration}s</div>
                    <div className="text-green-600"><span className="font-semibold">Take Profit:</span> ${signal.targets.takeProfit.toFixed(4)}</div>
                    <div className="text-red-600"><span className="font-semibold">Stop Loss:</span> ${signal.targets.stopLoss.toFixed(4)}</div>
                </div>
            </AlertDescription>
        </Alert>
        
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Especialistas em Acordo:</p>
          <ul className="text-xs space-y-0.5">
            {signal.triggers.map((trigger, i) => (
              <li key={i} className="flex items-center gap-1">
                <CheckCheck className="h-3 w-3 text-green-600 flex-shrink-0" />
                <span>{trigger}</span>
              </li>
            ))}
          </ul>
        </div>

        <Button onClick={onExecute} className="w-full" variant={isLong ? 'default' : 'destructive'} disabled={isExecuting}>
          {isExecuting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
          {isExecuting ? 'Executando...' : 'Executar Strike de Consenso'}
        </Button>
      </CardContent>
    </Card>
  );
}

    