// src/features/trading/components/hf-trader/champion-signal-card.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Brain, Target, TrendingUp, TrendingDown, Zap, Shield, Bot, Beaker } from 'lucide-react';
import type { StrikeZone } from '@/features/trading/services/hf-strike-logic';
import type { RegimeCharacteristics } from '@/features/trading/ml/market-regime-detector';
import { strategyMetadata, StrategyType } from '@/features/trading/services/hf-strike-logic';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";


interface ChampionSignalCardProps {
  champion: {
    strategy: StrategyType;
    reason: string;
  } | null;
  signal: StrikeZone | null;
  regime: RegimeCharacteristics | null;
  onExecute: () => void;
  isExecuting: boolean;
  isExploratory: boolean;
}

export function ChampionSignalCard({ champion, signal, regime, onExecute, isExecuting, isExploratory }: ChampionSignalCardProps) {
  if (!champion || !regime) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Cérebro Tático
          </CardTitle>
          <CardDescription>Analisando regime de mercado...</CardDescription>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground">
          <p>Aguardando dados para selecionar a estratégia campeã.</p>
        </CardContent>
      </Card>
    );
  }

  const { strategy, reason } = champion;
  const isSignalActive = signal && signal.type !== 'NEUTRAL';
  const isLong = isSignalActive && signal.type === 'LONG_ENTRY';
  const signalLabel = isSignalActive ? strategyMetadata[signal.strategy].label : 'N/A';

  return (
    <Card className={cn(
      'border-2 transition-all',
      isSignalActive && isLong && !isExploratory && 'border-green-500 bg-green-50/50',
      isSignalActive && !isLong && !isExploratory && 'border-red-500 bg-red-50/50',
      isSignalActive && isExploratory && 'border-blue-500 bg-blue-50/50',
    )}>
      <CardHeader>
        <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-2">
                 <Brain className="h-5 w-5"/>
                 Estratégia Campeã
            </CardTitle>
            <Badge>{regime.regime}</Badge>
        </div>
        <CardDescription>
          A IA selecionou a melhor estratégia para as condições atuais do mercado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        
        <div className="p-3 rounded-lg border bg-background">
            <p className="text-xs text-muted-foreground">Especialista Ativo</p>
            <p className="font-bold text-primary">{strategyMetadata[strategy].label}</p>
            <p className="text-xs text-muted-foreground mt-1 italic">{reason}</p>
        </div>

        {isSignalActive ? (
            <>
                <Alert variant={isLong ? 'default' : 'destructive'} className={cn(
                  isLong && "border-green-500/50 bg-green-500/10",
                  isExploratory && "border-blue-500/50 bg-blue-500/10"
                  )}>
                    <Zap className="h-4 w-4" />
                    <AlertTitle className="font-bold flex items-center justify-between">
                        <span className="flex items-center gap-2">
                           {isExploratory && <Beaker className="h-4 w-4 text-blue-600"/>}
                           STRIKE ZONE DETECTADA!
                        </span>
                        <Badge variant="secondary">{signal.confidence.toFixed(0)}% Conf.</Badge>
                    </AlertTitle>
                    <AlertDescription className="mt-2 space-y-2">
                         <p className="text-xs font-semibold">Sinal gerado por: <span className="font-bold text-primary">{signalLabel}</span></p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div><span className="font-semibold">Direção:</span> {isLong ? 'LONG' : 'SHORT'}</div>
                            <div><span className="font-semibold">Entrada:</span> ${signal.entry.price.toFixed(4)}</div>
                            <div className="text-green-600"><span className="font-semibold">Take Profit:</span> ${signal.targets.takeProfit.toFixed(4)}</div>
                            <div className="text-red-600"><span className="font-semibold">Stop Loss:</span> ${signal.targets.stopLoss.toFixed(4)}</div>
                        </div>
                    </AlertDescription>
                </Alert>
                <Button onClick={onExecute} className="w-full" variant={isLong ? 'default' : 'destructive'} disabled={isExecuting}>
                  <Zap className="mr-2 h-4 w-4" />
                  {isExecuting ? 'Executando...' : isExploratory ? 'Executar Trade Exploratório' : 'Executar Strike'}
                </Button>
            </>
        ) : (
             <div className="text-center text-muted-foreground p-4">
                <p>Aguardando sinal da estratégia campeã...</p>
            </div>
        )}
      </CardContent>
    </Card>
  );
}
