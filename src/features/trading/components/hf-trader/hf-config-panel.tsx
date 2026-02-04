// src/features/trading/components/hf-trader/hf-config-panel.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Settings, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface HFConfig {
  enabled: boolean;
  minConfidence: number;
  autoExecute: boolean;
  maxConcurrentTrades: number;
  preferredDuration: number;
}

interface HFConfigPanelProps {
  config: HFConfig;
  onConfigChange: (config: Partial<HFConfig>) => void;
  disabled?: boolean;
}

export function HFConfigPanel({ config, onConfigChange, disabled = false }: HFConfigPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          Configurações HF
        </CardTitle>
        <CardDescription>
          Parâmetros do sistema de High Frequency Trading
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
          <Label htmlFor="hf-enabled" className="flex flex-col space-y-1 flex-1 pr-4">
            <span>Ativar Strike Zone Detector</span>
            <span className="font-normal text-xs text-muted-foreground">
              Liga/desliga a detecção de zonas de entrada
            </span>
          </Label>
          <Switch
            id="hf-enabled"
            checked={config.enabled}
            onCheckedChange={enabled => onConfigChange({ enabled })}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="min-confidence">
            Confiança Mínima para Sinal ({config.minConfidence}%)
          </Label>
          <Slider
            id="min-confidence"
            min={60}
            max={90}
            step={5}
            value={[config.minConfidence]}
            onValueChange={([minConfidence]) => onConfigChange({ minConfidence })}
            disabled={disabled || !config.enabled}
          />
          <p className="text-xs text-muted-foreground">
            Apenas strikes com confiança acima deste valor serão exibidos
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
          <Label htmlFor="auto-execute" className="flex flex-col space-y-1 flex-1 pr-4">
            <span>Auto-Executar Strikes</span>
            <span className="font-normal text-xs text-muted-foreground">
              Executa automaticamente quando detecta Strike Zone
            </span>
          </Label>
          <Switch
            id="auto-execute"
            checked={config.autoExecute}
            onCheckedChange={autoExecute => onConfigChange({ autoExecute })}
            disabled={disabled || !config.enabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="max-concurrent">
            Máximo de Trades Simultâneos ({config.maxConcurrentTrades})
          </Label>
          <Slider
            id="max-concurrent"
            min={1}
            max={5}
            step={1}
            value={[config.maxConcurrentTrades]}
            onValueChange={([maxConcurrentTrades]) => onConfigChange({ maxConcurrentTrades })}
            disabled={disabled || !config.enabled}
          />
          <p className="text-xs text-muted-foreground">
            Limite de posições HF abertas ao mesmo tempo
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="preferred-duration">
            Duração Preferida ({config.preferredDuration}s)
          </Label>
          <Slider
            id="preferred-duration"
            min={15}
            max={45}
            step={5}
            value={[config.preferredDuration]}
            onValueChange={([preferredDuration]) => onConfigChange({ preferredDuration })}
            disabled={disabled || !config.enabled}
          />
          <p className="text-xs text-muted-foreground">
            Override da duração sugerida pelo sistema
          </p>
        </div>

        <Alert className="bg-yellow-50 border-yellow-200">
          <Zap className="h-4 w-4 text-yellow-600" />
          <AlertTitle className="text-yellow-900">⚡ Modo Agressivo</AlertTitle>
          <AlertDescription className="text-yellow-800 text-xs">
            HF trading opera em janelas de 15-30s com foco em reversão rápida. Win rate esperado:
            60-65% com RR 1:1.5. Use apenas em ativos com alta liquidez.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
