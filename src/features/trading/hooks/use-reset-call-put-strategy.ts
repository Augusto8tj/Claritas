// src/features/trading/hooks/use-reset-call-put-strategy.ts
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useDerivApiReset } from './use-deriv-api-reset';
import { useToast } from '@/hooks/use-toast';
import type { CandleData } from '@/lib/types';
import { useFormContext } from 'react-hook-form';
import type { ResetFormValues } from '../components/deriv-trader/deriv-trader-interface-reset.types';
import { calculateAllIndicators, type Indicators } from '@/features/trading/services/indicator-service';
import { getCouncilStrategies } from '@/features/trading/services/council-strategies';

type BotStatus = 'PAUSED' | 'MONITORING' | 'SIGNAL_FOUND' | 'EXECUTING';
type TrendDirection = 'UP' | 'DOWN' | 'NONE';

const ADX_TREND_THRESHOLD = 25;
const RSI_MOMENTUM_THRESHOLD = 50;
const ATR_MULTIPLIER_FOR_RESET = 2.5;

export function useResetCallPutStrategy(
    activeSymbol: string | null,
    botCandleData: CandleData[],
    accountBalance: number | null
) {
    const { executeTrade, isConnected } = useDerivApiReset();
    const { toast } = useToast();
    const form = useFormContext<ResetFormValues>();

    const [isAutopilotOn, setIsAutopilotOn] = useState(false);
    const [botStatus, setBotStatus] = useState<BotStatus>('PAUSED');
    const [trend, setTrend] = useState<TrendDirection>('NONE');
    const [calculatedBarrier, setCalculatedBarrier] = useState('+0.0');

    const toggleAutopilot = useCallback(() => {
        setIsAutopilotOn(prevState => !prevState);
    }, []);

    const indicators = useMemo((): Indicators | null => {
        if (botCandleData.length < 100) return null;
        return calculateAllIndicators(botCandleData, getCouncilStrategies(), '15m', { duration: 15, unit: 'm' });
    }, [botCandleData]);

    useEffect(() => {
        if (!isAutopilotOn || !isConnected || !activeSymbol || !indicators) {
            setBotStatus('PAUSED');
            return;
        }

        setBotStatus('MONITORING');

        const { adx, pdi, ndi, rsi, atr } = indicators;
        const currentPrice = botCandleData[botCandleData.length - 1].close;

        // 1. Determine Trend
        let currentTrend: TrendDirection = 'NONE';
        if (adx && adx > ADX_TREND_THRESHOLD) {
            if (pdi && ndi) {
                if (pdi > ndi) currentTrend = 'UP';
                else currentTrend = 'DOWN';
            }
        }
        setTrend(currentTrend);

        // 2. Calculate Dynamic Barrier
        if (atr) {
            const barrierValue = atr * ATR_MULTIPLIER_FOR_RESET;
            setCalculatedBarrier(`+${barrierValue.toFixed(4)}`);
        }

        // 3. Entry Signal
        let signal: 'call' | 'put' | null = null;
        if (currentTrend === 'UP' && rsi && rsi > RSI_MOMENTUM_THRESHOLD) {
            signal = 'call';
        } else if (currentTrend === 'DOWN' && rsi && rsi < RSI_MOMENTUM_THRESHOLD) {
            signal = 'put';
        }

        if (signal) {
            setBotStatus('SIGNAL_FOUND');
            const stake = form.getValues('stake');
            
            executeTrade(
                signal === 'call' ? 'RESETCALL' : 'RESETPUT',
                stake,
                activeSymbol,
                signal === 'call' ? `-${calculatedBarrier.substring(1)}` : calculatedBarrier,
                'Piloto'
            ).then(result => {
                if (result.success) {
                    toast({ title: `🤖 Piloto: ${signal === 'call' ? 'Reset Call' : 'Reset Put'} Executado!` });
                } else {
                    toast({ title: "❌ Piloto Falhou", description: result.message, variant: 'destructive' });
                }
                setBotStatus('MONITORING');
            });
        }
    }, [isAutopilotOn, isConnected, activeSymbol, indicators, botCandleData, executeTrade, form, toast, calculatedBarrier]);
    
    return {
        isAutopilotOn,
        toggleAutopilot,
        botStatus,
        trend,
        calculatedBarrier,
    };
}
