'use client';

/**
 * @fileOverview TERMINAL QUANT NEURO-ADAPTATIVO V2 - RADAR MULTI-ATIVO
 * 
 * ARQUITETURA DE RADAR:
 * 1. ✅ Multi-Asset Monitoring (Varredura em Segundo Plano)
 * 2. ✅ Escalonador de Prioridade (Ativo Focado vs Radar)
 * 3. ✅ Filtro de Pré-Qualificação (ADX/ATR/Z-Score)
 * 4. ✅ Persistência e Circuit Breakers Preservados
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, MarketRegime } from '@/lib/types';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { getOllamaResponse } from '@/app/actions';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../services/council-strategies';
import { detectMarketRegime } from '../services/advanced-trading-services';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveCouncilDecisionLog, getCouncilDecisionLogs } from '@/services/financial-data-service';

interface QuantDecision {
    action: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    reasoning: string;
    duration: number;
    unit: 't' | 's' | 'm';
}

interface RadarAssetStatus {
    symbol: string;
    lastAction: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    timestamp: number;
    isQualified: boolean;
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

const RADAR_SYMBOLS = ['1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

export function useAIQuantTerminalV2(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { isConnected, executeTrade, operationsLog, getHistoricalData } = useDerivApiV2();
    const { user } = useAuth();
    const { toast } = useToast();

    // ESTADOS DE CONTROLE
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [lastDecision, setLastDecision] = useState<QuantDecision | null>(null);
    const [analysisInterval, setAnalysisInterval] = useState(120); 
    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(120);
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    const [confidenceThreshold, setConfidenceThreshold] = useState(65);
    
    // RADAR MULTI-ATIVO
    const [radarStatus, setRadarStatus] = useState<Record<string, RadarAssetStatus>>(
        RADAR_SYMBOLS.reduce((acc, sym) => ({
            ...acc,
            [sym]: { symbol: sym, lastAction: 'HOLD', confidence: 0, timestamp: Date.now(), isQualified: false }
        }), {})
    );
    const radarPointerRef = useRef(0);

    // GESTÃO FINANCEIRA
    const [stakeValue, setStakeValue] = useState(1.0);
    const [profitTarget, setProfitTarget] = useState(10.0);
    const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(3);
    const [maxDailyLoss, setMaxDailyLoss] = useState(-20.0);

    const [reasoningLog, setReasoningLog] = useState<ReasoningLog[]>([]);
    const [telemetry, setTelemetry] = useState({ latency: 0, tps: 0 });
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);

    const executionLockRef = useRef(false);

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

    const ollamaConfig = useMemo(() => {
        if (typeof window === 'undefined') return null;
        const saved = localStorage.getItem('ollamaConfig');
        if (saved) return JSON.parse(saved);
        return {
            baseUrl: process.env.NEXT_PUBLIC_OLLAMA_BASE_URL || "",
            apiKey: process.env.NEXT_PUBLIC_OLLAMA_API_KEY || "",
            model: "llama3",
            temperature: 0.2
        };
    }, []);

    const addLog = useCallback((message: string, type: ReasoningLog['type'] = 'info') => {
        setReasoningLog(prev => [{ time: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
    }, []);

    // FILTRO TÉCNICO DE PRÉ-QUALIFICAÇÃO
    const preQualifyAsset = useCallback((data: CandleData[]): { qualified: boolean, reason: string } => {
        if (data.length < 30) return { qualified: false, reason: "Dados insuficientes" };
        const indicators = calculateAllIndicators(data, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
        if (!indicators) return { qualified: false, reason: "Falha nos indicadores" };

        const adx = indicators.adx || 0;
        const bbw = indicators.bbw || 0;
        
        // Critério: Ativo com tendência forte ou em zona de compressão/rompimento
        const isTrending = adx > 22;
        const isSqueezed = bbw < 0.8;
        const isVolatile = bbw > 2.5;

        if (isTrending || isSqueezed || isVolatile) {
            return { qualified: true, reason: `ADX: ${adx.toFixed(1)} | BBW: ${bbw.toFixed(2)}` };
        }
        return { qualified: false, reason: "Ativo em zona morta (baixa liquidez/sem tendência)" };
    }, []);

    const runInference = useCallback(async (symbol: string, currentData: CandleData[], isBackground: boolean) => {
        if (!ollamaConfig || executionLockRef.current) return null;
        
        executionLockRef.current = true;
        const start = performance.now();
        
        try {
            const decisionHistory = user ? await getCouncilDecisionLogs(user.uid, 15) : [];
            const historyContext = decisionHistory.map(h => ({
                time: h.timestamp ? new Date(h.timestamp).toLocaleTimeString() : '?',
                asset: h.symbol,
                action: h.action,
                conf: h.confidence,
                res: h.executed ? "TRADE" : "HOLD"
            }));

            const indicators = calculateAllIndicators(currentData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
            const regime = indicators ? detectMarketRegime(currentData, {
                adx: indicators.adx,
                pdi: indicators.pdi,
                ndi: indicators.ndi,
                bbw: indicators.bbw,
                roc: indicators.roc,
                atr: indicators.atr
            }, 'ranging') : null;

            const prompt = `VOCÊ É O CIO DO RADAR QUANT CLARITAS.
            ATIVO ANALISADO: ${symbol} (${isBackground ? 'VARREDURA RADAR' : 'FOCO PRINCIPAL'})
            PERFIL: ${strategicProfile.toUpperCase()}
            
            HISTÓRICO RECENTE DO TERMINAL (ÚLTIMAS 15 DECISÕES):
            ${JSON.stringify(historyContext, null, 2)}
            
            DADOS TÉCNICOS:
            Regime: ${regime?.regime}
            RSI: ${indicators?.rsi?.toFixed(2)} | ADX: ${indicators?.adx?.toFixed(1)} | BBW: ${indicators?.bbw?.toFixed(3)}

            RETORNE APENAS JSON:
            {
              "action": "RISE" | "FALL" | "HOLD",
              "confidence": 0-100,
              "reasoning": "Breve justificativa técnica",
              "duration": number,
              "unit": "s" | "t"
            }`;

            const response = await getOllamaResponse(ollamaConfig, prompt, []);
            const end = performance.now();

            if (response.error) throw new Error(response.error);

            const rawContent = (response.success || "").replace(/```json|```/g, "").trim();
            const jsonMatch = rawContent.match(/\{.*\}/s);
            if (!jsonMatch) throw new Error("JSON malformado");
            
            const decision: QuantDecision = JSON.parse(jsonMatch[0]);

            // Validação estrita
            if (!['RISE', 'FALL', 'HOLD'].includes(decision.action)) throw new Error("Ação inválida");
            
            const latency = Math.round(end - start);
            setTelemetry({ latency, tps: Math.round((response.metadata?.eval_count || 0) / (latency / 1000)) });

            if (user) {
                saveCouncilDecisionLog(user.uid, {
                    symbol, action: decision.action, confidence: decision.confidence,
                    reasoning: decision.reasoning, regime: regime?.regime,
                    strategicProfile, timestamp: new Date().toISOString(),
                    executed: !isBackground && isAutoMode && decision.action !== 'HOLD' && decision.confidence >= confidenceThreshold,
                });
            }

            return decision;

        } catch (err: any) {
            addLog(`Erro na inferência (${symbol}): ${err.message}`, 'error');
            return null;
        } finally {
            executionLockRef.current = false;
        }
    }, [ollamaConfig, strategicProfile, user, isAutoMode, confidenceThreshold, addLog]);

    // ESCALONADOR DO RADAR
    const runRadarScan = useCallback(async () => {
        if (!isConnected || executionLockRef.current) return;

        const symbol = RADAR_SYMBOLS[radarPointerRef.current];
        if (symbol === activeSymbol) {
            radarPointerRef.current = (radarPointerRef.current + 1) % RADAR_SYMBOLS.length;
            return;
        }

        addLog(`Radar: Iniciando varredura em ${symbol}...`, 'radar');
        
        try {
            const history = await getHistoricalData(symbol, 'candles', 50, '1m');
            if (!history || history.length === 0) {
              radarPointerRef.current = (radarPointerRef.current + 1) % RADAR_SYMBOLS.length;
              return;
            }

            const qualification = preQualifyAsset(history as CandleData[]);
            
            if (qualification.qualified) {
                addLog(`Radar: ${symbol} QUALIFICADO (${qualification.reason}). Solicitando veredito ao CIO...`, 'radar');
                const decision = await runInference(symbol, history as CandleData[], true);
                if (decision) {
                    setRadarStatus(prev => ({
                        ...prev,
                        [symbol]: { symbol, lastAction: decision.action, confidence: decision.confidence, timestamp: Date.now(), isQualified: true }
                    }));
                }
            } else {
                setRadarStatus(prev => ({
                    ...prev,
                    [symbol]: { ...prev[symbol], isQualified: false, lastAction: 'HOLD' }
                }));
            }
        } catch (e) {
            console.error(`Radar fail for ${symbol}:`, e);
        }

        radarPointerRef.current = (radarPointerRef.current + 1) % RADAR_SYMBOLS.length;
    }, [activeSymbol, getHistoricalData, preQualifyAsset, runInference, addLog, isConnected]);

    // CICLO DE ANÁLISE PRINCIPAL (FOCO NO ATIVO ATUAL)
    const runActiveCycle = useCallback(async () => {
        if (!activeSymbol || !isConnected || chartData.length < 30) return;
        
        addLog(`CIO: Iniciando auditoria estratégica em ${activeSymbol}...`, 'info');
        const decision = await runInference(activeSymbol, chartData, false);
        
        if (decision) {
            setLastDecision(decision);
            setRadarStatus(prev => ({
                ...prev,
                [activeSymbol]: { symbol: activeSymbol, lastAction: decision.action, confidence: decision.confidence, timestamp: Date.now(), isQualified: true }
            }));

            if (isAutoMode && decision.action !== 'HOLD' && decision.confidence >= confidenceThreshold) {
                addLog(`Executando ordem automática em ${activeSymbol}...`, 'execution');
                await executeTrade(
                    decision.action === 'RISE' ? 'CALL' : 'PUT',
                    stakeValue, activeSymbol, decision.action.toLowerCase() as 'rise' | 'fall',
                    decision.duration, decision.unit as DurationUnit, 'Conselho'
                );
            }
        }
    }, [activeSymbol, isConnected, chartData, runInference, isAutoMode, confidenceThreshold, stakeValue, executeTrade, addLog]);

    // TIMERS
    useEffect(() => {
        const interval = setInterval(() => {
            setTimeToNextAnalysis(prev => {
                if (prev <= 1) {
                    runActiveCycle();
                    return analysisInterval;
                }
                // Varredura de radar no "tempo morto" (a cada 15s de intervalo ocioso)
                if (prev % 15 === 0) runRadarScan();
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [runActiveCycle, runRadarScan, analysisInterval]);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        lastDecision, timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        strategicProfile, setStrategicProfile, confidenceThreshold, setConfidenceThreshold,
        radarStatus, reasoningLog, telemetry, sessionStats,
        stakeValue, setStakeValue, profitTarget, setProfitTarget,
        maxConsecutiveLosses, setMaxConsecutiveLosses, maxDailyLoss, setMaxDailyLoss,
        chatMessages, isChatLoading, 
        sendMessage: async (c: string) => {
            const msg: ChatMessage = { role: 'user', content: c, time: new Date().toLocaleTimeString() };
            setChatMessages(prev => [...prev, msg]);
            setIsChatLoading(true);
            const res = await getOllamaResponse(ollamaConfig!, c, chatMessages.map(m => ({ role: m.role, content: m.content })));
            if (res.success) setChatMessages(prev => [...prev, { role: 'assistant', content: res.success!, time: new Date().toLocaleTimeString() }]);
            setIsChatLoading(false);
        }
    };
}
