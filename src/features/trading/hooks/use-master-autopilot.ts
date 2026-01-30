// src/features/trading/hooks/use-master-autopilot.ts
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { useToast } from '@/hooks/use-toast';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { getCouncilStrategies } from '@/services/council-strategies';
import type { DurationUnit, Operation, OperationInitiator, MarketRegime } from '@/lib/types';
import { extractMicrostructureFeatures, type MicrostructureFeatures, detectMarketRegime as detectMarketRegimeService } from '@/services/advanced-trading-services';
import { evaluateTriggerConditions } from '../services/predictive-logic';


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

export interface AssertivenessData {
    accuracy: number;
    vote: Signal;
}

export interface RiskManagerStatus {
    mode: 'Normal' | 'Cautious';
    thresholds: Record<string, number>;
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
    currentRegime: { // NOVO
        regime: MarketRegime;
        confidence: number;
    };
}

const isRegimeCompatible = (contract: ContractType, regime: MarketRegime): boolean => {
    switch (contract) {
        case 'Accumulators':
            return regime === 'ranging';
        case 'Multipliers':
            return regime === 'trending_bull' || regime === 'trending_bear' || regime === 'breakout';
        case 'Rise/Fall':
            return true; // Rise/Fall is generally applicable for now
        default:
            return false;
    }
}


export function useMasterAutopilot() {
  const v2Api = useDerivApiV2();
  
  const { toast } = useToast();

  const [isAutopilotOn, setIsAutopilotOn] = useState(false);
  const [contractType, setContractType] = useState<ContractType>('Rise/Fall');
  const [dailyBalance, setDailyBalance] = useState(100.0);
  const [dailyTarget, setDailyTarget] = useState(20.0);
  
  const [riskManager, setRiskManager] = useState<RiskManagerStatus>({
    mode: 'Normal',
    thresholds: {
      '3t': 80, '6t': 80, '10s': 80,
      '20s': 80, '30s': 80, '40s': 80,
    },
    lastAdjustmentReason: 'N/A'
  });
  const processedTradesRef = useRef<Set<number>>(new Set());
  
  const [masterState, setMasterState] = useState<MasterAutopilotState>({
    isReady: false,
    assertiveness: {},
    trigger: { signal: 'HOLD', reason: 'Piloto desativado ou dados insuficientes.', triggeredBy: null },
    manualTrigger: { signal: 'HOLD', reason: 'Aguardando consenso dos modelos.'},
    indicators: null,
    microstructure: null,
    currentRegime: { regime: 'ranging', confidence: 0 },
  });
  
  const [macroTrend, setMacroTrend] = useState<TrendDirection>('NONE');
  
  const cooldownRef = useRef(false);
  
  const activeApi = v2Api;
  
  const { 
    activeSymbol, 
    priceTicks, 
    botCandleData, 
    operationsLog, 
    isConnected,
  } = activeApi;

  const { executeTrade: executeRiseFallTrade } = v2Api;

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
  const horizons = useMemo(() => Object.keys(accuracyHistoryRefs), [accuracyHistoryRefs]);


  const toggleAutopilot = useCallback((checked: boolean) => {
    setIsAutopilotOn(checked);
    toast({ title: `Master Autopilot ${checked ? 'Ativado' : 'Desativado'}` });
    if (!checked) {
        setMasterState(prev => ({...prev, trigger: { signal: 'HOLD', reason: 'Piloto desativado.', triggeredBy: null }}));
    }
  }, [toast]);
  
  const executeTradeAction = useCallback(async (initiator: OperationInitiator, signalOverride: Signal, triggeredBy: [string, string] | null) => {
      const currentContractType = contractType;
      
      const signalToUse = signalOverride;
      
      if (signalToUse === 'HOLD' || !activeSymbol || !triggeredBy) {
          toast({ title: "Nenhum sinal válido", description: "O gatilho preditivo não detectou uma oportunidade.", variant: "destructive"});
          return;
      }

      toast({ title: `🤖 Master Autopilot: Ordem ${initiator} ${signalToUse}!`, description: `Executando ${currentContractType} em ${activeSymbol}`});

      try {
          if (currentContractType === 'Rise/Fall') {
              const longerHorizon = triggeredBy[1]; 
              const durationMatch = longerHorizon.match(/(\d+)([st])/);
              if (durationMatch) {
                  const duration = parseInt(durationMatch[1], 10);
                  const durationUnit = durationMatch[2] as 's' | 't';
                  await executeRiseFallTrade(
                      signalToUse === 'RISE' ? 'CALL' : 'PUT',
                      1.0, // Stake fixo por enquanto para o piloto
                      activeSymbol,
                      signalToUse.toLowerCase() as 'rise' | 'fall',
                      duration,
                      durationUnit,
                      initiator
                  );
              }
          } else {
              toast({ title: "Funcionalidade Limitada", description: `A execução para ${currentContractType} ainda não está operacional neste modo unificado.`, variant: "default"});
          }
      } catch (error) {
          console.error("Master Autopilot Execution Error:", error);
          toast({ title: `❌ Erro na Execução ${initiator}`, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      }
  }, [activeSymbol, executeRiseFallTrade, toast, contractType]);
  
  const executeManualTrigger = useCallback(async () => {
    const { signal } = masterState.manualTrigger;
    await executeTradeAction('Manual', signal, ['manual', 'manual']);
  }, [executeTradeAction, masterState.manualTrigger]);
  
  const setGlobalAssertivenessThreshold = useCallback((value: number) => {
      setRiskManager(prev => {
          const newThresholds: Record<string, number> = {};
          Object.keys(prev.thresholds).forEach(key => {
              newThresholds[key] = value;
          });
          return {...prev, thresholds: newThresholds};
      });
  }, []);

  const setIndividualThreshold = useCallback((horizon: string, value: number) => {
    setRiskManager(prev => ({
        ...prev,
        thresholds: {
            ...prev.thresholds,
            [horizon]: value,
        }
    }));
  }, []);

  const evaluateManualTrigger = useCallback((assertiveness: Record<string, AssertivenessData>): {signal: Signal, reason: string} => {
    const votes = { RISE: 0, FALL: 0 };
    Object.values(assertiveness).forEach(expert => {
        const effectiveVote = expert.accuracy > 50 ? expert.vote : (expert.vote === 'RISE' ? 'FALL' : 'RISE');
        if (effectiveVote !== 'HOLD') {
            votes[effectiveVote]++;
        }
    });

    if (votes.RISE >= 4) return { signal: 'RISE', reason: `${votes.RISE}/6 Modelos concordam com Alta.` };
    if (votes.FALL >= 4) return { signal: 'FALL', reason: `${votes.FALL}/6 Modelos concordam com Baixa.` };
    return { signal: 'HOLD', reason: 'Aguardando consenso dos modelos.' };
  }, []);

  const runAutopilotCycle = useCallback(() => {
    if (priceTicks.length < 50) {
      if (masterState.isReady) {
        setMasterState(prev => ({...prev, isReady: false, trigger: { signal: 'HOLD', reason: 'Aguardando dados...', triggeredBy: null }}));
      }
      return;
    }

    const currentTick = priceTicks[priceTicks.length - 1];
    if(!currentTick) return;

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
    const detectedRegimeResult = detectMarketRegimeService(botCandleData, calculatedIndicators, macroTrend);
    
    if (calculatedIndicators && calculatedIndicators.ma.long) {
        const detectedTrend: TrendDirection = lastPrice > calculatedIndicators.ma.long ? 'UP' : 'DOWN';
        if (macroTrend !== detectedTrend) setMacroTrend(detectedTrend);
    }
    
    const projectPath = (steps: number) => {
        let currentSimPrice = lastPrice; const path = [];
        for (let i = 1; i <= steps; i++) {
            currentSimPrice *= Math.exp(meanLastReturn + lastSigma * normalRandom());
            path.push({ time: prices.length - 1 + i, price: currentSimPrice });
        }
        return path;
    };

    const newAssertiveness: Record<string, AssertivenessData> = {};
    
    horizons.forEach(name => {
      const hConfig = {
          '3t': { ticks: 3, window: 6 }, '6t': { ticks: 6, window: 6 }, '10s': { ticks: 10, window: 10 },
          '20s': { ticks: 20, window: 10 }, '30s': { ticks: 30, window: 10 }, '40s': { ticks: 40, window: 10 },
      }[name]!;
      
      const pendingRef = pendingPredictionsRefs[name as keyof typeof pendingPredictionsRefs];
      const historyRef = accuracyHistoryRefs[name as keyof typeof accuracyHistoryRefs];
      
      const newFuturePath = projectPath(hConfig.ticks);
      const currentTimeIndex = prices.length - 1; 
      let newHistory: boolean[] = [];
      pendingRef.current = pendingRef.current.filter(pred => {
          if (currentTimeIndex >= pred.startTimeIndex + hConfig.ticks) {
              const actualEndPrice = prices[pred.startTimeIndex + hConfig.ticks];
              if(actualEndPrice !== undefined) newHistory.push((pred.predictedEndPrice > pred.startPrice) === (actualEndPrice > pred.startPrice));
              return false;
          }
          return true;
      });
      if (newHistory.length > 0) historyRef.current = [...historyRef.current.slice(-hConfig.window + newHistory.length), ...newHistory];
      if (newFuturePath.length === hConfig.ticks) pendingRef.current.push({startTimeIndex: prices.length - 1, startPrice: lastPrice, predictedEndPrice: newFuturePath[hConfig.ticks - 1].price});
      
      const { length: total } = historyRef.current;
      const hits = historyRef.current.filter(h => h).length;
      newAssertiveness[name] = { 
          accuracy: total > 0 ? (hits / total) * 100 : 0, 
          vote: newFuturePath.length > 0 ? (newFuturePath[newFuturePath.length - 1].price > lastPrice ? 'RISE' : 'FALL') : 'HOLD' 
      };
    });

    const manualSignal = evaluateManualTrigger(newAssertiveness);
    
    const { newTriggerSignal, newTriggerReason, newTriggeredBy } = evaluateTriggerConditions(
        newAssertiveness, 
        horizons.map(name => ({name, ticks: 0, window: 0})), 
        riskManager.thresholds,
        contractType,
        detectedRegimeResult.regime,
        macroTrend
    );
    
    setMasterState({
        isReady: true,
        assertiveness: newAssertiveness,
        trigger: { signal: newTriggerSignal, reason: newTriggerReason, triggeredBy: newTriggeredBy },
        manualTrigger: manualSignal,
        indicators: calculatedIndicators,
        microstructure: microFeatures,
        currentRegime: detectedRegimeResult
    });

  }, [botCandleData, contractType, evaluateManualTrigger, isAutopilotOn, macroTrend, priceTicks, riskManager, setMasterState, horizons]);

  useEffect(() => {
    const intervalId = setInterval(runAutopilotCycle, 1000);
    return () => clearInterval(intervalId);
  }, [runAutopilotCycle]);

   useEffect(() => {
    const openMasterTrade = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');
    
    if (isAutopilotOn && masterState.trigger.signal !== 'HOLD' && !cooldownRef.current && !openMasterTrade) {
      cooldownRef.current = true;
      executeTradeAction('Piloto', masterState.trigger.signal, masterState.trigger.triggeredBy);
      setTimeout(() => { cooldownRef.current = false; }, 60000);
    }
  }, [isAutopilotOn, masterState.trigger, operationsLog, executeTradeAction]);

  useEffect(() => {
    const lastFinishedTrade = operationsLog.find(op => op.status !== 'pending' && op.initiator === 'Piloto' && !processedTradesRef.current.has(op.id));
    if (lastFinishedTrade) {
        processedTradesRef.current.add(lastFinishedTrade.id);
        const isWin = lastFinishedTrade.result !== undefined && lastFinishedTrade.result >= 0;
        setRiskManager(prev => {
            if (isWin) {
                return { 
                    ...prev,
                    mode: 'Normal', 
                    lastAdjustmentReason: 'Vitória: Aumentando confiança.'
                };
            } else {
                const newThresholds = { ...prev.thresholds };
                Object.keys(newThresholds).forEach(key => {
                    newThresholds[key] = Math.min(95, newThresholds[key] + 5);
                });
                return {
                    mode: 'Cautious',
                    thresholds: newThresholds,
                    lastAdjustmentReason: 'Derrota: Aumentando cautela.'
                };
            }
        });
    }
  }, [operationsLog]);
    
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
    setGlobalAssertivenessThreshold,
    setIndividualThreshold,
    macroTrend,
    executeManualTrigger,
    activeSymbol,
    priceTicks,
    botCandleData,
    operationsLog,
    isConnected,
  };
}
