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
    
    const [calculatedRisk, setCalculatedRisk] = useState({ stake: 1.0, stopLoss: 1.0, takeProfit: 2.0 });

    const lastRsiRef = useRef<number | null>(null);
    const executionRef = useRef({ isExecuting: false });
    const openPositionsRef = useRef<Set<number>>(new Set());
    const lastSignalRef = useRef<'up' | 'down' | null>(null);
    const highestProfitRef = useRef<Map<number, number>>(new Map());

    // Cleanup closed positions from refs
    useEffect(() => {
        const openContractIds = new Set(operationsLog.filter(op => op.status === 'pending').map(op => op.id));
        
        for (const id of openPositionsRef.current) {
            if (!openContractIds.has(id)) {
                openPositionsRef.current.delete(id);
                highestProfitRef.current.delete(id);
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
            
            const hasChangedDirection = lastSignalRef.current !== signal;
            lastRsiRef.current = rsi;

            if (signal && hasChangedDirection) {
                lastSignalRef.current = signal;
                setBotStatus('EXECUTING_TRADE');

                // 3. Gestão de Risco e Tamanho da Posição baseada em ATR
                const baseRiskPercentage = 0.01; // 1%
                const atr = indicators.atr || 0;
                const normalizedAtr = atr > 0 && lastPrice > 0 ? atr / lastPrice : 0.001; // ATR como % do preço

                const volatilityFactor = normalizedAtr / 0.0005; // Normalizado contra uma volatilidade "padrão" de 0.05%
                const cappedVolatilityFactor = Math.max(0.5, Math.min(2.0, volatilityFactor));
                const adjustedRiskPercentage = baseRiskPercentage / cappedVolatilityFactor;
                
                const stake = Math.max(1.0, accountBalance * adjustedRiskPercentage);
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
                    highestProfitRef.current.set(result.contractId, 0); // Inicia o tracking de lucro
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
                const currentProfit = op.result || 0;
                const contractId = op.id;
                
                const highestProfit = highestProfitRef.current.get(contractId) || 0;

                // Update highest profit for the contract
                if (currentProfit > highestProfit) {
                    highestProfitRef.current.set(contractId, currentProfit);
                }

                // Define a trailing distance, e.g., 50% of the initial take profit target.
                const takeProfitTarget = op.takeProfit || (op.stake * 2);
                const trailingDistance = takeProfitTarget * 0.5; // Trail by 50% of the original TP target

                // Check if trailing stop is hit
                if (highestProfit > 0.1 && // Only start trailing after a small profit is made
                    currentProfit < highestProfit - trailingDistance) {

                    setTimeout(() => {
                        toast({
                            title: "📈 Trailing Stop Acionado!",
                            description: `Protegendo lucro no contrato #${contractId}. Vendendo com lucro de $${currentProfit.toFixed(2)}.`,
                        });
                    }, 0);
                    
                    sellContract(contractId);
                    openPositionsRef.current.delete(contractId);
                    highestProfitRef.current.delete(contractId);
                }
            });
        };
        
        const intervalId = setInterval(checkTrailingStops, 2000); // Check every 2 seconds
        return () => clearInterval(intervalId);

    }, [isAutopilotOn, operationsLog, sellContract, toast]);


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
                highestProfitRef.current.clear();
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
    };
}
