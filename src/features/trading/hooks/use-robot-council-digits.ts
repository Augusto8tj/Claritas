// src/features/trading/hooks/use-robot-council-digits.ts
'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { RobotStrategy, TickData } from '@/lib/types';
import { useDerivApiDigits } from './use-deriv-api-digits';

export type DigitStats = {
    digit: number;
    count: number;
    probability: number;
};

export function useRobotCouncilDigits(activeSymbol: string | null, priceTicks: TickData[]) {
  const { toast } = useToast();
  const { executeTrade } = useDerivApiDigits();

  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusThreshold, setConsensusThreshold] = useState(25); // Ex: 25% de probabilidade para agir
  
  const autopilotExecutionRef = useRef(false);

  const digitStats: DigitStats[] = useMemo(() => {
    if (priceTicks.length < 100) {
        return Array.from({length: 10}, (_, i) => ({ digit: i, count: 0, probability: 10 }));
    }
    const counts = Array(10).fill(0);
    priceTicks.forEach(tick => {
        const lastDigit = parseInt(String(tick.price).slice(-1));
        if (!isNaN(lastDigit)) {
            counts[lastDigit]++;
        }
    });

    const total = counts.reduce((a, b) => a + b, 0);
    return counts.map((count, i) => ({
        digit: i,
        count: count,
        probability: total > 0 ? (count / total) * 100 : 10,
    }));
  }, [priceTicks]);
  
  const councilDecision = useMemo(() => {
    if (digitStats.every(s => s.probability === 10)) return { type: 'hold', digit: -1, probability: 0 };
    
    const sortedByProb = [...digitStats].sort((a, b) => b.probability - a.probability);
    const mostProbable = sortedByProb[0];
    const leastProbable = sortedByProb[sortedByProb.length - 1];

    if (mostProbable.probability > consensusThreshold) {
        return { type: 'differs', digit: mostProbable.digit, probability: mostProbable.probability };
    }
    
    // Inversão: se a probabilidade mais baixa for MUITO baixa, é um sinal de MATCH
    if (leastProbable.probability < (10 - consensusThreshold / 4)) {
         return { type: 'matches', digit: leastProbable.digit, probability: 100 - leastProbable.probability };
    }

    return { type: 'hold', digit: -1, probability: 0 };
  }, [digitStats, consensusThreshold]);
  
  useEffect(() => {
    if (!isCouncilAutopilotOn || !activeSymbol || autopilotExecutionRef.current) return;
    
    const runAutopilot = async () => {
        autopilotExecutionRef.current = true;

        const { type, digit } = councilDecision;
        if (type !== 'hold' && digit !== -1) {
            toast({
                title: '🤖 Piloto de Dígitos Acionado!',
                description: `Sinal para ${type} dígito ${digit}. Executando...`
            });

            await executeTrade(
                type === 'matches' ? 'DIGITMATCH' : 'DIGITDIFF',
                0.35, // Stake fixo para piloto
                activeSymbol,
                digit,
                5, // Duração fixa
                't',
                'Piloto'
            );
        }

        // Previne execuções muito rápidas
        setTimeout(() => { autopilotExecutionRef.current = false }, 2000);
    };

    runAutopilot();

  }, [isCouncilAutopilotOn, councilDecision, activeSymbol, executeTrade, toast]);


  const fetchStrategyCouncil = useCallback(() => {
    setIsCouncilAutopilotOn(true);
    toast({ title: 'Piloto Automático de Dígitos Ativado', description: 'O sistema irá operar com base nas probabilidades.' });
  }, [toast]);

  const dissolveCouncil = useCallback(() => {
    setIsCouncilAutopilotOn(false);
    toast({ title: 'Piloto Automático de Dígitos Desativado' });
  }, [toast]);

  return {
    isCouncilAutopilotOn,
    setIsCouncilAutopilotOn,
    fetchStrategyCouncil,
    dissolveCouncil,
    isFetchingCouncil: false,
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
    consensusThreshold,
    setConsensusThreshold,
    digitStats,
    councilDecision,
    // --- Valores de placeholder para compatibilidade ---
    robotPerformance: [],
    evolutionHistory: [],
    councilVotes: {},
    activeCommittee: null,
    supervisionStatus: { status: 'inactive', message: 'N/A' },
    consensusSum: { rise: 0, fall: 0 },
    isMeritocracyOn: false,
    setIsMeritocracyOn: () => {},
  };
}
