// src/features/trading/hooks/use-reset-call-put-strategy.ts
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useDerivApiReset, type AllContractTypes } from './use-deriv-api-reset';
import { useToast } from '@/hooks/use-toast';
import type { CandleData, DurationUnit, Operation } from '@/lib/types';
import { useFormContext } from 'react-hook-form';
import type { ResetFormValues } from '../components/deriv-trader/deriv-trader-interface-reset.types';
import { calculateAllIndicators, type Indicators } from '@/features/trading/services/indicator-service';
import { getCouncilStrategies } from '@/features/trading/services/council-strategies';

type BotStatus = 'PAUSED' | 'MONITORING' | 'SIGNAL_FOUND' | 'EXECUTING' | 'RISK_PAUSE';
type TrendDirection = 'UP' | 'DOWN' | 'NONE';
export type SignalStrength = 'STRONG' | 'MEDIUM' | 'WEAK' | 'NONE';
export type AutopilotMode = 'reset' | 'high_low' | 'touch';


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
    const [calculatedBarrier, setCalculatedBarrier] = useState('+0.00');

    // --- Autopilot Strategy Config ---
    const [autopilotMode, setAutopilotMode] = useState<AutopilotMode>('reset');
    const [autopilotBarrier, setAutopilotBarrier] = useState('+0.20');
    const [autopilotDuration, setAutopilotDuration] = useState(5);
    const [autopilotDurationUnit, setAutopilotDurationUnit] = useState<DurationUnit>('m');

    // --- Gestão de Risco ---
    const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(true);
    const [martingaleMultiplier, setMartingaleMultiplier] = useState(1.8);
    const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(5);
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);
    const [nextStake, setNextStake] = useState(form.getValues('stake'));
    const lastProcessedOpId = useRef<number | null>(null);

    // --- Parâmetros de Estratégia ---
    const [adxThreshold, setAdxThreshold] = useState(15); 
    const [atrMultiplier, setAtrMultiplier] = useState(1.5); 
    const [useAdaptiveDuration, setUseAdaptiveDuration] = useState(false);
    const [minConfirmations, setMinConfirmations] = useState(1);

    // --- Estado de Sinal (para UI) ---
    const [signalStrength, setSignalStrength] = useState<SignalStrength>('NONE');
    const [confirmationCount, setConfirmationCount] = useState(0);
    const [currentRsi, setCurrentRsi] = useState<number | null>(null);
    const [currentAdx, setCurrentAdx] = useState<number | null>(null);

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
        return calculateAllIndicators(
            botCandleData,
            getCouncilStrategies(),
            '1m',
            { duration: 1, unit: 'm' }
        );
    }, [botCandleData]);

    useEffect(() => {
        if (indicators?.atr) {
            const barrierOffsetValue = indicators.atr * atrMultiplier;
            const barrierOffset = `+${barrierOffsetValue.toFixed(2)}`;
            setCalculatedBarrier(barrierOffset);
        } else {
            setCalculatedBarrier('+0.00');
        }
    }, [indicators, atrMultiplier]);


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

    const getAdaptiveDuration = useCallback((): number => {
        if (!useAdaptiveDuration || !indicators?.atr) return autopilotDuration;
        const basePrice = botCandleData[botCandleData.length - 1]?.close || 1;
        const atrPercent = (indicators.atr / basePrice) * 100;
        if (atrPercent > 0.3) return Math.max(1, Math.floor(autopilotDuration * 0.75));
        if (atrPercent > 0.15) return autopilotDuration;
        return Math.ceil(autopilotDuration * 1.25);
    }, [useAdaptiveDuration, indicators, botCandleData, autopilotDuration]);

    useEffect(() => {
        if (!isAutopilotOn || !isConnected || !activeSymbol || !indicators || botStatus === 'RISK_PAUSE') {
            if (!isAutopilotOn) setBotStatus('PAUSED');
            return;
        }

        const executionLogic = setTimeout(async () => {
            const now = Date.now();
            if (now < executionCooldownRef.current) return;

            if (botStatus === 'SIGNAL_FOUND' || botStatus === 'EXECUTING') return;

            setBotStatus('MONITORING');

            const { adx, pdi, ndi, rsi, atr } = indicators;
            const lastCandle = botCandleData[botCandleData.length - 1];

            setCurrentRsi(rsi ?? null);
            setCurrentAdx(adx ?? null);

            let currentTrend: TrendDirection = 'NONE';
            if (adx && adx > adxThreshold && pdi && ndi) {
                currentTrend = pdi > ndi ? 'UP' : 'DOWN';
            }
            setTrend(currentTrend);
            
            let signal: 'call' | 'put' | null = null;
            if (rsi !== null) {
                if (currentTrend === 'UP' && rsi < 75) {
                    signal = 'call';
                } else if (currentTrend === 'DOWN' && rsi > 25) {
                    signal = 'put';
                }
            }

            let confirmations = 0;
            if (signal === 'call') {
                if (rsi !== null && rsi > 50) confirmations++;
                if (adx && adx > adxThreshold) confirmations++;
                if (pdi && ndi && pdi > ndi) confirmations++;
                if (lastCandle && lastCandle.close > lastCandle.open) confirmations++;
            } else if (signal === 'put') {
                if (rsi !== null && rsi < 50) confirmations++;
                if (adx && adx > adxThreshold) confirmations++;
                if (pdi && ndi && ndi > pdi) confirmations++;
                if (lastCandle && lastCandle.close < lastCandle.open) confirmations++;
            }

            setConfirmationCount(confirmations);

            let strength: SignalStrength = 'NONE';
            if (signal) {
                if (confirmations >= 3) strength = 'STRONG';
                else if (confirmations >= 2) strength = 'MEDIUM';
                else if (confirmations >= 1) strength = 'WEAK';
            }
            setSignalStrength(strength);

            if (signal && confirmations >= minConfirmations) {
                setBotStatus('SIGNAL_FOUND');
                const stakeToUse = nextStake;
                const duration = getAdaptiveDuration();

                console.log(`[Reset Piloto] ${signal.toUpperCase()} | RSI=${rsi?.toFixed(1)} | ADX=${adx?.toFixed(1)} | ATR=${atr?.toFixed(5)} | Barrier=${calculatedBarrier} | ${strength} (${confirmations}/4)`);
                
                let contractType: AllContractTypes;
                switch(autopilotMode) {
                    case 'high_low':
                        contractType = signal === 'call' ? 'CALL' : 'PUT';
                        break;
                    case 'touch':
                        contractType = signal === 'call' ? 'ONETOUCH' : 'NOTOUCH';
                        break;
                    case 'reset':
                    default:
                        contractType = signal === 'call' ? 'RESETCALL' : 'RESETPUT';
                        break;
                }
                const barrierToSend = autopilotMode === 'reset' ? '' : autopilotBarrier;
                const durationUnitToSend = autopilotDurationUnit;

                try {
                    setBotStatus('EXECUTING');
                    const result = await executeTrade(
                        contractType,
                        stakeToUse,
                        activeSymbol,
                        barrierToSend,
                        duration,
                        durationUnitToSend,
                        'Piloto'
                    );
                    if (result.success) {
                        executionCooldownRef.current = Date.now() + 8000;
                        toast({
                            title: `🤖 ${signal === 'call' ? '📈 Compra' : '📉 Venda'} Executada!`,
                            description: `Contrato: ${contractType} | Stake: $${stakeToUse} | ${strength} (${confirmations}/4)`,
                        });
                    } else {
                        toast({ title: "❌ Falhou", description: result.message, variant: 'destructive' });
                    }
                } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
                    toast({ title: "❌ Erro Inesperado", description: msg, variant: 'destructive' });
                } finally {
                    setBotStatus('MONITORING');
                }
            }
        }, 2000);

        return () => clearTimeout(executionLogic);
    }, [
        isAutopilotOn, isConnected, activeSymbol, indicators, botCandleData,
        executeTrade, form, toast, nextStake, botStatus,
        adxThreshold, atrMultiplier, minConfirmations, getAdaptiveDuration,
        calculatedBarrier, autopilotMode, autopilotBarrier, autopilotDuration, autopilotDurationUnit
    ]);

    return {
        isAutopilotOn,
        toggleAutopilot,
        botStatus,
        trend,
        calculatedBarrier,
        isMartingaleEnabled,
        setIsMartingaleEnabled,
        martingaleMultiplier,
        setMartingaleMultiplier,
        maxConsecutiveLosses,
        setMaxConsecutiveLosses,
        consecutiveLosses,
        isPausedByRisk: botStatus === 'RISK_PAUSE',
        currentStake: nextStake,
        resetRiskSession,
        adxThreshold,
        setAdxThreshold,
        atrMultiplier,
        setAtrMultiplier,
        signalStrength,
        confirmationCount,
        currentRsi,
        currentAdx,
        useAdaptiveDuration,
        setUseAdaptiveDuration,
        minConfirmations,
        setMinConfirmations,
        autopilotMode,
        setAutopilotMode,
        autopilotBarrier,
        setAutopilotBarrier,
        autopilotDuration,
        setAutopilotDuration,
        autopilotDurationUnit,
        setAutopilotDurationUnit,
    };
}
