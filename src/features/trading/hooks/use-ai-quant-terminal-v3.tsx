
// src/features/trading/hooks/use-ai-quant-terminal-v3.tsx
'use client';

/**
 * @fileOverview TERMINAL QUANT V3.0 (COUNCIL EDITION) - MONITORAMENTO MULTI-ATIVO
 * V4.6: Ciclo Acelerado (Half-Cycle) e Resiliência de Rede.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi } from './use-deriv-api-v2';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../services/council-strategies';
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
    const { isConnected, executeTrade, operationsLog, accountBalance, watchedSymbols, setWatchedSymbols, multiAssetCandles, clearActiveContracts } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();

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

    const [radarStatus, setRadarStatus] = useState<Record<string, RadarAssetStatus>>({});
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [reasoningLog, setReasoningLog] = useState<any[]>([]);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [availableModels, setAvailableModels] = useState<any[]>([]);
    
    const executionLockRef = useRef(false);
    const scheduleRef = useRef<Record<string, number>>({});
    const analysisFnRef = useRef<() => void>(() => {});

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
        if (!ollamaConfig?.baseUrl) {
            return;
        }

        try {
            const url = ollamaConfig.baseUrl.replace(/\/+$/, '') + '/api/tags';
            const headers: Record<string, string> = { 
                'ngrok-skip-browser-warning': 'true' 
            };
            
            if (ollamaConfig.apiKey) {
                headers['Authorization'] = `Bearer ${ollamaConfig.apiKey}`;
            }

            const response = await fetch(url, { headers });
            if (response.ok) {
                const data = await response.json();
                const models = data.models || [];
                setAvailableModels(models);
                addLog(`Sincronização: ${models.length} modelos encontrados no gateway.`, 'info');
                
                if (!ollamaConfig.model && models.length > 0) {
                    updateOllamaConfig({ model: models[0].name });
                }
            } else {
                const errorBody = await response.text();
                addLog(`Erro ao carregar modelos: ${response.status} ${errorBody}`, 'error');
            }
        } catch (e: any) {
            console.error("Failed to fetch Ollama models:", e);
            addLog(`Falha na conexão com Ollama: ${e.message}`, 'error');
        }
    }, [ollamaConfig, updateOllamaConfig, addLog]);

    useEffect(() => {
        if (ollamaConfig?.baseUrl) {
            fetchAvailableModels();
        }
    }, [ollamaConfig?.baseUrl, fetchAvailableModels]);

    const sessionStats = useMemo(() => {
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && op.initiator === 'Conselho'
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const pnl = finishedTrades.reduce((acc, op) => acc + (Number(op.result) || 0), 0);
        return { pnl: Number(pnl) || 0, winRate: finishedTrades.length > 0 ? (wins / finishedTrades.length) * 100 : null, total: finishedTrades.length };
    }, [operationsLog]);

    useEffect(() => {
        if (user) {
            TradeMemoryManager.getBuffer(user.uid).then(setMemoryBuffer);
        }
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const lastFinished = operationsLog.find(op => 
            op.status !== 'pending' && 
            op.strategy?.startsWith('V3_')
        );

        if (lastFinished) {
            const result = lastFinished.status === 'won' ? 'WIN' : 'LOSS';
            TradeMemoryManager.addTrade(user.uid, {
                id: String(lastFinished.id),
                timestamp: Date.now(),
                contract: (lastFinished.contractType?.startsWith('MULT') ? 'MULTIPLIERS' : (lastFinished.contractType === 'ACCU' ? 'ACCUMULATORS' : (lastFinished.direction === 'rise' ? 'CALL' : 'PUT'))) as any, 
                result,
                pnl: lastFinished.result || 0,
                rsi: 50, 
                volatilityYangZhang: 0,
                candlePattern: 'V3_PATTERN'
            }).then(() => {
                TradeMemoryManager.getBuffer(user.uid).then(setMemoryBuffer);
            });
        }
    }, [operationsLog, user]);

    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[]) => {
        if (!isConnected || !ollamaConfig || candles.length < 30) return;
        
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

            const buffer = user ? await TradeMemoryManager.getBuffer(user.uid) : { wins: [], losses: [] };
            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode);
            
            if (isFocused) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
            }

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
                    opinions: decision.opinions
                }
            }));

            if (isAutoMode && !isShadowMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65) {
                const isContractAllowed = allowedContracts[decision.recommendedContract as keyof AllowedContractsV3];
                if (!isContractAllowed) return;

                const totalOpenTrades = operationsLog.filter(op => op.status === 'pending').length;
                if (totalOpenTrades >= maxConcurrentTrades) return;

                const hasSameContractOpen = operationsLog.some(op => 
                    op.asset === symbol && 
                    op.status === 'pending' && 
                    op.contractType === decision.recommendedContract
                );

                if (!hasSameContractOpen) {
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

                    await executeTrade(
                        finalContractType, stakeValue, symbol, decision.finalAction.toLowerCase() as any,
                        15, 's', 'Conselho', `V3_${decision.executedVia}`, extraProposalParams
                    );
                    if (isFocused) addLog(`[EXEC] Ordem real disparada: ${decision.recommendedContract} em ${symbol} (Entropia: ${decision.telemetry.consensusEntropy.toFixed(2)})`, 'execution');
                }
            }

        } catch (err: any) {
            if (isFocused) addLog(`Erro em ${symbol}: ${err.message}`, 'error');
        }
    }, [isConnected, ollamaConfig, isShadowMode, user, isAutoMode, allowedContracts, maxConcurrentTrades, operationsLog, activeSymbol, priceTicks, executeTrade, addLog, stakeValue]);

    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current) return;
        executionLockRef.current = true;

        const now = Date.now();
        const dueSymbols = watchedSymbols.filter(sym => {
            const nextRun = scheduleRef.current[sym] || 0;
            return now >= nextRun;
        });

        for (const symbol of dueSymbols) {
            const candles = symbol === activeSymbol ? chartData : (multiAssetCandles[symbol] as CandleData[]);
            if (candles && candles.length >= 30) {
                await runAnalysisForSymbol(symbol, candles);
                // V4.6: Redução do ciclo pela metade para garantir monitoramento ágil
                scheduleRef.current[symbol] = now + (analysisInterval * 500); 
            }
        }

        executionLockRef.current = false;
    }, [watchedSymbols, activeSymbol, chartData, multiAssetCandles, analysisInterval, runAnalysisForSymbol]);

    useEffect(() => {
        analysisFnRef.current = runMultiAssetCycle;
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
        toast({ title: "Laboratório Resetado", description: "Histórico, memória e contadores foram limpos." });
    };

    const sendMessage = async (content: string, targetAgent: string = 'CHAIRMAN') => {
        if (!ollamaConfig || !content.trim() || !user) return;

        const userMsg: ChatMessage = { role: 'user', content, time: new Date().toLocaleTimeString() };
        setChatMessages(prev => [...prev, userMsg]);
        setIsChatLoading(true);

        try {
            const memoryContext = TradeMemoryManager.formatBufferForPrompt(memoryBuffer);
            const indicators = calculateAllIndicators(chartData, [], '1m', { duration: 15, unit: 's' });
            
            const radarDetails = watchedSymbols.map(sym => {
                const isFocused = sym === activeSymbol;
                const price = isFocused 
                    ? priceTicks[priceTicks.length - 1]?.price 
                    : multiAssetCandles[sym]?.[multiAssetCandles[sym].length - 1]?.close;
                
                const status = radarStatus[sym];
                const formattedPrice = price ? `$${price.toFixed(2)}` : 'Sincronizando...';
                
                let opinionText = "Aguardando análise técnica...";
                if (status?.opinions?.length) {
                    opinionText = status.opinions.map(o => `[${o.agentName}: ${o.action}(${o.confidence}%)]`).join(' ');
                }
                
                return `| ${sym.padEnd(8)} | ${formattedPrice.padEnd(12)} | ${status?.lastAction || 'SCAN'} | ${status?.confidence || 0}% | ${opinionText} |`;
            }).join('\n');

            const agentPrompts: Record<string, string> = {
                CHAIRMAN: "Você é o Chairman do Conselho V3. Seu papel é a SÍNTESE ESTRATÉGICA. Você ouve seus 3 analistas (MOMENTUM, RISK, ARCHIVIST) e decide se o alinhamento deles justifica um risco de capital. Ignore o valor nominal do preço.",
                MOMENTUM: "Você é o analista 'Quant Momentum'. Seu papel é detectar EXPLOSÃO e FORÇA. Se o preço está estagnado, você vota HOLD. Se está acelerando, você busca CALL/PUT.",
                RISK_CRITIC: "Você é o 'Risk Critic'. Seu papel é o VETO. Você busca instabilidade e ruído. Se detectar anomalia, você barra o trade, mesmo que os outros queiram operar.",
                ARCHIVIST: "Você é o 'Pattern Archivist'. Seu papel é a MEMÓRIA. Você olha para as vitórias passadas do buffer e diz se o cenário atual 'cheira' a sucesso ou fracasso."
            };

            const systemPrompt = `VOCÊ É UM ANALISTA NO LABORATÓRIO V3.0 (COUNCIL EDITION).
            
            ESTRUTURA DO CONSELHO:
            1. CHAIRMAN (Você/Líder): Orquestra o quórum e decide o viés.
            2. MOMENTUM: Analisa velocidade e força (ADX/RSI).
            3. RISK CRITIC: O 'Guarda-Costas' que veta operações perigosas (BBW).
            4. ARCHIVIST: O historiador que compara o cenário com vitórias passadas.

            ### RADAR TÁTICO INSTITUCIONAL (DADOS REAIS)
            | Ativo    | Preço Atual  | Veredito | Confiança | Opiniões dos Agentes (Especialidades) |
            |----------|--------------|----------|-----------|--------------------------------------|
            ${radarDetails}

            REGRA DE RACIOCÍNIO: NUNCA sugira operações baseado no preço nominal ser 'baixo' ou 'alto'. Use a especialidade técnica dos agentes.
            INDICADORES (${activeSymbol}): RSI=${indicators?.rsi?.toFixed(1) || 'N/D'} | ADX=${indicators?.adx?.toFixed(1) || 'N/D'} | BBW=${indicators?.bbw?.toFixed(3) || 'N/D'}.
            
            ${memoryContext}
            
            SEU PAPEL ATUAL: ${agentPrompts[targetAgent] || agentPrompts.CHAIRMAN}
            Responda em português do Brasil de forma técnica, citando seus analistas se necessário.`;

            const history = chatMessages.map(m => ({ role: m.role, content: m.content }));
            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: systemPrompt }, 
                ...history
            ]);
            
            if (response.success) {
                const assistantMsg: ChatMessage = { 
                    role: 'assistant', 
                    content: response.success, 
                    time: new Date().toLocaleTimeString(),
                    agentName: targetAgent
                };
                setChatMessages(prev => [...prev, assistantMsg]);
            }
        } catch (error: any) {
            toast({ title: "Erro no Chat", description: error.message, variant: "destructive" });
        } finally {
            setIsChatLoading(false);
        }
    };

    const timerRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        timerRef.current = setInterval(() => {
            setTimeToNextAnalysis(prev => {
                if (prev <= 1) {
                    if (analysisFnRef.current) analysisFnRef.current();
                    return analysisInterval;
                }
                return prev - 1;
            });
        }, 1000);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [analysisInterval]);

    useEffect(() => {
        setTimeToNextAnalysis(analysisInterval);
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
        executeManualDecision: () => lastDecision && analysisFnRef.current(),
        telemetry,
        ollamaConfig,
        updateOllamaConfig,
        availableModels,
        fetchAvailableModels
    };
}
