// src/features/trading/components/deriv-trader/DigitsDashboard.tsx
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, XCircle, HelpCircle, BarChart2, TrendingUp, TrendingDown, Info, Sigma } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SignalQuality, MultiWindowAnalysis } from '@/features/trading/hooks/use-robot-council-digits';

interface DigitsDashboardProps {
  signalQuality: SignalQuality | null;
  multiWindowAnalysis: MultiWindowAnalysis | null;
}

const confidenceColors: Record<string, string> = {
    'MUITO_ALTA': 'bg-green-600 border-green-700 text-white',
    'ALTA': 'bg-green-500 border-green-600 text-white',
    'MEDIA': 'bg-yellow-400 border-yellow-500 text-yellow-900',
    'BAIXA': 'bg-orange-400 border-orange-500 text-orange-900',
    'NULA': 'bg-muted text-muted-foreground',
};

const SignalCard: React.FC<{ signal: SignalQuality }> = ({ signal }) => {
    const isDiffers = signal.contractType === 'DIGITDIFF';
    const Icon = isDiffers ? TrendingDown : TrendingUp;
    const colorClass = isDiffers ? 'text-red-600' : 'text-green-600';

    return (
        <Card className={cn(
            "border-2", 
            isDiffers ? "border-red-500/50 bg-red-50/50" : "border-green-500/50 bg-green-50/50"
        )}>
            <CardHeader className="pb-2">
                <CardDescription>Sinal de Trade Atual</CardDescription>
                <CardTitle className={cn("flex items-center gap-3 text-3xl font-bold", colorClass)}>
                    <Icon className="h-8 w-8" />
                    <span>{signal.contractType.replace('DIGIT', '')} {signal.targetDigit}</span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                 <Badge className={cn("text-xs w-full justify-center", confidenceColors[signal.confidenceLevel])}>
                    Confiança: {signal.confidenceLevel.replace('_', ' ')}
                </Badge>
            </CardContent>
        </Card>
    );
};

const StatsCard: React.FC<{ title: string, value: string | number, icon: React.ReactNode }> = ({ title, value, icon }) => (
    <div className="flex flex-col items-center justify-center p-3 rounded-lg border bg-background text-center">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{title}</div>
        <div className="text-lg font-bold font-mono">{value}</div>
    </div>
);

const DigitsDashboard: React.FC<DigitsDashboardProps> = ({ signalQuality, multiWindowAnalysis }) => {
    if (!signalQuality || !multiWindowAnalysis) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Dashboard Estatístico</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-center text-muted-foreground py-8">
                        Aguardando dados suficientes para análise...
                    </div>
                </CardContent>
            </Card>
        );
    }
    
    const { mainWindow, multiWindowAnalysis: mwa } = signalQuality;
    const { chiSquare, pValue, isSignificant } = mainWindow.chiSquare;
    const targetFreq = mainWindow.frequencies.find(f => f.digit === signalQuality.targetDigit);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline">Dashboard de Análise Estatística</CardTitle>
                <CardDescription>Visão em tempo real da qualidade do sinal e da saúde do mercado de dígitos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {signalQuality.confidenceLevel !== 'NULA' ? (
                        <SignalCard signal={signalQuality} />
                    ) : (
                        <Card className="flex items-center justify-center text-muted-foreground text-center p-4">
                            <div>
                                <HelpCircle className="h-8 w-8 mx-auto mb-2 opacity-50"/>
                                <p className="font-semibold">Sinal Neutro</p>
                                <p className="text-xs">Nenhum desvio estatístico significativo detectado.</p>
                            </div>
                        </Card>
                    )}

                    <div className="space-y-3">
                         <StatsCard 
                            title="Consenso Multi-Janela" 
                            value={mwa.consensusStrength.replace('_', ' ')} 
                            icon={<BarChart2 className="h-4 w-4"/>} 
                        />
                        <div className="grid grid-cols-2 gap-3">
                            <StatsCard 
                                title="Z-Score (Alvo)" 
                                value={targetFreq?.zScore.toFixed(2) || 'N/A'}
                                icon={<Sigma className="h-4 w-4"/>}
                            />
                            <StatsCard 
                                title="p-value (Qui²)" 
                                value={pValue.toFixed(4)}
                                icon={<CheckCircle className="h-4 w-4"/>}
                            />
                        </div>
                    </div>
                </div>
                 <Alert variant={isSignificant ? 'default' : 'destructive'} className={cn(isSignificant && 'bg-green-500/10 border-green-500/30 text-green-800')}>
                    <Info className="h-4 w-4" />
                    <AlertTitle className="font-bold">
                        {isSignificant ? "Distribuição Anômala Detectada" : "Distribuição Aleatória"}
                    </AlertTitle>
                    <AlertDescription className="text-xs">
                        {isSignificant 
                            ? `O p-value (${pValue.toFixed(4)}) é menor que 0.05, indicando que a distribuição atual dos dígitos é estatisticamente improvável de ser aleatória.`
                            : `O p-value (${pValue.toFixed(4)}) é maior que 0.05, sugerindo que a distribuição atual pode ser fruto do acaso. Operações são mais arriscadas.`
                        }
                    </AlertDescription>
                </Alert>
            </CardContent>
        </Card>
    );
};

export default DigitsDashboard;