// src/features/trading/hooks/use-master-autopilot.ts
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useDerivApiAccumulators } from './use-deriv-api-accumulators';
import { useToast } from '@/hooks/use-toast';

// --- COPIADO E ADAPTADO DO StochasticLab ---
// Em um refactor futuro, isso seria extraído para um hook reutilizável.

const normalQuantile = (p: number): number => {
  const a1 = -39.69683028665376; const a2 = 220.9460984245205; const a3 = -275.9285104469687; const a4 = 138.357751867269; const a5 = -30.66479806614716; const a6 = 2.506628277459239;
  const b1 = -54.47609879822406; const b2 = 161.5858368580409; const b3 = -155.6989798598866; const b4 = 66.80131188771972; const b5 = -13.28068155288572;
  const c1 = -0.007784894002430293; const c2 = -0.3223964580411365; const c3 = -2.400758277161838; const c4 = -2.549732539343734; const c5 = 4.374664141464968; const c6 = 2.938163982698783;
  const d1 = 0.007784695709041462; const d2 = 0.3224671290700398; const d3 = 2.445134137142996; const d4 = 3.754408661907416;
  const pLow = 0.02425; const pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a1*r+a2)*r+a3)*r+a4)*r+a5)*r+a6)*q / (((((b1*r+b2)*r+b3)*r+b4)*r+b5)*r+1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1-p));
    return -(((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  }
};
const normalRandom = (): number => {
    let u1 = 0; while (u1 === 0) u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};
// --- FIM DA LÓGICA COPIADA ---

type ContractType = 'Accumulators' | 'Rise/Fall' | 'Multipliers';
type Signal = 'RISE' | 'FALL' | 'HOLD';
interface AssertivenessData {
    accuracy: number;
    vote: Signal;
}

export interface MasterAutopilotState {
    isReady: boolean;
    assertiveness: Record<string, AssertivenessData>;
    trigger: {
        signal: Signal;
        reason: string;
        triggeredBy: [string, string] | null;
    };
}

export function useMasterAutopilot() {
  const { priceTicks, botCandleData, activeSymbol } = useDerivApiAccumulators();
  const { toast } = useToast();

  const [isAutopilotOn, setIsAutopilotOn] = useState(false);
  const [contractType, setContractType] = useState<ContractType>('Accumulators');
  const [dailyBalance, setDailyBalance] = useState(100.0);
  const [dailyTarget, setDailyTarget] = useState(20.0);

  const [masterState, setMasterState] = useState<MasterAutopilotState>({
    isReady: false,
    assertiveness: {},
    trigger: {
        signal: 'HOLD',
        reason: 'Piloto desativado ou dados insuficientes.',
        triggeredBy: null,
    },
  });
  
  // Refs para manter o estado das projeções sem causar re-renderizações excessivas
  const accuracyHistoryRefs = {
    '3t': useRef<boolean[]>([]), '6t': useRef<boolean[]>([]), '10s': useRef<boolean[]>([]),
    '20s': useRef<boolean[]>([]), '30s': useRef<boolean[]>([]), '40s': useRef<boolean[]>([]),
  };
  const pendingPredictionsRefs = {
    '3t': useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]),
    '6t': useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]),
    '10s': useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]),
    '20s': useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]),
    '30s': useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]),
    '40s': useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]),
  };

  const toggleAutopilot = (checked: boolean) => {
    setIsAutopilotOn(checked);
    toast({ title: `Master Autopilot ${checked ? 'Ativado' : 'Desativado'}` });
  };

  useEffect(() => {
    if (!isAutopilotOn || priceTicks.length < 50) {
      setMasterState(prev => ({
        ...prev,
        isReady: false,
        trigger: { signal: 'HOLD', reason: isAutopilotOn ? 'Aguardando dados suficientes...' : 'Piloto desativado.', triggeredBy: null }
      }));
      return;
    }

    const interval = setInterval(() => {
        const prices = priceTicks.map(d => d.price);
        const VOL_WINDOW = 50;
        const lastPrice = prices[prices.length - 1];
        const logReturns: number[] = [];
        for (let i = Math.max(1, prices.length - VOL_WINDOW); i < prices.length; i++) {
            if(prices[i-1] > 0) logReturns.push(Math.log(prices[i] / prices[i - 1]));
        }

        if(logReturns.length === 0) return;

        const meanLastReturn = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
        const lastVariance = logReturns.reduce((s, r) => s + Math.pow(r - meanLastReturn, 2), 0) / (logReturns.length - 1);
        const lastSigma = Math.sqrt(lastVariance);

        const projectPath = (steps: number) => {
            let currentSimPrice = lastPrice;
            const path: { time: number, price: number }[] = [];
            for (let i = 1; i <= steps; i++) {
                const Z = normalRandom();
                const drift_future = meanLastReturn;
                const diffusion_future = lastSigma * Math.sqrt(1) * Z;
                currentSimPrice = currentSimPrice * Math.exp(drift_future + diffusion_future);
                path.push({ time: prices.length - 1 + i, price: currentSimPrice });
            }
            return path;
        };

        const horizons = [
            { name: '3t', ticks: 3, window: 6 }, { name: '6t', ticks: 6, window: 6 },
            { name: '10s', ticks: 10, window: 10 }, { name: '20s', ticks: 20, window: 10 },
            { name: '30s', ticks: 30, window: 10 }, { name: '40s', ticks: 40, window: 10 },
        ];
        
        const newAssertiveness: Record<string, AssertivenessData> = {};

        horizons.forEach(h => {
            const { name, ticks, window } = h;
            const pendingRef = pendingPredictionsRefs[name as keyof typeof pendingPredictionsRefs];
            const historyRef = accuracyHistoryRefs[name as keyof typeof accuracyHistoryRefs];

            const newFuturePath = projectPath(ticks);
            const currentTimeIndex = prices.length - 1;
            let newHistory: boolean[] = [];

            const updatedPending = pendingRef.current.filter((pred) => {
                if (currentTimeIndex >= pred.startTimeIndex + ticks) {
                    const actualEndPrice = prices[pred.startTimeIndex + ticks];
                    if (actualEndPrice === undefined) return true;
                    const predictedDirection = pred.predictedEndPrice > pred.startPrice;
                    const actualDirection = actualEndPrice > pred.startPrice;
                    newHistory.push(predictedDirection === actualDirection);
                    return false;
                }
                return true;
            });
            
            pendingRef.current = updatedPending;
            
            if (newHistory.length > 0) {
                historyRef.current = [...historyRef.current.slice(-window + newHistory.length), ...newHistory];
            }

            if (newFuturePath.length === ticks) {
                pendingRef.current.push({
                    startTimeIndex: prices.length -1,
                    startPrice: lastPrice,
                    predictedEndPrice: newFuturePath[ticks - 1].price,
                });
            }
            
            const hits = historyRef.current.filter(h => h).length;
            const total = historyRef.current.length;
            const accuracy = total > 0 ? (hits / total) * 100 : 0;
            const vote: Signal = newFuturePath.length > 0 ? (newFuturePath[newFuturePath.length - 1].price > lastPrice ? 'RISE' : 'FALL') : 'HOLD';
            
            newAssertiveness[name] = { accuracy, vote };
        });

        // Lógica do Gatilho de Assertividade Dupla
        let triggerSignal: Signal = 'HOLD';
        let triggerReason = 'Nenhuma confirmação dupla de alta assertividade (>80%).';
        let triggeredBy: [string, string] | null = null;
        
        for (let i = 1; i < horizons.length; i++) {
            const currentHorizon = horizons[i].name;
            const prevHorizon = horizons[i-1].name;
            
            if (newAssertiveness[currentHorizon].accuracy > 80 && newAssertiveness[prevHorizon].accuracy > 80) {
                if (newAssertiveness[currentHorizon].vote === newAssertiveness[prevHorizon].vote && newAssertiveness[currentHorizon].vote !== 'HOLD') {
                    triggerSignal = newAssertiveness[currentHorizon].vote;
                    triggeredBy = [prevHorizon, currentHorizon];
                    triggerReason = `Gatilho de ${triggerSignal} confirmado por ${prevHorizon} (${newAssertiveness[prevHorizon].accuracy.toFixed(0)}%) e ${currentHorizon} (${newAssertiveness[currentHorizon].accuracy.toFixed(0)}%).`;
                    break;
                }
            }
        }
        
        setMasterState({
            isReady: true,
            assertiveness: newAssertiveness,
            trigger: {
                signal: triggerSignal,
                reason: triggerReason,
                triggeredBy: triggeredBy,
            }
        });

    }, 2000);

    return () => clearInterval(interval);

  }, [isAutopilotOn, priceTicks]);

  return {
    isAutopilotOn,
    toggleAutopilot,
    contractType,
    setContractType,
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
    masterState,
  };
}
