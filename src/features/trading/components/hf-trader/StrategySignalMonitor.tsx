// src/features/trading/components/hf-trader/StrategySignalMonitor.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Zap, TrendingUp, TrendingDown, HelpCircle, Activity } from 'lucide-react';
import type { StrikeZone } from '@/features/trading/services/hf-strike-logic';
import { strategyMetadata, StrategyType } from '@/features/trading/services/hf-strike-logic';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface StrategySignalMonitorProps {
  signals: (StrikeZone | null)[];
}

const strategyOrder: StrategyType[] = [
  'HF_MEAN_REVERSION',
  'STD_TREND_FOLLOW',
  'BOLLINGER_SQUEEZE',
  'VOLUME_ABSORPTION',
  'MICROSTRUCTURE_SCALP',
];

const SignalBar = ({ signal }: { signal: StrikeZone | null }) => {
  const signalType = signal?.type || 'NEUTRAL';
  const confidence = signal?.confidence || 0;
  
  const barColor = 
    signalType === 'LONG_ENTRY' ? 'bg-green-500' :
    signalType === 'SHORT_ENTRY' ? 'bg-red-500' :
    'bg-muted';
  
  const icon = 
    signalType === 'LONG_ENTRY' ? <TrendingUp className="h-4 w-4 text-green-600" /> :
    signalType === 'SHORT_ENTRY' ? <TrendingDown className="h-4 w-4 text-red-600" /> :
    <HelpCircle className="h-4 w-4 text-muted-foreground" />;

  return (
    <div className="flex items-center gap-3">
      <div className="w-8 text-center">{icon}</div>
      <div className="flex-1">
        <Progress value={confidence} className="h-3" indicatorClassName={cn(barColor, 'transition-all duration-300')} />
      </div>
      <Badge variant="outline" className="w-20 justify-center font-mono text-xs">
        {confidence.toFixed(0)}%
      </Badge>
    </div>
  );
};

export function StrategySignalMonitor({ signals }: StrategySignalMonitorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Monitor de Sinais da Esquadra
        </CardTitle>
        <CardDescription>
          Visualização em tempo real das decisões e confiança de cada estratégia.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {strategyOrder.map((strategyKey) => {
          const signal = signals.find(s => s?.strategy === strategyKey) || null;
          const metadata = strategyMetadata[strategyKey];
          
          return (
            <div key={strategyKey}>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="text-sm font-semibold mb-2">{metadata.label}</div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{metadata.description}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <SignalBar signal={signal} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
