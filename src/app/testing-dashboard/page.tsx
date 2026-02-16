// src/app/testing-dashboard/page.tsx
import { TestingDashboard } from '@/components/testing/testing-dashboard';
import { TestTube } from 'lucide-react';

export default function TestingDashboardPage() {
  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline flex items-center gap-3">
          <TestTube className="h-8 w-8" />
          Painel de Testes Unitários
        </h1>
      </div>
      <p className="text-muted-foreground">
        Interface interativa para executar, visualizar e depurar os testes unitários do sistema.
      </p>
      <TestingDashboard />
    </div>
  );
}
