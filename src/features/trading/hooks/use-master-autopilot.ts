// src/features/trading/hooks/use-master-autopilot.ts
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { useToast } from '@/hooks/use-toast';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { getCouncilStrategies } from '@/services/council-strategies';
import type { DurationUnit, Operation, OperationInitiator, MarketRegime } from '@/lib/types';
import { extractMicrostructureFeatures, type MicrostructureFeatures, detectMarketRegime as detectMarketRegimeService } from '@/services/advanced-trading-services';


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
      assertivenessThreshold: 80,
      lastAdjustmentReason: 'N/A'
  });
  const processedTradesRef = useRef<Set<number>>(new Set());
  
  const masterStateRef = useRef<MasterAutopilotState>({
    isReady: false,
    assertiveness: {},
    trigger: { signal: 'HOLD', reason: 'Piloto desativado ou dados insuficientes.', triggeredBy: null },
    manualTrigger: { signal: 'HOLD', reason: 'Aguardando consenso dos modelos.'},
    indicators: null,
    microstructure: null,
    currentRegime: { regime: 'ranging', confidence: 0 },
  });

  const [masterState, setMasterState] = useState<MasterAutopilotState>(masterStateRef.current);
  
  const [macroTrend, setMacroTrend] = useState<TrendDirection>('NONE');
  
  const isCoolingDownRef = useRef(false);
  const pendingSignalRef = useRef<{ signal: Signal; triggeredBy: [string, string]; epoch: number; } | null>(null);
  
  const activeApi = v2Api;
  
  const { 
    activeSymbol, 
    priceTicks, 
    botCandleData, 
    operationsLog, 
    isConnected,
  } = activeApi;

  const { executeTrade: executeRiseFallTrade } = v2Api;

  const priceTicksRef = useRef(priceTicks);
  priceTicksRef.current = priceTicks;
  const botCandleDataRef = useRef(botCandleData);
  botCandleDataRef.current = botCandleData;
  const operationsLogRef = useRef(operationsLog);
  operationsLogRef.current = operationsLog;
  const riskManagerRef = useRef(riskManager);
  riskManagerRef.current = riskManager;
  const macroTrendRef = useRef(macroTrend);
  macroTrendRef.current = macroTrend;
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
        pendingSignalRef.current = null;
        masterStateRef.current = {...masterStateRef.current, trigger: { signal: 'HOLD', reason: 'Piloto desativado.', triggeredBy: null }};
        setMasterState(masterStateRef.current);
    }
  }, [toast]);
  
  const executeTradeAction = useCallback(async (initiator: OperationInitiator, signalOverride: Signal, triggeredBy: [string, string] | null) => {
      const state = masterStateRef.current;
      const currentContractType = contractTypeRef.current;
      
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
  }, [activeSymbol, executeRiseFallTrade, toast]);
  
  const executeManualTrigger = useCallback(async () => {
    const { signal } = masterStateRef.current.manualTrigger;
    await executeTradeAction('Manual', signal, ['manual', 'manual']);
  }, [executeTradeAction]);
  
  const setAssertivenessThreshold = useCallback((value: number) => {
      setRiskManager(prev => ({...prev, assertivenessThreshold: value}));
  }, []);

  const evaluateTriggerConditions = useCallback((
      newAssertiveness: Record<string, AssertivenessData>,
      currentRiskManager: RiskManagerStatus,
      currentContractType: ContractType,
      detectedRegime: MarketRegime,
      currentMacroTrend: TrendDirection,
      horizons: { name: string; ticks: number; window: number }[]
  ): { newTriggerSignal: Signal, newTriggerReason: string, newTriggeredBy: [string, string] | null } => {
        let newTriggerSignal: Signal = 'HOLD';
        let newTriggerReason = `Nenhuma confirmação dupla de assertividade (> ${currentRiskManager.assertivenessThreshold}%).`;
        let newTriggeredBy: [string, string] | null = null;
        
        for (let i = 1; i < horizons.length; i++) {
            const currentHorizon = horizons[i].name;
            const prevHorizon = horizons[i-1].name;
            if (newAssertiveness[currentHorizon].accuracy > currentRiskManager.assertivenessThreshold && newAssertiveness[prevHorizon].accuracy > currentRiskManager.assertivenessThreshold) {
                if (newAssertiveness[currentHorizon].vote === newAssertiveness[prevHorizon].vote && newAssertiveness[currentHorizon].vote !== 'HOLD') {
                    const signalCandidate = newAssertiveness[currentHorizon].vote;
                    const regimeIsCompatible = isRegimeCompatible(currentContractType, detectedRegime);

                    if (!regimeIsCompatible) {
                        newTriggerReason = `Sinal ${signalCandidate} ignorado. Contrato ${currentContractType} incompatível com o regime ${detectedRegime}.`;
                        continue;
                    }
                    
                    if (currentContractType === 'Rise/Fall') {
                        if ((signalCandidate === 'RISE' && currentMacroTrend === 'UP') || (signalCandidate === 'FALL' && currentMacroTrend === 'DOWN')) {
                           newTriggerSignal = signalCandidate;
                           newTriggeredBy = [prevHorizon, currentHorizon];
                           newTriggerReason = `Gatilho ${newTriggerSignal} confirmado por assertividade e alinhamento com a tendência macro.`;
                           break;
                        } else {
                           newTriggerReason = `Sinal ${signalCandidate} ignorado. Contra a tendência macro (${currentMacroTrend}).`;
                        }
                    } else { // Accumulators
                        newTriggerSignal = 'RISE'; // Placeholder para estabilidade
                        newTriggeredBy = [prevHorizon, currentHorizon];
                        newTriggerReason = `Gatilho de estabilidade detectado por assertividade em ${prevHorizon} e ${currentHorizon}.`;
                        break;
                    }
                }
            }
        }
        return { newTriggerSignal, newTriggerReason, newTriggeredBy };
  }, []);

  useEffect(() => {
    const executeLogic = () => {
        if (priceTicksRef.current.length < 50 || !isAutopilotOn) {
          if(!masterStateRef.current.isReady || masterStateRef.current.trigger.signal !== 'HOLD') {
            masterStateRef.current = ({
              ...masterStateRef.current,
              isReady: false,
              trigger: { signal: 'HOLD', reason: isAutopilotOn ? 'Aguardando dados suficientes...' : 'Piloto desativado.', triggeredBy: null }
            });
            setMasterState(masterStateRef.current);
          }
          return;
        }

        const currentTick = priceTicksRef.current[priceTicksRef.current.length-1];
        if(!currentTick) return;

        if (executionRef.current.isExecuting) return;
        executionRef.current.isExecuting = true;

        // ... (cálculos de log-returns e indicadores) ...
        const prices = priceTicksRef.current.map(d => d.price);
        const VOL_WINDOW = 50;
        const lastPrice = prices[prices.length - 1];
        const logReturns: number[] = [];
        for (let i = Math.max(1, prices.length - VOL_WINDOW); i < prices.length; i++) {
            if(prices[i-1] > 0) logReturns.push(Math.log(prices[i] / prices[i - 1]));
        }
        if(logReturns.length === 0) {
            executionRef.current.isExecuting = false;
            return;
        }
        const meanLastReturn = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
        const lastVariance = logReturns.reduce((s, r) => s + Math.pow(r - meanLastReturn, 2), 0) / (logReturns.length - 1);
        const lastSigma = Math.sqrt(lastVariance);
        const calculatedIndicators = calculateAllIndicators(botCandleDataRef.current, getCouncilStrategies(), '1m', {duration: 15, unit: 's'});
        const microFeatures = extractMicrostructureFeatures(priceTicksRef.current, botCandleDataRef.current);
        const detectedRegimeResult = detectMarketRegimeService(botCandleDataRef.current, calculatedIndicators, macroTrendRef.current);
        
        if (calculatedIndicators && calculatedIndicators.ma.long) {
            const detectedTrend: TrendDirection = lastPrice > calculatedIndicators.ma.long ? 'UP' : 'DOWN';
            if (macroTrendRef.current !== detectedTrend) setMacroTrend(detectedTrend);
        }
        
        const projectPath = (steps: number) => {
            let currentSimPrice = lastPrice; const path = [];
            for (let i = 1; i <= steps; i++) {
                currentSimPrice *= Math.exp(meanLastReturn + lastSigma * normalRandom());
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
            const currentTimeIndex = prices.length - 1; let newHistory: boolean[] = [];
            pendingRef.current = pendingRef.current.filter(pred => {
                if (currentTimeIndex >= pred.startTimeIndex + ticks) {
                    const actualEndPrice = prices[pred.startTimeIndex + ticks];
                    if(actualEndPrice !== undefined) newHistory.push((pred.predictedEndPrice > pred.startPrice) === (actualEndPrice > pred.startPrice));
                    return false;
                }
                return true;
            });
            if (newHistory.length > 0) historyRef.current = [...historyRef.current.slice(-window + newHistory.length), ...newHistory];
            if (newFuturePath.length === ticks) pendingRef.current.push({startTimeIndex: prices.length - 1, startPrice: lastPrice, predictedEndPrice: newFuturePath[ticks - 1].price});
            const { length: total } = historyRef.current;
            const hits = historyRef.current.filter(h => h).length;
            newAssertiveness[name] = { accuracy: total > 0 ? (hits / total) * 100 : 0, vote: newFuturePath.length > 0 ? (newFuturePath[newFuturePath.length - 1].price > lastPrice ? 'RISE' : 'FALL') : 'HOLD' };
        });

        // 1. VERIFICAÇÃO DE SINAL PENDENTE (PASSO DE CONFIRMAÇÃO)
        if (pendingSignalRef.current && pendingSignalRef.current.epoch < currentTick.epoch) {
            const pending = pendingSignalRef.current;
            pendingSignalRef.current = null; // Limpa imediatamente
            
            const { newTriggerSignal } = evaluateTriggerConditions(newAssertiveness, riskManagerRef.current, contractTypeRef.current, detectedRegimeResult.regime, macroTrendRef.current, horizons);

            if (newTriggerSignal === pending.signal) {
                toast({ title: `✅ Sinal ${pending.signal} Confirmado!`, description: `Executando ordem...`, variant: 'default' });
                isCoolingDownRef.current = true;
                executeTradeAction('Piloto', newTriggerSignal, pending.triggeredBy).finally(() => {
                    setTimeout(() => { isCoolingDownRef.current = false; }, 60000);
                });
                masterStateRef.current = { ...masterStateRef.current, trigger: { signal: newTriggerSignal, reason: `Executando Ordem Confirmada (${pending.triggeredBy.join(' & ')})`, triggeredBy: pending.triggeredBy } };
            } else {
                toast({ title: `❌ Sinal ${pending.signal} Abortado`, description: `A condição não se manteve no tick seguinte.`, variant: "destructive" });
                masterStateRef.current = { ...masterStateRef.current, trigger: { signal: 'HOLD', reason: 'Monitorando...', triggeredBy: null }};
            }

            setMasterState(masterStateRef.current);
            executionRef.current.isExecuting = false;
            return;
        }
        
        const openMasterTrade = operationsLogRef.current.find(op => op.initiator === 'Piloto' && op.status === 'pending');
        if (openMasterTrade || isCoolingDownRef.current || pendingSignalRef.current) {
            let reason = 'Monitorando...';
            if (openMasterTrade) reason = `Gerindo posição #${openMasterTrade.id}.`;
            if (isCoolingDownRef.current) reason = 'Em cooldown pós-trade.';
            if (pendingSignalRef.current) reason = `Aguardando confirmação para ${pendingSignalRef.current.signal}...`;
            masterStateRef.current = {...masterStateRef.current, trigger: { ...masterStateRef.current.trigger, reason }};
            setMasterState(masterStateRef.current);
            executionRef.current.isExecuting = false;
            return;
        }

        // 2. DETECÇÃO DE NOVO SINAL
        const { newTriggerSignal, newTriggerReason, newTriggeredBy } = evaluateTriggerConditions(newAssertiveness, riskManagerRef.current, contractTypeRef.current, detectedRegimeResult.regime, macroTrendRef.current, horizons);

        if (newTriggerSignal !== 'HOLD') {
            pendingSignalRef.current = { signal: newTriggerSignal, triggeredBy: newTriggeredBy!, epoch: currentTick.epoch };
            const reason = `Sinal ${newTriggerSignal} detectado (${newTriggeredBy?.join(' & ')}). Aguardando confirmação...`;
            toast({ title: "⏳ Sinal Detectado!", description: reason });
            masterStateRef.current = { ...masterStateRef.current, trigger: { signal: 'HOLD', reason: reason, triggeredBy: newTriggeredBy }};
        } else {
            masterStateRef.current = { ...masterStateRef.current, trigger: { signal: 'HOLD', reason: newTriggerReason, triggeredBy: null }};
        }

        // 3. ATUALIZAÇÃO GERAL DO ESTADO
        masterStateRef.current = {
            ...masterStateRef.current,
            isReady: true,
            assertiveness: newAssertiveness,
            indicators: calculatedIndicators,
            microstructure: microFeatures,
            currentRegime: { regime: detectedRegimeResult.regime, confidence: detectedRegimeResult.confidence }
        };
        setMasterState(masterStateRef.current);

        executionRef.current.isExecuting = false;
    };

    const intervalId = setInterval(executeLogic, 2000);
    return () => clearInterval(intervalId);

  }, [isAutopilotOn, isConnected, executeTradeAction, toast, dailyBalance, evaluateTriggerConditions]);
    
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
    activeSymbol,
    priceTicks,
    botCandleData,
    operationsLog,
    isConnected,
  };
}
