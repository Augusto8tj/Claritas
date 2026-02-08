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

export type PilotType = 'matchesDiffers' | 'overUnder' | 'evenOdd' | 'underdog';

type CouncilStrategy = {
  id: string;
  type: 'DIGITDIFF' | 'DIGITMATCH' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';
  description: string;
  pilot: PilotType;
  prediction?: number;
};

export type AutopilotStatus = 'PAUSED' | 'TRADING' | 'COOLDOWN';
const MARTINGALE_MULTIPLIER = 2.15; // Cobre a perda e adiciona um pequeno lucro
const BASE_STAKE = 0.35;

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
  currentTarget?: string;
  lastStake: number;
}

// ============================================================================
// HOOK PRINCIPAL
// ============================================================================
export function useRobotCouncilDigits(activeSymbol: string | null, priceTicks: TickData[], activeAsset: Asset | null) {
  const { toast } = useToast();
  const { executeTrade, operationsLog } = useDerivApiDigits();

  // --- General Settings ---
  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusThreshold, setConsensusThreshold] = useState(25);
  
  // --- Underdog Specific Settings ---
  const [underdogThreshold, setUnderdogThreshold] = useState(5.0);
  const [isUnderdogInverse, setIsUnderdogInverse] = useState(false);

  // --- Risk Management Settings ---
  const [martingaleEnabled, setMartingaleEnabled] = useState(false);
  const [cooldownTime, setCooldownTime] = useState(10); // in seconds
  const [maxLosses, setMaxLosses] = useState(5);

  const initialPilotState: Record<PilotType, PilotState> = {
    matchesDiffers: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, currentTarget: undefined, lastStake: BASE_STAKE },
    overUnder: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, currentTarget: 'Acima de 4', lastStake: BASE_STAKE },
    evenOdd: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, currentTarget: 'Par', lastStake: BASE_STAKE },
    underdog: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, currentTarget: undefined, lastStake: BASE_STAKE },
  };

  const [pilots, setPilots] = useState<Record<PilotType, PilotState>>(initialPilotState);

  const processedLossesRef = useRef<Set<number>>(new Set());
  const cooldownTimersRef = useRef<Record<PilotType, NodeJS.Timeout | null>>({
    matchesDiffers: null,
    overUnder: null,
    evenOdd: null,
    underdog: null,
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
                consecutiveLosses: 0,
                lastStake: BASE_STAKE, // Reset stake on toggle
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
            if(!prevPilots[pilotType]) return prevPilots;
            const newConsecutiveLosses = (prevPilots[pilotType]?.consecutiveLosses || 0) + 1;
            const newStake = martingaleEnabled ? prevPilots[pilotType].lastStake * MARTINGALE_MULTIPLIER : BASE_STAKE;

            if (newConsecutiveLosses >= maxLosses) {
                if (prevPilots[pilotType].isOn) {
                    toggleAutopilot(pilotType, true); // Silent toggle
                    setTimeout(() => toast({
                        title: `Piloto ${pilotType} Pausado Automaticamente`,
                        description: `Limite de ${maxLosses} perdas consecutivas atingido.`,
                        variant: 'destructive',
                    }), 0);
                }
                 return { ...prevPilots, [pilotType]: { ...prevPilots[pilotType], consecutiveLosses: newConsecutiveLosses, lastStake: BASE_STAKE } };
            }
            
            setTimeout(() => {
                toast({ title: `📉 Perda Detectada! (${pilotType})`, description: `Piloto entrará em cooldown por ${cooldownTime} segundos. Perdas seguidas: ${newConsecutiveLosses}.`, variant: 'destructive' });
            }, 0);
            
            if (cooldownTimersRef.current[pilotType]) {
                clearTimeout(cooldownTimersRef.current[pilotType]!);
            }

            cooldownTimersRef.current[pilotType] = setTimeout(() => {
                setPilots(currentPilots => {
                    const pilotState = currentPilots[pilotType];
                    if (pilotState && pilotState.status === 'COOLDOWN') {
                        setTimeout(() => {
                            toast({ title: `✅ Cooldown Finalizado (${pilotType})`, description: 'Piloto está ativo novamente.' });
                        }, 0);
                        return { ...currentPilots, [pilotType]: { ...pilotState, status: 'TRADING' } };
                    }
                    return currentPilots;
                });
            }, cooldownTime * 1000);

            return {
              ...prevPilots,
              [pilotType]: { ...prevPilots[pilotType], status: 'COOLDOWN', consecutiveLosses: newConsecutiveLosses, lastStake: newStake }
            };
        });

    } else if (lastPilotTrade.status === 'won') {
        setPilots(prev => {
          if (!prev[pilotType]) return prev;
          return {
            ...prev,
            [pilotType]: { ...prev[pilotType], consecutiveLosses: 0, lastStake: BASE_STAKE }
          }
        });
    }
  }, [operationsLog, toast, martingaleEnabled, cooldownTime, maxLosses, toggleAutopilot]);

  const autopilotExecutionRef = useRef(false);
  useEffect(() => {
    if (autopilotExecutionRef.current || !activeSymbol) return;

    const runAutopilots = async () => {
        autopilotExecutionRef.current = true;
        
        const sortedByProb = [...digitStats].sort((a, b) => b.probability - a.probability);
        const mostProbable = sortedByProb[0];
        const leastProbable = sortedByProb[sortedByProb.length - 1];

        setPilots(prev => ({
            ...prev,
            matchesDiffers: { ...prev.matchesDiffers, currentTarget: `Difere de ${mostProbable?.digit}` },
            underdog: { ...prev.underdog, currentTarget: isUnderdogInverse ? `Difere de ${leastProbable?.digit}` : `Combina com ${leastProbable?.digit}` },
        }));

        for (const [type, state] of Object.entries(pilots)) {
            const pilotKey = type as PilotType;
            if (!state.isOn || state.status !== 'TRADING') continue;

             const pilotPnL = operationsLog
                .filter(op => op.initiator === `Piloto_${pilotKey}` && op.status !== 'pending')
                .reduce((sum, op) => sum + (op.result || 0), 0);
            
            if (pilotPnL <= -dailyBalance || pilotPnL >= dailyTarget) {
                if (state.isOn) {
                    toggleAutopilot(pilotKey, true);
                    setTimeout(() => toast({
                        title: `Piloto ${pilotKey} Desativado Automaticamente`,
                        description: pilotPnL <= -dailyBalance ? `Limite de perda de $${dailyBalance.toFixed(2)} atingido.` : `Meta de lucro de $${dailyTarget.toFixed(2)} atingida.`,
                        variant: pilotPnL <= -dailyBalance ? 'destructive' : 'default',
                    }), 0);
                }
                continue;
            }

            if (state.consecutiveLosses >= maxLosses) {
                 if (state.isOn) {
                    toggleAutopilot(pilotKey, true);
                    setTimeout(() => toast({ title: `Piloto ${pilotKey} Pausado`, description: `Limite de ${maxLosses} perdas consecutivas atingido.`, variant: 'destructive' }), 0);
                 }
                continue;
            }

            let signalType: CouncilStrategy['type'] | null = null;
            let predictionDigit: number | undefined;
            const stake = state.lastStake;

            if (pilotKey === 'matchesDiffers') {
                if (mostProbable && mostProbable.probability > consensusThreshold) {
                    signalType = 'DIGITDIFF';
                    predictionDigit = mostProbable.digit;
                }
            } else if (pilotKey === 'overUnder') {
                const overUnderThreshold = consensusThreshold + 15;
                const probOver4 = digitStats.filter(s => s.digit > 4).reduce((sum, s) => sum + s.probability, 0);
                const probUnder5 = digitStats.filter(s => s.digit < 5).reduce((sum, s) => sum + s.probability, 0);

                if (probOver4 > overUnderThreshold) {
                    signalType = 'DIGITOVER';
                    predictionDigit = 4;
                } else if (probUnder5 > overUnderThreshold) {
                    signalType = 'DIGITUNDER';
                    predictionDigit = 5;
                }
            } else if (pilotKey === 'evenOdd') {
                const evenOddThreshold = consensusThreshold + 15;
                const probEven = digitStats.filter(s => s.digit % 2 === 0).reduce((sum, s) => sum + s.probability, 0);
                
                if (probEven > evenOddThreshold) {
                    signalType = 'DIGITEVEN';
                } else if ((100 - probEven) > evenOddThreshold) {
                    signalType = 'DIGITODD';
                }
            } else if (pilotKey === 'underdog') {
                if (leastProbable && leastProbable.probability < underdogThreshold) {
                    signalType = isUnderdogInverse ? 'DIGITDIFF' : 'DIGITMATCH';
                    predictionDigit = leastProbable.digit;
                }
            }
            
            if (signalType) {
                await executeTrade(signalType, stake, activeSymbol, 1, 't', `Piloto_${pilotKey}`, predictionDigit);
            }
        }
        
        setTimeout(() => { autopilotExecutionRef.current = false; }, 2000);
    };

    const timeoutId = setTimeout(runAutopilots, 100);
    return () => clearTimeout(timeoutId);

  }, [pilots, digitStats, consensusThreshold, activeSymbol, executeTrade, operationsLog, dailyBalance, dailyTarget, toggleAutopilot, toast, underdogThreshold, isUnderdogInverse, martingaleEnabled, cooldownTime, maxLosses]);
  
  return {
    isCouncilAutopilotOn: Object.values(pilots).some(p => p.isOn),
    dailyBalance, setDailyBalance,
    dailyTarget, setDailyTarget,
    consensusThreshold, setConsensusThreshold,
    digitStats,
    toggleAutopilot,
    pilots,
    underdogThreshold, setUnderdogThreshold,
    isUnderdogInverse, setIsUnderdogInverse,
    martingaleEnabled, setMartingaleEnabled,
    cooldownTime, setCooldownTime,
    maxLosses, setMaxLosses,
  };
}

    