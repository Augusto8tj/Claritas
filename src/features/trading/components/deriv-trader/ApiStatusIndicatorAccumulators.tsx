// src/features/trading/components/deriv-trader/ApiStatusIndicatorAccumulators.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useDerivApiAccumulators, type ConnectionEvent } from '@/features/trading/hooks/use-deriv-api-accumulators';
import { checkGeminiConnection } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { ShieldCheck, ShieldX, Loader2, RefreshCw, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';

type Status = 'loading' | 'success' | 'error';

const StatusIcon = ({ status, serviceName, errorMsg }: { status: Status; serviceName: string; errorMsg?: string | null }) => {
  let icon;
  let tooltipMessage = '';
  let colorClass = '';

  switch (status) {
    case 'loading':
      icon = <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      tooltipMessage = `A verificar status de: ${serviceName}...`;
      break;
    case 'success':
      icon = <ShieldCheck className="h-4 w-4 text-green-500" />;
      tooltipMessage = `${serviceName}: Conexão autorizada via OTP.`;
      colorClass = 'text-green-500';
      break;
    case 'error':
      icon = <ShieldX className="h-4 w-4 text-destructive" />;
      tooltipMessage = `${serviceName}: Falha na conexão ou autenticação.`;
      colorClass = 'text-destructive';
      break;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-1.5", colorClass)}>
          {icon}
          <span className="text-sm font-medium">{serviceName}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-bold">{serviceName}</p>
        <p className="text-xs">{tooltipMessage}</p>
        {status === 'error' && errorMsg && <p className="text-xs mt-1 border-t pt-1 border-destructive/20">{errorMsg}</p>}
      </TooltipContent>
    </Tooltip>
  );
};


export function ApiStatusIndicatorAccumulators() {
  const { isConnected, isConnecting, connectionError, reconnect, connectionEvents } = useDerivApiAccumulators();
  const [iaStatus, setIaStatus] = useState<Status>('loading');
  const [isChecking, setIsChecking] = useState(false);

  const checkIa = useCallback(async () => {
    setIaStatus('loading');
    const result = await checkGeminiConnection();
    setIaStatus(result.success ? 'success' : 'error');
  }, []);

  const runAllChecks = useCallback(async () => {
    setIsChecking(true);
    await Promise.all([
      reconnect(),
      checkIa()
    ]);
    setIsChecking(false);
  }, [reconnect, checkIa]);

  useEffect(() => {
    checkIa();
  }, [checkIa]);

  const derivStatus: Status = isConnecting ? 'loading' : isConnected ? 'success' : 'error';

  return (
    <TooltipProvider>
      <div className="flex items-center justify-center gap-4 rounded-lg border bg-card p-2 px-4 shadow-sm">
        <StatusIcon status={derivStatus} serviceName="Corretora" errorMsg={connectionError} />
        <StatusIcon status={iaStatus} serviceName="IA" />
        
        <div className="flex items-center gap-1 border-l pl-3">
             <Popover>
                <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                        <Clock className="h-4 w-4" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                    <div className="p-3 border-b bg-muted/30">
                        <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                            <Clock className="h-3 w-3" /> Linha do Tempo da Conexão
                        </h4>
                    </div>
                    <ScrollArea className="h-64">
                        <div className="p-4 space-y-3">
                            {connectionEvents && connectionEvents.length > 0 ? (
                                connectionEvents.map((ev, i) => (
                                    <div key={i} className="flex gap-3 text-[11px] leading-relaxed relative border-l pl-3 pb-1 last:pb-0">
                                        <div className={cn("absolute -left-[5px] top-1 h-2 w-2 rounded-full", 
                                            ev.type === 'success' ? 'bg-green-500' : 
                                            ev.type === 'error' ? 'bg-destructive' : 
                                            ev.type === 'warning' ? 'bg-amber-500' : 'bg-muted-foreground'
                                        )} />
                                        <span className="text-muted-foreground whitespace-nowrap opacity-60">{ev.timestamp}</span>
                                        <span className={cn(
                                            ev.type === 'error' && 'text-destructive font-medium',
                                            ev.type === 'success' && 'text-green-600 font-medium'
                                        )}>{ev.message}</span>
                                    </div>
                                ))
                            ) : (
                                <p className="text-center italic text-muted-foreground py-10">Nenhum evento registrado.</p>
                            )}
                        </div>
                    </ScrollArea>
                </PopoverContent>
            </Popover>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={runAllChecks} disabled={isChecking}>
                        <RefreshCw className={cn("h-4 w-4", isChecking && "animate-spin")} />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Reverificar Conexões</p>
                </TooltipContent>
            </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
