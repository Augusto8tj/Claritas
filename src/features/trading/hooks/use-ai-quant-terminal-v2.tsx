
'use client';

/**
 * @fileOverview TERMINAL QUANT V2.6 - PROTOCOLO INSTITUCIONAL
 * INOVAÇÕES: Failover Matemático, Shadow Trading, T2T Latency e Feedback Loop.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation } from '@/lib/types';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { getOllamaResponse } from '@/app/actions';
import { calculateAllIndicators, type Indicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../services/council-strategies';
import { detectMarketRegime } from '../services/advanced-trading-services';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveCouncilDecisionLog } from '@/services/financial-data-service';

export type DerivContractType = 
  | 'CALL/PUT' 
  | 'ACCUMULATOR' 
  | 'MULTIPLIER' 
  | 'TOUCH/NOTOUCH'
  | 'DIGIT_OVER_UNDER'
  | 'DIGIT_DIFFER';

interface QuantDecision {
    action: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    reasoning: string;
    duration: number;
    unit: 't' | 's' | 'm';
    recommendedContract: DerivContractType;
    digitPrediction?: number; 
    multiplier?: number; 
    zenThought?: string;
    _detectedRegime?: string;
    _isFallback?: boolean;
}

interface RadarAssetStatus {
    symbol: string;
    lastAction: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    timestamp: number;
    isQualified: boolean;
    recommendedContract?: DerivContractType;
    isFallback?: boolean;
}

interface ReasoningLog {
    time: string;
    message: string;
    type: 'info' | 'decision' | 'execution' | 'error' | 'radar';
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    time: string;
}

export type StrategicProfile = 'conservative' | 'balanced' | 'aggressive';

interface SymbolSchedule {
    nextRunAt: number;
    intervalSec: number;
    lastRegime?: string;
}

// Configuração de Failover
const INFERENCE_TIMEOUT_MS = 1500; 

function computeAdaptiveInterval(regime: string | undefined, baseIntervalSec: number): number {
    switch (regime) {
        case 'breakout':
        case 'trending_bull':
        case 'trending_bear':
            return Math.max(30, Math.round(baseIntervalSec * 0.5));
        case 'ranging':
            return Math.round(baseIntervalSec * 1.5);
        default:
            return baseIntervalSec;
    }
}

export function useAIQuantTerminalV2(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { isConnected, executeTrade, operationsLog, accountBalance, multiAssetCandles, watchedSymbols, clearActiveContracts } = useDerivApiV2();
    const { user } = useAuth();
    const { toast } = useToast();

    // ESTADOS DE CONTROLE
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(false);
    const [lastDecision, setLastDecision] = useState<QuantDecision | null>(null);
    const [analysisInterval, setAnalysisInterval] = useState(120); 
    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(120);
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    const [confidenceThreshold, setConfidenceThreshold] = useState(65);
    
    const [radarStatus, setRadarStatus] = useState<Record<string, RadarAssetStatus>>({});
    const scheduleRef = useRef<Record<string, SymbolSchedule>>({});
    const executionLockRef = useRef(false);

    // FINANCEIRO
    const [stakeValue, setStakeValue] = useState(1.0);
    const [profitTarget, setProfitTarget] = useState(10.0);
    const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(3);
    const [maxDailyLoss, setMaxDailyLoss] = useState(-20.0);
    
    // ESTATÍSTICAS SOMBRA
    const [shadowPnL, setShadowPnL] = useState(0);
    const [shadowTradesCount, setShadowTradesCount] = useState(0);

    const [reasoningLog, setReasoningLog] = useState<ReasoningLog[]>([]);
    const [telemetry, setTelemetry] = useState({ latency: 0, tps: 0, t2t: 0 });
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);

    const currentIndicators = useMemo(() => {
        if (chartData.length < 30) return null;
        return calculateAllIndicators(chartData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
    }, [chartData]);

    const sessionStats = useMemo(() => {
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && op.initiator === 'Conselho' && op.asset === activeSymbol
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const total = finishedTrades.length;
        const winRate = total > 0 ? (wins / total) * 100 : null;
        const pnl = finishedTrades.reduce((acc, op) => acc + (Number(op.result) || 0), 0);
        return { pnl: Number(pnl) || 0, winRate, total };
    }, [operationsLog, activeSymbol]);

    const globalSessionStats = useMemo(() => {
        const today = new Date().toDateString();
        const v2Trades = operationsLog.filter(op => 
            op.initiator === 'Conselho' && 
            new Date(op.timestamp).toDateString() === today &&
            op.status !== 'pending'
        );
        const wins = v2Trades.filter(op => op.status === 'won').length;
        const pnl = v2Trades.reduce((acc, op) => acc + (Number(op.result) || 0), 0);
        return {
            total: v2Trades.length,
            wins,
            winRate: v2Trades.length > 0 ? (wins / v2Trades.length) * 100 : null,
            pnl: Number(pnl) || 0
        };
    }, [operationsLog]);

    const ollamaConfig = useMemo(() => {
        if (typeof window === 'undefined') return null;
        const saved = localStorage.getItem('ollamaConfig');
        if (saved) return JSON.parse(saved);
        return null;
    }, []);

    const addLog = useCallback((message: string, type: ReasoningLog['type'] = 'info') => {
        setReasoningLog(prev => [{ time: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
    }, []);

    // FEEDBACK LOOP: Extrai os últimos 3 erros operacionais para o prompt
    const recentFailuresContext = useMemo(() => {
        return operationsLog
            .filter(op => op.status === 'lost' && op.initiator === 'Conselho')
            .slice(0, 3)
            .map(op => `- Falha em ${op.asset}: Sugestão ${op.direction.toUpperCase()} em regime ${op.strategy?.split('_')[0] || 'N/A'}`)
            .join('\n');
    }, [operationsLog]);

    // PROTOCOLO DE FALLBACK MATEMÁTICO
    const runMathematicalFallback = (symbol: string, indicators: Indicators | null): QuantDecision => {
        if (!indicators || !indicators.rsi || !indicators.bb) {
            return { action: 'HOLD', confidence: 0, reasoning: 'Dados insuficientes p/ Fallback.', duration: 5, unit: 't', recommendedContract: 'CALL/PUT', _isFallback: true };
        }

        const rsi = indicators.rsi;
        const lastClose = indicators.bb.middle || 0; // Aproximação
        
        let action: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
        let reason = 'Mercado em zona de equilíbrio (Fallback).';
        let confidence = 50;

        if (rsi < 30) {
            action = 'RISE';
            reason = 'RSI Oversold detectado por Failover Matemático.';
            confidence = 65;
        } else if (rsi > 70) {
            action = 'FALL';
            reason = 'RSI Overbought detectado por Failover Matemático.';
            confidence = 65;
        }

        return {
            action,
            confidence,
            reasoning: reason,
            duration: 15,
            unit: 's',
            recommendedContract: 'CALL/PUT',
            _isFallback: true
        };
    };

    const runInference = useCallback(async (symbol: string, currentData: CandleData[], isBackground: boolean) => {
        if (!ollamaConfig || executionLockRef.current) return null;
        
        executionLockRef.current = true;
        const start = performance.now();
        
        const indicators = calculateAllIndicators(currentData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
        const regime = indicators ? detectMarketRegime(currentData, {
            adx: indicators.adx,
            pdi: indicators.pdi,
            ndi: indicators.ndi,
            bbw: indicators.bbw,
            roc: indicators.roc,
            atr: indicators.atr
        }, 'ranging') : null;

        try {
            const prompt = `VOCÊ É O CIO DO TERMINAL CLARITAS V2.6.
            Sua missão é selecionar o melhor CONTRATO e DIREÇÃO.
            
            CONDIÇÕES ATUAIS: Ativo=${symbol} | Perfil=${strategicProfile} | Regime=${regime?.regime}
            DADOS TÉCNICOS: RSI=${indicators?.rsi?.toFixed(1)} | ADX=${indicators?.adx?.toFixed(1)} | BBW=${indicators?.bbw?.toFixed(3)}
            
            HISTÓRICO DE ERROS RECENTES (FEEDBACK LOOP):
            ${recentFailuresContext || "Nenhuma falha recente registrada."}

            DIRETRIZES:
            - RANGING + BBW < 0.8: 'ACCUMULATOR'.
            - ADX > 30 + RSI Alinhado: 'MULTIPLIER' (Mult=400).
            - BREAKOUT iminente: 'DIGIT_OVER_UNDER'.
            - Padrão: 'CALL/PUT'.

            RETORNE APENAS JSON, SEM EXPLICAÇÃO:
            {
              "action": "RISE" | "FALL" | "HOLD",
              "recommendedContract": "CALL/PUT" | "ACCUMULATOR" | "MULTIPLIER" | "DIGIT_OVER_UNDER" | "DIGIT_DIFFER",
              "digitPrediction": 5,
              "multiplier": 400,
              "confidence": 0-100,
              "reasoning": "Texto curto justificando o movimento e considerando os erros passados",
              "duration": 5-300,
              "unit": "t" | "s",
              "zenThought": "Pequeno insight qualitativo"
            }`;

            // Timeout Wrapper para Failover
            const inferencePromise = getOllamaResponse(ollamaConfig, prompt, []);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), INFERENCE_TIMEOUT_MS));

            const response: any = await Promise.race([inferencePromise, timeoutPromise]);
            const end = performance.now();

            if (response.error) throw new Error(response.error);

            const rawContent = (response.success || "").trim();
            const jsonStartIndex = rawContent.indexOf('{');
            const jsonEndIndex = rawContent.lastIndexOf('}');
            
            if (jsonStartIndex === -1 || jsonEndIndex === -1) throw new Error("JSON Inválido");
            
            const cleanJsonString = rawContent.substring(jsonStartIndex, jsonEndIndex + 1);
            const decision: QuantDecision = JSON.parse(cleanJsonString);
            
            decision.confidence = Number(decision.confidence) || 0;
            decision.action = (decision.action || 'HOLD').toUpperCase() as any;

            if (user) {
                saveCouncilDecisionLog(user.uid, {
                    symbol, action: decision.action, confidence: decision.confidence,
                    reasoning: decision.reasoning, regime: regime?.regime,
                    strategicProfile, timestamp: new Date().toISOString(),
                    executed: isAutoMode && !isShadowMode && decision.action !== 'HOLD' && decision.confidence >= confidenceThreshold,
                });
            }

            const latency = Math.round(end - start);
            setTelemetry(prev => ({ ...prev, latency, tps: Math.round((response.metadata?.eval_count || 0) / (latency / 1000)) }));

            return { ...decision, _detectedRegime: regime?.regime };

        } catch (err: any) {
            if (err.message === 'TIMEOUT') {
                addLog(`⚠️ Failover acionado para ${symbol}: Ollama demorou >${INFERENCE_TIMEOUT_MS}ms.`, 'radar');
                return runMathematicalFallback(symbol, indicators);
            }
            addLog(`Erro na inferência (${symbol}): ${err.message}`, 'error');
            return null;
        } finally {
            executionLockRef.current = false;
        }
    }, [ollamaConfig, strategicProfile, user, isAutoMode, isShadowMode, confidenceThreshold, recentFailuresContext, addLog]);

    const runWatchedSymbolsCycle = useCallback(async () => {
        if (!isConnected || executionLockRef.current) return;

        const now = Date.now();
        const dueSymbols = watchedSymbols.filter(sym => {
            const sched = scheduleRef.current[sym];
            return !sched || now >= sched.nextRunAt;
        });

        if (dueSymbols.length === 0) return;

        for (const dueSymbol of dueSymbols) {
            const candles = multiAssetCandles[dueSymbol];
            if (!candles || candles.length < 30) continue;

            const cycleStart = performance.now();
            const isFocused = dueSymbol === activeSymbol;
            const decision = await runInference(dueSymbol, isFocused ? chartData : candles, !isFocused);

            if (decision) {
                const regime = decision._detectedRegime || 'ranging';
                const adaptiveInterval = computeAdaptiveInterval(regime, analysisInterval);
                
                scheduleRef.current[dueSymbol] = {
                    nextRunAt: now + adaptiveInterval * 1000,
                    intervalSec: adaptiveInterval,
                    lastRegime: regime
                };

                setRadarStatus(prev => ({
                    ...prev,
                    [dueSymbol]: {
                        symbol: dueSymbol,
                        lastAction: decision.action,
                        confidence: decision.confidence,
                        timestamp: now,
                        isQualified: decision.action !== 'HOLD' && decision.confidence >= confidenceThreshold,
                        recommendedContract: decision.recommendedContract,
                        isFallback: decision._isFallback
                    }
                }));

                if (isFocused) setLastDecision(decision);

                // LOGICA DE EXECUÇÃO (REAL OU SOMBRA)
                if ((isAutoMode || isShadowMode) && decision.action !== 'HOLD' && (decision.confidence ?? 0) >= confidenceThreshold) {
                    const hasOpenTrade = operationsLog.some(op => op.asset === dueSymbol && op.status === 'pending');
                    
                    if (!hasOpenTrade) {
                        if (isShadowMode) {
                            addLog(`[SHADOW] Simulando ${decision.recommendedContract} em ${dueSymbol}...`, 'radar');
                            setShadowTradesCount(prev => prev + 1);
                            // Simula lucro teórico de 95% ou perda total
                            const win = Math.random() > 0.45; 
                            setShadowPnL(prev => prev + (win ? stakeValue * 0.95 : -stakeValue));
                        } else {
                            let finalContractType = 'CALL';
                            let extraProposalParams: Record<string, any> = {};

                            switch (decision.recommendedContract) {
                                case 'ACCUMULATOR': finalContractType = 'ACCU'; break;
                                case 'MULTIPLIER': 
                                    finalContractType = decision.action === 'RISE' ? 'MULTUP' : 'MULTDOWN'; 
                                    extraProposalParams = { multiplier: decision.multiplier || 400 }; 
                                    break;
                                case 'DIGIT_OVER_UNDER':
                                    finalContractType = decision.action === 'RISE' ? 'DIGITOVER' : 'DIGITUNDER';
                                    extraProposalParams = { barrier: String(decision.digitPrediction || 5) };
                                    break;
                                default: finalContractType = decision.action === 'RISE' ? 'CALL' : 'PUT';
                            }

                            addLog(`[EXEC] Disparando ${decision.recommendedContract} em ${dueSymbol}.`, 'execution');
                            
                            const tradeStart = performance.now();
                            try {
                                await executeTrade(
                                    finalContractType, stakeValue, dueSymbol, decision.action.toLowerCase() as 'rise' | 'fall',
                                    decision.duration || 15, (decision.unit || 's') as DurationUnit, 'Conselho', 
                                    `QuantV2_${decision.recommendedContract}`, extraProposalParams
                                );
                                setTelemetry(prev => ({ ...prev, t2t: Math.round(performance.now() - tradeStart) }));
                            } catch (err: any) {
                                addLog(`Falha na execução (${dueSymbol}): ${err.message}`, 'error');
                            }
                        }
                    }
                }
            }
        }
    }, [isConnected, watchedSymbols, multiAssetCandles, activeSymbol, chartData, runInference, confidenceThreshold, analysisInterval, isAutoMode, isShadowMode, operationsLog, stakeValue, executeTrade, addLog]);

    const resetSession = useCallback(() => {
        setIsAutoMode(false);
        setIsShadowMode(false);
        clearActiveContracts();
        setRadarStatus({});
        setReasoningLog([]);
        setChatMessages([]);
        setShadowPnL(0);
        setShadowTradesCount(0);
        scheduleRef.current = {};
        setLastDecision(null);
        toast({ title: "Sessão Reiniciada", description: "O histórico e os contadores de sombra foram resetados." });
    }, [clearActiveContracts, toast]);

    const sendMessage = async (content: string) => {
        if (!ollamaConfig || !content.trim()) return;

        const userMsg: ChatMessage = { role: 'user', content, time: new Date().toLocaleTimeString() };
        setChatMessages(prev => [...prev, userMsg]);
        setIsChatLoading(true);

        const systemPrompt = `Você é o CIO do Terminal Claritas V2.6.
        HISTÓRICO FINANCEIRO: PNL=$${globalSessionStats.pnl.toFixed(2)} | WR=${globalSessionStats.winRate?.toFixed(1)}% | Saldo=$${accountBalance.balance}
        MEMÓRIA DE ERROS RECENTES:
        ${recentFailuresContext || "Nenhuma"}
        
        INSTRUÇÕES:
        1. Responda de forma técnica e analítica.
        2. Se o usuário pedir para executar algo, analise o risco e responda com "ARMANDO OPERAÇÃO" no final se aprovar.
        3. Use o histórico de erros acima para justificar se deve ser mais cauteloso agora.`;

        try {
            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: systemPrompt },
                ...chatMessages.map(m => ({ role: m.role, content: m.content }))
            ]);
            
            if (response.success) {
                const assistantContent = response.success;
                setChatMessages(prev => [...prev, { role: 'assistant', content: assistantContent, time: new Date().toLocaleTimeString() }]);
                
                if (assistantContent.includes('ARMANDO OPERAÇÃO') && activeSymbol && chartData.length >= 30) {
                    addLog(`CIO autorizou execução tática em ${activeSymbol}.`, 'decision');
                    const decision = await runInference(activeSymbol, chartData, false);
                    if (decision) {
                        setLastDecision(decision);
                        toast({ title: "🎯 Ordem Tática Armada", description: "Verifique o veredito e autorize a execução." });
                    }
                }
            }
        } catch (e: any) {
            addLog(`Falha no CIO: ${e.message}`, 'error');
        } finally {
            setIsChatLoading(false);
        }
    };

    const radarScanRef = useRef(runWatchedSymbolsCycle);
    useEffect(() => { radarScanRef.current = runWatchedSymbolsCycle; }, [runWatchedSymbolsCycle]);

    useEffect(() => {
        const interval = setInterval(() => {
            setTimeToNextAnalysis(prev => prev <= 1 ? analysisInterval : prev - 1);
        }, 1000);
        return () => clearInterval(interval);
    }, [analysisInterval]);

    useEffect(() => {
        const scanInterval = setInterval(() => radarScanRef.current(), 5000);
        return () => clearInterval(scanInterval);
    }, []);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        shadowPnL, shadowTradesCount,
        lastDecision, timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        strategicProfile, setStrategicProfile: handleSetStrategicProfile, 
        confidenceThreshold, setConfidenceThreshold,
        radarStatus, reasoningLog, telemetry, sessionStats, globalSessionStats,
        accountBalance, stakeValue, setStakeValue, profitTarget, setProfitTarget,
        maxConsecutiveLosses, setMaxConsecutiveLosses, maxDailyLoss, setMaxDailyLoss,
        chatMessages, isChatLoading, sendMessage, resetSession,
        executeManualDecision: () => lastDecision && runWatchedSymbolsCycle()
    };
}
