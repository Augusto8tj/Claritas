// src/features/trading/hooks/use-ai-quant-terminal-v2.tsx
'use client';

/**
 * @fileOverview TERMINAL QUANT V2.5 - RADAR COM AUDITORIA INTEGRADA E DIÁLOGO CIO
 * Incremento: O CIO agora tem acesso total ao contexto para auditoria via Chat.
 * BLOCO 2 & 3: Agendamento Adaptativo e Suporte a Contratos de Dígitos.
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
import { saveCouncilDecisionLog, getTransactions, getCouncilDecisionLogs } from '@/services/financial-data-service';

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
    digitPrediction?: number; // 0-9, obrigatório para contratos de Dígitos
    zenThought?: string;
    _detectedRegime?: string;
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

// BLOCO 2 - Agendamento Adaptativo
interface SymbolSchedule {
    nextRunAt: number;
    intervalSec: number;
    lastRegime?: string;
}

function computeAdaptiveInterval(regime: string | undefined, baseIntervalSec: number): number {
    switch (regime) {
        case 'breakout':
        case 'trending':
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
    const { isConnected, executeTrade, operationsLog, getHistoricalData, accountBalance, multiAssetCandles, watchedSymbols } = useDerivApiV2();
    const { user } = useAuth();
    const { toast } = useToast();

    const [isAutoMode, setIsAutoMode] = useState(false);
    const [lastDecision, setLastDecision] = useState<QuantDecision | null>(null);
    const [analysisInterval, setAnalysisInterval] = useState(120); 
    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(120);
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    const [confidenceThreshold, setConfidenceThreshold] = useState(65);
    
    const [radarStatus, setRadarStatus] = useState<Record<string, RadarAssetStatus>>({});
    
    // BLOCO 2
    const scheduleRef = useRef<Record<string, SymbolSchedule>>({});
    const executionLockRef = useRef(false);

    const [stakeValue, setStakeValue] = useState(1.0);
    const [profitTarget, setProfitTarget] = useState(10.0);
    const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(3);
    const [maxDailyLoss, setMaxDailyLoss] = useState(-20.0);

    const [reasoningLog, setReasoningLog] = useState<ReasoningLog[]>([]);
    const [telemetry, setTelemetry] = useState({ latency: 0, tps: 0 });
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);

    // Contexto de Mercado Memoizado para o CIO
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

    const handleSetStrategicProfile = useCallback((profile: StrategicProfile) => {
        setStrategicProfile(profile);
        const newThreshold = profile === 'conservative' ? 85 : profile === 'balanced' ? 65 : 55;
        setConfidenceThreshold(newThreshold);
        addLog(`Perfil estratégico alterado para ${profile.toUpperCase()}. Limiar ajustado para ${newThreshold}%.`, 'info');
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

            // BLOCO 3 - Prompt com Dígitos
            const prompt = `VOCÊ É O ARQUITETO DE RISCO E CIO DO TERMINAL CLARITAS.
            Sua missão é selecionar o melhor TIPO DE CONTRATO para o lucro consistente.
            
            ATIVO: ${symbol} | PERFIL: ${strategicProfile.toUpperCase()}
            REGIME: ${regime?.regime}
            DADOS: RSI=${indicators?.rsi?.toFixed(1)} | ADX=${indicators?.adx?.toFixed(1)} | BBW=${indicators?.bbw?.toFixed(3)}
            
            DIRETRIZES DE INSTRUMENTO:
            1. Se Regime for 'ranging' e BBW < 0.8: Sugira 'ACCUMULATOR' (estabilidade).
            2. Se ADX > 30 e RSI em tendência: Sugira 'MULTIPLIER' (tendência explosiva).
            3. Se Regime for 'breakout': Sugira 'DIGIT_OVER_UNDER', prevendo se o próximo dígito ficará acima (7,8,9) ou abaixo (0,1,2) de 5, com base na volatilidade recente.
            4. Se os últimos dígitos mostrarem repetição incomum: Sugira 'DIGIT_DIFFER', prevendo um dígito improvável de repetir.
            5. Padrão: Sugira 'CALL/PUT'.

            RETORNE APENAS JSON:
            {
              "action": "RISE" | "FALL" | "HOLD",
              "recommendedContract": "CALL/PUT" | "ACCUMULATOR" | "MULTIPLIER" | "DIGIT_OVER_UNDER" | "DIGIT_DIFFER",
              "digitPrediction": número de 0 a 9 (OBRIGATÓRIO se recommendedContract for DIGIT_OVER_UNDER ou DIGIT_DIFFER, omitir caso contrário),
              "confidence": 0-100,
              "reasoning": "Justificativa técnica e escolha do contrato",
              "duration": número,
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
            
            // Sanitização
            decision.confidence = (decision.confidence === null || decision.confidence === undefined || isNaN(Number(decision.confidence))) 
                ? 0 
                : Number(decision.confidence);

            // Validação Bloco 3
            if (['DIGIT_OVER_UNDER', 'DIGIT_DIFFER'].includes(decision.recommendedContract)) {
                if (typeof decision.digitPrediction !== 'number' || decision.digitPrediction < 0 || decision.digitPrediction > 9) {
                    throw new Error(`digitPrediction inválido para contrato de dígitos: ${decision.digitPrediction}`);
                }
            }

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

            // Retorno BLOCO 2
            return { ...decision, _detectedRegime: regime?.regime };

        } catch (err: any) {
            addLog(`Erro na inferência (${symbol}): ${err.message}`, 'error');
            return null;
        } finally {
            executionLockRef.current = false;
        }
    }, [ollamaConfig, strategicProfile, user, isAutoMode, confidenceThreshold, addLog]);

    // BLOCO 2 - Ciclo Multi-Ativo Adaptativo
    const runWatchedSymbolsCycle = useCallback(async () => {
        if (!isConnected || executionLockRef.current) return;

        const now = Date.now();
        const dueSymbol = watchedSymbols.find(sym => {
            const sched = scheduleRef.current[sym];
            return !sched || now >= sched.nextRunAt;
        });

        if (!dueSymbol) return;

        const candles = multiAssetCandles[dueSymbol];
        if (!candles || candles.length < 30) return;

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
                    recommendedContract: decision.recommendedContract
                }
            }));

            if (isFocused) {
                setLastDecision(decision);
                // BLOCO 3 - Execução Automática Multi-Contrato
                if (isAutoMode && decision.action !== 'HOLD' && decision.confidence >= confidenceThreshold) {
                    const hasOpenTrade = operationsLog.some(op => op.asset === dueSymbol && op.status === 'pending');
                    if (!hasOpenTrade) {
                        let finalContractType = 'CALL';
                        let extraProposalParams: Record<string, any> = {};

                        switch (decision.recommendedContract) {
                            case 'ACCUMULATOR':
                                finalContractType = 'ACCU';
                                break;
                            case 'MULTIPLIER':
                                finalContractType = decision.action === 'RISE' ? 'MULTUP' : 'MULTDOWN';
                                break;
                            case 'TOUCH/NOTOUCH':
                                finalContractType = decision.action === 'RISE' ? 'ONETOUCH' : 'NOTOUCH';
                                addLog(`⚠️ Contrato TOUCH/NOTOUCH ainda requer cálculo de barreira. Pulando execução.`, 'error');
                                return;
                            case 'DIGIT_OVER_UNDER':
                                finalContractType = decision.action === 'RISE' ? 'DIGITOVER' : 'DIGITUNDER';
                                extraProposalParams = { barrier: String(decision.digitPrediction) };
                                break;
                            case 'DIGIT_DIFFER':
                                finalContractType = 'DIGITDIFF';
                                extraProposalParams = { barrier: String(decision.digitPrediction) };
                                break;
                            default:
                                finalContractType = decision.action === 'RISE' ? 'CALL' : 'PUT';
                        }

                        addLog(`Executando ${decision.recommendedContract} em ${dueSymbol}...`, 'execution');
                        await executeTrade(
                            finalContractType,
                            stakeValue, dueSymbol, decision.action.toLowerCase() as 'rise' | 'fall',
                            decision.duration, decision.unit as DurationUnit, 'Conselho',
                            undefined,
                            extraProposalParams
                        );
                    }
                }
            }
        }
    }, [isConnected, watchedSymbols, multiAssetCandles, activeSymbol, chartData, runInference, confidenceThreshold, analysisInterval, isAutoMode, operationsLog, stakeValue, executeTrade, addLog]);

    const sendMessage = async (content: string) => {
        if (!ollamaConfig || !content.trim()) return;

        const userMsg: ChatMessage = { role: 'user', content, time: new Date().toLocaleTimeString() };
        setChatMessages(prev => [...prev, userMsg]);
        setIsChatLoading(true);

        const contextInfo = {
            activeAsset: activeSymbol,
            balance: accountBalance.balance,
            pnl: sessionStats.pnl,
            winRate: sessionStats.winRate,
            regime: lastDecision?.recommendedContract,
            indicators: {
                rsi: currentIndicators?.rsi,
                adx: currentIndicators?.adx,
                bbw: currentIndicators?.bbw
            },
            profile: strategicProfile
        };

        const systemPrompt = `Você é o Chief Investment Officer (CIO) do Terminal Claritas V2.
        CONTEXTO ATUAL DO TERMINAL: ${JSON.stringify(contextInfo)}
        
        INSTRUÇÕES:
        1. Responda de forma analítica, técnica e direta.
        2. Se o usuário perguntar o status, analise os indicadores e o saldo.
        3. Você NÃO tem capacidade de executar ordens através deste chat. Se o usuário pedir para executar uma ordem, explique que a execução deve ser feita pelo botão "Ativar Automação" ou "Autorizar Investimento" no painel, e NUNCA diga que uma ordem está "sendo preparada" ou "sendo executada" a partir desta conversa.
        4. Use português do Brasil.`;

        try {
            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: systemPrompt },
                ...chatMessages.map(m => ({ role: m.role, content: m.content }))
            ]);
            
            if (response.success) {
                setChatMessages(prev => [...prev, { role: 'assistant', content: response.success!, time: new Date().toLocaleTimeString() }]);
                addLog(`Interação com Operador: ${content.substring(0, 30)}...`, 'info');
            }
        } catch (e: any) {
            addLog(`Falha na resposta do CIO: ${e.message}`, 'error');
        } finally {
            setIsChatLoading(false);
        }
    };

    const radarScanRef = useRef(runWatchedSymbolsCycle);
    const analysisIntervalRef = useRef(analysisInterval);

    useEffect(() => {
        radarScanRef.current = runWatchedSymbolsCycle;
        analysisIntervalRef.current = analysisInterval;
    }, [runWatchedSymbolsCycle, analysisInterval]);

    useEffect(() => {
        const interval = setInterval(() => {
            setTimeToNextAnalysis(prev => {
                if (prev <= 1) {
                    // O ciclo agora é gerenciado pelo radar adaptativo
                    return analysisIntervalRef.current;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Timer de Scan (5s para reduzir overhead)
    useEffect(() => {
        const scanInterval = setInterval(() => {
            radarScanRef.current();
        }, 5000);
        return () => clearInterval(scanInterval);
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
        chatMessages, isChatLoading, sendMessage,
        executeManualDecision: () => lastDecision && runWatchedSymbolsCycle()
    };
}
