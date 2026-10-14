// /src/features/trading/hooks/use-crypto-radar-v4.tsx
'use client';

/**
 * @fileOverview QUANT RADAR V4.2 - CRYPTO LAB (SUPREME EDITION)
 * Upgrade V4.2: Concorrência de Varredura, Gravidade V2 e Resiliência.
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
import { CouncilDecision, TradeMemoryBuffer, CouncilTelemetry, AssetExecutionPermission, PortfolioRiskState } from '../types/council';
import { computeSignalFeatures } from '../services/signal-engine';
import { evaluateCryptoSignals, type CryptoSignalFeatures } from '../services/crypto-signal-engine';
import { calculateBitcoinGravity, type BitcoinGravity } from '../services/crypto-gravity-engine';
import { useAdaptiveResilience } from '@/hooks/useAdaptiveResilience';
import { getOllamaResponse } from '@/app/actions';

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

// Cache em memória para o TradeMemoryBuffer (TTL 60s)
const memoryCache: Record<string, { buffer: TradeMemoryBuffer, ts: number }> = {};

export function useCryptoRadarV4(
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
    const resilience = useAdaptiveResilience();

    // ESTADOS DE CONTROLE V4.2
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [analysisInterval, setAnalysisInterval] = useState(60); 
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    const [confidenceThreshold, setConfidenceThreshold] = useState(65);

    // FINANCEIRO V4.2
    const [stakeValue, setStakeValue] = useState(1.0);

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

    // REFS INSTITUCIONAIS
    const executionLockRef = useRef(false);
    const scheduleRef = useRef<Record<string, number>>({});
    const lastDecisionBySymbolRef = useRef<Record<string, { ts: number, decision: CouncilDecision }>>({});
    const lastProcessedOpIdRef = useRef<number | null>(null);

    // Ollama Config Reativo
    const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig | null>(null);

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

    const getBufferedMemory = async (uid: string, symbol: string): Promise<TradeMemoryBuffer> => {
        const now = Date.now();
        const cached = memoryCache[symbol];
        if (cached && now - cached.ts < 60000) return cached.buffer;

        const buffer = await TradeMemoryManager.getBuffer(uid, symbol);
        memoryCache[symbol] = { buffer, ts: now };
        return buffer;
    };

    // --- CICLO DE ANÁLISE CONCORRENTE V4.2 ---
    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManual: boolean = false) => {
        if (!isConnected || !user || !ollamaConfig) return;
        
        // Registro de Pulsação para Resiliência
        resilience.recordPulse(symbol);

        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            if (!indicators) return;

            const baseFeats = computeSignalFeatures(candles as any);
            if (!baseFeats) return;

            // GRAVIDADE BITCOIN V2
            let gravity: BitcoinGravity | null = null;
            if (symbol.startsWith('cry') && symbol !== 'cryBTCUSD') {
                const btcCandles = getCandlesFor('cryBTCUSD');
                if (btcCandles.length >= 30) {
                    gravity = calculateBitcoinGravity(btcCandles, candles);
                }
            }

            const cryptoFeats: CryptoSignalFeatures = { ...baseFeats, gravity };
            
            // Sentinel Pipeline
            const candidates = evaluateCryptoSignals(symbol, cryptoFeats);
            const topCandidate = candidates.sort((a,b) => b.score - a.score)[0];

            // Só consulta o Conselho se houver candidato viável ou gatilho manual
            if (!isManual && (!topCandidate || topCandidate.score < 40)) {
                return;
            }

            const buffer = await getBufferedMemory(user.uid, symbol);

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
                maxConcurrentPositions: 5,
                totalExposure: operationsLog.filter(op => op.status === 'pending').reduce((s, o) => s + o.stake, 0),
                maxTotalExposure: 100,
                lockedSymbols: new Set()
            };

            const permissions: AssetExecutionPermission = {
                symbol, enabled: true, maxStake: 10,
                allowedContracts: ['OPTIONS', 'MULTIPLIERS', 'ACCUMULATORS'],
                allowedActions: ['CALL', 'PUT']
            };

            // EXECUÇÃO DO CONSELHO PARALELO
            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, symbol === activeSymbol, permissions, portfolio);
            lastDecisionBySymbolRef.current[symbol] = { ts: Date.now(), decision };

            // VETO QUALITATIVO V4.2 (Gravidade de Bitcoin)
            if (gravity?.btcImpulseDir && decision.finalAction !== 'HOLD' && decision.recommendedContract === 'MULTIPLIERS') {
                const isDivergent = (gravity.btcImpulseDir === 'UP' && decision.finalAction === 'PUT') || 
                                    (gravity.btcImpulseDir === 'DOWN' && decision.finalAction === 'CALL');
                
                if (isDivergent) {
                    decision.finalAction = 'HOLD';
                    decision.holdReason = `VETO-CORRELAÇÃO: Bitcoin explodindo contra Altcoin.`;
                    decision.executedVia = 'COUNCIL_VETO';
                    decision.stakeRatio = 0;
                }
            }

            setRadarStatus(prev => ({ ...prev, [symbol]: { ...decision, gravity, timestamp: Date.now(), isQualified: decision.finalAction !== 'HOLD' && decision.consensusConfidence >= confidenceThreshold } }));
            
            if (symbol === activeSymbol) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
                setMemoryBuffer(buffer);
            }

            // GATES DE RESILIÊNCIA E COORDENAÇÃO
            const isStable = resilience.checkStability(symbol);
            const passesAdaptiveThreshold = resilience.validateExecution(symbol, decision.consensusConfidence);
            
            const shouldExecute = isManual || (isAutoMode && decision.finalAction !== 'HOLD' && passesAdaptiveThreshold && isStable);

            if (shouldExecute) {
                if (isShadowMode) {
                    addLog(`[SHADOW] ${symbol}: ${decision.finalAction} ${decision.recommendedContract}`, 'radar', undefined, symbol);
                } else {
                    let finalContractType = 'CALL';
                    switch (decision.recommendedContract) {
                        case 'ACCUMULATORS': finalContractType = 'ACCU'; break;
                        case 'MULTIPLIERS': finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN'; break;
                        default: finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                    }
                    await executeTrade(finalContractType, stakeValue, symbol, decision.finalAction.toLowerCase() as any, 15, 's', 'Conselho_V4', `V42_${decision.executedVia}`);
                }
            }

        } catch (e: any) {
            addLog(`Erro V4.2 em ${symbol}: ${e.message}`, 'error');
        }
    }, [isConnected, user, ollamaConfig, isShadowMode, isAutoMode, activeSymbol, operationsLog, confidenceThreshold, strategicProfile, getCandlesFor, addLog, executeTrade, resilience, stakeValue]);

    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || !isConnected) return;
        executionLockRef.current = true;

        try {
            const now = Date.now();
            const symbols = Array.from(new Set([...watchedSymbols, activeSymbol].filter(Boolean)));
            const dueSymbols = symbols.filter(sym => (scheduleRef.current[sym] || 0) <= now);
            
            if (dueSymbols.length > 0) {
                await Promise.all(dueSymbols.map(async (sym) => {
                    const candles = getCandlesFor(sym);
                    if (candles.length >= 30) {
                        const decision = await runAnalysisForSymbol(sym, candles);
                        if (decision) {
                            scheduleRef.current[sym] = now + (sym === activeSymbol ? 15 : analysisInterval) * 1000;
                        }
                    }
                }));
            }
        } finally {
            executionLockRef.current = false;
        }
    }, [isConnected, watchedSymbols, activeSymbol, analysisInterval, getCandlesFor, runAnalysisForSymbol]);

    useEffect(() => {
        const id = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(id);
    }, [runMultiAssetCycle]);

    // Registro de Trades no MemoryBuffer
    useEffect(() => {
        const lastTrade = operationsLog.find(op => op.status !== 'pending' && op.initiator.includes('V4'));
        if (lastTrade && lastTrade.id !== lastProcessedOpIdRef.current) {
            lastProcessedOpIdRef.current = lastTrade.id;
            const isWin = lastTrade.status === 'won';
            resilience.processResult(lastTrade.asset, isWin);
            
            if (user) {
                TradeMemoryManager.addTrade(user.uid, lastTrade.asset, {
                    id: String(lastTrade.id),
                    timestamp: Date.now(),
                    contract: lastTrade.contractType as any,
                    result: isWin ? 'WIN' : 'LOSS',
                    pnl: lastTrade.result || 0,
                    rsi: 50, // Simplificação
                    volatilityYangZhang: 1.0,
                    candlePattern: 'N/A'
                });
                delete memoryCache[lastTrade.asset];
            }
        }
    }, [operationsLog, resilience, user]);

    const sendMessage = async (content: string) => {
        if (!ollamaConfig || !content.trim()) return;
        setIsChatLoading(true);
        const userMsg: ChatMessage = { role: 'user', content, time: new Date().toLocaleTimeString() };
        setChatMessages(prev => [...prev, userMsg]);

        try {
            const context = `CONTEXTO V4.2: BTC=${radarStatus['cryBTCUSD']?.gravity?.btcVector || 'N/A'}. PnL=$${operationsLog.reduce((s,o)=>s+(o.result||0),0).toFixed(2)}`;
            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: `Você é o conselho do Crypto Lab V4.2. Responda tecnicamente. ${context}` },
                ...chatMessages.map(m => ({ role: m.role, content: m.content }))
            ]);
            if (response.success) {
                setChatMessages(prev => [...prev, { role: 'assistant', content: response.success!, time: new Date().toLocaleTimeString(), agentName: 'CHAIRMAN' }]);
            }
        } finally {
            setIsChatLoading(false);
        }
    };

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        strategicProfile, setStrategicProfile,
        confidenceThreshold, setConfidenceThreshold,
        stakeValue, setStakeValue,
        lastDecision, radarStatus, reasoningLog, telemetry, memoryBuffer,
        analysisInterval, setAnalysisInterval,
        chatMessages, isChatLoading, sendMessage,
        resetSession: clearActiveContracts,
        executeManualDecision: () => activeSymbol && runAnalysisForSymbol(activeSymbol, getCandlesFor(activeSymbol), true),
        resilience
    };
}
