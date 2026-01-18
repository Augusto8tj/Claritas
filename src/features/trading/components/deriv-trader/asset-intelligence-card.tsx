// src/features/trading/components/deriv-trader/asset-intelligence-card.tsx
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BrainCircuit, Loader2, Save, Wand2 } from 'lucide-react';
import type { AssetProfileV1 } from '@/lib/types';

interface AssetIntelligenceCardProps {
  profile: AssetProfileV1 | null;
  isLoading: boolean;
  onAnalyze: () => void;
}

export function AssetIntelligenceCard({ profile, isLoading, onAnalyze }: AssetIntelligenceCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-primary" />
          Memória Estratégica do Ativo (V1)
        </CardTitle>
        <CardDescription>
          A IA analisa o desempenho histórico neste ativo para calibrar a mesa de operações.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : profile ? (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Regime Preferencial:</span>
              <span className="font-semibold">{profile.preferredRegime || 'Indefinido'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Limiar de Consenso Ideal:</span>
              <span className="font-semibold">{profile.optimalConsensusThreshold || 'Padrão'}</span>
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground">Notas da IA:</span>
              <p className="italic bg-muted/50 p-2 rounded-md">{profile.notes || 'Nenhuma análise ainda.'}</p>
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground p-4 border border-dashed rounded-md">
            Nenhum perfil estratégico para este ativo. Analise o desempenho para criar um.
          </div>
        )}
        <Button onClick={onAnalyze} disabled={isLoading} className="w-full">
          <Wand2 className="mr-2 h-4 w-4" />
          Analisar Desempenho e Salvar Aprendizado
        </Button>
      </CardContent>
    </Card>
  );
}

    