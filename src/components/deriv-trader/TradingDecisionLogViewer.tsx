// src/components/deriv-trader/TradingDecisionLogViewer.tsx
'use client';

import React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Bot, Archive } from 'lucide-react';
import type { TradeDecisionLog } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TradingDecisionLogViewerProps {
  logs: TradeDecisionLog[];
}

export const TradingDecisionLogViewer: React.FC<TradingDecisionLogViewerProps> = ({
  logs,
}) => {
  const reversedLogs = [...logs].reverse();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Auditoria Cognitiva
        </CardTitle>
        <CardDescription>
          Análise detalhada de cada decisão tomada pelo conselho de robôs nesta sessão.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {reversedLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-8 border rounded-md bg-muted/50">
            <Archive className="h-10 w-10 mb-4" />
            <p className="font-semibold">Nenhuma decisão registada</p>
            <p className="text-xs">Ative a Mesa V2.0 e aguarde a primeira operação para ver os logs de auditoria.</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] w-full pr-4">
            <Accordion type="single" collapsible className="w-full">
              {reversedLogs.map((log, index) => (
                <AccordionItem value={`item-${index}`} key={log.timestamp}>
                  <AccordionTrigger>
                    <div className="flex items-center justify-between w-full text-sm">
                      <div className="flex items-center gap-2">
                        {log.result === 'won' && <CheckCircle className="h-4 w-4 text-green-600" />}
                        {log.result === 'lost' && <XCircle className="h-4 w-4 text-destructive" />}
                        {log.result === 'pending' && <Bot className="h-4 w-4 text-blue-500 animate-pulse" />}
                        <span className="font-semibold">{log.tradeParams.direction}</span>
                        <span className="text-muted-foreground text-xs">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <Badge variant={log.result === 'won' ? 'default' : log.result === 'lost' ? 'destructive' : 'secondary'}
                        className={cn(log.result === 'won' && 'bg-green-600/20 text-green-800 border-green-600/30')}
                      >
                         {log.pnl > 0 ? `+${log.pnl.toFixed(2)}` : log.pnl.toFixed(2)} USD
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 text-xs p-2 bg-muted/50 rounded-md">
                        <p><strong>ID da Decisão:</strong> {log.id}</p>
                        <p><strong>Ativo:</strong> {log.asset} ({log.timePeriod})</p>
                        <p><strong>Regime de Mercado:</strong> {log.context.marketRegime} (Confiança: {(log.context.regimeConfidence * 100).toFixed(1)}%)</p>
                        <p><strong>Probabilidade Bayesiana:</strong> {(log.consensus.bayesianProbability * 100).toFixed(1)}%</p>
                        <p><strong>Stake (Kelly):</strong> ${log.consensus.kellyStake.toFixed(2)}</p>
                        <p className="italic text-muted-foreground">Em breve: Detalhes completos dos votos e indicadores...</p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};
