// src/features/trading/components/hf-trader/hf-config-panel.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Settings, Zap, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StrategyType } from '@/features/trading/services/hf-strike-logic';

export interface HFConfig {
  enabled: boolean;
  minConfidence: number;
  autoExecute: boolean;
  maxConcurrentTrades: number;
  preferredDuration: number;
}

const strategyMetadata: Record<StrategyType, { label: string; description: string; isHF: boolean; }> = {
  HF_MEAN_REVERSION: { label: 'Alta Frequência (Reversão)', description: 'Otimizado para reversão à média em 15-45s.', isHF: true },
  STD_TREND_FOLLOW: { label: 'Padrão (Tendência)', description: 'Segue tendências em velas de 15m.', isHF: false },
  BOLLINGER_SQUEEZE: { label: 'Alta Frequência (Breakout)', description: 'Opera na explosão de volatilidade.', isHF: true },
  VOLUME_ABSORPTION: { label: 'Padrão (Volume)', description: 'Analisa o clímax e absorção de volume.', isHF: false },
  MICROSTRUCTURE_SCALP: { label: 'Ultra HF (Scalping)', description: 'Opera o fluxo de ordens para trades de 5 ticks.', isHF: true },
};

interface HFConfigPanelProps {
  config: HFConfig;
  onConfigChange: (config: Partial<HFConfig>) => void;
  disabled?: boolean;
  strategy: StrategyType;
}

export function HFConfigPanel({ config, onConfigChange, disabled = false, strategy }: HFConfigPanelProps) {
  const metadata = strategyMetadata[strategy];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          Configurações ({metadata.label})
        </CardTitle>
        <CardDescription>
          Parâmetros do sistema de trading.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
          <Label htmlFor="hf-enabled" className="flex flex-col space-y-1 flex-1 pr-4">
            <span>Ativar Strike Zone Detector</span>
            <span className="font-normal text-xs text-muted-foreground">
              Liga/desliga a detecção de zonas de entrada.
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
            min={55}
            max={90}
            step={5}
            value={[config.minConfidence]}
            onValueChange={([minConfidence]) => onConfigChange({ minConfidence })}
            disabled={disabled || !config.enabled}
          />
          <p className="text-xs text-muted-foreground">
            Apenas strikes com confiança acima deste valor serão considerados.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
          <Label htmlFor="auto-execute" className="flex flex-col space-y-1 flex-1 pr-4">
            <span>Auto-Executar Strikes</span>
            <span className="font-normal text-xs text-muted-foreground">
              Executa trades automaticamente quando um sinal é válido.
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
            Limite de posições abertas ao mesmo tempo.
          </p>
        </div>

        {metadata.isHF && strategy !== 'MICROSTRUCTURE_SCALP' && (
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
              Ajusta a duração da operação para os modos de alta frequência.
            </p>
          </div>
        )}

        <Alert className={cn(
            "border-opacity-50",
            metadata.isHF ? 'bg-yellow-50 border-yellow-300' : 'bg-blue-50 border-blue-300'
        )}>
          {metadata.isHF ? <Zap className="h-4 w-4 text-yellow-600" /> : <Clock className="h-4 w-4 text-blue-600" />}
          <AlertTitle className={cn(metadata.isHF ? 'text-yellow-900' : 'text-blue-900')}>
            Modo {metadata.label}
          </AlertTitle>
          <AlertDescription className={cn('text-xs', metadata.isHF ? 'text-yellow-800' : 'text-blue-800')}>
            {metadata.description}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
