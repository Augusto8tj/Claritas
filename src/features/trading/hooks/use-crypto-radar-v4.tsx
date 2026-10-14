// /src/features/trading/hooks/use-crypto-radar-v4.tsx
'use client';

/**
 * @fileOverview QUANT RADAR V4.2 - CRYPTO LAB (SUPREME EDITION)
 * Upgrade V4.2/V5: Concorrência com Fila de Prioridade, Go-Live Gate e Event Study.
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
import { CouncilDecision, TradeMemoryBuffer, CouncilTelemetry, AssetExecutionPermission, PortfolioRiskState, CryptoShadowTrade } from '../types/council';
import { computeSignalFeatures } from '../services/signal-engine';
import { evaluateCryptoSignals, type CryptoSignalFeatures } from '../services/crypto-signal-engine';
import { calculateBitcoinGravity, type BitcoinGravity } from '../services/crypto-gravity-engine';
import { useAdaptiveResilience } from '@/hooks/useAdaptiveResilience';
import { getOllamaResponse } from '@/app/actions';
import { getRuleEdgeStats } from '../services/edge-report-service';
import { CryptoShadowEngine } from '../services/crypto-shadow-engine';
import { evaluateGoLiveGate, type GoLiveStatus } from '../services/go-live-gate';
import { EventStudyService } from '../services/event-study-service';

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
        watchedSymbols, setWatchedSymbols, multiAssetCandles, 
        clearActiveContracts, accountType, setAccountType,
        botCandleData, getContractsFor, getProposal
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

    // FINANCEIRO V4.2
    const [stakeValue, setStakeValue] = useState(1.0);
    const [contractsFor, setContractsFor] = useState<Record<string, any>>({});
    const [goLiveGates, setGoLiveGates] = useState<Record<string, GoLiveStatus>>({});

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
    const lastProcessedOpIdRef = useRef<number | null>(null);

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

    // --- CICLO DE ANÁLISE CONCORRENTE V4.2/V5 ---
    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManual: boolean = false) => {
        if (!isConnected || !user || !ollamaConfig) return;
        
        resilience.recordPulse(symbol);

        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            if (!indicators) return;

            const baseFeats = computeSignalFeatures(candles as any);
            if (!baseFeats) return;

            // 1. GRAVIDADE BITCOIN V2 & EVENT STUDY
            let gravity: BitcoinGravity | null = null;
            if (symbol !== 'cryBTCUSD') {
                const btcCandles = getCandlesFor('cryBTCUSD');
                if (btcCandles.length >= 30) {
                    gravity = calculateBitcoinGravity(btcCandles, candles);
                    
                    // Fase 5: Event Study Capture
                    if (gravity.isBtcExploding) {
                        EventStudyService.recordImpulseEvent(user.uid, {
                            symbol, btcZScore: gravity.zImpulse, 
                            btcDirection: gravity.btcImpulseDir || 'UP',
                            timestamp: Date.now(),
                            altPriceT0: candles[candles.length - 1].close,
                            horizons: [5, 15, 30, 60, 120].map(s => ({ seconds: s }))
                        });
                    }
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

            // 3. EDGE STATS & GO-LIVE GATE
            const edgeStats = await getRuleEdgeStats(user.uid, topCandidate?.rule || 'NONE', gravity?.btcVector || 'NONE', symbol);
            const breakeven = 1 / (1 + 0.95); 
            
            const gateStatus = evaluateGoLiveGate(edgeStats, breakeven);
            setGoLiveGates(prev => ({ ...prev, [`${symbol}_${topCandidate?.rule}`]: gateStatus }));

            const buffer = await getBufferedMemory(user.uid, symbol);

            const snapshot = {
                ...cryptoFeats,
                symbol,
                price: candles[candles.length - 1].close,
                regime: (indicators.adx || 0) > 25 ? 'Trending' : 'Ranging',
                strategicProfile,
                adaptiveRigor: resilience.thresholds[symbol] || 0.65,
                edge: edgeStats
            };

            const portfolio: PortfolioRiskState = {
                openPositions: operationsLog.filter(op => op.status === 'pending').length,
                maxConcurrentPositions: 5,
                totalExposure: operationsLog.filter(op => op.status === 'pending').reduce((s, o) => s + o.stake, 0),
                maxTotalExposure: dailyBalance,
                lockedSymbols: new Set()
            };

            // 4. VERIFICAÇÃO DE CONTRATOS REAIS
            let availableContracts = contractsFor[symbol];
            if (!availableContracts) {
                const res = await getContractsFor(symbol);
                if (res.contracts_for) {
                  availableContracts = res.contracts_for.available;
                  setContractsFor(prev => ({ ...prev, [symbol]: availableContracts }));
                }
            }

            const permissions: AssetExecutionPermission = {
                symbol, enabled: true, maxStake: stakeValue * 5,
                allowedContracts: availableContracts?.map((c: any) => c.contract_type) || ['OPTIONS'],
                allowedActions: ['CALL', 'PUT']
            };

            // 5. EXECUÇÃO DO CONSELHO PARALELO
            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, symbol === activeSymbol, permissions, portfolio);
            lastDecisionBySymbolRef.current[symbol] = { ts: Date.now(), decision };

            // 6. GATES DE RESILIÊNCIA E VALOR ESPERADO
            const resilienceGate = resilience.validateExecution(symbol, decision.consensusConfidence, edgeStats.lowerBound, breakeven);
            
            // Cluster Risk (Bitcoin Gravity Alignment)
            const btcDir = gravity?.btcImpulseDir;
            const isClusterAligned = !btcDir || (decision.finalAction === (btcDir === 'UP' ? 'CALL' : 'PUT'));
            
            const canGoReal = !isShadowMode && gateStatus.allowed && resilienceGate.allowed;
            const shouldExecute = isManual || (isAutoMode && decision.finalAction !== 'HOLD' && (isShadowMode ? resilienceGate.allowed : canGoReal) && isClusterAligned);

            setRadarStatus(prev => ({ 
              ...prev, 
              [symbol]: { 
                ...decision, 
                gravity, 
                timestamp: Date.now(), 
                isQualified: shouldExecute, 
                gateReason: gateStatus.allowed ? "OK" : gateStatus.reason,
                resilienceReason: resilienceGate.allowed ? "OK" : resilienceGate.reason
              } 
            }));
            
            if (symbol === activeSymbol) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
                setMemoryBuffer(buffer);
            }

            if (shouldExecute) {
                // Cálculo de EV via Proposal
                const proposalParams = {
                  contract_type: decision.recommendedContract === 'OPTIONS' ? (decision.finalAction === 'CALL' ? 'CALL' : 'PUT') : (decision.recommendedContract === 'ACCUMULATORS' ? 'ACCU' : 'MULTUP'),
                  currency: 'USD',
                  amount: stakeValue,
                  basis: 'stake',
                  duration: 15,
                  duration_unit: 's'
                };
                
                const prop = await getProposal(proposalParams);
                const payout = prop.proposal?.payout || stakeValue * 1.95;
                const profit = payout - stakeValue;
                const p = edgeStats.posteriorMean;
                const EV = (p * profit) - ((1 - p) * stakeValue);

                if (EV > 0 || isManual || isShadowMode) {
                  if (isShadowMode) {
                      addLog(`[SHADOW] ${symbol}: EV=${EV.toFixed(2)} | Rule=${topCandidate?.rule}`, 'radar', undefined, symbol);
                      await CryptoShadowEngine.logTrade(user.uid, {
                        symbol, direction: decision.finalAction as any, contract: decision.recommendedContract,
                        entryPrice: snapshot.price, duration: 15, durationUnit: 's', gravityState: gravity?.btcVector || 'NONE',
                        rule: topCandidate?.rule || 'NONE', score: topCandidate?.score || 0, confidence: decision.consensusConfidence,
                        payoutRatio: payout / stakeValue, ev: EV
                      });
                  } else {
                      let finalContractType = 'CALL';
                      switch (decision.recommendedContract) {
                          case 'ACCUMULATORS': finalContractType = 'ACCU'; break;
                          case 'MULTIPLIERS': finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN'; break;
                          default: finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                      }
                      await executeTrade(finalContractType, stakeValue, symbol, decision.finalAction.toLowerCase() as any, 15, 's', 'Conselho_V4', `V42_${decision.executedVia}`);
                  }
                } else {
                  addLog(`[SKIP-EV] ${symbol}: EV negativo (${EV.toFixed(2)})`, 'warning', undefined, symbol);
                }
            }

        } catch (e: any) {
            addLog(`Erro V4.2 em ${symbol}: ${e.message}`, 'error');
        }
    }, [isConnected, user, ollamaConfig, isShadowMode, isAutoMode, activeSymbol, operationsLog, confidenceThreshold, strategicProfile, getCandlesFor, addLog, executeTrade, resilience, stakeValue, contractsFor, getContractsFor, getProposal]);

    // --- FASE 6: FILA DE PRIORIDADE DE INFERÊNCIA ---
    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || !isConnected) return;
        executionLockRef.current = true;

        try {
            const now = Date.now();
            const symbols = Array.from(new Set([...watchedSymbols, activeSymbol].filter(Boolean)));
            
            // Priorização: Foco > Pendentes > Background
            const prioritized = symbols.sort((a, b) => {
              if (a === activeSymbol) return -1;
              if (b === activeSymbol) return 1;
              return (scheduleRef.current[a] || 0) - (scheduleRef.current[b] || 0);
            });

            const dueSymbols = prioritized.filter(sym => (scheduleRef.current[sym] || 0) <= now);
            
            if (dueSymbols.length > 0) {
                // Concorrência Limitada (Max 2 simultâneos para evitar jitter de VRAM)
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
        kellyFraction, setKellyFraction,
        lastDecision, radarStatus, reasoningLog, telemetry, memoryBuffer,
        analysisInterval, setAnalysisInterval,
        chatMessages, isChatLoading, sendMessage: async (content: string) => {}, 
        resetSession: clearActiveContracts,
        executeManualDecision: () => activeSymbol && runAnalysisForSymbol(activeSymbol, getCandlesFor(activeSymbol), true),
        resilience,
        goLiveGates
    };
}
