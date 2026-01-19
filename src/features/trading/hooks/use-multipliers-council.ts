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
    const lastSignalRef = useRef<'up' | 'down' | null>(null);
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
            if (currentSignal !== lastSignalRef.current) {
                lastSignalRef.current = currentSignal;
                
                const { stake, multiplier, takeProfit, stopLoss } = form.getValues();

                setTimeout(() => {
                    toast({
                        title: `🤖 Piloto Automático de Multiplicadores`,
                        description: `Sinal de ${currentSignal.toUpperCase()} detectado para ${activeSymbol}. Executando ordem...`,
                    });
                }, 0);
                
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
        priceTicks, isAutopilotOn, isConnected, activeSymbol,
        executeTrade, toast, form
    ]);

    const toggleAutopilot = () => {
        const newState = !isAutopilotOn;
        setIsAutopilotOn(newState);
        
        // Efeito colateral (toast) é chamado *depois* da atualização do estado.
        toast({
            title: `Piloto Automático ${newState ? 'Ativado' : 'Desativado'}`,
            description: `O sistema ${newState ? 'começará a' : 'parou de'} procurar oportunidades.`,
        });

        if (!newState) {
            lastSignalRef.current = null; // Reset signal ref when turning off
        }
    };
    
    return {
        isAutopilotOn,
        toggleAutopilot,
    };
}
