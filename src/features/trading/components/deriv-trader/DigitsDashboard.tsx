// src/features/trading/components/deriv-trader/DigitsDashboard.tsx
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, XCircle, HelpCircle, BarChart2, TrendingUp, TrendingDown, Info, Sigma, Wand2, Target, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SignalQuality, MultiWindowAnalysis } from '@/features/trading/hooks/use-robot-council-digits';
import type { VagalumeSignal } from '@/features/trading/hooks/use-vagalume-alternante';
import { Separator } from '@/components/ui/separator';

interface DigitsDashboardProps {
  signalQuality: SignalQuality | null;
  multiWindowAnalysis: MultiWindowAnalysis | null;
  vagalumeSignal: VagalumeSignal | null;
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
                <CardDescription>Sinal (Contra-Tendência)</CardDescription>
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

const VagalumeStatusCard: React.FC<{ signal: VagalumeSignal | null }> = ({ signal }) => {
    if (!signal) {
        return (
            <Card className="flex items-center justify-center text-muted-foreground p-4 border-dashed">
                <div className="text-center">
                    <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin opacity-50" />
                    <p className="font-semibold text-sm">Vagalume Aguardando</p>
                    <p className="text-xs">Analisando padrão de W/L...</p>
                </div>
            </Card>
        );
    }

  return (
    <Card className="border-purple-500/50 bg-purple-50/50">
        <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between">
                <span>Diário de Bordo: Vagalume</span>
                 <Badge variant="outline" className="border-purple-500/50 bg-white text-purple-600">
                    Estado: {signal.state}
                </Badge>
            </CardDescription>
             <CardTitle className={cn("flex items-center gap-3 text-2xl font-bold text-purple-700")}>
                <Wand2 className="h-7 w-7" />
                <span>{signal.suggestedContract.replace('DIGIT', '')} {signal.suggestedDigit !== undefined ? signal.suggestedDigit : ''}</span>
            </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
             <div className="text-xs space-y-1">
                <div className="flex justify-between">
                    <span>Objetivo do Estado:</span>
                    <span className="font-semibold">{signal.targetOutcome}</span>
                </div>
                <div className="flex justify-between">
                    <span>Confiança do Sinal:</span>
                    <span className="font-mono">{(signal.confidence * 100).toFixed(1)}%</span>
                </div>
             </div>
             <Separator/>
             <div className="text-xs space-y-1">
                <div className="flex justify-between">
                    <span >Taxa de Alternância:</span>
                    <span className="font-semibold">{signal.sequenceStats.alternanceRate.toFixed(0)}%</span>
                </div>
                 <div className="flex justify-between">
                    <span>Sequência Atual:</span>
                    <span className="font-semibold">{signal.sequenceStats.currentStreak}</span>
                </div>
             </div>
        </CardContent>
    </Card>
  )
}

const StatsCard: React.FC<{ title: string, value: string | number, icon: React.ReactNode }> = ({ title, value, icon }) => (
    <div className="flex flex-col items-center justify-center p-3 rounded-lg border bg-background text-center">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{title}</div>
        <div className="text-lg font-bold font-mono">{value}</div>
    </div>
);

const DigitsDashboard: React.FC<DigitsDashboardProps> = ({ signalQuality, multiWindowAnalysis, vagalumeSignal }) => {
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
    
    const { mainWindow } = signalQuality;
    const { chiSquare, pValue, isSignificant } = mainWindow.chiSquare;
    const targetFreq = mainWindow.frequencies.find(f => f.digit === signalQuality.targetDigit);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline">Dashboard de Análise Estatística</CardTitle>
                <CardDescription>Visão em tempo real da qualidade dos sinais e da saúde do mercado.</CardDescription>
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
                                <p className="text-xs">Nenhum desvio estatístico detectado.</p>
                            </div>
                        </Card>
                    )}
                    <VagalumeStatusCard signal={vagalumeSignal} />
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                     <StatsCard 
                        title="Consenso Multi-Janela" 
                        value={multiWindowAnalysis.consensusStrength.replace('_', ' ')} 
                        icon={<BarChart2 className="h-4 w-4"/>} 
                    />
                    <StatsCard 
                        title="Z-Score (Alvo)" 
                        value={targetFreq?.zScore.toFixed(2) || 'N/A'}
                        icon={<Sigma className="h-4 w-4"/>}
                    />
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
