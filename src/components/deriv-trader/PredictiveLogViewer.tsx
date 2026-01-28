'use client';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import type { PredictiveTradeLog } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Archive, BrainCircuit, CheckCircle, HelpCircle, Loader2, Target, Trash2, TrendingDown, TrendingUp, XCircle } from 'lucide-react';

interface PredictiveLogViewerProps {
    logs: PredictiveTradeLog[];
    onDeleteLog?: (logId: string) => void;
    deletingLogId?: string | null;
}

const getProgressColor = (percentage: number) => {
    if (percentage > 75) return 'bg-green-500';
    if (percentage > 60) return 'bg-blue-500';
    if (percentage < 40) return 'bg-red-500';
    return 'bg-gray-400';
};

export default function PredictiveLogViewer({
  logs = [],
  onDeleteLog,
  deletingLogId,
}: PredictiveLogViewerProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            Auditoria Preditiva ({logs.length} Registos)
        </CardTitle>
        <CardDescription>
            Análise detalhada de cada decisão tomada pelo piloto automático preditivo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-8 border rounded-md bg-muted/50">
            <Archive className="h-10 w-10 mb-4" />
            <p className="font-semibold">Nenhum registo de decisão encontrado</p>
            <p className="text-xs">Aguardando operações para ver os logs de auditoria.</p>
          </div>
        ) : (
            <Accordion type="single" collapsible className="w-full" defaultValue="item-0">
              {logs.map((log, index) => {
                return (
                <AccordionItem value={`item-${index}`} key={log.id}>
                  <div className="flex items-center group">
                      <AccordionTrigger className="flex-1">
                        <div className="flex items-center justify-between w-full text-sm">
                          <div className="flex items-center gap-2">
                            {log.result === 'won' && <CheckCircle className="h-4 w-4 text-green-600" />}
                            {log.result === 'lost' && <XCircle className="h-4 w-4 text-destructive" />}
                            {log.result === 'pending' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
                            <span className="font-semibold">{log.tradeParams.direction}</span>
                            <span className="text-muted-foreground text-xs">{new Date(log.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <Badge variant={log.result === 'won' ? 'default' : log.result === 'lost' ? 'destructive' : 'secondary'}
                            className={cn(
                                log.result === 'won' && 'bg-green-600/20 text-green-800 border-green-600/30'
                            )}
                          >
                            {log.pnl !== undefined && log.pnl !== null && log.result !== 'pending' ? `${log.pnl > 0 ? '+' : ''}${log.pnl.toFixed(2)} USD` : log.result.charAt(0).toUpperCase() + log.result.slice(1)}
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
                                          Esta ação irá apagar permanentemente o registo da operação <strong>#{log.contractId}</strong>.
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
                        <div className="p-2 bg-background rounded border">
                             <p className='font-semibold flex items-center gap-2 mb-1'><Target className='h-4 w-4 text-primary'/>Gatilho de Decisão</p>
                             <p className='text-muted-foreground italic text-[11px]'>{log.context.triggerReason}</p>
                        </div>
                        
                        <div>
                            <h4 className='font-semibold flex items-center gap-2 mb-2'>
                                <BrainCircuit className='h-4 w-4'/>
                                Snapshot de Assertividade no Momento da Decisão
                            </h4>
                            <div className="space-y-2 rounded-md border p-2 bg-background">
                                {log.context.assertivenessSnapshot.map((expert, idx) => (
                                    <div key={idx} className="flex justify-between items-center text-xs">
                                        <span className="font-semibold w-14">{expert.horizon}</span>
                                        <div className="flex items-center gap-2 flex-1 mx-4">
                                            <Progress value={expert.accuracy} className="h-1.5" indicatorClassName={getProgressColor(expert.accuracy)} />
                                            <span className="font-mono w-10 text-right">{expert.accuracy.toFixed(0)}%</span>
                                        </div>
                                        <span className={cn("font-bold w-10 text-right flex items-center justify-end gap-1", 
                                            expert.vote === 'RISE' && 'text-green-500', 
                                            expert.vote === 'FALL' && 'text-red-500',
                                            expert.vote === 'HOLD' && 'text-gray-400'
                                        )}>
                                            {expert.vote === 'RISE' && <TrendingUp size={12}/>}
                                            {expert.vote === 'FALL' && <TrendingDown size={12}/>}
                                            {expert.vote === 'HOLD' && <HelpCircle size={12}/>}
                                            {expert.vote}
                                        </span>
                                    </div>
                                ))}
                            </div>
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
}