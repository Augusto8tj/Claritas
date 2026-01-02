// /src/app/status/page.tsx
import { HealthCheckCard } from "@/features/status/components/health-check-card";
import { checkGeminiConnection, checkFirestoreConnection } from "@/app/actions";
import { ListModelsCard } from "@/features/status/components/list-models-card";
import { DerivConnectionCard } from "@/features/status/components/deriv-connection-card";

export const revalidate = 0; // Disable cache for this page

export default async function StatusPage() {
  
  // As a server component, this will run on the server each time the page is loaded.
  const [geminiResult, firestoreResult] = await Promise.all([
    checkGeminiConnection(),
    checkFirestoreConnection()
  ]);
  
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
          checkResult={geminiResult}
          description="Essencial para todos os recursos de Inteligência Artificial, como chatbots e análises."
          successMessage="A conexão com a API do Google Gemini está funcionando corretamente."
          failureMessage="A chave da API do Gemini não está configurada ou é inválida."
          configurePath="/settings"
        />
        
        {/* The Deriv check is fully client-side now, consuming state from the useDerivApi hook */}
        <HealthCheckCard
          isClientSide
          serviceName="API Deriv (Corretora)"
          description="Necessária para negociação, consulta de saldo e dados de mercado em tempo real."
          successMessage="A conexão com a API da Deriv está funcionando corretamente."
          failureMessage="O token da API da Deriv não está configurado ou é inválido."
          configurePath="/settings"
        />

        <HealthCheckCard
            serviceName="Firestore (Base de Dados)"
            checkResult={firestoreResult}
            description="Armazena todos os seus dados financeiros, metas e desempenho dos robôs."
            successMessage="A conexão com o Firestore está saudável e as regras de segurança estão ativas."
            failureMessage="Não foi possível conectar ao Firestore ou as regras de segurança não estão configuradas corretamente."
            configurePath="/help"
        />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <ListModelsCard />
        <DerivConnectionCard />
      </div>
    </div>
  );
}
