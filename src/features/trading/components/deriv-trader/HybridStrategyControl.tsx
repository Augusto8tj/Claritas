// src/features/trading/components/deriv-trader/HybridStrategyControl.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { GitCompareArrows, SlidersHorizontal, Repeat, Wand2 } from 'lucide-react';
import type { RepetitionTriggerConfig } from '../../types/repetition-trigger';

interface HybridStrategyControlProps {
  hybridConfig: RepetitionTriggerConfig['hybridMode'];
  repetitionConfig: Partial<RepetitionTriggerConfig>;
  onHybridConfigChange: (newConfig: Partial<RepetitionTriggerConfig['hybridMode']>) => void;
  onRepetitionConfigChange: (newConfig: Partial<RepetitionTriggerConfig>) => void;
}

export function HybridStrategyControl({
  hybridConfig,
  repetitionConfig,
  onHybridConfigChange,
  onRepetitionConfigChange
}: HybridStrategyControlProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCompareArrows className="h-5 w-5 text-purple-600" />
          Controle de Estratégia Híbrida
        </CardTitle>
        <CardDescription>
          Gerencie a interação entre o Vagalume e o Repetition Trigger.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
          <Label htmlFor="hybrid-mode-enabled" className="flex flex-col space-y-1 flex-1 pr-4">
            <span>Ativar Modo Híbrido</span>
            <span className="font-normal text-xs text-muted-foreground">
              Permite que Vagalume e Trigger operem juntos. Se desativado, apenas os pilotos individuais funcionarão.
            </span>
          </Label>
          <Switch
            id="hybrid-mode-enabled"
            checked={hybridConfig.enabled}
            onCheckedChange={(enabled) => onHybridConfigChange({ enabled })}
          />
        </div>

        {hybridConfig.enabled && (
          <div className="space-y-4 pt-4 border-t">
            <div className="space-y-2">
              <Label htmlFor="priority-mode">Modo de Prioridade</Label>
              <Select
                value={hybridConfig.priorityStrategy}
                onValueChange={(value) => onHybridConfigChange({ priorityStrategy: value as any })}
              >
                <SelectTrigger id="priority-mode">
                  <SelectValue placeholder="Selecione o modo..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vagalume_first">
                    <div className="flex items-center gap-2"><Wand2 className="h-4 w-4" /> Vagalume Primeiro</div>
                  </SelectItem>
                  <SelectItem value="trigger_first">
                    <div className="flex items-center gap-2"><Repeat className="h-4 w-4" /> Repetition Trigger Primeiro</div>
                  </SelectItem>
                  <SelectItem value="best_confidence">
                    <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> Melhor Confiança</div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <Separator />
        
        <div className="space-y-2">
          <Label htmlFor="min-sequence-length">Comprimento Mínimo da Sequência (Repetition Trigger)</Label>
          <Select
            value={String(repetitionConfig.minSequenceLength)}
            onValueChange={(value) => onRepetitionConfigChange({ minSequenceLength: parseInt(value, 10) })}
          >
            <SelectTrigger id="min-sequence-length">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2 Dígitos Iguais</SelectItem>
              <SelectItem value="3">3 Dígitos Iguais</SelectItem>
              <SelectItem value="4">4 Dígitos Iguais</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
