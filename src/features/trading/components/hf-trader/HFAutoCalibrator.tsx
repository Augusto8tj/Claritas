// src/features/trading/components/hf-trader/HFAutoCalibrator.tsx
'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Bot, Loader2, BarChart2, CheckCircle, XCircle, ArrowRight, Trash2 } from 'lucide-react';
import type { StrategyType } from '../../services/hf-strike-logic';
import { strategyMetadata } from '../../services/hf-strike-logic';
import type { AutoCalibrationResults, CalibrationResult } from '../../optimization/auto-calibrator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';

interface HFAutoCalibratorProps {
    isCalibrating: boolean;
    calibrationProgress: Record<StrategyType, { progress: number; details: string }>;
    onCalibrate: (targetFrequency: number, numCandles: number) => void;
    calibrationResults: AutoCalibrationResults | null;
    lastCalibrationTime: number;
    setCalibrationResults: (results: AutoCalibrationResults | null) => void;
}

export function HFAutoCalibrator({ 
    isCalibrating, 
    calibrationProgress, 
    onCalibrate, 
    calibrationResults,
    lastCalibrationTime,
    setCalibrationResults
}: HFAutoCalibratorProps) {
    const [targetFrequency, setTargetFrequency] = useState(10);
    const [calibrationCandles, setCalibrationCandles] = useState(1500);
    
    const strategiesBeingCalibrated = Object.keys(calibrationProgress) as StrategyType[];

    const handleClearResults = () => {
        setCalibrationResults(null);
    };

    const sortedResults = useMemo(() => {
        if (!calibrationResults) return [];
        return Object.entries(calibrationResults)
            .filter(([key, value]) => key !== 'finalGbmThreshold' && value)
            .map(([key, value]) => ({ key: key as StrategyType, value: value as CalibrationResult }))
            .sort((a, b) => (b.value.finalSharpe - b.value.initialSharpe) - (a.value.finalSharpe - a.value.initialSharpe));
    }, [calibrationResults]);

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
                        <Label htmlFor="calibration-candles-slider" className="font-medium flex items-center gap-2">
                            <BarChart2 className="h-4 w-4" />
                            Período de Análise
                        </Label>
                        <span className="font-mono text-primary font-semibold">{calibrationCandles} velas</span>
                    </div>
                    <Slider
                        id="calibration-candles-slider"
                        min={100}
                        max={1500}
                        step={100}
                        value={[calibrationCandles]}
                        onValueChange={(value) => setCalibrationCandles(value[0])}
                        disabled={isCalibrating}
                    />
                    <p className="text-xs text-muted-foreground pt-1">Número de velas recentes para usar no backtest de calibração.</p>
                </div>
                
                <div className="space-y-2">
                    <div className="flex justify-between items-center mb-1">
                        <Label htmlFor="target-frequency-slider" className="font-medium">Target de Frequência de Trades</Label>
                        <span className="font-mono text-primary font-semibold">{targetFrequency} trades / {calibrationCandles} velas</span>
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
                    <p className="text-xs text-muted-foreground pt-1">Define o número mínimo de operações que cada estratégia deve gerar no backtest.</p>
                </div>

                <Button onClick={() => onCalibrate(targetFrequency, calibrationCandles)} disabled={isCalibrating} className="w-full">
                    {isCalibrating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
                    {isCalibrating ? 'A Calibrar...' : 'Iniciar Calibração'}
                </Button>

                {isCalibrating && strategiesBeingCalibrated.length > 0 && (
                    <div className="space-y-4 pt-4 border-t">
                        <h4 className="font-semibold text-sm">Progresso da Calibração:</h4>
                        <ScrollArea className="h-[200px] pr-4">
                            <div className="space-y-4">
                                {strategiesBeingCalibrated.map(strategy => (
                                    <div key={strategy} className="space-y-2">
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-medium">{strategyMetadata[strategy]?.label || strategy}</span>
                                            <span className="text-muted-foreground">{calibrationProgress[strategy].progress.toFixed(0)}%</span>
                                        </div>
                                        <Progress value={calibrationProgress[strategy].progress} />
                                        <p className="text-xs text-muted-foreground italic">{calibrationProgress[strategy].details}</p>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>
                )}
                
                {calibrationResults && !isCalibrating && (
                    <div className="space-y-4 pt-6 border-t">
                        <div className="flex justify-between items-center">
                            <h4 className="font-semibold">Resultados da Última Calibração</h4>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">{new Date(lastCalibrationTime).toLocaleTimeString()}</span>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClearResults} title="Limpar Resultados">
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                        <ScrollArea className="h-[250px]">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Especialista</TableHead>
                                        <TableHead className="text-center">Trades</TableHead>
                                        <TableHead className="text-center">Sharpe</TableHead>
                                        <TableHead>Parâmetros Otimizados</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedResults.map(({ key, value }) => {
                                        const changedParams = value.initialParams ? Object.keys(value.finalParams).filter(pKey => value.finalParams[pKey] !== value.initialParams[pKey]) : [];
                                        return (
                                            <TableRow key={key}>
                                                <TableCell className="text-xs font-semibold">{strategyMetadata[key].label}</TableCell>
                                                <TableCell className="text-center font-mono text-xs">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <span>{value.initialTrades}</span>
                                                        <ArrowRight className="h-3 w-3" />
                                                        <span className="font-bold">{value.finalTrades}</span>
                                                    </div>
                                                </TableCell>
                                                 <TableCell className="text-center font-mono text-xs">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <span>{value.initialSharpe.toFixed(2)}</span>
                                                        <ArrowRight className="h-3 w-3" />
                                                        <span className="font-bold">{value.finalSharpe.toFixed(2)}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-xs font-mono text-muted-foreground">
                                                    {changedParams.length > 0 ? (
                                                        changedParams.map(p => {
                                                            const initialVal = value.initialParams?.[p];
                                                            const finalVal = value.finalParams?.[p];
                                                            return (
                                                                <div key={p}>{p}: {initialVal?.toFixed?.(2) ?? initialVal} → <span className="font-bold text-primary">{finalVal?.toFixed?.(2) ?? finalVal}</span></div>
                                                            );
                                                        })
                                                    ) : (
                                                        <span>Sem alterações</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                     {calibrationResults.finalGbmThreshold && (
                                        <TableRow>
                                            <TableCell className="text-xs font-semibold">Especialistas GBM</TableCell>
                                            <TableCell colSpan={3} className="text-xs font-mono">
                                                Limiar de Confiança → <span className="font-bold text-primary">{calibrationResults.finalGbmThreshold}%</span>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
