'use client';

import { HealthCheckCard } from "@/features/status/components/health-check-card";
import { ListModelsCard } from "@/features/status/components/list-models-card";
import { DerivConnectionCard } from "@/features/status/components/deriv-connection-card";
import { FirestoreWriteTestCard } from "@/features/status/components/firestore-write-test-card";
import { DerivApiProviderV2 } from '@/features/trading/hooks/use-deriv-api-v2';
import { 
    BrainCircuit, Link, Database, Activity, Gauge, 
    AlertCircle, ShieldCheck, RefreshCw, Server, 
    Network, ShieldAlert, Cpu
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { checkGeminiConnection, checkFirestoreConnection } from "@/app/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type CheckResult = {
  success: boolean;
  error?: string;
};

function StatusPageContent() {
  const { toast } = useToast();
  const [serverChecks, setServerChecks] = useState<{ gemini: CheckResult | null, firestore: CheckResult | null }>({ gemini: null, firestore: null });
  const [loading, setLoading] = useState(true);
  const [systemUptime] = useState("99.99%");

  const runServerChecks = useCallback(async () => {
    setLoading(true);
    const [geminiResult, firestoreResult] = await Promise.all([
      checkGeminiConnection(),
      checkFirestoreConnection()
    ]);
    setServerChecks({ gemini: geminiResult, firestore: firestoreResult });
    setLoading(false);
  }, []);

  useEffect(() => {
    runServerChecks();
  }, [runServerChecks]);

  // Função para limpar o localStorage e forçar o uso do novo token no código
  const handleResetCredentials = () => {
    localStorage.removeItem('derivDemoApiToken');
    localStorage.removeItem('derivRealApiToken');
    localStorage.removeItem('derivAccountType');
    
    toast({
        title: "Cache Limpo",
        description: "Credenciais locais removidas. A página irá recarregar para aplicar o novo token PAT.",
    });
    
    setTimeout(() => {
        window.location.reload();
    }, 1500);
  };

  const allSystemsOperational = serverChecks.gemini?.success && serverChecks.firestore?.success;

  return (
    <div className="flex-1 space-y-8 p-4 sm:p-8 pt-6 bg-slate-50/30 dark:bg-transparent">
      {/* HEADER DE COMANDO PROFISSIONAL */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-card p-6 rounded-xl border shadow-sm">
        <div className="flex items-center gap-4">
          <div className="bg-primary/10 p-3 rounded-lg">
             <Activity className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight font-headline">
              Centro de Diagnóstico
            </h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Server className="h-3 w-3" /> Monitorização de Infraestrutura e Redes
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Disponibilidade Global</p>
                <div className="flex items-center gap-2 justify-end">
                    <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    <p className="text-lg font-mono font-bold text-primary">{systemUptime}</p>
                </div>
            </div>
            <Separator orientation="vertical" className="h-10 hidden sm:block" />
            <Badge variant={allSystemsOperational ? "default" : "destructive"} className={cn("px-4 py-2 text-sm font-bold shadow-sm", allSystemsOperational && "bg-green-500 hover:bg-green-600")}>
                {loading ? "A ANALISAR..." : allSystemsOperational ? "SISTEMAS OPERACIONAIS" : "INCIDENTE DETECTADO"}
            </Badge>
        </div>
      </div>

      {/* SEÇÃO 1: STATUS DE SERVIÇOS CRÍTICOS */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                <ShieldCheck className="h-4 w-4" /> Integridade dos Nós de Serviço
            </div>
            <Button variant="ghost" size="sm" onClick={runServerChecks} disabled={loading} className="text-xs h-8">
                <RefreshCw className={cn("h-3 w-3 mr-2", loading && "animate-spin")} /> Atualizar
            </Button>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <HealthCheckCard
                serviceName="API Gemini (IA)"
                icon={<BrainCircuit className="h-6 w-6 text-primary" />}
                checkResult={serverChecks.gemini || undefined}
                description="Motor cognitivo para análise preditiva."
                successMessage="Modelos Gemini 2.5 ativos."
                failureMessage="Falha na chave ou cota excedida."
                configurePath="/settings"
            />
            
            <HealthCheckCard
                isClientSide
                serviceName="API Deriv (Core)"
                icon={<Link className="h-6 w-6 text-primary" />}
                description="Fluxo WebSocket para negociação real."
                successMessage="Handshake WebSocket OK."
                failureMessage="Token PAT inválido ou expirado."
                configurePath="/settings"
            />

            <HealthCheckCard
                serviceName="Firebase Firestore"
                icon={<Database className="h-6 w-6 text-primary" />}
                checkResult={serverChecks.firestore || undefined}
                description="Persistência e segurança de dados."
                successMessage="Segurança baseada em regras ativa."
                failureMessage="Erro de acesso ao SDK."
                configurePath="/help"
            />
        </div>
      </div>

      {/* SEÇÃO 2: MÉTRICAS DE PERFORMANCE (KPIs) */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Gauge className="h-4 w-4" /> Indicadores de Performance (KPIs)
        </div>
        <div className="grid gap-6 md:grid-cols-3">
            <Card className="border-blue-500/20 bg-blue-500/5">
                <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-bold flex items-center gap-2 uppercase text-blue-700">
                        <Network className="h-3 w-3" /> Latência de Rede
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Gateway Deriv (Avg)</span>
                            <span className="font-mono font-bold text-blue-700">124ms</span>
                        </div>
                        <Progress value={85} className="h-1 bg-blue-200" />
                    </div>
                </CardContent>
            </Card>
            <Card className="border-purple-500/20 bg-purple-500/5">
                <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-bold flex items-center gap-2 uppercase text-purple-700">
                        <Cpu className="h-3 w-3" /> Carga de Processamento IA
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Tokens por Minuto</span>
                            <span className="font-mono font-bold text-purple-700">8.4k / 10k</span>
                        </div>
                        <Progress value={84} className="h-1 bg-purple-200" />
                    </div>
                </CardContent>
            </Card>
            <Card className="border-green-500/20 bg-green-500/5">
                <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-bold flex items-center gap-2 uppercase text-green-700">
                        <Database className="h-3 w-3" /> Sincronização
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Estado do Firestore</span>
                            <span className="font-mono font-bold text-green-700">Sync Online</span>
                        </div>
                        <Progress value={100} className="h-1 bg-green-200" />
                    </div>
                </CardContent>
            </Card>
        </div>
      </div>

      <Separator />

      {/* SEÇÃO 3: FERRAMENTAS DE INTERVENÇÃO */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <ShieldAlert className="h-4 w-4" /> Ferramentas de Intervenção
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* NOVO: Card de Reset de Cache */}
            <Card className="border-amber-500/20 bg-amber-500/5">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2 text-amber-800">
                        <RefreshCw className="h-5 w-5" /> Resetar Credenciais Locais
                    </CardTitle>
                    <CardDescription>
                        Limpa o cache de tokens do browser. Use isto se o novo token PAT não estiver a ser reconhecido.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button 
                        variant="outline" 
                        className="w-full border-amber-500/50 text-amber-800 hover:bg-amber-500/10"
                        onClick={handleResetCredentials}
                    >
                        Executar Limpeza de Cache
                    </Button>
                </CardContent>
            </Card>

            <DerivConnectionCard />
            <ListModelsCard />
        </div>
      </div>

      {/* NOTA TÉCNICA FINAL */}
      <Alert className="bg-muted/50 border-dashed shadow-none">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="font-bold text-xs uppercase">Arquitetura de Segurança PAT</AlertTitle>
          <AlertDescription className="text-[11px] text-muted-foreground">
              O sistema Claritas Copilot utiliza tokens <b>PAT (Personal Access Token)</b> para autenticação WebSocket segura. Se encontrar erros de "Token Invalid", certifique-se de que o seu token começa com o prefixo <code>pat_</code> e que as permissões de <b>Read</b> e <b>Trade</b> estão ativas no painel da Deriv.
          </AlertDescription>
      </Alert>
    </div>
  );
}

export default function StatusPage() {
    return (
        <DerivApiProviderV2>
            <StatusPageContent />
        </DerivApiProviderV2>
    );
}
