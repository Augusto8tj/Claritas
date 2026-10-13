'use client';

/**
 * @fileOverview QUANT RADAR V4.2 - CRYPTO LAB (SUPREME EDITION)
 * 
 * INCREMENTOS CONSOLIDADOS:
 * 1. Do V3.9.6: Conselho de 3 Agentes (Momentum, Risk, Archivist) + Memória Tática.
 * 2. Do V2.6: Execução Polimórfica (Seleciona entre ACCU, MULT e OPT).
 * 3. Do Neuro-Adaptativo: Perfis de Risco (Conservative/Aggressive).
 * 4. V4.2 Core: Concorrência de Varredura e Gravidade de Bitcoin.
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

    // ESTADOS DE CONTROLE V4.2
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [analysisInterval, setAnalysisInterval] = useState(60); 
    const [strategicProfile, setStrategicProfile] = useState<StrategicProfile>('balanced');
    const [confidenceThreshold, setConfidenceThreshold] = useState(65);

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

    const ollamaConfig = useMemo(() => {
        if (typeof window === 'undefined') return null;
        const saved = localStorage.getItem('ollamaConfig');
        return saved ? JSON.parse(saved) : null;
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

    // --- CICLO DE ANÁLISE CONCORRENTE V4.2 ---
    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManual: boolean = false) => {
        if (!isConnected || !user || !ollamaConfig) return;

        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            if (!indicators) return;

            const baseFeats = computeSignalFeatures(candles as any);
            if (!baseFeats) return;

            // GRAVIDADE BITCOIN (CORREÇÃO LÍDER)
            let gravity: BitcoinGravity | null = null;
            if (symbol.startsWith('cry')) {
                const btcCandles = getCandlesFor('cryBTCUSD');
                if (btcCandles.length >= 30) {
                    gravity = calculateBitcoinGravity(btcCandles, candles);
                }
            }

            const cryptoFeats: CryptoSignalFeatures = { ...baseFeats, gravity };
            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);

            // Payload estendido para o Conselho (Simulando V3 + V2.5)
            const snapshot = {
                ...cryptoFeats,
                symbol,
                price: candles[candles.length - 1].close,
                regime: (indicators.adx || 0) > 25 ? 'Trending' : 'Ranging',
                strategicProfile
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

            // VETO QUALITATIVO V4.2 (Baseado no Bitcoin)
            if (gravity?.isBtcExploding && decision.finalAction !== 'HOLD') {
                const isDivergent = (gravity.btcVector === 'BULL_DRAG' && decision.finalAction === 'PUT') || 
                                    (gravity.btcVector === 'BEAR_DRAG' && decision.finalAction === 'CALL');
                
                if (isDivergent) {
                    decision.finalAction = 'HOLD';
                    decision.holdReason = `VETO-CORRELAÇÃO: Bitcoin explodindo em direção oposta.`;
                    decision.executedVia = 'COUNCIL_VETO';
                }
            }

            setRadarStatus(prev => ({ ...prev, [symbol]: { ...decision, gravity, timestamp: Date.now() } }));
            
            if (symbol === activeSymbol) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
                setMemoryBuffer(buffer);
            }

            addLog(`[V4.2] ${symbol}: ${decision.finalAction} ${decision.consensusConfidence}% | ${decision.recommendedContract}`, 'decision', undefined, symbol);

            // LOGICA DE EXECUÇÃO REAL/SOMBRA
            const shouldExecute = isManual || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= confidenceThreshold);
            if (shouldExecute) {
                if (isShadowMode) {
                    addLog(`[SHADOW] ${symbol}: ${decision.finalAction} simulado.`, 'radar', undefined, symbol);
                } else {
                    let finalContractType = 'CALL';
                    switch (decision.recommendedContract) {
                        case 'ACCUMULATORS': finalContractType = 'ACCU'; break;
                        case 'MULTIPLIERS': finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN'; break;
                        default: finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                    }
                    await executeTrade(finalContractType, 1.0, symbol, decision.finalAction.toLowerCase() as any, 15, 's', 'Conselho_V4', `V42_${decision.executedVia}`);
                }
            }

        } catch (e: any) {
            addLog(`Erro V4.2 em ${symbol}: ${e.message}`, 'error');
        }
    }, [isConnected, user, ollamaConfig, isShadowMode, isAutoMode, activeSymbol, operationsLog, confidenceThreshold, strategicProfile, getCandlesFor, addLog, executeTrade]);

    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || !isConnected) return;
        executionLockRef.current = true;

        const now = Date.now();
        const symbols = Array.from(new Set([...watchedSymbols, activeSymbol].filter(Boolean)));
        const dueSymbols = symbols.filter(sym => (scheduleRef.current[sym] || 0) <= now);
        
        if (dueSymbols.length > 0) {
            // Processamento concorrente para eliminar latência de hardware
            await Promise.all(dueSymbols.map(async (sym) => {
                const candles = getCandlesFor(sym);
                if (candles.length >= 30) {
                    scheduleRef.current[sym] = now + (sym === activeSymbol ? 15 : analysisInterval) * 1000;
                    return runAnalysisForSymbol(sym, candles);
                }
            }));
        }

        executionLockRef.current = false;
    }, [isConnected, watchedSymbols, activeSymbol, analysisInterval, getCandlesFor, runAnalysisForSymbol]);

    useEffect(() => {
        const id = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(id);
    }, [runMultiAssetCycle]);

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
        lastDecision, radarStatus, reasoningLog, telemetry, memoryBuffer,
        analysisInterval, setAnalysisInterval,
        chatMessages, isChatLoading, sendMessage,
        resetSession: clearActiveContracts,
        executeManualDecision: () => activeSymbol && runAnalysisForSymbol(activeSymbol, getCandlesFor(activeSymbol), true)
    };
}
