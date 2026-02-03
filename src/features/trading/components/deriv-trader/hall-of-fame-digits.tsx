// src/features/trading/components/deriv-trader/hall-of-fame-digits.tsx
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trophy } from 'lucide-react';

export function HallOfFameDigits() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                    <Trophy className="w-6 h-6 text-amber-500" />
                    Hall da Fama (Digits)
                </CardTitle>
                <CardDescription>
                    O Hall da Fama para estratégias de dígitos será implementado em breve.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="text-center text-muted-foreground p-10 border-2 border-dashed rounded-lg">
                    <Trophy className="h-10 w-10 mx-auto mb-2 opacity-50"/>
                    <p className="font-semibold">Em desenvolvimento...</p>
                </div>
            </CardContent>
        </Card>
    );
}
