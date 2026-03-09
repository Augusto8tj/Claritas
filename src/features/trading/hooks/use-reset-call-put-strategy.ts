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

const ADX_TREND_THRESHOLD = 25;
const RSI_MOMENTUM_THRESHOLD = 50;
const ATR_MULTIPLIER_FOR_RESET = 2.5;

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

    // --- Gestão de Risco e Martingale ---
    const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(true);
    const [martingaleMultiplier, setMartingaleMultiplier] = useState(1.8);
    const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(5);
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);
    const [nextStake, setNextStake] = useState(form.getValues('stake'));
    const lastProcessedOpId = useRef<number | null>(null);

    const toggleAutopilot = useCallback(() => {
        setIsAutopilotOn(prevState => !prevState);
    }, []);

    const resetRiskSession = useCallback(() => {
        setConsecutiveLosses(0);
        setNextStake(form.getValues('stake'));
        setBotStatus('MONITORING');
        lastProcessedOpId.current = null;
        toast({ title: "Sessão de Risco Reiniciada", description: "O contador de perdas e a aposta foram resetados." });
    }, [form, toast]);

    const indicators = useMemo((): Indicators | null => {
        if (botCandleData.length < 100) return null;
        return calculateAllIndicators(botCandleData, getCouncilStrategies(), '15m', { duration: 15, unit: 'm' });
    }, [botCandleData]);

    // Processar resultado do último trade
    useEffect(() => {
        const lastOp = operationsLog.find(op => op.initiator === 'Piloto' && op.status !== 'pending' && op.id !== lastProcessedOpId.current);
        if (lastOp) {
            lastProcessedOpId.current = lastOp.id;

            if (lastOp.status === 'lost') {
                const newLossCount = consecutiveLosses + 1;
                setConsecutiveLosses(newLossCount);

                if (newLossCount >= maxConsecutiveLosses) {
                    setBotStatus('RISK_PAUSE');
                    toast({
                        title: 'Piloto Pausado por Risco',
                        description: `Atingido o limite de ${maxConsecutiveLosses} perdas consecutivas.`,
                        variant: 'destructive',
                    });
                } else if (isMartingaleEnabled) {
                    const newStake = nextStake * martingaleMultiplier;
                    setNextStake(parseFloat(newStake.toFixed(2)));
                    toast({
                        title: 'Gestão de Risco Ativada',
                        description: `Próxima aposta aumentada para $${newStake.toFixed(2)}.`,
                    });
                }
            } else { // win
                setConsecutiveLosses(0);
                setNextStake(form.getValues('stake'));
            }
        }
    }, [operationsLog, consecutiveLosses, maxConsecutiveLosses, isMartingaleEnabled, nextStake, martingaleMultiplier, form, toast]);

    // Lógica principal de trading
    useEffect(() => {
        if (!isAutopilotOn || !isConnected || !activeSymbol || !indicators || botStatus === 'RISK_PAUSE') {
            if (!isAutopilotOn || botStatus === 'RISK_PAUSE') {
                setBotStatus(isAutopilotOn ? 'RISK_PAUSE' : 'PAUSED');
            }
            return;
        }

        const executionLogic = setTimeout(() => {
            setBotStatus('MONITORING');

            const { adx, pdi, ndi, rsi, atr } = indicators;
            const currentPrice = botCandleData[botCandleData.length - 1].close;

            let currentTrend: TrendDirection = 'NONE';
            if (adx && adx > ADX_TREND_THRESHOLD && pdi && ndi) {
                currentTrend = pdi > ndi ? 'UP' : 'DOWN';
            }
            setTrend(currentTrend);

            if (atr) {
                const barrierValue = atr * ATR_MULTIPLIER_FOR_RESET;
                setCalculatedBarrier(`+${barrierValue.toFixed(4)}`);
            }

            let signal: 'call' | 'put' | null = null;
            if (currentTrend === 'UP' && rsi && rsi > RSI_MOMENTUM_THRESHOLD) {
                signal = 'call';
            } else if (currentTrend === 'DOWN' && rsi && rsi < RSI_MOMENTUM_THRESHOLD) {
                signal = 'put';
            }

            if (signal) {
                setBotStatus('SIGNAL_FOUND');
                
                const stakeToUse = nextStake;
                
                executeTrade(
                    signal === 'call' ? 'RESETCALL' : 'RESETPUT',
                    stakeToUse,
                    activeSymbol,
                    signal === 'call' ? `-${calculatedBarrier.substring(1)}` : calculatedBarrier,
                    'Piloto'
                ).then(result => {
                    if (result.success) {
                        toast({ title: `🤖 Piloto: ${signal === 'call' ? 'Reset Call' : 'Reset Put'} Executado!`, description: `Stake: $${stakeToUse}`});
                    } else {
                        toast({ title: "❌ Piloto Falhou", description: result.message, variant: 'destructive' });
                    }
                    setBotStatus('MONITORING');
                });
            }
        }, 2000); // Cooldown entre as análises

        return () => clearTimeout(executionLogic);
    }, [isAutopilotOn, isConnected, activeSymbol, indicators, botCandleData, executeTrade, form, toast, calculatedBarrier, nextStake, botStatus]);
    
    return {
        isAutopilotOn,
        toggleAutopilot,
        botStatus,
        trend,
        calculatedBarrier,
        // Novas props de gestão de risco
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
    };
}
