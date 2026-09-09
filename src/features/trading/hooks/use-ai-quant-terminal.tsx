'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit } from '@/lib/types';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { getOllamaResponse } from '@/app/actions';
import { calculateAllIndicators } from '../services/indicator-service';
import { getCouncilStrategies } from '../strategies-config-v2'; // Corrigido para o caminho real se necessário, mas usaremos os padrões
import { initialCouncilStrategies } from '../services/council-strategies';
import { detectMarketRegime } from '../services/advanced-trading-services';
import { useToast } from '@/hooks/use-toast';

interface QuantDecision {
    action: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    reasoning: string;
    duration: number;
    unit: 't' | 's' | 'm';
}

interface ReasoningLog {
    time: string;
    message: string;
    type: 'info' | 'decision' | 'execution' | 'error';
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    time: string;
}

export type StrategicProfile = 'conservative' | 'balanced' | 'aggressive';

export function useAIQuantTerminal(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { isConnected, executeTrade, accountBalance, operationsLog } = useDerivApiV2();
    const { toast } = useToast();

    // ESTADOS DE CONTROLE
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [lastDecision, setLastDecision] = useState<QuantDecision | null>(null);
    const [analysisInterval, setAnalysisInterval] = useState(120); 
    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(120);
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    
    // ESTADOS FINANCEIROS
    const [stakeValue, setStakeValue] = useState(1.0);
    const [profitTarget, setProfitTarget] = useState(10.0);

    const [reasoningLog, setReasoningLog] = useState<ReasoningLog[]>([]);
    const [telemetry, setTelemetry] = useState({ latency: 0, tps: 0 });
    
    // CHAT E TESTE
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);

    // REFS
    const executionLockRef = useRef(false);

    // ESTATÍSTICAS DA SESSÃO
    const sessionStats = useMemo(() => {
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && 
            op.initiator === 'Conselho'
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const total = finishedTrades.length;
        const winRate = total > 0 ? (wins / total) * 100 : 100;
        
        const pnl = finishedTrades.reduce((acc, op) => {
            return acc + (Number(op.result) || 0);
        }, 0);
        
        return { pnl, winRate, total };
    }, [operationsLog]);

    // CONFIGURAÇÃO DO OLLAMA
    const ollamaConfig = useMemo(() => {
        if (typeof window === 'undefined') return null;
        const saved = localStorage.getItem('ollamaConfig');
        return saved ? JSON.parse(saved) : {
            baseUrl: "https://boxlike-barrack-silencer.ngrok-free.dev",
            apiKey: "augusto123",
            model: "llama3",
            temperature: 0.2
        };
    }, []);

    const addLog = useCallback((message: string, type: ReasoningLog['type'] = 'info') => {
        const entry = {
            time: new Date().toLocaleTimeString(),
            message,
            type
        };
        setReasoningLog(prev => [entry, ...prev].slice(0, 50));
    }, []);

    const executeTradeAction = useCallback(async (decision: QuantDecision) => {
        if (!activeSymbol) return;

        addLog(`Executando Ordem ${decision.action} via CIO Autopilot...`, 'execution');

        const result = await executeTrade(
            decision.action === 'RISE' ? 'CALL' : 'PUT',
            Number(stakeValue), 
            activeSymbol,
            decision.action.toLowerCase() as 'rise' | 'fall',
            decision.duration,
            decision.unit as DurationUnit,
            'Conselho',
            `Ollama_CIO: ${decision.reasoning}`
        );

        if (result.success) {
            toast({
                title: "💎 Terminal Quant: Trade Enviado",
                description: `Estratégia Neuro-Adaptativa: ${decision.action} ($${Number(stakeValue).toFixed(2)})`
            });
        }
    }, [activeSymbol, executeTrade, addLog, toast, stakeValue]);

    const runAnalysisCycle = useCallback(async () => {
        if (!activeSymbol || !isConnected || !ollamaConfig || chartData.length < 30) return;
        if (executionLockRef.current) return;

        // Proteção: Meta de Lucro Atingida
        if (sessionStats.pnl >= profitTarget) {
            if (isAutoMode) {
                addLog(`🎯 Meta de lucro de $${profitTarget} atingida. Pausando Autopilot.`, 'info');
                setIsAutoMode(false);
                toast({ title: "🏆 Meta Atingida", description: "O lucro alvo da sessão foi alcançado." });
            }
            return;
        }

        executionLockRef.current = true;
        addLog(`CIO iniciando auditoria estratégica (${strategicProfile}) para ${activeSymbol}...`);

        try {
            const indicators = calculateAllIndicators(chartData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
            
            const regime = (indicators && chartData.length >= 30) 
                ? detectMarketRegime(chartData, { 
                    adx: indicators.adx, 
                    pdi: indicators.pdi, 
                    ndi: indicators.ndi, 
                    bbw: indicators.bbw, 
                    roc: indicators.roc, 
                    atr: indicators.atr 
                }, 'ranging') 
                : null;

            const marketContext = {
                symbol: activeSymbol,
                price: priceTicks[priceTicks.length - 1]?.price,
                regime: regime?.regime,
                profile: strategicProfile,
                indicators: {
                    rsi: indicators?.rsi?.toFixed(2),
                    adx: indicators?.adx?.toFixed(1),
                    bbw: indicators?.bbw?.toFixed(3),
                    macd_hist: indicators?.macd?.histogram?.toFixed(4)
                },
                recent_ohlc: chartData.slice(-10).map(c => ({ 
                    c: c.close, 
                    h: c.high, 
                    l: c.low 
                }))
            };

            const prompt = `VOCÊ É O CHIEF INVESTMENT OFFICER (CIO) DO TERMINAL CLARITAS.
            Perfil Estratégico Ativo: ${strategicProfile.toUpperCase()}
            
            DADOS ATUAIS DO MERCADO:
            ${JSON.stringify(marketContext, null, 2)}
            
            SUA MISSÃO:
            Analise a convergência técnica e estocástica. 
            No perfil CONSERVADOR: Exija confluência total (Confiança > 85%).
            No perfil AGRESSIVO: Aceite sinais de momentum rápido (Confiança > 55%).
            
            RETORNE APENAS JSON NESTE FORMATO:
            {
              "action": "RISE" | "FALL" | "HOLD",
              "confidence": 0-100,
              "reasoning": "Explicação quantitativa curta",
              "duration": 15-300,
              "unit": "s" | "t"
            }`;

            const start = performance.now();
            const response = await getOllamaResponse(ollamaConfig, prompt, []);
            const end = performance.now();

            if (response.error) throw new Error(response.error);

            const rawContent = response.success || "";
            const jsonMatch = rawContent.match(/\{.*\}/s);
            if (!jsonMatch) throw new Error("IA retornou formato inválido.");
            
            const decision: QuantDecision = JSON.parse(jsonMatch[0]);
            setLastDecision(decision);
            
            const tokens = response.metadata?.eval_count || 0;
            const latency = Math.round(end - start);
            setTelemetry({ latency, tps: Math.round(tokens / (latency / 1000)) });

            addLog(`Veredito IA: ${decision.action} (${decision.confidence}%)`, 'decision');
            addLog(`Justificativa: ${decision.reasoning}`);

            const minConfidence = strategicProfile === 'conservative' ? 85 : strategicProfile === 'balanced' ? 65 : 55;

            if (isAutoMode && decision.action !== 'HOLD' && decision.confidence >= minConfidence) {
                await executeTradeAction(decision);
            }

        } catch (err: any) {
            addLog(`Erro no Ciclo: ${err.message}`, 'error');
        } finally {
            executionLockRef.current = false;
        }
    }, [activeSymbol, isConnected, chartData, priceTicks, isAutoMode, ollamaConfig, addLog, sessionStats.pnl, profitTarget, executeTradeAction, toast, strategicProfile]);

    const sendMessage = async (content: string) => {
        if (!ollamaConfig || !content.trim()) return;

        const userMsg: ChatMessage = { role: 'user', content, time: new Date().toLocaleTimeString() };
        setChatMessages(prev => [...prev, userMsg]);
        setIsChatLoading(true);

        try {
            const indicators = calculateAllIndicators(chartData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
            const currentPrice = priceTicks[priceTicks.length - 1]?.price;

            const systemPrompt = `Você é o Chief Investment Officer (CIO) do Terminal Claritas. 
            STATUS ATUAL:
            - Ativo: ${activeSymbol}
            - Preço: ${currentPrice?.toFixed(4) || 'N/A'}
            - Perfil: ${strategicProfile}
            - P&L Sessão: $${Number(sessionStats.pnl).toFixed(2)} | Win Rate: ${Number(sessionStats.winRate).toFixed(1)}%
            - Último Veredito: ${lastDecision ? `${lastDecision.action} (${lastDecision.confidence}%)` : 'Nenhum'}
            
            Responda de forma técnica e fundamentada nos números acima.`;

            const history = chatMessages.map(m => ({ role: m.role, content: m.content }));
            
            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: systemPrompt }, 
                ...history
            ]);
            
            if (response.success) {
                const assistantMsg: ChatMessage = { 
                    role: 'assistant', 
                    content: response.success, 
                    time: new Date().toLocaleTimeString() 
                };
                setChatMessages(prev => [...prev, assistantMsg]);
            } else {
                throw new Error(response.error || "Erro sem mensagem.");
            }
        } catch (error: any) {
            console.error("Chat Error:", error);
            const errorMsg: ChatMessage = { 
                role: 'assistant', 
                content: `Erro ao contatar CIO: ${error.message}`, 
                time: new Date().toLocaleTimeString() 
            };
            setChatMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsChatLoading(false);
        }
    };

    // TIMER DE CICLO DINÂMICO
    useEffect(() => {
        const interval = setInterval(() => {
            setTimeToNextAnalysis(prev => {
                if (prev <= 1) {
                    runAnalysisCycle();
                    return analysisInterval; 
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [runAnalysisCycle, analysisInterval]);

    useEffect(() => {
        setTimeToNextAnalysis(analysisInterval);
    }, [analysisInterval]);

    return {
        config: ollamaConfig || { model: 'llama3' },
        isAutoMode,
        toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        lastDecision,
        timeToNextAnalysis,
        analysisInterval,
        setAnalysisInterval,
        strategicProfile,
        setStrategicProfile,
        reasoningLog,
        telemetry,
        sessionStats,
        stakeValue,
        setStakeValue,
        profitTarget,
        setProfitTarget,
        chatMessages,
        isChatLoading,
        sendMessage,
        executeManualDecision: () => lastDecision && executeTradeAction(lastDecision)
    };
}
