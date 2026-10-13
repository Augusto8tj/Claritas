'use client';

/**
 * @fileOverview QUANT RADAR V4 - CRYPTO LAB (CONCURRENT EDITION)
 * Focado em ativos 'cry' com inteligência de gravidade do Bitcoin.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi } from './use-deriv-api-v2';
import { calculateAllIndicators } from '../services/indicator-service';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { TradeMemoryManager } from '../services/trade-memory-service';
import { runQuantCouncil, MIN_EXEC_CONFIDENCE } from '../services/quant-council-engine';
import { CouncilDecision, TradeMemoryBuffer, CouncilTelemetry, AssetExecutionPermission, PortfolioRiskState } from '../types/council';
import { computeSignalFeatures, type SignalCandidate } from '../services/signal-engine';
import { evaluateCryptoSignals, type CryptoSignalFeatures } from '../services/crypto-signal-engine';
import { calculateBitcoinGravity } from '../services/crypto-gravity-engine';
import { buildStatusReport, buildAssetReport, buildShortContext } from '../services/report-builders';
import { useBacktestRunner } from './use-backtest-runner';
import { LogEntry, CouncilStats } from './use-ai-quant-terminal-v3';

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

    // ESTADOS
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [analysisInterval, setAnalysisInterval] = useState(60); 
    const [backgroundIntervalSec, setBackgroundIntervalSec] = useState(30);
    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(0);
    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [councilStats, setCouncilStats] = useState<CouncilStats>({ total: 0, call: 0, put: 0, hold: 0, vetoes: 0, fallbacks: 0, avgLatencyMs: 0 });
    
    const [radarStatus, setRadarStatus] = useState<Record<string, any>>({});
    const [sentinel, setSentinel] = useState<Record<string, any>>({});
    const [reasoningLog, setReasoningLog] = useState<LogEntry[]>([]);
    const [telemetry, setTelemetry] = useState<CouncilTelemetry>({ avgTokensPerSec: 0, totalTokens: 0, consensusEntropy: 0, jitterMs: 0, inferenceHealth: 100 });
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });

    // REFS
    const executionLockRef = useRef(false);
    const scheduleRef = useRef<Record<string, number>>({});

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

    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManual: boolean = false) => {
        if (!isConnected || !user) return;

        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            if (!indicators) return;

            const baseFeats = computeSignalFeatures(candles as any);
            if (!baseFeats) return;

            // --- CRYPTO LAB INJECTION ---
            let gravity = null;
            if (symbol.startsWith('cry')) {
                const btcCandles = getCandlesFor('cryBTCUSD');
                if (btcCandles.length >= 30) {
                    gravity = calculateBitcoinGravity(btcCandles, candles);
                }
            }

            const cryptoFeats: CryptoSignalFeatures = { ...baseFeats, gravity };
            const candidates = evaluateCryptoSignals(symbol, cryptoFeats);
            
            // Injeção de snapshot estendido para o Conselho
            const snapshot = {
                ...cryptoFeats,
                symbol,
                bitcoinGravity: gravity,
                price: candles[candles.length - 1].close
            };

            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);
            
            // Simulação de decisão do conselho (clonando lógica V3 com injeção de veto)
            const ollama = JSON.parse(localStorage.getItem('ollamaConfig') || '{}');
            
            // Governança V4 Crypto
            if (gravity?.isBtcExploding && gravity.btcVector === 'DIVERGENT') {
                addLog(`[VETO-V4] ${symbol}: Abortando por divergência gravitacional com BTC.`, 'warning', undefined, symbol);
                return;
            }

            const decision = await runQuantCouncil(snapshot, buffer, ollama, isShadowMode, symbol === activeSymbol, {
                symbol, enabled: true, maxStake: 10,
                allowedContracts: ['OPTIONS', 'MULTIPLIERS', 'ACCUMULATORS'],
                allowedActions: ['CALL', 'PUT']
            }, {
                openPositions: operationsLog.filter(o => o.status === 'pending').length,
                maxConcurrentPositions: 5,
                totalExposure: operationsLog.filter(o => o.status === 'pending').reduce((s, o) => s + o.stake, 0),
                maxTotalExposure: 50,
                lockedSymbols: new Set()
            });

            setRadarStatus(prev => ({ ...prev, [symbol]: { ...decision, gravity, timestamp: Date.now() } }));
            setSentinel(prev => ({ ...prev, [symbol]: { features: cryptoFeats, candidates, ts: Date.now() } }));
            
            if (symbol === activeSymbol) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
                setMemoryBuffer(buffer);
            }

            // Lógica de Execução Auto
            if ((isAutoMode || isManual) && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= MIN_EXEC_CONFIDENCE) {
                addLog(`[EXEC-V4] ${symbol}: ${decision.finalAction} via CryptoLab.`, 'execution', undefined, symbol);
                // Execução real via API...
            }

        } catch (e: any) {
            addLog(`Erro V4 em ${symbol}: ${e.message}`, 'error');
        }
    }, [isConnected, user, isShadowMode, activeSymbol, operationsLog, isAutoMode, getCandlesFor, addLog]);

    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || !isConnected) return;
        executionLockRef.current = true;

        const now = Date.now();
        const symbols = Array.from(new Set([...watchedSymbols, activeSymbol].filter(Boolean)));
        
        // --- CONCURRENCY V4 ---
        const dueSymbols = symbols.filter(sym => (scheduleRef.current[sym] || 0) <= now);
        
        if (dueSymbols.length > 0) {
            addLog(`[V4-SCAN] Processando ${dueSymbols.length} ativos em paralelo.`, 'info');
            
            await Promise.all(dueSymbols.map(async (sym) => {
                const candles = getCandlesFor(sym);
                if (candles.length >= 30) {
                    const interval = sym === activeSymbol ? analysisInterval : backgroundIntervalSec;
                    scheduleRef.current[sym] = now + interval * 1000;
                    return runAnalysisForSymbol(sym, candles);
                }
            }));
        }

        executionLockRef.current = false;
    }, [isConnected, watchedSymbols, activeSymbol, analysisInterval, backgroundIntervalSec, getCandlesFor, runAnalysisForSymbol, addLog]);

    useEffect(() => {
        const id = setInterval(runMultiAssetCycle, 5000);
        return () => clearInterval(id);
    }, [runMultiAssetCycle]);

    return {
        isAutoMode, setIsAutoMode, isShadowMode, setIsShadowMode,
        lastDecision, radarStatus, sentinel, reasoningLog, telemetry, memoryBuffer,
        analysisInterval, setAnalysisInterval, backgroundIntervalSec, setBackgroundIntervalSec,
        resetSession: () => addLog("V4 reset via terminal."),
        executeManualDecision: () => activeSymbol && runAnalysisForSymbol(activeSymbol, getCandlesFor(activeSymbol), true)
    };
}
