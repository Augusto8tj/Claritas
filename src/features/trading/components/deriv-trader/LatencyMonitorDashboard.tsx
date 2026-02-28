// src/features/trading/components/deriv-trader/LatencyMonitorDashboard.tsx
'use client';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Gauge, ChevronsRight } from 'lucide-react';
import { LatencyMetrics } from '../../utils/latency-monitor';
import { cn } from '@/lib/utils';

interface LatencyMonitorDashboardProps {
    metrics: LatencyMetrics | null;
}

export function LatencyMonitorDashboard({ metrics }: LatencyMonitorDashboardProps) {
    if (!metrics || metrics.tradeCount < 1) {
        return (
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2 text-blue-300">
                        <Gauge className="h-5 w-5" />
                        Monitor de Latência
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-xs text-muted-foreground">Aguardando as primeiras operações manuais para calibrar...</p>
                </CardContent>
            </Card>
        );
    }
    
    const { avgLatency, p95Latency, maxLatency, compensationSteps, tradeCount } = metrics;
    const latencyColor = avgLatency > 250 ? 'text-red-500' : avgLatency > 150 ? 'text-amber-500' : 'text-green-500';

    return (
        <Card className="border-blue-500/20 bg-blue-950/10">
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-blue-300">
                    <Gauge className="h-5 w-5" />
                    Monitor de Latência e Compensação
                </CardTitle>
                <CardDescription className="text-blue-400/80 text-xs">
                    Medição do delay total (tick → resultado) para ajustar a predição.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="p-2 bg-background/50 rounded-lg">
                        <p className="text-xs text-muted-foreground">Latência Média</p>
                        <p className={cn("text-xl font-bold", latencyColor)}>
                            {avgLatency.toFixed(0)}<span className="text-sm">ms</span>
                        </p>
                    </div>
                    <div className="p-2 bg-background/50 rounded-lg">
                        <p className="text-xs text-muted-foreground">Compensação Ativa</p>
                        <p className="text-xl font-bold text-primary">
                            {compensationSteps} <span className="text-sm">tick(s)</span>
                        </p>
                    </div>
                </div>
                 <div className="text-xs space-y-1 text-muted-foreground">
                    <div className="flex justify-between">
                        <span>P95 (pior 5%):</span>
                        <span className="font-mono">{p95Latency.toFixed(0)}ms</span>
                    </div>
                     <div className="flex justify-between">
                        <span>Máxima Latência:</span>
                        <span className="font-mono">{maxLatency.toFixed(0)}ms</span>
                    </div>
                     <div className="flex justify-between">
                        <span>Trades Medidos:</span>
                        <span className="font-mono">{tradeCount}</span>
                    </div>
                 </div>
            </CardContent>
        </Card>
    );
}
