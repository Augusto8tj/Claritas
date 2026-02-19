// src/features/trading/components/hf-trader/HFAutoCalibrator.tsx
'use client';

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Bot, Loader2 } from 'lucide-react';
import type { StrategyType } from '../../services/hf-strike-logic';

interface HFAutoCalibratorProps {
    isCalibrating: boolean;
    calibrationProgress: Record<StrategyType, { progress: number; details: string }>;
    onCalibrate: (targetFrequency: number) => void;
}

export function HFAutoCalibrator({ isCalibrating, calibrationProgress, onCalibrate }: HFAutoCalibratorProps) {
    const [targetFrequency, setTargetFrequency] = useState(10);
    
    const strategiesBeingCalibrated = Object.keys(calibrationProgress) as StrategyType[];

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-primary" />
                    Calibrador Automático de Estratégia
                </CardTitle>
                <CardDescription>
                    Ajuste fino automático dos parâmetros de cada especialista para atingir uma frequência de trade desejada, sem sacrificar a qualidade.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <div className="flex justify-between items-center mb-1">
                        <Label htmlFor="target-frequency-slider" className="font-medium">Target de Frequência de Trades</Label>
                        <span className="font-mono text-primary font-semibold">{targetFrequency} trades / 1500 velas</span>
                    </div>
                    <Slider
                        id="target-frequency-slider"
                        min={1}
                        max={50}
                        step={1}
                        value={[targetFrequency]}
                        onValueChange={(value) => setTargetFrequency(value[0])}
                        disabled={isCalibrating}
                    />
                    <p className="text-xs text-muted-foreground pt-1">Define o número mínimo de operações que cada estratégia deve gerar no backtest de 1500 velas.</p>
                </div>

                <Button onClick={() => onCalibrate(targetFrequency)} disabled={isCalibrating} className="w-full">
                    {isCalibrating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
                    {isCalibrating ? 'A Calibrar...' : 'Iniciar Calibração'}
                </Button>

                {isCalibrating && strategiesBeingCalibrated.length > 0 && (
                    <div className="space-y-4 pt-4 border-t">
                        <h4 className="font-semibold text-sm">Progresso da Calibração:</h4>
                        {strategiesBeingCalibrated.map(strategy => (
                            <div key={strategy} className="space-y-2">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="font-medium">{strategy}</span>
                                    <span className="text-muted-foreground">{calibrationProgress[strategy].progress.toFixed(0)}%</span>
                                </div>
                                <Progress value={calibrationProgress[strategy].progress} />
                                <p className="text-xs text-muted-foreground italic">{calibrationProgress[strategy].details}</p>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
