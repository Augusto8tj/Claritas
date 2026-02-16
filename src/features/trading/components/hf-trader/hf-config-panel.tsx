// src/features/trading/components/hf-trader/hf-config-panel.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Settings, Zap, Clock, Users, ShieldAlert, GitCommit, GitPullRequest, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StrategyType } from '@/features/trading/services/hf-strike-logic';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

export interface HFConfig {
  enabled: boolean;
  minConfidence: number;
  autoExecute: boolean;
  maxConcurrentTrades: number;
  preferredDuration: number;
  minConsensusSignals: number; 
  martingaleMultiplier: number;
  maxConsecutiveLosses: number;
  cooldownSeconds: number;
}

interface HFConfigPanelProps {
  config: HFConfig;
  onConfigChange: (config: Partial<HFConfig>) => void;
}

export function HFConfigPanel({ config, onConfigChange }: HFConfigPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          Painel de Controle HF
        </CardTitle>
        <CardDescription>
          Ajuste os parâmetros de execução e gerenciamento de risco do sistema.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
          <Label htmlFor="hf-enabled" className="flex flex-col space-y-1 flex-1 pr-4">
            <span>Ativar Strike Zone Detector</span>
          </Label>
          <Switch
            id="hf-enabled"
            checked={config.enabled}
            onCheckedChange={enabled => onConfigChange({ enabled })}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
          <Label htmlFor="auto-execute" className="flex flex-col space-y-1 flex-1 pr-4">
            <span>Auto-Executar Strikes</span>
            <span className="font-normal text-xs text-muted-foreground">
              Dispara ordens automaticamente quando um sinal é válido.
            </span>
          </Label>
          <Switch
            id="auto-execute"
            checked={config.autoExecute}
            onCheckedChange={autoExecute => onConfigChange({ autoExecute })}
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="min-confidence">
            Confiança Mínima do Consenso ({config.minConfidence}%)
          </Label>
          <Slider
            id="min-confidence"
            min={5} max={90} step={5}
            value={[config.minConfidence]}
            onValueChange={([minConfidence]) => onConfigChange({ minConfidence })}
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="min-consensus">
            Consenso Mínimo de Estratégias ({config.minConsensusSignals})
          </Label>
          <Slider
            id="min-consensus"
            min={1} max={5} step={1}
            value={[config.minConsensusSignals]}
            onValueChange={([minConsensusSignals]) => onConfigChange({ minConsensusSignals })}
          />
           <p className="text-xs text-muted-foreground pt-1">Número mínimo de estratégias que precisam concordar para formar um consenso.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="max-concurrent-trades">
            Máx. Ordens Concorrentes ({config.maxConcurrentTrades})
          </Label>
          <Slider
            id="max-concurrent-trades"
            min={1} max={5} step={1}
            value={[config.maxConcurrentTrades]}
            onValueChange={([maxConcurrentTrades]) => onConfigChange({ maxConcurrentTrades })}
          />
          <p className="text-xs text-muted-foreground pt-1">
            Define o número máximo de posições que o sistema pode abrir e manter ativas ao mesmo tempo. Ajuda a controlar a exposição total ao risco.
          </p>
        </div>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full">
              <ShieldAlert className="mr-2 h-4 w-4" />
              Gerenciamento de Risco Avançado
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="martingale-multiplier">Multiplicador Martingale ({config.martingaleMultiplier.toFixed(1)}x)</Label>
              <Slider
                id="martingale-multiplier" min={1} max={10} step={0.1}
                value={[config.martingaleMultiplier]}
                onValueChange={([val]) => onConfigChange({ martingaleMultiplier: val })}
              />
              <p className="text-xs text-muted-foreground">Multiplica o stake após uma perda. `1.0` desativa.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-consecutive-losses">Máx. Perdas Consecutivas ({config.maxConsecutiveLosses})</Label>
              <Slider
                id="max-consecutive-losses" min={2} max={10} step={1}
                value={[config.maxConsecutiveLosses]}
                onValueChange={([val]) => onConfigChange({ maxConsecutiveLosses: val })}
              />
               <p className="text-xs text-muted-foreground">Pausa o piloto automático após atingir este limite.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cooldown-seconds">Cooldown Pós-Perda ({config.cooldownSeconds}s)</Label>
              <Slider
                id="cooldown-seconds" min={0} max={120} step={5}
                value={[config.cooldownSeconds]}
                onValueChange={([val]) => onConfigChange({ cooldownSeconds: val })}
              />
              <p className="text-xs text-muted-foreground">Tempo de pausa em segundos após uma operação perdedora.</p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
