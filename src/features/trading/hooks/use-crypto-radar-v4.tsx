
// /src/features/trading/hooks/use-crypto-radar-v4.tsx
'use client';

/**
 * @fileOverview QUANT RADAR V4.2 - CRYPTO LAB (SUPREME EDITION)
 * V5: Implementa Ciclo de Vida de Execução, Post-Mortem, Circuit Breaker,
 * Trailing Profit Floor e Motor Polimórfico de Contratos.
 * BTC/ETH Cluster como padrão.
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
  CHAIRMAN: "o CHAIRMAN do conselho: sintetiza a visão técnica de forma executiva",
  MOMENTUM: "o analista QUANT MOMENTUM: força do preço, momentum e velocidade",
  RISK_CRITIC: "o RISK CRITIC: cético, aponta riscos e razões para NÃO operar",
  ARCHIVIST: "o PATTERN ARCHIVIST: memória de trades e padrões passados"
};

const SETTINGS_KEY = 'cryptoLabV4Settings';

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

    // --- 1. CONFIGURAÇÃO DE CLUSTER PADRÃO BTC/ETH ---
    const DEFAULT_CLUSTER = ['cryBTCUSD', 'cryETHUSD'];

    // --- 2. LOGS E TELEMETRIA ---
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

    // --- 3. ESTADOS DE CONTROLE V4.2 ---
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [analysisInterval, setAnalysisInterval] = useState(60); 
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    const [confidenceThreshold, setConfidenceThreshold] = useState(65);

    // GOVERNANÇA V5 (PISO DE LUCRO)
    const [lockedProfitFloor, setLockedProfitFloor] = useState(0);
    const dailyHighWaterMark = useRef(0);

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
    const [allowedContracts, setAllowedContracts] = useState<AllowedContractsV3>({ 'OPTIONS': true, 'ACCUMULATORS': false, 'MULTIPLIERS': true });
    
    // CACHE DE DISPONIBILIDADE DERIV
    const contractsCacheRef = useRef<Record<string, { ts: number, data: any }>>({});

    // BACKTEST RUNNER
    const { backtest, runBacktest } = useBacktestRunner(getHistoricalData);

    // RADAR E MEMÓRIA
    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [radarStatus, setRadarStatus] = useState<Record<string, any>>({});
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    
    const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>({
        baseUrl: "https://boxlike-barrack-silencer.ngrok-free.dev",
        apiKey: "augusto123",
        model: "deepseek-r1:7b",
        temperature: 0.1,
        keepAlive: "5m"
    });
    
    const [availableModels, setAvailableModels] = useState<any[]>([]);

    // REFS PARA ESTABILIDADE
    const activeSymbolRef = useRef(activeSymbol);
    const executionLockRef = useRef(false);
    const scheduleRef = useRef<Record<string, number>>({});
    const lastDecisionBySymbolRef = useRef<Record<string, { ts: number, decision: CouncilDecision }>>({});
    const processedTradesRef = useRef<Set<number>>(new Set());

    useEffect(() => { activeSymbolRef.current = activeSymbol; }, [activeSymbol]);

    // FINANCEIRO REAL-TIME
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

    // --- 4. TRAILING PROFIT FLOOR (GOVERNANÇA V5) ---
    useEffect(() => {
        if (sessionStats.pnl > dailyHighWaterMark.current) {
            dailyHighWaterMark.current = sessionStats.pnl;
        }

        const profitRatio = sessionStats.pnl / dailyTarget;
        
        if (profitRatio >= 0.8) {
            const floor = sessionStats.pnl * 0.5;
            if (floor > lockedProfitFloor) setLockedProfitFloor(floor);
        } else if (profitRatio >= 0.5) {
            if (lockedProfitFloor < 0.01) setLockedProfitFloor(0.01); // Trava no breakeven
        }
    }, [sessionStats.pnl, dailyTarget, lockedProfitFloor]);

    // --- 5. CICLO DE VIDA DE TRADE & POST-MORTEM ---
    useEffect(() => {
        if (!user) return;

        const tradesToProcess = operationsLog.filter(op => 
            op.status !== 'pending' && 
            op.initiator.startsWith('Conselho') && 
            !processedTradesRef.current.has(op.id)
        );

        if (tradesToProcess.length === 0) return;

        tradesToProcess.forEach(async (op) => {
            processedTradesRef.current.add(op.id);
            addLog(`[POST-MORTEM] Trade #${op.id} encerrado: ${op.status.toUpperCase()}. P&L: ${op.result}`, 'info', undefined, op.asset);
            resilience.processResult(op.asset, op.status === 'won');

            try {
                await TradeMemoryManager.addTrade(user.uid, op.asset, {
                    id: String(op.id),
                    timestamp: Date.now(),
                    contract: op.contractType as any,
                    result: op.status === 'won' ? 'WIN' : 'LOSS',
                    pnl: Number(op.result) || 0,
                    rsi: 50,
                    volatilityYangZhang: 0,
                    candlePattern: 'N/A'
                });
            } catch (e) {
                console.warn("[Post-Mortem] Erro:", e);
            }
        });
    }, [operationsLog, user, addLog, resilience]);

    // --- 6. VALIDADOR DE DISPONIBILIDADE DERIV ---
    const validateContractAvailability = async (symbol: string, mode: string): Promise<boolean> => {
        const cached = contractsCacheRef.current[symbol];
        const now = Date.now();
        
        if (cached && now - cached.ts < 300000) { // 5 min cache
            return true; // Simplificado para o protótipo
        }
        
        // Simulação de chamada contracts_for (em um app real seria makeRequest)
        contractsCacheRef.current[symbol] = { ts: now, data: true };
        return true;
    };

    // --- 7. CIRCUIT BREAKER V5 ---
    useEffect(() => {
        if (!isAutoMode) return;

        const hitStopLoss = sessionStats.pnl <= -dailyBalance;
        const hitTarget = sessionStats.pnl >= dailyTarget;
        const hitTrailingFloor = lockedProfitFloor > 0 && sessionStats.pnl < lockedProfitFloor;

        if (hitStopLoss || hitTarget || hitTrailingFloor) {
            setIsAutoMode(false);
            const reason = hitStopLoss ? `STOP LOSS ($${dailyBalance})` : hitTarget ? `META ($${dailyTarget})` : `TRAILING FLOOR ($${lockedProfitFloor.toFixed(2)})`;
            addLog(`[CIRCUIT-BREAKER] Piloto desativado: ${reason}.`, 'error');
            toast({
                title: "⚠️ Circuit Breaker Ativado",
                description: `Proteção financeira acionada: ${reason}`,
                variant: hitStopLoss || hitTrailingFloor ? "destructive" : "default"
            });
        }
    }, [sessionStats.pnl, dailyBalance, dailyTarget, isAutoMode, addLog, toast, lockedProfitFloor]);

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

    const getSmartStake = (symbol: string): number => {
        let stake = stakeValue;
        const lastTrade = operationsLog.find(o => o.asset === symbol && o.initiator.startsWith('Conselho') && o.status !== 'pending');
        
        if (lastTrade && lastTrade.status === 'lost') {
            stake *= 0.5; // Redução de 50% após loss
            addLog(`[SMART-STAKE] Reduzindo risco em ${symbol} após perda recente: $${stake.toFixed(2)}`, 'info', undefined, symbol);
        } else if (lastDecision?.telemetry.consensusEntropy === 0 && lastTrade?.status === 'won') {
            stake *= 1.15; // Setup A+ boost
        }
        
        return Math.max(0.35, Number(stake.toFixed(2)));
    };

    const resetSession = useCallback(() => {
        setIsAutoMode(false);
        setIsShadowMode(true);
        clearActiveContracts();
        setRadarStatus({});
        setReasoningLog([]);
        setChatMessages([]);
        setLockedProfitFloor(0);
        dailyHighWaterMark.current = 0;
        setCouncilStats({ total: 0, call: 0, put: 0, hold: 0, vetoes: 0, fallbacks: 0, avgLatencyMs: 0 });
        scheduleRef.current = {};
        setLastDecision(null);
        processedTradesRef.current.clear();
        toast({ title: "Sessão Reiniciada", description: "O cockpit e os limites de risco foram resetados." });
    }, [clearActiveContracts, toast]);

    const sendMessage = async (content: string, targetAgent: string = 'CHAIRMAN') => {
        if (!content.trim() || !ollamaConfig) return;
        const time = new Date().toLocaleTimeString();
        setChatMessages(prev => [...prev, { role: 'user', content, time }]);
        setIsChatLoading(true);
        try {
            const context = buildShortContext({ sentinel: radarStatus, lastDecisions: lastDecisionBySymbolRef.current, staleMinutes });
            const persona = (AGENT_PERSONAS as any)[targetAgent] || AGENT_PERSONAS.CHAIRMAN;
            const systemPrompt = `Você é ${persona}. Responda em português do Brasil.\n\n${context}`;
            const response = await getOllamaResponse(ollamaConfig, content, [{ role: 'system', content: systemPrompt }, ...chatMessages.slice(-8).map(m => ({ role: m.role, content: m.content }))]);
            if (response.success) setChatMessages(prev => [...prev, { role: 'assistant', content: response.success!, time: new Date().toLocaleTimeString(), agentName: targetAgent }]);
        } catch (error: any) {
            setChatMessages(prev => [...prev, { role: 'assistant', content: `Erro: ${error.message}.`, time: new Date().toLocaleTimeString(), agentName: 'SISTEMA', isError: true }]);
        } finally { setIsChatLoading(false); }
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
                    gravity = calculateBitcoinGravity(
                        { symbol: 'cryBTCUSD', currentPrice: btcCandles[btcCandles.length-1].close, priceHistory: btcCandles.map(c => c.close), rsi: 50, adx: 30, atrNow: 0.001, bbw: 1.0, volatilityRatio: 1, momentumShort: 0, momentumMedium: 0 } as any, 
                        { symbol, currentPrice: candles[candles.length-1].close, priceHistory: candles.map(c => c.close), rsi: baseFeats.rsi, adx: indicators.adx || 30, atrNow: indicators.atr || 0.001, bbw: indicators.bbw || 1.0, volatilityRatio: 1, momentumShort: baseFeats.mom5, momentumMedium: baseFeats.mom15 } as any
                    );
                }
            }

            const cryptoFeats: CryptoSignalFeatures = { ...baseFeats, gravity, vwapDist: baseFeats.bbPos };
            const candidates = evaluateCryptoSignals(symbol, cryptoFeats);
            const topCandidate = candidates.sort((a,b) => b.score - a.score)[0];

            if (!isManual && (!topCandidate || topCandidate.score < 40)) return;

            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);
            const portfolio: PortfolioRiskState = { openPositions: operationsLog.filter(op => op.status === 'pending').length, maxConcurrentPositions: maxConcurrentTrades, totalExposure: operationsLog.filter(op => op.status === 'pending').reduce((s, o) => s + o.stake, 0), maxTotalExposure: dailyBalance, lockedSymbols: new Set() };
            const permissions: AssetExecutionPermission = { symbol, enabled: true, maxStake: stakeValue * 5, allowedContracts: Object.keys(allowedContracts).filter(k => allowedContracts[k as keyof typeof allowedContracts]) as any[], allowedActions: Object.keys(allowedActions).filter(k => allowedActions[k as keyof typeof allowedActions]) as any[] };

            executionLockRef.current = true;
            const decision = await runQuantCouncil({ ...cryptoFeats, symbol, price: candles[candles.length - 1].close, strategicProfile }, buffer, ollamaConfig, isShadowMode, symbol === activeSymbol, permissions, portfolio);
            lastDecisionBySymbolRef.current[symbol] = { ts: Date.now(), decision };

            if (symbol === activeSymbol) { setLastDecision(decision); setTelemetry(decision.telemetry); setMemoryBuffer(buffer); }

            setCouncilStats(prev => ({ total: prev.total + 1, call: prev.call + (decision.finalAction === 'CALL' ? 1 : 0), put: prev.put + (decision.finalAction === 'PUT' ? 1 : 0), hold: prev.hold + (decision.finalAction === 'HOLD' ? 1 : 0), vetoes: prev.vetoes + (decision.executedVia === 'COUNCIL_VETO' ? 1 : 0), fallbacks: prev.fallbacks + (decision.executedVia === 'MATH_FALLBACK' ? 1 : 0), avgLatencyMs: (prev.avgLatencyMs * 0.8) + (decision.t2tLatencyMs * 0.2) }));

            const shouldExecute = isManual || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= confidenceThreshold);

            setRadarStatus(prev => ({ ...prev, [symbol]: { ...decision, gravity, timestamp: Date.now(), isQualified: shouldExecute } }));

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                const finalStake = getSmartStake(symbol);
                if (isShadowMode) {
                    addLog(`[SHADOW] ${symbol}: ${decision.finalAction} simulado.`, 'radar', undefined, symbol);
                } else {
                    let contractToUse = decision.recommendedContract;
                    if (contractToUse === 'OPTIONS') {
                        const is15mAvail = await validateContractAvailability(symbol, 'RISE_FALL_15M');
                        if (!is15mAvail) {
                            addLog(`[POLYMORPHIC FALLBACK] Rise/Fall 15m indisponível para ${symbol}. Convertendo para Multiplier.`, 'warning', undefined, symbol);
                            contractToUse = 'MULTIPLIERS';
                        }
                    }

                    let finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                    const params: Record<string, any> = {};

                    if (contractToUse === 'MULTIPLIERS') {
                        finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN';
                        params.multiplier = multiplier;
                    }

                    const res = await executeTrade(finalContractType, finalStake, symbol, decision.finalAction.toLowerCase() as any, 15, 's', 'Conselho_V4', `V5_${decision.executedVia}`, params);
                    if (res.success) addLog(`[EXEC] ${symbol} ${decision.finalAction} enviado via ${contractToUse}.`, 'execution', undefined, symbol);
                }
            }

        } catch (e: any) { addLog(`Erro V5 em ${symbol}: ${e.message}`, 'error'); } finally { executionLockRef.current = false; }
    }, [isConnected, user, ollamaConfig, isShadowMode, isAutoMode, activeSymbol, operationsLog, confidenceThreshold, strategicProfile, getCandlesFor, addLog, executeTrade, stakeValue, multiplier, dailyBalance, maxConcurrentTrades, allowedContracts, allowedActions, staleMinutes, lastDecision]);

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
        if (isConnected && watchedSymbols.length === 0) setWatchedSymbols(DEFAULT_CLUSTER);
    }, [isConnected, watchedSymbols, setWatchedSymbols, DEFAULT_CLUSTER]);

    useEffect(() => {
        const id = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(id);
    }, [runMultiAssetCycle]);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        strategicProfile, setStrategicProfile,
        confidenceThreshold, setConfidenceThreshold,
        stakeValue, setStakeValue, multiplier, setMultiplier,
        takeProfitPct, setTakeProfitPct, stopLossPct, setStopLossPct,
        dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
        maxConcurrentTrades, setMaxConcurrentTrades,
        allowedActions, setAllowedActions, allowedContracts, setAllowedContracts,
        lastDecision, radarStatus, reasoningLog, telemetry, memoryBuffer,
        analysisInterval, setAnalysisInterval,
        chatMessages, isChatLoading, sendMessage,
        resetSession, sessionStats, lockedProfitFloor,
        executeManualDecision: () => activeSymbol && runAnalysisForSymbol(activeSymbol, getCandlesFor(activeSymbol), true),
        resilience, councilStats, runBacktest, backtest, buildBacktestReport, staleMinutes,
        ollamaConfig, availableModels, updateOllamaConfig, fetchAvailableModels: () => {}
    };
}
