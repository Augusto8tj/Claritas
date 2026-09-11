
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useDerivApiV2 } from '@/features/trading/hooks/use-deriv-api-v2';
import { checkGeminiConnection, checkOllamaConnection } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { ShieldCheck, ShieldX, Loader2, RefreshCw, Laptop, Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { OllamaConfig } from '@/lib/types';

type Status = 'loading' | 'success' | 'error';

const StatusIcon = ({ status, serviceName, errorMsg, icon: CustomIcon }: { status: Status; serviceName: string; errorMsg?: string | null; icon?: React.ReactNode }) => {
  let icon;
  let tooltipMessage = '';
  let colorClass = '';

  switch (status) {
    case 'loading':
      icon = <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      tooltipMessage = `A verificar status de: ${serviceName}...`;
      break;
    case 'success':
      icon = CustomIcon || <ShieldCheck className="h-4 w-4 text-green-500" />;
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
        <p className="font-bold">{serviceName}</p>
        <p>{tooltipMessage}</p>
        {status === 'error' && errorMsg && <p className="text-xs mt-1 border-t pt-1">{errorMsg}</p>}
      </TooltipContent>
    </Tooltip>
  );
};

export function ApiStatusIndicatorV2() {
  const { isConnected, isConnecting, connectionError, reconnect } = useDerivApiV2();
  const [iaCloudStatus, setIaCloudStatus] = useState<Status>('loading');
  const [iaLocalStatus, setIaLocalStatus] = useState<Status>('loading');
  const [isChecking, setIsChecking] = useState(false);

  const checkIAs = useCallback(async () => {
    setIaCloudStatus('loading');
    setIaLocalStatus('loading');
    
    // 1. Check Gemini (Cloud)
    const savedGeminiKey = localStorage.getItem('geminiApiKey');
    const geminiRes = await checkGeminiConnection(savedGeminiKey || undefined);
    setIaCloudStatus(geminiRes.success ? 'success' : 'error');

    // 2. Check Ollama (Local)
    const ollamaConfigRaw = localStorage.getItem('ollamaConfig');
    if (ollamaConfigRaw) {
        try {
            const config = JSON.parse(ollamaConfigRaw) as OllamaConfig;
            const ollamaRes = await checkOllamaConnection(config);
            setIaLocalStatus(ollamaRes.success ? 'success' : 'error');
        } catch (e) {
            setIaLocalStatus('error');
        }
    } else {
        // Fallback check for process.env (Melhoria 5)
        const config = {
            baseUrl: process.env.NEXT_PUBLIC_OLLAMA_BASE_URL || "",
            apiKey: process.env.NEXT_PUBLIC_OLLAMA_API_KEY || "",
            model: "llama3",
            temperature: 0.2,
            keepAlive: "5m"
        };
        const ollamaRes = await checkOllamaConnection(config);
        setIaLocalStatus(ollamaRes.success ? 'success' : 'error');
    }
  }, []);

  const runAllChecks = useCallback(async () => {
    setIsChecking(true);
    await Promise.all([
      reconnect(),
      checkIAs()
    ]);
    setIsChecking(false);
  }, [reconnect, checkIAs]);

  useEffect(() => {
    checkIAs();
  }, [checkIAs]);

  const derivStatus: Status = isConnecting ? 'loading' : isConnected ? 'success' : 'error';

  return (
    <TooltipProvider>
      <div className="flex items-center justify-center gap-4 rounded-lg border bg-card p-2 px-4 shadow-sm">
        <StatusIcon 
            status={derivStatus} 
            serviceName="Corretora" 
            errorMsg={connectionError} 
        />
        
        {/* Mostra a saúde da IA Local (Ollama) que é usada no terminal */}
        <StatusIcon 
            status={iaLocalStatus} 
            serviceName="IA Local" 
            icon={<Laptop className="h-4 w-4" />}
        />

        {/* Mostra a saúde da IA Cloud (Gemini) que é usada nos chats e insights */}
        <StatusIcon 
            status={iaCloudStatus} 
            serviceName="IA Cloud" 
            icon={<Cloud className="h-4 w-4" />}
        />

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
