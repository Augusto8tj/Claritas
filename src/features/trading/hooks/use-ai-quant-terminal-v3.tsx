'use client';

/**
 * @fileOverview TERMINAL QUANT V3.0 (COUNCIL EDITION) - MONITORAMENTO MULTI-ATIVO
 * Lógica de laboratório com conselho paralelo, memória viva e radar multi-ativo.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi } from './use-deriv-api-v2';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../services/council-strategies';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { TradeMemoryManager } from '../services/trade-memory-service';
import { runQuantCouncil } from '../services/quant-council-engine';
import { CouncilDecision, TradeMemoryBuffer, AgentOpinion } from '../types/council';

export interface RadarAssetStatus {
    symbol: string;
    lastAction: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    timestamp: number;
    isQualified: boolean;
    executedVia: string;
    opinions: AgentOpinion[];
}

export function useAIQuantTerminalV3(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { isConnected, executeTrade, operationsLog, accountBalance, watchedSymbols, setWatchedSymbols, multiAssetCandles } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();

    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [analysisInterval, setAnalysisInterval] = useState(60); 
    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(60);
    
    const [radarStatus, setRadarStatus] = useState<Record<string, RadarAssetStatus>>({});
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [reasoningLog, setReasoningLog] = useState<any[]>([]);
    const executionLockRef = useRef(false);
    const scheduleRef = useRef<Record<string, number>>({});

    const ollamaConfig = useMemo(() => {
        if (typeof window === 'undefined') return null;
        const saved = localStorage.getItem('ollamaConfig');
        return saved ? JSON.parse(saved) as OllamaConfig : null;
    }, []);

    const addLog = useCallback((message: string, type: string = 'info') => {
        setReasoningLog(prev => [{ time: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
    }, []);

    // Carrega a memória inicial
    useEffect(() => {
        if (user) {
            TradeMemoryManager.getBuffer(user.uid).then(setMemoryBuffer);
        }
    }, [user]);

    // Monitora fechamento de trades para alimentar a memória
    useEffect(() => {
        if (!user) return;
        const lastFinished = operationsLog.find(op => 
            op.status !== 'pending' && 
            op.strategy?.startsWith('V3_')
        );

        if (lastFinished) {
            const result = lastFinished.status === 'won' ? 'WIN' : 'LOSS';
            TradeMemoryManager.addTrade(user.uid, {
                id: String(lastFinished.id),
                timestamp: Date.now(),
                contract: 'CALL', 
                result,
                pnl: lastFinished.result || 0,
                rsi: 50, 
                volatilityYangZhang: 0,
                candlePattern: 'V3_PATTERN'
            }).then(() => {
                TradeMemoryManager.getBuffer(user.uid).then(setMemoryBuffer);
            });
        }
    }, [operationsLog, user]);

    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[]) => {
        if (!isConnected || !ollamaConfig || candles.length < 30) return;
        
        const isFocused = symbol === activeSymbol;
        if (isFocused) addLog(`Conselho V3 analisando ${symbol}...`, 'info');

        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            const snapshot = {
                symbol: symbol,
                price: isFocused ? priceTicks[priceTicks.length - 1]?.price : candles[candles.length - 1].close,
                rsi: indicators?.rsi,
                bbw: indicators?.bbw,
                trend: indicators?.adx! > 25 ? 'Trending' : 'Ranging'
            };

            const buffer = user ? await TradeMemoryManager.getBuffer(user.uid) : { wins: [], losses: [] };
            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode);
            
            if (isFocused) setLastDecision(decision);

            setRadarStatus(prev => ({
                ...prev,
                [symbol]: {
                    symbol,
                    lastAction: decision.finalAction,
                    confidence: decision.consensusConfidence,
                    timestamp: Date.now(),
                    isQualified: decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65,
                    executedVia: decision.executedVia,
                    opinions: decision.opinions
                }
            }));

            // Execução do Autopilot
            if (isAutoMode && !isShadowMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65) {
                const hasOpenTrade = operationsLog.some(op => op.asset === symbol && op.status === 'pending');
                if (!hasOpenTrade) {
                    await executeTrade(
                        'CALL', 1.0, symbol, decision.finalAction.toLowerCase() as any,
                        15, 's', 'Conselho', `V3_${decision.executedVia}`
                    );
                    if (isFocused) addLog(`Ordem real executada: ${decision.finalAction}`, 'execution');
                }
            }

        } catch (err: any) {
            if (isFocused) addLog(`Erro em ${symbol}: ${err.message}`, 'error');
        }
    }, [isConnected, ollamaConfig, isShadowMode, user, isAutoMode, operationsLog, activeSymbol, priceTicks, executeTrade, addLog]);

    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current) return;
        executionLockRef.current = true;

        const now = Date.now();
        const dueSymbols = watchedSymbols.filter(sym => {
            const nextRun = scheduleRef.current[sym] || 0;
            return now >= nextRun;
        });

        for (const symbol of dueSymbols) {
            const candles = symbol === activeSymbol ? chartData : multiAssetCandles[symbol];
            if (candles && candles.length >= 30) {
                await runAnalysisForSymbol(symbol, candles);
                scheduleRef.current[symbol] = now + (analysisInterval * 1000);
            }
        }

        executionLockRef.current = false;
    }, [watchedSymbols, activeSymbol, chartData, multiAssetCandles, analysisInterval, runAnalysisForSymbol]);

    const clearMemory = async () => {
        if (!user) return;
        await TradeMemoryManager.clearBuffer(user.uid);
        setMemoryBuffer({ wins: [], losses: [] });
        toast({ title: "Memória Resetada", description: "O buffer de aprendizado da V3 foi limpo." });
        addLog("Memória quantitativa resetada pelo operador.");
    };

    useEffect(() => {
        const interval = setInterval(() => {
            setTimeToNextAnalysis(prev => {
                if (prev <= 1) {
                    runMultiAssetCycle();
                    return analysisInterval;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [runMultiAssetCycle, analysisInterval]);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        lastDecision, timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        reasoningLog, memoryBuffer, accountBalance, clearMemory,
        radarStatus, watchedSymbols, setWatchedSymbols,
        executeManualDecision: () => lastDecision && runMultiAssetCycle()
    };
}
