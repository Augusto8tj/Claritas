// /src/features/trading/components/deriv-trader/system-status-summary.tsx
'use client';

import { BrainCircuit, Link as LinkIcon, Loader2, RefreshCw, Server, Settings, ShieldCheck, ShieldX } from "lucide-react";
import { useDerivApiV2 } from "@/features/trading/hooks/use-deriv-api-v2";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import React from "react";
import { checkGeminiConnection } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";

export function SystemStatusSummary() {
    const { isConnected, isConnecting, connectionError, reconnect } = useDerivApiV2();
    const [isGeminiOk, setIsGeminiOk] = React.useState<'ok' | 'error' | 'loading'>('loading');
    const [isChecking, setIsChecking] = React.useState(false);
    const { toast } = useToast();

    const checkGemini = React.useCallback(async () => {
        setIsGeminiOk('loading');
        const geminiResult = await checkGeminiConnection();
        setIsGeminiOk(geminiResult.success ? 'ok' : 'error');
        return geminiResult.success;
    }, []);

    React.useEffect(() => {
        checkGemini();
    }, [checkGemini]);

    const handleRefresh = async () => {
        setIsChecking(true);
        toast({ title: "A verificar...", description: "A re-validar as conexões com os serviços." });
        
        const [derivSuccess, geminiSuccess] = await Promise.all([
            reconnect(), 
            checkGemini()
        ]);

        setIsChecking(false);
        if(derivSuccess && geminiSuccess) {
            toast({ title: "Sistema OK!", description: "Todas as conexões foram verificadas com sucesso.", className: "bg-green-100 dark:bg-green-900" });
        } else {
            toast({ title: "Falha na Verificação", description: "Uma ou mais conexões falharam. Verifique os detalhes ou as configurações.", variant: "destructive" });
        }
    };


    const StatusIndicator = ({ status, label }: { status: 'ok' | 'loading' | 'error', label: string }) => (
        <div className="flex items-center gap-2">
            {status === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {status === 'ok' && <ShieldCheck className="h-4 w-4 text-green-600" />}
            {status === 'error' && <ShieldX className="h-4 w-4 text-destructive" />}
            <span className={cn(
                "text-sm font-medium",
                status === 'ok' && "text-green-700",
                status === 'error' && "text-destructive",
                status === 'loading' && "text-muted-foreground",
            )}>{label}</span>
        </div>
    );
    
    const getDerivStatus = (): 'ok' | 'loading' | 'error' => {
        if (isConnecting) return 'loading';
        if (isConnected) return 'ok';
        return 'error';
    }
    
    const hasError = getDerivStatus() === 'error' || isGeminiOk === 'error';

    return (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-3">
            <div className="flex items-center gap-4">
                <StatusIndicator status={getDerivStatus()} label="Corretora" />
                <StatusIndicator status={isGeminiOk} label="IA" />
            </div>
            <div className="flex items-center gap-2">
                 {hasError && (
                    <Button asChild variant="secondary" size="sm">
                        <Link href="/settings">
                            <Settings className="mr-2 h-4 w-4" />
                            Configurações
                        </Link>
                    </Button>
                )}
                 <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isChecking}>
                    <RefreshCw className={cn("mr-2 h-4 w-4", isChecking && "animate-spin")} />
                    Verificar
                </Button>
            </div>
        </div>
    );
}