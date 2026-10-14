// /src/features/trading/hooks/use-crypto-radar-v4.tsx
'use client';

/**
 * @fileOverview QUANT RADAR V4.2 - CRYPTO LAB (SUPREME EDITION)
 * Migração de Recursos V3: Backtest, Stats do Conselho e Log Avançado.
 * CORREÇÃO: Adicionados estados de dailyBalance e maxConcurrentTrades ausentes.
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
import { buildBacktestReport } from '../services/report-builders';

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

const memoryCache: Record<string, { buffer: TradeMemoryBuffer, ts: number }> = {};

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

    // ESTADOS DE CONTROLE V4.2
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [analysisInterval, setAnalysisInterval] = useState(60); 
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    const [confidenceThreshold, setConfidenceThreshold] = useState(65);
    const [kellyFraction, setKellyFraction] = useState(0.25);

    // PARAMETROS DE CONTRATO
    const [stakeValue, setStakeValue] = useState(1.0);
    const [multiplier, setMultiplier] = useState(400);
    const [takeProfitPct, setTakeProfitPct] = useState(25);
    const [stopLossPct, setStopLossPct] = useState(50);

    // GOVERNANÇA E RISCO (MIGRADO V3)
    const [dailyBalance, setDailyBalance] = useState(100.0);
    const [dailyTarget, setDailyTarget] = useState(50.0);
    const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(3);
    const [allowedActions, setAllowedActions] = useState<AllowedActionsV3>({ 'CALL': true, 'PUT': true });
    const [allowedContracts, setAllowedContracts] = useState<AllowedContractsV3>({ 'OPTIONS': true, 'MULTIPLIERS': true, 'ACCUMULATORS': false });
    
    // STATS E BACKTEST
    const [councilStats, setCouncilStats] = useState<CouncilStats>({ total: 0, call: 0, put: 0, hold: 0, vetoes: 0, fallbacks: 0, avgLatencyMs: 0 });
    const { backtest, runBacktest } = useBacktestRunner(getHistoricalData);

    // TELEMETRIA E LOGS
    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [reasoningLog, setReasoningLog] = useState<LogEntry[]>([]);
    const [telemetry, setTelemetry] = useState<CouncilTelemetry>({ 
        avgTokensPerSec: 0, 
        totalTokens: 0, 
        consensusEntropy: 0, 
        jitterMs: 0, 
        inferenceHealth: 100 
    });
    
    // RADAR E MEMÓRIA
    const [radarStatus, setRadarStatus] = useState<Record<string, any>>({});
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);

    const executionLockRef = useRef(false);
    const scheduleRef = useRef<Record<string, number>>({});
    const lastDecisionBySymbolRef = useRef<Record<string, { ts: number, decision: CouncilDecision }>>({});
    const lastMarketClosedLogRef = useRef<Record<string, number>>({});
    const lastProcessedOpIdRef = useRef<number | null>(null);
    const initializedRef = useRef(false);

    const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig | null>(null);

    // INICIALIZAÇÃO DE ATIVOS CRIPTO PADRÃO
    useEffect(() => {
        if (!initializedRef.current && isConnected) {
            const cryptoDefaults = ['cryBTCUSD', 'cryETHUSD', 'cryLTCUSD', 'cryXRPUSD', 'cryDOGEUSD'];
            // Se o atual for o default de sintéticos ou estiver vazio, define cripto
            const isSyntheticDefault = watchedSymbols.length === 5 && watchedSymbols.includes('1HZ10V');
            if (watchedSymbols.length === 0 || isSyntheticDefault) {
                setWatchedSymbols(cryptoDefaults);
                addLog("Ativos cripto configurados como padrão operacional.", "info");
            }
            initializedRef.current = true;
        }
    }, [isConnected, watchedSymbols, setWatchedSymbols, addLog]);

    useEffect(() => {
        const loadConfig = () => {
            const saved = localStorage.getItem('ollamaConfig');
            if (saved) setOllamaConfig(JSON.parse(saved));
        };
        loadConfig();
        window.addEventListener('storage', loadConfig);
        return () => window.removeEventListener('storage', loadConfig);
    }, []);

    const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', details?: string[], symbol?: string) => {
        setReasoningLog(prev => [{
            ts: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
            time: new Date().toLocaleTimeString(),
            message, type, details, symbol
        }, ...prev].slice(0, 300));
    }, []);

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

    const getBufferedMemory = async (uid: string, symbol: string): Promise<TradeMemoryBuffer> => {
        const now = Date.now();
        const cached = memoryCache[symbol];
        if (cached && now - cached.ts < 60000) return cached.buffer;

        const buffer = await TradeMemoryManager.getBuffer(uid, symbol);
        memoryCache[symbol] = { buffer, ts: now };
        return buffer;
    };

    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManual: boolean = false) => {
        if (!isConnected || !user || !ollamaConfig) return;
        
        const min = staleMinutes(symbol);
        if (min !== null && min > 2.5) {
            const now = Date.now();
            if (now - (lastMarketClosedLogRef.current[symbol] || 0) > 600000) {
                addLog(`[SKIP] ${symbol}: mercado defasado (${Math.round(min)} min).`, 'warning', undefined, symbol);
                lastMarketClosedLogRef.current[symbol] = now;
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
                    gravity = calculateBitcoinGravity(btcCandles, candles);
                }
            }

            const cryptoFeats: CryptoSignalFeatures = { ...baseFeats, gravity };
            const candidates = evaluateCryptoSignals(symbol, cryptoFeats);
            const topCandidate = candidates.sort((a,b) => b.score - a.score)[0];

            if (!isManual && (!topCandidate || topCandidate.score < 40)) return;

            const buffer = await getBufferedMemory(user.uid, symbol);

            const snapshot = {
                ...cryptoFeats,
                symbol,
                price: candles[candles.length - 1].close,
                regime: (indicators.adx || 0) > 25 ? 'Trending' : 'Ranging',
                strategicProfile,
                adaptiveRigor: resilience.thresholds[symbol] || 0.65
            };

            const nonOrphanOps = operationsLog.filter(op => !isOrphanOp(op));
            const portfolio: PortfolioRiskState = {
                openPositions: nonOrphanOps.filter(op => op.status === 'pending').length,
                maxConcurrentPositions: maxConcurrentTrades,
                totalExposure: nonOrphanOps.filter(op => op.status === 'pending').reduce((s, o) => s + o.stake, 0),
                maxTotalExposure: dailyBalance,
                lockedSymbols: new Set()
            };

            const permissions: AssetExecutionPermission = {
                symbol, enabled: true, maxStake: stakeValue * 5,
                allowedContracts: Object.keys(allowedContracts).filter(k => allowedContracts[k as keyof typeof allowedContracts]) as any[],
                allowedActions: Object.keys(allowedActions).filter(k => allowedActions[k as keyof typeof allowedActions]) as any[]
            };

            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, symbol === activeSymbol, permissions, portfolio);
            lastDecisionBySymbolRef.current[symbol] = { ts: Date.now(), decision };

            const { finalAction: action, consensusConfidence: conf, executedVia: via, t2tLatencyMs: lat } = decision;

            if (symbol === activeSymbol) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
                setMemoryBuffer(buffer);
            }

            setCouncilStats(prev => ({
                total: prev.total + 1,
                call: prev.call + (action === 'CALL' ? 1 : 0),
                put: prev.put + (action === 'PUT' ? 1 : 0),
                hold: prev.hold + (action === 'HOLD' ? 1 : 0),
                vetoes: prev.vetoes + (via === 'COUNCIL_VETO' ? 1 : 0),
                fallbacks: prev.fallbacks + (via === 'MATH_FALLBACK' ? 1 : 0),
                avgLatencyMs: prev.total === 0 ? lat : (prev.avgLatencyMs * 0.8) + (lat * 0.2)
            }));

            addLog(`[CONSELHO] ${symbol}: ${action} ${conf}% | via=${via} | ${lat}ms`, 'decision', undefined, symbol);

            const shouldExecute = isManual || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= confidenceThreshold);

            setRadarStatus(prev => ({ 
              ...prev, 
              [symbol]: { 
                ...decision, 
                gravity, 
                timestamp: Date.now(), 
                isQualified: shouldExecute,
                isStale: min !== null && min > 2.5,
                staleMin: Math.round(min || 0)
              } 
            }));

            if (shouldExecute && action !== 'HOLD') {
                if (isShadowMode) {
                    addLog(`[SHADOW] ${symbol}: ${action} simulado.`, 'radar', undefined, symbol);
                } else {
                    let finalContractType = 'CALL';
                    const extraProposalParams: Record<string, any> = {};

                    if (decision.recommendedContract === 'MULTIPLIERS') {
                        finalContractType = action === 'CALL' ? 'MULTUP' : 'MULTDOWN';
                        extraProposalParams.multiplier = multiplier;
                    }

                    const tradeDirection: 'rise' | 'fall' = action === 'CALL' ? 'rise' : 'fall';
                    const res = await executeTrade(
                        finalContractType, stakeValue, symbol, tradeDirection, 15, 's', 
                        'Conselho_V4', `V42_${decision.executedVia}`, extraProposalParams
                    );
                    
                    if (res.success) addLog(`[EXEC] ${symbol} ${action} enviado. ID=${res.contractId}`, 'execution', undefined, symbol);
                    else addLog(`[EXEC-FALHA] ${symbol} ${finalContractType}: ${res.message}`, 'error', undefined, symbol);
                }
            }

        } catch (e: any) {
            addLog(`Erro V4.2 em ${symbol}: ${e.message}`, 'error');
        }
    }, [isConnected, user, ollamaConfig, isShadowMode, isAutoMode, activeSymbol, operationsLog, confidenceThreshold, strategicProfile, getCandlesFor, addLog, executeTrade, resilience, stakeValue, multiplier, takeProfitPct, stopLossPct, allowedActions, allowedContracts, dailyBalance, maxConcurrentTrades, staleMinutes]);

    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || !isConnected) return;
        executionLockRef.current = true;

        try {
            const now = Date.now();
            const symbols = Array.from(new Set([...watchedSymbols, activeSymbol].filter(Boolean)));
            const dueSymbols = symbols.filter(sym => (scheduleRef.current[sym] || 0) <= now);
            
            if (dueSymbols.length > 0) {
                dueSymbols.sort((a, b) => (a === activeSymbol ? -1 : (b === activeSymbol ? 1 : 0)));
                const queue = [...dueSymbols];
                while (queue.length > 0) {
                  const chunk = queue.splice(0, 1); // Sequencial para proteger Ollama
                  await Promise.all(chunk.map(async (sym) => {
                      const candles = getCandlesFor(sym);
                      if (candles.length >= 30) {
                          await runAnalysisForSymbol(sym, candles);
                          scheduleRef.current[sym] = Date.now() + (sym === activeSymbol ? 15 : analysisInterval) * 1000;
                      }
                  }));
                }
            }
        } finally {
            executionLockRef.current = false;
        }
    }, [isConnected, watchedSymbols, activeSymbol, analysisInterval, getCandlesFor, runAnalysisForSymbol]);

    useEffect(() => {
        const id = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(id);
    }, [runMultiAssetCycle]);

    return {
        isAutoMode, setIsAutoMode: (v: boolean) => setIsAutoMode(v),
        toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, setIsShadowMode: (v: boolean) => setIsShadowMode(v),
        toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        strategicProfile, setStrategicProfile,
        confidenceThreshold, setConfidenceThreshold,
        stakeValue, setStakeValue,
        multiplier, setMultiplier,
        takeProfitPct, setTakeProfitPct,
        stopLossPct, setStopLossPct,
        kellyFraction, setKellyFraction,
        dailyBalance, setDailyBalance,
        dailyTarget, setDailyTarget,
        maxConcurrentTrades, setMaxConcurrentTrades,
        allowedActions, setAllowedActions,
        allowedContracts, setAllowedContracts,
        lastDecision, radarStatus, reasoningLog, telemetry, memoryBuffer,
        analysisInterval, setAnalysisInterval,
        chatMessages, isChatLoading, sendMessage: async (content: string) => {}, 
        resetSession: clearActiveContracts,
        executeManualDecision: () => activeSymbol && runAnalysisForSymbol(activeSymbol, getCandlesFor(activeSymbol), true),
        resilience, councilStats,
        runBacktest: (p: number, t: number, e: string[]) => runBacktest([...watchedSymbols, activeSymbol || ''].filter(Boolean).concat(e), p, t),
        backtest, buildBacktestReport: () => buildBacktestReport({ ts: backtest.ts, payoutPct: backtest.payoutPct, assetMeta: backtest.assetMeta, merged: backtest.merged, perAsset: backtest.perAsset }),
        staleMinutes
    };
}
