// /src/app/audit-log/page.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { getTradeDecisionLogs, getPredictiveTradeLogs } from '@/services/financial-data-service';
import { getTradeDecisionLogsV3 } from '@/services/financial-data-service-v3';
import type { TradeDecisionLog, PredictiveTradeLog } from '@/lib/types';
import { Filter, Trash2, Loader2, Bot, AlertCircle, List, UploadCloud, BrainCircuit } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import TradingDecisionLogViewer from '@/components/deriv-trader/TradingDecisionLogViewer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { collection, getDocs, doc, deleteDoc, query, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { errorEmitter, FirestorePermissionError } from '@/firebase';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import PredictiveLogViewer from '@/components/deriv-trader/PredictiveLogViewer';


export default function AuditLogPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [logsV1, setLogsV1] = useState<TradeDecisionLog[]>([]);
  const [logsV2, setLogsV2] = useState<TradeDecisionLog[]>([]);
  const [logsV3, setLogsV3] = useState<TradeDecisionLog[]>([]);
  const [predictiveLogs, setPredictiveLogs] = useState<PredictiveTradeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);
  
  // States for legacy cleanup
  const [isDeletingLegacy, setIsDeletingLegacy] = useState(false);
  const [legacyDeletionMessage, setLegacyDeletionMessage] = useState<string | null>(null);
  const [legacyLogs, setLegacyLogs] = useState<{ id: string }[]>([]);
  const [isFetchingLegacy, setIsFetchingLegacy] = useState(false);

  // Filtros
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [assetFilter, setAssetFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('all');
  
  // Abas de Versão
  const [activeTab, setActiveTab] = useState<'v1' | 'v2' | 'v3' | 'predictive'>('v2');

  useEffect(() => {
    if (!user) {
        setLoading(false);
        return;
    };

    const fetchLogs = async () => {
      setLoading(true);
      
      try {
        if (activeTab === 'predictive') {
            const fetched = await getPredictiveTradeLogs(user.uid);
            setPredictiveLogs(fetched.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
        } else if (activeTab === 'v3') {
            const fetched = await getTradeDecisionLogsV3(user.uid);
            setLogsV3(fetched.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
        } else {
            const [v1, v2] = await Promise.all([
                getTradeDecisionLogs(user.uid, 'v1'),
                getTradeDecisionLogs(user.uid, 'v2')
            ]);
            setLogsV1(v1.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
            setLogsV2(v2.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
        }
      } catch (error) {
        console.error("Failed to fetch trade decision logs:", error);
        toast({ title: "Erro ao Carregar Logs", description: "Não foi possível buscar os dados de auditoria.", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [user, activeTab, toast]);

  const filteredLogs = useMemo(() => {
    let logsToFilter: (TradeDecisionLog | PredictiveTradeLog)[] = [];
    if(activeTab === 'predictive') logsToFilter = predictiveLogs;
    if(activeTab === 'v1') logsToFilter = logsV1;
    if(activeTab === 'v2') logsToFilter = logsV2;
    if(activeTab === 'v3') logsToFilter = logsV3;

    return logsToFilter.filter(log => {
      const logDate = new Date(log.timestamp);
      
      const dateMatch = !dateRange || (
          (!dateRange.from || logDate >= dateRange.from) &&
          (!dateRange.to || logDate <= dateRange.to)
      );
      const assetMatch = !assetFilter || log.asset.toLowerCase().includes(assetFilter.toLowerCase());
      const resultMatch = resultFilter === 'all' || log.result === resultFilter;
      
      return dateMatch && assetMatch && resultMatch;
    });
  }, [logsV1, logsV2, logsV3, predictiveLogs, activeTab, dateRange, assetFilter, resultFilter]);

  const handleDeleteAll = async () => {
    if (!user) return;
    setIsDeletingAll(true);
    let collectionName = `decision_logs_${activeTab}`;
    if (activeTab === 'predictive') {
        collectionName = `predictive_logs_v1`;
    }
    const logCollectionRef = collection(db, 'users', user.uid, collectionName);

    try {
        const snapshot = await getDocs(logCollectionRef);
        if (!snapshot.empty) {
            const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
            await Promise.all(deletePromises);
        }
        
        toast({ title: "Histórico Limpo!", description: `Todos os registos da versão ${activeTab.toUpperCase()} foram apagados.` });
        if(activeTab === 'v1') setLogsV1([]);
        if(activeTab === 'v2') setLogsV2([]);
        if(activeTab === 'v3') setLogsV3([]);
        if(activeTab === 'predictive') setPredictiveLogs([]);

    } catch (error: any) {
        console.error(`Falha ao apagar logs de auditoria (versão ${activeTab}):`, error);
        toast({ title: "Erro", description: error.message || "Ocorreu um erro ao tentar apagar os registos.", variant: "destructive" });
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            operation: 'delete',
            path: logCollectionRef.path
        }));
    } finally {
        setIsDeletingAll(false);
    }
  };
  
  const handleDeleteSingle = async (logId: string) => {
    if (!user) return;
    setDeletingLogId(logId);
    let collectionName = `decision_logs_${activeTab}`;
     if (activeTab === 'predictive') {
        collectionName = `predictive_logs_v1`;
    }
    const logDocRef = doc(db, 'users', user.uid, collectionName, logId);

    try {
        await deleteDoc(logDocRef);
        toast({ title: "Registo Apagado", description: "O log de auditoria foi removido." });
        if(activeTab === 'v1') setLogsV1(prev => prev.filter(log => log.id !== logId));
        if(activeTab === 'v2') setLogsV2(prev => prev.filter(log => log.id !== logId));
        if(activeTab === 'v3') setLogsV3(prev => prev.filter(log => log.id !== logId));
        if(activeTab === 'predictive') setPredictiveLogs(prev => prev.filter(log => log.id !== logId));
    } catch (error: any) {
        console.error(`Falha ao apagar o log de auditoria ${logId} (versão ${activeTab}):`, error);
        toast({ title: "Erro", description: error.message || "Ocorreu um erro ao tentar apagar o registo.", variant: "destructive" });
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            operation: 'delete',
            path: logDocRef.path
        }));
    } finally {
        setDeletingLogId(null);
    }
  };
  
  const fetchLegacyLogs = async () => {
    if (!user) {
        toast({ title: "Não autenticado", description: "Por favor, faça login para executar esta ação.", variant: "destructive" });
        return;
    };
    setIsFetchingLegacy(true);
    setLegacyLogs([]);
    setLegacyDeletionMessage(null);
    const logCollectionRef = collection(db, 'decision_logs');

    try {
        const q = query(logCollectionRef, limit(10));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            setLegacyDeletionMessage("Nenhum documento legado encontrado para carregar.");
            toast({ title: "Coleção Vazia", description: "A coleção 'decision_logs' legada não contém mais documentos." });
        } else {
            const logsToDisplay = snapshot.docs.map(doc => ({ id: doc.id }));
            setLegacyLogs(logsToDisplay);
            toast({ title: "Lote Carregado", description: `${logsToDisplay.length} logs legados estão prontos para serem apagados.` });
        }
    } catch (error: any) {
        console.error(`Falha ao carregar logs de auditoria legados:`, error);
        const errorMessage = error.message || "Ocorreu um erro ao tentar carregar os registos. Verifique as regras de segurança e o console do navegador.";
        setLegacyDeletionMessage(`Falha ao carregar: ${errorMessage}`);
        toast({ title: "Erro ao Carregar", description: errorMessage, variant: "destructive" });
    } finally {
        setIsFetchingLegacy(false);
    }
  };

  const handleDeleteLegacy = async () => {
    if (!user || legacyLogs.length === 0) {
        toast({ title: "Nenhum log para apagar", description: "Por favor, carregue um lote de logs primeiro.", variant: "destructive" });
        return;
    };
    setIsDeletingLegacy(true);
    setLegacyDeletionMessage(`A apagar ${legacyLogs.length} registos...`);
    
    try {
        const deletePromises = legacyLogs.map(log => deleteDoc(doc(db, 'decision_logs', log.id)));
        await Promise.all(deletePromises);
        
        const message = `${legacyLogs.length} registos legados foram apagados com sucesso.`;
        setLegacyDeletionMessage(message);
        toast({ title: "Lote Apagado!", description: message });
        setLegacyLogs([]);
    } catch (error: any) {
        console.error(`Falha ao apagar logs de auditoria legados:`, error);
        const errorMessage = error.message || "Ocorreu um erro ao tentar apagar os registos.";
        setLegacyDeletionMessage(`Falha: ${errorMessage}`);
        toast({ title: "Erro ao Apagar", description: errorMessage, variant: "destructive" });
    } finally {
        setIsDeletingLegacy(false);
    }
  };


  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Arquivo de Auditoria
        </h1>
      </div>
      <p className="text-muted-foreground">
        Consulte e filtre o histórico de decisões de cada versão do Cérebro Quantitativo.
      </p>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="v1">Trader V1</TabsTrigger>
          <TabsTrigger value="v2">Trader V2.5</TabsTrigger>
          <TabsTrigger value="v3">Trader V3 (IA Lab)</TabsTrigger>
          <TabsTrigger value="predictive" className="flex items-center gap-2"><BrainCircuit className="h-4 w-4" />Preditivo</TabsTrigger>
        </TabsList>
      
        <Card>
            <CardHeader>
            <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtros de Análise
            </CardTitle>
             <CardDescription>Filtre os logs da versão <span className="font-bold text-primary">{activeTab.toUpperCase()}</span> por data, ativo ou resultado.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <DateRangePicker date={dateRange} setDate={setDateRange} />
                <Input 
                placeholder="Filtrar por ativo..."
                value={assetFilter}
                onChange={(e) => setAssetFilter(e.target.value)}
                />
                <Select value={resultFilter} onValueChange={setResultFilter}>
                <SelectTrigger>
                    <SelectValue placeholder="Filtrar por resultado" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Todos os Resultados</SelectItem>
                    <SelectItem value="won">Ganhos (Won)</SelectItem>
                    <SelectItem value="lost">Perdas (Lost)</SelectItem>
                    <SelectItem value="pending">Pendentes</SelectItem>
                    <SelectItem value="hold">Aguardando (Hold)</SelectItem>
                </SelectContent>
                </Select>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive" className="w-full">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Limpar Histórico ({activeTab.toUpperCase()})
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Tem a certeza absoluta?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Esta ação não pode ser desfeita. Isto irá apagar permanentemente TODOS os logs da versão <span className="font-bold">{activeTab.toUpperCase()}</span> da sua conta.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteAll} disabled={isDeletingAll}>
                            {isDeletingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                            Apagar Tudo
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </CardContent>
        </Card>
        
         {loading ? (
             <div className="flex items-center justify-center h-64 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
             </div>
         ) : (
             <>
                {activeTab !== 'predictive' ? (
                     <TradingDecisionLogViewer 
                        logs={filteredLogs as TradeDecisionLog[]} 
                        onDeleteLog={handleDeleteSingle} 
                        deletingLogId={deletingLogId} 
                    />
                ) : (
                    <PredictiveLogViewer
                        logs={filteredLogs as PredictiveTradeLog[]}
                        onDeleteLog={handleDeleteSingle}
                        deletingLogId={deletingLogId}
                    />
                )}
             </>
         )}
      </Tabs>
      <Card className="border-destructive mt-6">
        <CardHeader>
            <CardTitle className="font-headline text-destructive flex items-center gap-2">
                <Trash2 /> Ação de Limpeza Legada
            </CardTitle>
            <CardDescription>
                Use estas ferramentas para visualizar e apagar a coleção obsoleta 'decision_logs' em lotes.
            </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            
            <Button onClick={fetchLegacyLogs} disabled={isFetchingLegacy || isDeletingLegacy} className="w-full">
                {isFetchingLegacy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <UploadCloud className="mr-2 h-4 w-4" />}
                {isFetchingLegacy ? "A carregar..." : "Carregar Lote de 10 Logs Legados"}
            </Button>
            
            {legacyLogs.length > 0 && (
                <div className="p-4 border rounded-md bg-muted/50 space-y-2">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                        <List className="h-4 w-4" />
                        Lote Pronto para Exclusão:
                    </h4>
                    <ScrollArea className="h-32">
                        <ul className="text-xs font-mono space-y-1 text-muted-foreground pr-4">
                            {legacyLogs.map(log => <li key={log.id} className="truncate">{log.id}</li>)}
                        </ul>
                    </ScrollArea>
                </div>
            )}
            
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="w-full" disabled={legacyLogs.length === 0 || isDeletingLegacy}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Apagar Lote de {legacyLogs.length > 0 ? legacyLogs.length : ''} Logs
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Tem a certeza absoluta?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta ação tentará apagar {legacyLogs.length} documentos da coleção obsoleta 'decision_logs'. 
                            Esta operação é irreversível.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteLegacy} disabled={isDeletingLegacy} className="bg-destructive hover:bg-destructive/90">
                        {isDeletingLegacy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                        Apagar Lote
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            
            {legacyDeletionMessage && (
              <Alert variant={legacyDeletionMessage.startsWith('Falha') ? 'destructive' : 'default'}>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Status da Operação</AlertTitle>
                <AlertDescription>
                  {legacyDeletionMessage}
                </AlertDescription>
              </Alert>
            )}
        </CardContent>
      </Card>
    </div>
  );
}

    
```