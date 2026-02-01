// src/features/trading/hooks/use-master-autopilot.ts
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { useToast } from '@/hooks/use-toast';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { getCouncilStrategies } from '@/services/council-strategies';
import type { DurationUnit, Operation, OperationInitiator, MarketRegime, CandleData, PredictiveTradeLog } from '@/lib/types';
import { extractMicrostructureFeatures, type MicrostructureFeatures, detectMarketRegime as detectMarketRegimeService } from '@/services/advanced-trading-services';
import { evaluateTriggerConditions } from '../services/predictive-logic';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { savePredictiveTradeLog } from '@/services/financial-data-service';
import type { User } from 'firebase/auth';


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
    assertiveness: Record<string, AssertivenessData>;
}

const calculateDynamicThresholds = (
  regime: MarketRegime,
  indicators: Indicators | null,
  baseThresholds: Record<string, number>
): Record<string, number> => {
  
  const dynamicThresholds = { ...baseThresholds };
  
  if (regime === 'trending_bull' || regime === 'trending_bear') {
    if (indicators?.adx && indicators.adx > 30) {
      Object.keys(dynamicThresholds).forEach(key => {
        dynamicThresholds[key] = Math.max(55, dynamicThresholds[key] - 10);
      });
    }
  }
  
  if (regime === 'ranging') {
    Object.keys(dynamicThresholds).forEach(key => {
      if (key.endsWith('s') && parseInt(key) > 20) {
        dynamicThresholds[key] = Math.min(90, dynamicThresholds[key] + 5);
      }
    });
  }
  
  if (indicators?.atr && indicators.sma[indicators.sma.length-1] && indicators.atr > 1.5 * (indicators.sma[indicators.sma.length - 1] || 1) * 0.01) {
    dynamicThresholds['30s'] = 95;
    dynamicThresholds['40s'] = 95;
  }
  
  if (indicators?.bbw && indicators.bbw < 2) {
    dynamicThresholds['10t'] = Math.max(50, dynamicThresholds['10t'] - 15);
    dynamicThresholds['20s'] = Math.max(50, dynamicThresholds['20s'] - 15);
  }
  
  return dynamicThresholds;
};


export function useMasterAutopilot() {
  const { 
    activeSymbol, 
    priceTicks, 
    botCandleData, 
    operationsLog, 
    isConnected,
    executeTrade: executeRiseFallTrade 
  } = useDerivApiV2();
  
  const { user } = useAuth();
  const { toast } = useToast();

  const [isAutopilotOn, setIsAutopilotOn] = useState(false);
  const [contractType, setContractType] = useState<ContractType>('Rise/Fall');
  const [dailyBalance, setDailyBalance] = useState(100.0);
  const [dailyTarget, setDailyTarget] = useState(20.0);
  
  const [riskManager, setRiskManager] = useState<RiskManagerStatus>({
    mode: 'Normal',
    thresholds: {
      '3t': 65, '6t': 68, '10t': 62,
      '20s': 60, '30s': 58, '40s': 55,
    },
    lastAdjustmentReason: 'N/A'
  });
  const processedTradesRef = useRef<Set<number>>(new Set());
  const tradesInFlightRef = useRef<Map<number, { triggeredBy: [string, string] | null }>>(new Map());

  const [masterState, setMasterState] = useState<MasterAutopilotState>({
    isReady: false,
    trigger: { signal: 'HOLD', reason: 'Piloto desativado ou dados insuficientes.', triggeredBy: null },
    manualTrigger: { signal: 'HOLD', reason: 'Aguardando consenso dos modelos.'},
    indicators: null,
    microstructure: null,
    currentRegime: { regime: 'ranging', confidence: 0 },
    assertiveness: {},
  });
  
  const cooldownRef = useRef(false);
  
  const [isNeighborConfirmationEnabled, setIsNeighborConfirmationEnabled] = useState(true);
  const [isMacroTrendCheckEnabled, setIsMacroTrendCheckEnabled] = useState(true);
  const [highFrequencyThreshold, setHighFrequencyThreshold] = useState(10);
  
  const horizons = useMemo(() => [
      { name: '3t', ticks: 3, window: 50 }, { name: '6t', ticks: 6, window: 50 },
      { name: '10t', ticks: 10, window: 100 }, { name: '20s', ticks: 20, window: 100 },
      { name: '30s', ticks: 30, window: 75 }, { name: '40s', ticks: 40, window: 75 },
  ], []);

  const toggleAutopilot = useCallback((checked: boolean) => {
    setIsAutopilotOn(checked);
    toast({ title: `Master Autopilot ${checked ? 'Ativado' : 'Desativado'}` });
    if (!checked) {
        setMasterState(prev => ({...prev, trigger: { signal: 'HOLD', reason: 'Piloto desativado.', triggeredBy: null }}));
    }
  }, [toast]);
  
  const executeTradeAction = useCallback(async (
    initiator: OperationInitiator, 
    signalOverride: Signal, 
    triggeredBy: [string, string] | null,
    currentUser: User | null,
    triggerReason: string,
    assertiveness: Record<string, AssertivenessData>
  ) => {
      const signalToUse = signalOverride;
      
      if (signalToUse === 'HOLD' || !activeSymbol || !triggeredBy) {
          toast({ title: "Nenhum sinal válido", description: "O gatilho preditivo não detectou uma oportunidade.", variant: "destructive"});
          return;
      }

      toast({ title: `🤖 Master Autopilot: Ordem ${initiator} ${signalToUse}!`, description: `Executando ${contractType} em ${activeSymbol}`});

      try {
          if (contractType === 'Rise/Fall') {
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

              const tradeResult = await executeRiseFallTrade(
                  signalToUse === 'RISE' ? 'CALL' : 'PUT',
                  1.0, 
                  activeSymbol,
                  signalToUse.toLowerCase() as 'rise' | 'fall',
                  duration,
                  durationUnit,
                  initiator
              );

              if (tradeResult.success && tradeResult.contractId && currentUser) {
                  tradesInFlightRef.current.set(tradeResult.contractId, { triggeredBy });

                  const logId = `pred_log_${tradeResult.contractId}`;
                  const logContext = {
                      triggerReason: triggerReason,
                      assertivenessSnapshot: Object.entries(assertiveness).map(([horizon, data]) => ({
                          horizon,
                          accuracy: data.accuracy,
                          vote: data.vote,
                      })),
                  };

                  const tradeLog: PredictiveTradeLog = {
                      id: logId,
                      contractId: tradeResult.contractId,
                      timestamp: new Date().toISOString(),
                      asset: activeSymbol,
                      tradeParams: {
                          direction: signalToUse,
                          stake: 1.0,
                          duration: duration,
                          durationUnit: durationUnit,
                      },
                      context: logContext,
                      result: 'pending',
                      pnl: 0,
                  };
                  
                  savePredictiveTradeLog(currentUser.uid, tradeLog);
              }

          } else {
              toast({ title: "Funcionalidade Limitada", description: `A execução para ${contractType} ainda não está operacional.`, variant: "default"});
          }
      } catch (error) {
          console.error("Master Autopilot Execution Error:", error);
          toast({ title: `❌ Erro na Execução ${initiator}`, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      }
  }, [contractType, activeSymbol, user, executeRiseFallTrade, toast]);
  
  const runAutopilotCycle = useCallback(() => {
    if (priceTicks.length < 50) {
        setMasterState(prev => {
            if (prev.isReady) {
                return {...prev, isReady: false, trigger: { signal: 'HOLD', reason: 'Aguardando dados...', triggeredBy: null }};
            }
            return prev;
        });
        return;
    }
    const currentTick = priceTicks[priceTicks.length - 1];
    if(!currentTick) return;
    
    const lastPrice = currentTick.price;
    const calculatedIndicators = calculateAllIndicators(botCandleData, getCouncilStrategies(), '1m', {duration: 15, unit: 's'});
    const microFeatures = extractMicrostructureFeatures(priceTicks, botCandleData);
    const detectedRegimeResult = detectMarketRegimeService(botCandleData, calculatedIndicators, 'NONE');
    
    const adaptiveThresholds = calculateDynamicThresholds(
        detectedRegimeResult.regime,
        calculatedIndicators,
        riskManager.thresholds
    );

    const { newTriggerSignal, newTriggerReason, newTriggeredBy } = evaluateTriggerConditions(
        masterState.assertiveness,
        horizons,
        adaptiveThresholds,
        contractType,
        detectedRegimeResult.regime,
        lastPrice,
        botCandleData,
        isNeighborConfirmationEnabled,
        isMacroTrendCheckEnabled,
        highFrequencyThreshold,
    );
    
    const manualSignal = evaluateTriggerConditions(
        masterState.assertiveness,
        horizons,
        Object.fromEntries(Object.keys(riskManager.thresholds).map(k => [k, 55])),
        contractType,
        detectedRegimeResult.regime,
        lastPrice,
        botCandleData,
        false, 
        true,
        highFrequencyThreshold,
    );

    setMasterState(prev => ({
        ...prev,
        isReady: true,
        trigger: { signal: newTriggerSignal, reason: newTriggerReason, triggeredBy: newTriggeredBy },
        manualTrigger: { signal: manualSignal.newTriggerSignal, reason: manualSignal.newTriggerReason },
        indicators: calculatedIndicators,
        microstructure: microFeatures,
        currentRegime: detectedRegimeResult,
    }));

    const openMasterTrade = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');
    if (isAutopilotOn && newTriggerSignal !== 'HOLD' && !cooldownRef.current && !openMasterTrade) {
      cooldownRef.current = true;
      executeTradeAction('Piloto', newTriggerSignal, newTriggeredBy, user, newTriggerReason, masterState.assertiveness);
      setTimeout(() => { cooldownRef.current = false; }, 20000);
    }
    
    console.log('[AUTOPILOT DEBUG]', {
      timestamp: new Date().toISOString(),
      isAutopilotOn,
      openTrades: operationsLog.filter(op => op.status === 'pending').length,
      triggerSignal: newTriggerSignal,
      triggerReason: newTriggerReason,
      assertiveness: Object.entries(masterState.assertiveness).map(([k, v]) => ({
        horizon: k,
        accuracy: v.accuracy.toFixed(1),
        vote: v.vote
      }))
    });

  }, [
    priceTicks, botCandleData, riskManager.thresholds, contractType, isNeighborConfirmationEnabled, 
    isMacroTrendCheckEnabled, highFrequencyThreshold, horizons, user, executeTradeAction, 
    operationsLog, toast, isAutopilotOn, masterState.assertiveness
  ]);

  const executeManualTrigger = useCallback(async () => {
    const { signal, reason } = masterState.manualTrigger;
    const { assertiveness } = masterState;
    const assertivenessArray = Object.entries(assertiveness);
    const strongest = assertivenessArray.length > 0 ? assertivenessArray.reduce((a, b) => {
        const accA = Math.max(a[1].accuracy, 100 - a[1].accuracy);
        const accB = Math.max(b[1].accuracy, 100 - b[1].accuracy);
        return accA > accB ? a : b;
    })[0] : 'manual';
    
    await executeTradeAction('Manual', signal, [strongest, strongest], user, reason, assertiveness);
  }, [executeTradeAction, masterState, user]);
  
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

    useEffect(() => {
        const lastFinishedTrade = operationsLog.find(op => op.status !== 'pending' && op.initiator === 'Piloto' && !processedTradesRef.current.has(op.id));
        if (lastFinishedTrade) {
            processedTradesRef.current.add(lastFinishedTrade.id);
            const isWin = lastFinishedTrade.result !== undefined && lastFinishedTrade.result >= 0;
            
            const tradeContext = tradesInFlightRef.current.get(lastFinishedTrade.id);
            
            setRiskManager(prev => {
                const newThresholds = { ...prev.thresholds };
                let adjustmentReason: string;

                if (tradeContext && tradeContext.triggeredBy) {
                    const horizons = tradeContext.triggeredBy;
                    adjustmentReason = `Ajuste para ${horizons.join(' & ')}: ${isWin ? 'Recompensa (reduzindo limiar)' : 'Penalidade (aumentando limiar)'}.`;
                    
                    horizons.forEach(horizon => {
                        if (newThresholds[horizon]) {
                            if (isWin) {
                                // REWARD: Decrease threshold, making it easier to trigger
                                newThresholds[horizon] = Math.max(55, newThresholds[horizon] - 2); 
                            } else {
                                // PENALTY: Increase threshold, making it harder
                                newThresholds[horizon] = Math.min(95, newThresholds[horizon] + 5); 
                            }
                        }
                    });
                     // Cleanup the ref for the processed trade
                    tradesInFlightRef.current.delete(lastFinishedTrade.id);

                } else {
                    adjustmentReason = `Ajuste Global (Contexto não encontrado): ${isWin ? 'Relaxando limiares.' : 'Aumentando cautela.'}.`;
                    // Fallback to global adjustment
                    if (!isWin) {
                        Object.keys(newThresholds).forEach(key => {
                            newThresholds[key] = Math.min(95, newThresholds[key] + 5);
                        });
                    } else {
                        // Optional: slightly reduce all thresholds on a win without context
                         Object.keys(newThresholds).forEach(key => {
                            newThresholds[key] = Math.max(55, newThresholds[key] - 1);
                        });
                    }
                }

                return {
                    mode: isWin ? 'Normal' : 'Cautious',
                    thresholds: newThresholds,
                    lastAdjustmentReason: adjustmentReason,
                };
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
    setMasterState,
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
    setHighFrequencyThreshold,
    macroTrend: 'NONE' // This needs proper implementation
  };
}
