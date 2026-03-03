// src/features/trading/components/deriv-trader/ApiStatusIndicatorV2.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useDerivApiV2 } from '@/features/trading/hooks/use-deriv-api-v2';
import { checkGeminiConnection } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { ShieldCheck, ShieldX, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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
      tooltipMessage = `${serviceName}: Conexão bem-sucedida.`;
      colorClass = 'text-green-500';
      break;
    case 'error':
      icon = <ShieldX className="h-4 w-4 text-destructive" />;
      tooltipMessage = `${serviceName}: Falha na conexão.`;
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
        <p>{tooltipMessage}</p>
        {status === 'error' && serviceName === 'Corretora' && errorMsg && <p className="text-xs">{errorMsg}</p>}
      </TooltipContent>
    </Tooltip>
  );
};

export function ApiStatusIndicatorV2() {
  const { isConnected, isConnecting, connectionError, reconnect } = useDerivApiV2();
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
  }, []);

  const derivStatus: Status = isConnecting ? 'loading' : isConnected ? 'success' : 'error';

  return (
    <TooltipProvider>
      <div className="flex items-center justify-center gap-4 rounded-lg border bg-card p-2 px-4 shadow-sm">
        <StatusIcon status={derivStatus} serviceName="Corretora" errorMsg={connectionError} />
        <StatusIcon status={iaStatus} serviceName="IA" />
        <Tooltip>
            <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={runAllChecks}>
                    <RefreshCw className={cn("h-4 w-4", isChecking && "animate-spin")} />
                </Button>
            </TooltipTrigger>
            <TooltipContent>
                <p>Verificar Conexões</p>
            </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
