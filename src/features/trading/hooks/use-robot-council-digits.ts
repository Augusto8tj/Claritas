// src/features/trading/hooks/use-robot-council-digits.ts
'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { TickData, Asset, Operation } from '@/lib/types';
import { useDerivApiDigits } from './use-deriv-api-digits';

// ============================================================================
// TIPOS E CONFIGURAÇÕES
// ============================================================================
export type DigitStats = {
    digit: number;
    count: number;
    probability: number;
};

export type PilotType = 'matchesDiffers' | 'overUnder' | 'evenOdd';

type CouncilStrategy = {
  id: string;
  type: 'DIGITDIFF' | 'DIGITMATCH' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';
  description: string;
  pilot: PilotType;
  prediction?: number;
};

export type AutopilotStatus = 'PAUSED' | 'TRADING' | 'COOLDOWN';
const COOLDOWN_AFTER_LOSS_MS = 10000; // 10 segundos
const MAX_CONSECUTIVE_LOSSES = 5;

const getDecimalPlaces = (pipSize: number | undefined): number => {
    if (pipSize === undefined || pipSize === null || pipSize <= 0) return 2;
    if (Math.floor(pipSize) === pipSize && pipSize >= 1) return 0;
    const pipString = String(pipSize);
    if (pipString.includes('.')) return pipString.split('.')[1].length;
    return 0;
};

export interface PilotState {
  isOn: boolean;
  status: AutopilotStatus;
  consecutiveLosses: number;
}

// ============================================================================
// HOOK PRINCIPAL
// ============================================================================
export function useRobotCouncilDigits(activeSymbol: string | null, priceTicks: TickData[], activeAsset: Asset | null) {
  const { toast } = useToast();
  const { executeTrade, operationsLog } = useDerivApiDigits();

  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusThreshold, setConsensusThreshold] = useState(25);

  const initialPilotState: Record<PilotType, PilotState> = {
    matchesDiffers: { isOn: false, status: 'PAUSED', consecutiveLosses: 0 },
    overUnder: { isOn: false, status: 'PAUSED', consecutiveLosses: 0 },
    evenOdd: { isOn: false, status: 'PAUSED', consecutiveLosses: 0 },
  };

  const [pilots, setPilots] = useState<Record<PilotType, PilotState>>(initialPilotState);

  const processedLossesRef = useRef<Set<number>>(new Set());
  const cooldownTimersRef = useRef<Record<PilotType, NodeJS.Timeout | null>>({
    matchesDiffers: null,
    overUnder: null,
    evenOdd: null,
  });
  
  const digitStats: DigitStats[] = useMemo(() => {
    if (priceTicks.length < 100) {
      return Array.from({ length: 10 }, (_, i) => ({ digit: i, count: 0, probability: 10 }));
    }
    const decimalPlaces = getDecimalPlaces(activeAsset?.pip);
    const counts = Array(10).fill(0);
    const last100Ticks = priceTicks.slice(-100);
    
    last100Ticks.forEach(tick => {
        const priceString = tick.price.toFixed(decimalPlaces);
        const lastChar = priceString.slice(-1);
        const digit = parseInt(lastChar, 10);
        if (!isNaN(digit)) {
            counts[digit]++;
        }
    });

    const total = counts.reduce((a, b) => a + b, 0);
    return counts.map((count, i) => ({
      digit: i,
      count: count,
      probability: total > 0 ? (count / total) * 100 : 10,
    }));
  }, [priceTicks, activeAsset]);

  const toggleAutopilot = useCallback((pilotType: PilotType, silent: boolean = false) => {
    setPilots(prev => {
        const isActivating = !prev[pilotType].isOn;
        if (!silent) {
            setTimeout(() => toast({ title: `Piloto ${pilotType} ${isActivating ? 'Ativado' : 'Desativado'}` }), 0);
        }
        if (!isActivating && cooldownTimersRef.current[pilotType]) {
            clearTimeout(cooldownTimersRef.current[pilotType]!);
        }
        return {
            ...prev,
            [pilotType]: { 
                ...prev[pilotType],
                isOn: isActivating,
                status: isActivating ? 'TRADING' : 'PAUSED',
                consecutiveLosses: 0 // Reseta ao ligar/desligar
            }
        };
    });
  }, [toast]);
  
  useEffect(() => {
    const lastPilotTrade = operationsLog.find(op => op.initiator?.startsWith('Piloto_') && !processedLossesRef.current.has(op.id) && op.status !== 'pending');
    if (!lastPilotTrade) return;
  
    processedLossesRef.current.add(lastPilotTrade.id);
    const pilotType = lastPilotTrade.initiator!.split('_')[1] as PilotType;
    
    if (lastPilotTrade.status === 'lost') {
        setPilots(prevPilots => {
            const newConsecutiveLosses = (prevPilots[pilotType]?.consecutiveLosses || 0) + 1;
            
            setTimeout(() => {
                toast({ title: `📉 Perda Detectada! (${pilotType})`, description: `Piloto entrará em cooldown por ${COOLDOWN_AFTER_LOSS_MS/1000} segundos. Perdas seguidas: ${newConsecutiveLosses}.`, variant: 'destructive' });
            }, 0);
            
            if (cooldownTimersRef.current[pilotType]) {
                clearTimeout(cooldownTimersRef.current[pilotType]!);
            }

            cooldownTimersRef.current[pilotType] = setTimeout(() => {
                setPilots(currentPilots => {
                    const pilotState = currentPilots[pilotType];
                    if (pilotState.consecutiveLosses < MAX_CONSECUTIVE_LOSSES) {
                        setTimeout(() => {
                            toast({ title: `✅ Cooldown Finalizado (${pilotType})`, description: 'Piloto está ativo novamente.' });
                        }, 0);
                        return { ...currentPilots, [pilotType]: { ...pilotState, status: 'TRADING' } };
                    }
                    return currentPilots;
                });
            }, COOLDOWN_AFTER_LOSS_MS);

            return {
              ...prevPilots,
              [pilotType]: { ...prevPilots[pilotType], status: 'COOLDOWN', consecutiveLosses: newConsecutiveLosses }
            };
        });

    } else if (lastPilotTrade.status === 'won') {
        setPilots(prev => ({
          ...prev,
          [pilotType]: { ...prev[pilotType], consecutiveLosses: 0 }
        }));
    }
  }, [operationsLog, toast]);

  const autopilotExecutionRef = useRef(false);
  useEffect(() => {
    if (autopilotExecutionRef.current || !activeSymbol) return;

    const runAutopilots = async () => {
        autopilotExecutionRef.current = true;
        const sortedByProb = [...digitStats].sort((a, b) => b.probability - a.probability);

        for (const [type, state] of Object.entries(pilots)) {
            const pilotKey = type as PilotType;
            if (!state.isOn || state.status !== 'TRADING') continue;

             const pilotPnL = operationsLog
                .filter(op => op.initiator === `Piloto_${pilotKey}` && op.status !== 'pending')
                .reduce((sum, op) => sum + (op.result || 0), 0);
            
            if (pilotPnL <= -dailyBalance || pilotPnL >= dailyTarget) {
                if (state.isOn) {
                    toggleAutopilot(pilotKey, true); // Desativa silenciosamente
                    setTimeout(() => toast({
                        title: `Piloto ${pilotKey} Desativado Automaticamente`,
                        description: pilotPnL <= -dailyBalance ? `Limite de perda de $${dailyBalance.toFixed(2)} atingido.` : `Meta de lucro de $${dailyTarget.toFixed(2)} atingida.`,
                        variant: pilotPnL <= -dailyBalance ? 'destructive' : 'default',
                    }), 0);
                }
                continue;
            }

            if (state.consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
                 if (state.isOn) {
                    toggleAutopilot(pilotKey, true); // Desativa silenciosamente
                    setTimeout(() => toast({ title: `Piloto ${pilotKey} Pausado`, description: `Limite de ${MAX_CONSECUTIVE_LOSSES} perdas consecutivas atingido.`, variant: 'destructive' }), 0);
                 }
                continue;
            }

            let signalType: CouncilStrategy['type'] | null = null;
            let predictionDigit: number | undefined;
            const threshold = consensusThreshold;
            const stake = 0.35; // Aposta mínima fixa

            if (pilotKey === 'matchesDiffers') {
                if (sortedByProb[0] && sortedByProb[0].probability > threshold) {
                    signalType = 'DIGITDIFF';
                    predictionDigit = sortedByProb[0].digit;
                }
            } else if (pilotKey === 'evenOdd') {
                const probEven = digitStats.filter(s => s.digit % 2 === 0).reduce((sum, s) => sum + s.probability, 0);
                const evenOddThreshold = threshold + 15; // Threshold mais alto
                if (probEven > evenOddThreshold) {
                    signalType = 'DIGITEVEN';
                } else if ((100 - probEven) > evenOddThreshold) {
                    signalType = 'DIGITODD';
                }
            } else if (pilotKey === 'overUnder') {
                const overUnderThreshold = threshold + 15;
                const probOver4 = digitStats.filter(s => s.digit > 4).reduce((sum, s) => sum + s.probability, 0);
                const probUnder5 = digitStats.filter(s => s.digit < 5).reduce((sum, s) => sum + s.probability, 0);

                if (probOver4 > overUnderThreshold) {
                    signalType = 'DIGITOVER';
                    predictionDigit = 4;
                } else if (probUnder5 > overUnderThreshold) {
                    signalType = 'DIGITUNDER';
                    predictionDigit = 5;
                }
            }
            
            if (signalType) {
                await executeTrade(signalType, stake, activeSymbol, 1, 't', `Piloto_${pilotKey}`, predictionDigit);
            }
        }
        
        setTimeout(() => { autopilotExecutionRef.current = false; }, 2000); // Cooldown global para evitar rajadas de trades
    };

    runAutopilots();
  }, [pilots, digitStats, consensusThreshold, activeSymbol, executeTrade, operationsLog, dailyBalance, dailyTarget, toggleAutopilot, toast]);
  
  return {
    isCouncilAutopilotOn: Object.values(pilots).some(p => p.isOn),
    dailyBalance, setDailyBalance,
    dailyTarget, setDailyTarget,
    consensusThreshold, setConsensusThreshold,
    digitStats,
    toggleAutopilot,
    pilots,
  };
}
