
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
import { Loader2, CheckCircle, Globe, RefreshCw, Info, Key, Zap, Laptop, ShieldCheck, BarChart3, Medal } from "lucide-react";
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
import { checkOllamaConnection, checkGeminiConnection, runOllamaBenchmark } from "@/app/actions";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";

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

interface BenchmarkResult {
    model: string;
    tps: number;
    totalTime: number;
    evalTime: number;
    status: 'pending' | 'success' | 'error';
}

const isValidDerivPatFormat = (token: string) => {
    return /^pat_[a-zA-Z0-9]{40,}$/.test(token.trim());
};

export function ApiKeysCard() {
  const { demoToken, realToken, setTokens } = useDerivApi();
  const [loading, setLoading] = useState<AccountType | 'ollama' | 'fetching_models' | 'gemini' | 'benchmark' | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ name: string; size: number; details: any }>>([]);
  const [benchmarks, setBenchmarks] = useState<Record<string, BenchmarkResult>>({});
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
      const models = data.models || [];
      setAvailableModels(models);
      if (models.length > 0 && !ollamaForm.getValues('model')) ollamaForm.setValue('model', models[0].name);
      toast({ title: "Modelos Sincronizados", description: `${models.length} modelos encontrados no Ollama.` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro de Conexão", description: e.message });
    } finally {
      setLoading(null);
    }
  };

  const handleStartBenchmark = async () => {
      if (availableModels.length === 0) {
          toast({ title: "Nenhum modelo", description: "Sincronize os modelos primeiro.", variant: "destructive" });
          return;
      }

      setLoading('benchmark');
      const configBase = ollamaForm.getValues();
      const newBenchmarks: Record<string, BenchmarkResult> = {};
      
      // Inicializa status pending
      availableModels.forEach(m => {
          newBenchmarks[m.name] = { model: m.name, tps: 0, totalTime: 0, evalTime: 0, status: 'pending' };
      });
      setBenchmarks(newBenchmarks);

      for (const model of availableModels) {
          try {
              // Teste Duplo (Média) conforme sugerido no protótipo
              let totalTPS = 0;
              let totalTime = 0;
              
              for (let i = 1; i <= 2; i++) {
                  const res = await runOllamaBenchmark({ ...configBase, model: model.name });
                  if (res.success && res.metrics) {
                      totalTPS += res.metrics.tokensPerSecond;
                      totalTime += res.metrics.totalTimeMs;
                  } else {
                      throw new Error(res.error || 'Falha no benchmark');
                  }
              }

              setBenchmarks(prev => ({
                  ...prev,
                  [model.name]: {
                      model: model.name,
                      tps: totalTPS / 2,
                      totalTime: totalTime / 2,
                      evalTime: 0, // Not strictly needed for average summary
                      status: 'success'
                  }
              }));
          } catch (e) {
              setBenchmarks(prev => ({
                  ...prev,
                  [model.name]: { ...prev[model.name], status: 'error' }
              }));
          }
      }
      setLoading(null);
      toast({ title: "Benchmark Concluído", description: "O ranking de modelos foi atualizado." });
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

  const benchmarkRanking = Object.values(benchmarks)
    .filter(b => b.status === 'success')
    .sort((a, b) => b.tps - a.tps);

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
            <Alert className="bg-primary/5 border-primary/20">
              <Zap className="h-4 w-4 text-primary" />
              <AlertTitle className="text-xs font-bold uppercase">Guia de Performance Local</AlertTitle>
              <AlertDescription className="text-[11px] leading-relaxed mt-1">
                Para o Claritas, modelos entre <strong>7B e 8B</strong> (como Llama 3 ou Mistral) oferecem o melhor equilíbrio. 
                Use o <strong>Benchmark Lab</strong> abaixo para encontrar o modelo mais veloz para o seu notebook.
              </AlertDescription>
            </Alert>

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
                            {availableModels.map(m => {
                                const sizeGB = (m.size / (1024 ** 3)).toFixed(1);
                                return (
                                    <SelectItem key={m.name} value={m.name}>
                                        <div className="flex items-center justify-between w-full gap-4">
                                            <span>{m.name}</span>
                                            <Badge variant="outline" className="text-[9px] h-4">{sizeGB} GB</Badge>
                                        </div>
                                    </SelectItem>
                                )
                            })}
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
                  {loading === 'ollama' ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Salvar Configuração Local'}
                </Button>
              </form>
            </Form>

            <Separator />

            {/* BENCHMARK LAB SECTION */}
            <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-primary" />
                        Laboratório de Benchmark & Ranking
                    </h4>
                    <Button 
                        size="sm" 
                        variant="secondary" 
                        onClick={handleStartBenchmark} 
                        disabled={loading === 'benchmark' || availableModels.length === 0}
                    >
                        {loading === 'benchmark' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                        {loading === 'benchmark' ? 'Testando...' : 'Iniciar Bateria de Testes'}
                    </Button>
                </div>

                {benchmarkRanking.length > 0 && (
                    <div className="rounded-md border bg-muted/20">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="text-[10px] uppercase">Rank</TableHead>
                                    <TableHead className="text-[10px] uppercase">Modelo</TableHead>
                                    <TableHead className="text-center text-[10px] uppercase">Velocidade</TableHead>
                                    <TableHead className="text-right text-[10px] uppercase">Tempo Médio</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {benchmarkRanking.map((b, idx) => (
                                    <TableRow key={b.model} className={cn(idx === 0 && "bg-primary/5")}>
                                        <TableCell className="text-center">
                                            {idx === 0 ? <Medal className="h-4 w-4 text-amber-500" /> : <span className="text-xs font-bold text-muted-foreground">{idx + 1}º</span>}
                                        </TableCell>
                                        <TableCell className="text-xs font-medium">{b.model}</TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex flex-col items-center">
                                                <span className="text-xs font-bold text-primary">{b.tps.toFixed(1)} tok/s</span>
                                                <Progress value={Math.min(100, (b.tps / 50) * 100)} className="h-1 w-16 mt-1" />
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right text-xs font-mono">{(b.totalTime / 1000).toFixed(2)}s</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {loading === 'benchmark' && (
                    <div className="p-4 text-center space-y-2 border border-dashed rounded-lg">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                        <p className="text-xs text-muted-foreground">Executando bateria de testes duplos em cada modelo para média de performance...</p>
                    </div>
                )}
            </div>
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

// Helper icons needed but not imported
import { PlayCircle } from "lucide-react";
