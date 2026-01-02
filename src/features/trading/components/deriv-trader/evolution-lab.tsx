// src/features/trading/components/deriv-trader/evolution-lab.tsx
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type { EvolutionEvent } from '@/features/trading/hooks/use-strategy-evolution';
import { Dna, ArrowRight, User, Award, Skull, Bot } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface EvolutionLabProps {
    history: EvolutionEvent[];
}

export function EvolutionLab({ history }: EvolutionLabProps) {
    if (history.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-2">
                        <Dna className="w-5 h-5 text-primary" />
                        Laboratório de Evolução
                    </CardTitle>
                    <CardDescription>
                        Acompanhe aqui os ciclos de aprendizado e adaptação da Mesa Operacional.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="text-center text-muted-foreground p-8 border rounded-md bg-muted/50">
                        <p>Nenhum ciclo de evolução foi registado ainda.</p>
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
                    Laboratório de Evolução
                </CardTitle>
                <CardDescription>
                    Histórico de ciclos de aprendizado. Os robôs de pior desempenho são substituídos por mutações dos melhores.
                </CardDescription>
            </CardHeader>
            <CardContent>
                 <Accordion type="single" collapsible className="w-full" defaultValue="item-0">
                    {history.map((event, index) => (
                        <AccordionItem value={`item-${index}`} key={event.timestamp.toISOString()}>
                            <AccordionTrigger className="text-lg">
                                Ciclo de Evolução #{history.length - index}
                                <span className="text-xs text-muted-foreground ml-auto mr-4">
                                    {event.timestamp.toLocaleString('pt-BR')}
                                </span>
                            </AccordionTrigger>
                            <AccordionContent className="space-y-4">
                                <div>
                                    <h4 className="font-semibold mb-2 flex items-center gap-2"><Award className="w-4 h-4 text-amber-500" /> Robôs de Elite (Pais da Mutação)</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {event.elitePerformers.map(p => {
                                            const winRate = p.wins + p.losses > 0 ? (p.wins / (p.wins + p.losses)) * 100 : 0;
                                            return (
                                                <Badge key={p.id} variant="secondary" className="border-green-500/50">
                                                    {p.strategyType}: {winRate.toFixed(0)}% de acerto
                                                </Badge>
                                            );
                                        })}
                                    </div>
                                </div>

                                <Separator />

                                <div>
                                     <h4 className="font-semibold mb-2 flex items-center gap-2"><Bot className="w-4 h-4 text-blue-500" /> Mutações e Substituições</h4>
                                     <ul className="space-y-2 text-sm">
                                         {event.mutations.map(m => (
                                             <li key={m.replacedBotId} className="flex flex-wrap items-center gap-2 p-2 rounded-md bg-muted/50">
                                                <div className="flex items-center gap-1.5 text-red-600">
                                                    <Skull className="w-3 h-3" />
                                                    <span>{m.replacedBotType}</span>
                                                </div>
                                                <ArrowRight className="w-4 h-4 text-muted-foreground" />
                                                <div className="flex items-center gap-1.5 text-green-700">
                                                     <Dna className="w-3 h-3" />
                                                     <span>Mutação de {m.parentBotType}</span>
                                                </div>
                                             </li>
                                         ))}
                                     </ul>
                                </div>

                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            </CardContent>
        </Card>
    );
}

    
