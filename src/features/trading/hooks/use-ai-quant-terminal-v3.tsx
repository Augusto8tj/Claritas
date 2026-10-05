'use client';

/**
 * @fileOverview TERMINAL QUANT V3.0 (COUNCIL EDITION) - MONITORAMENTO MULTI-ATIVO
 * V3.2: Correção de Deadlock, Memória Segmentada e Ativação Tática via Chat.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi } from './use-deriv-api-v2';
import { calculateAllIndicators } from '../services/indicator-service';
import { getCouncilStrategies } from '../services/council-strategies';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { TradeMemoryManager } from '../services/trade-memory-service';
import { runQuantCouncil } from '../services/quant-council-engine';
import { CouncilDecision, TradeMemoryBuffer, AgentOpinion, CouncilTelemetry } from '../types/council';
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

export type AllowedContractsV3 = {
    'CALL': boolean;
    'PUT': boolean;
    'ACCUMULATORS': boolean;
    'MULTIPLIERS': boolean;
};

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
    const { isConnected, executeTrade, operationsLog, accountBalance, watchedSymbols, setWatchedSymbols, multiAssetCandles, clearActiveContracts, accountType, setAccountType } = useDerivApi();
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
    const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig | null>(null);

    const addLog = useCallback((message: string, type: string = 'info') => {
        setReasoningLog(prev => [{ time: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('ollamaConfig');
            if (saved) {
                try {
                    setOllamaConfig(JSON.parse(saved) as OllamaConfig);
                } catch (e) {
                    console.error("Error parsing ollamaConfig", e);
                }
            }
        }
    }, []);

    const updateOllamaConfig = useCallback((updates: Partial<OllamaConfig>) => {
        if (typeof window === 'undefined') return;
        setOllamaConfig(prev => {
            const current = prev || { baseUrl: '', model: '', temperature: 0.2, keepAlive: '5m' };
            const next = { ...current, ...updates };
            localStorage.setItem('ollamaConfig', JSON.stringify(next));
            return next;
        });
        toast({ title: "Configuração Atualizada", description: "As preferências do Ollama foram salvas." });
    }, [toast]);

    const fetchAvailableModels = useCallback(async () => {
        if (!ollamaConfig?.baseUrl) return;
        try {
            const url = ollamaConfig.baseUrl.replace(/\/+$/, '') + '/api/tags';
            const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
            if (ollamaConfig.apiKey) headers['Authorization'] = `Bearer ${ollamaConfig.apiKey}`;

            const response = await fetch(url, { headers });
            if (response.ok) {
                const data = await response.json();
                const models = data.models || [];
                setAvailableModels(models);
                if (!ollamaConfig.model && models.length > 0) {
                    updateOllamaConfig({ model: models[0].name });
                }
            }
        } catch (e: any) {
            addLog(`Falha na conexão com Ollama: ${e.message}`, 'error');
        }
    }, [ollamaConfig, updateOllamaConfig, addLog]);

    useEffect(() => {
        if (ollamaConfig?.baseUrl && availableModels.length === 0) fetchAvailableModels();
    }, [ollamaConfig?.baseUrl, fetchAvailableModels, availableModels.length]);

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
        if (user) TradeMemoryManager.getBuffer(user.uid).then(setMemoryBuffer);
    }, [user]);

    // MONITORAMENTO MULTI-ATIVO (Surgical Port from V2.5)
    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManualTrigger: boolean = false) => {
        if (!isConnected || !ollamaConfig || candles.length < 30 || !user) return;
        
        const isFocused = symbol === activeSymbol;
        const currentPrice = isFocused ? priceTicks[priceTicks.length - 1]?.price : candles[candles.length - 1].close;
        
        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            const snapshot = {
                symbol: symbol,
                price: currentPrice,
                rsi: indicators?.rsi,
                bbw: indicators?.bbw,
                trend: indicators?.adx! > 25 ? 'Trending' : 'Ranging'
            };

            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);
            
            // Note: runQuantCouncil logic for V3 should handle focused vs background
            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, isFocused);
            
            if (isFocused) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
            }

            // Atualiza o radar com os dados identificados
            setRadarStatus(prev => ({
                ...prev,
                [symbol]: {
                    symbol,
                    lastAction: decision.finalAction,
                    lastPrice: currentPrice,
                    confidence: decision.consensusConfidence,
                    timestamp: Date.now(),
                    isQualified: decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65,
                    executedVia: decision.executedVia,
                    opinions: decision.opinions,
                    recommendedContract: decision.recommendedContract,
                    holdReason: decision.holdReason
                }
            }));

            // Lógica de Execução Multi-Ativo
            const shouldExecute = isManualTrigger || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65);

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                const isContractAllowed = allowedContracts[decision.recommendedContract as keyof AllowedContractsV3];
                if (!isContractAllowed) return;

                const hasSameContractOpen = operationsLog.some(op => 
                    op.asset === symbol && op.status === 'pending' && op.contractType === decision.recommendedContract
                );

                if (!hasSameContractOpen && operationsLog.filter(op => op.status === 'pending').length < maxConcurrentTrades) {
                    if (isShadowMode) {
                        addLog(`[SHADOW] Simulando ${decision.recommendedContract} em ${symbol}...`, 'radar');
                    } else {
                        let finalContractType = 'CALL';
                        let extraProposalParams: Record<string, any> = {};

                        switch (decision.recommendedContract) {
                            case 'ACCUMULATORS': finalContractType = 'ACCU'; break;
                            case 'MULTIPLIERS': 
                                finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN'; 
                                extraProposalParams = { multiplier: 400 }; 
                                break;
                            default: finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                        }

                        const initiator = isManualTrigger ? 'Manual' : 'Conselho_V3';
                        await executeTrade(
                            finalContractType, stakeValue, symbol, decision.finalAction.toLowerCase() as any,
                            15, 's', initiator as any, `V3_${decision.executedVia}`, extraProposalParams
                        );
                        
                        if (isFocused) addLog(`[EXEC] Ordem ${initiator} disparada para ${symbol} via ${decision.executedVia}`, 'execution');
                        
                        if (isManualTrigger) {
                            toast({ title: "🎯 Ordem Tática Executada", description: `${symbol}: ${decision.finalAction} via Chat.` });
                        }
                    }
                }
            }

        } catch (err: any) {
            if (isFocused) addLog(`Erro em ${symbol}: ${err.message}`, 'error');
        }
    }, [isConnected, ollamaConfig, isShadowMode, user, isAutoMode, allowedContracts, maxConcurrentTrades, operationsLog, activeSymbol, priceTicks, executeTrade, addLog, stakeValue, toast]);

    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current) return;
        executionLockRef.current = true;

        const now = Date.now();
        const dueSymbols = watchedSymbols.filter(sym => (scheduleRef.current[sym] || 0) <= now);

        for (const symbol of dueSymbols) {
            const candles = symbol === activeSymbol ? chartData : (multiAssetCandles[symbol] as CandleData[]);
            if (candles && candles.length >= 30) {
                // Not passing executionLockRef here because we want sequential execution in this loop
                await runAnalysisForSymbol(symbol, candles);
                // Define o próximo ciclo para 50% do intervalo definido (Ajuste Half-Cycle)
                scheduleRef.current[symbol] = now + (analysisInterval * 500); 
            }
        }

        executionLockRef.current = false;
    }, [watchedSymbols, activeSymbol, chartData, multiAssetCandles, analysisInterval, runAnalysisForSymbol]);

    // Gatilho inicial e ao trocar de ativo
    useEffect(() => {
        if (isConnected && activeSymbol && chartData.length >= 30) {
            runAnalysisForSymbol(activeSymbol, chartData);
        }
    }, [activeSymbol, isConnected, chartData.length]);

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
            ESTRUTURA: CHAIRMAN (Líder), MOMENTUM, RISK CRITIC, ARCHIVIST.
            
            RADAR TÁTICO:
            | Ativo    | Veredito | Confiança | Contrato Rec. |
            |----------|----------|-----------|---------------|
            ${radarDetails}

            INSTRUÇÃO DE EXECUÇÃO (CRÍTICA):
            - Se o usuário der uma ordem direta de compra/venda (ex: "faça a compra", "execute no ativo X"), você DEVE obrigatoriamente responder confirmando e incluir exatamente esta tag no final da resposta: [SOLICITAR_EXECUCAO:ATIVO] (substitua ATIVO pelo símbolo correto, ex: 1HZ10V).
            
            ${memoryContext}
            SEU PAPEL: ${targetAgent}. Responda de forma técnica em PT-BR.`;

            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: systemPrompt }, 
                ...chatMessages.map(m => ({ role: m.role, content: m.content }))
            ]);
            
            if (response.success) {
                const assistantContent = response.success;
                setChatMessages(prev => [...prev, { role: 'assistant', content: assistantContent, time: new Date().toLocaleTimeString(), agentName: targetAgent }]);

                // PROTOCÓLO DE ATIVAÇÃO TÁTICA VIA CHAT
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
            setTimeToNextAnalysis(prev => {
                if (prev <= 1) {
                    runMultiAssetCycle();
                    return analysisInterval;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [analysisInterval, runMultiAssetCycle]);

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
        executeManualDecision: () => lastDecision && runMultiAssetCycle(),
        telemetry,
        ollamaConfig,
        availableModels,
        updateOllamaConfig,
        fetchAvailableModels,
        setAccountType,
        accountType
    };
}
