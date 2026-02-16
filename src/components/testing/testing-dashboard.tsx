// src/components/testing/testing-dashboard.tsx
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal, AlertTriangle } from 'lucide-react';

export function TestingDashboard() {
  // O Vitest geralmente usa esta porta por padrão. Pode ser necessário ajustar se a sua configuração for diferente.
  const vitestUrl = 'http://localhost:51204/__vitest__/';

  return (
    <div className="space-y-6">
      <Alert variant="default" className="border-amber-500/50 bg-amber-500/10 text-amber-700">
        <AlertTriangle className="h-4 w-4 !text-amber-600" />
        <AlertTitle className="font-bold">Pré-requisito: Servidor de Teste Ativo</AlertTitle>
        <AlertDescription>
          Para que este painel funcione, você precisa iniciar o servidor de testes do Vitest em um terminal separado.
          <div className="mt-2 flex items-center gap-2 rounded-md bg-black/80 p-3 font-mono text-sm text-white">
            <Terminal className="h-4 w-4" />
            <span>npm run test:ui</span>
          </div>
          Se o painel abaixo não carregar, execute o comando acima e atualize esta página.
        </AlertDescription>
      </Alert>

      <Card className="h-[calc(100vh-22rem)] w-full">
        <CardContent className="h-full p-0">
          <iframe
            src={vitestUrl}
            title="Vitest UI"
            className="h-full w-full rounded-md border"
            sandbox="allow-scripts allow-same-origin"
          />
        </CardContent>
      </Card>
    </div>
  );
}
