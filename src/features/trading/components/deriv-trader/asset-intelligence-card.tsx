// src/features/trading/components/deriv-trader/asset-intelligence-card.tsx
'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BrainCircuit, Loader2, Wand2 } from 'lucide-react';
import type { AssetProfileV1 } from '@/lib/types';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface AssetIntelligenceCardProps {
  profile: AssetProfileV1 | null;
  isLoading: boolean;
  onAnalyze: (userNotes: string) => void;
}

export function AssetIntelligenceCard({ profile, isLoading, onAnalyze }: AssetIntelligenceCardProps) {
  const [userNotes, setUserNotes] = useState('');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-primary" />
          Memória Estratégica do Ativo (V1)
        </CardTitle>
        <CardDescription>
          A IA analisa o desempenho e aprende com os seus insights para calibrar a mesa.
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
              <span className="text-muted-foreground">Notas da IA e Operador:</span>
              <p className="italic bg-muted/50 p-2 rounded-md whitespace-pre-wrap">{profile.notes || 'Nenhuma análise ainda.'}</p>
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground p-4 border border-dashed rounded-md">
            Nenhum perfil estratégico para este ativo. Analise o desempenho para criar um.
          </div>
        )}

        <div className="space-y-2">
            <Label htmlFor="user-insights" className="text-sm font-medium">Seus Insights para este Ativo:</Label>
            <Textarea
              id="user-insights"
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              placeholder="Ex: 'Este ativo respeita bem as zonas de sobrecompra do RSI em M5, mas tende a ter falsos rompimentos em M1.'"
              className="min-h-[60px]"
            />
        </div>
        
        <Button onClick={() => onAnalyze(userNotes)} disabled={isLoading} className="w-full">
          <Wand2 className="mr-2 h-4 w-4" />
          Analisar Desempenho e Salvar Aprendizado
        </Button>
      </CardContent>
    </Card>
  );
}
