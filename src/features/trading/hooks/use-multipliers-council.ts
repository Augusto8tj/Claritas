// src/features/trading/hooks/use-multipliers-council.ts
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiMultipliers } from './use-deriv-api-multipliers';
import { useToast } from '@/hooks/use-toast';
import type { CandleData, Operation } from '@/lib/types';
import { useFormContext } from 'react-hook-form';
import type { MultipliersFormValues } from '../components/deriv-trader/deriv-trader-interface-multipliers.types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';

type BotStatus = 'IDLE' | 'MONITORING' | 'TREND_FOUND' | 'EXECUTING_TRADE' | 'PAUSED';
type TrendDirection = 'UP' | 'DOWN' | 'NONE';

const RSI_PERIOD = 14;
const RSI_MID_LEVEL = 50;
const LONG_EMA_PERIOD = 100;

export function useMultipliersCouncil(
    activeSymbol: string | null, 
    botCandleData: CandleData[],
    accountBalance: number | null
) {
    const { executeTrade, isConnected, operationsLog, sellContract } = useDerivApiMultipliers();
    const { toast } = useToast();
    const form = useFormContext<MultipliersFormValues>();

    const [isAutopilotOn, setIsAutopilotOn] = useState(false);
    const [botStatus, setBotStatus] = useState<BotStatus>('PAUSED');
    const [trend, setTrend] = useState<TrendDirection>('NONE');
    const [indicators, setIndicators] = useState<Indicators | null>(null);
    const [dailyBalance, setDailyBalance] = useState(10.0);
    const [dailyTarget, setDailyTarget] = useState(5.0);
    
    const [calculatedRisk, setCalculatedRisk] = useState({ stake: 1.0, stopLoss: 1.0, takeProfit: 2.0 });

    const lastRsiRef = useRef<number | null>(null);
    const executionRef = useRef({ isExecuting: false });
    const openPositionsRef = useRef<Set<number>>(new Set());
    const lastSignalRef = useRef<'up' | 'down' | null>(null);

    const dailyPnL = useMemo(() => {
        const today = new Date().toDateString();
        return operationsLog
            .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today && op.initiator === 'Piloto')
            .reduce((sum, op) => sum + (op.result || 0), 0);
    }, [operationsLog]);

    // Cleanup closed positions from refs
    useEffect(() => {
        const openContractIds = new Set(operationsLog.filter(op => op.status === 'pending').map(op => op.id));
        
        for (const id of openPositionsRef.current) {
            if (!openContractIds.has(id)) {
                openPositionsRef.current.delete(id);
            }
        }
    }, [operationsLog]);


    // Core Trading Logic
    useEffect(() => {
        if (!isAutopilotOn || !isConnected || !activeSymbol || botCandleData.length < LONG_EMA_PERIOD) {
            setBotStatus(isAutopilotOn ? 'MONITORING' : 'PAUSED');
            return;
        }

        if (executionRef.current.isExecuting) return;

        if (dailyPnL <= -dailyBalance) {
            if (isAutopilotOn) {
                setIsAutopilotOn(false);
                toast({
                    title: "🤖 Piloto Automático: Limite de Perda Atingido",
                    description: `O sistema foi pausado para proteger seu capital. Perda do dia: $${dailyPnL.toFixed(2)}`,
                    variant: "destructive"
                });
            }
            return;
        }

        if (dailyPnL >= dailyTarget) {
            if (isAutopilotOn) {
                setIsAutopilotOn(false);
                toast({
                    title: "🏆 Piloto Automático: Meta de Lucro Atingida!",
                    description: `Parabéns! O sistema foi pausado. Lucro do dia: $${dailyPnL.toFixed(2)}`,
                });
            }
            return;
        }
        
        const executeLogic = async () => {
            executionRef.current.isExecuting = true;

            const calculatedIndicators = calculateAllIndicators(botCandleData, initialCouncilStrategies, '1m', {duration: 15, unit: 's'});
            setIndicators(calculatedIndicators);

            if (!calculatedIndicators || !calculatedIndicators.rsi || !calculatedIndicators.ma.long || !accountBalance) {
                setBotStatus('MONITORING');
                executionRef.current.isExecuting = false;
                return;
            }
            
            const lastPrice = botCandleData[botCandleData.length - 1].close;
            const longEMA = calculatedIndicators.ma.long;
            const rsi = calculatedIndicators.rsi;
            
            // 1. Definição de Tendência Macro
            const currentTrend: TrendDirection = lastPrice > longEMA ? 'UP' : lastPrice < longEMA ? 'DOWN' : 'NONE';
            setTrend(currentTrend);

            // 2. Lógica de Entrada
            let signal: 'up' | 'down' | null = null;
            if (lastRsiRef.current !== null) {
                // Cruzamento de alta do RSI
                if (currentTrend === 'UP' && lastRsiRef.current <= RSI_MID_LEVEL && rsi > RSI_MID_LEVEL) {
                    signal = 'up';
                }
                // Cruzamento de baixa do RSI
                else if (currentTrend === 'DOWN' && lastRsiRef.current >= RSI_MID_LEVEL && rsi < RSI_MID_LEVEL) {
                    signal = 'down';
                }
            }
            
            const hasChangedDirection = lastSignalRef.current !== signal;
            lastRsiRef.current = rsi;

            if (signal && hasChangedDirection) {
                lastSignalRef.current = signal;
                setBotStatus('EXECUTING_TRADE');

                // 3. Gestão de Risco e Tamanho da Posição baseada em ATR
                const baseRiskPercentage = 0.01; // 1%
                const atr = calculatedIndicators.atr || 0;
                const normalizedAtr = atr > 0 && lastPrice > 0 ? atr / lastPrice : 0.001; // ATR como % do preço

                const volatilityFactor = normalizedAtr / 0.0005; // Normalizado contra uma volatilidade "padrão" de 0.05%
                const cappedVolatilityFactor = Math.max(0.5, Math.min(2.0, volatilityFactor));
                const adjustedRiskPercentage = baseRiskPercentage / cappedVolatilityFactor;
                
                const stake = Math.max(1.0, dailyBalance * adjustedRiskPercentage);
                const takeProfit = stake * 2; // Relação Risco-Recompensa 2:1
                
                setCalculatedRisk({ stake, stopLoss: stake, takeProfit });

                setTimeout(() => {
                    toast({
                        title: `🤖 Piloto Automático: Sinal ${signal!.toUpperCase()}!`,
                        description: `Tendência ${currentTrend} confirmada. Stake de $${stake.toFixed(2)} (ATR ajustado).`,
                    });
                }, 0);
                
                const result = await executeTrade(
                    signal === 'up' ? 'MULTUP' : 'MULTDOWN',
                    stake,
                    activeSymbol,
                    form.getValues('multiplier'),
                    takeProfit,
                    stake, // Stop-loss é o próprio stake
                    undefined,
                    'Piloto'
                );

                if (result.success && result.contractId) {
                    openPositionsRef.current.add(result.contractId);
                }

                await new Promise(resolve => setTimeout(resolve, 10000));
            } else {
                 setBotStatus('TREND_FOUND');
            }

            executionRef.current.isExecuting = false;
        };

        executeLogic();

    }, [
        botCandleData, isAutopilotOn, isConnected, activeSymbol,
        executeTrade, toast, accountBalance, form, dailyPnL, dailyBalance, dailyTarget, setIsAutopilotOn
    ]);


    const toggleAutopilot = useCallback(() => {
        setIsAutopilotOn(prevState => {
            const newState = !prevState;
            setTimeout(() => {
                toast({
                    title: `Piloto Automático ${newState ? 'Ativado' : 'Desativado'}`,
                    description: `O sistema ${newState ? 'começará a' : 'parou de'} procurar oportunidades.`,
                });
            }, 0);
            if (!newState) {
                setBotStatus('PAUSED');
                lastRsiRef.current = null;
                openPositionsRef.current.clear();
            } else {
                setBotStatus('MONITORING');
            }
            return newState;
        });
    }, [toast]);
    
    return {
        isAutopilotOn,
        toggleAutopilot,
        botStatus,
        trend,
        calculatedRisk,
        dailyBalance,
        setDailyBalance,
        dailyTarget,
        setDailyTarget,
        dailyPnL,
    };
}
