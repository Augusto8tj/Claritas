// src/features/trading/hooks/use-ai-quant-terminal-v3.tsx
'use client';

/**
 * @fileOverview TERMINAL QUANT V3.7 (COUNCIL EDITION)
 * V3.7: Chat Determinístico, Personas de Agentes e RAG de Contexto Técnico.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi, type AccountType } from './use-deriv-api-v2';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../services/council-strategies';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { TradeMemoryManager } from '../services/trade-memory-service';
import { runQuantCouncil, MIN_EXEC_CONFIDENCE } from '../services/quant-council-engine';
import { CouncilDecision, TradeMemoryBuffer, AgentOpinion, CouncilTelemetry, AllowedContractsV3, AllowedActionsV3, PortfolioRiskState, AssetExecutionPermission } from '../types/council';
import { getOllamaResponse } from '@/app/actions';
import { computeSignalFeatures, evaluateSignals, SIGNAL_TRIGGER_SCORE, type SignalCandidate, type SignalFeatures } from '../services/signal-engine';

const SETTINGS_KEY = 'quantV3Settings';

const AGENT_PERSONAS = {
  CHAIRMAN: "o CHAIRMAN do conselho: sintetiza a visão técnica de forma executiva",
  MOMENTUM: "o analista QUANT MOMENTUM: força do preço, momentum e velocidade",
  RISK_CRITIC: "o RISK CRITIC: cético, aponta riscos e razões para NÃO operar",
  ARCHIVIST: "o PATTERN ARCHIVIST: memória de trades e padrões passados"
};

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

export interface LogEntry {
    ts: string; 
    time: string;
    message: string;
    type: 'info' | 'decision' | 'execution' | 'error' | 'warning' | 'radar' | 'sentinel';
    details?: string[];
    symbol?: string;
}

export interface CouncilStats {
    total: number;
    call: number;
    put: number;
    hold: number;
    vetoes: number;
    fallbacks: number;
    avgLatencyMs: number;
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
        botCandleData, durationLimits 
    } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();

    // ESTADOS DE CONTROLE
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);

    // CONFIGURAÇÕES (PERSISTENTES)
    const [analysisInterval, setAnalysisInterval] = useState(120); 
    const [backgroundIntervalSec, setBackgroundIntervalSec] = useState(60);
    const [sentinelIntervalSec, setSentinelIntervalSec] = useState(1);
    const [stakeValue, setStakeValue] = useState(1.0);
    const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(5);
    const [dailyBalance, setDailyBalance] = useState(10.0);
    const [dailyTarget, setDailyTarget] = useState(5.0);
    const [allowedActions, setAllowedActions] = useState<AllowedActionsV3>({ 'CALL': true, 'PUT': true });
    const [allowedContracts, setAllowedContracts] = useState<AllowedContractsV3>({ 'OPTIONS': true, 'ACCUMULATORS': true, 'MULTIPLIERS': true });

    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(0);
    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [councilStats, setCouncilStats] = useState<CouncilStats>({ total: 0, call: 0, put: 0, hold: 0, vetoes: 0, fallbacks: 0, avgLatencyMs: 0 });
    
    // SENTINEL MONITOR STATE
    const [sentinel, setSentinel] = useState<Record<string, { features: SignalFeatures | null, candidates: SignalCandidate[], ts: number }>>({});
    const lastTriggerLogRef = useRef<Record<string, number>>({});
    const sentinelAboveRef = useRef<Record<string, number>>({});

    const [telemetry, setTelemetry] = useState<CouncilTelemetry>({
        avgTokensPerSec: 0,
        totalTokens: 0,
        consensusEntropy: 0,
        jitterMs: 0,
        inferenceHealth: 100
    });
    
    // REFS PARA ESTABILIDADE
    const chartDataRef = useRef(chartData);
    const multiAssetCandlesRef = useRef(multiAssetCandles);
    const watchedSymbolsRef = useRef(watchedSymbols);
    const activeSymbolRef = useRef(activeSymbol);
    const analysisIntervalRef = useRef(analysisInterval);
    const backgroundIntervalRef = useRef(backgroundIntervalSec);
    const priceTicksRef = useRef(priceTicks);
    const operationsLogRef = useRef(operationsLog);
    const scheduleRef = useRef<Record<string, number>>({});
    const executionLockRef = useRef(false);
    const botCandleDataRef = useRef(botCandleData);
    const durationLimitsRef = useRef(durationLimits);
    const decisionHistoryRef = useRef<Record<string, Array<{ts: number, action: string, conf: number, contract: string, votes: string, via: string, hold: string}>>>({});
    const chatBusyRef = useRef(false);
    const pendingChatOrderRef = useRef<{ symbol: string, ts: number } | null>(null);
    const lastSkipLogRef = useRef<Record<string, number>>({});

    const executeTradeRef = useRef(executeTrade);
    useEffect(() => { executeTradeRef.current = executeTrade; }, [executeTrade]);

    useEffect(() => { chartDataRef.current = chartData; }, [chartData]);
    useEffect(() => { multiAssetCandlesRef.current = multiAssetCandles; }, [multiAssetCandles]);
    useEffect(() => { watchedSymbolsRef.current = watchedSymbols; }, [watchedSymbols]);
    useEffect(() => { activeSymbolRef.current = activeSymbol; }, [activeSymbol]);
    useEffect(() => { analysisIntervalRef.current = analysisInterval; }, [analysisInterval]);
    useEffect(() => { backgroundIntervalRef.current = backgroundIntervalSec; }, [backgroundIntervalSec]);
    useEffect(() => { priceTicksRef.current = priceTicks; }, [priceTicks]);
    useEffect(() => { operationsLogRef.current = operationsLog; }, [operationsLog]);
    useEffect(() => { botCandleDataRef.current = botCandleData; }, [botCandleData]);
    useEffect(() => { durationLimitsRef.current = durationLimits; }, [durationLimits]);

    const [ollamaConfig, setOllamaConfigState] = useState<OllamaConfig | null>(null);
    
    useEffect(() => {
        const savedOllama = localStorage.getItem('ollamaConfig');
        if (savedOllama) {
            try { setOllamaConfigState(JSON.parse(savedOllama) as OllamaConfig); } catch (e) { console.error(e); }
        }

        const savedSettings = localStorage.getItem(SETTINGS_KEY);
        if (savedSettings) {
            try {
                const s = JSON.parse(savedSettings);
                if (s.analysisInterval) setAnalysisInterval(s.analysisInterval);
                if (s.backgroundIntervalSec) setBackgroundIntervalSec(s.backgroundIntervalSec);
                if (s.sentinelIntervalSec) setSentinelIntervalSec(s.sentinelIntervalSec);
                if (s.stakeValue) setStakeValue(s.stakeValue);
                if (s.maxConcurrentTrades) setMaxConcurrentTrades(s.maxConcurrentTrades);
                if (s.dailyBalance) setDailyBalance(s.dailyBalance);
                if (s.dailyTarget) setDailyTarget(s.dailyTarget);
                if (s.allowedActions) setAllowedActions(s.allowedActions);
                if (s.allowedContracts) setAllowedContracts(s.allowedContracts);
            } catch (e) { console.error("Falha ao carregar settings", e); }
        }
    }, []);

    const sessionStats = useMemo(() => {
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && op.initiator === 'Conselho_V3'
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const total = finishedTrades.length;
        const winRate = total > 0 ? (wins / total) * 100 : null;
        const pnl = finishedTrades.reduce((acc, op) => acc + (Number(op.result) || 0), 0);
        return { pnl: Number(pnl) || 0, winRate, total };
    }, [operationsLog]);

    useEffect(() => {
        const settings = {
            analysisInterval, backgroundIntervalSec, sentinelIntervalSec,
            stakeValue, maxConcurrentTrades, dailyBalance, dailyTarget,
            allowedActions, allowedContracts
        };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }, [analysisInterval, backgroundIntervalSec, sentinelIntervalSec, stakeValue, maxConcurrentTrades, dailyBalance, dailyTarget, allowedActions, allowedContracts]);

    const getCandlesFor = useCallback((symbol: string): CandleData[] => {
        const multi = multiAssetCandlesRef.current[symbol];
        if (multi && multi.length >= 30) return multi as CandleData[];
        if (symbol === activeSymbolRef.current && botCandleDataRef.current.length >= 30)
            return botCandleDataRef.current;
        return (multi ?? []) as CandleData[];
    }, []);

    const [radarStatus, setRadarStatus] = useState<Record<string, RadarAssetStatus>>({});
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [reasoningLog, setReasoningLog] = useState<LogEntry[]>([]);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [availableModels, setAvailableModels] = useState<any[]>([]);

    const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', details?: string[], symbol?: string) => {
        setReasoningLog(prev => [{
            ts: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
            time: new Date().toLocaleTimeString(),
            message,
            type,
            details,
            symbol
        }, ...prev].slice(0, 300));
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            const symbols = Array.from(new Set([...watchedSymbolsRef.current, activeSymbolRef.current].filter(Boolean)));
            const newSentinel: Record<string, any> = {};
            const now = Date.now();

            symbols.forEach(sym => {
                if (!sym) return;
                const candles = getCandlesFor(sym);
                const features = computeSignalFeatures(candles as any);
                const candidates = features ? evaluateSignals(sym, features) : [];
                
                newSentinel[sym] = { features, candidates, ts: now };

                candidates.forEach(c => {
                    const logKey = `${sym}-${c.contract}`;
                    if (c.score >= SIGNAL_TRIGGER_SCORE) {
                        const lastLog = sentinelAboveRef.current[logKey] || 0;
                        // Logar se for primeira vez ou a cada 5 min (300000ms)
                        if (lastLog === 0 || now - lastLog > 300000) {
                            addLog(`[SENTINEL] ${sym} ${c.contract} ${c.direction} score=${c.score} rule=${c.rule} (${c.reasons.join(', ')})`, 'sentinel', undefined, sym);
                            sentinelAboveRef.current[logKey] = now;
                        }
                    } else {
                        delete sentinelAboveRef.current[logKey];
                    }
                });
            });

            setSentinel(newSentinel);
        }, sentinelIntervalSec * 1000);

        return () => clearInterval(interval);
    }, [getCandlesFor, addLog, sentinelIntervalSec]);

    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManualTrigger: boolean = false): Promise<CouncilDecision | undefined> => {
        if (!isConnected) { addLog(`[SKIP] ${symbol}: WebSocket desconectado.`, 'warning', undefined, symbol); return undefined; }
        if (!ollamaConfig) { addLog(`[SKIP] ${symbol}: ollamaConfig ausente.`, 'warning', undefined, symbol); return undefined; }
        if (candles.length < 30) { addLog(`[SKIP] ${symbol}: candles insuficientes (${candles.length}/30).`, 'warning', undefined, symbol); return undefined; }
        if (!user) { addLog(`[SKIP] ${symbol}: usuário nulo.`, 'warning', undefined, symbol); return undefined; }
        
        const isFocused = symbol === activeSymbolRef.current;
        
        try {
            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            
            if (!indicators || !Number.isFinite(indicators.rsi) || !Number.isFinite(indicators.bbw) || !Number.isFinite(indicators.adx)) {
                addLog(`[SKIP-DADOS] ${symbol}: indicadores inválidos. n=${candles.length}`, 'warning', undefined, symbol);
                return undefined;
            }

            const feats = computeSignalFeatures(candles as any);
            const trend = (indicators.adx || 0) > 25 ? 'Trending' : 'Ranging';
            const currentPrice = isFocused 
                ? (priceTicksRef.current[priceTicksRef.current.length - 1]?.price ?? candles[candles.length - 1]?.close)
                : candles[candles.length - 1].close;

            const snapshot = {
                symbol, price: currentPrice, rsi: feats?.rsi ?? indicators.rsi, bbw: indicators.bbw, adx: indicators.adx, trend,
                ...(feats ? { bbPos: feats.bbPos, bwPct: feats.bwPct, atrRatio: feats.atrRatio, er: feats.er, mom5: feats.mom5, mom15: feats.mom15, streak: feats.streak } : {})
            };

            const portfolioState: PortfolioRiskState = {
                openPositions: operationsLogRef.current.filter(op => op.status === 'pending').length,
                maxConcurrentPositions: maxConcurrentTrades,
                totalExposure: operationsLogRef.current.filter(op => op.status === 'pending').reduce((sum, op) => sum + op.stake, 0),
                maxTotalExposure: dailyBalance,
                lockedSymbols: new Set(),
                plannedStake: stakeValue
            };

            const assetPermissions: AssetExecutionPermission = {
                symbol, 
                enabled: true, 
                maxStake: stakeValue * 2,
                allowedContracts: Object.keys(allowedContracts).filter(k => allowedContracts[k as keyof typeof allowedContracts]) as any[],
                allowedActions: Object.keys(allowedActions).filter(k => allowedActions[k as keyof typeof allowedActions]) as any[]
            };

            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, isFocused, assetPermissions, portfolioState);
            
            const { finalAction: action, consensusConfidence: conf, executedVia: via, recommendedContract: contract, debugVotes: votes, t2tLatencyMs: lat } = decision;

            addLog(`[CONSELHO] ${symbol}: ${action} ${conf}% | ${contract} | via=${via} | votos[${votes}] | ${lat}ms`, 'decision', 
                [`ENTRADA: ${JSON.stringify(snapshot)}`, ...(decision.trace ?? []), decision.holdReason ? `MOTIVO HOLD: ${decision.holdReason}` : ''].filter(Boolean), symbol);

            if (!decisionHistoryRef.current[symbol]) decisionHistoryRef.current[symbol] = [];
            decisionHistoryRef.current[symbol] = [{ ts: Date.now(), action, conf, contract, votes, via, hold: decision.holdReason || '' }, ...decisionHistoryRef.current[symbol]].slice(0, 10);

            if (isFocused) {
                if (decision.finalAction === 'HOLD' && decision.holdReason) {
                    addLog(`[REJECTED] ${symbol}: ${decision.holdReason}`, 'warning', undefined, symbol);
                }
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
            }

            setRadarStatus(prev => ({
                ...prev,
                [symbol]: {
                    symbol, lastAction: decision.finalAction, lastPrice: currentPrice, confidence: decision.consensusConfidence,
                    timestamp: Date.now(), isQualified: decision.finalAction !== 'HOLD' && decision.consensusConfidence >= MIN_EXEC_CONFIDENCE,
                    executedVia: decision.executedVia, opinions: decision.opinions, recommendedContract: decision.recommendedContract,
                    holdReason: decision.holdReason, debugVotes: decision.debugVotes,
                    indicators: {
                        rsi: snapshot.rsi || 50,
                        bbw: indicators.bbw || 0,
                        adx: indicators.adx || 0
                    }
                }
            }));

            setCouncilStats(prev => ({
                total: prev.total + 1,
                call: prev.call + (action === 'CALL' ? 1 : 0),
                put: prev.put + (action === 'PUT' ? 1 : 0),
                hold: prev.hold + (action === 'HOLD' ? 1 : 0),
                vetoes: prev.vetoes + (via === 'COUNCIL_VETO' ? 1 : 0),
                fallbacks: prev.fallbacks + (via === 'MATH_FALLBACK' ? 1 : 0),
                avgLatencyMs: prev.total === 0 ? lat : (prev.avgLatencyMs * 0.8) + (lat * 0.2)
            }));

            const shouldExecute = isManualTrigger || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= MIN_EXEC_CONFIDENCE);

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                let finalContractType = 'CALL';
                switch (decision.recommendedContract) {
                    case 'ACCUMULATORS': finalContractType = 'ACCU'; break;
                    case 'MULTIPLIERS': finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN'; break;
                    default: finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                }

                const hasOpen = operationsLogRef.current.some(op => op.asset === symbol && op.status === 'pending' && op.contractType === finalContractType);
                
                if (!hasOpen) {
                    const stake = Math.max(0.35, Number((stakeValue * (decision.stakeRatio || 1)).toFixed(2)));
                    addLog(`[STAKE] ${symbol}: base=${stakeValue} ratio=${decision.stakeRatio?.toFixed(2)} final=${stake}`, 'info', undefined, symbol);

                    if (isShadowMode) {
                        addLog(`[SHADOW] ${symbol}: ${decision.finalAction} simulado em modo sombra.`, 'radar', undefined, symbol);
                    } else {
                        const tradeDirection: 'rise' | 'fall' = decision.finalAction === 'CALL' ? 'rise' : 'fall';
                        const adxValue = indicators.adx || 20;
                        const optionsDuration = adxValue > 40 ? 10 : adxValue > 25 ? 15 : 30;
                        const minS = durationLimitsRef.current?.s?.min ?? 15;
                        const finalDuration = decision.recommendedContract === 'OPTIONS' ? Math.max(minS, optionsDuration) : 15;

                        const res = await executeTradeRef.current(finalContractType, stake, symbol, tradeDirection, finalDuration, 's', 'Conselho_V3', `V3_${decision.executedVia}`);
                        
                        if (res.success) {
                            addLog(`[EXEC] ${symbol} ${decision.finalAction} enviado contractId=${res.contractId}`, 'execution', undefined, symbol);
                        } else {
                            addLog(`[EXEC-FALHA] ${symbol} ${finalContractType}: ${res.message}`, 'error', undefined, symbol);
                        }
                    }
                }
            }
            return decision;
        } catch (error: any) {
            if (isFocused) addLog(`Erro em ${symbol}: ${error.message}`, 'error', undefined, symbol);
            throw error;
        }
    }, [isConnected, ollamaConfig, isShadowMode, user, isAutoMode, allowedContracts, allowedActions, maxConcurrentTrades, dailyBalance, addLog, stakeValue]);

    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || chatBusyRef.current || !isConnected || !ollamaConfig) {
            const now = Date.now();
            const reason = chatBusyRef.current ? 'chat em andamento' : !isConnected ? 'WebSocket desconectado' : !ollamaConfig ? 'ollamaConfig ausente' : null;
            if (reason) {
                if (now - (lastSkipLogRef.current[reason] || 0) > 30000) {
                    addLog(`[CICLO-PULADO] ${reason}`, 'warning');
                    lastSkipLogRef.current[reason] = now;
                }
            }
            return;
        }
        executionLockRef.current = true;

        const startTime = Date.now();
        try {
            const currentActive = activeSymbolRef.current;
            const currentInterval = analysisIntervalRef.current;
            const watchListDue = watchedSymbolsRef.current.filter(sym => (scheduleRef.current[sym] || 0) <= startTime);
            const focusIsDue = currentActive && !watchListDue.includes(currentActive) && (scheduleRef.current[currentActive] || 0) <= startTime;
            const dueSymbols = focusIsDue ? [currentActive, ...watchListDue] : watchListDue;
            
            if (dueSymbols.length === 0) {
                executionLockRef.current = false;
                return;
            }

            addLog(`[CICLO] due=[${dueSymbols.join(', ')}]`, 'info');
            dueSymbols.sort((a, b) => (a === currentActive ? -1 : (b === currentActive ? 1 : 0)));

            for (const symbol of dueSymbols) {
                const candles = getCandlesFor(symbol);
                if (candles && candles.length >= 30) {
                    const isFoco = symbol === currentActive;
                    const nextInt = Math.max(10, isFoco ? currentInterval : backgroundIntervalRef.current);
                    scheduleRef.current[symbol] = Date.now() + nextInt * 1000;
                    try { await runAnalysisForSymbol(symbol, candles as CandleData[]); } catch (e: any) {}
                }
            }
        } finally {
            executionLockRef.current = false;
        }
    }, [isConnected, ollamaConfig, runAnalysisForSymbol, getCandlesFor, addLog]);

    const runMultiAssetCycleRef = useRef(runMultiAssetCycle);
    useEffect(() => { runMultiAssetCycleRef.current = runMultiAssetCycle; }, [runMultiAssetCycle]);

    useEffect(() => {
        const first = setTimeout(() => { runMultiAssetCycleRef.current(); }, 1500);
        const id = setInterval(() => { runMultiAssetCycleRef.current(); }, 5000);
        return () => { clearTimeout(first); clearInterval(id); };
    }, []);

    const resetSession = useCallback(() => {
        setIsAutoMode(false);
        setIsShadowMode(true);
        clearActiveContracts();
        setRadarStatus({});
        setReasoningLog([]);
        setChatMessages([]);
        setCouncilStats({ total: 0, call: 0, put: 0, hold: 0, vetoes: 0, fallbacks: 0, avgLatencyMs: 0 });
        scheduleRef.current = {};
        setLastDecision(null);
        setMemoryBuffer({ wins: [], losses: [] });
        toast({ title: "Sessão Reiniciada", description: "Todos os dados voláteis foram limpos." });
    }, [clearActiveContracts, toast]);

    const sendMessage = async (content: string, targetAgent: string = 'CHAIRMAN') => {
        if (!ollamaConfig || !content.trim() || !user) return;
        
        const time = new Date().toLocaleTimeString();
        const userMsg: ChatMessage = { role: 'user', content, time };
        setChatMessages(prev => [...prev, userMsg]);

        // COMANDOS DETERMINÍSTICOS
        const cmdMatch = content.match(/^\s*(por favor[, ]*)?(compre|comprar|venda|vender|execute|executar|opere|operar|abra|abrir|entre|entrar)\b\s*(.*)/i);
        if (cmdMatch) {
            const rest = cmdMatch[3].toUpperCase();
            const symbol = Array.from(new Set([...watchedSymbolsRef.current, activeSymbolRef.current].filter(Boolean))).find(s => s && rest.includes(s));
            
            if (symbol) {
                if (isShadowMode) {
                    const decision = await runAnalysisForSymbol(symbol, getCandlesFor(symbol), true);
                    setChatMessages(prev => [...prev, { 
                        role: 'assistant', 
                        agentName: 'SISTEMA', 
                        time: new Date().toLocaleTimeString(),
                        content: `[SHADOW] Auditoria para ${symbol}: ${decision?.finalAction} ${decision?.consensusConfidence}% (${decision?.recommendedContract}) votos:[${decision?.debugVotes}] ${decision?.holdReason ? 'hold='+decision.holdReason : ''}`
                    }]);
                    return;
                } else {
                    if (content.match(/\bconfirmo\b/i) && pendingChatOrderRef.current?.symbol === symbol && (Date.now() - pendingChatOrderRef.current.ts) < 60000) {
                        const decision = await runAnalysisForSymbol(symbol, getCandlesFor(symbol), true);
                        setChatMessages(prev => [...prev, { 
                            role: 'assistant', 
                            agentName: 'SISTEMA', 
                            time: new Date().toLocaleTimeString(),
                            content: `[REAL] Execução para ${symbol} solicitada via chat: ${decision?.finalAction} ${decision?.consensusConfidence}% via=${decision?.executedVia}.`
                        }]);
                        pendingChatOrderRef.current = null;
                        return;
                    } else {
                        pendingChatOrderRef.current = { symbol, ts: Date.now() };
                        setChatMessages(prev => [...prev, { 
                            role: 'assistant', 
                            agentName: 'SISTEMA', 
                            time: new Date().toLocaleTimeString(),
                            content: `⚠️ Ordem REAL para ${symbol} detectada. Digite "CONFIRMO" em até 60s para autorizar a execução. O Conselho decidirá a direção final.`
                        }]);
                        return;
                    }
                }
            }
        }

        // DIÁLOGO LLM
        setIsChatLoading(true);
        chatBusyRef.current = true;
        try {
            const context = buildChatContext();
            const systemPrompt = `Você é ${(AGENT_PERSONAS as any)[targetAgent] || AGENT_PERSONAS.CHAIRMAN}. Responda em português do Brasil, em primeira pessoa.
            ${context}
            REGRAS: use SOMENTE os dados acima; se faltar dado, diga que não tem. Ao explicar uma decisão, cite os votos, os números e o motivo do HOLD. Não preveja preços: descreva cenários condicionais (se X, então Y) marcados como hipótese. Os ativos são índices sintéticos de natureza aleatória: nunca afirme certeza de lucro; sinais são hipóteses a validar no Shadow. Até 150 palavras, salvo pedido de relatório.`;

            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: systemPrompt }, 
                ...chatMessages.slice(-8).map(m => ({ role: m.role, content: m.content }))
            ]);
            
            if (response.success) {
                setChatMessages(prev => [...prev, { role: 'assistant', content: response.success!, time: new Date().toLocaleTimeString(), agentName: targetAgent }]);
            }
        } catch (error: any) {
            setChatMessages(prev => [...prev, { role: 'assistant', content: `Erro: ${error.message}.`, time: new Date().toLocaleTimeString(), agentName: 'SISTEMA', isError: true }]);
        } finally {
            chatBusyRef.current = false;
            setIsChatLoading(false);
        }
    };

    const buildChatContext = useCallback(() => {
        const stats = councilStats;
        const session = `[SESSÃO] Modo: ${isShadowMode ? 'SHADOW' : 'REAL'} | Piloto: ${isAutoMode ? 'ON' : 'OFF'} | Conta: ${accountType} | Saldo: $${accountBalance.balance} | P&L: $${sessionStats.pnl.toFixed(2)} | WR: ${sessionStats.winRate?.toFixed(1) || '--'}% | Pos: ${operationsLogRef.current.filter(o => o.status === 'pending').length}/${maxConcurrentTrades} | Stake: $${stakeValue} | Ações: ${JSON.stringify(allowedActions)} | Contratos: ${JSON.stringify(allowedContracts)} | Intervals: ${analysisInterval}s/${backgroundIntervalSec}s | Global: ${stats.total} evals, ${stats.call}C/${stats.put}P, ${stats.vetoes} vetos, ${stats.fallbacks} fallbacks, ${(stats.avgLatencyMs/1000).toFixed(1)}s/lat.`;

        const marketRows = Array.from(new Set([...watchedSymbolsRef.current, activeSymbolRef.current].filter(Boolean))).map(sym => {
            const status = radarStatus[sym!];
            const candles = getCandlesFor(sym!);
            const sent = sentinel[sym!];
            if (!candles || candles.length === 0) return `- ${sym}: sem dados.`;

            const last = candles[candles.length - 1];
            const p = last.close ?? last.price;
            const hist = decisionHistoryRef.current[sym!]?.[0];
            const s = hist ? Math.round((Date.now() - hist.ts)/1000) : '--';
            
            const sentStr = sent?.candidates.map(c => `${c.contract[0]}:${c.score}${c.direction === 'CALL' ? '↑' : (c.direction === 'PUT' ? '↓' : '')}`).join(' ') || '--';

            return `- ${sym}: $${p.toFixed(4)} | RSI:${status?.indicators?.rsi.toFixed(1) || '--'} | %B:${status?.indicators?.bbw.toFixed(3) || '--'} | ADX:${status?.indicators?.adx.toFixed(0) || '--'} | Sentinela:[${sentStr}] | Conselho(${s}s): ${hist?.action || 'HOLD'} ${hist?.conf || 0}% ${hist?.contract || ''} [${hist?.votes || ''}] ${hist?.hold?.slice(0, 80) || ''} | posições abertas no ativo: ${operationsLogRef.current.filter(o => o.asset === sym && o.status === 'pending').length}`;
        }).join('\n');

        const focusOpinions = activeSymbolRef.current && radarStatus[activeSymbolRef.current] 
            ? radarStatus[activeSymbolRef.current].opinions.map(o => `  - ${o.agentName}: ${o.action} ${o.confidence}% ${o.recommendedContract} - ${o.reasoning.slice(0, 140)}`).join('\n')
            : "Nenhuma opinião disponível.";

        const recentLogs = reasoningLog
            .filter(l => ['decision', 'execution', 'error'].includes(l.type))
            .slice(0, 12)
            .map(l => `[${l.time}] ${l.message}`)
            .join('\n');

        const memory = TradeMemoryManager.formatBufferForPrompt(memoryBuffer).slice(0, 600);

        return `\n${session}\n\n[MERCADO]\n${marketRows}\n\n[ÚLTIMAS OPINIÕES DO FOCO]\n${focusOpinions}\n\n[EVENTOS RECENTES]\n${recentLogs}\n\n[MEMÓRIA]\n${memory}`;
    }, [isShadowMode, isAutoMode, accountType, accountBalance.balance, sessionStats, maxConcurrentTrades, stakeValue, allowedActions, allowedContracts, analysisInterval, backgroundIntervalSec, councilStats, getCandlesFor, radarStatus, sentinel, reasoningLog, memoryBuffer]);

    const updateOllamaConfig = (updates: Partial<OllamaConfig>) => {
        if (!ollamaConfig) return;
        const newConfig = { ...ollamaConfig, ...updates };
        setOllamaConfigState(newConfig);
        localStorage.setItem('ollamaConfig', JSON.stringify(newConfig));
    };

    const fetchAvailableModels = async () => {
        if (!ollamaConfig) return;
        try {
            const url = ollamaConfig.baseUrl.replace(/\/+$/, '') + '/api/tags';
            const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
            if (ollamaConfig.apiKey) {
                headers['Authorization'] = `Bearer ${ollamaConfig.apiKey}`;
            }
            const res = await fetch(url, { headers });
            if (res.ok) {
                const data = await res.json();
                setAvailableModels(data.models || []);
            }
        } catch (e) { console.error("Falha ao buscar modelos", e); }
    };

    useEffect(() => {
        const timer = setInterval(() => {
            const nextTs = scheduleRef.current[activeSymbolRef.current ?? ''] ?? Date.now();
            setTimeToNextAnalysis(Math.max(0, Math.round((nextTs - Date.now()) / 1000)));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        lastDecision, timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        backgroundIntervalSec, setBackgroundIntervalSec, sentinelIntervalSec, setSentinelIntervalSec,
        allowedActions, setAllowedActions,
        allowedContracts, setAllowedContracts, 
        maxConcurrentTrades, setMaxConcurrentTrades,
        stakeValue, setStakeValue, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
        sessionStats, councilStats, reasoningLog, memoryBuffer, accountBalance, radarStatus, sentinel,
        watchedSymbols, setWatchedSymbols, resetSession, chatMessages, isChatLoading, sendMessage,
        executeManualDecision: () => activeSymbolRef.current && runAnalysisForSymbol(activeSymbolRef.current, getCandlesFor(activeSymbolRef.current), true),
        telemetry, ollamaConfig, availableModels, updateOllamaConfig, fetchAvailableModels,
        setAccountType, accountType
    };
}
