'use client';

/**
 * @fileOverview TERMINAL QUANT V3.0 (COUNCIL EDITION)
 * Lógica de laboratório com conselho paralelo e memória viva.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi } from './use-deriv-api-v2';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../strategies/council-strategies';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { TradeMemoryManager } from '../services/trade-memory-service';
import { runQuantCouncil } from '../services/quant-council-engine';
import { CouncilDecision, TradeMemoryBuffer } from '../types/council';

export function useAIQuantTerminalV3(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { isConnected, executeTrade, operationsLog, accountBalance } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();

    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [analysisInterval, setAnalysisInterval] = useState(120); 
    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(120);
    
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [reasoningLog, setReasoningLog] = useState<any[]>([]);
    const executionLockRef = useRef(false);

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

    // Monitora fechamento de trades para alimentar a memória (Apenas trades da V3)
    useEffect(() => {
        if (!user) return;
        // Filtra para encontrar trades finalizados que foram iniciados por este bot V3
        const lastFinished = operationsLog.find(op => 
            op.status !== 'pending' && 
            op.strategy?.startsWith('V3_')
        );

        if (lastFinished) {
            const result = lastFinished.status === 'won' ? 'WIN' : 'LOSS';
            TradeMemoryManager.addTrade(user.uid, {
                id: String(lastFinished.id),
                timestamp: Date.now(),
                contract: 'CALL', // Simplificação para o buffer
                result,
                pnl: lastFinished.result || 0,
                rsi: 50, // Placeholder
                volatilityYangZhang: 0,
                candlePattern: 'V3_PATTERN'
            }).then(() => {
                TradeMemoryManager.getBuffer(user.uid).then(setMemoryBuffer);
            });
        }
    }, [operationsLog, user]);

    const runAnalysisCycle = useCallback(async () => {
        if (!activeSymbol || !isConnected || !ollamaConfig || executionLockRef.current || chartData.length < 30) return;
        
        executionLockRef.current = true;
        addLog(`Conselho V3 iniciando análise paralela em ${activeSymbol}...`, 'info');

        try {
            const indicators = calculateAllIndicators(chartData, [], '1m', { duration: 15, unit: 's' });
            const snapshot = {
                symbol: activeSymbol,
                price: priceTicks[priceTicks.length - 1]?.price,
                rsi: indicators?.rsi,
                bbw: indicators?.bbw,
                trend: indicators?.adx! > 25 ? 'Trending' : 'Ranging'
            };

            const buffer = user ? await TradeMemoryManager.getBuffer(user.uid) : { wins: [], losses: [] };
            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode);
            
            setLastDecision(decision);
            addLog(`Veredito: ${decision.finalAction} via ${decision.executedVia} (${decision.t2tLatencyMs}ms)`, 'decision');

            if (isAutoMode && !isShadowMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65) {
                await executeTrade(
                    'CALL', 1.0, activeSymbol, decision.finalAction.toLowerCase() as any,
                    15, 's', 'Conselho', `V3_${decision.executedVia}`
                );
                addLog(`Ordem executada em modo real: ${decision.finalAction}`, 'execution');
            }

        } catch (err: any) {
            addLog(`Erro no conselho: ${err.message}`, 'error');
        } finally {
            executionLockRef.current = false;
        }
    }, [activeSymbol, isConnected, chartData, isAutoMode, isShadowMode, ollamaConfig, user, addLog, executeTrade, priceTicks]);

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
                    runAnalysisCycle();
                    return analysisInterval;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [runAnalysisCycle, analysisInterval]);

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        lastDecision, timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        reasoningLog, memoryBuffer, accountBalance, clearMemory,
        executeManualDecision: () => lastDecision && runAnalysisCycle()
    };
}
