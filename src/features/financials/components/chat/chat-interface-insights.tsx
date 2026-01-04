// /src/features/financials/components/chat/chat-interface-insights.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CornerDownLeft, Loader2, Sparkles, User } from "lucide-react";
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
import { getChatbotInsightsResponse } from "@/app/actions";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/icons";

const MessageSchema = z.object({
  role: z.enum(['user', 'model']),
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
  const viewportRef = useRef<HTMLDivElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { query: "" },
  });

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    if (!user) {
        setMessages((prev) => [...prev, { role: "model", content: "Por favor, faça login para usar o chat." }]);
        return;
    }
    setLoading(true);
    const userMessage: Message = { role: "user", content: data.query };
    
    const history = [...messages];
    setMessages((prev) => [...prev, userMessage]);

    form.reset();

    const response = await getChatbotInsightsResponse({ 
      history, 
      query: data.query,
      userId: user.uid,
    });
    
    if (response.success) {
      const assistantMessage: Message = {
        role: "model",
        content: response.success,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } else {
      const errorMessage: Message = {
        role: "model",
        content:
          response.error || "Desculpe, algo deu errado. Por favor, tente novamente.",
      };
      setMessages((prev) => [...prev, errorMessage]);
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
    <Card className="h-full flex flex-col">
      <ScrollArea className="flex-1 p-4" viewportRef={viewportRef}>
        <div className="space-y-6">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground pt-10">
              <Sparkles className="mx-auto h-10 w-10 mb-4" />
              <p className="font-semibold">Bem-vindo à Claritas AI Insights</p>
              <p className="text-sm">Inicie uma conversa digitando abaixo.</p>
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                "flex items-start gap-4",
                message.role === "user" && "justify-end"
              )}
            >
              {message.role === "model" && (
                <Avatar className="h-9 w-9 border border-primary/20">
                  <AvatarFallback className="bg-primary/10">
                    <Logo className="h-5 w-5 text-primary" />
                  </AvatarFallback>
                </Avatar>
              )}
              <div
                className={cn(
                  "max-w-md rounded-lg px-4 py-3 text-sm",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
               {message.role === "user" && (
                <Avatar className="h-9 w-9">
                    <AvatarFallback><User className="h-5 w-5" /></AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}
          {loading && (
             <div className="flex items-start gap-4">
                 <Avatar className="h-9 w-9 border border-primary/20">
                  <AvatarFallback className="bg-primary/10">
                    <Logo className="h-5 w-5 text-primary" />
                  </AvatarFallback>
                </Avatar>
                <div className="max-w-md rounded-lg px-4 py-3 text-sm bg-muted flex items-center">
                    <Loader2 className="h-4 w-4 animate-spin" />
                </div>
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="p-4 border-t">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex items-center gap-2"
          >
            <FormField
              control={form.control}
              name="query"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input
                      placeholder="ex: Me dê alguns insights sobre minhas finanças"
                      {...field}
                      disabled={loading}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" size="icon" disabled={loading}>
              <CornerDownLeft className="h-4 w-4" />
              <span className="sr-only">Enviar mensagem</span>
            </Button>
          </form>
        </Form>
      </div>
    </Card>
  );
}
