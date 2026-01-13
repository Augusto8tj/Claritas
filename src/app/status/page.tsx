// /src/app/status/page.tsx
'use client';

import { HealthCheckCard } from "@/features/status/components/health-check-card";
import { ListModelsCard } from "@/features/status/components/list-models-card";
import { DerivConnectionCard } from "@/features/status/components/deriv-connection-card";
import { FirestoreWriteTestCard } from "@/features/status/components/firestore-write-test-card";
import { DerivApiProviderV2 } from '@/features/trading/hooks/use-deriv-api-v2';
import { BrainCircuit, Link, Database } from "lucide-react";
import { useState, useEffect } from "react";
import { checkGeminiConnection, checkFirestoreConnection } from "@/app/actions";

type CheckResult = {
  success: boolean;
  error?: string;
};

// Conteúdo da página movido para um componente filho para poder ser envolvido pelo Provider
function StatusPageContent() {
  const [serverChecks, setServerChecks] = useState<{ gemini: CheckResult | null, firestore: CheckResult | null }>({ gemini: null, firestore: null });
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Status do Sistema
        </h1>
      </div>
      <p className="text-muted-foreground">
        Verifique a saúde das conexões e serviços essenciais do Claritas Copilot.
      </p>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <HealthCheckCard
          serviceName="API Gemini (IA)"
          icon={<BrainCircuit className="h-6 w-6 text-primary" />}
          checkResult={serverChecks.gemini || undefined}
          description="Essencial para todos os recursos de Inteligência Artificial, como chatbots e análises."
          successMessage="A conexão com a API do Google Gemini está funcionando corretamente."
          failureMessage="A chave da API do Gemini não está configurada ou é inválida."
          configurePath="/settings"
        />
        
        <HealthCheckCard
          isClientSide
          serviceName="API Deriv (Corretora)"
          icon={<Link className="h-6 w-6 text-primary" />}
          description="Necessária para negociação, consulta de saldo e dados de mercado em tempo real."
          successMessage="A conexão com a API da Deriv está funcionando corretamente."
          failureMessage="O token da API da Deriv não está configurado ou é inválido."
          configurePath="/settings"
        />

        <HealthCheckCard
            serviceName="Firestore (Base de Dados)"
            icon={<Database className="h-6 w-6 text-primary" />}
            checkResult={serverChecks.firestore || undefined}
            description="Armazena todos os seus dados financeiros, metas e desempenho dos robôs."
            successMessage="A conexão com o Firestore está saudável e as regras de segurança estão ativas."
            failureMessage="Não foi possível conectar ao Firestore ou as regras de segurança não estão configuradas corretamente."
            configurePath="/help"
        />
      </div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <ListModelsCard />
        <DerivConnectionCard />
        <FirestoreWriteTestCard />
      </div>
    </div>
  );
}

// O componente de página agora envolve o conteúdo com o Provider necessário
export default function StatusPage() {
    return (
        <DerivApiProviderV2>
            <StatusPageContent />
        </DerivApiProviderV2>
    );
}
