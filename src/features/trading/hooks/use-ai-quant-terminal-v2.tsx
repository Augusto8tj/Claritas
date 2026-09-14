
'use client';

/**
 * @fileOverview TERMINAL QUANT V2.5 - RADAR COM SELETIVIDADE DE CONTRATOS
 * Incremento: O CIO agora decide qual o MELHOR TIPO DE CONTRATO para o cenário.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation } from '@/lib/types';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { getOllamaResponse } from '@/app/actions';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../services/council-strategies';
import { detectMarketRegime } from '../services/advanced-trading-services';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveCouncilDecisionLog } from '@/services/financial-data-service';

export type DerivContractType = 'CALL/PUT' | 'ACCUMULATOR' | 'MULTIPLIER' | 'TOUCH/NOTOUCH';

interface QuantDecision {
    action: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    reasoning: string;
    duration: number;
    unit: 't' | 's' | 'm';
    recommendedContract: DerivContractType;
    zenThought?: string;
}

interface RadarAssetStatus {
    symbol: string;
    lastAction: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    timestamp: number;
    isQualified: boolean;
    recommendedContract?: DerivContractType;
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
    const { isConnected, executeTrade, operationsLog, getHistoricalData, accountBalance } = useDerivApiV2();
    const { user } = useAuth();
    const { toast } = useToast();

    const [isAutoMode, setIsAutoMode] = useState(false);
    const [lastDecision, setLastDecision] = useState<QuantDecision | null>(null);
    const [analysisInterval, setAnalysisInterval] = useState(120); 
    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(120);
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    const [confidenceThreshold, setConfidenceThreshold] = useState(65);
    
    const [radarStatus, setRadarStatus] = useState<Record<string, RadarAssetStatus>>(
        RADAR_SYMBOLS.reduce((acc, sym) => ({
            ...acc,
            [sym]: { symbol: sym, lastAction: 'HOLD', confidence: 0, timestamp: Date.now(), isQualified: false }
        }), {})
    );
    const radarPointerRef = useRef(0);

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

    const handleSetStrategicProfile = useCallback((profile: StrategicProfile) => {
        setStrategicProfile(profile);
        const newThreshold = profile === 'conservative' ? 85 : profile === 'balanced' ? 65 : 55;
        setConfidenceThreshold(newThreshold);
        addLog(`Perfil estratégico alterado para ${profile.toUpperCase()}. Limiar ajustado para ${newThreshold}%.`);
    }, [addLog]);

    const runInference = useCallback(async (symbol: string, currentData: CandleData[], isBackground: boolean) => {
        if (!ollamaConfig || executionLockRef.current) return null;
        
        executionLockRef.current = true;
        const start = performance.now();
        
        try {
            const indicators = calculateAllIndicators(currentData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
            const regime = indicators ? detectMarketRegime(currentData, {
                adx: indicators.adx,
                pdi: indicators.pdi,
                ndi: indicators.ndi,
                bbw: indicators.bbw,
                roc: indicators.roc,
                atr: indicators.atr
            }, 'ranging') : null;

            const prompt = `VOCÊ É O ARQUITETO DE RISCO E CIO DO TERMINAL CLARITAS.
            Sua missão é selecionar o melhor TIPO DE CONTRATO para o lucro consistente.
            
            ATIVO: ${symbol} | PERFIL: ${strategicProfile.toUpperCase()}
            REGIME: ${regime?.regime}
            DADOS: RSI=${indicators?.rsi?.toFixed(1)} | ADX=${indicators?.adx?.toFixed(1)} | BBW=${indicators?.bbw?.toFixed(3)}
            
            DIRETRIZES DE INSTRUMENTO:
            1. Se Regime for 'ranging' e BBW < 0.8: Sugira 'ACCUMULATOR' (estabilidade).
            2. Se ADX > 30 e RSI em tendência: Sugira 'MULTIPLIER' (tendência explosiva).
            3. Se Regime for 'breakout': Sugira 'TOUCH/NOTOUCH' (volatilidade direcional).
            4. Padrão: Sugira 'CALL/PUT'.

            RETORNE APENAS JSON:
            {
              "action": "RISE" | "FALL" | "HOLD",
              "recommendedContract": "CALL/PUT" | "ACCUMULATOR" | "MULTIPLIER" | "TOUCH/NOTOUCH",
              "confidence": 0-100,
              "reasoning": "Justificativa técnica e escolha do contrato",
              "duration": number,
              "unit": "s" | "t",
              "zenThought": "Pensamento curto sobre o estado do mercado"
            }`;

            const response = await getOllamaResponse(ollamaConfig, prompt, []);
            const end = performance.now();

            if (response.error) throw new Error(response.error);

            const rawContent = (response.success || "").replace(/```json|```/g, "").trim();
            const jsonMatch = rawContent.match(/\{.*\}/s);
            if (!jsonMatch) throw new Error("JSON malformado");
            
            const decision: QuantDecision = JSON.parse(jsonMatch[0]);

            if (user) {
                saveCouncilDecisionLog(user.uid, {
                    symbol, action: decision.action, confidence: decision.confidence,
                    reasoning: decision.reasoning, regime: regime?.regime,
                    strategicProfile, timestamp: new Date().toISOString(),
                    executed: isAutoMode && decision.action !== 'HOLD' && decision.confidence >= confidenceThreshold,
                });
            }

            const latency = Math.round(end - start);
            setTelemetry({ latency, tps: Math.round((response.metadata?.eval_count || 0) / (latency / 1000)) });

            return decision;

        } catch (err: any) {
            addLog(`Erro na inferência (${symbol}): ${err.message}`, 'error');
            return null;
        } finally {
            executionLockRef.current = false;
        }
    }, [ollamaConfig, strategicProfile, user, isAutoMode, confidenceThreshold, addLog]);

    const runRadarScan = useCallback(async () => {
        if (!isConnected || executionLockRef.current) return;

        const symbol = RADAR_SYMBOLS[radarPointerRef.current];
        if (symbol === activeSymbol) {
            radarPointerRef.current = (radarPointerRef.current + 1) % RADAR_SYMBOLS.length;
            return;
        }

        try {
            const history = await getHistoricalData(symbol, 'candles', 50, '1m');
            if (!history || history.length === 0) {
              radarPointerRef.current = (radarPointerRef.current + 1) % RADAR_SYMBOLS.length;
              return;
            }

            const decision = await runInference(symbol, history as CandleData[], true);
            if (decision) {
                setRadarStatus(prev => ({
                    ...prev,
                    [symbol]: { 
                        symbol, 
                        lastAction: decision.action, 
                        confidence: decision.confidence, 
                        timestamp: Date.now(), 
                        isQualified: decision.action !== 'HOLD',
                        recommendedContract: decision.recommendedContract
                    }
                }));
            }
        } catch (e) {
            console.error(`Radar fail for ${symbol}:`, e);
        }

        radarPointerRef.current = (radarPointerRef.current + 1) % RADAR_SYMBOLS.length;
    }, [activeSymbol, getHistoricalData, runInference, isConnected]);

    const runActiveCycle = useCallback(async () => {
        if (!activeSymbol || !isConnected || chartData.length < 30) return;
        
        addLog(`CIO: Analisando focado ${activeSymbol}...`, 'info');
        const decision = await runInference(activeSymbol, chartData, false);
        
        if (decision) {
            setLastDecision(decision);
            setRadarStatus(prev => ({
                ...prev,
                [activeSymbol]: { 
                    symbol: activeSymbol, 
                    lastAction: decision.action, 
                    confidence: decision.confidence, 
                    timestamp: Date.now(), 
                    isQualified: true,
                    recommendedContract: decision.recommendedContract
                }
            }));

            if (isAutoMode && decision.action !== 'HOLD' && decision.confidence >= confidenceThreshold) {
                const hasOpenTrade = operationsLog.some(op => op.asset === activeSymbol && op.status === 'pending');
                if (!hasOpenTrade) {
                    addLog(`Executando ${decision.recommendedContract} em ${activeSymbol}...`, 'execution');
                    
                    // ✅ MAPEAMENTO DE CONTRATOS PROFISSIONAL
                    let finalContractType = 'CALL';
                    if (decision.recommendedContract === 'ACCUMULATOR') finalContractType = 'ACCU';
                    else if (decision.recommendedContract === 'MULTIPLIER') finalContractType = decision.action === 'RISE' ? 'MULTUP' : 'MULTDOWN';
                    else finalContractType = decision.action === 'RISE' ? 'CALL' : 'PUT';

                    await executeTrade(
                        finalContractType,
                        stakeValue, activeSymbol, decision.action.toLowerCase() as 'rise' | 'fall',
                        decision.duration, decision.unit as DurationUnit, 'Conselho'
                    );
                }
            }
        }
    }, [activeSymbol, isConnected, chartData, runInference, isAutoMode, confidenceThreshold, stakeValue, executeTrade, addLog, operationsLog]);

    const activeCycleRef = useRef(runActiveCycle);
    const radarScanRef = useRef(runRadarScan);
    const analysisIntervalRef = useRef(analysisInterval);

    useEffect(() => {
        activeCycleRef.current = runActiveCycle;
        radarScanRef.current = runRadarScan;
        analysisIntervalRef.current = analysisInterval;
    }, [runActiveCycle, runRadarScan, analysisInterval]);

    useEffect(() => {
        const interval = setInterval(() => {
            setTimeToNextAnalysis(prev => {
                if (prev <= 1) {
                    activeCycleRef.current();
                    return analysisIntervalRef.current;
                }
                if (prev % 15 === 0) {
                    radarScanRef.current();
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        setTimeToNextAnalysis(analysisInterval);
    }, [analysisInterval]);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        lastDecision, timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        strategicProfile, setStrategicProfile: handleSetStrategicProfile, 
        confidenceThreshold, setConfidenceThreshold,
        radarStatus, reasoningLog, telemetry, sessionStats, globalSessionStats,
        accountBalance, stakeValue, setStakeValue, profitTarget, setProfitTarget,
        maxConsecutiveLosses, setMaxConsecutiveLosses, maxDailyLoss, setMaxDailyLoss,
        chatMessages, isChatLoading, 
        sendMessage: async (c: string) => {
            if(!ollamaConfig) return;
            const msg: ChatMessage = { role: 'user', content: c, time: new Date().toLocaleTimeString() };
            setChatMessages(prev => [...prev, msg]);
            setIsChatLoading(true);
            const res = await getOllamaResponse(ollamaConfig, c, chatMessages.map(m => ({ role: m.role, content: m.content })));
            if (res.success) setChatMessages(prev => [...prev, { role: 'assistant', content: res.success!, time: new Date().toLocaleTimeString() }]);
            setIsChatLoading(false);
        }
    };
}
