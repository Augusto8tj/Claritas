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
    
    const [calculatedRisk, setCalculatedRisk] = useState({ stake: 0.35, stopLoss: 0.35, takeProfit: 0.70 });

    const lastRsiRef = useRef<number | null>(null);
    const executionRef = useRef({ isExecuting: false });
    const openPositionsRef = useRef<Set<number>>(new Set());

    // Core Trading Logic
    useEffect(() => {
        if (!isAutopilotOn || !isConnected || !activeSymbol || botCandleData.length < LONG_EMA_PERIOD) {
            setBotStatus(isAutopilotOn ? 'MONITORING' : 'PAUSED');
            return;
        }

        if (executionRef.current.isExecuting) return;
        
        const executeLogic = async () => {
            executionRef.current.isExecuting = true;

            const indicators = calculateAllIndicators(botCandleData, initialCouncilStrategies, '1m', {duration: 15, unit: 's'});
            if (!indicators || !indicators.rsi || !indicators.ma.long || !accountBalance) {
                setBotStatus('MONITORING');
                executionRef.current.isExecuting = false;
                return;
            }
            
            const lastPrice = botCandleData[botCandleData.length - 1].close;
            const longEMA = indicators.ma.long;
            const rsi = indicators.rsi;
            
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
            lastRsiRef.current = rsi;

            if (signal) {
                setBotStatus('EXECUTING_TRADE');

                // 3. Gestão de Risco e Tamanho da Posição
                const riskPercentage = 0.01; // 1% da banca
                const stake = Math.max(0.35, accountBalance * riskPercentage);
                const takeProfit = stake * 2; // Relação R:R de 1:2
                
                // Para a UI, mostramos o risco como sendo o stake total.
                setCalculatedRisk({ stake, stopLoss: stake, takeProfit });

                setTimeout(() => {
                    toast({
                        title: `🤖 Piloto Automático: Sinal ${signal!.toUpperCase()}!`,
                        description: `Tendência ${currentTrend} confirmada com cruzamento do RSI. Executando ordem para ${activeSymbol}.`,
                    });
                }, 0);
                
                const result = await executeTrade(
                    signal === 'up' ? 'MULTUP' : 'MULTDOWN',
                    stake,
                    activeSymbol,
                    form.getValues('multiplier'),
                    takeProfit,
                    undefined, // Não definimos stop_loss, o risco máximo é o stake.
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
        executeTrade, toast, accountBalance, form
    ]);
    
     // Trailing Stop Logic (Client-Side)
    useEffect(() => {
        if (!isAutopilotOn || openPositionsRef.current.size === 0) return;

        const checkTrailingStops = () => {
            const openOps = operationsLog.filter(op => openPositionsRef.current.has(op.id) && op.status === 'pending');

            openOps.forEach(op => {
                const tp = calculatedRisk.takeProfit;
                const currentProfit = op.result || 0;

                // Trailing Take Profit: Se atingir 50% do alvo, encerra para travar o lucro.
                if (tp > 0 && currentProfit >= tp * 0.5) {
                    setTimeout(() => {
                        toast({
                            title: "📈 Trailing Take Profit Acionado!",
                            description: `Garantindo lucro de $${currentProfit.toFixed(2)} no contrato #${op.id}.`
                        });
                    }, 0);
                    sellContract(op.id);
                    openPositionsRef.current.delete(op.id);
                }
            });
        };
        
        const intervalId = setInterval(checkTrailingStops, 2000);
        return () => clearInterval(intervalId);

    }, [isAutopilotOn, operationsLog, calculatedRisk, sellContract, toast]);


    const toggleAutopilot = () => {
        const newState = !isAutopilotOn;
        setIsAutopilotOn(newState);
        
        // A notificação agora é disparada de forma síncrona
        toast({
            title: `Piloto Automático ${newState ? 'Ativado' : 'Desativado'}`,
            description: `O sistema ${newState ? 'começará a' : 'parou de'} procurar oportunidades.`,
        });

        if (!newState) {
            setBotStatus('PAUSED');
            lastRsiRef.current = null;
        } else {
            setBotStatus('MONITORING');
        }
    };
    
    return {
        isAutopilotOn,
        toggleAutopilot,
        botStatus,
        trend,
        calculatedRisk,
    };
}
