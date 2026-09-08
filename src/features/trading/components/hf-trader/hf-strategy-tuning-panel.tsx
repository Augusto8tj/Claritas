// src/features/trading/components/hf-trader/hf-strategy-tuning-panel.tsx
'use client';

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { SlidersHorizontal, Zap, Clock, Users, ShieldAlert, GitCommit, GitPullRequest, Layers, Brain } from 'lucide-react';
import type { StrategyParams, StrategyType } from '@/features/trading/hooks/use-hf-strike-zone';

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

interface HFStrategyTuningPanelProps {
  params: StrategyParams;
  gbmConfidenceThreshold: number;
  onParamChange: (strategy: StrategyType | 'GBM', newParams: any) => void;
  calibrationMeta?: any;
}

interface StrategyTuningItemProps {
    title: string;
    paramKey: string;
    value: number;
    description: string;
    min: number;
    max: number;
    step: number;
    unit?: string;
    onValueChange: (value: number) => void;
}

const StrategyTuningItem: React.FC<StrategyTuningItemProps> = ({
    title,
    paramKey,
    value,
    description,
    min,
    max,
    step,
    unit = '',
    onValueChange
}) => (
    <div className="space-y-2 p-3 border rounded-lg bg-background">
        <div className="flex justify-between items-center mb-1">
            <Label htmlFor={`${paramKey}-slider`} className="font-medium">{title}</Label>
            <span className="font-mono text-sm text-primary font-semibold">{(value ?? 0).toFixed(paramKey === 'rev-tolerance' || paramKey === 'squeeze-margin' || paramKey === 'absorb-atr' ? 2 : 1)}{unit}</span>
        </div>
        <Slider
            id={`${paramKey}-slider`}
            min={min}
            max={max}
            step={step}
            value={[value ?? 0]}
            onValueChange={(val) => onValueChange(val[0])}
        />
        <p className="text-xs text-muted-foreground pt-1">{description}</p>
    </div>
);


export function HFStrategyTuningPanel({ params, gbmConfidenceThreshold, onParamChange }: HFStrategyTuningPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-primary" />
          Ajuste Fino das Estratégias
        </CardTitle>
        <CardDescription>
          Calibre os parâmetros de cada especialista para otimizar a performance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="HF_MEAN_REVERSION">
                <AccordionTrigger>Alta Frequência (Reversão)</AccordionTrigger>
                <AccordionContent className="space-y-4 pt-2">
                    <StrategyTuningItem
                        title="Limiar RSI"
                        paramKey="rev-rsi"
                        value={params.HF_MEAN_REVERSION.rsiThreshold}
                        onValueChange={(val) => onParamChange('HF_MEAN_REVERSION', { rsiThreshold: val })}
                        min={15} max={40} step={1}
                        description="Nível de sobrevenda/sobrecompra do RSI. Valores menores (20-25) são mais agressivos. Maiores (30-35) são mais conservadores."
                    />
                     <StrategyTuningItem
                        title="Tolerância (Bandas)"
                        paramKey="rev-tolerance"
                        value={params.HF_MEAN_REVERSION.tolerance * 100}
                        onValueChange={(val) => onParamChange('HF_MEAN_REVERSION', { tolerance: val / 100 })}
                        min={0.05} max={0.3} step={0.01}
                        unit="%"
                        description="Margem (%) para considerar 'toque' nas Bandas de Bollinger. Maior valor = mais sinais."
                    />
                </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="STD_TREND_FOLLOW">
                <AccordionTrigger>Padrão (Tendência)</AccordionTrigger>
                 <AccordionContent className="space-y-4 pt-2">
                    <StrategyTuningItem
                        title="Força do ADX"
                        paramKey="trend-adx"
                        value={params.STD_TREND_FOLLOW.adxStrength}
                        onValueChange={(val) => onParamChange('STD_TREND_FOLLOW', { adxStrength: val })}
                        min={15} max={35} step={1}
                        description="Força mínima da tendência para o sinal ser válido. Ideal: 22-25."
                    />
                     <StrategyTuningItem
                        title="RSI Momentum"
                        paramKey="trend-rsi"
                        value={params.STD_TREND_FOLLOW.rsiMomentum}
                        onValueChange={(val) => onParamChange('STD_TREND_FOLLOW', { rsiMomentum: val })}
                        min={50} max={60} step={1}
                        description="RSI acima disso = momentum alta; abaixo de (100-X) = momentum baixa. Ideal: 52."
                    />
                </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="BOLLINGER_SQUEEZE">
                <AccordionTrigger>Rompimento (Squeeze)</AccordionTrigger>
                 <AccordionContent className="space-y-4 pt-2">
                    <StrategyTuningItem
                        title="BBW Máximo (%)"
                        paramKey="squeeze-bbw"
                        value={params.BOLLINGER_SQUEEZE.bbwThreshold}
                        onValueChange={(val) => onParamChange('BOLLINGER_SQUEEZE', { bbwThreshold: val })}
                        min={0.5} max={5.0} step={0.1}
                        unit="%"
                        description="Largura máxima da banda para considerar um 'squeeze'. Menor = mais raro/forte. Ideal: 1.0 - 2.5."
                    />
                    <StrategyTuningItem
                        title="Margem de Rompimento (%)"
                        paramKey="squeeze-margin"
                        value={params.BOLLINGER_SQUEEZE.breakoutMargin * 100}
                        onValueChange={(val) => onParamChange('BOLLINGER_SQUEEZE', { breakoutMargin: val / 100 })}
                        min={0.5} max={5.0} step={0.1}
                        unit="%"
                        description="Percentual que o preço deve exceder a banda para confirmar um rompimento. Ideal: 2.0."
                    />
                </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="VOLUME_ABSORPTION">
                <AccordionTrigger>Absorção de Volume</AccordionTrigger>
                <AccordionContent className="space-y-4 pt-2">
                    <StrategyTuningItem
                        title="Multiplicador de Clímax"
                        paramKey="absorb-climax"
                        value={params.VOLUME_ABSORPTION.climaxMultiplier}
                        onValueChange={(val) => onParamChange('VOLUME_ABSORPTION', { climaxMultiplier: val })}
                        min={1.2} max={3.0} step={0.1}
                        unit="x"
                        description="Múltiplo do volume médio para identificar um pico. Ideal: 1.8 - 2.2."
                    />
                     <StrategyTuningItem
                        title="Multiplicador ATR de Clímax"
                        paramKey="absorb-atr"
                        value={params.VOLUME_ABSORPTION.atrMultiplier}
                        onValueChange={(val) => onParamChange('VOLUME_ABSORPTION', { atrMultiplier: val })}
                        min={0.5} max={2.5} step={0.1}
                        unit="x"
                        description="Fator pelo qual o range da vela de clímax deve superar o ATR."
                    />
                    <StrategyTuningItem
                        title="Fator de Absorção"
                        paramKey="absorb-factor"
                        value={params.VOLUME_ABSORPTION.absorptionFactor}
                        onValueChange={(val) => onParamChange('VOLUME_ABSORPTION', { absorptionFactor: val })}
                        min={0.5} max={0.9} step={0.05}
                        description="Volume de absorção deve ser menor que clímax × este fator. Ideal: 0.7 - 0.8."
                    />
                </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="MICROSTRUCTURE_SCALP">
                <AccordionTrigger>Scalping de Fluxo</AccordionTrigger>
                <AccordionContent className="space-y-4 pt-2">
                    <StrategyTuningItem
                        title="Velocidade Mínima"
                        paramKey="scalp-velocity"
                        value={params.MICROSTRUCTURE_SCALP.velocityThreshold}
                        onValueChange={(val) => onParamChange('MICROSTRUCTURE_SCALP', { velocityThreshold: val })}
                        min={0.5} max={5.0} step={0.1}
                        unit=" t/s"
                        description="Número de ticks por segundo para considerar 'alta frequência'. Ideal: 1.5 - 2.0."
                    />
                </AccordionContent>
            </AccordionItem>
            <AccordionItem value="GBM">
                <AccordionTrigger>Especialistas Preditivos (GBM)</AccordionTrigger>
                <AccordionContent className="space-y-4 pt-2">
                    <StrategyTuningItem
                        title="Limiar de Confiança GBM"
                        paramKey="gbm-confidence"
                        value={gbmConfidenceThreshold}
                        onValueChange={(val) => onParamChange('GBM', { confidenceThreshold: val })}
                        min={5} max={40} step={1}
                        unit="%"
                        description="Confiança mínima para um sinal GBM ser válido. Valores baixos (10-15%) são mais agressivos."
                    />
                </AccordionContent>
            </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
