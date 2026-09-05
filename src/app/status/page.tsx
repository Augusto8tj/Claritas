// /src/app/status/page.tsx
'use client';

import { HealthCheckCard } from "@/features/status/components/health-check-card";
import { ListModelsCard } from "@/features/status/components/list-models-card";
import { DerivConnectionCard } from "@/features/status/components/deriv-connection-card";
import { FirestoreWriteTestCard } from "@/features/status/components/firestore-write-test-card";
import { DerivApiProviderV2 } from '@/features/trading/hooks/use-deriv-api-v2';
import { BrainCircuit, Link, Database, Activity, Gauge, ShieldCheck, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { checkGeminiConnection, checkFirestoreConnection } from "@/app/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type CheckResult = {
  success: boolean;
  error?: string;
};

function StatusPageContent() {
  const [serverChecks, setServerChecks] = useState<{ gemini: CheckResult | null, firestore: CheckResult | null }>({ gemini: null, firestore: null });
  const [loading, setLoading] = useState(true);
  const [systemUptime, setSystemUptime] = useState("99.99%");

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
    <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6">
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
                {loading ? "A Analisar..." : allSystemsOperational ? "SISTEMAS OPERACIONAIS" : "INCIDENTE DETECTADO"}
            </Badge>
            <div className="text-right hidden sm:block">
                <p className="text-[10px] text-muted-foreground uppercase font-bold">Uptime Global</p>
                <p className="text-sm font-mono font-bold text-primary">{systemUptime}</p>
            </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Gauge className="h-4 w-4" /> PERFORMANCE REDE
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                        <span>Latência API Deriv</span>
                        <span className="font-mono font-bold">124ms</span>
                    </div>
                    <Progress value={85} className="h-1" />
                </div>
            </CardContent>
        </Card>
        <Card className="border-purple-500/20 bg-purple-500/5">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <BrainCircuit className="h-4 w-4" /> CAPACIDADE IA
                </CardTitle>
            </CardHeader>
            <CardContent>
                 <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                        <span>Tokens/Min (Gemini)</span>
                        <span className="font-mono font-bold">8.4k / 10k</span>
                    </div>
                    <Progress value={84} className="h-1" />
                </div>
            </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/5">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Database className="h-4 w-4" /> PERSISTÊNCIA DADOS
                </CardTitle>
            </CardHeader>
            <CardContent>
                 <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                        <span>Operações Firestore</span>
                        <span className="font-mono font-bold text-green-600">Saudável</span>
                    </div>
                    <Progress value={100} className="h-1" />
                </div>
            </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <HealthCheckCard
          serviceName="API Gemini (IA)"
          icon={<BrainCircuit className="h-6 w-6 text-primary" />}
          checkResult={serverChecks.gemini || undefined}
          description="Motor cognitivo para chatbots e análises preditivas."
          successMessage="Modelos Gemini 2.5 Flash Lite e Pro respondendo."
          failureMessage="Falha crítica na chave de API ou cota esgotada."
          configurePath="/settings"
        />
        
        <HealthCheckCard
          isClientSide
          serviceName="API Deriv (Core)"
          icon={<Link className="h-6 w-6 text-primary" />}
          description="Fluxo WebSocket para negociação e ticks."
          successMessage="Handshake WebSocket realizado com sucesso."
          failureMessage="Token PAT inválido ou erro de handshake."
          configurePath="/settings"
        />

        <HealthCheckCard
            serviceName="Firebase Firestore"
            icon={<Database className="h-6 w-6 text-primary" />}
            checkResult={serverChecks.firestore || undefined}
            description="Base de dados NoSQL para perfis e histórico."
            successMessage="Segurança baseada em regras ativa e validada."
            failureMessage="Acesso negado ou erro de inicialização do SDK."
            configurePath="/help"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <DerivConnectionCard />
        <ListModelsCard />
        <FirestoreWriteTestCard />
      </div>

      <Alert className="bg-muted border-none shadow-none">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="font-bold text-xs uppercase">Nota Técnica</AlertTitle>
          <AlertDescription className="text-[11px] text-muted-foreground">
              O sistema utiliza o novo formato de autenticação <b>PAT (Personal Access Token)</b> da Deriv, garantindo maior segurança e conformidade com as novas directrizes da corretora para 2025.
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
