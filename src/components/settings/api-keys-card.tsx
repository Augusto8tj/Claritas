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
import { Loader2, Link as LinkIcon, CheckCircle, XCircle, ShieldCheck, AlertCircle, Laptop, Globe, RefreshCw, Info, Key } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Form,
  FormControl,
  FormDescription,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { checkOllamaConnection, checkGeminiConnection } from "@/app/actions";

const derivSchema = z.object({
  demoToken: z.string().optional(),
  realToken: z.string().optional(),
});

const ollamaSchema = z.object({
  baseUrl: z.string().url("URL inválida (inclua https://)"),
  apiKey: z.string().optional(),
  model: z.string().min(1, "Selecione um modelo"),
  temperature: z.coerce.number().min(0).max(1),
  keepAlive: z.string(),
});

const geminiSchema = z.object({
  apiKey: z.string().min(10, "A chave de API parece muito curta."),
});

type DerivFormValues = z.infer<typeof derivSchema>;
type OllamaFormValues = z.infer<typeof ollamaSchema>;
type GeminiFormValues = z.infer<typeof geminiSchema>;

const isValidDerivPatFormat = (token: string) => {
    return /^pat_[a-zA-Z0-9]{40,}$/.test(token.trim());
};

export function ApiKeysCard() {
  const { demoToken, realToken, setTokens } = useDerivApi();
  const [loading, setLoading] = useState<AccountType | 'ollama' | 'fetching_models' | 'gemini' | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const { toast } = useToast();

  const derivForm = useForm<DerivFormValues>({
    resolver: zodResolver(derivSchema),
    defaultValues: {
      demoToken: demoToken || "",
      realToken: realToken || "",
    },
  });

  const ollamaForm = useForm<OllamaFormValues>({
    resolver: zodResolver(ollamaSchema),
    defaultValues: {
      baseUrl: "https://boxlike-barrack-silencer.ngrok-free.dev",
      apiKey: "augusto123",
      model: "",
      temperature: 0.7,
      keepAlive: "5m",
    },
  });

  const geminiForm = useForm<GeminiFormValues>({
    resolver: zodResolver(geminiSchema),
    defaultValues: {
      apiKey: "",
    },
  });

  useEffect(() => {
    const savedOllama = localStorage.getItem('ollamaConfig');
    if (savedOllama) {
      try {
        const parsed = JSON.parse(savedOllama);
        ollamaForm.reset(parsed);
      } catch (e) {}
    }

    const savedGemini = localStorage.getItem('geminiApiKey');
    if (savedGemini) {
      geminiForm.reset({ apiKey: savedGemini });
    }
  }, [ollamaForm, geminiForm]);

  const handleDerivSubmit = async (type: AccountType) => {
    setLoading(type);
    const token = derivForm.getValues(type === 'demo' ? 'demoToken' : 'realToken');
    if (!token || !isValidDerivPatFormat(token)) {
        toast({ variant: "destructive", title: "Formato Inválido", description: "O token PAT deve ser válido." });
        setLoading(null);
        return;
    }
    if (type === 'demo') setTokens({ demo: token });
    else setTokens({ real: token });
    setLoading(null);
    toast({ title: "Token PAT Guardado" });
  };

  const fetchOllamaModels = async () => {
    setLoading('fetching_models');
    const config = ollamaForm.getValues();
    try {
      const url = config.baseUrl.replace(/\/+$/, '') + '/api/tags';
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'ngrok-skip-browser-warning': 'true'
        }
      });
      if (!response.ok) throw new Error("Falha ao buscar modelos");
      const data = await response.json();
      const models = data.models?.map((m: any) => m.name) || [];
      setAvailableModels(models);
      if (models.length > 0 && !config.model) ollamaForm.setValue('model', models[0]);
      toast({ title: "Modelos Sincronizados", description: `${models.length} modelos encontrados no Ollama.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro de Conexão", description: e.message });
    } finally {
      setLoading(null);
    }
  };

  const handleOllamaSubmit: SubmitHandler<OllamaFormValues> = async (data) => {
    setLoading('ollama');
    localStorage.setItem('ollamaConfig', JSON.stringify(data));
    const res = await checkOllamaConnection(data);
    setLoading(null);
    if (res.success) {
      toast({ title: "Ollama Configurado!", description: "Conexão estabelecida com sucesso." });
    } else {
      toast({ variant: "destructive", title: "Falha na Validação", description: res.error });
    }
  };

  const handleGeminiSubmit: SubmitHandler<GeminiFormValues> = async (data) => {
    setLoading('gemini');
    try {
      const res = await checkGeminiConnection(data.apiKey);
      if (res.success) {
        localStorage.setItem('geminiApiKey', data.apiKey);
        toast({ title: "Gemini Configurado!", description: "Chave de API validada e salva no navegador." });
      } else {
        throw new Error(res.error || "Erro ao validar chave.");
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro de Validação", description: e.message });
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Conexões de API</CardTitle>
        <CardDescription>Gerencie as suas credenciais para a Corretora Deriv e para as IAs.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="broker">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="broker"><Globe className="w-4 h-4 mr-2"/>Corretora</TabsTrigger>
            <TabsTrigger value="ollama"><Laptop className="w-4 h-4 mr-2"/>IA Local (Ollama)</TabsTrigger>
            <TabsTrigger value="ai"><Key className="w-4 h-4 mr-2"/>IA Cloud (Gemini)</TabsTrigger>
          </TabsList>

          <TabsContent value="broker" className="pt-4 space-y-6">
            <Form {...derivForm}>
               <div className="space-y-4">
                  <FormField
                    control={derivForm.control}
                    name="demoToken"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Token PAT (Demo)</FormLabel>
                        <div className="flex gap-2">
                          <FormControl><Input type="password" {...field} className="font-mono text-xs"/></FormControl>
                          <Button size="sm" onClick={() => handleDerivSubmit('demo')} disabled={loading === 'demo'}>
                            {loading === 'demo' ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Salvar'}
                          </Button>
                        </div>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={derivForm.control}
                    name="realToken"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Token PAT (Real)</FormLabel>
                        <div className="flex gap-2">
                          <FormControl><Input type="password" {...field} className="font-mono text-xs"/></FormControl>
                          <Button size="sm" variant="destructive" onClick={() => handleDerivSubmit('real')} disabled={loading === 'real'}>
                            {loading === 'real' ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Salvar'}
                          </Button>
                        </div>
                      </FormItem>
                    )}
                  />
               </div>
            </Form>
          </TabsContent>

          <TabsContent value="ollama" className="pt-4 space-y-4">
            <Form {...ollamaForm}>
              <form onSubmit={ollamaForm.handleSubmit(handleOllamaSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={ollamaForm.control}
                    name="baseUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Gateway URL (Ngrok)</FormLabel>
                        <FormControl><Input placeholder="https://..." {...field}/></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={ollamaForm.control}
                    name="apiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Token Secreto</FormLabel>
                        <FormControl><Input type="password" {...field}/></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex items-end gap-2">
                  <FormField
                    control={ollamaForm.control}
                    name="model"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel className="text-xs">Modelo Ativo</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={availableModels.length > 0 ? "Selecione..." : "Clique em Atualizar"} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {availableModels.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <Button type="button" variant="outline" size="icon" onClick={fetchOllamaModels} disabled={loading === 'fetching_models'}>
                    {loading === 'fetching_models' ? <Loader2 className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={ollamaForm.control}
                      name="keepAlive"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Permanência em VRAM</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="5m">5 Minutos</SelectItem>
                              <SelectItem value="-1">Indefinido (Sempre Quente)</SelectItem>
                              <SelectItem value="0">Descarregar Imediatamente</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={ollamaForm.control}
                      name="temperature"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Temperatura: {field.value}</FormLabel>
                          <FormControl><Input type="range" min="0" max="1" step="0.1" {...field}/></FormControl>
                        </FormItem>
                      )}
                    />
                </div>

                <Button type="submit" className="w-full" disabled={loading === 'ollama'}>
                  {loading === 'ollama' ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Validar e Salvar Configuração Local'}
                </Button>
              </form>
            </Form>
          </TabsContent>

          <TabsContent value="ai" className="pt-4 space-y-4">
             <Form {...geminiForm}>
                <form onSubmit={geminiForm.handleSubmit(handleGeminiSubmit)} className="space-y-4">
                    <FormField
                      control={geminiForm.control}
                      name="apiKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Gemini API Key</FormLabel>
                          <FormControl><Input type="password" placeholder="Cole sua chave aqui..." {...field}/></FormControl>
                          <FormDescription className="text-[10px]">
                            A chave será salva no navegador e substituirá a do servidor para esta sessão.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full" disabled={loading === 'gemini'}>
                        {loading === 'gemini' ? <Loader2 className="h-4 w-4 animate-spin"/> : <ShieldCheck className="mr-2 h-4 w-4"/>}
                        Validar e Ativar Chave Cloud
                    </Button>
                </form>
             </Form>

             <Alert className="bg-muted/50 border-dashed mt-4">
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Para configuração permanente, defina <code>GEMINI_API_KEY</code> no arquivo <code>.env</code> do servidor.
                </AlertDescription>
             </Alert>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
