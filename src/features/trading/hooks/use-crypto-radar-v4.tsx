// /src/features/trading/hooks/use-crypto-radar-v4.tsx
'use client';

/**
 * @fileOverview QUANT RADAR V4.2 - CRYPTO LAB (SUPREME EDITION)
 * Upgrade: Parâmetros de Contrato Definidos pelo Usuário e Governança Granular.
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

const memoryCache: Record<string, { buffer: TradeMemoryBuffer, ts: number }> = {};

export function useCryptoRadarV4(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { 
        isConnected, executeTrade, operationsLog, accountBalance, 
        watchedSymbols, multiAssetCandles, 
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
    const [kellyFraction, setKellyFraction] = useState(0.25);

    // PARAMETROS DE CONTRATO (DEFINIDOS PELO USUÁRIO)
    const [stakeValue, setStakeValue] = useState(1.0); // Mínimo $1.00 para cry*
    const [multiplier, setMultiplier] = useState(400);
    const [takeProfitPct, setTakeProfitPct] = useState(25); // 25% de lucro alvo
    const [stopLossPct, setStopLossPct] = useState(50);     // 50% de stop loss

    // GOVERNANÇA GRANULAR
    const [allowedActions, setAllowedActions] = useState<AllowedActionsV3>({ 'CALL': true, 'PUT': true });
    const [allowedContracts, setAllowedContracts] = useState<AllowedContractsV3>({ 'OPTIONS': true, 'MULTIPLIERS': true, 'ACCUMULATORS': false });

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
        
        resilience.recordPulse(symbol);

        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            if (!indicators) return;

            const baseFeats = computeSignalFeatures(candles as any);
            if (!baseFeats) return;

            // 1. GRAVIDADE BITCOIN V2
            let gravity: BitcoinGravity | null = null;
            if (symbol !== 'cryBTCUSD') {
                const btcCandles = getCandlesFor('cryBTCUSD');
                if (btcCandles.length >= 30) {
                    gravity = calculateBitcoinGravity(btcCandles, candles);
                }
            }

            const cryptoFeats: CryptoSignalFeatures = { ...baseFeats, gravity };
            
            // 2. SENTINEL PIPELINE
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
                maxTotalExposure: dailyBalance,
                lockedSymbols: new Set()
            };

            const permissions: AssetExecutionPermission = {
                symbol, enabled: true, maxStake: stakeValue * 5,
                allowedContracts: Object.keys(allowedContracts).filter(k => allowedContracts[k as keyof typeof allowedContracts]) as any[],
                allowedActions: Object.keys(allowedActions).filter(k => allowedActions[k as keyof typeof allowedActions]) as any[]
            };

            // 5. EXECUÇÃO DO CONSELHO PARALELO
            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, symbol === activeSymbol, permissions, portfolio);
            lastDecisionBySymbolRef.current[symbol] = { ts: Date.now(), decision };

            const shouldExecute = isManual || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= confidenceThreshold);

            setRadarStatus(prev => ({ 
              ...prev, 
              [symbol]: { 
                ...decision, 
                gravity, 
                timestamp: Date.now(), 
                isQualified: shouldExecute 
              } 
            }));
            
            if (symbol === activeSymbol) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
                setMemoryBuffer(buffer);
            }

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                if (isShadowMode) {
                    addLog(`[SHADOW] ${symbol}: ${decision.finalAction} simulado com sucesso.`, 'radar', undefined, symbol);
                } else {
                    let finalContractType = 'CALL';
                    const extraProposalParams: Record<string, any> = {};

                    switch (decision.recommendedContract) {
                        case 'ACCUMULATORS': 
                            finalContractType = 'ACCU'; 
                            break;
                        case 'MULTIPLIERS': 
                            finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN'; 
                            extraProposalParams.multiplier = multiplier;
                            extraProposalParams.take_profit = parseFloat((stakeValue * (takeProfitPct / 100)).toFixed(2));
                            extraProposalParams.stop_loss = parseFloat((stakeValue * (stopLossPct / 100)).toFixed(2));
                            break;
                        default: 
                            finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
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
        }
    }, [isConnected, user, ollamaConfig, isShadowMode, isAutoMode, activeSymbol, operationsLog, confidenceThreshold, strategicProfile, getCandlesFor, addLog, executeTrade, resilience, stakeValue, multiplier, takeProfitPct, stopLossPct, allowedActions, allowedContracts, dailyBalance]);

    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || !isConnected) return;
        executionLockRef.current = true;

        try {
            const now = Date.now();
            const symbols = Array.from(new Set([...watchedSymbols, activeSymbol].filter(Boolean)));
            
            const dueSymbols = symbols.filter(sym => (scheduleRef.current[sym] || 0) <= now);
            
            if (dueSymbols.length > 0) {
                // Concorrência Limitada (Max 2 simultâneos)
                const queue = [...dueSymbols];
                while (queue.length > 0) {
                  const chunk = queue.splice(0, 2);
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
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        strategicProfile, setStrategicProfile,
        confidenceThreshold, setConfidenceThreshold,
        stakeValue, setStakeValue,
        multiplier, setMultiplier,
        takeProfitPct, setTakeProfitPct,
        stopLossPct, setStopLossPct,
        kellyFraction, setKellyFraction,
        allowedActions, setAllowedActions,
        allowedContracts, setAllowedContracts,
        lastDecision, radarStatus, reasoningLog, telemetry, memoryBuffer,
        analysisInterval, setAnalysisInterval,
        chatMessages, isChatLoading, sendMessage: async (content: string) => {}, 
        resetSession: clearActiveContracts,
        executeManualDecision: () => activeSymbol && runAnalysisForSymbol(activeSymbol, getCandlesFor(activeSymbol), true),
        resilience
    };
}
