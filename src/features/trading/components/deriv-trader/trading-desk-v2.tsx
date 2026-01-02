// src/features/trading/components/deriv-trader/trading-desk-v2.tsx
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import type { EnhancedRobotPerformance, RobotStrategy } from '@/lib/types';
import {
    BrainCircuit,
    Activity,
    Waves,
    CandlestickChart,
    Bot,
    LayoutGrid,
    BarChart,
    TrendingUp,
    Cloud,
    CheckCircle,
    XCircle,
    Trophy,
    AlertTriangle,
    RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';

interface TradingDeskV2Props {
    robotPerformance: EnhancedRobotPerformance[];
    isCouncilAutopilotOn: boolean;
    resetArenaPerformance: () => void;
}

const indicatorIcons: { [key: string]: React.ReactNode } = {
    RSI: <BrainCircuit className="h-4 w-4" />,
    STOCHASTIC: <BrainCircuit className="h-4 w-4" />,
    MOVING_AVERAGE_CROSS: <Activity className="h-4 w-4" />,
    BOLLINGER_BANDS: <Waves className="h-4 w-4" />,
    MACD_CROSS: <Activity className="h-4 w-4" />,
    PRICE_ACTION_PATTERN: <CandlestickChart className="h-4 w-4" />,
    ADX_TREND: <TrendingUp className="h-4 w-4" />,
    ICHIMOKU_CLOUD: <Cloud className="h-4 w-4" />,
    AWESOME_OSCILLATOR: <BarChart className="h-4 w-4" />,
    VOLUME_PROFILE: <Activity className="h-4 w-4" />,
    KAMA: <Activity className="h-4 w-4" />,
    VWAP: <Activity className="h-4 w-4" />,
    Z_SCORE: <BrainCircuit className="h-4 w-4" />,
    STOCH_RSI: <BrainCircuit className="h-4 w-4" />,
    MFI: <BrainCircuit className="h-4 w-4" />,
    TRIX: <Activity className="h-4 w-4" />,
    ROC: <Activity className="h-4 w-4" />,
    DONCHIAN_CHANNELS: <Waves className="h-4 w-4" />,
    RVI: <BrainCircuit className="h-4 w-4" />,
    PARABOLIC_SAR: <TrendingUp className="h-4 w-4" />,
    CHANDELIER_EXIT: <TrendingUp className="h-4 w-4" />,
    OBV: <Activity className="h-4 w-4" />,
};

function renderStrategyParams(robot: RobotStrategy): string {
    switch (robot.strategyType) {
        case 'RSI':
        case 'STOCHASTIC':
        case 'MFI':
        case 'RVI':
            return `Forte < ${robot.strongBuyThreshold}, Fraco < ${robot.weakBuyThreshold}`;
        case 'STOCH_RSI':
            return `Forte < ${robot.strongBuyThreshold?.toFixed(2)}, Fraco < ${robot.weakBuyThreshold?.toFixed(2)}`;
        case 'MOVING_AVERAGE_CROSS':
            return `Cruzamento ${robot.shortPeriod}/${robot.longPeriod}`;
        case 'BOLLINGER_BANDS':
            return `Período: ${robot.period}, Desvio: ${robot.stdDev}`;
        case 'MACD_CROSS':
            return `${robot.fastPeriod}/${robot.slowPeriod}/${robot.signalPeriod}`;
        case 'ADX_TREND':
            return `Tendência > ${robot.trendStrengthThreshold}`;
        default:
            return 'N/A';
    }
}

export function TradingDeskV2({ robotPerformance, isCouncilAutopilotOn, resetArenaPerformance }: TradingDeskV2Props) {
    
    const sortedPerformance = [...robotPerformance].sort((a, b) => {
        const sharpeA = a.sharpeRatio || -Infinity;
        const sharpeB = b.sharpeRatio || -Infinity;
        if (sharpeA !== sharpeB) return sharpeB - sharpeA;
        return (b.totalProfit || 0) - (a.totalProfit || 0);
    });

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <CardTitle className="font-headline flex items-center gap-2">
                        <LayoutGrid className="w-5 h-5" />
                        Arena Virtual V2.0: Análise de Sharpe
                    </CardTitle>
                    <Button onClick={resetArenaPerformance} variant="outline" size="sm" disabled={!isCouncilAutopilotOn}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Resetar Arena
                    </Button>
                </div>
                <CardDescription>
                    Ranking de robôs pela sua performance ajustada ao risco (Sharpe Ratio). O desempenho é resetado ao trocar de ativo.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Estratégia</TableHead>
                            <TableHead>Parâmetros</TableHead>
                            <TableHead className="text-center">Trades (V/D)</TableHead>
                            <TableHead className="text-center">Sharpe Ratio</TableHead>
                            <TableHead className="text-right">P&L (USD)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sortedPerformance.length > 0 ? (
                            sortedPerformance.map((robot, index) => {
                                const totalTrades = (robot.wins || 0) + (robot.losses || 0);
                                const isTopPerformer = index < 3;
                                
                                return (
                                    <TableRow
                                        key={robot.id}
                                        className={cn(isTopPerformer && 'bg-muted/30')}
                                    >
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                {isTopPerformer && index === 0 && (
                                                    <Trophy className="h-4 w-4 text-yellow-500" />
                                                )}
                                                {indicatorIcons[robot.strategyType] || <Bot />}
                                                <span className="text-sm">
                                                    {robot.strategyType}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {renderStrategyParams(robot.strategy)}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <span className="flex items-center gap-1 text-green-600">
                                                    <CheckCircle className="h-4 w-4" />
                                                    {robot.wins || 0}
                                                </span>
                                                <span>/</span>
                                                <span className="flex items-center gap-1 text-red-600">
                                                    {robot.losses || 0}
                                                    <XCircle className="h-4 w-4" />
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center font-semibold">
                                            {totalTrades > 10 ? robot.sharpeRatio.toFixed(2) : '-'}
                                        </TableCell>
                                        <TableCell
                                            className={cn(
                                                'text-right font-bold',
                                                (robot.totalProfit || 0) > 0
                                                    ? 'text-green-600'
                                                    : (robot.totalProfit || 0) < 0
                                                      ? 'text-red-600'
                                                      : 'text-muted-foreground'
                                            )}
                                        >
                                            {(robot.totalProfit || 0).toLocaleString('en-US', {
                                                style: 'currency',
                                                currency: 'USD',
                                                minimumFractionDigits: 2,
                                            })}
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        ) : (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center h-24">
                                    <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                        <AlertTriangle className="h-8 w-8" />
                                        <p>
                                            Nenhum desempenho registrado. Ative a Mesa Operacional
                                            para iniciar a simulação.
                                        </p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
