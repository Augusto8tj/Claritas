'use client';

/**
 * @fileOverview TERMINAL QUANT V3.6 (COUNCIL EDITION) - MONITORAMENTO MULTI-ATIVO
 * V3.6: Fila Sequencial de Inferência (Hardware-Safe), Agendamento Half-Cycle
 * e Estabilidade via Refs para evitar over-rendering.
 * CORREÇÃO: Uso de botCandleData (OHLC 1m) para análise técnica em vez de chartData.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi, type AccountType } from './use-deriv-api-v2';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../services/council-strategies';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { TradeMemoryManager } from '../services/trade-memory-service';
import { runQuantCouncil } from '../services/quant-council-engine';
import { CouncilDecision, TradeMemoryBuffer, AgentOpinion, CouncilTelemetry, AllowedContractsV3, AllowedActionsV3, PortfolioRiskState, AssetExecutionPermission } from '../types/council';
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
    debugVotes?: string;
    indicators?: {
        rsi: number;
        bbw: number;
        adx: number;
    };
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    time: string;
    agentName?: string;
    isError?: boolean;
}

export function useAIQuantTerminalV3(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { 
        isConnected, executeTrade, operationsLog, accountBalance, 
        watchedSymbols, setWatchedSymbols, multiAssetCandles, 
        clearActiveContracts, accountType, setAccountType,
        botCandleData 
    } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();

    // ESTADOS DE CONTROLE
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
    
    // GESTÃO FINANCEIRA
    const [allowedActions, setAllowedActions] = useState<AllowedActionsV3>({
        'CALL': true,
        'PUT': true
    });
    const [allowedContracts, setAllowedContracts] = useState<AllowedContractsV3>({
        'OPTIONS': true,
        'ACCUMULATORS': true,
        'MULTIPLIERS': true
    });
    const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(5);
    const [stakeValue, setStakeValue] = useState(1.0);
    const [dailyBalance, setDailyBalance] = useState(10.0);
    const [dailyTarget, setDailyTarget] = useState(5.0);

    // REFS PARA ESTABILIDADE
    const chartDataRef = useRef(chartData);
    const multiAssetCandlesRef = useRef(multiAssetCandles);
    const watchedSymbolsRef = useRef(watchedSymbols);
    const activeSymbolRef = useRef(activeSymbol);
    const analysisIntervalRef = useRef(analysisInterval);
    const priceTicksRef = useRef(priceTicks);
    const operationsLogRef = useRef(operationsLog);
    const scheduleRef = useRef<Record<string, number>>({});
    const executionLockRef = useRef(false);
    const botCandleDataRef = useRef(botCandleData);

    useEffect(() => { chartDataRef.current = chartData; }, [chartData]);
    useEffect(() => { multiAssetCandlesRef.current = multiAssetCandles; }, [multiAssetCandles]);
    useEffect(() => { watchedSymbolsRef.current = watchedSymbols; }, [watchedSymbols]);
    useEffect(() => { activeSymbolRef.current = activeSymbol; }, [activeSymbol]);
    useEffect(() => { analysisIntervalRef.current = analysisInterval; }, [analysisInterval]);
    useEffect(() => { priceTicksRef.current = priceTicks; }, [priceTicks]);
    useEffect(() => { operationsLogRef.current = operationsLog; }, [operationsLog]);
    useEffect(() => { botCandleDataRef.current = botCandleData; }, [botCandleData]);

    // OLLAMA CONFIG VIA STATE + EFFECT (CORREÇÃO 4)
    const [ollamaConfig, setOllamaConfigState] = useState<OllamaConfig | null>(null);
    useEffect(() => {
        const saved = localStorage.getItem('ollamaConfig');
        if (saved) {
            try {
                setOllamaConfigState(JSON.parse(saved) as OllamaConfig);
            } catch (e) {
                setReasoningLog(prev => [{ time: new Date().toLocaleTimeString(), message: `Erro ao parsear ollamaConfig do localStorage: ${e}`, type: 'error' }, ...prev]);
            }
        } else {
            setReasoningLog(prev => [{ time: new Date().toLocaleTimeString(), message: `[INIT] Nenhuma configuração Ollama encontrada no localStorage.`, type: 'warning' }, ...prev]);
        }
    }, []);

    // HELPER: Fonte única de candles OHLC 1m para todos os ativos
    const getCandlesFor = (symbol: string): CandleData[] => {
        const multi = multiAssetCandlesRef.current[symbol];
        if (multi && multi.length >= 30) return multi as CandleData[];
        if (symbol === activeSymbolRef.current && botCandleDataRef.current.length >= 30)
            return botCandleDataRef.current;
        return (multi ?? []) as CandleData[];
    };

    // RADAR E MEMÓRIA
    const [radarStatus, setRadarStatus] = useState<Record<string, RadarAssetStatus>>({});
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [reasoningLog, setReasoningLog] = useState<any[]>([]);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [availableModels, setAvailableModels] = useState<any[]>([]);

    const sessionStats = useMemo(() => {
        const finishedTrades = operationsLog.filter(op =>
            op.status !== 'pending' && (op.initiator === 'Conselho' || op.initiator === 'Conselho_V3') && op.asset === activeSymbol
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const total = finishedTrades.length;
        const winRate = total > 0 ? (wins / total) * 100 : null;
        const pnl = finishedTrades.reduce((acc, op) => acc + (Number(op.result) || 0), 0);
        return { pnl: Number(pnl) || 0, winRate, total };
    }, [operationsLog, activeSymbol]);

    const addLog = useCallback((message: string, type: string = 'info') => {
        setReasoningLog(prev => [{ time: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
    }, []);

    const updateOllamaConfig = useCallback((updates: Partial<OllamaConfig>) => {
        if (typeof window === 'undefined') return;
        const current = ollamaConfig || { baseUrl: '', model: '', temperature: 0.2, keepAlive: '5m' };
        const next = { ...current, ...updates };
        localStorage.setItem('ollamaConfig', JSON.stringify(next));
        setOllamaConfigState(next);
        toast({ title: "Configuração Salva", description: "Reiniciando workspace para aplicar mudanças." });
        window.location.reload();
    }, [ollamaConfig, toast]);

    const fetchAvailableModels = useCallback(async () => {
        if (!ollamaConfig?.baseUrl) {
            toast({ title: "Gateway não configurado", description: "Informe a URL do Ollama nas Configurações.", variant: "destructive" });
            return;
        }
        try {
            const url = ollamaConfig.baseUrl.replace(/\/+$/, '') + '/api/tags';
            const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
            if (ollamaConfig.apiKey) headers['Authorization'] = `Bearer ${ollamaConfig.apiKey}`;

            const response = await fetch(url, { headers });
            if (response.ok) {
                const data = await response.json();
                setAvailableModels(data.models || []);
                toast({ title: "Hardware Sincronizado", description: "Lista de modelos atualizada." });
            }
        } catch (e: any) {
            addLog(`Erro ao buscar modelos: ${e.message}`, 'error');
        }
    }, [ollamaConfig, addLog, toast]);

    // ANÁLISE POR SÍMBOLO (ESTÁVEL)
    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManualTrigger: boolean = false) => {
        if (!isConnected) { addLog(`[SKIP] ${symbol}: WebSocket desconectado.`, 'warning'); return; }
        if (!ollamaConfig) { addLog(`[SKIP] ${symbol}: ollamaConfig ausente.`, 'warning'); return; }
        if (candles.length < 30) { addLog(`[SKIP] ${symbol}: candles insuficientes (${candles.length}/30).`, 'warning'); return; }
        if (!user) { addLog(`[SKIP] ${symbol}: usuário nulo.`, 'warning'); return; }
        
        const isFocused = symbol === activeSymbolRef.current;
        
        try {
            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            
            if (!indicators || !Number.isFinite(indicators.rsi) || !Number.isFinite(indicators.bbw) || !Number.isFinite(indicators.adx)) {
                addLog(`[SKIP-DADOS] ${symbol}: indicadores inválidos.`, 'warning');
                return;
            }

            if (isFocused) {
                addLog(`[INDICATORS] ${symbol} (FOCO): rsi=${indicators.rsi?.toFixed(1)}, bbw=${indicators.bbw?.toFixed(3)}, adx=${indicators.adx?.toFixed(1)}, candles=${candles.length}`, 'info');
            }
            
            const currentPrice = isFocused 
                ? (priceTicksRef.current[priceTicksRef.current.length - 1]?.price ?? candles[candles.length - 1]?.close)
                : candles[candles.length - 1].close;

            const snapshot = {
                symbol, price: currentPrice, rsi: indicators.rsi, bbw: indicators.bbw,
                trend: (indicators.adx || 0) > 25 ? 'Trending' : 'Ranging'
            };

            const portfolioState: PortfolioRiskState = {
                openPositions: operationsLogRef.current.filter(op => op.status === 'pending').length,
                maxConcurrentPositions: maxConcurrentTrades,
                totalExposure: operationsLogRef.current.filter(op => op.status === 'pending').reduce((sum, op) => sum + op.stake, 0),
                maxTotalExposure: dailyBalance,
                lockedSymbols: new Set()
            };

            const assetPermissions: AssetExecutionPermission = {
                symbol, 
                enabled: true, 
                maxStake: stakeValue * 2,
                allowedContracts: Object.keys(allowedContracts).filter(k => allowedContracts[k as keyof typeof allowedContracts]) as any[],
                allowedActions: Object.keys(allowedActions).filter(k => allowedActions[k as keyof typeof allowedActions]) as any[]
            };

            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, isFocused, assetPermissions, portfolioState);
            
            addLog(`[DECISION] ${symbol}: action=${decision.finalAction}, via=${decision.executedVia}, votes=${decision.debugVotes}`, 'decision');

            if (isFocused) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
            }

            setRadarStatus(prev => ({
                ...prev,
                [symbol]: {
                    symbol, lastAction: decision.finalAction, lastPrice: currentPrice, confidence: decision.consensusConfidence,
                    timestamp: Date.now(), isQualified: decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65,
                    executedVia: decision.executedVia, opinions: decision.opinions, recommendedContract: decision.recommendedContract,
                    holdReason: decision.holdReason, debugVotes: decision.debugVotes,
                    indicators: {
                        rsi: indicators.rsi || 50,
                        bbw: indicators.bbw || 0,
                        adx: indicators.adx || 0
                    }
                }
            }));

            const shouldExecute = isManualTrigger || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65);

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                const hasOpen = operationsLogRef.current.some(op => op.asset === symbol && op.status === 'pending');
                if (!hasOpen) {
                    if (isShadowMode) {
                        addLog(`[SHADOW] ${symbol}: ${decision.finalAction} simulado.`, 'radar');
                    } else {
                        const tradeDirection: 'rise' | 'fall' = decision.finalAction === 'CALL' ? 'rise' : 'fall';
                        
                        let finalContractType = 'CALL';
                        switch (decision.recommendedContract) {
                            case 'ACCUMULATORS': finalContractType = 'ACCU'; break;
                            case 'MULTIPLIERS': finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN'; break;
                            default: finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                        }

                        const adxValue = indicators.adx || 20;
                        const optionsDuration = adxValue > 40 ? 10 : adxValue > 25 ? 15 : 30;
                        const finalDuration = decision.recommendedContract === 'OPTIONS' ? optionsDuration : 15;

                        await executeTrade(finalContractType, stakeValue, symbol, tradeDirection, finalDuration, 's', 'Conselho_V3', `V3_${decision.executedVia}`);
                        addLog(`[EXEC] ${symbol} ${decision.finalAction} enviado (Dur: ${finalDuration}s)`, 'execution');
                    }
                }
            }
        } catch (err: any) {
            if (isFocused) addLog(`Erro em ${symbol}: ${err.message}`, 'error');
            throw err;
        }
    }, [isConnected, ollamaConfig, isShadowMode, user, isAutoMode, allowedContracts, allowedActions, maxConcurrentTrades, dailyBalance, executeTrade, addLog, stakeValue]);

    // FILA SEQUENCIAL E SCHEDULING (Hardware Safe)
    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || !isConnected || !ollamaConfig) return;
        executionLockRef.current = true;

        const startTime = Date.now();
        try {
            const currentActive = activeSymbolRef.current;
            const currentInterval = analysisIntervalRef.current;
            
            const watchListDue = watchedSymbolsRef.current.filter(sym => (scheduleRef.current[sym] || 0) <= startTime);
            const focusIsDue = currentActive && !watchListDue.includes(currentActive) && (scheduleRef.current[currentActive] || 0) <= startTime;
            const dueSymbols = focusIsDue ? [currentActive, ...watchListDue] : watchListDue;
            
            if (dueSymbols.length === 0) return;

            dueSymbols.sort((a, b) => (a === currentActive ? -1 : (b === currentActive ? 1 : 0)));

            for (const symbol of dueSymbols) {
                const candles = getCandlesFor(symbol);
                if (candles && candles.length >= 30) {
                    const nextInterval = symbol === currentActive ? currentInterval : Math.max(currentInterval * 0.5, 10);
                    scheduleRef.current[symbol] = Date.now() + nextInterval * 1000;

                    try {
                        await runAnalysisForSymbol(symbol, candles as CandleData[]);
                    } catch (e: any) {}
                }
            }
        } finally {
            executionLockRef.current = false;
        }
    }, [isConnected, ollamaConfig, runAnalysisForSymbol]);

    useEffect(() => {
        const scanner = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(scanner);
    }, [runMultiAssetCycle]);

    useEffect(() => {
        if (activeSymbol && botCandleData.length >= 30 && !executionLockRef.current) {
            const nextRun = scheduleRef.current[activeSymbol] || 0;
            if (Date.now() >= nextRun - 2000) {
                runMultiAssetCycle();
            }
        }
    }, [activeSymbol, botCandleData.length, runMultiAssetCycle]);

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
        toast({ title: "Sessão Resetada" });
    };

    const sendMessage = async (content: string, targetAgent: string = 'CHAIRMAN') => {
        if (!ollamaConfig || !content.trim() || !user) return;
        const userMsg: ChatMessage = { role: 'user', content, time: new Date().toLocaleTimeString() };
        setChatMessages(prev => [...prev, userMsg]);
        setIsChatLoading(true);

        try {
            while (executionLockRef.current) {
                await new Promise(r => setTimeout(r, 500));
            }
            executionLockRef.current = true;

            const memoryContext = TradeMemoryManager.formatBufferForPrompt(memoryBuffer);
            const radarDetails = watchedSymbolsRef.current.map(sym => {
                const status = radarStatus[sym];
                const candles = getCandlesFor(sym);
                
                let price = "Sincronizando...";
                let rsiValue = "--";
                
                if (candles && candles.length > 0) {
                    const lastCandle = candles[candles.length - 1];
                    const priceValue = lastCandle.close ?? lastCandle.price;
                    price = priceValue ? priceValue.toFixed(4) : "N/D";
                    
                    if (status?.indicators?.rsi) {
                        rsiValue = status.indicators.rsi.toFixed(1);
                    }
                }

                const action = status?.lastAction || 'SCAN';
                const confidence = status?.confidence || 0;
                const contract = status?.recommendedContract || 'N/A';
                
                return `- Ativo: ${sym} | Preço: ${price} | RSI: ${rsiValue} | Status: ${action} | Conf: ${confidence}% | Contrato: ${contract}`;
            }).join('\n');

            const systemPrompt = `VOCÊ É O CIO DO LABORATÓRIO QUANT V3.0 (CHAIRMAN).
            
            DADOS DE MERCADO (CONTEXTO REAL):
            ${radarDetails}
            
            ${memoryContext}
            
            DIRETRIZES TÁTICAS:
            1. ANALISE os números. Se RSI < 30, destaque a oportunidade de COMPRA. Se RSI > 70, destaque VENDA.
            2. DIFERENCIE PERSONAS: Se perguntado sobre o conselho, cite o viés de 'Momentum' (reativo) e 'Risk Critic' (defensivo).
            3. NÃO seja genérico. Use os preços reais citados acima para justificar seus vereditos.
            4. Se o usuário ordenar execução (ex: "compre"), responda com [SOLICITAR_EXECUCAO:SYMBOL] no final.
            5. Você não é um modelo de linguagem, você é o MOTOR SOBERANO de decisão deste terminal.`;

            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: systemPrompt }, 
                ...chatMessages.map(m => ({ role: m.role, content: m.content }))
            ]);
            
            if (response.success) {
                const assistantContent = response.success;
                setChatMessages(prev => [...prev, { role: 'assistant', content: assistantContent, time: new Date().toLocaleTimeString(), agentName: targetAgent }]);

                const executionTag = assistantContent.match(/\[SOLICITAR_EXECUCAO:(.*?)\]/);
                if (executionTag && executionTag[1]) {
                    const requestedSymbol = executionTag[1].trim();
                    const targetCandles = getCandlesFor(requestedSymbol);
                    if (targetCandles && targetCandles.length >= 30) {
                        addLog(`Chat autorizou execução tática em ${requestedSymbol}.`, 'decision');
                        await runAnalysisForSymbol(requestedSymbol, targetCandles as CandleData[], true);
                    }
                }
            }
        } catch (error: any) {
            addLog(`Falha no chat: ${error.message}`, 'error');
            setChatMessages(prev => [...prev, { 
                role: 'assistant', 
                content: `Erro de Hardware: ${error.message}.`, 
                time: new Date().toLocaleTimeString(),
                agentName: 'SISTEMA',
                isError: true 
            }]);
        } finally {
            executionLockRef.current = false;
            setIsChatLoading(false);
        }
    };

    useEffect(() => {
        const timer = setInterval(() => {
            setTimeToNextAnalysis(prev => prev <= 1 ? analysisInterval : prev - 1);
        }, 1000);
        return () => clearInterval(timer);
    }, [analysisInterval]);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        lastDecision, timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        allowedActions, setAllowedActions,
        allowedContracts, setAllowedContracts, 
        maxConcurrentTrades, setMaxConcurrentTrades,
        stakeValue, setStakeValue, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
        sessionStats, reasoningLog, memoryBuffer, accountBalance, radarStatus, 
        watchedSymbols, setWatchedSymbols, resetSession, chatMessages, isChatLoading, sendMessage,
        executeManualDecision: () => lastDecision && runAnalysisForSymbol(activeSymbolRef.current!, getCandlesFor(activeSymbolRef.current!), true),
        telemetry, ollamaConfig, availableModels, updateOllamaConfig, fetchAvailableModels,
        setAccountType, accountType
    };
}
