// src/features/trading/components/deriv-trader/trading-desk-digits.tsx
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
import type { RobotPerformance } from '@/lib/types';
import { Bot, LayoutGrid, CheckCircle, XCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';

interface TradingDeskDigitsProps {
    isCouncilAutopilotOn: boolean;
    robotPerformance: RobotPerformance[];
}

export function TradingDeskDigits({
    isCouncilAutopilotOn,
    robotPerformance,
}: TradingDeskDigitsProps) {

    const sortedPerformance = useMemo(() => {
        if (!robotPerformance) return [];
        return [...robotPerformance].sort((a, b) => (b.totalProfit || 0) - (a.totalProfit || 0));
    }, [robotPerformance]);


    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div>
                        <CardTitle className="font-headline flex items-center gap-2">
                            <LayoutGrid className="w-5 h-5" />
                            Arena Virtual (Digits)
                        </CardTitle>
                        <CardDescription>
                           Desempenho em tempo real das estratégias simuladas.
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Estratégia</TableHead>
                            <TableHead className="text-center">Score (V/D)</TableHead>
                            <TableHead className="text-center w-[120px]">Taxa de Acerto</TableHead>
                            <TableHead className="text-right">P&amp;L (USD)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!isCouncilAutopilotOn || sortedPerformance.length === 0 ? (
                             <TableRow>
                                <TableCell colSpan={4} className="text-center h-24">
                                    <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                        <Bot className="h-8 w-8" />
                                        <p>
                                        Ative o piloto para iniciar a simulação da arena.
                                        </p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                           sortedPerformance.map((robot) => (
                                <TableRow key={robot.id}>
                                    <TableCell className="font-semibold text-sm">
                                        {(robot.strategy as any).description}
                                    </TableCell>
                                    <TableCell className="text-center">
                                         <div className="flex items-center justify-center gap-2">
                                            <span className="flex items-center gap-1 text-green-600">
                                                <CheckCircle className="h-4 w-4" />
                                                {robot.wins || 0}
                                            </span>
                                            <span className="text-muted-foreground">/</span>
                                            <span className="flex items-center gap-1 text-red-600">
                                                {robot.losses || 0}
                                                <XCircle className="h-4 w-4" />
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {((robot.wins || 0) + (robot.losses || 0)) > 0 ? (
                                             <div className="flex items-center justify-center gap-2">
                                                 <span className="font-mono">{robot.winRate?.toFixed(1)}%</span>
                                                  <Progress
                                                    value={robot.winRate}
                                                    className="w-16 h-1.5"
                                                    indicatorClassName={
                                                        (robot.winRate || 0) >= 50 ? 'bg-green-500' : 'bg-red-500'
                                                    }
                                                />
                                             </div>
                                        ) : (
                                            <span className="text-muted-foreground">-</span>
                                        )}
                                    </TableCell>
                                     <TableCell
                                        className={cn(
                                            'text-right font-bold font-mono',
                                            (robot.totalProfit || 0) > 0 ? 'text-green-600' : (robot.totalProfit || 0) < 0 ? 'text-red-600' : 'text-muted-foreground'
                                        )}
                                    >
                                        {(robot.totalProfit || 0).toLocaleString('en-US', {
                                            style: 'currency',
                                            currency: 'USD',
                                        })}
                                    </TableCell>
                                </TableRow>
                           ))
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
