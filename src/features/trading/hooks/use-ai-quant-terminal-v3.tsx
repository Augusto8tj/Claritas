// /src/features/trading/hooks/use-ai-quant-terminal-v3.tsx
'use client';

/**
 * @fileOverview TERMINAL QUANT V3.9.6 (COUNCIL EDITION) - MODULARIZED
 * V3.9.5: Posições Órfãs, Backtest Paginado e Sentinela Histerese.
 * V3.9.6: Detecção de Mercado Fechado / Stale Data.
 * V4.0.0: Split estrutural, builders puros e runner especializado.
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
import { buildStatusReport, buildAssetReport, buildBacktestReport, buildShortContext } from '../services/report-builders';
import { useBacktestRunner } from './use-backtest-runner';

const SETTINGS_KEY = 'quantV3Settings';

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

const isOrphanOp = (op: Operation) => {
    const ageMs = Date.now() - new Date(op.timestamp).getTime();
    const isExpired = op.expirationTime && Date.now() > op.expirationTime + 60000;
    const isVeryOld = ageMs > 24 * 3600 * 1000;
    return isExpired || isVeryOld;
};

const AGENT_PERSONAS = {
  CHAIRMAN: "o CHAIRMAN do conselho: sintetiza a visão técnica de forma executiva",
  MOMENTUM: "o analista QUANT MOMENTUM: força do preço, momentum e velocidade",
  RISK_CRITIC: "o RISK CRITIC: cético, aponta riscos e razões para NÃO operar",
  ARCHIVIST: "o PATTERN ARCHIVIST: memória de trades e padrões passados"
};

export function useAIQuantTerminalV3(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { 
        isConnected, executeTrade, operationsLog, accountBalance, 
        watchedSymbols, setWatchedSymbols, multiAssetCandles, 
        clearActiveContracts, accountType, setAccountType,
        botCandleData, durationLimits, getHistoricalData 
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
    
    // BACKTEST RUNNER (Specialized Hook)
    const { backtest, runBacktest } = useBacktestRunner(getHistoricalData);

    // LOGS E TELEMETRIA
    const [reasoningLog, setReasoningLog] = useState<LogEntry[]>([]);
    const [telemetry, setTelemetry] = useState<CouncilTelemetry>({
        avgTokensPerSec: 0,
        totalTokens: 0,
        consensusEntropy: 0,
        jitterMs: 0,
        inferenceHealth: 100
    });
    
    // MEMÓRIA E RADAR
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [radarStatus, setRadarStatus] = useState<Record<string, any>>({});
    const [sentinel, setSentinel] = useState<Record<string, { features: SignalFeatures | null, candidates: SignalCandidate[], ts: number, isStale?: boolean, staleMin?: number }>>({});
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);

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
    const lastDecisionBySymbolRef = useRef<Record<string, { ts: number, decision: CouncilDecision }>>({});
    const chatBusyRef = useRef(false);
    const pendingChatOrderRef = useRef<{ symbol: string, ts: number } | null>(null);
    const lastSkipLogRef = useRef<Record<string, number>>({});
    const lastMarketClosedLogRef = useRef<Record<string, number>>({});
    const sentinelEpisodeRef = useRef<Record<string, { start: number, lastAbove: number, peak: number }>>({});
    const [sentinelCounts, setSentinelCounts] = useState<Record<string, number>>({ OPTIONS: 0, MULTIPLIERS: 0, ACCUMULATORS: 0 });
    const interlockLoggedRef = useRef(false);

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
    const [availableModels, setAvailableModels] = useState<any[]>([]);
    
    // RESET FUNCTIONS (Upwards)
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
        interlockLoggedRef.current = false;
        setSentinelCounts({ OPTIONS: 0, MULTIPLIERS: 0, ACCUMULATORS: 0 });
        sentinelEpisodeRef.current = {};
        lastMarketClosedLogRef.current = {};
        toast({ title: "Sessão Reiniciada", description: "Todos os dados voláteis foram limpos." });
    }, [clearActiveContracts, toast]);

    const clearMemory = useCallback(async () => {
      if (!user) return;
      await TradeMemoryManager.clearBuffer(user.uid);
      setMemoryBuffer({ wins: [], losses: [] });
      toast({ title: "Memória Limpa", description: "O buffer tático foi apagado." });
    }, [user, toast]);

    const resetSessionRef = useRef(resetSession);
    resetSessionRef.current = resetSession;

    // PERSISTÊNCIA DE CONFIGURAÇÕES
    useEffect(() => {
        const savedOllama = localStorage.getItem('ollamaConfig');
        if (savedOllama) {
            try { 
              const config = JSON.parse(savedOllama) as OllamaConfig;
              setOllamaConfigState(config); 
            } catch (e) { console.error(e); }
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

    // MEMÓRIA TÁTICA POR ATIVO
    useEffect(() => {
        if (!user || !activeSymbol) return;
        TradeMemoryManager.getBuffer(user.uid, activeSymbol).then(setMemoryBuffer);
    }, [user, activeSymbol]);

    // HANDSHAKE AUTOMÁTICO OLLAMA
    const fetchAvailableModels = useCallback(async () => {
        if (!ollamaConfig?.baseUrl) return;
        try {
            const url = ollamaConfig.baseUrl.replace(/\/+$/, '') + '/api/tags';
            const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
            if (ollamaConfig.apiKey) headers['Authorization'] = `Bearer ${ollamaConfig.apiKey}`;
            const res = await fetch(url, { headers });
            if (res.ok) {
                const data = await res.json();
                setAvailableModels(data.models || []);
            }
        } catch (e) {}
    }, [ollamaConfig]);

    useEffect(() => {
        if (ollamaConfig?.baseUrl) fetchAvailableModels();
    }, [ollamaConfig?.baseUrl, fetchAvailableModels]);

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

    const getCandlesFor = useCallback((symbol: string): CandleData[] => {
        const multi = multiAssetCandlesRef.current[symbol];
        if (multi && multi.length >= 30) return multi as CandleData[];
        if (symbol === activeSymbolRef.current && botCandleDataRef.current.length >= 30)
            return botCandleDataRef.current;
        return (multi ?? []) as CandleData[];
    }, []);

    const staleMinutes = useCallback((symbol: string): number | null => {
        const candles = getCandlesFor(symbol);
        if (candles.length === 0) return null;
        const last = candles[candles.length - 1];
        return (Date.now() / 1000 - last.epoch) / 60;
    }, [getCandlesFor]);

    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManualTrigger: boolean = false): Promise<CouncilDecision | undefined> => {
        const min = staleMinutes(symbol);
        if (min === null) {
            const now = Date.now();
            if (now - (lastSkipLogRef.current[symbol] || 0) > 60000) {
                addLog(`[SKIP] ${symbol}: carregando dados...`, 'info', undefined, symbol);
                lastSkipLogRef.current[symbol] = now;
            }
            return undefined;
        }

        if (min > 2.5) {
            addLog(`[SKIP-ANALISE] ${symbol}: mercado fechado ou defasado (${Math.round(min)} min).`, 'warning', undefined, symbol);
            return undefined;
        }

        if (!isConnected) { addLog(`[SKIP] ${symbol}: WebSocket desconectado.`, 'warning', undefined, symbol); return undefined; }
        if (!ollamaConfig) { addLog(`[SKIP] ${symbol}: ollamaConfig ausente.`, 'warning', undefined, symbol); return undefined; }
        if (candles.length < 30) { addLog(`[SKIP] ${symbol}: candles insuficientes (${candles.length}/30).`, 'warning', undefined, symbol); return undefined; }
        if (!user) { addLog(`[SKIP] ${symbol}: usuário nulo.`, 'warning', undefined, symbol); return undefined; }
        
        const isFocused = symbol === activeSymbolRef.current;
        
        try {
            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            
            if (!indicators || !Number.isFinite(indicators.rsi)) {
                addLog(`[SKIP-DADOS] ${symbol}: indicadores inválidos.`, 'warning', undefined, symbol);
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

            const nonOrphanOps = operationsLogRef.current.filter(op => !isOrphanOp(op));
            const portfolioState: PortfolioRiskState = {
                openPositions: nonOrphanOps.filter(op => op.status === 'pending').length,
                maxConcurrentPositions: maxConcurrentTrades,
                totalExposure: nonOrphanOps.filter(op => op.status === 'pending').reduce((sum, op) => sum + op.stake, 0),
                maxTotalExposure: dailyBalance,
                lockedSymbols: new Set(),
                plannedStake: stakeValue
            };

            const initialPermissions: AssetExecutionPermission = {
                symbol, enabled: true, maxStake: stakeValue * 2,
                allowedContracts: Object.keys(allowedContracts).filter(k => allowedContracts[k as keyof typeof allowedContracts]) as any[],
                allowedActions: Object.keys(allowedActions).filter(k => allowedActions[k as keyof typeof allowedActions]) as any[]
            };

            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, isFocused, initialPermissions, portfolioState);
            lastDecisionBySymbolRef.current[symbol] = { ts: Date.now(), decision };
            
            const { finalAction: action, consensusConfidence: conf, executedVia: via, recommendedContract: contract, debugVotes: votes, t2tLatencyMs: lat } = decision;

            addLog(`[CONSELHO] ${symbol}: ${action} ${conf}% | ${contract} | via=${via} | votos[${votes}] | ${lat}ms`, 'decision', 
                [`ENTRADA: ${JSON.stringify(snapshot)}`, ...(decision.trace ?? []), decision.holdReason ? `MOTIVO HOLD: ${decision.holdReason}` : ''].filter(Boolean), symbol);

            if (isFocused) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
                setMemoryBuffer(buffer);
            }

            setRadarStatus(prev => ({
                ...prev,
                [symbol]: {
                    symbol, lastAction: decision.finalAction, lastPrice: currentPrice, confidence: decision.consensusConfidence,
                    timestamp: Date.now(), isQualified: decision.finalAction !== 'HOLD' && decision.consensusConfidence >= MIN_EXEC_CONFIDENCE,
                    executedVia: decision.executedVia, opinions: decision.opinions, 
                    recommendedContract: decision.finalAction === 'HOLD' ? '—' : decision.recommendedContract,
                    holdReason: decision.holdReason, debugVotes: decision.debugVotes,
                    indicators: { rsi: snapshot.rsi || 50, bbw: indicators.bbw || 0, adx: indicators.adx || 0 },
                    isFallback: decision.executedVia === 'MATH_FALLBACK',
                    isStale: min > 2.5,
                    staleMin: Math.round(min)
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
                const stake = Math.max(0.35, Number((stakeValue * (decision.stakeRatio || 1)).toFixed(2)));
                addLog(`[STAKE] base=$${stakeValue} ratio=${decision.stakeRatio} final=$${stake}`, 'info', undefined, symbol);
                
                if (isShadowMode) {
                    addLog(`[SHADOW] ${symbol}: ${decision.finalAction} simulado em modo sombra.`, 'radar', undefined, symbol);
                } else {
                    let finalContractType = 'CALL';
                    switch (decision.recommendedContract) {
                        case 'ACCUMULATORS': finalContractType = 'ACCU'; break;
                        case 'MULTIPLIERS': finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN'; break;
                        default: finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                    }

                    const tradeDirection: 'rise' | 'fall' = decision.finalAction === 'CALL' ? 'rise' : 'fall';
                    const res = await executeTradeRef.current(finalContractType, stake, symbol, tradeDirection, 15, 's', 'Conselho_V3', `V3_${decision.executedVia}`);
                    if (res.success) addLog(`[EXEC] ${symbol} ${decision.finalAction} enviado. ID=${res.contractId}`, 'execution', undefined, symbol);
                    else addLog(`[EXEC-FALHA] ${symbol} ${finalContractType}: ${res.message}`, 'error', undefined, symbol);
                }
            }
            return decision;
        } catch (error: any) {
            if (isFocused) addLog(`Erro em ${symbol}: ${error.message}`, 'error', undefined, symbol);
            return undefined;
        }
    }, [isConnected, ollamaConfig, isShadowMode, user, isAutoMode, allowedContracts, allowedActions, maxConcurrentTrades, dailyBalance, addLog, stakeValue, staleMinutes]);

    // RADAR SCANNER (5s)
    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || chatBusyRef.current || !isConnected) return;
        executionLockRef.current = true;

        const startTime = Date.now();
        try {
            const currentActive = activeSymbolRef.current;
            const symbols = Array.from(new Set([...watchedSymbolsRef.current, currentActive].filter(Boolean)));
            
            const liveDue = symbols.filter(sym => (staleMinutes(sym) ?? 0) <= 2.5 && (scheduleRef.current[sym] || 0) <= startTime);
            const staleDue = symbols.filter(sym => (staleMinutes(sym) ?? 999) > 2.5 && (scheduleRef.current[sym] || 0) <= startTime);

            if (liveDue.length > 0) {
                addLog(`[CICLO] due=[${liveDue.join(', ')}]`, 'info');
                liveDue.sort((a, b) => (a === currentActive ? -1 : (b === currentActive ? 1 : 0)));

                for (const symbol of liveDue) {
                    const candles = getCandlesFor(symbol);
                    if (candles && candles.length >= 30) {
                        const isFoco = symbol === currentActive;
                        const nextInt = Math.max(10, isFoco ? analysisIntervalRef.current : backgroundIntervalRef.current);
                        scheduleRef.current[symbol] = Date.now() + nextInt * 1000;
                        try { await runAnalysisForSymbol(symbol, candles as CandleData[]); } catch (e: any) {}
                    }
                }
            }

            staleDue.forEach(symbol => {
                const min = staleMinutes(symbol) ?? 999;
                const now = Date.now();
                if (now - (lastMarketClosedLogRef.current[symbol] || 0) > 600000) {
                    addLog(`[MERCADO-FECHADO] ${symbol}: último candle há ${Math.round(min)} min.`, 'warning', undefined, symbol);
                    lastMarketClosedLogRef.current[symbol] = now;
                }
                scheduleRef.current[symbol] = Date.now() + 60000;
            });

        } finally {
            executionLockRef.current = false;
        }
    }, [isConnected, runAnalysisForSymbol, getCandlesFor, addLog, staleMinutes]);

    useEffect(() => {
        const first = setTimeout(() => { runMultiAssetCycle(); }, 1500);
        const id = setInterval(() => { runMultiAssetCycle(); }, 5000);
        return () => { clearTimeout(first); clearInterval(id); };
    }, [runMultiAssetCycle]);

    const sendMessage = async (content: string, targetAgent: string = 'CHAIRMAN') => {
        if (!content.trim()) return;
        
        const time = new Date().toLocaleTimeString();
        const userMsg: ChatMessage = { role: 'user', content, time };
        setChatMessages(prev => [...prev, userMsg]);

        const CONFIRM = /^\s*confirmo[\s.!]*$/i;
        const CMD = /^\s*(por favor[, ]*)?(compre|comprar|venda|vender|execute|executar|opere|operar|abra|abrir|entre|entrar)\b\s*(.*)/i;
        const WHY = /(por\s?que|porque|motivo|explique|explica|como est[aá])/i;
        const REPORT = /(situa[cç][aã]o|status|auditoria|listagem|relat[oó]rio|resumo|quais ativos|que ativos|monitorando|oportunidades?|chances?|vantaj\w*|melhor(es)?|promissor\w*)/i;
        const BACKTEST_RE = /(backtest|retroteste|teste estat[ií]stic)/i;

        const symbols = Array.from(new Set([...watchedSymbolsRef.current, activeSymbolRef.current].filter(Boolean)));

        if (content.match(CONFIRM)) {
            if (pendingChatOrderRef.current && (Date.now() - pendingChatOrderRef.current.ts) < 60000 && !isShadowMode) {
                const sym = pendingChatOrderRef.current.symbol;
                const decision = await runAnalysisForSymbol(sym, getCandlesFor(sym), true);
                if (decision) {
                    setChatMessages(prev => [...prev, { 
                        role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                        content: `[REAL] Execução para ${sym} via chat: ${decision.finalAction} ${decision.consensusConfidence}% via=${decision.executedVia}.`
                    }]);
                } else {
                     setChatMessages(prev => [...prev, { 
                        role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                        content: `Sem avaliação para ${sym}: mercado fechado/defasado, dados insuficientes ou Ollama indisponível (veja o log).`
                    }]);
                }
                pendingChatOrderRef.current = null;
            } else {
                setChatMessages(prev => [...prev, { role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(), content: "Nenhum pedido pendente ou modo Real desativado." }]);
                pendingChatOrderRef.current = null;
            }
            return;
        }

        const cmdMatch = content.match(CMD);
        if (cmdMatch) {
            const found = symbols.filter(s => s && content.toUpperCase().includes(s.toUpperCase()));
            if (found.length === 0) {
                setChatMessages(prev => [...prev, { role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(), content: `Informe o ativo (ex.: compre 1HZ10V). Ativos monitorados: ${symbols.join(', ')}` }]);
            } else if (found.length > 1) {
                setChatMessages(prev => [...prev, { role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(), content: `Múltiplos ativos detectados (${found.join(', ')}). Por favor, escolha apenas UM para o comando.` }]);
            } else {
                const symbol = found[0];
                if (isShadowMode) {
                    const decision = await runAnalysisForSymbol(symbol, getCandlesFor(symbol), true);
                    if (decision) {
                      setChatMessages(prev => [...prev, { role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(), content: `[SHADOW] Auditoria para ${symbol}: ${decision.finalAction} ${decision.consensusConfidence}% (${decision.recommendedContract}) votos:[${decision.debugVotes}] ${decision.holdReason ? 'hold='+decision.holdReason : ''}` }]);
                    } else {
                      setChatMessages(prev => [...prev, { role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(), content: `Sem avaliação para ${symbol}: mercado fechado/defasado, dados insuficientes ou Ollama indisponível (veja o log).` }]);
                    }
                } else {
                    pendingChatOrderRef.current = { symbol, ts: Date.now() };
                    setChatMessages(prev => [...prev, { role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(), content: `⚠️ Ordem REAL para ${symbol} detectada. Digite "CONFIRMO" em até 60s para autorizar a execução. O Conselho decidirá a direção final.` }]);
                }
            }
            return;
        }

        const hasSym = symbols.find(s => s && content.toUpperCase().includes(s.toUpperCase()));
        if (hasSym && content.match(WHY)) {
            setChatMessages(prev => [...prev, { 
                role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                content: buildAssetReport({ sym: hasSym, sentData: sentinel[hasSym], hist: lastDecisionBySymbolRef.current[hasSym], lastCandleClose: getCandlesFor(hasSym).slice(-1)[0]?.close, staleMin: staleMinutes(hasSym) })
            }]);
            return;
        }

        if (content.match(BACKTEST_RE)) {
            setChatMessages(prev => [...prev, { role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(), content: buildBacktestReport({ ts: backtest.ts, payoutPct: backtest.payoutPct, assetMeta: backtest.assetMeta, merged: backtest.merged, perAsset: backtest.perAsset }) }]);
            return;
        }

        if (content.match(REPORT)) {
            setChatMessages(prev => [...prev, { 
                role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                content: buildStatusReport({ isShadowMode, isAutoMode, accountType, balance: accountBalance.balance || 0, stats: councilStats, openPositions: operationsLog.filter(o => o.status === 'pending'), maxConcurrentTrades, sentinel, sentinelCounts, lastDecisions: lastDecisionBySymbolRef.current, staleMinutes })
            }]);
            return;
        }

        if (!ollamaConfig) {
          setChatMessages(prev => [...prev, { role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(), content: "Ollama não configurado: relatórios e comandos continuam disponíveis." }]);
          return;
        }

        setIsChatLoading(true);
        chatBusyRef.current = true;
        try {
            const context = buildShortContext({ sentinel, lastDecisions: lastDecisionBySymbolRef.current, staleMinutes });
            const persona = (AGENT_PERSONAS as any)[targetAgent] || AGENT_PERSONAS.CHAIRMAN;
            const systemPrompt = `Você é ${persona}. Responda em português do Brasil.\n\n${context}\n\nREGRAS: use estes dados; cite números. Máximo 120 palavras.`;

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

    const sessionStatsLocal = useMemo(() => {
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && op.initiator === 'Conselho_V3'
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const total = finishedTrades.length;
        const winRate = total > 0 ? (wins / total) * 100 : null;
        const pnl = finishedTrades.reduce((acc, op) => acc + (Number(op.result) || 0), 0);
        return { pnl: Number(pnl) || 0, winRate, total };
    }, [operationsLog]);

    const updateOllamaConfig = (updates: Partial<OllamaConfig>) => {
        if (!ollamaConfig) return;
        const newConfig = { ...ollamaConfig, ...updates };
        setOllamaConfigState(newConfig);
        localStorage.setItem('ollamaConfig', JSON.stringify(newConfig));
    };

    useEffect(() => {
        const timer = setInterval(() => {
            const nextTs = scheduleRef.current[activeSymbolRef.current ?? ''] ?? Date.now();
            setTimeToNextAnalysis(Math.max(0, Math.round((nextTs - Date.now()) / 1000)));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    return {
        isAutoMode, setIsAutoMode,
        isShadowMode, setIsShadowMode,
        lastDecision, timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        backgroundIntervalSec, setBackgroundIntervalSec, sentinelIntervalSec, setSentinelIntervalSec,
        allowedActions, setAllowedActions,
        allowedContracts, setAllowedContracts, 
        maxConcurrentTrades, setMaxConcurrentTrades,
        stakeValue, setStakeValue, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
        sessionStats: sessionStatsLocal, councilStats, reasoningLog, memoryBuffer, accountBalance, radarStatus, sentinel,
        watchedSymbols, setWatchedSymbols, resetSession, clearMemory, chatMessages, isChatLoading, sendMessage,
        executeManualDecision: () => activeSymbolRef.current && runAnalysisForSymbol(activeSymbolRef.current, getCandlesFor(activeSymbolRef.current), true),
        telemetry, ollamaConfig, availableModels, updateOllamaConfig, fetchAvailableModels,
        setAccountType, accountType, runBacktest: (p, t, e) => runBacktest([...watchedSymbolsRef.current, activeSymbolRef.current || ''].filter(Boolean).concat(e), p, t), backtest, buildBacktestReport: () => buildBacktestReport({ ts: backtest.ts, payoutPct: backtest.payoutPct, assetMeta: backtest.assetMeta, merged: backtest.merged, perAsset: backtest.perAsset }), staleMinutes
    };
}
