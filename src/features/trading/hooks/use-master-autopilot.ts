// src/features/trading/hooks/use-master-autopilot.ts
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { useDerivApiAccumulators } from './use-deriv-api-accumulators';
import { useDerivApiMultipliers } from './use-deriv-api-multipliers';
import { useToast } from '@/hooks/use-toast';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { getCouncilStrategies } from '@/services/council-strategies';
import type { DurationUnit, Operation, OperationInitiator } from '@/lib/types';
import { extractMicrostructureFeatures, type MicrostructureFeatures } from '@/services/advanced-trading-services';


// --- LÓGICA COPIADA DO StochasticLab ---
const normalRandom = (): number => {
    let u1 = 0; while (u1 === 0) u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};
// --- FIM DA LÓGICA COPIADA ---

type ContractType = 'Accumulators' | 'Rise/Fall' | 'Multipliers';
type Signal = 'RISE' | 'FALL' | 'HOLD';
type TrendDirection = 'UP' | 'DOWN' | 'NONE';

interface AssertivenessData {
    accuracy: number;
    vote: Signal;
}

export interface RiskManagerStatus {
    mode: 'Normal' | 'Cautious';
    assertivenessThreshold: number;
    lastAdjustmentReason: string;
}

export interface MasterAutopilotState {
    isReady: boolean;
    assertiveness: Record<string, AssertivenessData>;
    trigger: {
        signal: Signal;
        reason: string;
        triggeredBy: [string, string] | null;
    };
    indicators: Indicators | null;
    microstructure: MicrostructureFeatures | null;
}

export function useMasterAutopilot() {
  const { 
    priceTicks: priceTicksV2, 
    botCandleData: botCandleDataV2, 
    executeTrade: executeRiseFallTrade,
    operationsLog: operationsLogV2,
    isConnected: isConnectedV2,
    activeSymbol: activeSymbolV2,
  } = useDerivApiV2();
  
  const { 
    executeTrade: executeAccumulatorTrade,
    operationsLog: operationsLogAccumulators,
    isConnected: isConnectedAccumulators,
    activeSymbol: activeSymbolAccumulators,
  } = useDerivApiAccumulators();

  const {
    executeTrade: executeMultiplierTrade,
    isConnected: isConnectedMultipliers,
    activeSymbol: activeSymbolMultipliers,
    operationsLog: operationsLogMultipliers,
  } = useDerivApiMultipliers();
  
  const { toast } = useToast();

  const [isAutopilotOn, setIsAutopilotOn] = useState(false);
  const [contractType, setContractType] = useState<ContractType>('Accumulators');
  const [dailyBalance, setDailyBalance] = useState(100.0);
  const [dailyTarget, setDailyTarget] = useState(20.0);
  
  const [riskManager, setRiskManager] = useState<RiskManagerStatus>({
      mode: 'Normal',
      assertivenessThreshold: 80,
      lastAdjustmentReason: 'N/A'
  });
  const processedTradesRef = useRef<Set<number>>(new Set());

  const [masterState, setMasterState] = useState<MasterAutopilotState>({
    isReady: false,
    assertiveness: {},
    trigger: {
        signal: 'HOLD',
        reason: 'Piloto desativado ou dados insuficientes.',
        triggeredBy: null,
    },
    indicators: null,
    microstructure: null,
  });
  
  const [macroTrend, setMacroTrend] = useState<TrendDirection>('NONE');
  const isCoolingDownRef = useRef(false);
  
  const activeSymbol = 
      contractType === 'Accumulators' ? activeSymbolAccumulators : 
      contractType === 'Multipliers' ? activeSymbolMultipliers : 
      activeSymbolV2;
  const priceTicks = 
      contractType === 'Accumulators' ? priceTicksV2 : // Accumulators use V2 ticks for now
      contractType === 'Multipliers' ? priceTicksV2 :
      priceTicksV2;
  const botCandleData = 
      contractType === 'Accumulators' ? botCandleDataV2 : // Use V2 candles
      contractType === 'Multipliers' ? botCandleDataV2 :
      botCandleDataV2;
  const operationsLog = 
      contractType === 'Accumulators' ? operationsLogAccumulators : 
      contractType === 'Multipliers' ? operationsLogMultipliers :
      operationsLogV2;
  const isConnected = 
      contractType === 'Accumulators' ? isConnectedAccumulators : 
      contractType === 'Multipliers' ? isConnectedMultipliers :
      isConnectedV2;

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

  const toggleAutopilot = useCallback((checked: boolean) => {
    setIsAutopilotOn(checked);
    toast({ title: `Master Autopilot ${checked ? 'Ativado' : 'Desativado'}` });
    if (!checked) {
        setMasterState(prev => ({...prev, trigger: { signal: 'HOLD', reason: 'Piloto desativado.', triggeredBy: null}}));
    }
  }, [toast]);
  
  const executeTradeAction = useCallback(async (initiator: OperationInitiator) => {
      const { trigger, indicators } = masterState;
      const { signal, triggeredBy } = trigger;

      if (signal === 'HOLD' || !activeSymbol) {
          toast({ title: "Nenhum sinal válido", description: "O gatilho preditivo não detectou uma oportunidade.", variant: "destructive"});
          return;
      }

      toast({ title: `🤖 Master Autopilot: Ordem ${initiator} ${signal}!`, description: `Executando ${contractType} em ${activeSymbol}`});

      try {
          if (contractType === 'Accumulators') {
              await executeAccumulatorTrade(1.0, 0.03, activeSymbol, initiator);
          } else if (contractType === 'Rise/Fall' && triggeredBy) {
              const longerHorizon = triggeredBy[1]; 
              const durationMatch = longerHorizon.match(/(\d+)([st])/);
              if (durationMatch) {
                  const duration = parseInt(durationMatch[1], 10);
                  const durationUnit = durationMatch[2] as 's' | 't';
                  await executeRiseFallTrade(
                      signal === 'RISE' ? 'CALL' : 'PUT',
                      1.0,
                      activeSymbol,
                      signal.toLowerCase() as 'rise' | 'fall',
                      duration,
                      durationUnit,
                      initiator
                  );
              }
          } else if (contractType === 'Multipliers' && triggeredBy && indicators && indicators.atr) {
              const currentPrice = priceTicks[priceTicks.length-1].price;
              const baseStake = dailyBalance * 0.02;
              const volatilityFactor = Math.max(0.5, 1 - (indicators.atr / currentPrice * 100));
              const finalStake = parseFloat(Math.max(1.0, Math.min(baseStake * volatilityFactor, 5.0)).toFixed(2));
              const stopLoss = finalStake;
              const takeProfit = finalStake * 1.5;

              await executeMultiplierTrade(
                  signal === 'RISE' ? 'MULTUP' : 'MULTDOWN',
                  finalStake,
                  activeSymbol,
                  100, 
                  takeProfit,
                  stopLoss,
                  undefined,
                  initiator
              );
          }
      } catch (error) {
          console.error("Master Autopilot Execution Error:", error);
          toast({ title: `❌ Erro na Execução ${initiator}`, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      }

  }, [masterState, contractType, activeSymbol, executeAccumulatorTrade, executeRiseFallTrade, executeMultiplierTrade, priceTicks, dailyBalance, toast]);

  const executeManualTrigger = useCallback(() => {
      executeTradeAction('Manual');
  }, [executeTradeAction]);


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
        const lastClosedPilotTrade = operationsLog.find(op => 
            op.initiator === 'Piloto' && 
            op.status !== 'pending' && 
            !processedTradesRef.current.has(op.id)
        );

        if (lastClosedPilotTrade) {
            processedTradesRef.current.add(lastClosedPilotTrade.id);
            if ((lastClosedPilotTrade.result || 0) < 0) {
                setRiskManager(prev => {
                    const newThreshold = Math.min(95, prev.assertivenessThreshold + 5);
                    return {
                        mode: 'Cautious',
                        assertivenessThreshold: newThreshold,
                        lastAdjustmentReason: `Perda de $${Math.abs(lastClosedPilotTrade.result || 0).toFixed(2)}. Aumentando limiar para ${newThreshold}%.`
                    };
                });
                toast({ title: "Master Autopilot: Modo Cauteloso Ativado", description: "Limiar de assertividade aumentado.", variant: "destructive" });
            } else {
                setRiskManager(prev => {
                    const newThreshold = Math.max(80, prev.assertivenessThreshold - 1);
                    return {
                        mode: 'Normal',
                        assertivenessThreshold: newThreshold,
                        lastAdjustmentReason: `Ganho de $${(lastClosedPilotTrade.result || 0).toFixed(2)}. Reduzindo limiar para ${newThreshold}%.`
                    };
                });
            }
        }
        
        if (isCoolingDownRef.current) {
            setMasterState(prev => ({...prev, trigger: { ...prev.trigger, reason: 'Em cooldown pós-trade.'}}))
            return;
        }
        const openMasterTrade = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');
        if (openMasterTrade) {
            setMasterState(prev => ({...prev, trigger: { ...prev.trigger, reason: `Gerindo posição aberta #${openMasterTrade.id}.`}}))
            return;
        }

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
        
        const calculatedIndicators = calculateAllIndicators(botCandleData, getCouncilStrategies(), '1m', {duration: 15, unit: 's'});
        const microFeatures = extractMicrostructureFeatures(priceTicks, botCandleData);

        if (calculatedIndicators && calculatedIndicators.ma.long) {
            const detectedTrend: TrendDirection = lastPrice > calculatedIndicators.ma.long ? 'UP' : 'DOWN';
            if (macroTrend !== detectedTrend) setMacroTrend(detectedTrend);
        }

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
            if (newHistory.length > 0) historyRef.current = [...historyRef.current.slice(-window + newHistory.length), ...newHistory];
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

        let triggerSignal: Signal = 'HOLD';
        let triggerReason = `Nenhuma confirmação dupla de assertividade (> ${riskManager.assertivenessThreshold}%).`;
        let triggeredBy: [string, string] | null = null;
        
        for (let i = 1; i < horizons.length; i++) {
            const currentHorizon = horizons[i].name;
            const prevHorizon = horizons[i-1].name;
            if (newAssertiveness[currentHorizon].accuracy > riskManager.assertivenessThreshold && newAssertiveness[prevHorizon].accuracy > riskManager.assertivenessThreshold) {
                if (newAssertiveness[currentHorizon].vote === newAssertiveness[prevHorizon].vote && newAssertiveness[currentHorizon].vote !== 'HOLD') {
                    const signalCandidate = newAssertiveness[currentHorizon].vote;
                    
                    if (contractType === 'Multipliers' || contractType === 'Rise/Fall') {
                        if ((signalCandidate === 'RISE' && macroTrend === 'UP') || (signalCandidate === 'FALL' && macroTrend === 'DOWN')) {
                           triggerSignal = signalCandidate;
                           triggeredBy = [prevHorizon, currentHorizon];
                           triggerReason = `Gatilho ${triggerSignal} confirmado por assertividade e alinhamento com a tendência macro.`;
                           break;
                        } else {
                           triggerReason = `Sinal ${signalCandidate} ignorado. Assertividade alta, mas contra a tendência macro (${macroTrend}).`;
                        }
                    } else { // Accumulators
                        triggerSignal = 'RISE'; // Sinal de estabilidade
                        triggeredBy = [prevHorizon, currentHorizon];
                        triggerReason = `Gatilho de estabilidade detectado por assertividade em ${prevHorizon} e ${currentHorizon}.`;
                        break;
                    }
                }
            }
        }
        
        const currentState: MasterAutopilotState = { 
            isReady: true, 
            assertiveness: newAssertiveness, 
            trigger: { signal: 'HOLD', reason: triggerReason, triggeredBy: null },
            indicators: calculatedIndicators, 
            microstructure: microFeatures 
        };

        if (triggerSignal !== 'HOLD' && !isCoolingDownRef.current && !openMasterTrade) {
            isCoolingDownRef.current = true;
            currentState.trigger = { signal: triggerSignal, reason: `Gatilho ${triggerSignal} detectado! Executando...`, triggeredBy };
            setMasterState(currentState);

            executeTradeAction('Piloto').finally(() => {
                setTimeout(() => { isCoolingDownRef.current = false; }, 60000);
            });
        } else {
             currentState.trigger = { signal: triggerSignal, reason: triggerReason, triggeredBy: triggeredBy };
             setMasterState(currentState);
        }

    }, 2000);

    return () => clearInterval(interval);

  }, [
      isAutopilotOn, priceTicks, operationsLog, activeSymbol, contractType, 
      executeTradeAction, toast, riskManager.assertivenessThreshold, botCandleData, macroTrend, dailyBalance
    ]);

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
    riskManager,
    macroTrend,
    executeManualTrigger
  };
}
