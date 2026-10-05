
'use client';

/**
 * @fileOverview TERMINAL QUANT V3.5 (COUNCIL EDITION) - MONITORAMENTO MULTI-ATIVO
 * V3.5: Scanner Tático de 5 segundos (Round-Robin) para todos os ativos monitorados.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi, type AccountType } from './use-deriv-api-v2';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../services/council-strategies';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { TradeMemoryManager } from '../services/trade-memory-service';
import { runQuantCouncil } from '../services/quant-council-engine';
import { CouncilDecision, TradeMemoryBuffer, AgentOpinion, CouncilTelemetry, AllowedContractsV3, PortfolioRiskState } from '../types/council';
import { getOllamaResponse } from '@/app/actions';

export interface RadarAssetStatus {
    symbol: string;
    lastAction: 'RISE' | 'FALL' | 'HOLD';
    lastPrice?: number;
    confidence: number;
    timestamp: number;
    isQualified: boolean;
    executedVia: string;
    opinions: AgentOpinion[];
    recommendedContract?: string;
    holdReason?: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    time: string;
    agentName?: string;
}

export function useAIQuantTerminalV3(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { 
        isConnected, executeTrade, operationsLog, accountBalance, 
        watchedSymbols, setWatchedSymbols, multiAssetCandles, 
        clearActiveContracts, accountType, setAccountType 
    } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();

    // ESTADOS DE CONTROLE CANÔNICOS V3
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [analysisInterval, setAnalysisInterval] = useState(120); 
    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(120);
    
    const [telemetry, setTelemetry] = useState<CouncilTelemetry>({
        avgTokensPerSec: 0,
        totalTokens: 0,
        consensusEntropy: 0,
        jitterMs: 0,
        inferenceHealth: 100
    });
    
    // GESTÃO FINANCEIRA E CONTRATOS
    const [allowedContracts, setAllowedContracts] = useState<AllowedContractsV3>({
        'CALL': true,
        'PUT': true,
        'ACCUMULATORS': true,
        'MULTIPLIERS': true
    });
    const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(5);
    const [stakeValue, setStakeValue] = useState(1.0);
    const [dailyBalance, setDailyBalance] = useState(10.0);
    const [dailyTarget, setDailyTarget] = useState(5.0);

    // RADAR E MEMÓRIA
    const [radarStatus, setRadarStatus] = useState<Record<string, RadarAssetStatus>>({});
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [reasoningLog, setReasoningLog] = useState<any[]>([]);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [availableModels, setAvailableModels] = useState<any[]>([]);
    
    const executionLockRef = useRef(false);
    const scheduleRef = useRef<Record<string, number>>({});
    
    // REFS PARA DADOS DE ALTA FREQUÊNCIA (Blindagem de Re-render)
    const priceTicksRef = useRef(priceTicks);
    const operationsLogRef = useRef(operationsLog);

    useEffect(() => { priceTicksRef.current = priceTicks; }, [priceTicks]);
    useEffect(() => { operationsLogRef.current = operationsLog; }, [operationsLog]);

    // OLLAMA CONFIG - Carregamento Síncrono via useMemo para evitar falha no radar inicial
    const ollamaConfig = useMemo(() => {
        if (typeof window === 'undefined') return null;
        const saved = localStorage.getItem('ollamaConfig');
        if (saved) {
            try {
                return JSON.parse(saved) as OllamaConfig;
            } catch (e) {
                console.error("Error parsing ollamaConfig", e);
                return null;
            }
        }
        return null;
    }, []);

    const addLog = useCallback((message: string, type: string = 'info') => {
        setReasoningLog(prev => [{ time: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
    }, []);

    const updateOllamaConfig = useCallback((updates: Partial<OllamaConfig>) => {
        if (typeof window === 'undefined') return;
        const current = ollamaConfig || { baseUrl: '', model: '', temperature: 0.2, keepAlive: '5m' };
        const next = { ...current, ...updates };
        localStorage.setItem('ollamaConfig', JSON.stringify(next));
        toast({ title: "Configuração Salva", description: "As preferências do Ollama foram atualizadas." });
        // Força recarregamento da página para sincronizar useMemo (simplificado para robustez)
        window.location.reload();
    }, [ollamaConfig, toast]);

    const fetchAvailableModels = useCallback(async () => {
        if (!ollamaConfig?.baseUrl) {
            toast({ 
                title: "Gateway não configurado", 
                description: "Informe a URL do servidor local nas Configurações.",
                variant: "destructive"
            });
            return;
        }
        try {
            const url = ollamaConfig.baseUrl.replace(/\/+$/, '') + '/api/tags';
            const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
            if (ollamaConfig.apiKey) headers['Authorization'] = `Bearer ${ollamaConfig.apiKey}`;

            const response = await fetch(url, { headers });
            if (response.ok) {
                const data = await response.json();
                const models = data.models || [];
                setAvailableModels(models);
                toast({ title: "Hardware Sincronizado", description: `${models.length} modelos detectados.` });
            } else {
                throw new Error(`Status ${response.status}`);
            }
        } catch (e: any) {
            addLog(`Falha na conexão com Ollama: ${e.message}`, 'error');
            toast({ title: "Erro na IA Local", description: "O servidor Ollama parece estar offline.", variant: "destructive" });
        }
    }, [ollamaConfig, addLog, toast]);

    // ESTATÍSTICAS DE SESSÃO V3
    const sessionStats = useMemo(() => {
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && (op.initiator === 'Conselho_V3' || op.strategy?.startsWith('V3_'))
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const pnl = finishedTrades.reduce((acc, op) => acc + (Number(op.result) || (op.status === 'lost' ? -op.stake : 0)), 0);
        
        return { 
            pnl: Number(pnl) || 0, 
            winRate: finishedTrades.length > 0 ? (wins / finishedTrades.length) * 100 : null, 
            total: finishedTrades.length 
        };
    }, [operationsLog]);

    useEffect(() => {
        if (user && activeSymbol) TradeMemoryManager.getBuffer(user.uid, activeSymbol).then(setMemoryBuffer);
    }, [user, activeSymbol]);

    // ANÁLISE POR SÍMBOLO (O Coração do Radar de 5 segundos)
    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManualTrigger: boolean = false) => {
        if (!isConnected || !ollamaConfig || candles.length < 30 || !user) return;
        
        const isFocused = symbol === activeSymbol;
        const currentPrice = isFocused ? priceTicksRef.current[priceTicksRef.current.length - 1]?.price : candles[candles.length - 1].close;
        
        try {
            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            
            const snapshot = {
                symbol, price: currentPrice, rsi: indicators?.rsi, bbw: indicators?.bbw,
                trend: (indicators?.adx || 0) > 25 ? 'Trending' : 'Ranging'
            };

            const portfolioState: PortfolioRiskState = {
                openPositions: operationsLogRef.current.filter(op => op.status === 'pending').length,
                maxConcurrentPositions: maxConcurrentTrades,
                totalExposure: operationsLogRef.current.filter(op => op.status === 'pending').reduce((sum, op) => sum + op.stake, 0),
                maxTotalExposure: dailyBalance,
                lockedSymbols: new Set()
            };

            const assetPermissions = {
                symbol, enabled: true, maxStake: stakeValue * 2,
                allowedContracts: Object.keys(allowedContracts).filter(k => allowedContracts[k as keyof AllowedContractsV3]) as any[]
            };

            // Invocação do Conselho Multi-Agente
            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, isFocused, assetPermissions, portfolioState);
            
            if (isFocused) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
                addLog(`[DECISÃO] ${symbol}: ${decision.finalAction} (${decision.consensusConfidence}%)`, 'decision');
            }

            // Atualização Crucial do Radar (Dados em Tempo Real)
            setRadarStatus(prev => ({
                ...prev,
                [symbol]: {
                    symbol, lastAction: decision.finalAction, lastPrice: currentPrice, confidence: decision.consensusConfidence,
                    timestamp: Date.now(), isQualified: decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65,
                    executedVia: decision.executedVia, opinions: decision.opinions, recommendedContract: decision.recommendedContract,
                    holdReason: decision.holdReason
                }
            }));

            // Lógica de Execução Tática
            const shouldExecute = isManualTrigger || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65);

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                const hasSameContractOpen = operationsLogRef.current.some(op => 
                    op.asset === symbol && op.status === 'pending' && op.contractType === decision.recommendedContract
                );

                if (!hasSameContractOpen) {
                    if (isShadowMode) {
                        addLog(`[SHADOW] ${symbol}: ${decision.finalAction} via ${decision.recommendedContract}`, 'radar');
                    } else {
                        let finalContractType = 'CALL';
                        switch (decision.recommendedContract) {
                            case 'ACCUMULATORS': finalContractType = 'ACCU'; break;
                            case 'MULTIPLIERS': finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN'; break;
                            default: finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                        }

                        const initiator = isManualTrigger ? 'Manual' : 'Conselho_V3';
                        await executeTrade(finalContractType, stakeValue, symbol, decision.finalAction.toLowerCase() as any, 15, 's', initiator as any, `V3_${decision.executedVia}`);
                        addLog(`[EXEC] ${initiator}: ${symbol} ${decision.finalAction}`, 'execution');
                    }
                }
            }
        } catch (err: any) {
            if (isFocused) addLog(`Erro em ${symbol}: ${err.message}`, 'error');
        }
    }, [isConnected, ollamaConfig, isShadowMode, user, isAutoMode, allowedContracts, maxConcurrentTrades, dailyBalance, activeSymbol, executeTrade, addLog, stakeValue, toast]);

    // SCANNER TÁTICO: Processa a fila de ativos a cada 5 segundos
    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || !isConnected || !ollamaConfig) return;
        executionLockRef.current = true;

        try {
            const now = Date.now();
            
            // FILA: Identifica ativos que precisam de análise (venceram o cooldown de 5s)
            const dueSymbols = watchedSymbols.filter(sym => (scheduleRef.current[sym] || 0) <= now);
            
            if (dueSymbols.length === 0) return;

            // 1. Prioridade absoluta para o Ativo em Foco
            if (dueSymbols.includes(activeSymbol!)) {
                await runAnalysisForSymbol(activeSymbol!, chartData);
                // O foco respeita o analysisInterval definido pelo usuário
                scheduleRef.current[activeSymbol!] = now + (analysisInterval * 1000);
            }

            // 2. Processamento em fila para ativos de background (a cada 5s)
            const backgroundSymbols = dueSymbols.filter(s => s !== activeSymbol);
            if (backgroundSymbols.length > 0) {
                await Promise.all(backgroundSymbols.map(async (symbol) => {
                    const candles = multiAssetCandles[symbol];
                    if (candles && candles.length >= 30) {
                        await runAnalysisForSymbol(symbol, candles);
                        // Background analisa agressivamente a cada 5 segundos
                        scheduleRef.current[symbol] = now + 5000; 
                    }
                }));
            }
        } finally {
            executionLockRef.current = false;
        }
    }, [watchedSymbols, activeSymbol, chartData, multiAssetCandles, analysisInterval, runAnalysisForSymbol, isConnected, ollamaConfig]);

    // REGISTRO DO SCANNER TÁTICO
    useEffect(() => {
        const scanner = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(scanner);
    }, [runMultiAssetCycle]);

    // TRIGGER IMEDIATO AO ENTRAR OU MUDAR ATIVO
    useEffect(() => {
        if (isConnected && activeSymbol && chartData.length >= 30 && !executionLockRef.current) {
            runAnalysisForSymbol(activeSymbol, chartData);
        }
    }, [activeSymbol, isConnected, chartData.length, runAnalysisForSymbol]);

    const resetSession = async () => {
        setIsAutoMode(false);
        clearActiveContracts();
        setRadarStatus({});
        setReasoningLog([]);
        setChatMessages([]);
        scheduleRef.current = {};
        setLastDecision(null);
        if (user) await TradeMemoryManager.clearBuffer(user.uid);
        setMemoryBuffer({ wins: [], losses: [] });
        toast({ title: "Sessão Resetada", description: "Histórico e memória foram limpos." });
    };

    const sendMessage = async (content: string, targetAgent: string = 'CHAIRMAN') => {
        if (!ollamaConfig || !content.trim() || !user) return;
        const userMsg: ChatMessage = { role: 'user', content, time: new Date().toLocaleTimeString() };
        setChatMessages(prev => [...prev, userMsg]);
        setIsChatLoading(true);

        try {
            const memoryContext = TradeMemoryManager.formatBufferForPrompt(memoryBuffer);
            const radarDetails = watchedSymbols.map(sym => {
                const status = radarStatus[sym];
                return `| ${sym.padEnd(8)} | ${status?.lastAction || 'SCAN'} | ${status?.confidence || 0}% | ${status?.recommendedContract || 'N/A'} |`;
            }).join('\n');

            const systemPrompt = `VOCÊ É UM ANALISTA NO LABORATÓRIO V3.0 (COUNCIL EDITION).
            AGORA O RADAR OPERA A CADA 5 SEGUNDOS EM TODOS OS ATIVOS.
            INSTRUÇÃO: Se pedir para executar (ex: "compre no 1HZ10V"), inclua a tag: [SOLICITAR_EXECUCAO:SYMBOL]
            ${memoryContext}
            RADAR ATUAL:
            ${radarDetails}
            SEU PAPEL: ${targetAgent}. Responda de forma técnica em PT-BR.`;

            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: systemPrompt }, 
                ...chatMessages.map(m => ({ role: m.role, content: m.content }))
            ]);
            
            if (response.success) {
                const assistantContent = response.success;
                setChatMessages(prev => [...prev, { role: 'assistant', content: assistantContent, time: new Date().toLocaleTimeString(), agentName: targetAgent }]);

                const executionTag = assistantContent.match(/\[SOLICITAR_EXECUCAO:(.*?)\]/);
                if (executionTag && executionTag[1]) {
                    const requestedSymbol = executionTag[1].trim();
                    const targetCandles = requestedSymbol === activeSymbol ? chartData : multiAssetCandles[requestedSymbol];
                    if (targetCandles && targetCandles.length >= 30) {
                        addLog(`Chat autorizou execução tática em ${requestedSymbol}.`, 'decision');
                        await runAnalysisForSymbol(requestedSymbol, targetCandles as CandleData[], true);
                    }
                }
            }
        } catch (error: any) {
            toast({ title: "Erro no Chat", description: error.message, variant: "destructive" });
        } finally {
            setIsChatLoading(false);
        }
    };

    useEffect(() => {
        const timer = setInterval(() => {
            setTimeToNextAnalysis(prev => prev <= 1 ? analysisInterval : prev - 1);
        }, 1000);
        return () => clearInterval(timer);
    }, [analysisInterval]);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        lastDecision, timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        allowedContracts, setAllowedContracts,
        maxConcurrentTrades, setMaxConcurrentTrades,
        stakeValue, setStakeValue,
        dailyBalance, setDailyBalance,
        dailyTarget, setDailyTarget,
        sessionStats,
        reasoningLog, addLog, memoryBuffer, accountBalance,
        radarStatus, watchedSymbols, setWatchedSymbols,
        resetSession,
        chatMessages, isChatLoading, sendMessage,
        executeManualDecision: () => lastDecision && runAnalysisForSymbol(activeSymbol!, chartData, true),
        telemetry,
        ollamaConfig,
        availableModels,
        updateOllamaConfig,
        fetchAvailableModels,
        setAccountType,
        accountType
    };
}
