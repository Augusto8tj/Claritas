// src/features/trading/hooks/use-master-autopilot.ts
'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useDerivApiV2 } from './use-deriv-api-v2';
import { useToast } from '@/hooks/use-toast';
import { calculateAllIndicators, type Indicators } from '@/features/trading/services/indicator-service';
import { getCouncilStrategies } from '@/features/trading/services/council-strategies';
import type { DurationUnit, Operation, OperationInitiator, MarketRegime as RegimeType, CandleData, PredictiveTradeLog } from '@/lib/types';
import { extractMicrostructureFeatures, type MicrostructureFeatures } from '@/features/trading/services/advanced-trading-services';
import { evaluateTriggerConditions, evaluateManualTrigger } from '../services/predictive-logic';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { savePredictiveTradeLog } from '@/services/financial-data-service';
import type { User } from 'firebase/auth';
import { useStochasticModels, VolatilityRegime } from './use-stochastic-models';


type ContractType = 'Accumulators' | 'Rise/Fall' | 'Multipliers';
type Signal = 'RISE' | 'FALL' | 'HOLD';

export interface AssertivenessData {
    accuracy: number;
    vote: Signal;
    lastResult?: boolean;
}

export interface RiskManagerStatus {
    mode: 'Normal' | 'Cautious';
    thresholds: Record<string, number>;
    lastAdjustmentReason: string;
}

export interface SignalQuality {
  score: number;
  reasons: string[];
  shouldTrade: boolean;
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
    finalSignal: { // Combines GBM and Mean Reversion
        direction: 'RISE' | 'FALL' | 'HOLD';
        source: 'GBM' | 'MeanReversion';
        horizon: string;
        certaintyScore: number;
    } | null;
    indicators: Indicators | null;
    microstructure: MicrostructureFeatures | null;
    currentRegime: RegimeType;
    projectionExperts: any[]; // Simplified for this context
}

const getAdaptiveCooldown = (duration: number, unit: string, isLastTradeWin: boolean) => {
  const baseSeconds = unit === 's' ? duration : duration * 2;
  const multiplier = isLastTradeWin ? 1.5 : 3.0; // Pausa maior após perda
  return Math.max(baseSeconds * multiplier * 1000, 15000);
};

const calculateOptimalStake = (
  winRate: number, 
  avgWin: number, 
  avgLoss: number, 
  totalCapital: number
): number => {
  if (avgLoss === 0 || winRate <= 50) return 0.35;

  const p = winRate / 100;
  const q = 1 - p;
  const b = avgWin / Math.abs(avgLoss);
  
  if (p * b - q <= 0) return 0.35;

  const kellyFraction = (p * b - q) / b;
  const fractionalKelly = kellyFraction * 0.25;
  const optimalStake = Math.max(
    totalCapital * 0.01, 
    Math.min(totalCapital * fractionalKelly, totalCapital * 0.05)
  );
  
  return Math.max(0.35, Math.min(optimalStake, 10));
};

function evaluateSignalQuality(
  finalSignal: MasterAutopilotState['finalSignal'],
  projectionExperts: any[],
  stats: any,
  operationsLog: Operation[]
): SignalQuality {
  let score = 0;
  const reasons: string[] = [];

  if (!finalSignal || finalSignal.direction === 'HOLD') {
    return { score: 0, reasons: ['Nenhum sinal de entrada claro.'], shouldTrade: false };
  }

  // 1. Assertividade/Confiança do sinal (30 pontos)
  const signalCertainty = finalSignal.certaintyScore;
  if (signalCertainty >= 70) {
    score += 30;
    reasons.push(`✅ Confiança do Sinal Forte: ${signalCertainty.toFixed(1)}%`);
  } else if (signalCertainty >= 55) {
    score += 15;
    reasons.push(`⚠️ Confiança do Sinal Moderada: ${signalCertainty.toFixed(1)}%`);
  } else {
    reasons.push(`❌ Confiança do Sinal Baixa: ${signalCertainty.toFixed(1)}%`);
  }

  // 2. Consenso entre especialistas (30 pontos)
  const activeExperts = projectionExperts.filter(e => e.status === 'active');
  const votesInDirection = activeExperts.filter(e => e.vote === finalSignal.direction).length;
  const consensusRate = activeExperts.length > 0 ? votesInDirection / activeExperts.length : 0;
  
  if (consensusRate >= 0.7) {
    score += 30;
    reasons.push(`✅ Consenso forte: ${(consensusRate * 100).toFixed(0)}% dos especialistas`);
  } else if (consensusRate >= 0.5) {
    score += 15;
    reasons.push(`⚠️ Consenso moderado: ${(consensusRate * 100).toFixed(0)}%`);
  } else {
      reasons.push(`❌ Baixo consenso: ${(consensusRate * 100).toFixed(0)}%`);
  }
  
  // 3. Performance recente (20 pontos)
  const recentTrades = operationsLog.slice(-10).filter(op => op.status !== 'pending');
  if (recentTrades.length >= 5) {
    const recentWins = recentTrades.filter(t => t.result && t.result > 0).length;
    const recentWinRate = recentWins / recentTrades.length;
    
    if (recentWinRate >= 0.6) {
      score += 20;
      reasons.push(`✅ Momento positivo: ${(recentWinRate * 100).toFixed(0)}% de acerto recente`);
    } else if (recentWinRate < 0.4) {
      reasons.push(`⚠️ Momento negativo: ${(recentWinRate * 100).toFixed(0)}% de acerto recente`);
    } else {
      score += 10;
    }
  } else {
      reasons.push(`ℹ️ Dados recentes insuficientes para avaliar momento.`);
      score += 5; // Bônus pequeno
  }

  // 4. Condições de mercado (20 pontos)
  const kurtosis = parseFloat(stats.kurtosis);
  const skewness = parseFloat(stats.skewness);
  if (kurtosis < 4 && Math.abs(skewness) < 0.5) {
    score += 20;
    reasons.push(`✅ Mercado estável (Kurtosis/Skewness normais)`);
  } else {
    reasons.push(`⚠️ Mercado com anomalias estatísticas`);
  }
  
  return {
    score,
    reasons,
    shouldTrade: score >= 60,
  };
}

export function useMasterAutopilot() {
  const { activeSymbol, priceTicks, botCandleData, operationsLog, isConnected, executeTrade: executeRiseFallTrade } = useDerivApiV2();
  const { user } = useAuth();
  const { toast } = useToast();

  const { projectionExperts, strongestSignal, stats, adaptiveDrifts, meanReversionSignal, volatilityRegime } = useStochasticModels(botCandleData, priceTicks, operationsLog, null);

  const [isAutopilotOn, setIsAutopilotOn] = useState(false);
  const [contractType, setContractType] = useState<ContractType>('Rise/Fall');
  const [dailyBalance, setDailyBalance] = useState(100.0);
  const [dailyTarget, setDailyTarget] = useState(20.0);
  const [riskManager, setRiskManager] = useState<RiskManagerStatus>({
    mode: 'Normal',
    thresholds: {},
    lastAdjustmentReason: 'N/A'
  });
  const [signalQuality, setSignalQuality] = useState<SignalQuality | null>(null);
  const [kellyStake, setKellyStake] = useState(0.35);

  const [masterState, setMasterState] = useState<MasterAutopilotState>({
    isReady: false,
    trigger: { signal: 'HOLD', reason: 'Piloto desativado.', triggeredBy: null },
    manualTrigger: { signal: 'HOLD', reason: 'Aguardando consenso.'},
    finalSignal: null,
    indicators: null,
    microstructure: null,
    currentRegime: 'ranging',
    projectionExperts: [],
  });

  const [isNeighborConfirmationEnabled, setIsNeighborConfirmationEnabled] = useState(true);
  const [isTripleConfirmationEnabled, setIsTripleConfirmationEnabled] = useState(false);
  const [isMacroTrendCheckEnabled, setIsMacroTrendCheckEnabled] = useState(true);
  const [highFrequencyThreshold, setHighFrequencyThreshold] = useState(10);
  const [allowMultiplePositions, setAllowMultiplePositions] = useState(false);
  
  const executionLockRef = useRef(false);

  const toggleAutopilot = useCallback((checked: boolean) => {
    setIsAutopilotOn(checked);
    toast({ title: `Master Autopilot ${checked ? 'Ativado' : 'Desativado'}` });
  }, [toast]);

  const executeTradeAction = useCallback(async (
        initiator: OperationInitiator, 
        signal: MasterAutopilotState['finalSignal'], 
        currentUser: User | null
    ) => {
    if (!signal || signal.direction === 'HOLD' || !activeSymbol) {
        if (initiator === 'Manual') {
            toast({ title: "Nenhum sinal válido", variant: "destructive" });
        }
        return { duration: 0, unit: 's'};
    }
    
    const durationMatch = signal.horizon.match(/(\d+)([st])/);
    const duration = durationMatch ? parseInt(durationMatch[1], 10) : 15;
    const durationUnit = durationMatch ? (durationMatch[2] as 's' | 't') : 's';

    const tradeResult = await executeRiseFallTrade(
        signal.direction === 'RISE' ? 'CALL' : 'PUT',
        kellyStake, 
        activeSymbol,
        signal.direction.toLowerCase() as 'rise' | 'fall',
        duration, durationUnit, initiator
    );

    if (tradeResult.success && tradeResult.contractId && currentUser) {
        toast({ title: `🤖 Autopilot: Ordem ${initiator} ${signal.direction}!`, description: `Stake: $${kellyStake.toFixed(2)}. Duração: ${duration}${durationUnit}.`});
    }
    return { duration, unit: durationUnit };
  }, [activeSymbol, executeRiseFallTrade, toast, kellyStake]);

  useEffect(() => {
    if (!isAutopilotOn || !isConnected || executionLockRef.current) return;

    // Determine final signal
    const isLowVol = volatilityRegime.type === 'LOW';
    let finalSignal: MasterAutopilotState['finalSignal'];
    if (isLowVol && meanReversionSignal.direction !== 'HOLD') {
        finalSignal = {
            direction: meanReversionSignal.direction === 'LONG' ? 'RISE' : 'FALL',
            source: 'MeanReversion',
            horizon: `Z(${meanReversionSignal.zscore.toFixed(1)})`,
            certaintyScore: meanReversionSignal.confidence
        };
    } else {
        finalSignal = {
            ...strongestSignal,
            direction: strongestSignal.direction as 'RISE' | 'FALL' | 'HOLD',
            source: 'GBM'
        };
    }

    // Evaluate signal quality
    const quality = evaluateSignalQuality(finalSignal, projectionExperts, stats, operationsLog);
    setSignalQuality(quality);

    // Calculate stake
    const wins = operationsLog.filter(op => op.result && op.result > 0);
    const losses = operationsLog.filter(op => op.result && op.result < 0);
    const winRate = wins.length / (wins.length + losses.length || 1) * 100;
    const avgWin = wins.reduce((s, op) => s + op.result!, 0) / (wins.length || 1);
    const avgLoss = losses.reduce((s, op) => s + op.result!, 0) / (losses.length || 1);
    const newKellyStake = calculateOptimalStake(winRate, avgWin, avgLoss, dailyBalance);
    setKellyStake(newKellyStake);

    // Make trade decision
    let reason = "Aguardando sinal válido.";
    let shouldTrade = false;
    
    if (volatilityRegime.type === 'HIGH') {
        reason = "Pausado: Alta volatilidade.";
    } else if (finalSignal.direction === 'HOLD') {
        reason = "Nenhum sinal claro dos modelos.";
    } else if (!quality.shouldTrade) {
        reason = `Qualidade do sinal baixa (${quality.score.toFixed(0)}/100).`;
    } else {
        shouldTrade = true;
        reason = `Sinal ${finalSignal.direction} (${finalSignal.source}) com qualidade de ${quality.score.toFixed(0)} aprovado.`
    }

    const openTrades = operationsLog.filter(op => op.status === 'pending').length;
    if (shouldTrade && openTrades === 0) {
        executionLockRef.current = true;
        executeTradeAction('Piloto', finalSignal, user)
            .finally(() => {
                setTimeout(() => { executionLockRef.current = false; }, 2000);
            });
    }

    setMasterState(prev => ({
      ...prev,
      isReady: true,
      trigger: {
        signal: shouldTrade ? finalSignal!.direction : 'HOLD',
        reason,
        triggeredBy: finalSignal!.source === 'GBM' ? [finalSignal!.horizon] : ['MeanReversion']
      },
      finalSignal,
      projectionExperts,
    }));

  }, [
    isAutopilotOn, isConnected, operationsLog, user, toast, 
    projectionExperts, strongestSignal, stats, meanReversionSignal, volatilityRegime,
    executeTradeAction, dailyBalance
  ]);

  const executeManualTrigger = () => { /* Stub */ };
  
  const setGlobalAssertivenessThreshold = (value: number) => { console.log("Set global threshold:", value); };
  const setIndividualThreshold = (horizon: string, value: number) => { console.log(`Set ${horizon} threshold:`, value); };
    
  return {
    isAutopilotOn, toggleAutopilot, contractType, setContractType, dailyBalance, setDailyBalance,
    dailyTarget, setDailyTarget, masterState, riskManager, setGlobalAssertivenessThreshold,
    setIndividualThreshold, runAutopilotCycle: () => {}, executeManualTrigger, isNeighborConfirmationEnabled,
    setIsNeighborConfirmationEnabled, isTripleConfirmationEnabled, setIsTripleConfirmationEnabled,
    isMacroTrendCheckEnabled, setIsMacroTrendCheckEnabled, highFrequencyThreshold,
    setHighFrequencyThreshold, allowMultiplePositions, setAllowMultiplePositions,
    signalQuality,
    volatilityRegime,
    kellyStake
  };
}
