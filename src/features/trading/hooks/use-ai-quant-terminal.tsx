
'use client';

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
    const { isConnected, executeTrade, operationsLog } = useDerivApiV2();
    const { user } = useAuth();
    const { toast } = useToast();

    // ESTADOS DE CONTROLE
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [lastDecision, setLastDecision] = useState<QuantDecision | null>(null);
    const [analysisInterval, setAnalysisInterval] = useState(120); 
    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(120);
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    
    // MELHORIA 1: ESTADOS FINANCEIROS E CIRCUIT BREAKER
    const [stakeValue, setStakeValue] = useState(1.0);
    const [profitTarget, setProfitTarget] = useState(10.0);
    const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(3);
    const [maxDailyLoss, setMaxDailyLoss] = useState(-20.0);

    const [reasoningLog, setReasoningLog] = useState<ReasoningLog[]>([]);
    const [telemetry, setTelemetry] = useState({ latency: 0, tps: 0 });
    
    // CHAT E TESTE
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);

    // REFS
    const executionLockRef = useRef(false);

    // ESTATÍSTICAS DA SESSÃO (Segmentadas por Ativo)
    const sessionStats = useMemo(() => {
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && 
            op.initiator === 'Conselho' &&
            op.asset === activeSymbol
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const total = finishedTrades.length;
        
        // MELHORIA 6: Corrigir Win Rate exibindo "100%" antes de qualquer trade
        const winRate = total > 0 ? (wins / total) * 100 : null;
        
        const pnl = finishedTrades.reduce((acc, op) => {
            return acc + (Number(op.result) || 0);
        }, 0);
        
        return { 
          pnl: Number(pnl) || 0, 
          winRate: winRate, 
          total: Number(total) || 0 
        };
    }, [operationsLog, activeSymbol]);

    // MEMÓRIA: Snapshot de Performance Recente para o CIO
    const recentPerformanceSummary = useMemo(() => {
        return operationsLog
            .filter(op => op.initiator === 'Conselho' && op.asset === activeSymbol && op.status !== 'pending')
            .slice(0, 5)
            .map(op => ({
                dir: op.direction,
                res: op.status,
                pnl: op.result?.toFixed(2),
                entry: op.entryPrice?.toFixed(4),
                exit: op.exitPrice?.toFixed(4),
                reasoning: op.strategy 
            }));
    }, [operationsLog, activeSymbol]);

    // MELHORIA 5: Remover credenciais hardcoded do código-fonte
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
        const entry = {
            time: new Date().toLocaleTimeString(),
            message,
            type
        };
        setReasoningLog(prev => [entry, ...prev].slice(0, 50));
    }, []);

    const executeTradeAction = useCallback(async (decision: QuantDecision) => {
        if (!activeSymbol) return;

        let finalDuration = decision.duration;
        const finalUnit = (decision.unit || 's') as DurationUnit;

        if (finalUnit === 't') {
            finalDuration = Math.max(1, Math.min(10, decision.duration)); // Limite: 1-10 ticks
        } else if (finalUnit === 's') {
            finalDuration = Math.max(15, Math.min(300, decision.duration)); // Limite: Min 15s
        }

        addLog(`Executando Ordem ${decision.action} (${finalDuration}${finalUnit})...`, 'execution');

        const result = await executeTrade(
            decision.action === 'RISE' ? 'CALL' : 'PUT',
            Number(stakeValue), 
            activeSymbol,
            decision.action.toLowerCase() as 'rise' | 'fall',
            finalDuration,
            finalUnit,
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

        // MELHORIA 1: Circuit Breaker
        const recentResults = recentPerformanceSummary.map(t => t.res);
        const lastLosses = recentResults.slice(0, maxConsecutiveLosses);
        const hitLossStreak = lastLosses.length === maxConsecutiveLosses && 
                               lastLosses.every(r => r === 'lost');
        const hitDailyLossLimit = sessionStats.pnl <= maxDailyLoss;

        if (hitLossStreak || hitDailyLossLimit) {
            if (isAutoMode) {
                const reason = hitLossStreak 
                  ? `${maxConsecutiveLosses} perdas consecutivas detectadas` 
                  : `Perda máxima diária de $${Math.abs(maxDailyLoss)} atingida`;
                addLog(`🛑 Circuit breaker: ${reason}. Pausando Autopilot.`, 'error');
                setIsAutoMode(false);
                toast({ 
                  title: "🛑 Circuit Breaker Acionado", 
                  description: reason, 
                  variant: 'destructive' 
                });
            }
            return;
        }

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
                recent_performance: recentPerformanceSummary,
                indicators: {
                    roi: indicators?.rsi?.toFixed(2),
                    adx: indicators?.adx?.toFixed(1),
                    bbw: indicators?.bbw?.toFixed(3),
                    macd_hist: indicators?.macd?.histogram?.toFixed(4)
                }
            };

            const prompt = `VOCÊ É O CHIEF INVESTMENT OFFICER (CIO) DO TERMINAL CLARITAS.
            Perfil Estratégico Ativo: ${strategicProfile.toUpperCase()}
            
            MISSÃO: Analise o mercado e o desempenho recente.
            Se houver falhas recentes, entenda se o mercado mudou de regime.
            
            DADOS ATUAIS DO MERCADO:
            ${JSON.stringify(marketContext, null, 2)}
            
            RETORNE APENAS JSON NESTE FORMATO:
            {
              "action": "RISE" | "FALL" | "HOLD",
              "confidence": 0-100,
              "reasoning": "Breve justificativa técnica",
              "duration": número,
              "unit": "s" | "t"
            }
            
            REGRAS DE DURAÇÃO:
            - Se unit for "t" (ticks), duration DEVE ser entre 1 e 10.
            - Se unit for "s" (segundos), duration DEVE ser entre 15 e 300.`;

            const start = performance.now();
            let response;
            try {
                response = await getOllamaResponse(ollamaConfig, prompt, []);
            } catch (fetchErr: any) {
                addLog(`⚠️ Erro de rede (Failed to fetch): O CIO está temporariamente indisponível.`, 'error');
                throw new Error("Falha na comunicação com o provedor de IA local.");
            }
            const end = performance.now();

            if (response.error) throw new Error(response.error);

            // Parsing resiliente
            const rawContent = (response.success || "").replace(/```json|```/g, "").trim();
            const jsonMatch = rawContent.match(/\{.*\}/s);
            if (!jsonMatch) throw new Error("IA retornou formato inválido.");
            
            const decision: QuantDecision = JSON.parse(jsonMatch[0]);

            // MELHORIA 2: Validação estrita da resposta do LLM antes de operar
            if (!['RISE', 'FALL', 'HOLD'].includes(decision.action)) {
                throw new Error(`Ação inválida retornada pela IA: ${decision.action}`);
            }
            if (typeof decision.confidence !== 'number' || decision.confidence < 0 || decision.confidence > 100) {
                throw new Error(`Confiança fora do intervalo válido: ${decision.confidence}`);
            }
            if (decision.unit && !['t', 's', 'm'].includes(decision.unit)) {
                throw new Error(`Unidade de duração inválida: ${decision.unit}`);
            }
            if (typeof decision.duration !== 'number' || decision.duration <= 0) {
                throw new Error(`Duração inválida: ${decision.duration}`);
            }

            setLastDecision(decision);
            
            const tokens = response.metadata?.eval_count || 0;
            const latency = Math.round(end - start);
            setTelemetry({ latency, tps: Math.round(tokens / (latency / 1000)) });

            addLog(`Veredito IA: ${decision.action} (${decision.confidence}%)`, 'decision');
            addLog(`Justificativa: ${decision.reasoning}`);

            // MELHORIA 4: Persistência de decisões do Conselho
            if (user) {
              try {
                const minConfidenceForExecution = strategicProfile === 'conservative' ? 85 : strategicProfile === 'balanced' ? 65 : 55;
                saveCouncilDecisionLog(user.uid, {
                  symbol: activeSymbol,
                  action: decision.action,
                  confidence: decision.confidence,
                  reasoning: decision.reasoning,
                  regime: regime?.regime,
                  strategicProfile,
                  timestamp: new Date().toISOString(),
                  executed: isAutoMode && decision.action !== 'HOLD' && decision.confidence >= minConfidenceForExecution,
                });
              } catch (logErr) {
                console.warn("Falha ao persistir log de decisão:", logErr);
              }
            }

            const minConfidence = strategicProfile === 'conservative' ? 85 : strategicProfile === 'balanced' ? 65 : 55;

            if (isAutoMode && decision.action !== 'HOLD' && decision.confidence >= minConfidence) {
                await executeTradeAction(decision);
            }

        } catch (err: any) {
            addLog(`Erro no Ciclo: ${err.message}`, 'error');
        } finally {
            executionLockRef.current = false;
        }
    }, [activeSymbol, isConnected, chartData, priceTicks, isAutoMode, ollamaConfig, addLog, sessionStats.pnl, profitTarget, executeTradeAction, toast, strategicProfile, recentPerformanceSummary, maxConsecutiveLosses, maxDailyLoss, user]);

    const sendMessage = async (content: string) => {
        if (!ollamaConfig || !content.trim()) return;

        const userMsg: ChatMessage = { role: 'user', content, time: new Date().toLocaleTimeString() };
        setChatMessages(prev => [...prev, userMsg]);
        setIsChatLoading(true);

        try {
            const systemPrompt = `Você é o Chief Investment Officer (CIO) do Terminal Claritas. 
            CONTEXTO OPERACIONAL:
            - Ativo: ${activeSymbol}
            - Perfil: ${strategicProfile}
            - P&L Ativo: $${sessionStats.pnl.toFixed(2)}
            - Win Rate: ${sessionStats.winRate === null ? 'Sem trades' : sessionStats.winRate.toFixed(1) + '%'}
            - Memória de Trades Recentes: ${JSON.stringify(recentPerformanceSummary)}
            
            Instrução: Responda de forma técnica. Use a memória de trades para explicar por que ganhamos ou perdemos as últimas operações se questionado.`;

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
        maxConsecutiveLosses,
        setMaxConsecutiveLosses,
        maxDailyLoss,
        setMaxDailyLoss,
        chatMessages,
        isChatLoading,
        sendMessage,
        executeManualDecision: () => lastDecision && executeTradeAction(lastDecision)
    };
}
