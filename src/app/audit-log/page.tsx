// /src/app/audit-log/page.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { getTradeDecisionLogs } from '@/services/financial-data-service';
import { getTradeDecisionLogsV3 } from '@/services/financial-data-service-v3';
import type { TradeDecisionLog } from '@/lib/types';
import { Filter, Trash2, Loader2, Bot } from 'lucide-react';
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
import { deleteAllDecisionLogs, deleteDecisionLog } from '@/app/actions/audit-log-actions';
import TradingDecisionLogViewer from '@/components/deriv-trader/TradingDecisionLogViewer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


export default function AuditLogPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [logs, setLogs] = useState<TradeDecisionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);

  // Filtros
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [assetFilter, setAssetFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('all');
  
  // Abas de Versão
  const [activeTab, setActiveTab] = useState<'v1' | 'v2' | 'v3'>('v2');

  useEffect(() => {
    if (!user) {
        setLoading(false);
        return;
    };

    const fetchLogs = async () => {
      setLoading(true);
      setLogs([]); // Limpa os logs ao trocar de aba
      try {
        let fetchedLogs: TradeDecisionLog[];
        if (activeTab === 'v3') {
            fetchedLogs = await getTradeDecisionLogsV3(user.uid);
        } else {
            fetchedLogs = await getTradeDecisionLogs(user.uid, activeTab);
        }
        fetchedLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setLogs(fetchedLogs);
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
    return logs.filter(log => {
      const logDate = new Date(log.timestamp);
      
      const dateMatch = !dateRange || (
          (!dateRange.from || logDate >= dateRange.from) &&
          (!dateRange.to || logDate <= dateRange.to)
      );
      const assetMatch = !assetFilter || log.asset.toLowerCase().includes(assetFilter.toLowerCase());
      const resultMatch = resultFilter === 'all' || log.result === resultFilter;
      
      return dateMatch && assetMatch && resultMatch;
    });
  }, [logs, dateRange, assetFilter, resultFilter]);

  const handleDeleteAll = async () => {
    if (!user) return;
    setIsDeletingAll(true);
    const result = await deleteAllDecisionLogs(user.uid, activeTab);
    if (result.success) {
      toast({ title: "Histórico Limpo!", description: `Todos os registos da versão ${activeTab.toUpperCase()} foram apagados.` });
      setLogs([]);
    } else {
      toast({ title: "Erro", description: result.error, variant: "destructive" });
    }
    setIsDeletingAll(false);
  };
  
  const handleDeleteSingle = async (logId: string) => {
    if (!user) return;
    setDeletingLogId(logId);
    const result = await deleteDecisionLog(user.uid, logId, activeTab);
    if (result.success) {
      toast({ title: "Registo Apagado", description: "O log de auditoria foi removido." });
      setLogs(prev => prev.filter(log => log.id !== logId));
    } else {
      toast({ title: "Erro", description: result.error, variant: "destructive" });
    }
    setDeletingLogId(null);
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

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'v1' | 'v2' | 'v3')} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="v1">Trader V1</TabsTrigger>
          <TabsTrigger value="v2">Trader V2.5</TabsTrigger>
          <TabsTrigger value="v3">Trader V3 (IA Lab)</TabsTrigger>
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
            <TradingDecisionLogViewer 
                logs={filteredLogs} 
                onDeleteLog={handleDeleteSingle} 
                deletingLogId={deletingLogId} 
            />
         )}
      </Tabs>
    </div>
  );
}
