// src/features/trading/components/hf-trader/StrategySignalMonitor.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Zap, TrendingUp, TrendingDown, HelpCircle, Activity } from 'lucide-react';
import type { StrikeZone } from '@/features/trading/hooks/use-hf-strike-zone';
import { strategyMetadata, StrategyType } from '@/features/trading/services/hf-strike-logic';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { getOptimalDuration } from '../../services/gbm-calibrator';

interface StrategySignalMonitorProps {
  signals: (StrikeZone | null)[];
  counts: Record<StrategyType, number>;
  lastCalibrationTime: number;
}

const strategyOrder: StrategyType[] = [
  'HF_MEAN_REVERSION',
  'STD_TREND_FOLLOW',
  'BOLLINGER_SQUEEZE',
  'VOLUME_ABSORPTION',
  'MICROSTRUCTURE_SCALP',
  'GBM_20S',
  'GBM_40S',
];

const SignalBar = ({ signal, count }: { signal: StrikeZone | null, count: number }) => {
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
      <Badge variant="outline" className="w-24 justify-center font-mono text-xs">
        {confidence > 0 ? `${confidence.toFixed(0)}%` : '---'}
      </Badge>
      <Badge variant="secondary" className="w-16 justify-center font-mono text-xs">
        {count}
      </Badge>
    </div>
  );
};

export function StrategySignalMonitor({ signals, counts, lastCalibrationTime }: StrategySignalMonitorProps) {
  const timeSinceLastCalibration = lastCalibrationTime > 0 ? Math.floor((Date.now() - lastCalibrationTime) / 1000) : null;
  const timeToNextCalibration = timeSinceLastCalibration !== null ? Math.max(0, 300 - timeSinceLastCalibration) : 'N/A';
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Monitor de Sinais da Esquadra
        </CardTitle>
        <CardDescription>
          Visualização da confiança e contagem de ativações de cada especialista.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {strategyOrder.map((strategyKey) => {
          const signal = signals.find(s => s?.strategy === strategyKey) || null;
          const metadata = strategyMetadata[strategyKey];
          const count = counts[strategyKey] || 0;
          const optimalDuration = getOptimalDuration(strategyKey);
          const isGbm = strategyKey.startsWith('GBM');
          
          return (
            <div key={strategyKey}>
              <div className="flex justify-between items-center mb-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="text-sm font-semibold">{metadata.label}</div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{metadata.description}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Badge variant="outline">⏱ {optimalDuration}s</Badge>
              </div>
              <SignalBar signal={signal} count={count} />
              {isGbm && signal?.gbmParams && (
                <div className="text-xs text-muted-foreground mt-1 pl-11 flex items-center gap-3">
                  <span>
                    Drift: <span className="font-mono">{(signal.gbmParams.drift * 100).toFixed(4)}%/s</span>
                  </span>
                  <span>
                    σ: <span className="font-mono">{(signal.gbmParams.volatility * 100).toFixed(3)}%</span>
                  </span>
                  <span>
                    P(up): <span className="font-mono">{(signal.gbmParams.probUp * 100).toFixed(1)}%</span>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
       <CardFooter className="text-xs text-muted-foreground justify-center pt-4">
          Última calibração: {lastCalibrationTime > 0 ? new Date(lastCalibrationTime).toLocaleTimeString() : 'Aguardando'}
          {timeToNextCalibration !== 'N/A' && ` | Próxima em: ${timeToNextCalibration}s`}
      </CardFooter>
    </Card>
  );
}
