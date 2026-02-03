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
import type { RobotPerformance, CouncilVotes } from '@/lib/types';
import { Bot, LayoutGrid, AlertTriangle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface TradingDeskDigitsProps {
    isMeritocracyOn: boolean;
    setIsMeritocracyOn: (isOn: boolean) => void;
    isCouncilAutopilotOn: boolean;
    robotPerformance: RobotPerformance[];
    councilVotes: CouncilVotes; 
}

export function TradingDeskDigits({
    isMeritocracyOn,
    setIsMeritocracyOn,
    isCouncilAutopilotOn,
    robotPerformance,
}: TradingDeskDigitsProps) {

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
                           O modo Arena para dígitos ainda está em desenvolvimento.
                        </CardDescription>
                    </div>
                    <div className="flex items-center space-x-2 rounded-lg border p-3 shadow-sm shrink-0">
                        <div className="space-y-0.5">
                            <Label htmlFor="meritocracy-switch-desk" className="font-semibold">
                                Modo Meritocracia
                            </Label>
                        </div>
                        <Switch
                            id="meritocracy-switch-desk"
                            checked={false}
                            disabled={true}
                        />
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Estratégia</TableHead>
                            <TableHead className="text-center">Voto Atual</TableHead>
                            <TableHead className="text-center">Taxa de Acerto</TableHead>
                            <TableHead className="text-right">P&amp;L (USD)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <TableRow>
                            <TableCell colSpan={4} className="text-center h-24">
                                <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                    <AlertTriangle className="h-8 w-8" />
                                    <p>
                                       Funcionalidade em desenvolvimento.
                                    </p>
                                </div>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
