// src/app/status/page.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useDerivApiV2, DerivApiProviderV2, type ConnectionEvent } from '@/features/trading/hooks/use-deriv-api-v2';
import { 
    Activity, ShieldCheck, ShieldAlert, Cpu, Database, 
    Network, Server, Clock, ChevronDown, ChevronUp, 
    Terminal, Lock, Key, Globe, Search, Play, CheckCircle2,
    XCircle, Info, Loader2, AlertCircle, RefreshCw, Laptop
} from "lucide-react";
import { checkGeminiConnection, checkFirestoreConnection, checkDerivConnection, checkOllamaConnection } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { OllamaConfig } from '@/lib/types';

type ServiceStatus = 'operational' | 'degraded' | 'critical' | 'loading';

interface ServiceItemProps {
    id: string;
    name: string;
    status: ServiceStatus;
    icon: React.ReactNode;
    children: React.ReactNode;
    isOpen: boolean;
    onToggle: () => void;
}

const ServiceItem = ({ name, status, icon, children, isOpen, onToggle }: ServiceItemProps) => {
    const statusColors = {
        operational: 'text-[#3FB950] border-[#3FB950]/20',
        degraded: 'text-[#F0B429] border-[#F0B429]/20',
        critical: 'text-[#F85149] border-[#F85149]/20',
        loading: 'text-muted-foreground border-border/50'
    };

    const statusLabels = {
        operational: 'Operacional',
        degraded: 'Degradado',
        critical: 'Crítico',
        loading: 'Verificando...'
    };

    return (
        <div className="border border-[#30363D] bg-[#161B22] rounded-lg overflow-hidden mb-4 transition-all hover:border-[#8B949E]">
            <button 
                onClick={onToggle}
                className="w-full flex items-center justify-between p-4 text-left focus:outline-none"
            >
                <div className="flex items-center gap-4">
                    <div className={cn("p-2 rounded-md bg-[#0D1117]", statusColors[status])}>
                        {icon}
                    </div>
                    <div>
                        <h3 className="text-[#E6EDF3] font-semibold">{name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                            <div className={cn("h-2 w-2 rounded-full animate-pulse", 
                                status === 'operational' ? 'bg-[#3FB950]' : 
                                status === 'degraded' ? 'bg-[#F0B429]' : 
                                status === 'critical' ? 'bg-[#F85149]' : 'bg-gray-500'
                            )} />
                            <span className={cn("text-[11px] font-bold uppercase tracking-wider", statusColors[status])}>
                                {statusLabels[status]}
                            </span>
                        </div>
                    </div>
                </div>
                {isOpen ? <ChevronUp className="text-[#8B949E]" /> : <ChevronDown className="text-[#8B949E]" />}
            </button>
            {isOpen && (
                <div className="p-4 pt-0 border-t border-[#30363D] bg-[#0D1117]/50">
                    <div className="mt-4 font-mono text-[13px] text-[#8B949E] leading-relaxed">
                        {children}
                    </div>
                </div>
            )}
        </div>
    );
};

function StatusPageContent() {
    const { 
        isConnected, isConnecting, activeToken, 
        connectionEvents, rawErrorCode, tokenSource, maskedToken, 
        appId, hookVersion, accountType, setTokens 
    } = useDerivApiV2();
    
    const { toast } = useToast();
    const [openServices, setOpenServices] = useState<Record<string, boolean>>({ deriv: true, ollama: true, gemini: true });
    const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({
        deriv: 'loading',
        gemini: 'loading',
        firestore: 'loading',
        ollama: 'loading'
    });
    
    const [testToken, setTestToken] = useState('');
    const [isTestingToken, setIsTestingToken] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; msg: string; assets?: number } | null>(null);

    const [ollamaInfo, setOllamaInfo] = useState<{ modelCount: number; url: string } | null>(null);

    const checkAll = useCallback(async () => {
        setStatuses(prev => ({ ...prev, gemini: 'loading', firestore: 'loading', ollama: 'loading' }));
        
        const ollamaConfigRaw = localStorage.getItem('ollamaConfig');
        let ollamaRes = { success: false, modelCount: 0 };
        let ollamaUrl = 'N/D';

        if (ollamaConfigRaw) {
            const config = JSON.parse(ollamaConfigRaw) as OllamaConfig;
            const res = await checkOllamaConnection(config);
            ollamaRes = {
                success: res.success,
                modelCount: res.modelCount ?? 0
            };
            ollamaUrl = config.baseUrl;
        }

        const savedGeminiKey = localStorage.getItem('geminiApiKey');
        const [gemini, firestore] = await Promise.all([
            checkGeminiConnection(savedGeminiKey || undefined),
            checkFirestoreConnection()
        ]);

        setOllamaInfo({ modelCount: ollamaRes.modelCount, url: ollamaUrl });

        setStatuses({
            deriv: isConnecting ? 'loading' : isConnected ? 'operational' : 'critical',
            gemini: gemini.success ? 'operational' : 'critical',
            firestore: firestore.success ? 'operational' : 'critical',
            ollama: ollamaRes.success ? 'operational' : 'critical'
        });
    }, [isConnected, isConnecting]);

    useEffect(() => {
        checkAll();
    }, [checkAll]);

    const handleTestToken = async () => {
        if (!testToken) {
            setTestResult({ success: false, msg: 'Insira um token para validar.' });
            return;
        }
        setIsTestingToken(true);
        const accountId = accountType === 'demo' ? 'DOT93059550' : 'ROT91769363';
        const res = await checkDerivConnection(testToken.trim(), accountId);
        setIsTestingToken(false);
        setTestResult({ success: res.success, msg: res.error || 'Handshake OTP e WebSocket OK!', assets: res.assetCount });
    };

    const applyTestedToken = () => {
        if (accountType === 'demo') setTokens({ demo: testToken.trim() });
        else setTokens({ real: testToken.trim() });
        setTestToken('');
        setTestResult(null);
        toast({ title: "Token Aplicado" });
    };

    const toggleService = (id: string) => {
        setOpenServices(prev => ({ ...prev, [id]: !prev[id] }));
    };

    return (
        <div className="min-h-screen bg-[#0E1116] text-[#E6EDF3] p-4 sm:p-8 font-body">
            <div className="max-w-4xl mx-auto space-y-8">
                
                <div className="flex items-center justify-between border-b border-[#30363D] pb-6">
                    <div className="flex items-center gap-4">
                        <div className="bg-[#238636]/10 p-3 rounded-xl">
                            <Activity className="h-8 w-8 text-[#3FB950]" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">System Operational Status</h1>
                            <p className="text-[#8B949E] text-sm font-mono mt-1">Ref: {hookVersion}</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-2">
                    <ServiceItem 
                        id="deriv"
                        name="API Deriv (Options OTP Engine)" 
                        status={statuses.deriv} 
                        icon={<Globe className="h-5 w-5" />}
                        isOpen={openServices.deriv}
                        onToggle={() => toggleService('deriv')}
                    >
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-[#161B22] p-3 rounded-md border border-[#30363D]">
                                    <div className="flex items-center gap-2 mb-2 text-[#E6EDF3]">
                                        <Lock className="h-3 w-3" /> <span className="text-xs font-bold uppercase">Active Token</span>
                                    </div>
                                    <p className="font-mono text-[#3FB950] break-all">{maskedToken || 'Nenhum token configurado'}</p>
                                    <div className="flex items-center justify-between mt-2">
                                        <span className="text-[10px] text-[#8B949E]">Source: {tokenSource.toUpperCase()}</span>
                                        <span className="text-[10px] text-[#8B949E]">AppID: {appId}</span>
                                    </div>
                                </div>
                                <div className="bg-[#161B22] p-3 rounded-md border border-[#30363D]">
                                    <div className="flex items-center gap-2 mb-2 text-[#E6EDF3]">
                                        <Terminal className="h-3 w-3" /> <span className="text-xs font-bold uppercase">Network Diagnostics</span>
                                    </div>
                                    <div className="space-y-1 text-xs">
                                        <div className="flex justify-between">
                                            <span>Estado:</span>
                                            <span className={isConnected ? "text-[#3FB950]" : "text-[#F85149]"}>{isConnected ? 'ESTABLISHED' : 'DISCONNECTED'}</span>
                                        </div>
                                        {rawErrorCode && (
                                            <div className="flex justify-between text-[#F85149]">
                                                <span>Erro Bruto:</span>
                                                <span className="font-bold">{rawErrorCode}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <span className="text-xs font-bold uppercase text-[#E6EDF3] flex items-center gap-2">
                                    <Clock className="h-3 w-3" /> Linha do Tempo da Conexão
                                </span>
                                <div className="bg-[#0D1117] border border-[#30363D] rounded-md p-3 max-h-48 overflow-y-auto">
                                    {connectionEvents && connectionEvents.length > 0 ? (
                                        connectionEvents.map((ev: ConnectionEvent, i: number) => (
                                            <div key={i} className="flex gap-3 mb-2 last:mb-0 border-l border-[#30363D] pl-3 relative">
                                                <div className={cn("absolute -left-[5px] top-1 h-2 w-2 rounded-full", 
                                                    ev.type === 'success' ? 'bg-[#3FB950]' : 
                                                    ev.type === 'error' ? 'bg-[#F85149]' : 
                                                    ev.type === 'warning' ? 'bg-[#F0B429]' : 'bg-[#21262d]'
                                                )} />
                                                <span className="text-[#8B949E] whitespace-nowrap text-[10px]">{ev.timestamp}</span>
                                                <span className={cn("text-[11px]",
                                                    ev.type === 'error' ? 'text-[#F85149]' : 
                                                    ev.type === 'success' ? 'text-[#3FB950]' : 'text-[#E6EDF3]'
                                                )}>{ev.message}</span>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-center italic opacity-50 py-4 text-xs">Nenhum evento registado.</p>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3 bg-[#161B22]/50 p-4 rounded-lg border border-dashed border-[#30363D]">
                                <span className="text-xs font-bold uppercase text-[#E6EDF3] flex items-center gap-2">
                                    <Search className="h-3 w-3" /> Sandbox: Testar novo fluxo OTP
                                </span>
                                <div className="flex gap-2">
                                    <Input 
                                        type="password"
                                        placeholder="Seu token de API..."
                                        className="font-mono bg-[#0D1117] border-[#30363D] text-[#3FB950] h-9"
                                        value={testToken}
                                        onChange={(e) => setTestToken(e.target.value)}
                                    />
                                    <Button 
                                        size="sm" 
                                        variant="outline" 
                                        className="h-9 border-[#30363D] hover:bg-[#21262d]"
                                        onClick={handleTestToken}
                                        disabled={isTestingToken}
                                    >
                                        {isTestingToken ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validar"}
                                    </Button>
                                </div>
                                {testResult && (
                                    <div className={cn("mt-2 p-3 rounded-md text-xs flex items-center justify-between", 
                                        testResult.success ? "bg-[#238636]/10 border border-[#238636]/30 text-[#3FB950]" : "bg-[#f85149]/10 border border-[#f85149]/30 text-[#F85149]"
                                    )}>
                                        <div className="flex items-center gap-2">
                                            {testResult.success ? <ShieldCheck className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                                            <span>{testResult.msg} {testResult.assets ? `(${testResult.assets} ativos)` : ''}</span>
                                        </div>
                                        {testResult.success && (
                                            <Button size="sm" className="bg-[#238636] hover:bg-[#2ea043] text-white h-7" onClick={applyTestedToken}>
                                                APLICAR
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </ServiceItem>
                    
                    <ServiceItem 
                        id="ollama"
                        name="IA Local (Ollama Studio)" 
                        status={statuses.ollama} 
                        icon={<Laptop className="h-5 w-5" />}
                        isOpen={openServices.ollama}
                        onToggle={() => toggleService('ollama')}
                    >
                        <div className="space-y-2">
                            <p>Handshake com Gateway Local: <strong>{ollamaInfo?.url}</strong></p>
                            <p>Modelos Sincronizados na VRAM: <strong>{ollamaInfo?.modelCount}</strong></p>
                            <p className="text-[11px] opacity-70">O sistema utiliza o endpoint /api/chat para processamento local.</p>
                        </div>
                    </ServiceItem>

                    <ServiceItem 
                        id="gemini"
                        name="Google Gemini IA" 
                        status={statuses.gemini} 
                        icon={<Cpu className="h-5 w-5" />}
                        isOpen={openServices.gemini}
                        onToggle={() => toggleService('gemini')}
                    >
                        <div className="space-y-2">
                            <p>Neuro-motor gemini-2.5-flash operacional.</p>
                            <div className="flex items-center gap-2 mt-2">
                                <Badge variant="outline" className={cn(localStorage.getItem('geminiApiKey') ? "border-green-500 text-green-500" : "border-amber-500 text-amber-500")}>
                                    {localStorage.getItem('geminiApiKey') ? "Chave Personalizada Ativa" : "Usando Chave do Servidor"}
                                </Badge>
                            </div>
                        </div>
                    </ServiceItem>

                    <ServiceItem 
                        id="firestore"
                        name="Firebase Firestore" 
                        status={statuses.firestore} 
                        icon={<Database className="h-5 w-5" />}
                        isOpen={openServices.firestore}
                        onToggle={() => toggleService('firestore')}
                    >
                        <p>Sincronização persistente ativa.</p>
                    </ServiceItem>
                </div>
            </div>
        </div>
    );
}

export default function StatusPage() {
  return (
    <DerivApiProviderV2>
      <StatusPageContent />
    </DerivApiProviderV2>
  );
}
