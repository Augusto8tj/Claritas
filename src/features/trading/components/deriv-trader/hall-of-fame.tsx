// src/features/trading/components/deriv-trader/hall-of-fame.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { RobotStrategy, RobotPerformance } from '@/lib/types';
import { BrainCircuit, Activity, Waves, CandlestickChart, Bot, Trophy, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { getHallOfFame } from '@/services/financial-data-service';

const indicatorIcons: { [key: string]: React.ReactNode } = {
    RSI: <BrainCircuit className="h-4 w-4" />,
    STOCHASTIC: <BrainCircuit className="h-4 w-4" />,
    MOVING_AVERAGE_CROSS: <Activity className="h-4 w-4" />,
    BOLLINGER_BANDS: <Waves className="h-4 w-4" />,
    MACD_CROSS: <Activity className="h-4 w-4" />,
    PRICE_ACTION_PATTERN: <CandlestickChart className="h-4 w-4" />,
    ADX_TREND: <BrainCircuit className="h-4 w-4" />,
    ICHIMOKU_CLOUD: <Waves className="h-4 w-4" />,
    AWESOME_OSCILLATOR: <Activity className="h-4 w-4" />,
    VOLUME_PROFILE: <Activity className="h-4 w-4" />,
};

function renderStrategyParams(robot: RobotStrategy) {
    switch (robot.strategyType) {
        case 'RSI':
            return `Compra < ${robot.strongBuyThreshold}, Venda > ${robot.strongSellThreshold}`;
        case 'STOCHASTIC':
            return `Compra < ${robot.strongBuyThreshold}, Venda > ${robot.strongSellThreshold}`;
        case 'MOVING_AVERAGE_CROSS':
            return `Cruzamento ${robot.shortPeriod}/${robot.longPeriod}`;
        case 'BOLLINGER_BANDS':
            return `Período: ${robot.period}, Desv. Padrão: ${robot.stdDev}`;
        case 'MACD_CROSS':
            return `Parâmetros: ${robot.fastPeriod}/${robot.slowPeriod}/${robot.signalPeriod}`;
        case 'PRICE_ACTION_PATTERN':
            const pattern = robot.pattern === 'hammer' ? 'Martelo' : 'Estrela Cadente';
            return `Padrão: ${pattern}`;
        case 'ADX_TREND':
            return `Limiar de Força > ${robot.trendStrengthThreshold}`;
        default:
            return "N/A";
    }
}


export function HallOfFame() {
    const { user } = useAuth();
    const [hallOfFame, setHallOfFame] = useState<RobotPerformance[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        };

        const fetchFame = async () => {
            setLoading(true);
            try {
                const famedRobots = await getHallOfFame(user.uid);
                setHallOfFame(famedRobots);
            } catch (error) {
                console.error("Failed to load Hall of Fame from Firestore", error);
                setHallOfFame([]);
            }
            setLoading(false);
        }

        fetchFame();
    }, [user]);

    if (loading) {
        return (
            <div className="flex justify-center items-center p-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                    <Trophy className="w-6 h-6 text-amber-500" />
                    Hall da Fama dos Robôs
                </CardTitle>
                <CardDescription>
                    Um registo permanente dos robôs-analistas mais lucrativos e consistentes. Apenas robôs com mais de 10 vitórias e lucro positivo são elegíveis.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Estratégia</TableHead>
                            <TableHead>Parâmetros</TableHead>
                            <TableHead className="text-center">Vitórias</TableHead>
                            <TableHead className="text-center">Derrotas</TableHead>
                            <TableHead className="text-right">Lucro Total (USD)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {hallOfFame.length > 0 ? (
                            hallOfFame.map((robot) => (
                                <TableRow key={robot.id}>
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                            {indicatorIcons[robot.strategyType] || <Bot />}
                                            <span>{robot.strategyType}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">{renderStrategyParams(robot.strategy)}</TableCell>
                                    <TableCell className="text-center font-semibold text-green-600">{robot.wins}</TableCell>
                                    <TableCell className="text-center font-semibold text-red-600">{robot.losses}</TableCell>
                                    <TableCell className={cn(
                                        "text-right font-bold",
                                        robot.totalProfit > 0 ? "text-green-600" : "text-red-600"
                                    )}>
                                        ${robot.totalProfit.toFixed(2)}
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center h-24">
                                    Nenhum robô foi promovido ao Hall da Fama ainda. Continue a sessão.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
