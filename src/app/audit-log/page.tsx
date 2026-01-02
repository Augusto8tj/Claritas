// /src/app/audit-log/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { getTradeDecisionLogs } from '@/services/financial-data-service';
import { TradingDecisionLogViewer } from '@/features/trading/components/deriv-trader/TradingDecisionLogViewer';
import type { TradeDecisionLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

function AuditLogSkeleton() {
    return (
        <div className="border rounded-lg p-6">
            <div className="space-y-2 mb-4">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
        </div>
    )
}


export default function AuditLogPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<TradeDecisionLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
        setLoading(false);
        return;
    };

    const fetchLogs = async () => {
      setLoading(true);
      try {
        const fetchedLogs = await getTradeDecisionLogs(user.uid);
        // Ordena do mais recente para o mais antigo
        fetchedLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setLogs(fetchedLogs);
      } catch (error) {
        // O erro já é tratado e emitido dentro do `getTradeDecisionLogs`
        console.error("Failed to fetch trade decision logs (error captured by service).");
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [user]);

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Arquivo de Auditoria
        </h1>
      </div>
      <p className="text-muted-foreground">
        Consulte o histórico completo de todas as decisões de trade já registadas na sua conta.
      </p>
      
      {loading ? (
        <AuditLogSkeleton />
      ) : (
        <TradingDecisionLogViewer logs={logs} />
      )}
    </div>
  );
}
