
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
import { Loader2, CheckCircle, Globe, RefreshCw, Info, Key, Zap, Laptop, ShieldCheck, BarChart3, Medal, BrainCircuit, History, Target, FileText, PlayCircle } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { saveOllamaBenchmark, getOllamaBenchmarkHistory } from "@/services/financial-data-service";
import { useAuth } from "@/features/auth/hooks/use-auth";

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
    intelligenceScore: number;
    contextScore: number;
    powerScore: number;
    status: 'pending' | 'success' | 'error';
}

const isValidDerivPatFormat = (token: string) => {
    return /^pat_[a-zA-Z0-9]{40,}$/.test(token.trim());
};

export function ApiKeysCard() {
  const { user } = useAuth();
  const { demoToken, realToken, setTokens } = useDerivApi();
  const [loading, setLoading] = useState<AccountType | 'ollama' | 'fetching_models' | 'gemini' | 'benchmark' | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ name: string; size: number; details: any }>>([]);
  const [benchmarks, setBenchmarks] = useState<Record<string, BenchmarkResult>>({});
  const [benchHistory, setBenchHistory] = useState<any[]>([]);
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
      apiKey: localStorage.getItem('geminiApiKey') || "",
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
    
    if (user) {
        getOllamaBenchmarkHistory(user.uid).then(setBenchHistory);
    }
  }, [ollamaForm, user]);

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
      
      availableModels.forEach(m => {
          newBenchmarks[m.name] = { model: m.name, tps: 0, totalTime: 0, intelligenceScore: 0, contextScore: 0, powerScore: 0, status: 'pending' };
      });
      setBenchmarks(newBenchmarks);

      for (const model of availableModels) {
          try {
              // FASE 1: VELOCIDADE (SPEED)
              const speedRes = await runOllamaBenchmark({ ...configBase, model: model.name }, 'speed');
              
              // FASE 2: INTELIGÊNCIA FINANCEIRA (QI)
              const intelRes = await runOllamaBenchmark({ ...configBase, model: model.name }, 'intelligence');
              
              // FASE 3: RESILIÊNCIA DE CONTEXTO
              const contextRes = await runOllamaBenchmark({ ...configBase, model: model.name }, 'context');

              const tps = speedRes.metrics?.tokensPerSecond || 0;
              const iq = intelRes.metrics?.score || 0;
              const ctx = contextRes.metrics?.score || 0;
              
              // Power Score Ponderado: 40% IQ, 30% Contexto, 30% Velocidade (normalizada p/ 50 TPS)
              const normalizedSpeed = Math.min(100, (tps / 50) * 100);
              const powerScore = (iq * 0.4) + (ctx * 0.3) + (normalizedSpeed * 0.3);

              const result: BenchmarkResult = {
                  model: model.name,
                  tps,
                  totalTime: speedRes.metrics?.totalTimeMs || 0,
                  intelligenceScore: iq,
                  contextScore: ctx,
                  powerScore,
                  status: 'success'
              };

              setBenchmarks(prev => ({ ...prev, [model.name]: result }));
              
              if (user) {
                  await saveOllamaBenchmark(user.uid, result);
              }
          } catch (e) {
              setBenchmarks(prev => ({
                  ...prev,
                  [model.name]: { ...prev[model.name], status: 'error' }
              }));
          }
      }
      setLoading(null);
      if (user) getOllamaBenchmarkHistory(user.uid).then(setBenchHistory);
      toast({ title: "Auditoria Concluída", description: "O Power Ranking foi atualizado." });
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
    .sort((a, b) => b.powerScore - a.powerScore);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-headline">Conexões de API</CardTitle>
        <CardDescription>Gerencie as suas credenciais para a Corretora Deriv e para as IAs locais ou na nuvem.</CardDescription>
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
            <Tabs defaultValue="config">
                <TabsList className="bg-muted/50 p-1 mb-4 h-9">
                    <TabsTrigger value="config" className="text-xs">Configuração</TabsTrigger>
                    <TabsTrigger value="benchmark" className="text-xs">Benchmark Lab</TabsTrigger>
                    <TabsTrigger value="history" className="text-xs">Histórico</TabsTrigger>
                </TabsList>

                <TabsContent value="config" className="space-y-4">
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
                </TabsContent>

                <TabsContent value="benchmark" className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold flex items-center gap-2">
                            <BrainCircuit className="h-4 w-4 text-primary" />
                            Laboratório de Auditoria Institucional
                        </h4>
                        <Button 
                            size="sm" 
                            variant="secondary" 
                            onClick={handleStartBenchmark} 
                            disabled={loading === 'benchmark' || availableModels.length === 0}
                        >
                            {loading === 'benchmark' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                            {loading === 'benchmark' ? 'Auditoria em Curso...' : 'Iniciar Bateria Completa'}
                        </Button>
                    </div>

                    {benchmarkRanking.length > 0 && (
                        <div className="rounded-md border bg-muted/20">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="text-[10px] uppercase">Rank</TableHead>
                                        <TableHead className="text-[10px] uppercase">Modelo</TableHead>
                                        <TableHead className="text-center text-[10px] uppercase">QI Financeiro</TableHead>
                                        <TableHead className="text-center text-[10px] uppercase">Contexto</TableHead>
                                        <TableHead className="text-right text-[10px] uppercase">Power Score</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {benchmarkRanking.map((b, idx) => (
                                        <TableRow key={b.model} className={cn(idx === 0 && "bg-primary/5")}>
                                            <TableCell className="text-center">
                                                {idx === 0 ? <Medal className="h-4 w-4 text-amber-500" /> : <span className="text-xs font-bold text-muted-foreground">{idx + 1}º</span>}
                                            </TableCell>
                                            <TableCell className="text-xs font-medium">
                                                {b.model}
                                                <div className="text-[9px] text-muted-foreground">{b.tps.toFixed(1)} tok/s</div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <div className="flex flex-col items-center">
                                                    <span className="text-xs font-bold">{b.intelligenceScore.toFixed(0)}</span>
                                                    <Progress value={b.intelligenceScore} className="h-1 w-12 mt-1" />
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <div className="flex flex-col items-center">
                                                    <span className="text-xs font-bold">{b.contextScore.toFixed(0)}</span>
                                                    <Progress value={b.contextScore} className="h-1 w-12 mt-1" />
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right text-xs font-bold text-primary">{b.powerScore.toFixed(1)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="history">
                    <ScrollArea className="h-64 border rounded-md p-2 bg-muted/20">
                        {benchHistory.length === 0 ? (
                            <p className="text-center text-xs text-muted-foreground py-8">Nenhuma auditoria realizada ainda.</p>
                        ) : (
                            <div className="space-y-2">
                                {benchHistory.map((h, i) => (
                                    <div key={i} className="flex items-center justify-between p-2 rounded border bg-card text-[11px]">
                                        <div>
                                            <span className="font-bold">{h.model}</span>
                                            <span className="text-muted-foreground ml-2">{new Date(h.timestamp).toLocaleDateString()}</span>
                                        </div>
                                        <div className="flex gap-4">
                                            <span>QI: {h.intelligenceScore}</span>
                                            <span className="font-bold text-primary">Score: {h.powerScore?.toFixed(1)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </TabsContent>
            </Tabs>
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
