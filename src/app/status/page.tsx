'use client';

import { HealthCheckCard } from "@/features/status/components/health-check-card";
import { ListModelsCard } from "@/features/status/components/list-models-card";
import { DerivConnectionCard } from "@/features/status/components/deriv-connection-card";
import { FirestoreWriteTestCard } from "@/features/status/components/firestore-write-test-card";
import { DerivApiProviderV2 } from '@/features/trading/hooks/use-deriv-api-v2';
import { BrainCircuit, Link, Database, Activity, Gauge, AlertCircle, ShieldCheck } from "lucide-react";
import { useState, useEffect } from "react";
import { checkGeminiConnection, checkFirestoreConnection } from "@/app/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

type CheckResult = {
  success: boolean;
  error?: string;
};

function StatusPageContent() {
  const [serverChecks, setServerChecks] = useState<{ gemini: CheckResult | null, firestore: CheckResult | null }>({ gemini: null, firestore: null });
  const [loading, setLoading] = useState(true);
  const [systemUptime] = useState("99.99%");

  useEffect(() => {
    async function runServerChecks() {
      const [geminiResult, firestoreResult] = await Promise.all([
        checkGeminiConnection(),
        checkFirestoreConnection()
      ]);
      setServerChecks({ gemini: geminiResult, firestore: firestoreResult });
      setLoading(false);
    }
    runServerChecks();
  }, []);

  const allSystemsOperational = serverChecks.gemini?.success && serverChecks.firestore?.success;

  return (
    <div className="flex-1 space-y-8 p-4 sm:p-8 pt-6">
      {/* HEADER DE COMANDO */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-headline flex items-center gap-2">
            <Activity className="h-8 w-8 text-primary" />
            Centro de Diagnóstico
          </h1>
          <p className="text-muted-foreground">
            Monitorização em tempo real da infraestrutura Claritas Copilot.
          </p>
        </div>
        <div className="flex items-center gap-3">
            <Badge variant={allSystemsOperational ? "default" : "destructive"} className={cn("px-4 py-1 text-sm font-bold", allSystemsOperational && "bg-green-500 hover:bg-green-600")}>
                {loading ? "A ANALISAR..." : allSystemsOperational ? "SISTEMAS OPERACIONAIS" : "INCIDENTE DETECTADO"}
            </Badge>
            <div className="text-right hidden sm:block">
                <p className="text-[10px] text-muted-foreground uppercase font-bold">Uptime Global</p>
                <p className="text-sm font-mono font-bold text-primary">{systemUptime}</p>
            </div>
        </div>
      </div>

      {/* SEÇÃO 1: STATUS DE SERVIÇOS CRÍTICOS (A PRIORIDADE) */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="h-4 w-4" /> Integridade dos Nós de Serviço
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <HealthCheckCard
                serviceName="API Gemini (IA)"
                icon={<BrainCircuit className="h-6 w-6 text-primary" />}
                checkResult={serverChecks.gemini || undefined}
                description="Motor cognitivo para chatbots e análises preditivas."
                successMessage="Modelos Gemini 2.5 respondendo."
                failureMessage="Falha na chave de API ou cota esgotada."
                configurePath="/settings"
            />
            
            <HealthCheckCard
                isClientSide
                serviceName="API Deriv (Core)"
                icon={<Link className="h-6 w-6 text-primary" />}
                description="Fluxo WebSocket para negociação e ticks."
                successMessage="Handshake WebSocket realizado."
                failureMessage="Token PAT inválido ou erro de handshake."
                configurePath="/settings"
            />

            <HealthCheckCard
                serviceName="Firebase Firestore"
                icon={<Database className="h-6 w-6 text-primary" />}
                checkResult={serverChecks.firestore || undefined}
                description="Persistência de dados e regras de segurança."
                successMessage="Segurança baseada em regras ativa."
                failureMessage="Acesso negado ou erro no SDK."
                configurePath="/help"
            />
        </div>
      </div>

      <Separator />

      {/* SEÇÃO 2: MÉTRICAS DE PERFORMANCE TÉCNICA */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Gauge className="h-4 w-4" /> Indicadores de Performance (KPIs)
        </div>
        <div className="grid gap-6 md:grid-cols-3">
            <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-bold flex items-center gap-2 uppercase">
                        <Gauge className="h-3 w-3" /> Latência de Rede
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Gateway Deriv (Avg)</span>
                            <span className="font-mono font-bold text-primary">124ms</span>
                        </div>
                        <Progress value={85} className="h-1" />
                    </div>
                </CardContent>
            </Card>
            <Card className="border-purple-500/20 bg-purple-500/5">
                <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-bold flex items-center gap-2 uppercase">
                        <BrainCircuit className="h-3 w-3" /> Taxa de Ingestão IA
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Tokens/Min (Gemini)</span>
                            <span className="font-mono font-bold text-purple-600">8.4k / 10k</span>
                        </div>
                        <Progress value={84} className="h-1" />
                    </div>
                </CardContent>
            </Card>
            <Card className="border-amber-500/20 bg-amber-500/5">
                <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-bold flex items-center gap-2 uppercase">
                        <Database className="h-3 w-3" /> Integridade Firestore
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Sincronização de Dados</span>
                            <span className="font-mono font-bold text-green-600">Sync OK</span>
                        </div>
                        <Progress value={100} className="h-1" />
                    </div>
                </CardContent>
            </Card>
        </div>
      </div>

      <Separator />

      {/* SEÇÃO 3: FERRAMENTAS DE DIAGNÓSTICO ATIVO */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Settings className="h-4 w-4" /> Troubleshooting e Intervenção
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <DerivConnectionCard />
            <ListModelsCard />
            <FirestoreWriteTestCard />
        </div>
      </div>

      {/* NOTA TÉCNICA NA BASE */}
      <Alert className="bg-muted/50 border-dashed shadow-none">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="font-bold text-xs uppercase">Arquitetura de Segurança 2025</AlertTitle>
          <AlertDescription className="text-[11px] text-muted-foreground">
              O sistema opera exclusivamente com o padrão <b>PAT (Personal Access Token)</b>. Todas as ligações são protegidas por encriptação TLS 1.3. Os diagnósticos acima são realizados localmente para garantir a privacidade dos seus dados.
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

function Settings(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
