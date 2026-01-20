// src/features/trading/components/deriv-trader/indicator-panel.tsx
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ChartData, CandleData } from '@/lib/types';
import type { Indicators } from '@/services/indicator-service';
import { Gauge } from 'lucide-react';

interface IndicatorPanelProps {
  indicators: Indicators;
  latestDataPoint: ChartData | null;
}

const formatValue = (value: number | null | undefined, precision = 4) => {
    if (value === null || value === undefined || isNaN(value)) return '...';
    return value.toFixed(precision);
};

const isCandle = (d: ChartData | null): d is CandleData => d !== null && 'close' in d;

export function IndicatorPanel({ indicators, latestDataPoint }: IndicatorPanelProps) {
    if (!indicators) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2 text-primary">
                    <Gauge className="h-5 w-5" />
                    Painel de Indicadores
                </CardTitle>
                <CardDescription>
                    Valores em tempo real calculados pelo motor da Mesa Operacional.
                </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-4 text-sm font-mono">
                <div className="space-y-1">
                    <h4 className="font-bold text-muted-foreground">API (Dados Brutos)</h4>
                    {isCandle(latestDataPoint) ? (
                        <>
                            <p>Abertura: <span className="font-bold text-foreground">{formatValue(latestDataPoint.open)}</span></p>
                            <p>Máxima: <span className="font-bold text-foreground">{formatValue(latestDataPoint.high)}</span></p>
                            <p>Mínima: <span className="font-bold text-foreground">{formatValue(latestDataPoint.low)}</span></p>
                            <p>Fecho: <span className="font-bold text-foreground">{formatValue(latestDataPoint.close)}</span></p>
                        </>
                    ) : latestDataPoint && 'price' in latestDataPoint ? (
                         <p>Preço: <span className="font-bold text-foreground">{formatValue(latestDataPoint.price)}</span></p>
                    ): (
                        <p>Aguardando dados...</p>
                    )}
                </div>
                 <div className="space-y-1">
                    <h4 className="font-bold text-muted-foreground">Momentum</h4>
                    <p>RSI: <span className="font-bold text-foreground">{formatValue(indicators.rsi, 2)}</span></p>
                    <p>Stoch: <span className="font-bold text-foreground">{formatValue(indicators.stoch, 2)}</span></p>
                    <p>StochRSI: <span className="font-bold text-foreground">{formatValue(indicators.stochRSI, 2)}</span></p>
                    <p>TRIX: <span className="font-bold text-foreground">{formatValue(indicators.trix, 2)}</span></p>
                    <p>ROC: <span className="font-bold text-foreground">{formatValue(indicators.roc, 2)}</span></p>
                </div>
                 <div className="space-y-1">
                    <h4 className="font-bold text-muted-foreground">Osciladores</h4>
                    <p>MACD: <span className="font-bold text-foreground">{formatValue(indicators.macd.macd)}</span></p>
                    <p>Sinal: <span className="font-bold text-foreground">{formatValue(indicators.macd.signal)}</span></p>
                    <p>Hist: <span className="font-bold text-foreground">{formatValue(indicators.macd.histogram, 2)}</span></p>
                    <p>Awesome: <span className="font-bold text-foreground">{formatValue(indicators.ao, 2)}</span></p>
                </div>
                 <div className="space-y-1">
                    <h4 className="font-bold text-muted-foreground">Tendência</h4>
                    <p>ADX: <span className="font-bold text-foreground">{formatValue(indicators.adx, 2)}</span></p>
                    <p>+DI: <span className="font-bold text-foreground">{formatValue(indicators.pdi, 2)}</span></p>
                    <p>-DI: <span className="font-bold text-foreground">{formatValue(indicators.ndi, 2)}</span></p>
                    <p>SAR: <span className="font-bold text-foreground">{formatValue(indicators.psar)}</span></p>
                </div>
                 <div className="space-y-1">
                    <h4 className="font-bold text-muted-foreground">Volatilidade & Bandas</h4>
                    <p>ATR: <span className="font-bold text-foreground">{formatValue(indicators.atr, 4)}</span></p>
                    <p>BBW: <span className="font-bold text-foreground">{formatValue(indicators.bbw, 2)}%</span></p>
                    <p>Z-Score: <span className="font-bold text-foreground">{formatValue(indicators.zScore, 2)}</span></p>
                    <p>BB Sup: <span className="font-bold text-foreground">{formatValue(indicators.bb?.upper)}</span></p>
                    <p>BB Mid: <span className="font-bold text-foreground">{formatValue(indicators.bb?.middle)}</span></p>
                    <p>BB Inf: <span className="font-bold text-foreground">{formatValue(indicators.bb?.lower)}</span></p>
                </div>
                <div className="space-y-1">
                    <h4 className="font-bold text-muted-foreground">Médias/Volume</h4>
                    <p>MA Curta: <span className="font-bold text-foreground">{formatValue(indicators.ma?.short)}</span></p>
                    <p>MA Longa: <span className="font-bold text-foreground">{formatValue(indicators.ma?.long)}</span></p>
                    <p>KAMA: <span className="font-bold text-foreground">{formatValue(indicators.kama)}</span></p>
                    <p>VWAP: <span className="font-bold text-foreground">{indicators.vwap.length > 0 ? formatValue(indicators.vwap[indicators.vwap.length - 1]) : '...'}</span></p>
                </div>
                 <div className="space-y-1">
                    <h4 className="font-bold text-muted-foreground">Volume/Fluxo</h4>
                     <p>MFI: <span className="font-bold text-foreground">{formatValue(indicators.mfi, 2)}</span></p>
                     <p>OBV: <span className="font-bold text-foreground">{formatValue(indicators.obv, 0)}</span></p>
                </div>
                 <div className="space-y-1">
                    <h4 className="font-bold text-muted-foreground">Nuvem Ichimoku</h4>
                     <p>Tenkan: <span className="font-bold text-foreground">{formatValue(indicators.ichimoku?.tenkan)}</span></p>
                     <p>Kijun: <span className="font-bold text-foreground">{formatValue(indicators.ichimoku?.kijun)}</span></p>
                     <p>SenkouA: <span className="font-bold text-foreground">{formatValue(indicators.ichimoku?.spanA)}</span></p>
                     <p>SenkouB: <span className="font-bold text-foreground">{formatValue(indicators.ichimoku?.spanB)}</span></p>
                </div>
            </CardContent>
        </Card>
    );
}
