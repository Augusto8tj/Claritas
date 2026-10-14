
// /src/features/trading/hooks/use-crypto-radar-v4.tsx
'use client';

/**
 * @fileOverview QUANT RADAR V4.2 - CRYPTO LAB (SUPREME EDITION)
 * Migração de recursos V3: Backtest, Telemetria, Priority Queue e Stale Data.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi, type AccountType } from './use-deriv-api-v2';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../strategies/v4-crypto-council';
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

export type StrategicProfile = 'conservative' | 'balanced' | 'aggressive';

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

const AGENT_PERSONAS = {
  CHAIRMAN: "o CHAIRMAN do conselho: sintetiza a visão técnica de forma executiva",
  MOMENTUM: "o analista QUANT MOMENTUM: força do preço, momentum e velocidade",
  RISK_CRITIC: "o RISK CRITIC: cético, aponta riscos e razões para NÃO operar",
  ARCHIVIST: "o PATTERN ARCHIVIST: memória de trades e padrões passados"
};

const isOrphanOp = (op: Operation) => {
    const ageMs = Date.now() - new Date(op.timestamp).getTime();
    const isExpired = op.expirationTime && Date.now() > op.expirationTime + 60000;
    const isVeryOld = ageMs > 24 * 3600 * 1000;
    return isExpired || isVeryOld;
};

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

    // --- 1. ESTADOS DE LOG E TELEMETRIA (TOP) ---
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

    // --- 2. ESTADOS DE CONTROLE V4.2 ---
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [analysisInterval, setAnalysisInterval] = useState(60); 
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    const [confidenceThreshold, setConfidenceThreshold] = useState(65);

    // PARAMETROS DE CONTRATO
    const [stakeValue, setStakeValue] = useState(1.0);
    const [multiplier, setMultiplier] = useState(400);
    const [takeProfitPct, setTakeProfitPct] = useState(25);
    const [stopLossPct, setStopLossPct] = useState(50);

    // GOVERNANÇA E RISCO
    const [dailyBalance, setDailyBalance] = useState(100.0);
    const [dailyTarget, setDailyTarget] = useState(50.0);
    const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(3);
    const [allowedActions, setAllowedActions] = useState<AllowedActionsV3>({ 'CALL': true, 'PUT': true });
    const [allowedContracts, setAllowedContracts] = useState<AllowedContractsV3>({ 'OPTIONS': true, 'MULTIPLIERS': true, 'ACCUMULATORS': false });
    
    // BACKTEST RUNNER
    const { backtest, runBacktest } = useBacktestRunner(getHistoricalData);

    // RADAR E MEMÓRIA
    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [radarStatus, setRadarStatus] = useState<Record<string, any>>({});
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig | null>(null);
    const [availableModels, setAvailableModels] = useState<any[]>([]);

    // REFS PARA ESTABILIDADE
    const executionLockRef = useRef(false);
    const scheduleRef = useRef<Record<string, number>>({});
    const lastDecisionBySymbolRef = useRef<Record<string, { ts: number, decision: CouncilDecision }>>({});
    const lastMarketClosedLogRef = useRef<Record<string, number>>({});
    const initializedRef = useRef(false);
    const chatBusyRef = useRef(false);
    const lastSkipLogRef = useRef<Record<string, number>>({});

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

    // --- 4. MODEL MANAGEMENT ---

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

    const updateOllamaConfig = (updates: Partial<OllamaConfig>) => {
        if (!ollamaConfig) return;
        const newConfig = { ...ollamaConfig, ...updates };
        setOllamaConfig(newConfig);
        localStorage.setItem('ollamaConfig', JSON.stringify(newConfig));
    };

    // --- 5. CHAT TÁTICO ---

    const sendMessage = async (content: string, targetAgent: string = 'CHAIRMAN') => {
        if (!content.trim()) return;
        
        const time = new Date().toLocaleTimeString();
        const userMsg: ChatMessage = { role: 'user', content, time };
        setChatMessages(prev => [...prev, userMsg]);

        const REPORT = /(situa[cç][aã]o|status|auditoria|listagem|relat[oó]rio|resumo|quais ativos|que ativos|monitorando|oportunidades?|chances?|vantaj\w*|melhor(es)?|promissor\w*)/i;
        const symbols = Array.from(new Set([...watchedSymbols, activeSymbol].filter(Boolean)));

        if (content.match(REPORT)) {
            setChatMessages(prev => [...prev, { 
                role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                content: buildStatusReport({ 
                    isShadowMode, isAutoMode, accountType, balance: accountBalance.balance || 0, 
                    stats: councilStats, openPositions: operationsLog.filter(o => o.status === 'pending'), 
                    maxConcurrentTrades, sentinel: {}, sentinelCounts: {}, 
                    lastDecisions: lastDecisionBySymbolRef.current, staleMinutes 
                })
            }]);
            return;
        }

        if (!ollamaConfig) {
          setChatMessages(prev => [...prev, { role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(), content: "Ollama não configurado." }]);
          return;
        }

        setIsChatLoading(true);
        chatBusyRef.current = true;
        try {
            const context = buildShortContext({ sentinel: {}, lastDecisions: lastDecisionBySymbolRef.current, staleMinutes });
            const persona = (AGENT_PERSONAS as any)[targetAgent] || AGENT_PERSONAS.CHAIRMAN;
            const systemPrompt = `Você é ${persona} no Crypto Lab V4.2. Responda em português.\n\n${context}\n\nREGRAS: use os dados; seja breve.`;

            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: systemPrompt }, 
                ...chatMessages.slice(-6).map(m => ({ role: m.role, content: m.content }))
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

    // --- 6. MOTOR DE ANÁLISE E CICLOS ---

    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManual: boolean = false) => {
        if (!isConnected || !user || !ollamaConfig || executionLockRef.current) return;
        
        const min = staleMinutes(symbol);
        if (min !== null && min > 2.5) {
            if (Date.now() - (lastMarketClosedLogRef.current[symbol] || 0) > 600000) {
                addLog(`[MERCADO-FECHADO] ${symbol}: defasado há ${Math.round(min)} min.`, 'warning', undefined, symbol);
                lastMarketClosedLogRef.current[symbol] = Date.now();
            }
            return;
        }

        resilience.recordPulse(symbol);

        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            if (!indicators) return;

            const baseFeats = computeSignalFeatures(candles as any);
            if (!baseFeats) return;

            let gravity: BitcoinGravity | null = null;
            if (symbol !== 'cryBTCUSD') {
                const btcCandles = getCandlesFor('cryBTCUSD');
                if (btcCandles.length >= 30) {
                    gravity = calculateBitcoinGravity(btcCandles as any, candles as any);
                }
            }

            const cryptoFeats: CryptoSignalFeatures = { ...baseFeats, gravity };
            const candidates = evaluateCryptoSignals(symbol, cryptoFeats);
            const topCandidate = candidates.sort((a,b) => b.score - a.score)[0];

            if (!isManual && (!topCandidate || topCandidate.score < 40)) return;

            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);

            const snapshot = {
                ...cryptoFeats,
                symbol,
                price: candles[candles.length - 1].close,
                regime: (indicators.adx || 0) > 25 ? 'Trending' : 'Ranging',
                strategicProfile,
                adaptiveRigor: resilience.thresholds[symbol] || 0.65
            };

            const portfolio: PortfolioRiskState = {
                openPositions: operationsLog.filter(op => op.status === 'pending').length,
                maxConcurrentPositions: maxConcurrentTrades,
                totalExposure: operationsLog.filter(op => op.status === 'pending').reduce((s, o) => s + o.stake, 0),
                maxTotalExposure: dailyBalance,
                lockedSymbols: new Set()
            };

            const permissions: AssetExecutionPermission = {
                symbol, enabled: true, maxStake: stakeValue * 5,
                allowedContracts: Object.keys(allowedContracts).filter(k => allowedContracts[k as keyof typeof allowedContracts]) as any[],
                allowedActions: Object.keys(allowedActions).filter(k => allowedActions[k as keyof typeof allowedActions]) as any[]
            };

            executionLockRef.current = true;
            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, symbol === activeSymbol, permissions, portfolio);
            lastDecisionBySymbolRef.current[symbol] = { ts: Date.now(), decision };

            if (symbol === activeSymbol) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
                setMemoryBuffer(buffer);
            }

            setCouncilStats(prev => ({
                total: prev.total + 1,
                call: prev.call + (decision.finalAction === 'CALL' ? 1 : 0),
                put: prev.put + (decision.finalAction === 'PUT' ? 1 : 0),
                hold: prev.hold + (decision.finalAction === 'HOLD' ? 1 : 0),
                vetoes: prev.vetoes + (decision.executedVia === 'COUNCIL_VETO' ? 1 : 0),
                fallbacks: prev.fallbacks + (decision.executedVia === 'MATH_FALLBACK' ? 1 : 0),
                avgLatencyMs: prev.total === 0 ? decision.t2tLatencyMs : (prev.avgLatencyMs * 0.8) + (decision.t2tLatencyMs * 0.2)
            }));

            const shouldExecute = isManual || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= confidenceThreshold);

            setRadarStatus(prev => ({ 
              ...prev, 
              [symbol]: { ...decision, gravity, timestamp: Date.now(), isQualified: shouldExecute } 
            }));

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                if (isShadowMode) {
                    addLog(`[SHADOW] ${symbol}: ${decision.finalAction} simulado.`, 'radar', undefined, symbol);
                } else {
                    let finalContractType = 'CALL';
                    const extraProposalParams: Record<string, any> = {};

                    if (decision.recommendedContract === 'MULTIPLIERS') {
                        finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN';
                        extraProposalParams.multiplier = multiplier;
                    }

                    const tradeDirection: 'rise' | 'fall' = decision.finalAction === 'CALL' ? 'rise' : 'fall';
                    const res = await executeTrade(
                        finalContractType, stakeValue, symbol, tradeDirection, 15, 's', 
                        'Conselho_V4', `V42_${decision.executedVia}`, extraProposalParams
                    );
                    
                    if (res.success) addLog(`[EXEC] ${symbol} ${decision.finalAction} enviado. ID=${res.contractId}`, 'execution', undefined, symbol);
                    else addLog(`[EXEC-FALHA] ${symbol} ${finalContractType}: ${res.message}`, 'error', undefined, symbol);
                }
            }

        } catch (e: any) {
            addLog(`Erro V4.2 em ${symbol}: ${e.message}`, 'error');
        } finally {
            executionLockRef.current = false;
        }
    }, [isConnected, user, ollamaConfig, isShadowMode, isAutoMode, activeSymbol, operationsLog, confidenceThreshold, strategicProfile, getCandlesFor, addLog, executeTrade, resilience, stakeValue, multiplier, dailyBalance, maxConcurrentTrades, allowedContracts, allowedActions, staleMinutes]);

    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || !isConnected) return;
        const now = Date.now();
        const symbols = Array.from(new Set([...watchedSymbols, activeSymbol].filter(Boolean)));
        
        // Fila de Prioridade
        const dueSymbols = symbols.filter(sym => (scheduleRef.current[sym] || 0) <= now);
        
        if (dueSymbols.length > 0) {
            // Prioriza o ativo em foco
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
        if (!initializedRef.current && isConnected) {
            const cryptoDefaults = ['cryBTCUSD', 'cryETHUSD', 'cryLTCUSD', 'cryXRPUSD', 'cryDOGEUSD'];
            setWatchedSymbols(cryptoDefaults);
            initializedRef.current = true;
        }
    }, [isConnected, setWatchedSymbols]);

    useEffect(() => {
        const loadConfig = () => {
            const saved = localStorage.getItem('ollamaConfig');
            if (saved) setOllamaConfig(JSON.parse(saved));
        };
        loadConfig();
        window.addEventListener('storage', loadConfig);
        return () => window.removeEventListener('storage', loadConfig);
    }, []);

    useEffect(() => {
        const id = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(id);
    }, [runMultiAssetCycle]);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        strategicProfile, setStrategicProfile,
        confidenceThreshold, setConfidenceThreshold,
        stakeValue, setStakeValue,
        multiplier, setMultiplier,
        takeProfitPct, setTakeProfitPct,
        stopLossPct, setStopLossPct,
        dailyBalance, setDailyBalance,
        dailyTarget, setDailyTarget,
        maxConcurrentTrades, setMaxConcurrentTrades,
        allowedActions, setAllowedActions,
        allowedContracts, setAllowedContracts,
        lastDecision, radarStatus, reasoningLog, telemetry, memoryBuffer,
        analysisInterval, setAnalysisInterval,
        chatMessages, isChatLoading, sendMessage,
        resetSession: clearActiveContracts,
        executeManualDecision: () => activeSymbol && runAnalysisForSymbol(activeSymbol, getCandlesFor(activeSymbol), true),
        resilience, councilStats,
        runBacktest: (p: number, t: number, e: string[]) => runBacktest([...watchedSymbols, activeSymbol || ''].filter(Boolean).concat(e), p, t),
        backtest, buildBacktestReport: () => buildBacktestReport({ ts: backtest.ts, payoutPct: backtest.payoutPct, assetMeta: backtest.assetMeta, merged: backtest.merged, perAsset: backtest.perAsset }),
        staleMinutes,
        ollamaConfig, availableModels, updateOllamaConfig, fetchAvailableModels, fetchOllamaModels: fetchAvailableModels
    };
}
