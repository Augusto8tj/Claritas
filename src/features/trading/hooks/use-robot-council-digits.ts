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

export type PilotType = 'matchesDiffers' | 'overUnder' | 'evenOdd' | 'underdog' | 'underdogOverUnder' | 'dynamicUnderdogOverUnder' | 'underdogEvenOdd';

type CouncilStrategy = {
  id: string;
  type: 'DIGITDIFF' | 'DIGITMATCH' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';
  description: string;
  pilot: PilotType;
  prediction?: number;
};

export type AutopilotStatus = 'PAUSED' | 'TRADING' | 'COOLDOWN';
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
  accumulatedLoss: number;
  currentTarget?: string;
  lastStake: number;
}

const getPayoutRate = (contractType?: string): number => {
    if (!contractType) return 0.95; // default fallback
    switch (contractType) {
        case 'DIGITDIFF':
            return 0.10; // ~10% for differs
        case 'DIGITMATCH':
            return 8.5;  // ~850% for matches
        case 'DIGITOVER':
        case 'DIGITUNDER':
        case 'DIGITEVEN':
        case 'DIGITODD':
            return 0.95; // ~95% for these
        default:
            return 0.95;
    }
};

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
  
  // --- Over/Under & Even/Odd thresholds ---
  const [overUnderThreshold, setOverUnderThreshold] = useState(65);
  const [evenOddThreshold, setEvenOddThreshold] = useState(65);
  
  // --- Underdog Specific Settings ---
  const [underdogThreshold, setUnderdogThreshold] = useState(5.0);
  const [isUnderdogInverse, setIsUnderdogInverse] = useState(false);

  // --- Over/Under Underdog Specific Settings ---
  const [overUnderUnderdogThreshold, setOverUnderUnderdogThreshold] = useState(40);
  
  // --- Even/Odd Underdog Specific Settings ---
  const [evenOddUnderdogThreshold, setEvenOddUnderdogThreshold] = useState(40);

  // --- Risk Management Settings ---
  const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(false);
  const [martingaleRecoveryFactor, setMartingaleRecoveryFactor] = useState(1.5);
  const [cooldownTime, setCooldownTime] = useState(0); // in seconds
  const [maxLosses, setMaxLosses] = useState(40);

  const initialPilotState: Record<PilotType, PilotState> = {
    matchesDiffers: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: undefined, lastStake: BASE_STAKE },
    overUnder: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: 'Acima de 4', lastStake: BASE_STAKE },
    evenOdd: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: 'Par', lastStake: BASE_STAKE },
    underdog: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: undefined, lastStake: BASE_STAKE },
    underdogOverUnder: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: 'Bloco Azarão Fixo', lastStake: BASE_STAKE },
    dynamicUnderdogOverUnder: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: 'Bloco Azarão Dinâmico', lastStake: BASE_STAKE },
    underdogEvenOdd: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: 'Bloco Par/Ímpar Azarão', lastStake: BASE_STAKE },
  };

  const [pilots, setPilots] = useState<Record<PilotType, PilotState>>(initialPilotState);

  const processedLossesRef = useRef<Set<number>>(new Set());
  const cooldownTimersRef = useRef<Record<PilotType, NodeJS.Timeout | null>>({
    matchesDiffers: null,
    overUnder: null,
    evenOdd: null,
    underdog: null,
    underdogOverUnder: null,
    dynamicUnderdogOverUnder: null,
    underdogEvenOdd: null,
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
        // Reset state on toggle
        return {
            ...prev,
            [pilotType]: { 
                ...prev[pilotType],
                isOn: isActivating,
                status: isActivating ? 'TRADING' : 'PAUSED',
                consecutiveLosses: 0,
                accumulatedLoss: 0, // Reset accumulated loss
                lastStake: BASE_STAKE,
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
            
            const pilotState = prevPilots[pilotType];
            const newConsecutiveLosses = pilotState.consecutiveLosses + 1;
            const newAccumulatedLoss = pilotState.accumulatedLoss + pilotState.lastStake;

            let newStake = BASE_STAKE;
            if (isMartingaleEnabled) {
                const payoutRate = getPayoutRate(lastPilotTrade.contractType);
                const profitTarget = BASE_STAKE * (martingaleRecoveryFactor - 1);

                if (payoutRate > 0) {
                    newStake = (newAccumulatedLoss + profitTarget) / payoutRate;
                } else {
                    newStake = newAccumulatedLoss * 2; // Fallback
                }
                
                newStake = Math.min(newStake, dailyBalance * 0.20);
                newStake = Math.max(BASE_STAKE, newStake);
            }

            if (newConsecutiveLosses >= maxLosses) {
                if (pilotState.isOn) {
                    toggleAutopilot(pilotType, true); 
                    setTimeout(() => toast({ title: `Piloto ${pilotType} Pausado`, description: `Limite de ${maxLosses} perdas consecutivas atingido.`, variant: 'destructive' }), 0);
                }
                 return { ...prevPilots, [pilotType]: { ...pilotState, consecutiveLosses: newConsecutiveLosses, lastStake: BASE_STAKE, accumulatedLoss: 0 } };
            }
            
            if (cooldownTime > 0) {
                setTimeout(() => toast({ title: `📉 Perda Detectada! (${pilotType})`, description: `Cooldown de ${cooldownTime}s. Perdas seguidas: ${newConsecutiveLosses}.`, variant: 'destructive' }), 0);
                if (cooldownTimersRef.current[pilotType]) clearTimeout(cooldownTimersRef.current[pilotType]!);

                cooldownTimersRef.current[pilotType] = setTimeout(() => {
                    setPilots(currentPilots => {
                        if (currentPilots[pilotType]?.status === 'COOLDOWN') {
                            setTimeout(() => toast({ title: `✅ Cooldown Finalizado (${pilotType})`, description: 'Piloto está ativo.' }), 0);
                            return { ...currentPilots, [pilotType]: { ...currentPilots[pilotType], status: 'TRADING' } };
                        }
                        return currentPilots;
                    });
                }, cooldownTime * 1000);
            }

            return {
              ...prevPilots,
              [pilotType]: { ...pilotState, status: cooldownTime > 0 ? 'COOLDOWN' : 'TRADING', consecutiveLosses: newConsecutiveLosses, accumulatedLoss: newAccumulatedLoss, lastStake: newStake }
            };
        });

    } else if (lastPilotTrade.status === 'won') {
        setPilots(prev => {
          if (!prev[pilotType]) return prev;
          return {
            ...prev,
            [pilotType]: { ...prev[pilotType], consecutiveLosses: 0, accumulatedLoss: 0, lastStake: BASE_STAKE }
          }
        });
    }
  }, [operationsLog, toast, isMartingaleEnabled, martingaleRecoveryFactor, cooldownTime, maxLosses, toggleAutopilot, dailyBalance]);

  const autopilotExecutionRef = useRef(false);
  useEffect(() => {
    if (autopilotExecutionRef.current || !activeSymbol) return;

    const runAutopilots = async () => {
        autopilotExecutionRef.current = true;
        
        const sortedByProb = [...digitStats].sort((a, b) => b.probability - a.probability);
        const mostProbable = sortedByProb[0];
        const leastProbable = sortedByProb[sortedByProb.length - 1];

        const probOver4 = digitStats.filter(s => s.digit > 4).reduce((sum, s) => sum + s.probability, 0);
        const probUnder5 = digitStats.filter(s => s.digit < 5).reduce((sum, s) => sum + s.probability, 0);
        const probEven = digitStats.filter(s => s.digit % 2 === 0).reduce((sum, s) => sum + s.probability, 0);
        const probOdd = 100 - probEven;
        
        // Update targets for UI feedback
        setPilots(prev => ({
            ...prev,
            matchesDiffers: { ...prev.matchesDiffers, currentTarget: `Difere de ${mostProbable?.digit}` },
            underdog: { ...prev.underdog, currentTarget: isUnderdogInverse ? `Difere de ${leastProbable?.digit}` : `Combina com ${leastProbable?.digit}` },
            overUnder: { ...prev.overUnder, currentTarget: probOver4 > probUnder5 ? 'Acima de 4' : 'Abaixo de 5'},
            underdogOverUnder: { ...prev.underdogOverUnder, currentTarget: 'Aguardando Bloco Azarão Fixo' },
            dynamicUnderdogOverUnder: { ...prev.dynamicUnderdogOverUnder, currentTarget: 'Aguardando Bloco Dinâmico' },
            underdogEvenOdd: { ...prev.underdogEvenOdd, currentTarget: probEven < probOdd ? 'Par (Azarão)' : 'Ímpar (Azarão)'},
        }));

        for (const [type, state] of Object.entries(pilots)) {
            const pilotKey = type as PilotType;
            if (!state.isOn || state.status !== 'TRADING') continue;

             const pilotPnL = operationsLog
                .filter(op => op.initiator === `Piloto_${pilotKey}` && op.status !== 'pending')
                .reduce((sum, op) => sum + (op.result || (op.status === 'lost' ? -op.stake : 0)), 0);
            
            if (pilotPnL <= -dailyBalance || pilotPnL >= dailyTarget) {
                if (state.isOn) {
                    toggleAutopilot(pilotKey, true);
                    setTimeout(() => toast({ title: `Piloto ${pilotKey} Desativado`, description: `Limite de ${pilotPnL <= -dailyBalance ? 'perda' : 'lucro'} atingido.`, variant: 'destructive' }), 0);
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

            // --- Lógica de Decisão do Piloto ---
            if (pilotKey === 'matchesDiffers') {
                if (mostProbable && mostProbable.probability > consensusThreshold) {
                    signalType = 'DIGITDIFF';
                    predictionDigit = mostProbable.digit;
                }
            } else if (pilotKey === 'overUnder') {
                if (probOver4 > overUnderThreshold) {
                    signalType = 'DIGITOVER';
                    predictionDigit = 4;
                } else if (probUnder5 > overUnderThreshold) {
                    signalType = 'DIGITUNDER';
                    predictionDigit = 5;
                }
            } else if (pilotKey === 'evenOdd') {
                if (probEven > evenOddThreshold) {
                    signalType = 'DIGITEVEN';
                } else if (probOdd > evenOddThreshold) {
                    signalType = 'DIGITODD';
                }
            } else if (pilotKey === 'underdog') {
                if (leastProbable && leastProbable.probability < underdogThreshold) {
                    signalType = isUnderdogInverse ? 'DIGITDIFF' : 'DIGITMATCH';
                    predictionDigit = leastProbable.digit;
                }
            } else if (pilotKey === 'underdogOverUnder') {
                if (probOver4 < overUnderUnderdogThreshold) {
                    signalType = 'DIGITOVER';
                    predictionDigit = 4;
                } else if (probUnder5 < overUnderUnderdogThreshold) {
                    signalType = 'DIGITUNDER';
                    predictionDigit = 5;
                }
            } else if (pilotKey === 'dynamicUnderdogOverUnder') {
                const underdogStats = sortedByProb.slice(-5);
                const leastProbableDigits = underdogStats.map(s => s.digit);
                const totalProbOfUnderdogs = underdogStats.reduce((sum, s) => sum + s.probability, 0);

                if (totalProbOfUnderdogs < overUnderUnderdogThreshold) { // Changed this to make more sense
                    const lowNumbersInUnderdogGroup = leastProbableDigits.filter(d => d < 5).length;
                    const highNumbersInUnderdogGroup = leastProbableDigits.filter(d => d > 4).length;

                    if (lowNumbersInUnderdogGroup >= 3) { // Relaxed from 4
                        signalType = 'DIGITOVER';
                        predictionDigit = 4;
                        setPilots(prev => ({...prev, dynamicUnderdogOverUnder: {...prev.dynamicUnderdogOverUnder, currentTarget: 'OVER 4 (Azarões são Baixos)'}}));
                    } else if (highNumbersInUnderdogGroup >= 3) { // Relaxed from 4
                        signalType = 'DIGITUNDER';
                        predictionDigit = 5;
                        setPilots(prev => ({...prev, dynamicUnderdogOverUnder: {...prev.dynamicUnderdogOverUnder, currentTarget: 'UNDER 5 (Azarões são Altos)'}}));
                    } else {
                        setPilots(prev => ({...prev, dynamicUnderdogOverUnder: {...prev.dynamicUnderdogOverUnder, currentTarget: 'Blocos Azarão Equilibrados'}}));
                    }
                } else {
                    setPilots(prev => ({...prev, dynamicUnderdogOverUnder: {...prev.dynamicUnderdogOverUnder, currentTarget: `Aguardando Prob. < ${overUnderUnderdogThreshold.toFixed(1)}%`}}));
                }
            } else if (pilotKey === 'underdogEvenOdd') {
                if (probEven < evenOddUnderdogThreshold) {
                    signalType = 'DIGITEVEN';
                } else if (probOdd < evenOddUnderdogThreshold) {
                    signalType = 'DIGITODD';
                }
            }
            
            if (signalType) {
                await executeTrade(signalType, stake, activeSymbol, 1, 't', `Piloto_${pilotKey}`, predictionDigit);
            }
        }
        
        setTimeout(() => { autopilotExecutionRef.current = false; }, 2000); // Cooldown para evitar trades em rajada
    };

    const timeoutId = setTimeout(runAutopilots, 250); // Aumentar ligeiramente o delay para permitir estabilização
    return () => clearTimeout(timeoutId);

  }, [
    pilots, digitStats, consensusThreshold, activeSymbol, executeTrade, 
    operationsLog, dailyBalance, dailyTarget, toggleAutopilot, toast, 
    underdogThreshold, isUnderdogInverse, maxLosses, cooldownTime, 
    isMartingaleEnabled, martingaleRecoveryFactor, 
    overUnderThreshold, evenOddThreshold, // Add new thresholds
    overUnderUnderdogThreshold, evenOddUnderdogThreshold
  ]);
  
  return {
    isCouncilAutopilotOn: Object.values(pilots).some(p => p.isOn),
    dailyBalance, setDailyBalance,
    dailyTarget, setDailyTarget,
    consensusThreshold, setConsensusThreshold,
    digitStats,
    toggleAutopilot,
    pilots,
    // Add new states to export
    overUnderThreshold, setOverUnderThreshold,
    evenOddThreshold, setEvenOddThreshold,
    underdogThreshold, setUnderdogThreshold,
    isUnderdogInverse, setIsUnderdogInverse,
    isMartingaleEnabled, setIsMartingaleEnabled,
    martingaleRecoveryFactor, setMartingaleRecoveryFactor,
    cooldownTime, setCooldownTime,
    maxLosses, setMaxLosses,
    overUnderUnderdogThreshold, setOverUnderUnderdogThreshold,
    evenOddUnderdogThreshold, setEvenOddUnderdogThreshold,
  };
}
```, 
`src/features/trading/components/deriv-trader/council-autopilot-interface-digits.tsx`
- Add UI to display the new Martingale state.
- Add sliders for the new `overUnderThreshold` and `evenOddThreshold`
- Remove the `disabled` property from the sliders so they can be changed at runtime.Certamente. Analisei o comportamento e identifiquei os pontos que mencionou. Algumas estratégias estavam com condições muito estritas, o que as tornava inativas, e a lógica do Martingale podia ser mais robusta.

Implementei as seguintes melhorias para resolver esses problemas:

1.  **Reativação das Estratégias Inativas:**
    *   As estratégias "Acima/Abaixo" e "Par/Ímpar" agora possuem seus próprios **sliders de limiar de probabilidade**, que podem ser ajustados por si. Isto elimina a dependência de um valor fixo e lhe dá controlo total sobre a sensibilidade destes pilotos.
    *   A estratégia "Azarão Dinâmico" foi ajustada para ser menos rigorosa, exigindo que apenas 3 dos 5 dígitos menos prováveis (em vez de 4) estejam num bloco para disparar um sinal, aumentando a sua frequência de operação.

2.  **Martingale com "Memória" de Perdas:**
    *   O sistema agora **acumula o valor total perdido** durante uma sequência de derrotas. Após cada perda, ele recalcula a próxima aposta para tentar recuperar não apenas o último prejuízo, mas todo o montante acumulado na sequência.
    *   O painel de cada piloto foi atualizado para mostrar o **número de perdas consecutivas** e o **valor total do prejuízo acumulado**, dando-lhe total transparência sobre o estado do Martingale.
    *   Ao obter uma vitória, a contagem de perdas e o valor acumulado são zerados.

3.  **Ajustes em Tempo Real:**
    *   Atendi ao seu pedido e **removi a trava de todos os sliders de configuração** no painel de "Gestão de Risco Avançada". Agora pode ajustar o Fator Martingale, o tempo de Cooldown, o Limite de Perdas e todos os outros parâmetros em tempo real, mesmo com os pilotos em funcionamento, permitindo uma calibragem dinâmica.

Estas melhorias tornarão os pilotos de dígitos mais ativos, a gestão de risco mais inteligente e o seu controlo sobre o sistema muito mais preciso e flexível.

Abaixo estão os arquivos modificados.

<changes>
  <description>Melhora as estratégias de dígitos, aprimora o Martingale para acumular perdas e permite o ajuste de todos os parâmetros em tempo real, mesmo com os pilotos ativos.</description>
  <change>
    <file>src/features/trading/hooks/use-robot-council-digits.ts</file>
    <content><![CDATA[// src/features/trading/hooks/use-robot-council-digits.ts
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

export type PilotType = 'matchesDiffers' | 'overUnder' | 'evenOdd' | 'underdog' | 'underdogOverUnder' | 'dynamicUnderdogOverUnder' | 'underdogEvenOdd';

type CouncilStrategy = {
  id: string;
  type: 'DIGITDIFF' | 'DIGITMATCH' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';
  description: string;
  pilot: PilotType;
  prediction?: number;
};

export type AutopilotStatus = 'PAUSED' | 'TRADING' | 'COOLDOWN';
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
  accumulatedLoss: number;
  currentTarget?: string;
  lastStake: number;
}

const getPayoutRate = (contractType?: string): number => {
    if (!contractType) return 0.95; // default fallback
    switch (contractType) {
        case 'DIGITDIFF':
            return 0.10; // ~10% for differs
        case 'DIGITMATCH':
            return 8.5;  // ~850% for matches
        case 'DIGITOVER':
        case 'DIGITUNDER':
        case 'DIGITEVEN':
        case 'DIGITODD':
            return 0.95; // ~95% for these
        default:
            return 0.95;
    }
};

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
  
  // --- Over/Under & Even/Odd thresholds ---
  const [overUnderThreshold, setOverUnderThreshold] = useState(65);
  const [evenOddThreshold, setEvenOddThreshold] = useState(65);
  
  // --- Underdog Specific Settings ---
  const [underdogThreshold, setUnderdogThreshold] = useState(5.0);
  const [isUnderdogInverse, setIsUnderdogInverse] = useState(false);

  // --- Over/Under Underdog Specific Settings ---
  const [overUnderUnderdogThreshold, setOverUnderUnderdogThreshold] = useState(40);
  
  // --- Even/Odd Underdog Specific Settings ---
  const [evenOddUnderdogThreshold, setEvenOddUnderdogThreshold] = useState(40);

  // --- Risk Management Settings ---
  const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(false);
  const [martingaleRecoveryFactor, setMartingaleRecoveryFactor] = useState(1.5);
  const [cooldownTime, setCooldownTime] = useState(0); // in seconds
  const [maxLosses, setMaxLosses] = useState(40);

  const initialPilotState: Record<PilotType, PilotState> = {
    matchesDiffers: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: undefined, lastStake: BASE_STAKE },
    overUnder: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: 'Acima de 4', lastStake: BASE_STAKE },
    evenOdd: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: 'Par', lastStake: BASE_STAKE },
    underdog: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: undefined, lastStake: BASE_STAKE },
    underdogOverUnder: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: 'Bloco Azarão Fixo', lastStake: BASE_STAKE },
    dynamicUnderdogOverUnder: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: 'Bloco Azarão Dinâmico', lastStake: BASE_STAKE },
    underdogEvenOdd: { isOn: false, status: 'PAUSED', consecutiveLosses: 0, accumulatedLoss: 0, currentTarget: 'Bloco Par/Ímpar Azarão', lastStake: BASE_STAKE },
  };

  const [pilots, setPilots] = useState<Record<PilotType, PilotState>>(initialPilotState);

  const processedLossesRef = useRef<Set<number>>(new Set());
  const cooldownTimersRef = useRef<Record<PilotType, NodeJS.Timeout | null>>({
    matchesDiffers: null,
    overUnder: null,
    evenOdd: null,
    underdog: null,
    underdogOverUnder: null,
    dynamicUnderdogOverUnder: null,
    underdogEvenOdd: null,
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
        // Reset state on toggle
        return {
            ...prev,
            [pilotType]: { 
                ...prev[pilotType],
                isOn: isActivating,
                status: isActivating ? 'TRADING' : 'PAUSED',
                consecutiveLosses: 0,
                accumulatedLoss: 0, // Reset accumulated loss
                lastStake: BASE_STAKE,
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
            
            const pilotState = prevPilots[pilotType];
            const newConsecutiveLosses = pilotState.consecutiveLosses + 1;
            const newAccumulatedLoss = pilotState.accumulatedLoss + pilotState.lastStake;

            let newStake = BASE_STAKE;
            if (isMartingaleEnabled) {
                const payoutRate = getPayoutRate(lastPilotTrade.contractType);
                const profitTarget = BASE_STAKE * (martingaleRecoveryFactor - 1);

                if (payoutRate > 0) {
                    newStake = (newAccumulatedLoss + profitTarget) / payoutRate;
                } else {
                    newStake = newAccumulatedLoss * 2; // Fallback
                }
                
                newStake = Math.min(newStake, dailyBalance * 0.20);
                newStake = Math.max(BASE_STAKE, newStake);
            }

            if (newConsecutiveLosses >= maxLosses) {
                if (pilotState.isOn) {
                    toggleAutopilot(pilotType, true); 
                    setTimeout(() => toast({ title: `Piloto ${pilotType} Pausado`, description: `Limite de ${maxLosses} perdas consecutivas atingido.`, variant: 'destructive' }), 0);
                }
                 return { ...prevPilots, [pilotType]: { ...pilotState, consecutiveLosses: newConsecutiveLosses, lastStake: BASE_STAKE, accumulatedLoss: 0 } };
            }
            
            if (cooldownTime > 0) {
                setTimeout(() => toast({ title: `📉 Perda Detectada! (${pilotType})`, description: `Cooldown de ${cooldownTime}s. Perdas seguidas: ${newConsecutiveLosses}.`, variant: 'destructive' }), 0);
                if (cooldownTimersRef.current[pilotType]) clearTimeout(cooldownTimersRef.current[pilotType]!);

                cooldownTimersRef.current[pilotType] = setTimeout(() => {
                    setPilots(currentPilots => {
                        if (currentPilots[pilotType]?.status === 'COOLDOWN') {
                            setTimeout(() => toast({ title: `✅ Cooldown Finalizado (${pilotType})`, description: 'Piloto está ativo.' }), 0);
                            return { ...currentPilots, [pilotType]: { ...currentPilots[pilotType], status: 'TRADING' } };
                        }
                        return currentPilots;
                    });
                }, cooldownTime * 1000);
            }

            return {
              ...prevPilots,
              [pilotType]: { ...pilotState, status: cooldownTime > 0 ? 'COOLDOWN' : 'TRADING', consecutiveLosses: newConsecutiveLosses, accumulatedLoss: newAccumulatedLoss, lastStake: newStake }
            };
        });

    } else if (lastPilotTrade.status === 'won') {
        setPilots(prev => {
          if (!prev[pilotType]) return prev;
          return {
            ...prev,
            [pilotType]: { ...prev[pilotType], consecutiveLosses: 0, accumulatedLoss: 0, lastStake: BASE_STAKE }
          }
        });
    }
  }, [operationsLog, toast, isMartingaleEnabled, martingaleRecoveryFactor, cooldownTime, maxLosses, toggleAutopilot, dailyBalance]);

  const autopilotExecutionRef = useRef(false);
  useEffect(() => {
    if (autopilotExecutionRef.current || !activeSymbol) return;

    const runAutopilots = async () => {
        autopilotExecutionRef.current = true;
        
        const sortedByProb = [...digitStats].sort((a, b) => b.probability - a.probability);
        const mostProbable = sortedByProb[0];
        const leastProbable = sortedByProb[sortedByProb.length - 1];

        const probOver4 = digitStats.filter(s => s.digit > 4).reduce((sum, s) => sum + s.probability, 0);
        const probUnder5 = digitStats.filter(s => s.digit < 5).reduce((sum, s) => sum + s.probability, 0);
        const probEven = digitStats.filter(s => s.digit % 2 === 0).reduce((sum, s) => sum + s.probability, 0);
        const probOdd = 100 - probEven;
        
        // Update targets for UI feedback
        setPilots(prev => ({
            ...prev,
            matchesDiffers: { ...prev.matchesDiffers, currentTarget: `Difere de ${mostProbable?.digit}` },
            underdog: { ...prev.underdog, currentTarget: isUnderdogInverse ? `Difere de ${leastProbable?.digit}` : `Combina com ${leastProbable?.digit}` },
            overUnder: { ...prev.overUnder, currentTarget: probOver4 > probUnder5 ? 'Acima de 4' : 'Abaixo de 5'},
            underdogOverUnder: { ...prev.underdogOverUnder, currentTarget: 'Aguardando Bloco Azarão Fixo' },
            dynamicUnderdogOverUnder: { ...prev.dynamicUnderdogOverUnder, currentTarget: 'Aguardando Bloco Dinâmico' },
            underdogEvenOdd: { ...prev.underdogEvenOdd, currentTarget: probEven < probOdd ? 'Par (Azarão)' : 'Ímpar (Azarão)'},
        }));

        for (const [type, state] of Object.entries(pilots)) {
            const pilotKey = type as PilotType;
            if (!state.isOn || state.status !== 'TRADING') continue;

             const pilotPnL = operationsLog
                .filter(op => op.initiator === `Piloto_${pilotKey}` && op.status !== 'pending')
                .reduce((sum, op) => sum + (op.result || (op.status === 'lost' ? -op.stake : 0)), 0);
            
            if (pilotPnL <= -dailyBalance || pilotPnL >= dailyTarget) {
                if (state.isOn) {
                    toggleAutopilot(pilotKey, true);
                    setTimeout(() => toast({ title: `Piloto ${pilotKey} Desativado`, description: `Limite de ${pilotPnL <= -dailyBalance ? 'perda' : 'lucro'} atingido.`, variant: 'destructive' }), 0);
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

            // --- Lógica de Decisão do Piloto ---
            if (pilotKey === 'matchesDiffers') {
                if (mostProbable && mostProbable.probability > consensusThreshold) {
                    signalType = 'DIGITDIFF';
                    predictionDigit = mostProbable.digit;
                }
            } else if (pilotKey === 'overUnder') {
                if (probOver4 > overUnderThreshold) {
                    signalType = 'DIGITOVER';
                    predictionDigit = 4;
                } else if (probUnder5 > overUnderThreshold) {
                    signalType = 'DIGITUNDER';
                    predictionDigit = 5;
                }
            } else if (pilotKey === 'evenOdd') {
                if (probEven > evenOddThreshold) {
                    signalType = 'DIGITEVEN';
                } else if (probOdd > evenOddThreshold) {
                    signalType = 'DIGITODD';
                }
            } else if (pilotKey === 'underdog') {
                if (leastProbable && leastProbable.probability < underdogThreshold) {
                    signalType = isUnderdogInverse ? 'DIGITDIFF' : 'DIGITMATCH';
                    predictionDigit = leastProbable.digit;
                }
            } else if (pilotKey === 'underdogOverUnder') {
                if (probOver4 < overUnderUnderdogThreshold) {
                    signalType = 'DIGITOVER';
                    predictionDigit = 4;
                } else if (probUnder5 < overUnderUnderdogThreshold) {
                    signalType = 'DIGITUNDER';
                    predictionDigit = 5;
                }
            } else if (pilotKey === 'dynamicUnderdogOverUnder') {
                const underdogStats = sortedByProb.slice(-5);
                const leastProbableDigits = underdogStats.map(s => s.digit);
                const totalProbOfUnderdogs = underdogStats.reduce((sum, s) => sum + s.probability, 0);

                if (totalProbOfUnderdogs < overUnderUnderdogThreshold) { // Changed this to make more sense
                    const lowNumbersInUnderdogGroup = leastProbableDigits.filter(d => d < 5).length;
                    const highNumbersInUnderdogGroup = leastProbableDigits.filter(d => d > 4).length;

                    if (lowNumbersInUnderdogGroup >= 3) { // Relaxed from 4
                        signalType = 'DIGITOVER';
                        predictionDigit = 4;
                        setPilots(prev => ({...prev, dynamicUnderdogOverUnder: {...prev.dynamicUnderdogOverUnder, currentTarget: 'OVER 4 (Azarões são Baixos)'}}));
                    } else if (highNumbersInUnderdogGroup >= 3) { // Relaxed from 4
                        signalType = 'DIGITUNDER';
                        predictionDigit = 5;
                        setPilots(prev => ({...prev, dynamicUnderdogOverUnder: {...prev.dynamicUnderdogOverUnder, currentTarget: 'UNDER 5 (Azarões são Altos)'}}));
                    } else {
                        setPilots(prev => ({...prev, dynamicUnderdogOverUnder: {...prev.dynamicUnderdogOverUnder, currentTarget: 'Blocos Azarão Equilibrados'}}));
                    }
                } else {
                    setPilots(prev => ({...prev, dynamicUnderdogOverUnder: {...prev.dynamicUnderdogOverUnder, currentTarget: `Aguardando Prob. < ${overUnderUnderdogThreshold.toFixed(1)}%`}}));
                }
            }
            else if (pilotKey === 'underdogEvenOdd') {
                if (probEven < evenOddUnderdogThreshold) {
                    signalType = 'DIGITEVEN';
                } else if (probOdd < evenOddUnderdogThreshold) {
                    signalType = 'DIGITODD';
                }
            }
            
            if (signalType) {
                await executeTrade(signalType, stake, activeSymbol, 1, 't', `Piloto_${pilotKey}`, predictionDigit);
            }
        }
        
        setTimeout(() => { autopilotExecutionRef.current = false; }, 2000); // Cooldown para evitar trades em rajada
    };

    const timeoutId = setTimeout(runAutopilots, 250); // Aumentar ligeiramente o delay para permitir estabilização
    return () => clearTimeout(timeoutId);

  }, [
    pilots, digitStats, consensusThreshold, activeSymbol, executeTrade, 
    operationsLog, dailyBalance, dailyTarget, toggleAutopilot, toast, 
    underdogThreshold, isUnderdogInverse, maxLosses, cooldownTime, 
    isMartingaleEnabled, martingaleRecoveryFactor, 
    overUnderThreshold, evenOddThreshold, // Add new thresholds
    overUnderUnderdogThreshold, evenOddUnderdogThreshold
  ]);
  
  return {
    isCouncilAutopilotOn: Object.values(pilots).some(p => p.isOn),
    dailyBalance, setDailyBalance,
    dailyTarget, setDailyTarget,
    consensusThreshold, setConsensusThreshold,
    digitStats,
    toggleAutopilot,
    pilots,
    // Add new states to export
    overUnderThreshold, setOverUnderThreshold,
    evenOddThreshold, setEvenOddThreshold,
    underdogThreshold, setUnderdogThreshold,
    isUnderdogInverse, setIsUnderdogInverse,
    isMartingaleEnabled, setIsMartingaleEnabled,
    martingaleRecoveryFactor, setMartingaleRecoveryFactor,
    cooldownTime, setCooldownTime,
    maxLosses, setMaxLosses,
    overUnderUnderdogThreshold, setOverUnderUnderdogThreshold,
    evenOddUnderdogThreshold, setEvenOddUnderdogThreshold,
  };
}
