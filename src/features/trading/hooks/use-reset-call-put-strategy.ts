// src/features/trading/hooks/use-reset-call-put-strategy.ts
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useDerivApiReset } from './use-deriv-api-reset';
import { useToast } from '@/hooks/use-toast';
import type { CandleData, Operation } from '@/lib/types';
import { useFormContext } from 'react-hook-form';
import type { ResetFormValues } from '../components/deriv-trader/deriv-trader-interface-reset.types';
import { calculateAllIndicators, type Indicators } from '@/features/trading/services/indicator-service';
import { getCouncilStrategies } from '@/features/trading/services/council-strategies';

type BotStatus = 'PAUSED' | 'MONITORING' | 'SIGNAL_FOUND' | 'EXECUTING' | 'RISK_PAUSE';
type TrendDirection = 'UP' | 'DOWN' | 'NONE';
export type SignalStrength = 'STRONG' | 'MEDIUM' | 'WEAK' | 'NONE';
export type ResetMode = 'CLASSIC' | 'HARVESTING';

export function useResetCallPutStrategy(
    activeSymbol: string | null,
    botCandleData: CandleData[],
    accountBalance: number | null
) {
    const { executeTrade, isConnected, operationsLog } = useDerivApiReset();
    const { toast } = useToast();
    const form = useFormContext<ResetFormValues>();

    const [isAutopilotOn, setIsAutopilotOn] = useState(false);
    const [botStatus, setBotStatus] = useState<BotStatus>('PAUSED');
    const [trend, setTrend] = useState<TrendDirection>('NONE');
    const [calculatedBarrier, setCalculatedBarrier] = useState('+0.0');

    // --- Gestão de Risco ---
    const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(true);
    const [martingaleMultiplier, setMartingaleMultiplier] = useState(1.8);
    const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(5);
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);
    const [nextStake, setNextStake] = useState(form.getValues('stake'));
    const lastProcessedOpId = useRef<number | null>(null);

    // --- Parâmetros de Estratégia ---
    const [adxThreshold, setAdxThreshold] = useState(25);
    const [atrMultiplier, setAtrMultiplier] = useState(2.5);
    const [useAdaptiveDuration, setUseAdaptiveDuration] = useState(false);
    const [resetMode, setResetMode] = useState<ResetMode>('CLASSIC');
    const [minConfirmations, setMinConfirmations] = useState(2);

    // --- Estado de Sinal (para UI) ---
    const [signalStrength, setSignalStrength] = useState<SignalStrength>('NONE');
    const [confirmationCount, setConfirmationCount] = useState(0);
    const [currentRsi, setCurrentRsi] = useState<number | null>(null);
    const [currentAdx, setCurrentAdx] = useState<number | null>(null);

    const prevRsiRef = useRef<number | null>(null);
    const executionCooldownRef = useRef<number>(0);

    const toggleAutopilot = useCallback(() => {
        setIsAutopilotOn(prev => !prev);
    }, []);

    const resetRiskSession = useCallback(() => {
        setConsecutiveLosses(0);
        setNextStake(form.getValues('stake'));
        setBotStatus('MONITORING');
        lastProcessedOpId.current = null;
        toast({ title: "Sessão de Risco Reiniciada", description: "Contador e aposta resetados." });
    }, [form, toast]);

    const indicators = useMemo((): Indicators | null => {
        if (botCandleData.length < 100) return null;
        return calculateAllIndicators(botCandleData, getCouncilStrategies(), '15m', { duration: 15, unit: 'm' });
    }, [botCandleData]);

    // --- Processar resultado do último trade ---
    useEffect(() => {
        const lastOp = operationsLog.find(
            op => op.initiator === 'Piloto' && op.status !== 'pending' && op.id !== lastProcessedOpId.current
        );
        if (!lastOp) return;
        lastProcessedOpId.current = lastOp.id;

        if (lastOp.status === 'lost') {
            const newLossCount = consecutiveLosses + 1;
            setConsecutiveLosses(newLossCount);
            if (newLossCount >= maxConsecutiveLosses) {
                setBotStatus('RISK_PAUSE');
                toast({ title: '🛑 Piloto Pausado por Risco', description: `${maxConsecutiveLosses} perdas consecutivas atingidas.`, variant: 'destructive' });
            } else if (isMartingaleEnabled) {
                const newStake = parseFloat((nextStake * martingaleMultiplier).toFixed(2));
                setNextStake(newStake);
                toast({ title: '⚠️ Martingale Ativado', description: `Próxima aposta: $${newStake}` });
            }
        } else {
            setConsecutiveLosses(0);
            setNextStake(form.getValues('stake'));
        }
    }, [operationsLog, consecutiveLosses, maxConsecutiveLosses, isMartingaleEnabled, nextStake, martingaleMultiplier, form, toast]);

    // --- Duração Adaptativa ---
    const getAdaptiveDuration = useCallback((): number => {
        if (!useAdaptiveDuration || !indicators?.atr) return form.getValues('duration');
        const basePrice = botCandleData[botCandleData.length - 1]?.close || 1;
        const atrPercent = (indicators.atr / basePrice) * 100;
        if (atrPercent > 1.5) return 1;
        if (atrPercent > 0.8) return 2;
        return 5;
    }, [useAdaptiveDuration, indicators, botCandleData, form]);

    // --- Lógica Principal ---
    useEffect(() => {
        if (!isAutopilotOn || !isConnected || !activeSymbol || !indicators || botStatus === 'RISK_PAUSE') {
            if (!isAutopilotOn || botStatus === 'RISK_PAUSE') {
                setBotStatus(isAutopilotOn ? 'RISK_PAUSE' : 'PAUSED');
            }
            return;
        }

        const executionLogic = setTimeout(() => {
            const now = Date.now();
            if (now < executionCooldownRef.current) return;

            setBotStatus('MONITORING');

            const { adx, pdi, ndi, rsi, atr } = indicators;
            const lastCandle = botCandleData[botCandleData.length - 1];
            const prevCandle = botCandleData[botCandleData.length - 2];

            // Atualizar UI com valores atuais
            setCurrentRsi(rsi ?? null);
            setCurrentAdx(adx ?? null);

            // --- TENDÊNCIA via ADX ---
            let currentTrend: TrendDirection = 'NONE';
            if (adx && adx > adxThreshold && pdi && ndi) {
                currentTrend = pdi > ndi ? 'UP' : 'DOWN';
            }
            setTrend(currentTrend);

            // --- BARREIRA via ATR ---
            const barrierOffset = atr ? `+${(atr * atrMultiplier).toFixed(4)}` : '+0.0';
            setCalculatedBarrier(barrierOffset);

            // ================================================================
            // GERAÇÃO DE SINAL
            // ================================================================
            let signal: 'call' | 'put' | null = null;

            if (resetMode === 'CLASSIC') {
                // --- MODO CLÁSSICO: RSI por ZONA (não cruzamento) ---
                if (rsi !== null) {
                    if (currentTrend === 'UP') {
                        // Pullback em uptrend → comprar a reversão (CALL)
                        if (rsi < 40) signal = 'call';
                    } else if (currentTrend === 'DOWN') {
                        // Pullback em downtrend → vender a reversão (PUT)
                        if (rsi > 60) signal = 'put';
                    } else {
                        // Sem tendência: reversão clássica (sobrevendido/sobrecomprado)
                        if (rsi < 30) signal = 'call';
                        else if (rsi > 70) signal = 'put';
                    }
                }
            } else if (resetMode === 'HARVESTING') {
                // --- MODO HARVESTING: Aproveita o mecanismo de reset ---
                // Entra quando há padrão de reversão (candle menor após candle grande)
                if (rsi !== null && lastCandle && prevCandle) {
                    const lastBodySize = Math.abs(lastCandle.close - lastCandle.open);
                    const prevBodySize = Math.abs(prevCandle.close - prevCandle.open);
                    const isInsideBar = lastBodySize < prevBodySize * 0.5;

                    if (isInsideBar) {
                        if (rsi > 65 && lastCandle.close < lastCandle.open) {
                            signal = 'put'; // Sobrecomprado + candle bearish fraco → PUT
                        } else if (rsi < 35 && lastCandle.close > lastCandle.open) {
                            signal = 'call'; // Sobrevendido + candle bullish fraco → CALL
                        }
                    }
                }
            }

            prevRsiRef.current = rsi ?? null;

            // ================================================================
            // SISTEMA DE CONFIRMAÇÕES (mín. 2/4)
            // ================================================================
            let confirmations = 0;

            if (signal === 'call') {
                if (rsi !== null && rsi < 50) confirmations++;                      // RSI favorável
                if (adx && adx > 30) confirmations++;                               // Tendência forte
                if (pdi && ndi && pdi > ndi) confirmations++;                       // PDI > NDI
                if (lastCandle && lastCandle.close > lastCandle.open) confirmations++; // Candle bullish
            } else if (signal === 'put') {
                if (rsi !== null && rsi > 50) confirmations++;                      // RSI favorável
                if (adx && adx > 30) confirmations++;                               // Tendência forte
                if (pdi && ndi && ndi > pdi) confirmations++;                       // NDI > PDI
                if (lastCandle && lastCandle.close < lastCandle.open) confirmations++; // Candle bearish
            }

            setConfirmationCount(confirmations);

            let strength: SignalStrength = 'NONE';
            if (signal) {
                if (confirmations >= 3) strength = 'STRONG';
                else if (confirmations >= 2) strength = 'MEDIUM';
                else strength = 'WEAK';
            }
            setSignalStrength(strength);

            // ================================================================
            // EXECUÇÃO: só opera com confirmações suficientes
            // ================================================================
            if (signal && confirmations >= minConfirmations) {
                setBotStatus('SIGNAL_FOUND');
                const stakeToUse = nextStake;
                const duration = getAdaptiveDuration();

                console.log(`[Reset] signal=${signal} | RSI=${rsi?.toFixed(1)} | ADX=${adx?.toFixed(1)} | confirmations=${confirmations} | ${strength}`);
                
                executeTrade(
                    signal === 'call' ? 'RESETCALL' : 'RESETPUT',
                    stakeToUse,
                    activeSymbol,
                    // CORREÇÃO: A barreira do CALL deve ser negativa
                    signal === 'call' ? `-${barrierOffset.substring(1)}` : barrierOffset,
                    duration,
                    form.getValues('duration_unit'),
                    'Piloto'
                ).then(result => {
                    if (result.success) {
                        executionCooldownRef.current = Date.now() + 8000;
                        toast({
                            title: `🤖 ${signal === 'call' ? '📈 Reset CALL' : '📉 Reset PUT'} Executado!`,
                            description: `Stake: $${stakeToUse} | Força: ${strength} (${confirmations}/4)`,
                        });
                    } else {
                        toast({ title: "❌ Falhou", description: result.message, variant: 'destructive' });
                    }
                    setBotStatus('MONITORING');
                });
            }
        }, 2000);

        return () => clearTimeout(executionLogic);
    }, [
        isAutopilotOn, isConnected, activeSymbol, indicators, botCandleData,
        executeTrade, form, toast, calculatedBarrier, nextStake, botStatus,
        adxThreshold, atrMultiplier, resetMode, minConfirmations, getAdaptiveDuration
    ]);
    
    return {
        isAutopilotOn,
        toggleAutopilot,
        botStatus,
        trend,
        calculatedBarrier,
        isMartingaleEnabled, setIsMartingaleEnabled,
        martingaleMultiplier, setMartingaleMultiplier,
        maxConsecutiveLosses, setMaxConsecutiveLosses,
        consecutiveLosses,
        isPausedByRisk: botStatus === 'RISK_PAUSE',
        currentStake: nextStake,
        resetRiskSession,
        adxThreshold, setAdxThreshold,
        atrMultiplier, setAtrMultiplier,
        // Novos exports
        signalStrength,
        confirmationCount,
        currentRsi,
        currentAdx,
        useAdaptiveDuration, setUseAdaptiveDuration,
        resetMode, setResetMode,
        minConfirmations, setMinConfirmations,
        // Legacy (mantido para compatibilidade)
        rsiThreshold: 50,
        setRsiThreshold: (_: number) => {},
    };
}
