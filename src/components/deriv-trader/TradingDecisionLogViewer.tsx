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
import { CheckCircle, XCircle, Bot, Archive, TrendingUp, TrendingDown, HelpCircle, Brain, Activity, CircleDot, Sigma } from 'lucide-react';
import type { TradeDecisionLog } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Separator } from '../ui/separator';

interface TradingDecisionLogViewerProps {
  logs: TradeDecisionLog[];
}

const getVoteIcon = (vote: string) => {
    switch (vote) {
        case 'RISE': return <TrendingUp className="h-4 w-4 text-green-500" />;
        case 'FALL': return <TrendingDown className="h-4 w-4 text-red-500" />;
        default: return <HelpCircle className="h-4 w-4 text-yellow-500" />;
    }
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
            <Accordion type="single" collapsible className="w-full" defaultValue="item-0">
              {reversedLogs.map((log, index) => (
                <AccordionItem value={`item-${index}`} key={log.id}>
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
                         {log.pnl !== undefined && log.pnl !== null ? `${log.pnl > 0 ? '+' : ''}${log.pnl.toFixed(2)} USD` : 'Pendente'}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 text-xs p-2 bg-muted/50 rounded-md">
                        <div className='grid grid-cols-2 gap-2 text-center'>
                             <div className='p-2 bg-background rounded'>
                                <p className='text-muted-foreground'>Prob. Bayesiana</p>
                                <p className='font-bold text-base text-primary'>{(log.consensus.bayesianProbability * 100).toFixed(1)}%</p>
                            </div>
                             <div className='p-2 bg-background rounded'>
                                <p className='text-muted-foreground'>Regime de Mercado</p>
                                <p className='font-bold text-base'>{log.context.marketRegime}</p>
                            </div>
                        </div>
                        <p><strong>ID da Decisão:</strong> {log.id}</p>
                        <p><strong>Ativo:</strong> {log.asset} ({log.timePeriod})</p>
                        <p><strong>Stake (Kelly):</strong> ${log.consensus.kellyStake.toFixed(2)}</p>
                        <p><strong>Duração:</strong> {log.tradeParams.duration} {log.tradeParams.durationUnit}</p>

                        <Separator />
                        
                        <h4 className='font-semibold flex items-center gap-2'><Brain className='h-4 w-4'/>Análise dos Robôs ({log.consensus.activeRobots} ativos):</h4>
                        <div className="space-y-2">
                             {Object.entries(log.consensus.votes).filter(([, vote]) => vote.vote !== 'HOLD').map(([robotId, voteData]) => (
                                <div key={robotId} className="p-2 rounded bg-background/50 border">
                                    <div className='flex justify-between items-center font-semibold'>
                                        <span className='flex items-center gap-1.5'><CircleDot className='h-3 w-3'/> {robotId.split('_')[0]}</span>
                                        <span className={cn(
                                            voteData.vote === 'RISE' && 'text-green-600',
                                            voteData.vote === 'FALL' && 'text-red-600'
                                        )}>{voteData.vote}</span>
                                    </div>
                                    <p className='text-muted-foreground italic text-[11px] pl-5'>Motivo: {voteData.reason}</p>
                                    <div className='grid grid-cols-3 gap-1 pl-5 text-[11px] mt-1'>
                                        <span>Conf: {(voteData.rawConfidence).toFixed(0)}</span>
                                        <span>Bayes: {(voteData.bayesianProbability * 100).toFixed(0)}%</span>
                                        <span>Peso: {voteData.weight.toFixed(2)}x</span>
                                    </div>
                                </div>
                             ))}
                        </div>
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
