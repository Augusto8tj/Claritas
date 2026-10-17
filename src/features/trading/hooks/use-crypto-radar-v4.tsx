
'use client';

/**
 * @fileOverview TERMINAL QUANT V4.2 - CRYPTO LAB (SUPREME EDITION)
 * V5: Integrado motor de execução, Post-Mortem, Circuit Breaker e Trailing Profit Floor.
 * Exibe métricas institucionais de gravidade, beta e correlação.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi, type AccountType } from './use-deriv-api-v2';
import { calculateAllIndicators } from '../services/indicator-service';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { TradeMemoryManager } from '../services/trade-memory-service';
import { runQuantCouncil, MIN_EXEC_CONFIDENCE } from '../services/quant-council-engine';
import { CouncilDecision, TradeMemoryBuffer, CouncilTelemetry, AssetExecutionPermission, PortfolioRiskState, AllowedContractsV3, AllowedActionsV3 } from '../types/council';
import { computeSignalFeatures } from '../services/signal-engine';
import { evaluateCryptoSignals, type CryptoSignalFeatures } from '../services/crypto-signal-engine';
import { calculateBitcoinGravity, type BitcoinGravity } from '../services/crypto-gravity-engine';
import { useAdaptiveResilience } from '@/hooks/useAdaptiveResilience';
import { getOllamaResponse } from '@/app/actions';
import { useBacktestRunner } from './use-backtest-runner';
import { buildStatusReport, buildAssetReport, buildBacktestReport, buildShortContext } from '../services/report-builders';

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

export type StrategicProfile = 'conservative' | 'balanced' | 'aggressive';

const AGENT_PERSONAS = {
  CHAIRMAN: "o CHAIRMAN do conselho supremo: sua resposta deve ser executiva, fundamentada no DOSSIER DE TELEMETRIA fornecido. Você sintetiza a decisão final.",
  MOMENTUM: "o analista QUANT MOMENTUM: sua função é calcular a força do preço usando RSI, ER e Mom5 do dossier. Ignore sentimentos, foque na velocidade.",
  RISK_CRITIC: "o RISK CRITIC: você é cético. Use o Beta, a Correlação e o Piso Travado para alertar sobre perigos de divergência ou ganância.",
  ARCHIVIST: "o PATTERN ARCHIVIST: você compara o snapshot atual com a MEMÓRIA DE APRENDIZADO injetada. Identifique se este setup já falhou antes."
};

const SETTINGS_KEY = 'cryptoLabV4Settings';
const DEFAULT_ANALYSIS_INTERVAL = 120;

export function useCryptoRadarV4(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { 
        isConnected, executeTrade, operationsLog, accountBalance, 
        watchedSymbols, setWatchedSymbols, multiAssetCandles, 
        clearActiveContracts, accountType, setAccountType,
        botCandleData, getHistoricalData 
    } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();
    const resilience = useAdaptiveResilience();

    const DEFAULT_CLUSTER = ['cryBTCUSD', 'cryETHUSD'];
    const initializedRef = useRef(false);

    const [reasoningLog, setReasoningLog] = useState<LogEntry[]>([]);
    const [councilStats, setCouncilStats] = useState<CouncilStats>({ total: 0, call: 0, put: 0, hold: 0, vetoes: 0, fallbacks: 0, avgLatencyMs: 0 });
    const [telemetry, setTelemetry] = useState<CouncilTelemetry>({ 
        avgTokensPerSec: 0, 
        totalTokens: 0, 
        consensusEntropy: 0, 
        jitterMs: 0, 
        inferenceHealth: 100 
    });

    const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', details?: string[], symbol?: string) => {
        setReasoningLog(prev => [{
            ts: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
            time: new Date().toLocaleTimeString(),
            message, type, details, symbol
        }, ...prev].slice(0, 300));
    }, []);

    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [analysisInterval, setAnalysisInterval] = useState(DEFAULT_ANALYSIS_INTERVAL); 
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    const [confidenceThreshold, setConfidenceThreshold] = useState(65);
    const [requireSentinelCandidate] = useState(true);

    const [lockedProfitFloor, setLockedProfitFloor] = useState(0);
    const dailyHighWaterMark = useRef(0);

    const [stakeValue, setStakeValue] = useState(1.0);
    const [multiplier, setMultiplier] = useState(400);

    const [dailyBalance, setDailyBalance] = useState(100.0);
    const [dailyTarget, setDailyTarget] = useState(50.0);
    const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(3);
    const [allowedActions, setAllowedActions] = useState<AllowedActionsV3>({ 'CALL': true, 'PUT': true });
    const [allowedContracts, setAllowedContracts] = useState<AllowedContractsV3>({ 'OPTIONS': true, 'ACCUMULATORS': false, 'MULTIPLIERS': true });

    const { backtest, runBacktest } = useBacktestRunner(getHistoricalData);

    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [radarStatus, setRadarStatus] = useState<Record<string, any>>({});
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    
    const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>({
        baseUrl: "",
        apiKey: "",
        model: "",
        temperature: 0.1,
        keepAlive: "5m"
    });
    
    const [availableModels, setAvailableModels] = useState<any[]>([]);

    const activeSymbolRef = useRef(activeSymbol);
    const executionLockRef = useRef(false);
    const scheduleRef = useRef<Record<string, number>>({});
    const lastDecisionBySymbolRef = useRef<Record<string, { ts: number, decision: CouncilDecision }>>({});

    const updateOllamaConfig = useCallback((updates: Partial<OllamaConfig>) => {
        setOllamaConfig(prev => {
            const next = { ...prev, ...updates };
            localStorage.setItem('ollamaConfig', JSON.stringify(next));
            return next;
        });
    }, []);

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

    const resetSession = useCallback(() => {
        setIsAutoMode(false);
        setIsShadowMode(true);
        clearActiveContracts();
        setRadarStatus({});
        setReasoningLog([]);
        setChatMessages([]);
        setLockedProfitFloor(0);
        setCouncilStats({ total: 0, call: 0, put: 0, hold: 0, vetoes: 0, fallbacks: 0, avgLatencyMs: 0 });
        scheduleRef.current = {};
        setLastDecision(null);
        toast({ title: "Sessão Reiniciada", description: "Todos os dados foram resetados." });
    }, [clearActiveContracts, toast]);

    const sessionStats = useMemo(() => {
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && op.initiator.startsWith('Conselho')
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const total = finishedTrades.length;
        const winRate = total > 0 ? (wins / total) * 100 : null;
        const pnl = finishedTrades.reduce((acc, op) => acc + (Number(op.result) || 0), 0);
        return { pnl: Number(pnl) || 0, winRate, total };
    }, [operationsLog]);

    useEffect(() => { activeSymbolRef.current = activeSymbol; }, [activeSymbol]);

    // Heartbeat
    useEffect(() => {
        if (activeSymbol && priceTicks.length > 0) {
            resilience.recordPulse(activeSymbol);
        }
    }, [priceTicks, activeSymbol, resilience]);

    useEffect(() => {
        Object.keys(multiAssetCandles).forEach(symbol => {
            if (watchedSymbols.includes(symbol)) {
                resilience.recordPulse(symbol);
            }
        });
    }, [multiAssetCandles, watchedSymbols, resilience]);

    // Persistência e Heartbeat
    useEffect(() => {
        const savedOllama = localStorage.getItem('ollamaConfig');
        if (savedOllama) {
            try { setOllamaConfig(JSON.parse(savedOllama)); } catch (e) {}
        }
    }, []);

    useEffect(() => {
        if (!initializedRef.current && isConnected) {
            const isSyntheticDefault = watchedSymbols.length === 5 && watchedSymbols.includes('1HZ10V');
            if (watchedSymbols.length === 0 || isSyntheticDefault) {
                setWatchedSymbols(DEFAULT_CLUSTER);
                addLog("Cluster Institucional cryBTCUSD/cryETHUSD configurado como padrão.", "info");
            }
            initializedRef.current = true;
        }
    }, [isConnected, watchedSymbols, setWatchedSymbols, addLog, DEFAULT_CLUSTER]);

    useEffect(() => {
        if (sessionStats.pnl > dailyHighWaterMark.current) {
            dailyHighWaterMark.current = sessionStats.pnl;
        }

        const profitRatio = sessionStats.pnl / dailyTarget;
        if (profitRatio >= 0.8) {
            const floor = sessionStats.pnl * 0.5;
            if (floor > lockedProfitFloor) setLockedProfitFloor(floor);
        } else if (profitRatio >= 0.5) {
            if (lockedProfitFloor < 0.01) setLockedProfitFloor(0.01);
        }
    }, [sessionStats.pnl, dailyTarget, lockedProfitFloor]);

    const getCandlesFor = useCallback((symbol: string): CandleData[] => {
        const multi = multiAssetCandles[symbol];
        if (multi && multi.length >= 30) return multi as CandleData[];
        if (symbol === activeSymbol && botCandleData.length >= 30) return botCandleData;
        return (multi ?? []) as CandleData[];
    }, [multiAssetCandles, activeSymbol, botCandleData]);

    const staleMinutes = useCallback((symbol: string): number | null => {
        const candles = getCandlesFor(symbol);
        if (candles.length === 0) return null;
        const last = candles[candles.length - 1];
        return (Date.now() / 1000 - last.epoch) / 60;
    }, [getCandlesFor]);

    const buildAssetFeatures = (assetSym: string, assetCandles: CandleData[]) => {
        const inds = calculateAllIndicators(assetCandles, [], '1m', { duration: 15, unit: 's' });
        const feats = computeSignalFeatures(assetCandles as any);
        if (!inds || !feats) return null;
        return {
            symbol: assetSym,
            currentPrice: assetCandles[assetCandles.length - 1].close,
            priceHistory: assetCandles.map(c => c.close),
            rsi: feats.rsi,
            adx: inds.adx || 30,
            atrNow: inds.atr || 0.001,
            bbw: inds.bbw || 1.0,
            volatilityRatio: feats.atrRatio || 1,
            momentumShort: feats.mom5,
            momentumMedium: feats.mom15
        };
    };

    const sendMessage = async (content: string, targetAgent: string = 'CHAIRMAN') => {
        if (!content.trim() || !ollamaConfig) return;
        const time = new Date().toLocaleTimeString();
        setChatMessages(prev => [...prev, { role: 'user', content, time }]);
        setIsChatLoading(true);

        try {
            const context = buildShortContext({ 
                sentinel: radarStatus, 
                lastDecisions: lastDecisionBySymbolRef.current, 
                staleMinutes,
                financialState: {
                    pnl: sessionStats.pnl,
                    floor: lockedProfitFloor,
                    balance: accountBalance.balance || 0
                }
            });

            const persona = (AGENT_PERSONAS as any)[targetAgent] || AGENT_PERSONAS.CHAIRMAN;
            const systemPrompt = `Você é ${persona}. Responda em português do Brasil.
            
DIRETRIZES RÍGIDAS DE DADOS (V5.3):
1. USE APENAS OS DADOS DO DOSSIER DE TELEMETRIA ABAIXO.
2. PROIBIDO ALUCINAR: Nunca invente ativos (como 'Ativo A') ou preços (como '$100').
3. Se um valor não estiver no dossier, diga "Dados Não Disponíveis no Snapshot".
4. Baseie seu rigor de risco no P&L de $${sessionStats.pnl.toFixed(2)} e no Piso de $${lockedProfitFloor.toFixed(2)}.

${context}`;

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
            setIsChatLoading(false);
        }
    };

    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManual: boolean = false) => {
        if (!isConnected || !user || !ollamaConfig || executionLockRef.current) return;
        const min = staleMinutes(symbol);
        if (min !== null && min > 2.5) return;

        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            if (!indicators) return;

            const baseFeats = computeSignalFeatures(candles as any);
            if (!baseFeats) return;

            let gravity: BitcoinGravity | null = null;
            if (symbol !== 'cryBTCUSD') {
                const btcCandles = getCandlesFor('cryBTCUSD');
                if (btcCandles.length >= 30) {
                    const btcFeats = buildAssetFeatures('cryBTCUSD', btcCandles);
                    const targetFeats = buildAssetFeatures(symbol, candles);
                    if (btcFeats && targetFeats) {
                        gravity = calculateBitcoinGravity(btcFeats as any, targetFeats as any);
                    }
                }
            }

            if (gravity) {
                addLog(`[RADAR] ${symbol} vs BTC: ${gravity.btcVector} | Corr: ${gravity.correlation.toFixed(3)} | SlingShot: ${gravity.slingshotDetected}`, 'radar', undefined, symbol);
            }

            const cryptoFeats: CryptoSignalFeatures = { ...baseFeats, gravity, vwapDist: baseFeats.bbPos };
            
            // Etapa 7: Sentinel Influence
            const candidates = evaluateCryptoSignals(symbol, cryptoFeats);
            const bestCandidate = candidates
                .filter(c => c.direction !== 'NONE')
                .sort((a, b) => b.score - a.score)[0];

            if (!bestCandidate && requireSentinelCandidate) {
                addLog(`[SENTINEL] ${symbol}: Sem candidato técnico qualificado. Abortando conselho.`, 'sentinel', undefined, symbol);
                setRadarStatus(prev => ({
                    ...prev,
                    [symbol]: {
                        symbol, lastAction: 'HOLD', confidence: 0, timestamp: Date.now(),
                        holdReason: 'SENTINEL_EMPTY: Nenhum gatilho de base detectado.',
                        indicators: { rsi: baseFeats.rsi, adx: indicators.adx, bbw: indicators.bbw }
                    }
                }));
                return;
            }

            if (bestCandidate) {
                addLog(`[SENTINEL] ${symbol}: Candidato ${bestCandidate.rule} (${bestCandidate.direction}) detectado com score ${bestCandidate.score}.`, 'sentinel', undefined, symbol);
            }

            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);
            const portfolio: PortfolioRiskState = { openPositions: operationsLog.filter(op => op.status === 'pending').length, maxConcurrentPositions: maxConcurrentTrades, totalExposure: operationsLog.filter(op => op.status === 'pending').reduce((s, o) => s + o.stake, 0), maxTotalExposure: dailyBalance, lockedSymbols: new Set() };
            const permissions: AssetExecutionPermission = { symbol, enabled: true, userId: user.uid, maxStake: stakeValue * 5, allowedContracts: Object.keys(allowedContracts).filter(k => allowedContracts[k as keyof typeof allowedContracts]) as any[], allowedActions: Object.keys(allowedActions).filter(k => allowedActions[k as keyof typeof allowedActions]) as any[] };

            const marketSnapshot = {
                ...cryptoFeats,
                symbol,
                price: candles[candles.length - 1].close,
                strategicProfile,
                sentinel: bestCandidate ? {
                    rule: bestCandidate.rule,
                    score: bestCandidate.score,
                    mode: bestCandidate.recommendedContractMode,
                    sl: bestCandidate.stopLoss,
                    tp: bestCandidate.takeProfit
                } : null
            };

            executionLockRef.current = true;
            const decision = await runQuantCouncil(marketSnapshot as any, buffer, ollamaConfig, isShadowMode, symbol === activeSymbol, permissions, portfolio);
            
            // Etapa 7: Divergence Check
            if (bestCandidate && decision.finalAction !== 'HOLD' && decision.finalAction !== bestCandidate.direction) {
                addLog(`[WARNING] ${symbol}: Divergência detectada. Sentinel=${bestCandidate.direction} vs Conselho=${decision.finalAction}. Forçando HOLD.`, 'warning', undefined, symbol);
                decision.finalAction = 'HOLD';
                decision.holdReason = `DIVERGENCE: Sentinel(${bestCandidate.direction}) discorda do Conselho.`;
            }

            lastDecisionBySymbolRef.current[symbol] = { ts: Date.now(), decision };

            if (symbol === activeSymbol) { setLastDecision(decision); setTelemetry(decision.telemetry); setMemoryBuffer(buffer); }

            setCouncilStats(prev => ({ total: prev.total + 1, call: prev.call + (decision.finalAction === 'CALL' ? 1 : 0), put: prev.put + (decision.finalAction === 'PUT' ? 1 : 0), hold: prev.hold + (decision.finalAction === 'HOLD' ? 1 : 0), vetoes: prev.vetoes + (decision.executedVia === 'COUNCIL_VETO' ? 1 : 0), fallbacks: prev.fallbacks + (decision.executedVia === 'MATH_FALLBACK' ? 1 : 0), avgLatencyMs: (prev.avgLatencyMs * 0.8) + (decision.t2tLatencyMs * 0.2) }));

            const shouldExecute = isManual || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= confidenceThreshold);

            setRadarStatus(prev => ({ 
                ...prev, 
                [symbol]: { 
                    ...decision, 
                    features: cryptoFeats,
                    gravity, 
                    timestamp: Date.now(), 
                    isQualified: shouldExecute, 
                    indicators: { rsi: baseFeats.rsi, adx: indicators.adx, bbw: indicators.bbw } 
                } 
            }));

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                if (isShadowMode) {
                    addLog(`[SHADOW] ${symbol}: ${decision.finalAction} simulado.`, 'radar', undefined, symbol);
                } else {
                    let finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                    const params: Record<string, any> = {};
                    if (decision.recommendedContract === 'MULTIPLIERS') {
                        finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN';
                        params.multiplier = 400;
                    }
                    const res = await executeTrade(finalContractType, stakeValue, symbol, decision.finalAction.toLowerCase() as any, 15, 's', 'Conselho_V4', `V5_${decision.executedVia}`, params);
                    if (res.success) addLog(`[EXEC] ${symbol} ${decision.finalAction} enviado.`, 'execution', undefined, symbol);
                }
            }
        } catch (e: any) { addLog(`Erro V5 em ${symbol}: ${e.message}`, 'error'); } finally { executionLockRef.current = false; }
    }, [isConnected, user, ollamaConfig, isShadowMode, isAutoMode, activeSymbol, operationsLog, confidenceThreshold, strategicProfile, getCandlesFor, addLog, executeTrade, stakeValue, dailyBalance, maxConcurrentTrades, allowedContracts, allowedActions, staleMinutes, requireSentinelCandidate]);

    const runMultiAssetCycle = useCallback(async () => {
        if (!isConnected || executionLockRef.current) return;
        const now = Date.now();
        const symbols = Array.from(new Set([...watchedSymbols, activeSymbol].filter(Boolean)));
        const dueSymbols = symbols.filter(sym => (scheduleRef.current[sym] || 0) <= now);
        if (dueSymbols.length > 0) {
            dueSymbols.sort((a, b) => (a === activeSymbol ? -1 : (b === activeSymbol ? 1 : 0)));
            for (const sym of dueSymbols) {
                const candles = getCandlesFor(sym);
                if (candles.length >= 30) {
                    await runAnalysisForSymbol(sym, candles);
                    scheduleRef.current[sym] = Date.now() + (sym === activeSymbol ? 15 : analysisInterval) * 1000;
                }
            }
        }
    }, [isConnected, watchedSymbols, activeSymbol, analysisInterval, getCandlesFor, runAnalysisForSymbol]);

    useEffect(() => {
        const id = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(id);
    }, [runMultiAssetCycle]);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        strategicProfile, setStrategicProfile,
        confidenceThreshold, setConfidenceThreshold,
        requireSentinelCandidate,
        stakeValue, setStakeValue, multiplier, setMultiplier,
        dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
        maxConcurrentTrades, setMaxConcurrentTrades,
        allowedActions, setAllowedActions, allowedContracts, setAllowedContracts,
        lastDecision, radarStatus, reasoningLog, telemetry, memoryBuffer,
        analysisInterval, setAnalysisInterval,
        chatMessages, isChatLoading, sendMessage,
        resetSession, sessionStats, lockedProfitFloor,
        executeManualDecision: () => activeSymbol && runAnalysisForSymbol(activeSymbol, getCandlesFor(activeSymbol), true),
        resilience, councilStats, runBacktest, backtest, buildBacktestReport: () => buildBacktestReport({ ts: backtest.ts, payoutPct: backtest.payoutPct, assetMeta: backtest.assetMeta, merged: backtest.merged, perAsset: backtest.perAsset }), staleMinutes,
        ollamaConfig, availableModels, updateOllamaConfig, fetchAvailableModels
    };
}
