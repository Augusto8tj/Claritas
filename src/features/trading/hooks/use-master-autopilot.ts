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
    manualTrigger: { 
        signal: Signal;
        reason: string;
    };
    indicators: Indicators | null;
    microstructure: MicrostructureFeatures | null;
}

export function useMasterAutopilot() {
  const v2Api = useDerivApiV2();
  const accumulatorsApi = useDerivApiAccumulators();
  const multipliersApi = useDerivApiMultipliers();
  
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
    manualTrigger: { 
        signal: 'HOLD',
        reason: 'Aguardando consenso dos modelos.'
    },
    indicators: null,
    microstructure: null,
  });
  
  const masterStateRef = useRef(masterState);
  masterStateRef.current = masterState;

  const [macroTrend, setMacroTrend] = useState<TrendDirection>('NONE');
  const macroTrendRef = useRef(macroTrend);
  macroTrendRef.current = macroTrend;
  
  const isCoolingDownRef = useRef(false);
  
  const activeApi = useMemo(() => {
    switch(contractType) {
        case 'Accumulators': return accumulatorsApi;
        case 'Multipliers': return multipliersApi;
        case 'Rise/Fall': return v2Api;
        default: return v2Api;
    }
  }, [contractType, accumulatorsApi, multipliersApi, v2Api]);
  
  const { 
    activeSymbol, 
    priceTicks, 
    botCandleData, 
    operationsLog, 
    isConnected,
    executeTrade: currentExecuteTrade,
  } = activeApi;

  const { executeTrade: executeRiseFallTrade } = v2Api;
  const { executeTrade: executeAccumulatorTrade } = accumulatorsApi;
  const { executeTrade: executeMultiplierTrade } = multipliersApi;
      
  const priceTicksRef = useRef(priceTicks);
  priceTicksRef.current = priceTicks;
  const botCandleDataRef = useRef(botCandleData);
  botCandleDataRef.current = botCandleData;
  const operationsLogRef = useRef(operationsLog);
  operationsLogRef.current = operationsLog;
  const riskManagerRef = useRef(riskManager);
  riskManagerRef.current = riskManager;

  const contractTypeRef = useRef(contractType);
  contractTypeRef.current = contractType;

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
  
  const executeTradeAction = useCallback(async (initiator: OperationInitiator, signalOverride?: Signal) => {
      const { trigger, indicators } = masterStateRef.current;
      const currentContractType = contractTypeRef.current;
      
      const signalToUse = signalOverride || trigger.signal;
      const { triggeredBy } = trigger;
      
      if (signalToUse === 'HOLD' || !activeSymbol) {
          toast({ title: "Nenhum sinal válido", description: "O gatilho preditivo não detectou uma oportunidade.", variant: "destructive"});
          return;
      }

      toast({ title: `🤖 Master Autopilot: Ordem ${initiator} ${signalToUse}!`, description: `Executando ${currentContractType} em ${activeSymbol}`});

      try {
          if (currentContractType === 'Accumulators') {
              await executeAccumulatorTrade(1.0, 0.03, activeSymbol, initiator);
          } else if (currentContractType === 'Rise/Fall' && triggeredBy) {
              const longerHorizon = triggeredBy[1]; 
              const durationMatch = longerHorizon.match(/(\d+)([st])/);
              if (durationMatch) {
                  const duration = parseInt(durationMatch[1], 10);
                  const durationUnit = durationMatch[2] as 's' | 't';
                  await executeRiseFallTrade(
                      signalToUse === 'RISE' ? 'CALL' : 'PUT',
                      1.0,
                      activeSymbol,
                      signalToUse.toLowerCase() as 'rise' | 'fall',
                      duration,
                      durationUnit,
                      initiator
                  );
              }
          } else if (currentContractType === 'Multipliers' && triggeredBy && indicators && indicators.atr) {
              const currentPrice = priceTicksRef.current[priceTicksRef.current.length-1].price;
              const baseStake = dailyBalance * 0.02;
              const volatilityFactor = Math.max(0.5, 1 - (indicators.atr / currentPrice * 100));
              const finalStake = parseFloat(Math.max(1.0, Math.min(baseStake * volatilityFactor, 5.0)).toFixed(2));
              const stopLoss = finalStake;
              const takeProfit = finalStake * 1.5;

              await executeMultiplierTrade(
                  signalToUse === 'RISE' ? 'MULTUP' : 'MULTDOWN',
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
  }, [activeSymbol, dailyBalance, executeAccumulatorTrade, executeMultiplierTrade, executeRiseFallTrade, toast]);
  
  const executeManualTrigger = useCallback(async () => {
    const { signal } = masterStateRef.current.manualTrigger;
    await executeTradeAction('Manual', signal);
  }, [executeTradeAction]);
  
  const setAssertivenessThreshold = useCallback((value: number) => {
      setRiskManager(prev => ({...prev, assertivenessThreshold: value}));
  }, []);

  useEffect(() => {
    if (!isConnected) {
        if(masterState.trigger.signal !== 'HOLD') {
            setMasterState(prev => ({...prev, trigger: { signal: 'HOLD', reason: 'Piloto desativado.', triggeredBy: null }}));
        }
        return;
    }
    
    const interval = setInterval(() => {
        if (priceTicksRef.current.length < 50) {
          if(!masterState.isReady || masterState.trigger.signal !== 'HOLD') {
            setMasterState(prev => ({
              ...prev,
              isReady: false,
              trigger: { signal: 'HOLD', reason: isAutopilotOn ? 'Aguardando dados suficientes...' : 'Piloto desativado.', triggeredBy: null }
            }));
          }
          return;
        }

        const currentPriceTicks = priceTicksRef.current;
        const currentBotCandleData = botCandleDataRef.current;
        const currentOperationsLog = operationsLogRef.current;
        const currentRiskManager = riskManagerRef.current;
        const currentMacroTrend = macroTrendRef.current;
        const currentContractType = contractTypeRef.current;

        const lastClosedPilotTrade = currentOperationsLog.find(op => 
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
        const openMasterTrade = currentOperationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');
        if (openMasterTrade) {
            setMasterState(prev => ({...prev, trigger: { ...prev.trigger, reason: `Gerindo posição aberta #${openMasterTrade.id}.`}}))
            return;
        }

        const prices = currentPriceTicks.map(d => d.price);
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
        
        const calculatedIndicators = calculateAllIndicators(currentBotCandleData, getCouncilStrategies(), '1m', {duration: 15, unit: 's'});
        const microFeatures = extractMicrostructureFeatures(currentPriceTicks, currentBotCandleData);

        if (calculatedIndicators && calculatedIndicators.ma.long) {
            const detectedTrend: TrendDirection = lastPrice > calculatedIndicators.ma.long ? 'UP' : 'DOWN';
            if (currentMacroTrend !== detectedTrend) setMacroTrend(detectedTrend);
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

        const votes = Object.values(newAssertiveness).map(a => a.vote);
        const riseVotes = votes.filter(v => v === 'RISE').length;
        const fallVotes = votes.filter(v => v === 'FALL').length;
        let manualSignal: Signal = 'HOLD';
        let manualReason = 'Aguardando consenso dos modelos.';
        
        const totalVotes = riseVotes + fallVotes;

        if (riseVotes >= 4) {
            manualSignal = 'RISE';
            manualReason = `Consenso forte: ${riseVotes}/6 modelos indicam alta.`;
        } else if (fallVotes >= 4) {
            manualSignal = 'FALL';
            manualReason = `Consenso forte: ${fallVotes}/6 modelos indicam baixa.`;
        } else if (riseVotes > fallVotes && riseVotes >= 3) {
            manualSignal = 'RISE';
            manualReason = `Consenso majoritário: ${riseVotes}/${totalVotes} modelos indicam alta.`;
        } else if (fallVotes > riseVotes && fallVotes >= 3) {
            manualSignal = 'FALL';
            manualReason = `Consenso majoritário: ${fallVotes}/${totalVotes} modelos indicam baixa.`;
        }
        
        let triggerSignal: Signal = 'HOLD';
        let triggerReason = `Nenhuma confirmação dupla de assertividade (> ${currentRiskManager.assertivenessThreshold}%).`;
        let triggeredBy: [string, string] | null = null;
        
        for (let i = 1; i < horizons.length; i++) {
            const currentHorizon = horizons[i].name;
            const prevHorizon = horizons[i-1].name;
            if (newAssertiveness[currentHorizon].accuracy > currentRiskManager.assertivenessThreshold && newAssertiveness[prevHorizon].accuracy > currentRiskManager.assertivenessThreshold) {
                if (newAssertiveness[currentHorizon].vote === newAssertiveness[prevHorizon].vote && newAssertiveness[currentHorizon].vote !== 'HOLD') {
                    const signalCandidate = newAssertiveness[currentHorizon].vote;
                    if (currentContractType === 'Multipliers' || currentContractType === 'Rise/Fall') {
                        if ((signalCandidate === 'RISE' && currentMacroTrend === 'UP') || (signalCandidate === 'FALL' && currentMacroTrend === 'DOWN')) {
                           triggerSignal = signalCandidate;
                           triggeredBy = [prevHorizon, currentHorizon];
                           triggerReason = `Gatilho ${triggerSignal} confirmado por assertividade e alinhamento com a tendência macro.`;
                           break;
                        } else {
                           triggerReason = `Sinal ${signalCandidate} ignorado. Contra a tendência macro (${currentMacroTrend}).`;
                        }
                    } else { // Accumulators
                        triggerSignal = 'RISE'; // Para acumuladores, qualquer sinal de alta previsibilidade é positivo. Usamos RISE como placeholder.
                        triggeredBy = [prevHorizon, currentHorizon];
                        triggerReason = `Gatilho de estabilidade detectado por assertividade em ${prevHorizon} e ${currentHorizon}.`;
                        break;
                    }
                }
            }
        }
        
        const currentState: Omit<MasterAutopilotState, 'isReady'> = { 
            assertiveness: newAssertiveness, 
            trigger: { signal: 'HOLD', reason: triggerReason, triggeredBy: null },
            manualTrigger: { signal: manualSignal, reason: manualReason },
            indicators: calculatedIndicators, 
            microstructure: microFeatures 
        };

        if (triggerSignal !== 'HOLD' && !isCoolingDownRef.current && !openMasterTrade && isAutopilotOn) {
            isCoolingDownRef.current = true;
            currentState.trigger = { signal: triggerSignal, reason: `Gatilho ${triggerSignal} detectado! Executando...`, triggeredBy };
            
            executeTradeAction('Piloto').finally(() => {
                setTimeout(() => { isCoolingDownRef.current = false; }, 60000);
            });
        } else {
             currentState.trigger = { signal: triggerSignal, reason: triggerReason, triggeredBy: triggeredBy };
        }

        setMasterState(prev => ({...prev, ...currentState, isReady: true }));

    }, 2000);

    return () => clearInterval(interval);

  }, [isAutopilotOn, isConnected, executeTradeAction, toast, dailyBalance, setAssertivenessThreshold]);
    
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
    setAssertivenessThreshold,
    macroTrend,
    executeManualTrigger,
    // Pass-through dos dados da API ativa
    activeSymbol,
    priceTicks,
    botCandleData,
    operationsLog,
    isConnected,
  };
}
