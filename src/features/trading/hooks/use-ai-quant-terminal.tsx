'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit } from '@/lib/types';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { getOllamaResponse } from '@/app/actions';
import { calculateAllIndicators } from '../services/indicator-service';
import { getCouncilStrategies } from '../services/council-strategies';
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
            op.initiator === 'Conselho' // Filtra apenas trades deste terminal
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const total = finishedTrades.length;
        const winRate = total > 0 ? (wins / total) * 100 : 100;
        
        // Garantia de cálculo numérico para evitar TypeErrors
        const pnl = finishedTrades.reduce((acc, op) => {
            const val = Number(op.result) || 0;
            return acc + val;
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
            stakeValue, 
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
                description: `Estratégia Neuro-Adaptativa: ${decision.action} ($${stakeValue})`
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
        addLog(`CIO iniciando auditoria estratégica para ${activeSymbol}...`);

        try {
            const initialStrategies = getCouncilStrategies('standard');
            const indicators = calculateAllIndicators(chartData, initialStrategies, '1m', { duration: 15, unit: 's' });
            
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
                indicators: {
                    rsi: indicators?.rsi?.toFixed(2),
                    adx: indicators?.adx?.toFixed(1),
                    bbw: indicators?.bbw?.toFixed(3),
                    macd_hist: indicators?.macd?.histogram?.toFixed(4)
                },
                recent_ohlc: chartData.slice(-5).map(c => ({ 
                    c: c.close, 
                    h: c.high, 
                    l: c.low 
                }))
            };

            const prompt = `VOCÊ É O CHIEF INVESTMENT OFFICER (CIO) DO TERMINAL CLARITAS.
            Sua missão: Lucro puro através de análise estocástica e high-frequency.
            
            DADOS ATUAIS:
            ${JSON.stringify(marketContext, null, 2)}
            
            REGRAS:
            - Seja matemático. Ignore emoções.
            - Considere que RSI em 30 é compra APENAS se ADX < 20. Se ADX > 25, siga a tendência.
            - Analise os últimos 5 candles para detectar micro-padrões de reversão.
            
            RETORNE APENAS JSON NESTE FORMATO:
            {
              "action": "RISE" | "FALL" | "HOLD",
              "confidence": 0-100,
              "reasoning": "Breve explicação da convergência técnica",
              "duration": 15,
              "unit": "s"
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

            if (isAutoMode && decision.action !== 'HOLD' && decision.confidence >= 65) {
                await executeTradeAction(decision);
            }

        } catch (err: any) {
            addLog(`Erro no Ciclo: ${err.message}`, 'error');
        } finally {
            executionLockRef.current = false;
        }
    }, [activeSymbol, isConnected, chartData, priceTicks, isAutoMode, ollamaConfig, addLog, sessionStats.pnl, profitTarget, executeTradeAction, toast]);

    const sendMessage = async (content: string) => {
        if (!ollamaConfig || !content.trim()) return;

        const userMsg: ChatMessage = { role: 'user', content, time: new Date().toLocaleTimeString() };
        setChatMessages(prev => [...prev, userMsg]);
        setIsChatLoading(true);

        try {
            // Geração de contexto rico para o CIO no Chat
            const initialStrategies = getCouncilStrategies('standard');
            const indicators = calculateAllIndicators(chartData, initialStrategies, '1m', { duration: 15, unit: 's' });
            const currentPrice = priceTicks[priceTicks.length - 1]?.price;

            const systemPrompt = `Você é o Chief Investment Officer (CIO) do Terminal Claritas. 
            Sua missão é atuar como consultor estratégico sênior. 

            STATUS ATUAL DO TERMINAL:
            - Ativo: ${activeSymbol}
            - Preço: ${currentPrice?.toFixed(4) || 'N/A'}
            - Modo Operacional: ${isAutoMode ? 'AUTOPILOT (Totalmente Automatizado)' : 'SENTINELA (Aguardando sua autorização)'}
            - Gestão Financeira: Stake de $${Number(stakeValue).toFixed(2)} | Alvo de Lucro: $${Number(profitTarget).toFixed(2)}
            - Performance Sessão: P&L: $${Number(sessionStats.pnl).toFixed(2)} | Win Rate: ${Number(sessionStats.winRate).toFixed(1)}%
            - Telemetria: Ciclo de análise a cada ${analysisInterval}s (Próxima decisão em ${timeToNextAnalysis}s)
            - Último Veredito: ${lastDecision ? `${lastDecision.action} (${lastDecision.confidence}%) - ${lastDecision.reasoning}` : 'Nenhum ciclo concluído'}
            - Indicadores Técnicos: RSI: ${indicators?.rsi?.toFixed(2) || 'N/A'}, ADX: ${indicators?.adx?.toFixed(1) || 'N/A'}, BBW: ${indicators?.bbw?.toFixed(3) || 'N/A'}

            Responda de forma técnica, clara e baseada em dados. Use o contexto acima para fundamentar suas respostas. Se o usuário perguntar sobre o status ou pedir uma análise, use estes números reais.`;

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
                content: `Erro ao contatar CIO: ${error.message || "Verifique se o Ollama está online."}`, 
                time: new Date().toLocaleTimeString() 
            };
            setChatMessages(prev => [...prev, errorMsg]);
            toast({ title: "Erro no Chat", description: "Não foi possível contatar o CIO local.", variant: "destructive" });
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

    // Reseta o timer quando o intervalo muda
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
        executeManualDecision: () => lastDecision && executeTradeAction('Manual', lastDecision, user)
    };
}
