// /src/components/settings/api-keys-card.tsx
"use client";

import { useState, useEffect } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Link as LinkIcon, CheckCircle, XCircle, ShieldCheck, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDerivApiV2 as useDerivApi, type AccountType } from "@/features/trading/hooks/use-deriv-api-v2";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const derivSchema = z.object({
  demoToken: z.string().optional(),
  realToken: z.string().optional(),
});
type DerivFormValues = z.infer<typeof derivSchema>;

const geminiSchema = z.object({
  apiKey: z.string().min(10, "A chave de API parece muito curta."),
});
type GeminiFormValues = z.infer<typeof geminiSchema>;

/**
 * Validador para o novo formato de token PAT da Deriv.
 * Deve começar com 'pat_' e ter uma estrutura alfanumérica longa.
 */
const isValidDerivPatFormat = (token: string) => {
    return /^pat_[a-zA-Z0-9]{40,}$/.test(token.trim());
};

export function ApiKeysCard() {
  const { demoToken, realToken, setTokens, disconnect } = useDerivApi();
  const [loading, setLoading] = useState<AccountType | 'gemini' | null>(null);
  const { toast } = useToast();

  const derivForm = useForm<DerivFormValues>({
    resolver: zodResolver(derivSchema),
    defaultValues: {
      demoToken: demoToken || "",
      realToken: realToken || "",
    },
  });

  const geminiForm = useForm<GeminiFormValues>({
    resolver: zodResolver(geminiSchema),
    defaultValues: { apiKey: "" },
  });

  // Observa mudanças nos inputs para validação em tempo real
  const watchedDemo = derivForm.watch("demoToken") || "";
  const watchedReal = derivForm.watch("realToken") || "";

  const handleDerivSubmit = async (type: AccountType) => {
    setLoading(type);
    const token = derivForm.getValues(type === 'demo' ? 'demoToken' : 'realToken');
    
    if (!token) {
        toast({ variant: "destructive", title: "Erro", description: `O campo de token ${type} está vazio.` });
        setLoading(null);
        return;
    }

    if (!isValidDerivPatFormat(token)) {
        toast({ 
            variant: "destructive", 
            title: "Formato Inválido", 
            description: "O token deve começar com 'pat_' seguido de pelo menos 40 caracteres." 
        });
        setLoading(null);
        return;
    }

    if (type === 'demo') {
        setTokens({ demo: token });
    } else {
        setTokens({ real: token });
    }
    
    await new Promise(res => setTimeout(res, 800));

    setLoading(null);
    toast({ title: "Token PAT Guardado", description: `Credencial de conta ${type} configurada com sucesso.` });
  };

  const handleGeminiSubmit: SubmitHandler<GeminiFormValues> = async (data) => {
    setLoading('gemini');
    await new Promise(res => setTimeout(res, 500));
    setLoading(null);

    toast({
        title: "Instrução de Configuração",
        description: "Para activar a IA, defina GEMINI_API_KEY no ficheiro .env e reinicie o servidor."
    });
  };

  const handleDisconnect = (type: AccountType) => {
    disconnect(type);
    derivForm.setValue(type === 'demo' ? 'demoToken' : 'realToken', "");
    toast({ title: "Desconectado", description: `A credencial da conta ${type} foi removida do browser.` });
  };
  
  const TokenFormatIndicator = ({ token }: { token: string }) => {
    if (!token) return null;
    const isValid = isValidDerivPatFormat(token);
    return (
        <div className="mt-1 flex items-center gap-1.5">
            {isValid ? (
                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 text-[10px] h-5">
                    <ShieldCheck className="mr-1 h-3 w-3" /> FORMATO PAT CORRECTO
                </Badge>
            ) : (
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] h-5">
                    <AlertCircle className="mr-1 h-3 w-3" /> FORMATO INVÁLIDO
                </Badge>
            )}
        </div>
    );
  };

  const ConnectionStatus = ({ isConnected, onDisconnectClick }: { isConnected: boolean, onDisconnectClick: () => void }) => {
    if (!isConnected) return null;
    return (
         <Alert className="border-green-500/50 bg-green-500/5 text-green-700 py-3">
            <CheckCircle className="h-4 w-4 !text-green-600" />
            <AlertTitle className="text-xs font-bold uppercase tracking-wider">Credencial Activa</AlertTitle>
            <AlertDescription className="flex justify-between items-center text-xs">
                Token PAT armazenado de forma segura no browser.
                <Button variant="ghost" size="sm" className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onDisconnectClick}>
                    <XCircle className="mr-2 h-3 w-3" /> Remover
                </Button>
            </AlertDescription>
        </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Conexões de API</CardTitle>
        <CardDescription>
          Gerencie as suas credenciais para a Corretora Deriv e para a IA.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="broker">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="broker">Corretora (Deriv)</TabsTrigger>
            <TabsTrigger value="ai">Inteligência Artificial</TabsTrigger>
          </TabsList>

          <TabsContent value="broker" className="pt-4">
            <Form {...derivForm}>
              <div className="space-y-8">
                {/* CONTA DEMO */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-tight text-primary">Conta Demo (Virtual)</h3>
                    <Badge variant="outline" className="text-[10px]">RECOMENDADO PARA TESTES</Badge>
                  </div>
                   <ConnectionStatus isConnected={!!demoToken} onDisconnectClick={() => handleDisconnect('demo')} />
                   {!demoToken && (
                     <FormField
                        control={derivForm.control}
                        name="demoToken"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs">Token de API (PAT)</FormLabel>
                            <FormControl>
                            <div className="flex flex-col gap-2">
                                <div className="flex gap-2">
                                    <Input 
                                        type="password" 
                                        placeholder="pat_d2df2ff2..." 
                                        className="font-mono text-xs"
                                        {...field} 
                                    />
                                    <Button 
                                        type="button" 
                                        onClick={() => handleDerivSubmit('demo')} 
                                        disabled={loading === 'demo'} 
                                        className="min-w-[100px]"
                                    >
                                        {loading === 'demo' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'CONECTAR'}
                                    </Button>
                                </div>
                                <TokenFormatIndicator token={watchedDemo} />
                            </div>
                            </FormControl>
                            <FormMessage className="text-[10px]" />
                        </FormItem>
                        )}
                    />
                   )}
                </div>

                 <Separator />

                 {/* CONTA REAL */}
                 <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-tight text-destructive">Conta Real (Live)</h3>
                    <Badge variant="destructive" className="text-[10px]">RISCO REAL</Badge>
                  </div>
                   <ConnectionStatus isConnected={!!realToken} onDisconnectClick={() => handleDisconnect('real')} />
                    {!realToken && (
                    <FormField
                        control={derivForm.control}
                        name="realToken"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs">Token de API (PAT)</FormLabel>
                            <FormControl>
                            <div className="flex flex-col gap-2">
                                <div className="flex gap-2">
                                    <Input 
                                        type="password" 
                                        placeholder="pat_d2df2ff2..." 
                                        className="font-mono text-xs"
                                        {...field} 
                                    />
                                    <Button 
                                        type="button" 
                                        variant="destructive"
                                        onClick={() => handleDerivSubmit('real')} 
                                        disabled={loading === 'real'} 
                                        className="min-w-[100px]"
                                    >
                                        {loading === 'real' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'CONECTAR'}
                                    </Button>
                                </div>
                                <TokenFormatIndicator token={watchedReal} />
                            </div>
                            </FormControl>
                            <FormMessage className="text-[10px]" />
                        </FormItem>
                        )}
                    />
                    )}
                </div>
              </div>
            </Form>
          </TabsContent>

          <TabsContent value="ai" className="pt-4">
            <Form {...geminiForm}>
              <form onSubmit={geminiForm.handleSubmit(handleGeminiSubmit)} className="space-y-4">
                <div className="bg-muted/30 p-4 rounded-lg border border-dashed text-xs space-y-2">
                    <p>O Claritas utiliza o modelo <b>Gemini 2.5 Flash</b> para processamento de linguagem natural e visão computacional.</p>
                    <p>A chave deve ser configurada no ambiente do servidor (App Hosting) ou ficheiro .env local.</p>
                </div>
                <FormField
                  control={geminiForm.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Google Gemini API Key</FormLabel>
                      <FormControl>
                         <Input type="password" placeholder="AIzaSyBw..." className="font-mono text-xs" {...field} />
                      </FormControl>
                       <FormMessage className="text-[10px]" />
                    </FormItem>
                  )}
                />
                 <Button type="submit" disabled={loading === 'gemini'} className="w-full text-xs">
                    {loading === 'gemini' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'VALIDAR DISPONIBILIDADE'}
                </Button>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
