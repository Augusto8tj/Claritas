'use client';

/**
 * @fileOverview TERMINAL QUANT V3.6 (COUNCIL EDITION) - MONITORAMENTO MULTI-ATIVO
 * V3.6: Fila Sequencial de Inferência (Hardware-Safe), Agendamento Half-Cycle
 * e Estabilidade via Refs para evitar over-rendering.
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

    // REFS PARA ESTABILIDADE (CORREÇÃO CRÍTICA: ITEM 1 & 4)
    const chartDataRef = useRef(chartData);
    const multiAssetCandlesRef = useRef(multiAssetCandles);
    const watchedSymbolsRef = useRef(watchedSymbols);
    const activeSymbolRef = useRef(activeSymbol);
    const analysisIntervalRef = useRef(analysisInterval);
    const priceTicksRef = useRef(priceTicks);
    const operationsLogRef = useRef(operationsLog);
    const scheduleRef = useRef<Record<string, number>>({});
    const executionLockRef = useRef(false);

    useEffect(() => { chartDataRef.current = chartData; }, [chartData]);
    useEffect(() => { multiAssetCandlesRef.current = multiAssetCandles; }, [multiAssetCandles]);
    useEffect(() => { watchedSymbolsRef.current = watchedSymbols; }, [watchedSymbols]);
    useEffect(() => { activeSymbolRef.current = activeSymbol; }, [activeSymbol]);
    useEffect(() => { analysisIntervalRef.current = analysisInterval; }, [analysisInterval]);
    useEffect(() => { priceTicksRef.current = priceTicks; }, [priceTicks]);
    useEffect(() => { operationsLogRef.current = operationsLog; }, [operationsLog]);

    // RADAR E MEMÓRIA
    const [radarStatus, setRadarStatus] = useState<Record<string, RadarAssetStatus>>({});
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [reasoningLog, setReasoningLog] = useState<any[]>([]);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [availableModels, setAvailableModels] = useState<any[]>([]);

    // OLLAMA CONFIG
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

    // ANÁLISE POR SÍMBOLO (ESTÁVEL)
    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManualTrigger: boolean = false) => {
        if (!isConnected || !ollamaConfig || candles.length < 30 || !user) return;
        
        const isFocused = symbol === activeSymbolRef.current;
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
            throw err;
        }
    }, [isConnected, ollamaConfig, isShadowMode, user, isAutoMode, allowedContracts, maxConcurrentTrades, dailyBalance, executeTrade, addLog, stakeValue]);

    // CORREÇÃO CRÍTICA: FILA SEQUENCIAL E SCHEDULING (ITEM 1, 2, 3, 5)
    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || !isConnected || !ollamaConfig) return;
        executionLockRef.current = true;

        const startTime = Date.now();
        try {
            const currentActive = activeSymbolRef.current;
            const currentInterval = analysisIntervalRef.current;
            
            // 1. Identifica ativos que precisam de varredura (V3.6 Logic)
            const dueSymbols = watchedSymbolsRef.current.filter(sym => (scheduleRef.current[sym] || 0) <= startTime);
            if (dueSymbols.length === 0) return;

            // 2. Priorização: Ativo em foco sempre primeiro
            dueSymbols.sort((a, b) => (a === currentActive ? -1 : (b === currentActive ? 1 : 0)));

            // 3. Processamento SEQUENCIAL (Concurrency 1 - Hardware Safe)
            for (const symbol of dueSymbols) {
                const isFocused = symbol === currentActive;
                const candles = isFocused ? chartDataRef.current : multiAssetCandlesRef.current[symbol];
                
                if (candles && candles.length >= 30) {
                    const callStart = Date.now();
                    addLog(`[HARDWARE] >>> INÍCIO INFERÊNCIA: ${symbol} (${isFocused ? 'FOCO' : 'BACKGROUND'})`, 'info');
                    
                    try {
                        await runAnalysisForSymbol(symbol, candles as CandleData[]);
                    } catch (e: any) {
                        addLog(`Falha na análise de ${symbol}: ${e.message}`, 'error');
                    }

                    const callEnd = Date.now();
                    const durationSec = ((callEnd - callStart) / 1000).toFixed(2);
                    
                    // 4. Agendamento Half-Cycle (Respeitando a config do usuário)
                    const nextInterval = isFocused ? currentInterval : Math.max(currentInterval * 0.5, 10);
                    scheduleRef.current[symbol] = callEnd + (nextInterval * 1000);
                    
                    addLog(`[HARDWARE] <<< FIM INFERÊNCIA: ${symbol} (T=${durationSec}s). Próxima análise em ${nextInterval}s.`, 'info');
                }
            }
        } finally {
            executionLockRef.current = false;
        }
    }, [isConnected, ollamaConfig, runAnalysisForSymbol, addLog]);

    // Scanner fixo de 5s para verificar a fila de ativos "due"
    useEffect(() => {
        const scanner = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(scanner);
    }, [runMultiAssetCycle]);

    // Gatilho imediato para ativo focado (Unificado)
    useEffect(() => {
        if (activeSymbol && chartData.length >= 30 && !executionLockRef.current) {
            const nextRun = scheduleRef.current[activeSymbol] || 0;
            if (Date.now() >= nextRun - 2000) { // Pequena folga para agilidade
                runMultiAssetCycle();
            }
        }
    }, [activeSymbol, chartData.length, runMultiAssetCycle]);

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
            // Aguarda o hardware liberar se estiver em análise de radar
            while (executionLockRef.current) {
                await new Promise(r => setTimeout(r, 500));
            }
            executionLockRef.current = true;

            const memoryContext = TradeMemoryManager.formatBufferForPrompt(memoryBuffer);
            const radarDetails = watchedSymbolsRef.current.map(sym => {
                const status = radarStatus[sym];
                return `- Ativo: ${sym} | Status: ${status?.lastAction || 'AGUARDANDO PRIMEIRA VARREDURA'} | Confiança: ${status?.confidence || 0}% | Contrato Sugerido: ${status?.recommendedContract || 'Análise Pendente'}`;
            }).join('\n');

            const systemPrompt = `VOCÊ É O CONSELHO TÁTICO DO LABORATÓRIO V3.0 (COUNCIL EDITION).
            ATUAÇÃO: Você monitora diversos ativos simultaneamente em fila sequencial.
            
            ESTADO ATUAL DO RADAR (DADOS EM TEMPO REAL):
            ${radarDetails}
            
            ${memoryContext}
            
            SUA MISSÃO:
            1. Responda de forma clara, técnica e fundamentada em português.
            2. EXECUÇÃO TÁTICA: Se o usuário der ordem clara, inclua obrigatoriamente no final: [SOLICITAR_EXECUCAO:SYMBOL]`;

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
                    const targetCandles = requestedSymbol === activeSymbolRef.current ? chartDataRef.current : multiAssetCandlesRef.current[requestedSymbol];
                    if (targetCandles && targetCandles.length >= 30) {
                        addLog(`Chat autorizou execução tática em ${requestedSymbol}.`, 'decision');
                        await runAnalysisForSymbol(requestedSymbol, targetCandles as CandleData[], true);
                    }
                }
            }
        } catch (error: any) {
            addLog(`Falha no chat: ${error.message}`, 'error');
        } finally {
            executionLockRef.current = false;
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
        executeManualDecision: () => lastDecision && runAnalysisForSymbol(activeSymbolRef.current!, chartDataRef.current, true),
        telemetry, ollamaConfig, availableModels, updateOllamaConfig, fetchAvailableModels,
        setAccountType, accountType
    };
}
