// src/features/trading/hooks/use-master-autopilot.ts
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { useToast } from '@/hooks/use-toast';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { getCouncilStrategies } from '@/services/council-strategies';
import type { DurationUnit, Operation, OperationInitiator, MarketRegime, CandleData, PredictiveTradeLog } from '@/lib/types';
import { extractMicrostructureFeatures, type MicrostructureFeatures, detectMarketRegime as detectMarketRegimeService } from '@/services/advanced-trading-services';
import { evaluateTriggerConditions, evaluateManualTrigger } from '../services/predictive-logic';
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
        triggeredBy: string[] | null;
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
  
  // CORREÇÃO: Em ranging, os modelos mais longos são mais confiáveis, então o limiar deve ser MENOR, não maior.
  if (regime === 'ranging') {
    Object.keys(dynamicThresholds).forEach(key => {
      if (key.endsWith('s') && parseInt(key) >= 30) {
        dynamicThresholds[key] = Math.max(55, dynamicThresholds[key] - 5); 
      }
    });
  }
  
  if (indicators?.atr && indicators.sma && indicators.sma.length > 0 && indicators.sma[indicators.sma.length - 1] !== null && indicators.atr > 1.5 * (indicators.sma[indicators.sma.length - 1] || 1) * 0.01) {
    dynamicThresholds['30s'] = Math.min(95, dynamicThresholds['30s'] + 10);
    dynamicThresholds['40s'] = Math.min(95, dynamicThresholds['40s'] + 10);
    dynamicThresholds['50s'] = Math.min(95, dynamicThresholds['50s'] + 10);
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
      '1t': 75, '3t': 75, '6t': 78, '10t': 72,
      '15s': 68, '20s': 70, '30s': 68, '40s': 65, '50s': 65,
    },
    lastAdjustmentReason: 'N/A'
  });
  
  const tradesInFlightRef = useRef<Map<number, { triggeredBy: string[] | null }>>(new Map());
  const processedTradesRef = useRef<Set<number>>(new Set());

  const [masterState, setMasterState] = useState<MasterAutopilotState>({
    isReady: false,
    trigger: { signal: 'HOLD', reason: 'Piloto desativado ou dados insuficientes.', triggeredBy: null },
    manualTrigger: { signal: 'HOLD', reason: 'Aguardando consenso dos modelos.'},
    indicators: null,
    microstructure: null,
    currentRegime: { 
        regime: 'ranging', 
        confidence: 0 
    },
    assertiveness: {},
  });
  
  const cooldownRef = useRef(false);
  
  const [isNeighborConfirmationEnabled, setIsNeighborConfirmationEnabled] = useState(true);
  const [isTripleConfirmationEnabled, setIsTripleConfirmationEnabled] = useState(false);
  const [isMacroTrendCheckEnabled, setIsMacroTrendCheckEnabled] = useState(true);
  const [highFrequencyThreshold, setHighFrequencyThreshold] = useState(10);
  const [allowMultiplePositions, setAllowMultiplePositions] = useState(false);
  
  const horizons = useMemo(() => [
      { name: '1t', type: 'tick', window: 6 },
      { name: '3t', type: 'tick', window: 6 },
      { name: '6t', type: 'tick', window: 6 },
      { name: '10t', type: 'tick', window: 10 },
      { name: '15s', type: 'second', window: 10 },
      { name: '20s', type: 'second', window: 10 },
      { name: '30s', type: 'second', window: 75 },
      { name: '40s', type: 'second', window: 75 },
      { name: '50s', type: 'second', window: 75 },
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
        triggeredBy: string[] | null,
        currentUser: User | null,
        triggerReason: string,
        currentAssertiveness: Record<string, AssertivenessData>
    ) => {
        const signalToUse = signalOverride;
        
        if (signalToUse === 'HOLD' || !activeSymbol || !triggeredBy || triggeredBy.length === 0) {
            if(initiator === 'Manual') {
                 toast({ title: "Nenhum sinal válido", description: "O gatilho preditivo não detectou uma oportunidade.", variant: "destructive"});
            }
            return;
        }

        console.log(`[AUTOPILOT EXECUTE] Sinal: ${signalToUse}, Razão: ${triggerReason}`);

        try {
            if (contractType === 'Rise/Fall') {
                const longerHorizon = triggeredBy[triggeredBy.length - 1]; 
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
                    toast({ title: `🤖 Master Autopilot: Ordem ${initiator} ${signalToUse}!`, description: `Executando ${contractType} em ${activeSymbol}`});

                    const logId = `pred_log_${tradeResult.contractId}`;
                    const logContext = {
                        triggerReason: triggerReason,
                        assertivenessSnapshot: Object.entries(currentAssertiveness).map(([horizon, data]) => ({
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
    }, [contractType, activeSymbol, executeRiseFallTrade, toast]);
  
  const runAutopilotCycle = useCallback((newAssertiveness: Record<string, AssertivenessData>) => {
    setMasterState(prevState => {
        if (priceTicks.length < 50) {
          return ({
            ...prevState,
            isReady: false,
            trigger: { signal: 'HOLD', reason: 'Aguardando dados...', triggeredBy: null },
            manualTrigger: { signal: 'HOLD', reason: 'Dados insuficientes.'},
          });
        }
        const currentTick = priceTicks[priceTicks.length - 1];
        if (!currentTick) return prevState;

        const lastPrice = currentTick.price;
        const calculatedIndicators = calculateAllIndicators(botCandleData, getCouncilStrategies(), '1m', { duration: 15, unit: 's' });
        const microFeatures = extractMicrostructureFeatures(priceTicks, botCandleData);
        const detectedRegimeResult = detectMarketRegimeService(botCandleData, calculatedIndicators, prevState.currentRegime.regime);
        
        const adaptiveThresholds = calculateDynamicThresholds(
            detectedRegimeResult.regime,
            calculatedIndicators,
            riskManager.thresholds
        );
        
        const { newTriggerSignal, newTriggerReason, newTriggeredBy } = evaluateTriggerConditions(
            newAssertiveness,
            horizons,
            adaptiveThresholds,
            contractType,
            detectedRegimeResult.regime,
            lastPrice,
            botCandleData,
            isNeighborConfirmationEnabled,
            isTripleConfirmationEnabled,
            isMacroTrendCheckEnabled,
            highFrequencyThreshold,
        );
        
        const { manualTriggerSignal, manualTriggerReason } = evaluateManualTrigger(newAssertiveness);
        
        return {
            isReady: true,
            trigger: { signal: newTriggerSignal, reason: newTriggerReason, triggeredBy: newTriggeredBy },
            manualTrigger: { signal: manualTriggerSignal, reason: manualTriggerReason },
            indicators: calculatedIndicators,
            microstructure: microFeatures,
            currentRegime: detectedRegimeResult,
            assertiveness: newAssertiveness,
        };
    });
  }, [
    priceTicks, botCandleData, horizons, contractType, 
    riskManager.thresholds, isNeighborConfirmationEnabled, isTripleConfirmationEnabled, isMacroTrendCheckEnabled, 
    highFrequencyThreshold
  ]);

  useEffect(() => {
    const { trigger, assertiveness } = masterState;
    const openMasterTrade = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');
    
    if (isAutopilotOn && trigger.signal !== 'HOLD' && !cooldownRef.current && (!openMasterTrade || allowMultiplePositions)) {
      cooldownRef.current = true;
      executeTradeAction('Piloto', trigger.signal, trigger.triggeredBy, user, trigger.reason, assertiveness);
      setTimeout(() => { cooldownRef.current = false; }, 20000); // 20 segundos de cooldown
    }
  }, [masterState, isAutopilotOn, operationsLog, user, executeTradeAction, allowMultiplePositions]);

  const executeManualTrigger = useCallback(async () => {
    const { manualTrigger, assertiveness } = masterState;
    if (manualTrigger.signal === 'HOLD') return;

    const assertivenessArray = Object.entries(assertiveness);
    const strongest = assertivenessArray.length > 0 ? assertivenessArray.reduce((a, b) => {
        const accA = Math.max(a[1].accuracy, 100 - a[1].accuracy);
        const accB = Math.max(b[1].accuracy, 100 - b[1].accuracy);
        return accA > accB ? a : b;
    }) : ['manual', assertiveness['manual']];
    
    await executeTradeAction('Manual', manualTrigger.signal, [strongest[0]], user, manualTrigger.reason, assertiveness);
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
                const horizonsToAdjust = tradeContext.triggeredBy;
                adjustmentReason = `Ajuste para ${horizonsToAdjust.join(' & ')}: ${isWin ? 'Recompensa (reduzindo limiar)' : 'Penalidade (aumentando limiar)'}.`;
                
                horizonsToAdjust.forEach(horizon => {
                    if (newThresholds[horizon]) {
                        if (isWin) {
                            newThresholds[horizon] = Math.max(55, newThresholds[horizon] - 2); 
                        } else {
                            newThresholds[horizon] = Math.min(95, newThresholds[horizon] + 5); 
                        }
                    }
                });
                tradesInFlightRef.current.delete(lastFinishedTrade.id);

            } else {
                adjustmentReason = `Ajuste Global (Contexto de trade não encontrado): ${isWin ? 'Relaxando limiares.' : 'Aumentando cautela.'}.`;
                console.warn(`[RiskManager] Contexto não encontrado para o trade ${lastFinishedTrade.id}. Aplicando ajuste global.`);
                if (!isWin) {
                    Object.keys(newThresholds).forEach(key => {
                        newThresholds[key] = Math.min(95, newThresholds[key] + 5);
                    });
                } else {
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
    isTripleConfirmationEnabled,
    setIsTripleConfirmationEnabled,
    isMacroTrendCheckEnabled,
    setIsMacroTrendCheckEnabled,
    highFrequencyThreshold,
    setHighFrequencyThreshold,
    allowMultiplePositions,
    setAllowMultiplePositions,
    macroTrend: 'NONE'
  };
}
