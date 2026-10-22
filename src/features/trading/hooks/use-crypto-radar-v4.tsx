// src/features/trading/hooks/use-crypto-radar-v4.tsx
'use client';

/**
 * @fileOverview TERMINAL QUANT V4.2 - CRYPTO LAB (SUPREME EDITION)
 * V13: Implementado Piloto Automático DEMO_LIVE com Guardrails, Payout Filter e HWM.
 * V5.6/V5.7: Alpha Decay Guard, Cálculo Real de EV (Veredito Institucional) e Resiliência Adaptativa.
 * V14: Hardening de Duração, Payout Dinâmico e Registro de Fechamento Automático.
 * V5.8: Calibração Lead-Lag Walk-Forward e Bloqueio de Piloto Não-Calibrado.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi, type AccountType } from './use-deriv-api-v2';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { TradeMemoryManager } from '../services/trade-memory-service';
import { runCryptoCouncil } from '../services/crypto-council-engine';
import { CouncilDecision, TradeMemoryBuffer, CouncilTelemetry, AssetExecutionPermission, PortfolioRiskState, AllowedContractsV3, AllowedActionsV3, RuleCalibration } from '../types/council';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../services/council-strategies';
import { evaluateCryptoSignals, type CryptoSignalFeatures, SENTINEL_MIN_SCORE } from '../services/crypto-signal-engine';
import { calculateBitcoinGravity, type BitcoinGravity, evaluateSlingshot } from '../services/crypto-gravity-engine';
import { useAdaptiveResilience } from '@/hooks/useAdaptiveResilience';
import { getOllamaResponse } from '@/app/actions';
import { useBacktestRunner } from './use-backtest-runner';
import { buildStatusReport, buildAssetReport, buildBacktestReport, buildShortContext } from '../services/report-builders';
import { CryptoShadowEngine } from '../services/crypto-shadow-engine';
import { buildAssetFeatures } from '../services/asset-features';
import { checkGuardrails, DEFAULT_GUARDRAILS, parseDurationToSeconds } from '../services/pilot-guardrails';
import { logLiveTrade, updateLiveTradeResult } from '../services/live-trade-log';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { CalibrationService } from '../services/calibration-service';
import { updateRuleEdgeStats } from '../services/edge-report-service';

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

const SETTINGS_KEY = 'cryptoLabV4Settings';
const DEFAULT_ANALYSIS_INTERVAL = 120;
const SHADOW_COOLDOWN_SEC = 60;

const AGENT_PERSONAS = {
  CHAIRMAN: "o CHAIRMAN do conselho supremo: sua resposta deve ser executiva, fundamentada no DOSSIER DE TELEMETRIA fornecido. Você sintetiza a decisão final.",
  MOMENTUM: "o analista QUANT MOMENTUM: sua função é calcular unicamente a força do preço usando RSI, ER e Mom5 do dossier. Ignore sentimentos, foque na velocidade.",
  RISK_CRITIC: "o RISK CRITIC: você é unicamente cético. Use o Beta, a Correlação e o Piso Travado para alertar sobre perigos de divergência ou ganância.",
  ARCHIVIST: "o PATTERN ARCHIVIST: você compara unicamente o snapshot atual com a MEMÓRIA DE APRENDIZADO injetada. Identifique se este setup já falhou antes."
};

/**
 * Calcula o Valor Esperado (EV) de uma operação. (V5.6)
 */
function calculateTradeEV(confidencePct: number, buffer: TradeMemoryBuffer, payoutRatioDecimal: number): number {
    const wins = buffer.wins.length;
    const losses = buffer.losses.length;
    const total = wins + losses;
    // Laplace smoothing: (wins + 2) / (total + 4)
    const empiricalProb = (wins + 2) / (total + 4);
    
    // Combine com a confiança do conselho (peso 50/50 se houver histórico)
    const prob = total >= 5 ? (empiricalProb * 0.5) + ((confidencePct / 100) * 0.5) : (confidencePct / 100);
    
    // EV = (P * Payout) - (1 - P)
    return Number(((prob * payoutRatioDecimal) - (1 - prob)).toFixed(4));
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
        botCandleData, getHistoricalData, getContractsFor, getProposal 
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

    const [calibration, setCalibration] = useState<RuleCalibration | null>(null);

    const [liveTradeRegistry, setLiveTradeRegistry] = useState<Record<number, string>>({});

    const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', details?: string[], symbol?: string) => {
        setReasoningLog(prev => [{
            ts: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
            time: new Date().toLocaleTimeString(),
            message, type, details, symbol
        }, ...prev].slice(0, 300));
    }, []);

    const [isAutoMode, setIsAutoMode] = useState(false);
    const [pilotMode, setPilotMode] = useState<'SHADOW' | 'DEMO_LIVE'>('SHADOW');
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [analysisInterval, setAnalysisInterval] = useState(DEFAULT_ANALYSIS_INTERVAL); 
    const [backgroundIntervalSec, setBackgroundIntervalSec] = useState(60);
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

    const { backtest, runBacktest, runLeadLagBacktest } = useBacktestRunner(getHistoricalData);

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
    const shadowExecutionTimestampsRef = useRef<Record<string, number>>({});

    const operationsLogRef = useRef(operationsLog);
    useEffect(() => { operationsLogRef.current = operationsLog; }, [operationsLog]);

    // V5.8: CARREGA CALIBRAÇÃO AO INICIAR
    useEffect(() => {
        if (user) {
            CalibrationService.get(user.uid).then(cal => {
                if (cal) {
                    setCalibration(cal);
                    addLog(`[V5.8] Calibração carregada: zBtc=${cal.zBtc} | zMax=${cal.zTargetMax} | Corr=${cal.corrMin}`, 'info');
                } else {
                    addLog(`[V5.8] SISTEMA NÃO CALIBRADO. Usando limiares padrão.`, 'warning');
                }
            });
        }
    }, [user, addLog]);

    useEffect(() => {
        if (!user || !operationsLog.length || !Object.keys(liveTradeRegistry).length) return;
        
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && 
            op.id in liveTradeRegistry
        );

        finishedTrades.forEach(async (op) => {
            const docId = liveTradeRegistry[op.id];
            if (docId) {
                const win = op.status === 'won';
                const pnl = op.result || 0;
                
                await updateLiveTradeResult(user.uid, docId, {
                    status: win ? 'won' : 'lost',
                    profit: pnl,
                    exitSpot: op.exitPrice || 0,
                    closedTs: Date.now()
                });

                // V5.8: Atualizar Edge Stats com Payout Real
                await updateRuleEdgeStats(user.uid, op.asset, 'LEADLAG_SLINGSHOT', 'BULL_DRAG', win, pnl);

                setLiveTradeRegistry(prev => {
                    const next = { ...prev };
                    delete next[op.id];
                    return next;
                });
                addLog(`[V14-SYNC] Trade #${op.id} finalizado. Log atualizado no Firestore.`, 'info', undefined, op.asset);
            }
        });
    }, [operationsLog, user, liveTradeRegistry, addLog]);

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

    const calculateDynamicStake = useCallback((baseStake: number, symbol: string, decision: CouncilDecision): number => {
        let finalStake = baseStake;
        const symbolTrades = [...operationsLogRef.current]
            .filter(op => op.asset === symbol && op.status !== 'pending')
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        if (symbolTrades.length > 0) {
            const lastTrade = symbolTrades[0]; 
            if (lastTrade.status === 'lost') {
                finalStake *= 0.5;
            }
        }
        
        if (decision.telemetry.consensusEntropy < 0.2 && finalStake === baseStake) {
            finalStake *= 1.15;
        }

        if (decision.executedVia === 'MATH_FALLBACK') {
            finalStake *= (decision.stakeRatio || 0.5);
        }
        
        return Math.max(0.35, Number(finalStake.toFixed(2)));
    }, []);

    const resetSession = useCallback(() => {
        setIsAutoMode(false);
        setIsShadowMode(true);
        setPilotMode('SHADOW');
        clearActiveContracts();
        setRadarStatus({});
        setReasoningLog([]);
        setChatMessages([]);
        setLockedProfitFloor(0);
        setCouncilStats({ total: 0, call: 0, put: 0, hold: 0, vetoes: 0, fallbacks: 0, avgLatencyMs: 0 });
        scheduleRef.current = {};
        shadowExecutionTimestampsRef.current = {};
        setLastDecision(null);
        toast({ title: "Sessão Reiniciada", description: "Todos os dados foram resetados." });
    }, [clearActiveContracts, toast]);

    const sessionStats = useMemo(() => {
        const finishedTrades = (operationsLog as Operation[]).filter((op: Operation) => 
            op.status !== 'pending' && op.initiator.startsWith('Conselho')
        );
        const wins = finishedTrades.filter((op: Operation) => op.status === 'won').length;
        const total = finishedTrades.length;
        const winRate = total > 0 ? (wins / total) * 100 : null;
        const pnl = finishedTrades.reduce((acc: number, op: Operation) => acc + (Number(op.result) || 0), 0);
        return { pnl: Number(pnl) || 0, winRate, total };
    }, [operationsLog]);

    useEffect(() => {
        if (activeSymbol && priceTicks.length > 0) resilience.recordPulse(activeSymbol);
    }, [priceTicks, activeSymbol, resilience]);

    useEffect(() => {
        Object.keys(multiAssetCandles).forEach((symbol: string) => {
            if (watchedSymbols.includes(symbol)) resilience.recordPulse(symbol);
        });
    }, [multiAssetCandles, watchedSymbols, resilience]);

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
        if (sessionStats.pnl > dailyHighWaterMark.current) dailyHighWaterMark.current = sessionStats.pnl;
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

    const getCandlesForRef = useRef(getCandlesFor);
    const resilienceRef = useRef(resilience);
    useEffect(() => {
        getCandlesForRef.current = getCandlesFor;
        resilienceRef.current = resilience;
    });

    useEffect(() => {
        if (!user || !isShadowMode) return;
        
        const settleInterval = setInterval(() => {
            CryptoShadowEngine.settlePending(user.uid!, 
                (sym: string) => {
                    const c = getCandlesForRef.current(sym);
                    return c.length > 0 ? c[c.length - 1].close : null;
                },
                async (sym: string, win: boolean, pnl: number, trade: any) => {
                    if (trade.lateSettle) {
                        addLog(`[SHADOW] ${sym}: liquidação tardia (${Math.round((trade.settleDelayMs || 0) / 1000)}s de atraso) excluída das estatísticas.`, 'warning', undefined, sym);
                        return;
                    }
                    resilienceRef.current.processResult(sym, win);
                    
                    await TradeMemoryManager.addTrade(user.uid, sym, {
                        id: `shadow_${trade.id}`,
                        timestamp: trade.entryTs || Date.now(),
                        contract: trade.contract,
                        result: win ? 'WIN' : 'LOSS',
                        pnl,
                        rsi: trade.rsiAtEntry || 50,
                        volatilityYangZhang: trade.bbwAtEntry || 0,
                        candlePattern: 'SHADOW_SIM',
                        btcRegime: trade.gravityState,
                        gravityCorrelation: trade.correlationAtEntry || 0,
                        councilEntropy: trade.entropyAtEntry || 0,
                        failureDiagnosis: win ? undefined : 'Vencimento em simulado sombra'
                    });
                }
            );
        }, 2000);

        return () => clearInterval(settleInterval);
    }, [user, isShadowMode, addLog]);

    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManual: boolean = false) => {
        if (!isConnected || !user || !ollamaConfig || executionLockRef.current) return;
        const analysisStartTs = Date.now();
        const min = staleMinutes(symbol);
        if (min !== null && min > 2.5) return;

        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            if (!indicators) return;

            const baseFeats = buildAssetFeatures(symbol, candles);
            if (!baseFeats) return;

            let gravity: BitcoinGravity | null = null;
            if (symbol !== 'cryBTCUSD') {
                const btcCandles = getCandlesFor('cryBTCUSD');
                if (btcCandles.length >= 30) {
                    const btcFeats = buildAssetFeatures('cryBTCUSD', btcCandles);
                    if (btcFeats) gravity = calculateBitcoinGravity(btcFeats as any, baseFeats as any, 60, true, calibration ? { zBtc: calibration.zBtc, zTargetMax: calibration.zTargetMax, corrMin: calibration.corrMin } : undefined);
                }
            }

            if (gravity) {
                addLog(`[RADAR] ${symbol} vs BTC: ${gravity.btcVector} | Corr: ${gravity.correlation.toFixed(3)} | SlingShot: ${gravity.slingshotDetected}`, 'radar', undefined, symbol);
                if (symbol !== 'cryBTCUSD' && gravity.vetoReason) {
                    addLog(`[GRAVITY-VETO] ${symbol}: ${gravity.vetoReason}`, 'warning', undefined, symbol);
                    setRadarStatus(prev => ({
                        ...prev,
                        [symbol]: {
                            symbol, finalAction: 'HOLD', lastAction: 'HOLD', consensusConfidence: 0, confidence: 0,
                            timestamp: Date.now(), holdReason: gravity.vetoReason,
                            indicators: { rsi: baseFeats.rsi, adx: indicators.adx, bbw: indicators.bbw }
                        }
                    }));
                    return;
                }
            }

            const cryptoFeats: CryptoSignalFeatures = { ...baseFeats as any, gravity, vwapDist: baseFeats.bbPos };
            const candidates = evaluateCryptoSignals(symbol, cryptoFeats);
            
            const bestCandidate = candidates
                .filter((c: any) => c.direction !== 'NONE' && c.score >= SENTINEL_MIN_SCORE)
                .sort((a: any, b: any) => b.score - a.score)[0];

            if (!bestCandidate && requireSentinelCandidate) {
                addLog(`[SENTINEL] ${symbol}: Sem candidato qualificado (min: ${SENTINEL_MIN_SCORE}).`, 'sentinel', undefined, symbol);
                setRadarStatus(prev => ({
                    ...prev,
                    [symbol]: { symbol, finalAction: 'HOLD', lastAction: 'HOLD', consensusConfidence: 0, confidence: 0, timestamp: Date.now(), holdReason: 'SENTINEL_LOW_SCORE', indicators: { rsi: baseFeats.rsi, adx: indicators.adx, bbw: indicators.bbw } }
                }));
                return;
            }

            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);
            const portfolio: PortfolioRiskState = { openPositions: (operationsLog as any[]).filter((op: Operation) => op.status === 'pending').length, maxConcurrentPositions: maxConcurrentTrades, totalExposure: (operationsLog as any[]).filter((op: Operation) => op.status === 'pending').reduce((s: number, o: Operation) => s + o.stake, 0), maxTotalExposure: dailyBalance, lockedSymbols: new Set() };
            const permissions: AssetExecutionPermission = { symbol, enabled: true, userId: user.uid, maxStake: stakeValue * 5, allowedContracts: Object.keys(allowedContracts).filter(k => allowedContracts[k as keyof typeof allowedContracts]) as any[], allowedActions: Object.keys(allowedActions).filter(k => allowedActions[k as keyof typeof allowedActions]) as any[] };

            executionLockRef.current = true;
            const decision = await runCryptoCouncil({ ...cryptoFeats, symbol, price: candles[candles.length - 1].close, strategicProfile, sentinel: bestCandidate } as any, buffer, ollamaConfig, isShadowMode, isManual || symbol === activeSymbolRef.current, permissions, portfolio);
            const analysisEndTs = Date.now();
            
            if (bestCandidate && decision.finalAction !== 'HOLD' && decision.finalAction !== bestCandidate.direction) {
                const originalCouncilAction = decision.finalAction;
                decision.finalAction = 'HOLD';
                addLog(`[WARNING] ${symbol}: Divergência detectada. Sentinel=${bestCandidate.direction} vs Conselho=${originalCouncilAction}. Forçando HOLD.`, 'warning', undefined, symbol);
                decision.holdReason = `DIVERGENCE: Sentinel(${bestCandidate.direction}) vs Conselho(${originalCouncilAction}).`;
            }

            lastDecisionBySymbolRef.current[symbol] = { ts: Date.now(), decision };

            if (symbol === activeSymbol) { setLastDecision(decision); setTelemetry(decision.telemetry); setMemoryBuffer(buffer); }

            setCouncilStats(prev => ({ total: prev.total + 1, call: prev.call + (decision.finalAction === 'CALL' ? 1 : 0), put: prev.put + (decision.finalAction === 'PUT' ? 1 : 0), hold: prev.hold + (decision.finalAction === 'HOLD' ? 1 : 0), vetoes: prev.vetoes + (decision.executedVia === 'COUNCIL_VETO' ? 1 : 0), fallbacks: prev.fallbacks + (decision.executedVia === 'MATH_FALLBACK' ? 1 : 0), avgLatencyMs: (prev.avgLatencyMs * 0.8) + (decision.t2tLatencyMs * 0.2) }));

            const currentRigor = resilience.thresholds[symbol] || (confidenceThreshold / 100);
            const isStable = resilience.checkStability(symbol);
            const effectiveThreshold = Math.max(confidenceThreshold, currentRigor * 100);
            const hwmCheckTriggered = lockedProfitFloor > 0 && sessionStats.pnl <= lockedProfitFloor;

            const shouldExecute = isManual || (
                isAutoMode &&
                !hwmCheckTriggered &&
                decision.finalAction !== 'HOLD' &&
                decision.consensusConfidence >= effectiveThreshold &&
                isStable
            );

            setRadarStatus(prev => ({ ...prev, [symbol]: { ...decision, features: cryptoFeats, gravity, timestamp: Date.now(), isQualified: shouldExecute, indicators: { rsi: baseFeats.rsi, adx: indicators.adx, bbw: indicators.bbw } } }));

            if (hwmCheckTriggered && isAutoMode) {
                addLog(`[HWM-STOP] Piso de lucro diário atingido ($${lockedProfitFloor.toFixed(2)}). Sessão protegida.`, 'warning', undefined, symbol);
                toast({ title: "🛡️ HWM Protect", description: `Piso de lucro ($${lockedProfitFloor.toFixed(2)}) atingido. Automação desativada.`, variant: "destructive" });
                setIsAutoMode(false);
                executionLockRef.current = false;
                return;
            }

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                const finalStake = calculateDynamicStake(stakeValue, symbol, decision);
                
                const freshCandles = getCandlesFor(symbol);
                const currentSpot = freshCandles.length > 0 ? freshCandles[freshCandles.length - 1].close : candles[candles.length - 1].close;

                // V5.6: Alpha Decay Guard
                if (!isManual && decision.t2tLatencyMs > 4000) {
                    addLog(`[ALPHA-DECAY] ${symbol}: Latência LLM excessiva (${decision.t2tLatencyMs}ms) para contrato de 15s. Abortando execução.`, 'warning', undefined, symbol);
                    executionLockRef.current = false;
                    return;
                }

                if (pilotMode === 'SHADOW') {
                    if (symbol === 'cryBTCUSD') { addLog(`[SHADOW] ${symbol}: BTC é âncora; simulação ignorada.`, 'radar', undefined, symbol); executionLockRef.current = false; return; }
                    
                    const pending = CryptoShadowEngine.getPendingFromCache().filter((t: any) => t.symbol === symbol);
                    const hasSamePending = pending.some((t: any) => t.direction === decision.finalAction);
                    const now = Date.now();
                    const lastExec = shadowExecutionTimestampsRef.current[symbol] || 0;

                    if (hasSamePending) { executionLockRef.current = false; return; }

                    if (now - lastExec < SHADOW_COOLDOWN_SEC * 1000) {
                        addLog(`[SHADOW-BLOCK] ${symbol}: Cooldown sombra ativo (${Math.ceil((SHADOW_COOLDOWN_SEC * 1000 - (now - lastExec)) / 1000)}s restantes).`, 'radar', undefined, symbol);
                        executionLockRef.current = false;
                        return;
                    }

                    const entryTs = Date.now();
                    const ev = calculateTradeEV(decision.consensusConfidence, buffer, (backtest.payoutPct || 85) / 100);
                    addLog(`[SHADOW] ${symbol}: ${decision.finalAction} simulado com stake adaptativo $${finalStake} (EV: ${ev}).`, 'radar', undefined, symbol);
                    shadowExecutionTimestampsRef.current[symbol] = entryTs;
                    
                    await CryptoShadowEngine.logTrade(user.uid!, {
                        symbol, direction: decision.finalAction, contract: decision.recommendedContract,
                        entryPrice: currentSpot, rule: bestCandidate?.rule || 'COUNCIL_DISCRETION',
                        score: decision.consensusConfidence, gravityState: gravity?.btcVector || 'CHOP',
                        confidence: decision.consensusConfidence, payoutRatio: backtest.payoutPct || 85,
                        duration: 15, durationUnit: 's', ev, stake: finalStake,
                        timestamp: new Date(entryTs).toISOString(),
                        decisionTs: analysisStartTs, entryTs, llmLatencyMs: decision.t2tLatencyMs,
                        rsiAtEntry: baseFeats.rsi, bbwAtEntry: indicators.bbw || 0,
                        correlationAtEntry: gravity?.correlation, entropyAtEntry: decision.telemetry.consensusEntropy
                    });
                } else if (pilotMode === 'DEMO_LIVE') {
                    // V5.8: BLOQUEIO DE PILOTO NÃO-CALIBRADO
                    if (!calibration || calibration.verdict === 'SEM EDGE') {
                        addLog(`[EXEC-ABORT] ${symbol}: Execução Demo Live bloqueada por falta de calibração válida.`, 'warning', undefined, symbol);
                        executionLockRef.current = false;
                        return;
                    }

                    const guard = checkGuardrails(symbol, accountType, finalStake, operationsLog, staleMinutes(symbol));
                    if (!guard.allowed) { addLog(`[GUARDRAIL-BLOCK] ${symbol}: ${guard.reason}`, 'warning', undefined, symbol); executionLockRef.current = false; return; }

                    try {
                        const contractsRes = await getContractsFor(symbol);
                        const available = contractsRes.contracts_for?.available || [];
                        const callPuts = available.filter((c: any) => c.contract_category === 'callput');
                        
                        let finalDurVal: number | null = null;
                        let finalDurUnit: DurationUnit | null = null;
                        let minFoundSec = Infinity;

                        for (const c of callPuts) {
                            const durSec = parseDurationToSeconds(c.min_contract_duration);
                            if (durSec !== null && durSec >= 15) {
                                if (durSec < minFoundSec) {
                                    minFoundSec = durSec;
                                    const match = c.min_contract_duration.match(/^(\d+)([tsmhd])$/);
                                    if (match) {
                                        finalDurVal = parseInt(match[1], 10);
                                        finalDurUnit = match[2] as DurationUnit;
                                    }
                                }
                            }
                        }

                        if (!finalDurVal || !finalDurUnit) {
                            addLog(`[EXEC-ABORT] ${symbol}: Nenhuma duração temporal >= 15s disponível.`, 'warning', undefined, symbol);
                            executionLockRef.current = false;
                            return;
                        }

                        const propRes = await getProposal({ 
                            contract_type: decision.finalAction === 'CALL' ? 'CALL' : 'PUT', 
                            currency: 'USD', 
                            symbol, 
                            amount: finalStake, 
                            basis: 'stake', 
                            duration: finalDurVal, 
                            duration_unit: finalDurUnit 
                        });
                        
                        if (propRes.error) throw new Error(propRes.error.message);
                        const actualPayout = (propRes.proposal.payout - propRes.proposal.ask_price) / propRes.proposal.ask_price;
                        
                        if (actualPayout < DEFAULT_GUARDRAILS.minPayout) { 
                            addLog(`[EXEC-ABORT] ${symbol}: Payout ${(actualPayout*100).toFixed(1)}% < ${DEFAULT_GUARDRAILS.minPayout * 100}%`, 'warning', undefined, symbol); 
                            executionLockRef.current = false; 
                            return; 
                        }

                        const realEv = calculateTradeEV(decision.consensusConfidence, buffer, actualPayout);
                        if (!isManual && realEv <= 0) {
                            addLog(`[EV-ABORT] ${symbol}: Expectativa matemática negativa/nula (EV=${realEv}). Operação abortada.`, 'warning', undefined, symbol);
                            executionLockRef.current = false;
                            return;
                        }

                        const tradeDirection: 'rise' | 'fall' = decision.finalAction === 'CALL' ? 'rise' : 'fall';
                        const finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';

                        const res = await executeTrade(finalContractType, finalStake, symbol, tradeDirection, finalDurVal, finalDurUnit, 'Conselho' as OperationInitiator, `V14_DEMO_${decision.executedVia}`);
                        const purchaseTs = Date.now();
                        const signalTs = (freshCandles.length > 0 ? freshCandles[freshCandles.length - 1].epoch : candles[candles.length - 1].epoch) * 1000;

                        if (res.success) {
                            addLog(`[EXEC-DEMO] ${symbol} ${decision.finalAction} enviado via API. Stake: $${finalStake}`, 'execution', undefined, symbol);
                            const executionPrice = res.entryPrice || propRes.proposal.spot || currentSpot;
                            
                            const docId = await logLiveTrade(user.uid!, {
                                symbol, direction: decision.finalAction as any, contract: decision.recommendedContract,
                                stake: finalStake, payout: actualPayout, duration: finalDurVal, durationUnit: finalDurUnit,
                                spotAtDecision: candles[candles.length - 1].close,
                                spotAtPurchase: executionPrice,
                                slippagePips: executionPrice - (propRes.proposal.spot || currentSpot),
                                decisionLatencyMs: Math.round(decision.t2tLatencyMs),
                                executionLatencyMs: Math.round(purchaseTs - analysisEndTs),
                                totalLatencyMs: Math.round(purchaseTs - analysisStartTs),
                                rule: bestCandidate?.rule || 'V14_DISCRETION', gravityState: gravity?.btcVector || 'CHOP',
                                confidence: decision.consensusConfidence, sentinelScore: bestCandidate?.score || 0,
                                entropy: decision.telemetry.consensusEntropy, 
                                signalTs, 
                                decisionTs: analysisEndTs, 
                                purchaseTs,
                                status: 'pending', accountType
                            });

                            if (docId && res.contractId) {
                                setLiveTradeRegistry(prev => ({ ...prev, [res.contractId!]: docId }));
                            }

                            // Parallel Shadow Trade (Etapa 13.4) com EV real e Preço Pareado
                            await CryptoShadowEngine.logTrade(user.uid!, {
                                symbol, direction: decision.finalAction, contract: decision.recommendedContract,
                                entryPrice: executionPrice, rule: bestCandidate?.rule || 'V14_PARALLEL',
                                score: decision.consensusConfidence, gravityState: gravity?.btcVector || 'CHOP',
                                confidence: decision.consensusConfidence, payoutRatio: Math.round(actualPayout * 100),
                                duration: finalDurVal, durationUnit: finalDurUnit, ev: realEv, stake: finalStake,
                                timestamp: new Date(purchaseTs).toISOString(),
                                decisionTs: analysisStartTs, entryTs: purchaseTs, llmLatencyMs: decision.t2tLatencyMs,
                                rsiAtEntry: baseFeats.rsi, bbwAtEntry: indicators.bbw || 0,
                                correlationAtEntry: gravity?.correlation, entropyAtEntry: decision.telemetry.consensusEntropy
                            });
                        }
                    } catch (e: any) { addLog(`Falha DEMO_LIVE (${symbol}): ${e.message}`, 'error', undefined, symbol); }
                }
            }
        } catch (e: any) { addLog(`Erro V5 em ${symbol}: ${e.message}`, 'error'); } finally { executionLockRef.current = false; }
    }, [isConnected, user, ollamaConfig, isShadowMode, isAutoMode, activeSymbol, operationsLog, confidenceThreshold, strategicProfile, getCandlesFor, addLog, executeTrade, stakeValue, dailyBalance, maxConcurrentTrades, allowedContracts, allowedActions, staleMinutes, requireSentinelCandidate, pilotMode, accountType, getContractsFor, getProposal, lockedProfitFloor, calculateDynamicStake, resilience, toast, backtest.payoutPct, liveTradeRegistry, calibration]);

    const runMultiAssetCycle = useCallback(async () => {
        if (!isConnected || executionLockRef.current) return;
        const now = Date.now();
        const symbols = Array.from(new Set([...watchedSymbols, activeSymbol].filter(Boolean) as string[]));
        const dueSymbols = symbols.filter((sym: string) => {
            const nextRun = scheduleRef.current[sym] || 0;
            const isFoco = sym === activeSymbol;
            
            if (isFoco && isAutoMode) {
                const candles = getCandlesFor(sym);
                const feats = buildAssetFeatures(sym, candles);
                if (feats) {
                  let gravity = null;
                  if (sym !== 'cryBTCUSD') {
                      const btcCandles = getCandlesFor('cryBTCUSD');
                      if (btcCandles.length >= 30) {
                          const btcFeats = buildAssetFeatures('cryBTCUSD', btcCandles);
                          if (btcFeats) gravity = calculateBitcoinGravity(btcFeats as any, feats as any, 60, true, calibration ? { zBtc: calibration.zBtc, zTargetMax: calibration.zTargetMax, corrMin: calibration.corrMin } : undefined);
                      }
                  }
                  const cryptoFeats: CryptoSignalFeatures = { ...feats as any, gravity, vwapDist: feats.bbPos };
                  const candidates = evaluateCryptoSignals(sym, cryptoFeats);
                  const hasStrongSetup = candidates.some(c => c.score >= SENTINEL_MIN_SCORE && c.direction !== 'NONE');
                  if (hasStrongSetup && (now - nextRun) > -15000) return true;
                }
            }
            return nextRun <= now;
        });
        
        if (dueSymbols.length > 0) {
            dueSymbols.sort((a, b) => (a === activeSymbol ? -1 : (b === activeSymbol ? 1 : 0)));
            for (const sym of dueSymbols) {
                const candles = getCandlesFor(sym);
                if (candles.length >= 30) {
                    await runAnalysisForSymbol(sym, candles);
                    const interval = sym === activeSymbol ? analysisInterval : backgroundIntervalSec;
                    scheduleRef.current[sym] = Date.now() + interval * 1000;
                }
            }
        }
    }, [isConnected, watchedSymbols, activeSymbol, analysisInterval, backgroundIntervalSec, isAutoMode, getCandlesFor, runAnalysisForSymbol, calibration]);

    useEffect(() => {
        const id = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(id);
    }, [runMultiAssetCycle]);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        setIsAutoMode,
        pilotMode, setPilotMode,
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        setIsShadowMode,
        strategicProfile, setStrategicProfile,
        confidenceThreshold, setConfidenceThreshold,
        stakeValue, setStakeValue, multiplier, setMultiplier,
        dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
        maxConcurrentTrades, setMaxConcurrentTrades,
        allowedActions, setAllowedActions, allowedContracts, setAllowedContracts,
        lastDecision, radarStatus, reasoningLog, telemetry, memoryBuffer,
        analysisInterval, setAnalysisInterval,
        backgroundIntervalSec, setBackgroundIntervalSec,
        chatMessages, isChatLoading, sendMessage,
        resetSession, sessionStats, lockedProfitFloor,
        resilience, councilStats, runBacktest, runLeadLagBacktest, backtest, buildBacktestReport: () => buildBacktestReport(backtest as any), staleMinutes,
        ollamaConfig, availableModels, updateOllamaConfig, fetchAvailableModels,
        calibration,
        executeManualDecision: () => activeSymbol && runAnalysisForSymbol(activeSymbol, getCandlesFor(activeSymbol), true)
    };
}
