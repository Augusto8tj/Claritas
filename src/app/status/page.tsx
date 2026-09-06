'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useDerivApiV2 } from '@/features/trading/hooks/use-deriv-api-v2';
import { 
    Activity, ShieldCheck, ShieldAlert, Cpu, Database, 
    Network, Server, Clock, ChevronDown, ChevronUp, 
    Terminal, Lock, Key, Globe, Search, Play, CheckCircle2,
    XCircle, Info, Loader2
} from "lucide-react";
import { checkGeminiConnection, checkFirestoreConnection, checkDerivConnection } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

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

export default function StatusPage() {
    const { 
        isConnected, isConnecting, connectionError, activeToken, 
        connectionEvents, rawErrorCode, tokenSource, maskedToken, 
        appId, hookVersion, setTokens 
    } = useDerivApiV2();
    
    const { toast } = useToast();
    const [openServices, setOpenServices] = useState<Record<string, boolean>>({ deriv: true });
    const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({
        deriv: 'loading',
        gemini: 'loading',
        firestore: 'loading'
    });
    
    const [testToken, setTestToken] = useState('');
    const [isTestingToken, setIsTestingToken] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; msg: string; assets?: number } | null>(null);

    const checkAll = useCallback(async () => {
        setStatuses(prev => ({ ...prev, gemini: 'loading', firestore: 'loading' }));
        
        const [gemini, firestore] = await Promise.all([
            checkGeminiConnection(),
            checkFirestoreConnection()
        ]);

        setStatuses({
            deriv: isConnecting ? 'loading' : isConnected ? 'operational' : 'critical',
            gemini: gemini.success ? 'operational' : 'critical',
            firestore: firestore.success ? 'operational' : 'critical'
        });
    }, [isConnected, isConnecting]);

    useEffect(() => {
        checkAll();
    }, [checkAll]);

    const handleTestToken = async () => {
        if (!testToken.startsWith('pat_')) {
            setTestResult({ success: false, msg: 'Formato inválido. O token deve começar com pat_' });
            return;
        }
        setIsTestingToken(true);
        const res = await checkDerivConnection(testToken.trim());
        setIsTestingToken(false);
        setTestResult({ success: res.success, msg: res.error || 'Token válido!', assets: res.assetCount });
    };

    const applyTestedToken = () => {
        setTokens({ demo: testToken.trim() });
        setTestToken('');
        setTestResult(null);
        toast({ title: "Token Aplicado", description: "O sistema está a reiniciar a ligação com a nova credencial." });
    };

    const toggleService = (id: string) => {
        setOpenServices(prev => ({ ...prev, [id]: !prev[id] }));
    };

    return (
        <div className="min-h-screen bg-[#0E1116] text-[#E6EDF3] p-4 sm:p-8 font-body">
            <div className="max-w-4xl mx-auto space-y-8">
                
                {/* HEADER OPERACIONAL */}
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
                    <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-[#8B949E] font-bold uppercase tracking-widest mb-1">Last Update</p>
                        <p className="font-mono text-[#E6EDF3] text-sm">{new Date().toLocaleTimeString('pt-BR')}</p>
                    </div>
                </div>

                {/* LISTA DE SERVIÇOS */}
                <div className="space-y-2">
                    
                    {/* API DERIV */}
                    <ServiceItem 
                        id="deriv"
                        name="API Deriv (Core Engine)" 
                        status={statuses.deriv} 
                        icon={<Globe className="h-5 w-5" />}
                        isOpen={openServices.deriv}
                        onToggle={() => toggleService('deriv')}
                    >
                        <div className="space-y-6">
                            {/* Audit de Credencial */}
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

                            {/* Timeline de Eventos */}
                            <div className="space-y-2">
                                <span className="text-xs font-bold uppercase text-[#E6EDF3] flex items-center gap-2">
                                    <Clock className="h-3 w-3" /> WebSocket Event Timeline
                                </span>
                                <div className="bg-[#0D1117] border border-[#30363D] rounded-md p-3 max-h-48 overflow-y-auto">
                                    {connectionEvents.length > 0 ? (
                                        connectionEvents.map((ev, i) => (
                                            <div key={i} className="flex gap-3 mb-2 last:mb-0 border-l border-[#30363D] pl-3 relative">
                                                <div className={cn("absolute -left-[5px] top-1 h-2 w-2 rounded-full", 
                                                    ev.type === 'success' ? 'bg-[#3FB950]' : 
                                                    ev.type === 'error' ? 'bg-[#F85149]' : 
                                                    ev.type === 'warning' ? 'bg-[#F0B429]' : 'bg-[#21262d]'
                                                )} />
                                                <span className="text-[#8B949E] whitespace-nowrap">{ev.timestamp}</span>
                                                <span className={cn(
                                                    ev.type === 'error' ? 'text-[#F85149]' : 
                                                    ev.type === 'success' ? 'text-[#3FB950]' : 'text-[#E6EDF3]'
                                                )}>{ev.message}</span>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-center italic opacity-50 py-4">Nenhum evento registado nesta sessão.</p>
                                    )}
                                </div>
                            </div>

                            {/* Sandbox de Teste */}
                            <div className="space-y-3 bg-[#161B22]/50 p-4 rounded-lg border border-dashed border-[#30363D]">
                                <span className="text-xs font-bold uppercase text-[#E6EDF3] flex items-center gap-2">
                                    <Search className="h-3 w-3" /> Sandbox: Testar novo token (sem salvar)
                                </span>
                                <div className="flex gap-2">
                                    <Input 
                                        type="password"
                                        placeholder="pat_..."
                                        className="font-mono bg-[#0D1117] border-[#30363D] text-[#3FB950] h-9"
                                        value={testToken}
                                        onChange={(e) => setTestToken(e.target.value)}
                                    />
                                    <Button 
                                        size="sm" 
                                        variant="outline" 
                                        className="h-9 border-[#30363D] hover:bg-[#21262d]"
                                        onClick={handleTestToken}
                                        disabled={isTestingToken || !testToken}
                                    >
                                        {isTestingToken ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validar"}
                                    </Button>
                                </div>
                                {testResult && (
                                    <div className={cn("mt-2 p-3 rounded-md text-xs flex items-center justify-between", 
                                        testResult.success ? "bg-[#238636]/10 border border-[#238636]/30 text-[#3FB950]" : "bg-[#f85149]/10 border border-[#f85149]/30 text-[#F85149]"
                                    )}>
                                        <div className="flex items-center gap-2">
                                            {testResult.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                                            <span>{testResult.msg} {testResult.assets ? `(${testResult.assets} ativos detetados)` : ''}</span>
                                        </div>
                                        {testResult.success && (
                                            <Button 
                                                size="sm" 
                                                className="bg-[#238636] hover:bg-[#2ea043] text-white font-bold h-7"
                                                onClick={applyTestedToken}
                                            >
                                                USAR ESTE TOKEN
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </ServiceItem>

                    {/* API GEMINI */}
                    <ServiceItem 
                        id="gemini"
                        name="Google Gemini IA (Neuro-Motor)" 
                        status={statuses.gemini} 
                        icon={<Cpu className="h-5 w-5" />}
                        isOpen={openServices.gemini}
                        onToggle={() => toggleService('gemini')}
                    >
                        <div className="space-y-3">
                            <div className="bg-[#161B22] p-3 rounded-md border border-[#30363D]">
                                <div className="flex items-center gap-2 mb-2 text-[#E6EDF3]">
                                    <Info className="h-3 w-3" /> <span className="text-xs font-bold uppercase">Service Metadata</span>
                                </div>
                                <div className="space-y-1 text-xs">
                                    <p>Provider: Google AI Studio</p>
                                    <p>Model: gemini-2.5-flash-lite</p>
                                    <p>Endpoint: https://generativelanguage.googleapis.com</p>
                                    <p className="mt-2 text-[#F0B429]">Nota: Verifique a quota de Tokens por Minuto (TPM) no console da Google se encontrar lentidão.</p>
                                </div>
                            </div>
                        </div>
                    </ServiceItem>

                    {/* FIREBASE FIRESTORE */}
                    <ServiceItem 
                        id="firestore"
                        name="Firebase Firestore (Data Persistence)" 
                        status={statuses.firestore} 
                        icon={<Database className="h-5 w-5" />}
                        isOpen={openServices.firestore}
                        onToggle={() => toggleService('firestore')}
                    >
                        <div className="space-y-3">
                            <div className="bg-[#161B22] p-3 rounded-md border border-[#30363D]">
                                <div className="flex items-center gap-2 mb-2 text-[#E6EDF3]">
                                    <Lock className="h-3 w-3" /> <span className="text-xs font-bold uppercase">Security Policies</span>
                                </div>
                                <div className="space-y-1 text-xs">
                                    <p>Sync: REALTIME_ENABLED</p>
                                    <p>Rules Version: 2</p>
                                    <p>Auth Strategy: OWNER_UID_BASED</p>
                                    <p className="mt-2 text-[#3FB950]">Status: Todas as subcoleções de utilizador estão isoladas e protegidas.</p>
                                </div>
                            </div>
                        </div>
                    </ServiceItem>

                </div>

                {/* NOTA TÉCNICA FINAL */}
                <div className="bg-[#161B22] border border-[#30363D] rounded-lg p-6 flex gap-4">
                    <Terminal className="h-6 w-6 text-[#8B949E] shrink-0" />
                    <div className="space-y-2">
                        <h4 className="text-sm font-bold text-[#E6EDF3]">Arquitetura de Segurança Deriv 2025</h4>
                        <p className="text-xs text-[#8B949E] leading-relaxed">
                            O sistema utiliza o protocolo <strong>Personal Access Token (PAT)</strong>. Para garantir a operacionalidade, 
                            o seu token deve possuir os escopos <code>READ</code> e <code>TRADE</code> ativos. Gaps de conexão 
                            superiores a 30 segundos disparam automaticamente o algoritmo de reconexão exponencial.
                        </p>
                    </div>
                </div>

            </div>
        </div>
    );
}
