'use client';

/**
 * @fileOverview TERMINAL QUANT V3.0 (COUNCIL EDITION) - MONITORAMENTO MULTI-ATIVO
 * Lógica de laboratório com conselho paralelo, memória viva e radar multi-ativo.
 * V3.5: Chat interativo com suporte a personas e injeção de memória viva.
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
import { CouncilDecision, TradeMemoryBuffer, AgentOpinion } from '../types/council';
import { getOllamaResponse } from '@/app/actions';

export interface RadarAssetStatus {
    symbol: string;
    lastAction: 'RISE' | 'FALL' | 'HOLD';
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

    // ESTADOS DE CONTROLE
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [analysisInterval, setAnalysisInterval] = useState(120); 
    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(120);
    
    // GESTÃO DE CONTRATOS E FREQUÊNCIA
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
    
    const executionLockRef = useRef(false);
    const scheduleRef = useRef<Record<string, number>>({});

    const ollamaConfig = useMemo(() => {
        if (typeof window === 'undefined') return null;
        const saved = localStorage.getItem('ollamaConfig');
        return saved ? JSON.parse(saved) as OllamaConfig : null;
    }, []);

    const addLog = useCallback((message: string, type: string = 'info') => {
        setReasoningLog(prev => [{ time: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
    }, []);

    // Session Stats
    const sessionStats = useMemo(() => {
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && op.initiator === 'Conselho'
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const pnl = finishedTrades.reduce((acc, op) => acc + (Number(op.result) || 0), 0);
        return { pnl: Number(pnl) || 0, winRate: finishedTrades.length > 0 ? (wins / finishedTrades.length) * 100 : null, total: finishedTrades.length };
    }, [operationsLog]);

    // Carrega a memória inicial
    useEffect(() => {
        if (user) {
            TradeMemoryManager.getBuffer(user.uid).then(setMemoryBuffer);
        }
    }, [user]);

    // Monitora fechamento de trades para alimentar a memória
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
        
        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            const snapshot = {
                symbol: symbol,
                price: isFocused ? priceTicks[priceTicks.length - 1]?.price : candles[candles.length - 1].close,
                rsi: indicators?.rsi,
                bbw: indicators?.bbw,
                trend: indicators?.adx! > 25 ? 'Trending' : 'Ranging'
            };

            const buffer = user ? await TradeMemoryManager.getBuffer(user.uid) : { wins: [], losses: [] };
            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode);
            
            if (isFocused) setLastDecision(decision);

            setRadarStatus(prev => ({
                ...prev,
                [symbol]: {
                    symbol,
                    lastAction: decision.finalAction,
                    confidence: decision.consensusConfidence,
                    timestamp: Date.now(),
                    isQualified: decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65,
                    executedVia: decision.executedVia,
                    opinions: decision.opinions
                }
            }));

            // Execução do Autopilot
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
                    if (isFocused) addLog(`[EXEC] Ordem real disparada: ${decision.recommendedContract} em ${symbol}`, 'execution');
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
            const candles = symbol === activeSymbol ? chartData : multiAssetCandles[symbol];
            if (candles && candles.length >= 30) {
                await runAnalysisForSymbol(symbol, candles);
                scheduleRef.current[symbol] = now + (analysisInterval * 1000);
            }
        }

        executionLockRef.current = false;
    }, [watchedSymbols, activeSymbol, chartData, multiAssetCandles, analysisInterval, runAnalysisForSymbol]);

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
            
            const agentPrompts: Record<string, string> = {
                CHAIRMAN: "Você é o Chairman do Conselho V3. Sua visão é macro e estratégica, responsável pela síntese final.",
                MOMENTUM: "Você é o analista 'Quant Momentum'. Seu foco é força, velocidade de ticks e momentum de curto prazo.",
                RISK_CRITIC: "Você é o 'Risk Critic'. Seu trabalho é ser cético, buscar padrões de falha e evitar prejuízos.",
                ARCHIVIST: "Você é o 'Pattern Archivist'. Sua memória é o histórico de vitórias e estruturas de velas vencedoras."
            };

            const systemPrompt = `VOCÊ FAZ PARTE DO CONSELHO QUANTITATIVO DO LABORATÓRIO V3.0 (COUNCIL EDITION).
            
            IDENTIDADE DA EQUIPE:
            - Chairman (Líder): Orquestrador de consenso.
            - Quant Momentum: Analista de força e micro-tendência.
            - Risk Critic: Analista defensivo e post-mortem.
            - Pattern Archivist: Especialista em ressonância de vitórias.

            CONFIGURAÇÃO DA SESSÃO ATUAL:
            - Versão do Terminal: Claritas Copilot V3.0 (IA Lab).
            - Ativos sob Monitoramento Simultâneo: ${watchedSymbols.length} ativos (${watchedSymbols.join(', ')}).
            - Ativo em Foco no Gráfico: ${activeSymbol || 'Nenhum'}.
            - Saldo da Conta: $${accountBalance.balance?.toFixed(2) || '---'}
            - Resultado da Sessão (PnL): $${sessionStats.pnl.toFixed(2)}
            - Taxa de Acerto (Win Rate): ${sessionStats.winRate ? sessionStats.winRate.toFixed(1) + '%' : 'Nenhum trade concluído'}.
            
            ESTADO TÉCNICO (Ativo em Foco):
            - Indicadores: RSI=${indicators?.rsi?.toFixed(1) || 'N/D'} | ADX=${indicators?.adx?.toFixed(1) || 'N/D'} | Volatilidade BBW=${indicators?.bbw?.toFixed(3) || 'N/D'}.
            
            ${memoryContext}
            
            Sua função agora: ${agentPrompts[targetAgent] || agentPrompts.CHAIRMAN}
            Instrução: Responda como um profissional quantitativo sênior. Seja direto, técnico e utilize os dados acima para justificar sua análise.`;

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

    useEffect(() => {
        const interval = setInterval(() => {
            setTimeToNextAnalysis(prev => {
                if (prev <= 1) {
                    runMultiAssetCycle();
                    return analysisInterval;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [runMultiAssetCycle, analysisInterval]);

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
        reasoningLog, memoryBuffer, accountBalance,
        radarStatus, watchedSymbols, setWatchedSymbols,
        resetSession,
        chatMessages, isChatLoading, sendMessage,
        executeManualDecision: () => lastDecision && runMultiAssetCycle()
    };
}
