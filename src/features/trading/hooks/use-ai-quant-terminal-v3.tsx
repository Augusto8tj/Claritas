
'use client';

/**
 * @fileOverview TERMINAL QUANT V3.6 (COUNCIL EDITION) - MONITORAMENTO MULTI-ATIVO
 * V3.6: Resiliência de Chat, Configuração Síncrona e Execução Tática via NLP.
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
    isError?: boolean;
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

    // ESTADOS DE CONTROLE
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
    
    // GESTÃO FINANCEIRA
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
    const priceTicksRef = useRef(priceTicks);
    const operationsLogRef = useRef(operationsLog);

    useEffect(() => { priceTicksRef.current = priceTicks; }, [priceTicks]);
    useEffect(() => { operationsLogRef.current = operationsLog; }, [operationsLog]);

    // OLLAMA CONFIG - Carregamento Síncrono Robusto
    const ollamaConfig = useMemo(() => {
        if (typeof window === 'undefined') return null;
        const saved = localStorage.getItem('ollamaConfig');
        if (saved) {
            try {
                return JSON.parse(saved) as OllamaConfig;
            } catch (e) {
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
        toast({ title: "Configuração Salva", description: "Reiniciando workspace para aplicar mudanças." });
        window.location.reload();
    }, [ollamaConfig, toast]);

    const fetchAvailableModels = useCallback(async () => {
        if (!ollamaConfig?.baseUrl) {
            toast({ title: "Gateway não configurado", description: "Informe a URL do Ollama nas Configurações.", variant: "destructive" });
            return;
        }
        try {
            const url = ollamaConfig.baseUrl.replace(/\/+$/, '') + '/api/tags';
            const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
            if (ollamaConfig.apiKey) headers['Authorization'] = `Bearer ${ollamaConfig.apiKey}`;

            const response = await fetch(url, { headers });
            if (response.ok) {
                const data = await response.json();
                setAvailableModels(data.models || []);
                toast({ title: "Hardware Sincronizado", description: "Lista de modelos atualizada." });
            }
        } catch (e: any) {
            addLog(`Erro ao buscar modelos: ${e.message}`, 'error');
        }
    }, [ollamaConfig, addLog, toast]);

    const sessionStats = useMemo(() => {
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && (op.initiator === 'Conselho_V3' || op.strategy?.startsWith('V3_'))
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const pnl = finishedTrades.reduce((acc, op) => acc + (Number(op.result) || (op.status === 'lost' ? -op.stake : 0)), 0);
        return { pnl: Number(pnl) || 0, winRate: finishedTrades.length > 0 ? (wins / finishedTrades.length) * 100 : null, total: finishedTrades.length };
    }, [operationsLog]);

    useEffect(() => {
        if (user && activeSymbol) TradeMemoryManager.getBuffer(user.uid, activeSymbol).then(setMemoryBuffer);
    }, [user, activeSymbol]);

    // ANÁLISE POR SÍMBOLO (ESTÁVEL)
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

            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, isFocused, assetPermissions, portfolioState);
            
            if (isFocused) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
            }

            setRadarStatus(prev => ({
                ...prev,
                [symbol]: {
                    symbol, lastAction: decision.finalAction, lastPrice: currentPrice, confidence: decision.consensusConfidence,
                    timestamp: Date.now(), isQualified: decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65,
                    executedVia: decision.executedVia, opinions: decision.opinions, recommendedContract: decision.recommendedContract,
                    holdReason: decision.holdReason
                }
            }));

            const shouldExecute = isManualTrigger || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65);

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                const hasOpen = operationsLogRef.current.some(op => op.asset === symbol && op.status === 'pending');
                if (!hasOpen) {
                    if (isShadowMode) {
                        addLog(`[SHADOW] ${symbol}: ${decision.finalAction} via ${decision.recommendedContract}`, 'radar');
                    } else {
                        let finalContractType = 'CALL';
                        switch (decision.recommendedContract) {
                            case 'ACCUMULATORS': finalContractType = 'ACCU'; break;
                            case 'MULTIPLIERS': finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN'; break;
                            default: finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                        }
                        await executeTrade(finalContractType, stakeValue, symbol, decision.finalAction.toLowerCase() as any, 15, 's', 'Conselho_V3', `V3_${decision.executedVia}`);
                        addLog(`[EXEC] ${symbol} ${decision.finalAction}`, 'execution');
                    }
                }
            }
        } catch (err: any) {
            if (isFocused) addLog(`Erro em ${symbol}: ${err.message}`, 'error');
        }
    }, [isConnected, ollamaConfig, isShadowMode, user, isAutoMode, allowedContracts, maxConcurrentTrades, dailyBalance, activeSymbol, executeTrade, addLog, stakeValue]);

    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || !isConnected || !ollamaConfig) return;
        executionLockRef.current = true;

        try {
            const now = Date.now();
            const dueSymbols = watchedSymbols.filter(sym => (scheduleRef.current[sym] || 0) <= now);
            if (dueSymbols.length === 0) return;

            if (dueSymbols.includes(activeSymbol!)) {
                await runAnalysisForSymbol(activeSymbol!, chartData);
                scheduleRef.current[activeSymbol!] = now + (analysisInterval * 1000);
            }

            const backgroundSymbols = dueSymbols.filter(s => s !== activeSymbol);
            if (backgroundSymbols.length > 0) {
                await Promise.all(backgroundSymbols.map(async (symbol) => {
                    const candles = multiAssetCandles[symbol];
                    if (candles && candles.length >= 30) {
                        await runAnalysisForSymbol(symbol, candles);
                        scheduleRef.current[symbol] = now + 5000; 
                    }
                }));
            }
        } finally {
            executionLockRef.current = false;
        }
    }, [watchedSymbols, activeSymbol, chartData, multiAssetCandles, analysisInterval, runAnalysisForSymbol, isConnected, ollamaConfig]);

    useEffect(() => {
        const scanner = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(scanner);
    }, [runMultiAssetCycle]);

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
        toast({ title: "Sessão Resetada" });
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
                return `- Ativo: ${sym} | Status: ${status?.lastAction || 'AGUARDANDO PRIMEIRA VARREDURA'} | Confiança: ${status?.confidence || 0}% | Contrato Sugerido: ${status?.recommendedContract || 'Análise Pendente'}`;
            }).join('\n');

            const systemPrompt = `VOCÊ É O CONSELHO TÁTICO DO LABORATÓRIO V3.0 (COUNCIL EDITION).
            ATUAÇÃO: Você monitora diversos ativos simultaneamente a cada 5 segundos.
            
            ATIVOS SENDO MONITORADOS NESTA SESSÃO:
            ${watchedSymbols.join(', ')}

            ESTADO ATUAL DO RADAR (DADOS EM TEMPO REAL):
            ${radarDetails}
            
            ${memoryContext}
            
            SUA MISSÃO:
            1. Responda às perguntas do usuário de forma clara, técnica e fundamentada em português do Brasil.
            2. Você TEM acesso aos ativos monitorados listados acima. Se o usuário perguntar quais são, cite-os.
            3. EXECUÇÃO TÁTICA: Se o usuário der uma ordem clara de execução (ex: "compre agora", "faça a compra no 1HZ10V"), você deve responder confirmando a intenção e OBRIGATORIAMENTE incluir a tag EXATA: [SOLICITAR_EXECUCAO:SYMBOL] ao final da sua resposta.
            4. NÃO use tags se o usuário estiver apenas conversando ou fazendo perguntas.
            
            SEU PAPEL NESTE MOMENTO: ${targetAgent}.`;

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
            } else {
                throw new Error(response.error || "Ollama retornou resposta vazia.");
            }
        } catch (error: any) {
            const errorMsg = `⚠️ Erro de Conexão: ${error.message}. Verifique se o Ollama e o Ngrok estão ativos.`;
            setChatMessages(prev => [...prev, { role: 'assistant', content: errorMsg, time: new Date().toLocaleTimeString(), agentName: 'SYSTEM', isError: true }]);
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
        allowedContracts, setAllowedContracts, maxConcurrentTrades, setMaxConcurrentTrades,
        stakeValue, setStakeValue, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
        sessionStats, reasoningLog, memoryBuffer, accountBalance, radarStatus, 
        watchedSymbols, setWatchedSymbols, resetSession, chatMessages, isChatLoading, sendMessage,
        executeManualDecision: () => lastDecision && runAnalysisForSymbol(activeSymbol!, chartData, true),
        telemetry, ollamaConfig, availableModels, updateOllamaConfig, fetchAvailableModels,
        setAccountType, accountType
    };
}
