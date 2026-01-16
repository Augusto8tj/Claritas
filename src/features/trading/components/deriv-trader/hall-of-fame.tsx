// src/features/trading/components/deriv-trader/hall-of-fame.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { RobotStrategy, RobotPerformance } from '@/lib/types';
import { Bot, Trophy, Loader2, Settings, Dna } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { loadRobotPerformance } from '@/services/financial-data-service';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";


const StrategyDetails = ({ strategy }: { strategy: RobotStrategy }) => {
    const params = Object.entries(strategy)
        .filter(([key, value]) => value !== undefined && value !== null && !['id', 'strategyType', 'justification'].includes(key))
        .map(([key, value]) => ({ key, value }));

    if (params.length === 0) {
        return <p className="text-xs text-muted-foreground p-3 bg-muted/50 rounded-md border">Sem parâmetros específicos para esta estratégia.</p>;
    }

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-2 text-xs font-mono p-3 bg-muted/50 rounded-md border">
            {params.map(({ key, value }) => (
                <div key={key} className="flex flex-col overflow-hidden">
                    <span className="text-muted-foreground capitalize truncate">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                    <span className="font-semibold text-foreground">{String(value)}</span>
                </div>
            ))}
        </div>
    );
};


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
                const performanceData = await loadRobotPerformance(user.uid, 'v1');
                 if (!performanceData) {
                    setHallOfFame([]);
                    return;
                }
                
                const PROMOTION_THRESHOLD_WINS = 10;
                const PROMOTION_THRESHOLD_PROFIT = 0;

                const promotedRobots = performanceData.filter(
                    (p) => (p.wins || 0) >= PROMOTION_THRESHOLD_WINS && (p.totalProfit || 0) > PROMOTION_THRESHOLD_PROFIT
                );

                promotedRobots.sort((a, b) => (b.totalProfit || 0) - (a.totalProfit || 0));
                
                setHallOfFame(promotedRobots);

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
                    Hall da Fama dos Robôs (V1)
                </CardTitle>
                <CardDescription>
                    Análise genética dos robôs mais lucrativos. Robôs com mais de 10 vitórias e lucro positivo são elegíveis para o pódio.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {hallOfFame.length > 0 ? (
                    <Accordion type="single" collapsible className="w-full">
                        {hallOfFame.map((robot) => (
                            <AccordionItem value={robot.id} key={robot.id}>
                                <AccordionTrigger className="hover:bg-muted/50 px-2 rounded-md">
                                    <div className="flex items-center justify-between w-full">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-full bg-amber-500/10 text-amber-600">
                                                <Trophy className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-base text-left">{robot.strategyType}</p>
                                                <p className="text-xs text-muted-foreground text-left">ID: {robot.id}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4 text-sm text-right">
                                            <div>
                                                <p className="font-semibold text-green-600">${(robot.totalProfit || 0).toFixed(2)}</p>
                                                <p className="text-xs text-muted-foreground">Lucro Total</p>
                                            </div>
                                            <div>
                                                <p className="font-semibold">{robot.wins || 0}V / {robot.losses || 0}D</p>
                                                <p className="text-xs text-muted-foreground">Score</p>
                                            </div>
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="space-y-3 pt-2">
                                    <div className="text-sm text-muted-foreground italic px-3">
                                        "{robot.strategy.justification.replace('{{timePeriod}}', 'Global')}"
                                    </div>
                                    <StrategyDetails strategy={robot.strategy} />
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                ) : (
                    <div className="text-center text-muted-foreground p-10 border-2 border-dashed rounded-lg">
                        <Trophy className="h-10 w-10 mx-auto mb-2 opacity-50"/>
                        <p className="font-semibold">O Hall da Fama está vazio.</p>
                        <p className="text-sm">Nenhum robô atingiu os critérios de promoção ainda. Continue a sessão!</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
