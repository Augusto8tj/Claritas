// src/features/trading/components/deriv-trader/evolution-lab.tsx
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type { EvolutionEvent } from '@/features/trading/hooks/use-strategy-evolution';
import { Dna, ArrowRight, Award, Skull, Bot, FileText, TrendingUp, TrendingDown, ChevronsRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';


interface EvolutionLabProps {
    history: EvolutionEvent[];
}

const renderMetric = (value: number | undefined, isCurrency = false, isPercent = false) => {
    if (value === undefined || value === null) return <span className="text-muted-foreground">-</span>;
    if (isCurrency) return `$${value.toFixed(2)}`;
    if (isPercent) return `${value.toFixed(1)}%`;
    return value.toFixed(2);
};

export function EvolutionLab({ history }: EvolutionLabProps) {
    if (history.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-2">
                        <Dna className="w-5 h-5 text-primary" />
                        Laboratório de Evolução v2.5
                    </CardTitle>
                    <CardDescription>
                        Acompanhe aqui os ciclos de aprendizado e adaptação da Mesa Operacional.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="text-center text-muted-foreground p-8 border-2 border-dashed rounded-lg bg-muted/20">
                        <Dna className="w-10 h-10 mx-auto mb-4 opacity-30" />
                        <p className="font-semibold">Nenhum ciclo de evolução foi registado ainda.</p>
                        <p className="text-xs">O sistema irá evoluir automaticamente após um certo número de trades virtuais.</p>
                    </div>
                </CardContent>
            </Card>
        );
    }
    
    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                    <Dna className="w-5 h-5 text-primary" />
                    Laboratório de Evolução v2.5
                </CardTitle>
                <CardDescription>
                    Histórico de ciclos de aprendizado. Os robôs de pior desempenho são substituídos por mutações dos melhores.
                </CardDescription>
            </CardHeader>
            <CardContent>
                 <Accordion type="single" collapsible className="w-full" defaultValue="item-0">
                    {history.map((event, index) => (
                        <AccordionItem value={`item-${index}`} key={event.timestamp.toISOString()}>
                            <AccordionTrigger className="text-lg hover:no-underline">
                                <div className="flex items-center justify-between w-full">
                                    <span className="font-semibold text-primary/90">Ciclo de Evolução #{history.length - index}</span>
                                    <span className="text-xs text-muted-foreground font-mono mr-4">
                                        {event.timestamp.toLocaleString('pt-BR')}
                                    </span>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="space-y-6 pt-4">
                                <div>
                                    <h4 className="font-semibold mb-3 text-base flex items-center gap-2"><Award className="w-5 h-5 text-amber-500" /> Robôs de Elite (Fonte Genética)</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        {event.elitePerformers.map(p => {
                                            const winRate = p.wins + p.losses > 0 ? (p.wins / (p.wins + p.losses)) * 100 : 0;
                                            return (
                                                <div key={p.id} className="p-3 rounded-lg border bg-green-500/5 border-green-500/20">
                                                    <p className="font-bold text-sm text-green-700">{p.strategyType}</p>
                                                    <div className="grid grid-cols-2 gap-x-2 text-xs mt-1">
                                                         <p>P&L: <span className="font-mono font-semibold">{renderMetric(p.totalProfit, true)}</span></p>
                                                         <p>W/L: <span className="font-mono font-semibold">{p.wins}/{p.losses}</span></p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <Separator />

                                <div>
                                     <h4 className="font-semibold mb-3 text-base flex items-center gap-2"><Bot className="w-5 h-5 text-blue-500" /> Mutações e Substituições</h4>
                                     <div className="space-y-4">
                                         {event.mutations.map(m => (
                                             <div key={m.replacedBotId} className="p-4 rounded-lg bg-muted/30 border-l-4 border-blue-500">
                                                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-4 text-center md:text-left">
                                                    
                                                    {/* Parent Bot */}
                                                    <div className="flex flex-col items-center md:items-start">
                                                        <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-300">
                                                            <Award className="w-3 h-3 mr-1.5"/>Pai Genético
                                                        </Badge>
                                                        <p className="font-bold mt-1">{m.parentBotType}</p>
                                                    </div>

                                                    {/* Arrow */}
                                                    <div className="flex justify-center">
                                                        <ChevronsRight className="w-8 h-8 text-blue-400" />
                                                    </div>
                                                    
                                                    {/* Replaced Bot */}
                                                     <div className="flex flex-col items-center md:items-end">
                                                         <Badge variant="destructive" className="bg-red-100 text-red-800 border-red-300">
                                                            <Skull className="w-3 h-3 mr-1.5"/>Substituído
                                                        </Badge>
                                                        <p className="font-bold mt-1">{m.replacedBotType}</p>
                                                    </div>
                                                </div>
                                                
                                                <div className="text-xs text-muted-foreground border-t mt-3 pt-3 flex items-start gap-2">
                                                   <FileText className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
                                                   <div>
                                                        <span className="font-semibold text-foreground">Análise da IA:</span>
                                                        <span> {m.analysis}</span>
                                                   </div>
                                                </div>
                                             </div>
                                         ))}
                                     </div>
                                </div>

                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            </CardContent>
        </Card>
    );
}
