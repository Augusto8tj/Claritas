// src/features/trading/hooks/use-master-autopilot.ts
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { useToast } from '@/hooks/use-toast';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { getCouncilStrategies } from '@/services/council-strategies';
import type { DurationUnit, Operation, OperationInitiator, MarketRegime, CandleData } from '@/lib/types';
import { extractMicrostructureFeatures, type MicrostructureFeatures, detectMarketRegime as detectMarketRegimeService } from '@/services/advanced-trading-services';
import { evaluateTriggerConditions } from '../services/predictive-logic';


type ContractType = 'Accumulators' | 'Rise/Fall' | 'Multipliers';
type Signal = 'RISE' | 'FALL' | 'HOLD';

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
    currentRegime: { 
        regime: MarketRegime;
        confidence: number;
    };
}

export function useMasterAutopilot() {
  const { 
    activeSymbol, 
    priceTicks, 
    botCandleData, 
    operationsLog, 
    isConnected,
    executeTrade: executeRiseFallTrade 
  } = useDerivApiV2();
  
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
    trigger: { signal: 'HOLD', reason: 'Piloto desativado ou dados insuficientes.', triggeredBy: null },
    manualTrigger: { signal: 'HOLD', reason: 'Aguardando consenso dos modelos.'},
    indicators: null,
    microstructure: null,
    currentRegime: { regime: 'ranging', confidence: 0 },
  });
  
  const cooldownRef = useRef(false);
  
  const [isNeighborConfirmationEnabled, setIsNeighborConfirmationEnabled] = useState(true);
  const [isMacroTrendCheckEnabled, setIsMacroTrendCheckEnabled] = useState(true);
  const [highFrequencyThreshold, setHighFrequencyThreshold] = useState(10);
  
  const horizons = useMemo(() => [
      { name: '3t', ticks: 3, window: 6 }, { name: '6t', ticks: 6, window: 6 },
      { name: '10s', ticks: 10, window: 10 }, { name: '20s', ticks: 20, window: 10 },
      { name: '30s', ticks: 30, window: 10 }, { name: '40s', ticks: 40, window: 10 },
  ], []);

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
              
              let duration: number;
              let durationUnit: 's' | 't';

              if (durationMatch) {
                  duration = parseInt(durationMatch[1], 10);
                  durationUnit = durationMatch[2] as 's' | 't';
              } else {
                  duration = 15;
                  durationUnit = 's';
              }
               await executeRiseFallTrade(
                  signalToUse === 'RISE' ? 'CALL' : 'PUT',
                  1.0, 
                  activeSymbol,
                  signalToUse.toLowerCase() as 'rise' | 'fall',
                  duration,
                  durationUnit,
                  initiator
              );
          } else {
              toast({ title: "Funcionalidade Limitada", description: `A execução para ${currentContractType} ainda não está operacional.`, variant: "default"});
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

  const runAutopilotCycle = useCallback((newAssertiveness: Record<string, AssertivenessData>) => {
    if (priceTicks.length < 50) {
      if (masterState.isReady) {
        setMasterState(prev => ({...prev, isReady: false, trigger: { signal: 'HOLD', reason: 'Aguardando dados...', triggeredBy: null }}));
      }
      return;
    }
    const currentTick = priceTicks[priceTicks.length - 1];
    if(!currentTick) return;
    
    const lastPrice = currentTick.price;
    const calculatedIndicators = calculateAllIndicators(botCandleData, getCouncilStrategies(), '1m', {duration: 15, unit: 's'});
    const microFeatures = extractMicrostructureFeatures(priceTicks, botCandleData);
    const detectedRegimeResult = detectMarketRegimeService(botCandleData, calculatedIndicators, 'NONE');
    
    const manualSignal = evaluateManualTrigger(newAssertiveness);
    
    const { newTriggerSignal, newTriggerReason, newTriggeredBy } = evaluateTriggerConditions(
        newAssertiveness,
        horizons.map(h => ({ name: h.name, ticks: h.ticks, window: h.window })),
        riskManager.thresholds,
        contractType,
        detectedRegimeResult.regime,
        lastPrice,
        botCandleData,
        isNeighborConfirmationEnabled,
        isMacroTrendCheckEnabled,
        highFrequencyThreshold
    );

    console.log('[AUTOPILOT DEBUG]', {
      timestamp: new Date().toISOString(),
      isAutopilotOn,
      openTrades: operationsLog.filter(op => op.status === 'pending').length,
      triggerSignal: newTriggerSignal,
      triggerReason: newTriggerReason,
      assertiveness: Object.entries(newAssertiveness).map(([k, v]) => ({
        horizon: k,
        accuracy: v.accuracy.toFixed(1),
        vote: v.vote
      }))
    });

    setMasterState(prev => ({
        ...prev,
        isReady: true,
        trigger: { signal: newTriggerSignal, reason: newTriggerReason, triggeredBy: newTriggeredBy },
        manualTrigger: manualSignal,
        indicators: calculatedIndicators,
        microstructure: microFeatures,
        currentRegime: detectedRegimeResult,
    }));
    
  }, [
    priceTicks, botCandleData, masterState.isReady, evaluateManualTrigger, horizons, 
    riskManager.thresholds, contractType, isNeighborConfirmationEnabled, isMacroTrendCheckEnabled,
    highFrequencyThreshold, isAutopilotOn, operationsLog
  ]);

  useEffect(() => {
    const openMasterTrade = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');
    
    if (isAutopilotOn && masterState.trigger.signal !== 'HOLD' && !cooldownRef.current && !openMasterTrade) {
      cooldownRef.current = true;
      executeTradeAction('Piloto', masterState.trigger.signal, masterState.trigger.triggeredBy);
      setTimeout(() => { cooldownRef.current = false; }, 20000);
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
    runAutopilotCycle,
    executeManualTrigger,
    isNeighborConfirmationEnabled,
    setIsNeighborConfirmationEnabled,
    isMacroTrendCheckEnabled,
    setIsMacroTrendCheckEnabled,
    highFrequencyThreshold,
    setHighFrequencyThreshold
  };
}
