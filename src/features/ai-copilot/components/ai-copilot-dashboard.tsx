
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { 
    Brain, 
    Sparkles, 
    TrendingUp, 
    ShieldAlert, 
    Zap, 
    MessageSquare, 
    Send, 
    Loader2, 
    ArrowRight,
    AlertCircle,
    CheckCircle2,
    BarChart3,
    Compass
} from "lucide-react";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { getChatbotInsightsResponse } from "@/app/actions";
import { cn } from "@/lib/utils";
import { getFinancialSummary, getGoals } from "@/services/financial-data-service";

interface Insight {
    id: string;
    title: string;
    description: string;
    type: 'opportunity' | 'risk' | 'info';
    icon: React.ReactNode;
}

export function AICopilotDashboard() {
    const { user } = useAuth();
    const [query, setQuery] = useState("");
    const [messages, setMessages] = useState<{role: 'user' | 'assistant', content: string}[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [insights, setInsights] = useState<Insight[]>([]);
    const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);

    const generateDashboardInsights = useCallback(async () => {
        if (!user) return;
        setIsGeneratingInsights(true);
        try {
            const summary = await getFinancialSummary(user.uid);
            const goals = await getGoals(user.uid);
            
            const prompt = `Gere 3 insights financeiros ou de trading curtos para um dashboard de "AI Copilot". 
            Considere: Saldo $${summary.balance.toFixed(2)}, Metas Ativas: ${goals.length}. 
            Retorne apenas um array JSON com objetos: {title, description, type: 'opportunity'|'risk'|'info'}.`;

            const response = await getChatbotInsightsResponse({
                query: prompt,
                history: [],
                userId: user.uid
            });

            if (response.success) {
                const raw = response.success;
                const jsonMatch = raw.match(/\[.*\]/s);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    const mapped: Insight[] = parsed.map((item: any, i: number) => ({
                        ...item,
                        id: `insight-${i}`,
                        icon: item.type === 'opportunity' ? <Zap className="h-4 w-4 text-yellow-500" /> : 
                              item.type === 'risk' ? <ShieldAlert className="h-4 w-4 text-destructive" /> : 
                              <Info className="h-4 w-4 text-blue-500" />
                    }));
                    setInsights(mapped);
                }
            }
        } catch (e) {
            console.error("Failed to generate insights", e);
        } finally {
            setIsGeneratingInsights(false);
        }
    }, [user]);

    useEffect(() => {
        generateDashboardInsights();
    }, [generateDashboardInsights]);

    const handleSendMessage = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!query.trim() || !user || isLoading) return;

        const userMsg = { role: 'user' as const, content: query };
        setMessages(prev => [...prev, userMsg]);
        setQuery("");
        setIsLoading(true);

        try {
            const response = await getChatbotInsightsResponse({
                query: query,
                history: messages,
                userId: user.uid
            });

            if (response.success) {
                setMessages(prev => [...prev, { role: 'assistant', content: response.success! }]);
            }
        } catch (err) {
            setMessages(prev => [...prev, { role: 'assistant', content: "Desculpe, encontrei um erro ao processar sua solicitação." }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            {/* HERO SECTION */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-3 rounded-2xl border border-primary/20 shadow-sm">
                        <Brain className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight font-headline">Claritas AI Copilot</h1>
                        <p className="text-muted-foreground text-sm">Seu consultor quantitativo e financeiro em tempo real.</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={generateDashboardInsights} disabled={isGeneratingInsights}>
                        {isGeneratingInsights ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : <Sparkles className="h-4 w-4 mr-2" />}
                        Recalibrar Insights
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* LEFT: STRATEGIC INSIGHTS */}
                <div className="lg:col-span-1 space-y-6">
                    <Card className="shadow-sm border-primary/10">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <Compass className="h-4 w-4 text-primary" /> Radar Estratégico
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {isGeneratingInsights ? (
                                <div className="space-y-4 py-4">
                                    {[1, 2, 3].map(i => (
                                        <div key={i} className="animate-pulse space-y-2">
                                            <div className="h-4 bg-muted rounded w-1/3" />
                                            <div className="h-3 bg-muted rounded w-full" />
                                        </div>
                                    ))}
                                </div>
                            ) : insights.length === 0 ? (
                                <p className="text-sm text-muted-foreground italic text-center py-4">Clique em recalibrar para obter insights.</p>
                            ) : (
                                insights.map((insight) => (
                                    <div key={insight.id} className="flex gap-3 p-3 rounded-lg bg-muted/30 border border-border group hover:border-primary/30 transition-colors">
                                        <div className="mt-1">{insight.icon}</div>
                                        <div className="space-y-1">
                                            <h4 className="text-xs font-bold uppercase tracking-tight">{insight.title}</h4>
                                            <p className="text-[11px] text-muted-foreground leading-relaxed">{insight.description}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </CardContent>
                    </Card>

                    <Card className="shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-green-500" /> Oportunidades
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer">
                                <span className="text-xs font-medium">Volatilidade 100 Index</span>
                                <Badge variant="outline" className="text-[10px] text-green-600 border-green-200 bg-green-50">Sinal Forte</Badge>
                            </div>
                            <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer">
                                <span className="text-xs font-medium">EUR/USD Pullback</span>
                                <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200 bg-blue-50">Confirmado</Badge>
                            </div>
                            <Button variant="ghost" size="sm" className="w-full text-[10px] text-muted-foreground uppercase font-bold tracking-tighter">
                                Ver todas as oportunidades <ArrowRight className="h-3 w-3 ml-1" />
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* RIGHT: INTERACTIVE COPILOT CHAT */}
                <div className="lg:col-span-2">
                    <Card className="h-[600px] flex flex-col shadow-lg border-primary/20 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-accent to-primary" />
                        <CardHeader className="py-4 border-b bg-muted/5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="bg-primary h-2 w-2 rounded-full animate-pulse" />
                                    <CardTitle className="text-base font-headline">Diálogo Tático com Claritas</CardTitle>
                                </div>
                                <Badge variant="outline" className="text-[10px] uppercase font-bold text-primary border-primary/30">Alpha V2.0</Badge>
                            </div>
                            <CardDescription className="text-xs italic">A IA tem acesso ao seu histórico operacional e financeiro.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-hidden p-0 relative">
                            <ScrollArea className="h-full p-4">
                                <div className="space-y-6 max-w-2xl mx-auto py-4">
                                    {messages.length === 0 && (
                                        <div className="text-center space-y-4 pt-12">
                                            <div className="bg-primary/5 h-20 w-20 rounded-full flex items-center justify-center mx-auto border border-primary/10">
                                                <Sparkles className="h-10 w-10 text-primary/30" />
                                            </div>
                                            <div className="space-y-2">
                                                <h3 className="font-bold text-lg">Inicie sua estratégia</h3>
                                                <p className="text-sm text-muted-foreground px-8">Tente: "Analise meu risco atual", "Qual o melhor ativo para os próximos 5 minutos?" ou "Como posso melhorar meu P&L?"</p>
                                            </div>
                                        </div>
                                    )}
                                    {messages.map((m, i) => (
                                        <div key={i} className={cn(
                                            "flex flex-col max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed shadow-sm border",
                                            m.role === 'user' 
                                                ? "bg-primary text-primary-foreground ml-auto rounded-tr-none border-primary/10" 
                                                : "bg-card mr-auto rounded-tl-none border-border"
                                        )}>
                                            <div className="flex items-center gap-2 mb-2 opacity-50 text-[10px] font-bold uppercase">
                                                {m.role === 'user' ? <User className="h-3 w-3"/> : <Brain className="h-3 w-3"/>}
                                                {m.role === 'user' ? 'Comando' : 'Claritas'}
                                            </div>
                                            <p className="whitespace-pre-wrap">{m.content}</p>
                                        </div>
                                    ))}
                                    {isLoading && (
                                        <div className="flex flex-col max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed bg-muted/20 border-border border rounded-tl-none">
                                            <div className="flex gap-1">
                                                <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                        </CardContent>
                        <CardFooter className="p-4 border-t bg-muted/5">
                            <form onSubmit={handleSendMessage} className="flex w-full gap-2 items-center bg-background border rounded-xl p-1 shadow-inner focus-within:ring-1 focus-within:ring-primary/30 transition-all">
                                <Input 
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Dê um comando tático..."
                                    className="border-none shadow-none focus-visible:ring-0 text-sm h-11"
                                    disabled={isLoading}
                                />
                                <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-lg shadow-md" disabled={isLoading || !query.trim()}>
                                    {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                                </Button>
                            </form>
                        </CardFooter>
                    </Card>
                </div>
            </div>

            {/* QUICK STATS FOOTER */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-500/10 p-2 rounded-lg text-blue-600"><BarChart3 className="h-5 w-5" /></div>
                        <div>
                            <p className="text-[10px] text-muted-foreground uppercase font-bold">Inferências/H</p>
                            <p className="text-sm font-bold">1.4k</p>
                        </div>
                    </div>
                </Card>
                <Card className="p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex items-center gap-3">
                        <div className="bg-green-500/10 p-2 rounded-lg text-green-600"><CheckCircle2 className="h-5 w-5" /></div>
                        <div>
                            <p className="text-[10px] text-muted-foreground uppercase font-bold">Confiança Média</p>
                            <p className="text-sm font-bold">82.4%</p>
                        </div>
                    </div>
                </Card>
                <Card className="p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex items-center gap-3">
                        <div className="bg-orange-500/10 p-2 rounded-lg text-orange-600"><AlertCircle className="h-5 w-5" /></div>
                        <div>
                            <p className="text-[10px] text-muted-foreground uppercase font-bold">Alertas Ativos</p>
                            <p className="text-sm font-bold">2</p>
                        </div>
                    </div>
                </Card>
                <Card className="p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex items-center gap-3">
                        <div className="bg-purple-500/10 p-2 rounded-lg text-purple-600"><Zap className="h-5 w-5" /></div>
                        <div>
                            <p className="text-[10px] text-muted-foreground uppercase font-bold">Latência IA</p>
                            <p className="text-sm font-bold">420ms</p>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}

function Info(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  )
}
