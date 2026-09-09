// /src/features/financials/components/chat/chat-interface-insights.tsx
"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CornerDownLeft, Loader2, Sparkles, User, Laptop, Cloud, Settings2 } from "lucide-react";
import { useAuth } from "@/features/auth/hooks/use-auth";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getChatbotInsightsResponse, getOllamaResponse } from "@/app/actions";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/icons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getFinancialSummary } from "@/services/financial-data-service";

const MessageSchema = z.object({
  role: z.enum(['user', 'model', 'assistant', 'system']),
  content: z.string(),
});
type Message = z.infer<typeof MessageSchema>;

const formSchema = z.object({
  query: z.string().min(1, "A mensagem não pode estar vazia"),
});

type FormValues = z.infer<typeof formSchema>;

export function ChatInterfaceInsights() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<'gemini' | 'ollama'>('gemini');
  const viewportRef = useRef<HTMLDivElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { query: "" },
  });

  useEffect(() => {
      const savedProvider = localStorage.getItem('activeAiProvider') as any;
      if (savedProvider) setProvider(savedProvider);
  }, []);

  const changeProvider = (val: 'gemini' | 'ollama') => {
      setProvider(val);
      localStorage.setItem('activeAiProvider', val);
  };

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    if (!user) {
        setMessages((prev) => [...prev, { role: "assistant", content: "Por favor, faça login para usar o chat." }]);
        return;
    }
    setLoading(true);
    const userMessage: Message = { role: "user", content: data.query };
    const history = [...messages];
    setMessages((prev) => [...prev, userMessage]);

    form.reset();

    try {
        if (provider === 'gemini') {
            const response = await getChatbotInsightsResponse({ 
              history, 
              query: data.query,
              userId: user.uid,
            });
            
            if (response.success) {
              setMessages((prev) => [...prev, { role: "assistant", content: response.success! }]);
            } else {
              throw new Error(response.error);
            }
        } else {
            // Lógica para Ollama Local
            const ollamaConfigRaw = localStorage.getItem('ollamaConfig');
            if (!ollamaConfigRaw) throw new Error("Configure o Ollama na página de Configurações primeiro.");
            
            const config = JSON.parse(ollamaConfigRaw);
            const summary = await getFinancialSummary(user.uid);
            
            // Injeção de contexto financeiro para IA local
            const contextPrompt = `\n\n[CONTEXTO FINANCEIRO ATUAL DO USUÁRIO]\n- Renda: R$${summary.income.toFixed(2)}\n- Despesas: R$${summary.expenses.toFixed(2)}\n- Saldo: R$${summary.balance.toFixed(2)}\n---`;
            
            const response = await getOllamaResponse(config, data.query + contextPrompt, history);
            if (response.success) {
                setMessages((prev) => [...prev, { role: "assistant", content: response.success! }]);
            } else {
                throw new Error(response.error);
            }
        }
    } catch (e: any) {
        setMessages((prev) => [...prev, { role: "assistant", content: e.message || "Desculpe, algo deu errado." }]);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  return (
    <Card className="h-full flex flex-col border-none shadow-none bg-transparent">
      <div className="p-4 border-b flex items-center justify-between bg-card rounded-t-lg">
          <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-2 rounded-lg">
                  <Logo className="h-6 w-6 text-primary" />
              </div>
              <div>
                  <h3 className="font-bold text-sm">Claritas Assistant</h3>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Inteligência Multimodal</p>
              </div>
          </div>
          <div className="flex items-center gap-2">
               <Select value={provider} onValueChange={changeProvider as any}>
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="gemini"><div className="flex items-center gap-2"><Cloud className="w-3 h-3"/> Gemini Cloud</div></SelectItem>
                      <SelectItem value="ollama"><div className="flex items-center gap-2"><Laptop className="w-3 h-3"/> Ollama Local</div></SelectItem>
                  </SelectContent>
              </Select>
          </div>
      </div>

      <ScrollArea className="flex-1 p-6 bg-muted/20" viewportRef={viewportRef}>
        <div className="space-y-6 max-w-3xl mx-auto">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground pt-12">
              <div className="bg-primary/5 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-primary/10">
                <Sparkles className="h-8 w-8 text-primary/40" />
              </div>
              <p className="font-bold text-lg text-foreground">Como posso ajudar hoje?</p>
              <p className="text-sm px-8">Pergunte sobre seus gastos, metas ou peça uma análise de mercado usando {provider === 'gemini' ? 'o motor Gemini 2.5' : 'sua IA local'}.</p>
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                "flex items-start gap-4",
                (message.role === "assistant" || message.role === "model") ? "justify-start" : "justify-end"
              )}
            >
              {(message.role === "assistant" || message.role === "model") && (
                <Avatar className="h-8 w-8 border border-primary/20 shrink-0">
                  <AvatarFallback className="bg-primary/10">
                    <Logo className="h-4 w-4 text-primary" />
                  </AvatarFallback>
                </Avatar>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm",
                  (message.role === "assistant" || message.role === "model")
                    ? "bg-card border text-foreground rounded-tl-none"
                    : "bg-primary text-primary-foreground rounded-tr-none"
                )}
              >
                <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
              </div>
               {message.role === "user" && (
                <Avatar className="h-8 w-8 border shrink-0">
                    <AvatarFallback className="bg-muted text-muted-foreground text-[10px] font-bold">EU</AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}
          {loading && (
             <div className="flex items-start gap-4">
                 <Avatar className="h-8 w-8 border border-primary/20 animate-pulse">
                  <AvatarFallback className="bg-primary/10">
                    <Logo className="h-4 w-4 text-primary" />
                  </AvatarFallback>
                </Avatar>
                <div className="bg-card border rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
                    <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                </div>
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="p-4 bg-card rounded-b-lg border-t">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex items-center gap-2 max-w-3xl mx-auto"
          >
            <FormField
              control={form.control}
              name="query"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input
                      placeholder={provider === 'gemini' ? "Pergunte à Claritas..." : "Comando para IA Local..."}
                      className="bg-muted/50 border-none focus-visible:ring-1 focus-visible:ring-primary h-11 px-4 rounded-xl"
                      {...field}
                      disabled={loading}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <Button type="submit" size="icon" disabled={loading} className="h-11 w-11 rounded-xl shadow-md">
              <CornerDownLeft className="h-5 w-5" />
              <span className="sr-only">Enviar mensagem</span>
            </Button>
          </form>
        </Form>
        <p className="text-[9px] text-center text-muted-foreground mt-3 uppercase tracking-widest font-bold">
            Powered by {provider === 'gemini' ? 'Gemini 2.5 Flash' : 'Ollama Local Studio'}
        </p>
      </div>
    </Card>
  );
}