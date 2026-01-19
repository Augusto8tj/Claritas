// src/features/trading/hooks/use-multipliers-council.ts
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDerivApiMultipliers } from './use-deriv-api-multipliers';
import { useToast } from '@/hooks/use-toast';
import type { TickData } from '@/lib/types';
import { useFormContext } from 'react-hook-form';
import type { MultipliersFormValues } from '../components/deriv-trader/deriv-trader-interface-multipliers.types';

// Simple decision logic based on moving average
const calculateSimpleMA = (ticks: TickData[], period: number): number | null => {
    if (ticks.length < period) return null;
    const slice = ticks.slice(-period);
    const sum = slice.reduce((acc, tick) => acc + tick.price, 0);
    return sum / period;
};

export function useMultipliersCouncil(activeSymbol: string | null, priceTicks: TickData[]) {
    const { executeTrade, isConnected } = useDerivApiMultipliers();
    const { toast } = useToast();
    const form = useFormContext<MultipliersFormValues>();

    const [isAutopilotOn, setIsAutopilotOn] = useState(false);
    const [lastSignal, setLastSignal] = useState<'up' | 'down' | null>(null);
    const executionRef = useRef({ isExecuting: false });

    // This effect contains the core trading logic
    useEffect(() => {
        if (!isAutopilotOn || !isConnected || !activeSymbol || priceTicks.length < 20) {
            return;
        }

        if (executionRef.current.isExecuting) return;
        
        const executeLogic = async () => {
            executionRef.current.isExecuting = true;

            const shortMA = calculateSimpleMA(priceTicks, 5);
            const longMA = calculateSimpleMA(priceTicks, 20);

            if (shortMA === null || longMA === null) {
                executionRef.current.isExecuting = false;
                return;
            }

            const currentSignal = shortMA > longMA ? 'up' : 'down';

            // Only trade on a new signal
            if (currentSignal !== lastSignal) {
                setLastSignal(currentSignal);
                
                const { stake, multiplier, takeProfit, stopLoss } = form.getValues();

                toast({
                    title: `🤖 Piloto Automático de Multiplicadores`,
                    description: `Sinal de ${currentSignal.toUpperCase()} detectado para ${activeSymbol}. Executando ordem...`,
                });
                
                await executeTrade(
                    currentSignal === 'up' ? 'MULTUP' : 'MULTDOWN',
                    stake,
                    activeSymbol,
                    multiplier,
                    takeProfit,
                    stopLoss,
                    'Piloto'
                );

                // Wait for a few seconds before allowing another trade
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            executionRef.current.isExecuting = false;
        };

        executeLogic();

    }, [
        priceTicks, isAutopilotOn, isConnected, activeSymbol, lastSignal, 
        executeTrade, toast, form
    ]);

    const toggleAutopilot = () => {
        setIsAutopilotOn(prev => {
            const newState = !prev;
            toast({
                title: `Piloto Automático ${newState ? 'Ativado' : 'Desativado'}`,
                description: `O sistema ${newState ? 'começará a' : 'parou de'} procurar oportunidades.`,
            });
            if (!newState) {
                setLastSignal(null); // Reset signal when turning off
            }
            return newState;
        });
    };
    
    return {
        isAutopilotOn,
        toggleAutopilot,
    };
}
