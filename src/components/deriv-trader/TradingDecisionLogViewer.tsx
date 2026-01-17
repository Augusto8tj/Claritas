// /src/components/deriv-trader/TradingDecisionLogViewer.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import type { TradeDecisionLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Bot, Archive, Filter, Trash2, Loader2, TrendingUp, TrendingDown, Brain, Shield, Target, Trophy, CircleDot, FilePieChart, Sigma, HelpCircle as HoldIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-picker-with-range';
import type { DateRange } from 'react-day-picker';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from '@/features/auth/hooks/use-auth';

function AuditLogSkeleton() {
    return (
        <Card>
            <CardHeader>
                <Skeleton className="h-8 w-1/3" />
                <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </CardContent>
        </Card>
    );
}

function renderStrategyParams(strategy: any): string {
    if (!strategy) return 'N/A';
    switch (strategy.strategyType) {
        case 'RSI':
        case 'STOCHASTIC':
        case 'MFI':
        case 'RVI':
            return `L:${strategy.period} | S:${strategy.strongBuyThreshold}/${strategy.strongSellThreshold}`;
        case 'MOVING_AVERAGE_CROSS':
            return `S:${strategy.shortPeriod} | L:${strategy.longPeriod}`;
        case 'BOLLINGER_BANDS':
            return `P:${strategy.period} | SD:${strategy.stdDev}`;
        case 'MACD_CROSS':
            return `${strategy.fastPeriod}/${strategy.slowPeriod}/${strategy.signalPeriod}`;
        case 'ADX_TREND':
            return `P:${strategy.period} | L:${strategy.trendStrengthThreshold}`;
        default:
            return strategy.period ? `P:${strategy.period}` : 'Parâmetros Padrão';
    }
}

interface TradingDecisionLogViewerProps {
    logs: TradeDecisionLog[];
    onDeleteLog?: (logId: string) => void;
    deletingLogId?: string | null;
    showFilters?: boolean;
}

export default function TradingDecisionLogViewer({
  logs = [],
  onDeleteLog,
  deletingLogId,
  showFilters = true
}: TradingDecisionLogViewerProps) {
  const { toast } = useToast();

   const handleReportClick = () => {
    if (logs.length === 0) {
        toast({
            title: "Nenhum Dado para Exportar",
            description: "Não há logs de decisão para gerar um relatório."
        });
        return;
    }

    const headers = [
        "ID", "Timestamp", "Asset", "Time Period", "Direction", "Stake", "Duration", 
        "Duration Unit", "Result", "PnL", "Entry Price", "Exit Price", "Payout",
        "Market Regime", "Regime Confidence", "Supervision Reason",
        "Bayesian Probability / Consensus Sum Rise", "Kelly Stake / Consensus Sum Fall", "Active Robots",
    ];
    
    const rows = logs.map(log => [
        log.id,
        log.timestamp,
        log.asset,
        log.timePeriod,
        log.tradeParams.direction,
        log.tradeParams.stake.toFixed(2),
        log.tradeParams.duration,
        log.tradeParams.durationUnit,
        log.result,
        log.pnl?.toFixed(2) || '0.00',
        log.context.entryPrice?.toFixed(4) || 'N/A',
        log.context.exitPrice?.toFixed(4) || 'N/A',
        log.context.payout?.toFixed(2) || 'N/A',
        log.context.marketRegime, 
        log.context.regimeConfidence?.toFixed(4) || 'N/A',
        `"${log.context.supervisionReason?.replace(/"/g, '""') || 'N/A'}"`,
        log.consensus.bayesianProbability?.toFixed(4) || log.consensus.consensusSum?.rise.toFixed(2) || 'N/A',
        log.consensus.kellyStake?.toFixed(2) || log.consensus.consensusSum?.fall.toFixed(2) || 'N/A',
        log.consensus.activeRobots,
    ].join(',')).join('\n');

    const csvContent = `${headers.join(',')}\n${rows}`;
    
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "relatorio_auditoria_cognitiva.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
        title: "Relatório Gerado",
        description: "O download do ficheiro CSV foi iniciado."
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
            <div className="flex-1">
                <CardTitle className="font-headline flex items-center gap-2">
                    <Bot className="h-5 w-5 text-primary" />
                    Auditoria Cognitiva ({logs.length} Registos)
                </CardTitle>
                <CardDescription>
                  Análise detalhada de cada decisão tomada pelo conselho de robôs.
                </CardDescription>
            </div>
            {logs.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleReportClick}>
                    <FilePieChart className="mr-2 h-4 w-4"/>
                    Gerar Relatório CSV
                </Button>
            )}
        </div>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-8 border rounded-md bg-muted/50">
            <Archive className="h-10 w-10 mb-4" />
            <p className="font-semibold">Nenhum registo de decisão encontrado</p>
            <p className="text-xs">{showFilters ? "Ajuste os filtros ou aguarde novas operações." : "Aguardando operações para ver os logs de auditoria."}</p>
          </div>
        ) : (
            <Accordion type="single" collapsible className="w-full" defaultValue="item-0">
              {logs.map((log, index) => {
                const isV1 = log.consensus.consensusSum !== undefined;
                return (
                <AccordionItem value={`item-${index}`} key={log.id}>
                  <div className="flex items-center group">
                      <AccordionTrigger className="flex-1">
                        <div className="flex items-center justify-between w-full text-sm">
                          <div className="flex items-center gap-2">
                            {log.result === 'won' && <CheckCircle className="h-4 w-4 text-green-600" />}
                            {log.result === 'lost' && <XCircle className="h-4 w-4 text-destructive" />}
                            {log.result === 'pending' && <Bot className="h-4 w-4 text-blue-500 animate-pulse" />}
                            {log.result === 'hold' && <HoldIcon className="h-4 w-4 text-yellow-500" />}
                            <span className="font-semibold">{log.tradeParams.direction}</span>
                            <span className="text-muted-foreground text-xs">{new Date(log.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <Badge variant={log.result === 'won' ? 'default' : log.result === 'lost' ? 'destructive' : log.result === 'hold' ? 'outline' : 'secondary'}
                            className={cn(
                                log.result === 'won' && 'bg-green-600/20 text-green-800 border-green-600/30',
                                log.result === 'hold' && 'border-yellow-500/50 text-yellow-600'
                            )}
                          >
                            {log.pnl !== undefined && log.pnl !== null && log.result !== 'hold' && log.result !== 'pending' ? `${log.pnl > 0 ? '+' : ''}${log.pnl.toFixed(2)} USD` : log.result.charAt(0).toUpperCase() + log.result.slice(1)}
                          </Badge>
                        </div>
                      </AccordionTrigger>
                        {onDeleteLog && (
                          <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  {deletingLogId === log.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4 text-destructive"/>}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                  <AlertDialogHeader>
                                      <AlertDialogTitle>Apagar este registo?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                          Esta ação não pode ser desfeita. O registo de auditoria para a operação de <strong>{log.tradeParams.direction} em {log.asset}</strong> será permanentemente apagado.
                                      </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => onDeleteLog(log.id)} className="bg-destructive hover:bg-destructive/90">
                                          Apagar Registo
                                      </AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                        )}
                  </div>
                  <AccordionContent>
                    <div className="space-y-4 text-xs p-2 bg-muted/50 rounded-md">
                        <div className='grid grid-cols-2 lg:grid-cols-4 gap-2 text-center'>
                            {isV1 ? (
                                <>
                                 <div className='p-2 bg-background rounded'>
                                    <p className='text-muted-foreground'>Consenso</p>
                                    <p className='font-bold text-base text-primary'>{(log.consensus.consensusSum?.rise || 0).toFixed(0)} / {(log.consensus.consensusSum?.fall || 0).toFixed(0)}</p>
                                </div>
                                <div className='p-2 bg-background rounded'>
                                    <p className='text-muted-foreground'>Limiar</p>
                                    <p className='font-bold text-base'>{log.consensus.consensusThreshold}</p>
                                </div>
                                </>
                            ) : (
                                <div className='p-2 bg-background rounded'>
                                    <p className='text-muted-foreground'>Prob. Bayesiana</p>
                                    <p className='font-bold text-base text-primary'>{((log.consensus.bayesianProbability || 0) * 100).toFixed(1)}%</p>
                                </div>
                            )}
                             <div className='p-2 bg-background rounded'>
                                <p className='text-muted-foreground'>Regime Mercado</p>
                                <p className='font-bold text-base'>{log.context.marketRegime}</p>
                            </div>
                             <div className='p-2 bg-background rounded'>
                                <p className='text-muted-foreground'>Stake {isV1 ? '(Base)' : '(Kelly)'}</p>
                                <p className='font-bold text-base'>${log.tradeParams.stake.toFixed(2)}</p>
                            </div>
                        </div>

                        <div className="p-2 bg-background rounded">
                             <p className='font-semibold flex items-center gap-2 mb-1'><Shield className='h-4 w-4'/>Razão da Supervisão</p>
                             <p className='text-muted-foreground italic text-[11px]'>{log.context.supervisionReason || 'N/A'}</p>
                        </div>

                        <Separator />
                        
                        <h4 className='font-semibold flex items-center gap-2'><Brain className='h-4 w-4'/>Análise dos Robôs ({log.consensus.activeRobots} ativos):</h4>
                        <div className="space-y-2">
                             {Object.entries(log.consensus.votes).filter(([, vote]) => vote.vote !== 'HOLD').map(([robotId, voteData]) => (
                                <div key={robotId} className="p-2 rounded bg-background/50 border">
                                    <div className='flex justify-between items-center font-semibold'>
                                        <span className='flex items-center gap-1.5'><CircleDot className='h-3 w-3'/> {voteData.strategy?.strategyType || robotId.split('_')[0]}</span>
                                        <span className={cn(
                                            voteData.vote === 'RISE' && 'text-green-600',
                                            voteData.vote === 'FALL' && 'text-red-600'
                                        )}>{voteData.vote}</span>
                                    </div>
                                    <p className='text-muted-foreground italic text-[11px] pl-5'>Motivo: {voteData.reason}</p>
                                    <p className='text-muted-foreground italic text-[11px] pl-5'>Params: {renderStrategyParams(voteData.strategy)}</p>
                                </div>
                             ))}
                        </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
                )
            })}
            </Accordion>
        )}
      </CardContent>
    </Card>
  );
};
