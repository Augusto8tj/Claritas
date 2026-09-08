// src/features/trading/components/hf-trader/strike-zone-card.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Target, TrendingUp, TrendingDown, Activity, CheckCheck, Zap, ShieldAlert, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StrategyType } from '@/features/trading/services/hf-strike-logic';
import type { StrikeZone } from '@/features/trading/hooks/use-hf-strike-zone';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';


interface StrikeZoneCardProps {
  zone: StrikeZone | null;
  previousZones: StrikeZone[];
  strategy: StrategyType;
  onExecute?: () => void;
  isExecuting?: boolean;
}

export function StrikeZoneCard({ zone, previousZones, strategy, onExecute, isExecuting = false }: StrikeZoneCardProps) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  
  useEffect(() => {
    if (!zone || zone.type === 'NEUTRAL' || !zone.entry.timestamp || zone.duration <= 0) {
      setTimeLeft(null);
      return;
    }
    
    const expiryTime = zone.entry.timestamp + (zone.duration * 1000);
    
    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((expiryTime - now) / 1000));
      setTimeLeft(remaining);
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    
    return () => clearInterval(interval);
  }, [zone]);
  
  const getDurationDisplay = () => {
    if (!zone) return '';
    switch (strategy) {
      case 'MICROSTRUCTURE_SCALP':
        return '5 ticks';
      case 'STD_TREND_FOLLOW':
      case 'VOLUME_ABSORPTION':
        return '3 velas (45m)';
      default:
        return `${zone.duration} segundos`;
    }
  };

  if (!zone || zone.type === 'NEUTRAL') {
    const isVeto = zone?.triggers?.some(t => t.startsWith('VETO'));
    const vetoReason = isVeto ? zone.triggers[0] : null;

    return (
      <Card className="border-2 border-dashed border-muted">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-muted-foreground" />
            Strike Zone Detector
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground py-8">
          {isVeto ? (
             <div className="flex flex-col items-center gap-2 text-amber-600">
                <ShieldAlert className="h-12 w-12 mx-auto opacity-50 mb-2"/>
                <p className="text-sm font-semibold">Guardião Tático Ativo</p>
                <p className="text-xs mt-1">{vetoReason}</p>
             </div>
          ) : (
            <>
                <Activity className="h-12 w-12 mx-auto opacity-20 mb-2 animate-pulse" />
                <p className="text-sm font-semibold">Aguardando Configuração Ideal...</p>
                <p className="text-xs mt-1">Monitorando indicadores em tempo real</p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  const isLong = zone.type === 'LONG_ENTRY';
  const borderColor = isLong ? 'border-green-500' : 'border-red-500';
  const bgColor = isLong ? 'bg-green-50' : 'bg-red-50';

  return (
    <Card className={cn('border-2 animate-pulse-border', borderColor, bgColor)}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Target className={cn('h-5 w-5', isLong ? 'text-green-600' : 'text-red-600')} />
            ⚡ Strike Zone Ativa!
          </span>
          <div className="flex items-center gap-3">
            {timeLeft !== null && (
              <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-full border-2 border-amber-500">
                <Clock className="h-4 w-4 text-amber-600" />
                <span className={cn(
                  "font-mono font-bold text-lg",
                  timeLeft < 10 && "text-red-600 animate-pulse",
                  timeLeft >= 10 && timeLeft < 30 && "text-amber-600",
                  timeLeft >= 30 && "text-green-600"
                )}>
                  {timeLeft}s
                </span>
              </div>
            )}
            <Badge
              className={cn('font-bold text-white', isLong ? 'bg-green-600' : 'bg-red-600')}
            >
              {zone.confidence.toFixed(0)}% Confiança
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert
          className={cn(
            isLong
              ? 'bg-green-100 border-green-300 text-green-900'
              : 'bg-red-100 border-red-300 text-red-900'
          )}
        >
          <AlertTitle className="font-bold flex items-center gap-2">
            {isLong ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
            Sinal: {isLong ? 'COMPRA (CALL/RISE)' : 'VENDA (PUT/FALL)'}
          </AlertTitle>
          <AlertDescription>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div>
                <p className="font-semibold">Entrada:</p>
                <p className="font-mono">${zone.entry.price.toFixed(5)}</p>
              </div>
              <div>
                <p className="font-semibold">Duração:</p>
                <p className="font-mono">{getDurationDisplay()}</p>
              </div>
              <div>
                <p className="font-semibold">Take Profit:</p>
                <p className="font-mono text-green-700">${zone.targets.takeProfit.toFixed(5)}</p>
              </div>
              <div>
                <p className="font-semibold">Stop Loss:</p>
                <p className="font-mono text-red-700">${zone.targets.stopLoss.toFixed(5)}</p>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-current opacity-30">
              <p className="text-xs">
                <strong>Risk/Reward:</strong> 1:{zone.targets.riskReward.toFixed(1)}
              </p>
            </div>
          </AlertDescription>
        </Alert>

        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Triggers Ativados:</p>
          <ul className="text-xs space-y-0.5">
            {zone.triggers.map((trigger, i) => (
              <li key={i} className="flex items-center gap-1">
                <CheckCheck className="h-3 w-3 text-green-600 flex-shrink-0" />
                <span>{trigger}</span>
              </li>
            ))}
          </ul>
        </div>

        <Separator />

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="text-center p-2 border rounded bg-white">
            <p className="text-muted-foreground">RSI</p>
            <p className="font-bold">{zone.indicators.rsi.toFixed(1)}</p>
          </div>
          <div className="text-center p-2 border rounded bg-white">
            <p className="text-muted-foreground">BB Width</p>
            <p className="font-bold">{zone.indicators.bbWidth.toFixed(2)}%</p>
          </div>
          <div className="text-center p-2 border rounded bg-white">
            <p className="text-muted-foreground">Volume</p>
            <p className="font-bold">{zone.indicators.volumeSpike ? '📈' : '─'}</p>
          </div>
        </div>

        {onExecute && (
          <Button
            className="w-full font-bold"
            variant={isLong ? 'default' : 'destructive'}
            onClick={onExecute}
            disabled={isExecuting}
          >
            {isExecuting ? (
              <>
                <Activity className="mr-2 h-4 w-4 animate-spin" />
                Executando...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Executar Strike Zone
              </>
            )}
          </Button>
        )}
        {previousZones.length > 0 && (
            <Accordion type="single" collapsible className="mt-4">
              <AccordionItem value="history">
                <AccordionTrigger className="text-sm text-muted-foreground">
                  📜 Últimas 5 Zonas Detectadas
                </AccordionTrigger>
                <AccordionContent>
                  <ScrollArea className="h-[200px]">
                    {previousZones.slice(0, 5).map((pZone, idx) => (
                      <div key={idx} className="border-b last:border-0 py-2">
                        <div className="flex justify-between items-center">
                          <div>
                            <Badge variant={pZone.type === 'LONG_ENTRY' ? 'default' : 'destructive'} className="text-xs">
                              {pZone.type === 'LONG_ENTRY' ? '📈 LONG' : '📉 SHORT'}
                            </Badge>
                            <span className="text-xs ml-2">{pZone.confidence.toFixed(0)}% conf</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(pZone.entry.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          ${pZone.entry.price.toFixed(5)} → ${pZone.targets.takeProfit.toFixed(5)}
                        </p>
                      </div>
                    ))}
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
      </CardContent>
    </Card>
  );
}
