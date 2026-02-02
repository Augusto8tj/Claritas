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

const getAdaptiveCooldown = (duration: number, unit: string, isLastTradeWin: boolean) => {
  const baseSeconds = unit === 's' ? duration : duration * 2;
  const multiplier = isLastTradeWin ? 1.5 : 3.0; // Pausa maior após perda
  return Math.max(baseSeconds * multiplier * 1000, 15000);
};

const detectNoiseRegime = (experts: Record<string, AssertivenessData>): boolean => {
  const activeExperts = Object.values(experts);
  if (activeExperts.length < 5) return false;
  
  const avgWinRate = activeExperts.reduce((sum, e) => sum + e.accuracy, 0) / activeExperts.length;
  const winRateVariance = activeExperts.reduce((sum, e) => 
    sum + Math.pow(e.accuracy - avgWinRate, 2), 0
  ) / activeExperts.length;

  // Se a maioria dos modelos está em ~50% ± 3%, é ruído puro
  return avgWinRate > 48 && avgWinRate < 52 && winRateVariance < 10;
};

const calculateOptimalStake = (winRate: number, dailyBalance: number, payout: number = 0.95): number => {
    if (winRate < 51.5) return 1.0; 
    const p = winRate / 100;
    const q = 1 - p;
    const b = payout;

    const kellyFraction = (p * b - q) / b;
    if (kellyFraction <= 0) return 1.0;

    const quarterKelly = kellyFraction / 4;
    const calculatedStake = dailyBalance * quarterKelly;

    return Math.max(1.0, Math.min(calculatedStake, dailyBalance * 0.05));
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
      '1t': 52, '3t': 52, '6t': 52, '10t': 53,
      '15s': 53, '20s': 53, '30s': 54, '40s': 54, '50s': 54,
    },
    lastAdjustmentReason: 'N/A'
  });
  
  const tradesInFlightRef = useRef<Map<number, { triggeredBy: string[] | null }>>(new Map());
  const processedTradesRef = useRef<Set<number>>(new Set());
  const tradeStatsRef = useRef({ totalTrades: 0, wins: 0 });
  const horizonCooldownsRef = useRef<Map<string, number>>(new Map());

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
  
  const cooldownRef = useRef<{active: boolean, timeoutId?: NodeJS.Timeout}>({ active: false });
  
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
            return { duration: 0, unit: 's'};
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
                
                const triggerWinRates = triggeredBy.map(h => currentAssertiveness[h] ? Math.max(currentAssertiveness[h].accuracy, 100 - currentAssertiveness[h].accuracy) : 0);
                const maxWinRate = Math.max(...triggerWinRates);
                const optimalStake = calculateOptimalStake(maxWinRate, dailyBalance);

                const tradeResult = await executeRiseFallTrade(
                    signalToUse === 'RISE' ? 'CALL' : 'PUT',
                    optimalStake, 
                    activeSymbol,
                    signalToUse.toLowerCase() as 'rise' | 'fall',
                    duration,
                    durationUnit,
                    initiator
                );

                if (tradeResult.success && tradeResult.contractId && currentUser) {
                    tradesInFlightRef.current.set(tradeResult.contractId, { triggeredBy });
                    toast({ title: `🤖 Master Autopilot: Ordem ${initiator} ${signalToUse}!`, description: `Stake: $${optimalStake.toFixed(2)}. Duração: ${duration}${durationUnit}.`});

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
                            stake: optimalStake,
                            duration: duration,
                            durationUnit: durationUnit,
                        },
                        context: logContext,
                        result: 'pending',
                        pnl: 0,
                    };
                    
                    savePredictiveTradeLog(currentUser.uid, tradeLog);
                }

                return { duration, unit: durationUnit };

            } else {
                toast({ title: "Funcionalidade Limitada", description: `A execução para ${contractType} ainda não está operacional.`, variant: "default"});
                return { duration: 0, unit: 's'};
            }
        } catch (error) {
            console.error("Master Autopilot Execution Error:", error);
            toast({ title: `❌ Erro na Execução ${initiator}`, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
            return { duration: 0, unit: 's'};
        }
    }, [contractType, activeSymbol, executeRiseFallTrade, toast, dailyBalance]);
  
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
        
        const isNoise = detectNoiseRegime(newAssertiveness);
        if (isNoise) {
            return {
                ...prevState,
                isReady: true,
                trigger: {
                    signal: 'HOLD',
                    reason: '🌀 Regime de ruído detectado. Pausando.',
                    triggeredBy: null,
                },
            };
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
    
    const now = Date.now();
    const isAnyTriggeringHorizonOnCooldown = trigger.triggeredBy?.some(horizon => {
        const cooldownEnd = horizonCooldownsRef.current.get(horizon);
        return cooldownEnd && now < cooldownEnd;
    });

    if (isAutopilotOn && trigger.signal !== 'HOLD' && !isAnyTriggeringHorizonOnCooldown && !cooldownRef.current.active && (!openMasterTrade || allowMultiplePositions)) {
      
      executeTradeAction('Piloto', trigger.signal, trigger.triggeredBy, user, trigger.reason, assertiveness)
        .then(({ duration, unit }) => {
            if (duration > 0 && trigger.triggeredBy) {
                const tradeDurationMs = (unit === 's' ? duration : duration * 2) * 1000;
                const horizonCooldownMs = Math.max(tradeDurationMs * 1.5, 10000); 
                const cooldownEnd = Date.now() + horizonCooldownMs;

                trigger.triggeredBy.forEach(horizon => {
                    horizonCooldownsRef.current.set(horizon, cooldownEnd);
                });
            }
        });
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
        
        tradeStatsRef.current.totalTrades++;
        if (isWin) tradeStatsRef.current.wins++;

        const { totalTrades, wins } = tradeStatsRef.current;
        const globalWinRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
        
        if (totalTrades > 200 && globalWinRate < 51) {
            toast({
                variant: 'destructive',
                title: '⚠️ ALERTA: Sistema Abaixo do Breakeven',
                description: `Taxa de acerto global ${globalWinRate.toFixed(1)}% após ${totalTrades} trades. Considere pausar.`,
                duration: 120000
            });
        }

        cooldownRef.current.active = true;
        const cooldownTime = getAdaptiveCooldown(lastFinishedTrade.duration, lastFinishedTrade.durationUnit, isWin);
        if (cooldownRef.current.timeoutId) clearTimeout(cooldownRef.current.timeoutId);
        cooldownRef.current.timeoutId = setTimeout(() => {
            cooldownRef.current.active = false;
        }, cooldownTime);

        setRiskManager(prev => {
            const newThresholds = { ...prev.thresholds };
            let adjustmentReason: string;

            if (tradeContext && tradeContext.triggeredBy) {
                const horizonsToAdjust = tradeContext.triggeredBy;
                adjustmentReason = `Ajuste para ${horizonsToAdjust.join(' & ')}: ${isWin ? 'Recompensa' : 'Penalidade'}.`;
                
                horizonsToAdjust.forEach(horizon => {
                    if (newThresholds[horizon]) {
                        if (isWin) {
                            newThresholds[horizon] = Math.max(51, newThresholds[horizon] - 1); 
                        } else {
                            newThresholds[horizon] = Math.min(70, newThresholds[horizon] + 2); 
                        }
                    }
                });
                tradesInFlightRef.current.delete(lastFinishedTrade.id);

            } else {
                adjustmentReason = `Ajuste Global: ${isWin ? 'Relaxando.' : 'Aumentando cautela.'}.`;
                if (!isWin) {
                    Object.keys(newThresholds).forEach(key => {
                        newThresholds[key] = Math.min(70, newThresholds[key] + 1);
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
  }, [operationsLog, toast]);
    
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
