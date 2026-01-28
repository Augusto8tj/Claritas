// /src/features/trading/components/settings/api-keys-card.tsx
"use client";

import { useState } from "react";
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
import { Loader2, Link as LinkIcon, CheckCircle, XCircle } from "lucide-react";
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
import { useDerivApiV2, type AccountType } from "@/features/trading/hooks/use-deriv-api-v2";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

const derivSchema = z.object({
  demoToken: z.string().optional(),
  realToken: z.string().optional(),
});
type DerivFormValues = z.infer<typeof derivSchema>;

const geminiSchema = z.object({
  apiKey: z.string().min(10, "A chave de API parece muito curta."),
});
type GeminiFormValues = z.infer<typeof geminiSchema>;

export function ApiKeysCard() {
  const { demoToken, realToken, setTokens, disconnect } = useDerivApiV2();
  const [loading, setLoading] = useState<AccountType | 'gemini' | null>(null);
  const [geminiApiKey, setGeminiApiKey] = useState(''); // This would be loaded from server in a real secure app
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

  const handleDerivSubmit = async (type: AccountType) => {
    setLoading(type);
    const token = derivForm.getValues(type === 'demo' ? 'demoToken' : 'realToken');
    if (!token) {
        toast({ variant: "destructive", title: "Erro", description: `O campo de token ${type} está vazio.` });
        setLoading(null);
        return;
    }

    // A validação agora é mais simples: apenas salvamos o token.
    // A verificação real acontecerá quando o aplicativo tentar usar o token (por exemplo, ao buscar o saldo).
    if (type === 'demo') {
        setTokens({ demo: token });
    } else {
        setTokens({ real: token });
    }
    
    // Simula um pequeno atraso para feedback do usuário
    await new Promise(res => setTimeout(res, 500));

    setLoading(null);
    toast({ title: "Token Salvo", description: `Seu token da conta ${type} foi salvo no navegador.` });
  };

  const handleGeminiSubmit: SubmitHandler<GeminiFormValues> = async (data) => {
    setLoading('gemini');
    // In a real app, you would save this key securely on the server-side.
    // For this demo, we'll just validate and give feedback.
    setGeminiApiKey(data.apiKey);
    
    // As we can't save it securely on the client, we just inform the user to set it in .env
    await new Promise(res => setTimeout(res, 500));
    setLoading(null);

    toast({
        title: "Chave da IA",
        description: "Para usar esta chave, por favor, defina-a na variável de ambiente GEMINI_API_KEY no seu arquivo .env e reinicie o servidor."
    });
  };

  const handleDisconnect = (type: AccountType) => {
    disconnect(type);
    derivForm.setValue(type === 'demo' ? 'demoToken' : 'realToken', "");
    toast({ title: "Desconectado", description: `A conexão com a conta ${type} foi removida.` });
  };
  
  const ConnectionStatus = ({ isConnected, onDisconnectClick }: { isConnected: boolean, onDisconnectClick: () => void }) => {
    if (!isConnected) return null;
    return (
         <Alert className="border-green-500/50 bg-green-500/10 text-green-700">
            <CheckCircle className="h-4 w-4 !text-green-600" />
            <AlertTitle>Token Salvo</AlertTitle>
            <AlertDescription className="flex justify-between items-center">
                O token está salvo no seu navegador.
                <Button variant="ghost" size="sm" className="text-green-700 hover:text-green-800 hover:bg-green-500/20" onClick={onDisconnectClick}>
                    <XCircle className="mr-2 h-4 w-4" /> Desconectar
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
          Gerencie suas chaves de API para a Corretora Deriv e para a IA do Google.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="broker">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="broker">Corretora</TabsTrigger>
            <TabsTrigger value="ai">Inteligência Artificial</TabsTrigger>
          </TabsList>

          <TabsContent value="broker" className="pt-4">
            <Form {...derivForm}>
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium">Conta Demo</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Use para testar estratégias sem arriscar dinheiro real.
                  </p>
                   <ConnectionStatus isConnected={!!demoToken} onDisconnectClick={() => handleDisconnect('demo')} />
                   {!demoToken && (
                     <FormField
                        control={derivForm.control}
                        name="demoToken"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Token da Conta Demo</FormLabel>
                            <FormControl>
                            <div className="flex gap-2">
                                <Input type="password" placeholder="Cole seu token de API aqui" {...field} />
                                <Button type="button" onClick={() => handleDerivSubmit('demo')} disabled={loading === 'demo'} className="min-w-[120px]">
                                    {loading === 'demo' ? <Loader2 className="animate-spin" /> : <><LinkIcon className="mr-2"/>Salvar</>}
                                </Button>
                            </div>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                   )}
                </div>
                 <div>
                  <h3 className="text-lg font-medium">Conta Real</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Use para negociações reais. Tenha cuidado, as operações são de verdade.
                  </p>
                   <ConnectionStatus isConnected={!!realToken} onDisconnectClick={() => handleDisconnect('real')} />
                    {!realToken && (
                    <FormField
                        control={derivForm.control}
                        name="realToken"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Token da Conta Real</FormLabel>
                            <FormControl>
                            <div className="flex gap-2">
                                <Input type="password" placeholder="Cole seu token de API aqui" {...field} />
                                <Button type="button" onClick={() => handleDerivSubmit('real')} disabled={loading === 'real'} className="min-w-[120px]">
                                     {loading === 'real' ? <Loader2 className="animate-spin" /> : <><LinkIcon className="mr-2"/>Salvar</>}
                                </Button>
                            </div>
                            </FormControl>
                            <FormMessage />
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
                <p className="text-sm text-muted-foreground">
                    Para que a IA funcione, você precisa de uma chave de API do Google AI Studio. 
                    Configure esta chave no seu arquivo <code>.env</code> na raiz do projeto.
                </p>
                <Alert>
                    <AlertTitle>Arquivo .env</AlertTitle>
                    <AlertDescription>
                        <code>GEMINI_API_KEY="SUA_CHAVE_AQUI"</code>
                    </AlertDescription>
                </Alert>
                <FormField
                  control={geminiForm.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chave de API do Google Gemini</FormLabel>
                      <FormControl>
                         <Input type="password" placeholder="Cole sua chave aqui para validação" {...field} />
                      </FormControl>
                       <FormMessage />
                    </FormItem>
                  )}
                />
                 <Button type="submit" disabled={loading === 'gemini'} className="min-w-[120px]">
                    {loading === 'gemini' ? <Loader2 className="animate-spin" /> : 'Informar e Validar'}
                </Button>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
