// src/features/trading/hooks/use-robot-council-digits.ts
'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { TickData, Asset, Operation } from '@/lib/types';
import { useDerivApiDigits } from './use-deriv-api-digits';
import {
    getMultiWindowAnalysis,
    determineSignalQuality,
    type MultiWindowAnalysis,
    type SignalQuality,
    calculateDigitStatsForWindow,
} from '@/features/trading/services/digits-analysis';
import {
    decideNextStake,
    type SmartMartingaleConfig,
    type BankrollState,
    type TradeResult as StakeManagerTradeResult
} from '@/features/trading/services/smart-stake-manager-digits';
import type { ConfidenceLevel } from '@/features/trading/services/digits-analysis';

// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

export type PilotType = 'matchesDiffers' | 'overUnder' | 'evenOdd' | 'underdog' | 'underdogOverUnder' | 'dynamicUnderdogOverUnder' | 'underdogEvenOdd';
export type AutopilotStatus = 'PAUSED' | 'TRADING' | 'COOLDOWN' | 'CIRCUIT_BREAKER';

export interface PilotState {
    isOn: boolean;
    status: AutopilotStatus;
    currentTarget: string | null;
    consecutiveLosses: number;
    accumulatedLoss: number;
    tradeHistory: StakeManagerTradeResult[];
}

const BASE_STAKE = 0.35;

const createInitialPilotState = (): PilotState => ({
    isOn: false,
    status: 'PAUSED',
    currentTarget: null,
    consecutiveLosses: 0,
    accumulatedLoss: 0,
    tradeHistory: [],
});

// ============================================================================
// 2. HOOK PRINCIPAL
// ============================================================================

export function useRobotCouncilDigits(activeSymbol: string | null, priceTicks: TickData[], activeAsset: Asset | null) {
  const { toast } = useToast();
  const { executeTrade, operationsLog, accountBalance } = useDerivApiDigits();

  // --- CONFIGURAÇÕES DE RISCO E ESTRATÉGIA (ESTADO LOCAL) ---
  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusThreshold, setConsensusThreshold] = useState(25);
  const [overUnderThreshold, setOverUnderThreshold] = useState(65);
  const [evenOddThreshold, setEvenOddThreshold] = useState(65);
  const [underdogThreshold, setUnderdogThreshold] = useState(5.0);
  const [isUnderdogInverse, setIsUnderdogInverse] = useState(false);
  const [overUnderUnderdogThreshold, setOverUnderUnderdogThreshold] = useState(40);
  const [evenOddUnderdogThreshold, setEvenOddUnderdogThreshold] = useState(40);
  
  // --- GESTÃO DE RISCO AVANÇADA (MARTINGALE) ---
  const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(true);
  const [isSmartMartingale, setIsSmartMartingale] = useState(true);
  const [martingaleRecoveryFactor, setMartingaleRecoveryFactor] = useState(1.3);
  const [cooldownTime, setCooldownTime] = useState(5);
  const [maxLosses, setMaxLosses] = useState(5);
  
  const [executionCooldown, setExecutionCooldown] = useState(1);
  const lastExecutionTimestampRef = useRef(0);

  const [sessionInitialBankroll, setSessionInitialBankroll] = useState<number | null>(null);

  const [pilots, setPilots] = useState<Record<PilotType, PilotState>>({
    matchesDiffers: createInitialPilotState(),
    overUnder: createInitialPilotState(),
    evenOdd: createInitialPilotState(),
    underdog: createInitialPilotState(),
    underdogOverUnder: createInitialPilotState(),
    dynamicUnderdogOverUnder: createInitialPilotState(),
    underdogEvenOdd: createInitialPilotState(),
  });
  
  const executionRef = useRef(false);
  const lastProcessedOpIdRef = useRef<number | null>(null);

  // --- ANÁLISE ESTATÍSTICA ---
  const analysisResults = useMemo(() => {
    const windowSizes = [200, 500, 1000];
    const decimalPlaces = getDecimalPlaces(activeAsset?.pip);
    if (!priceTicks || priceTicks.length < 200) {
      return { windowsStats: [], mainWindowStats: null };
    }
    const windowsStats = windowSizes.map(size => calculateDigitStatsForWindow(priceTicks, size, decimalPlaces));
    const mainWindowStats = windowsStats.find(w => w.windowSize === 1000) || windowsStats[windowsStats.length - 1];
    return { windowsStats, mainWindowStats };
  }, [priceTicks, activeAsset]);
  
  const digitStats = useMemo(() => analysisResults.mainWindowStats?.frequencies || [], [analysisResults.mainWindowStats]);

  const multiWindowAnalysis = useMemo(() => {
    return getMultiWindowAnalysis(analysisResults.windowsStats);
  }, [analysisResults.windowsStats]);
  
  const signalQuality = useMemo(() => {
    if (!analysisResults.mainWindowStats) return null;
    return determineSignalQuality(multiWindowAnalysis, analysisResults.mainWindowStats);
  }, [multiWindowAnalysis, analysisResults.mainWindowStats]);

  const shouldTrade = useMemo(() => {
    if (!signalQuality) return false;
    const { confidenceLevel, mainWindow } = signalQuality;
    const isConfident = confidenceLevel === 'ALTA' || confidenceLevel === 'MUITO_ALTA';
    return isConfident && mainWindow.chiSquare.isSignificant;
  }, [signalQuality]);

  const councilDecision = useMemo(() => {
    if (!signalQuality) return { differs: null, matches: null };
    return {
      differs: signalQuality.contractType === 'DIGITDIFF' ? signalQuality.targetDigit : null,
      matches: signalQuality.contractType === 'DIGITMATCH' ? signalQuality.targetDigit : null,
    };
  }, [signalQuality]);

  const dailyPnl = useMemo(() => {
    return Object.values(pilots).flatMap(p => p.tradeHistory).reduce((sum, trade) => sum + trade.profit, 0);
  }, [pilots]);

  const overUnderStats = useMemo(() => {
    if (!analysisResults.mainWindowStats) return { probOver4: 0, probUnder5: 0 };
    const stats = analysisResults.mainWindowStats.frequencies;
    const probOver4 = stats.filter(s => s.digit > 4).reduce((sum, s) => sum + s.probability, 0) * 100;
    const probUnder5 = stats.filter(s => s.digit < 5).reduce((sum, s) => sum + s.probability, 0) * 100;
    return { probOver4, probUnder5 };
  }, [analysisResults.mainWindowStats]);

  const evenOddStats = useMemo(() => {
    if (!analysisResults.mainWindowStats) return { probEven: 0 };
    const stats = analysisResults.mainWindowStats.frequencies;
    const probEven = stats.filter(s => s.digit % 2 === 0).reduce((sum, s) => sum + s.probability, 0) * 100;
    return { probEven };
  }, [analysisResults.mainWindowStats]);

  // --- LÓGICA DE EXECUÇÃO E ATUALIZAÇÃO ---
  const toggleAutopilot = useCallback((pilotType: PilotType) => {
    setPilots(prev => {
      const pilot = prev[pilotType];
      if (!pilot) return prev;
      const newIsOnState = !pilot.isOn;
  
      if (newIsOnState && sessionInitialBankroll === null) {
        setSessionInitialBankroll(accountBalance.balance ?? 1000);
      }
      
      setTimeout(() => {
        toast({ title: `Piloto ${pilotType} ${newIsOnState ? 'Ativado' : 'Desativado'}` });
      }, 0);

      return {
        ...prev,
        [pilotType]: {
          ...pilot,
          isOn: newIsOnState,
          status: newIsOnState ? 'TRADING' : 'PAUSED'
        }
      };
    });
  }, [sessionInitialBankroll, accountBalance.balance, toast]);
  
  useEffect(() => {
    if (executionRef.current) return;
    const activePilotEntries = Object.entries(pilots).filter(([, p]) => p.isOn && p.status !== 'CIRCUIT_BREAKER');
    if (activePilotEntries.length === 0) return;

    executionRef.current = true;
    
    // 1. Processar resultados de trades passados
    const lastOp = operationsLog.length > 0 ? operationsLog[0] : null;
    if (lastOp && lastOp.id !== lastProcessedOpIdRef.current && lastOp.status !== 'pending') {
      lastProcessedOpIdRef.current = lastOp.id;
      
      const pilotKey = lastOp.strategy as PilotType;
      if (pilotKey && pilots[pilotKey]) {
        const pilot = pilots[pilotKey];
        const newTradeResult: StakeManagerTradeResult = {
            id: String(lastOp.id),
            timestamp: new Date(lastOp.timestamp).getTime(),
            stake: lastOp.stake,
            profit: lastOp.result || -lastOp.stake,
            contractType: lastOp.contractType as any,
            signalConfidence: 'ALTA' // Placeholder
        };
        
        const updatedHistory = [...pilot.tradeHistory, newTradeResult];
        const newLosses = newTradeResult.profit < 0 ? pilot.consecutiveLosses + 1 : 0;
        const newAccumulatedLoss = newTradeResult.profit < 0 ? pilot.accumulatedLoss + Math.abs(newTradeResult.profit) : 0;

        setPilots(prev => ({
            ...prev,
            [pilotKey]: {
                ...pilot,
                tradeHistory: updatedHistory,
                consecutiveLosses: newLosses,
                accumulatedLoss: newAccumulatedLoss,
                status: newLosses >= maxLosses ? 'CIRCUIT_BREAKER' : 'TRADING',
            }
        }));
      }
    }

    // --- 2. Decidir e executar novos trades ---
    activePilotEntries.forEach(([key, pilot]) => {
      const pilotKey = key as PilotType;
      if (pilot.status !== 'TRADING' || !signalQuality) return;

      const now = Date.now();
      if (now - lastExecutionTimestampRef.current < executionCooldown * 1000) {
        return; // Cooldown global de execução ativo
      }

      const initialBankroll = sessionInitialBankroll ?? (accountBalance.balance ?? 1000);
      const currentBankroll = initialBankroll + dailyPnl;
      
      const bankrollState: BankrollState = { currentBankroll, initialBankroll, maxDailyLoss: dailyBalance, dailyProfitTarget: dailyTarget };
      
      // ✅ PASSO 1: Determinar a confiança específica da ESTRATÉGIA ATUAL.
      let confidenceForStake: ConfidenceLevel = 'NULA';
      switch (pilotKey) {
        case 'matchesDiffers':
        case 'underdog':
          confidenceForStake = signalQuality.confidenceLevel;
          break;
        case 'evenOdd':
        case 'underdogEvenOdd':
          const probEven = evenOddStats.probEven;
          const probOdd = 100 - probEven;
          const evenOddMaxProb = Math.max(probEven, probOdd);
          if (evenOddMaxProb > evenOddThreshold) {
            if (evenOddMaxProb > 80) confidenceForStake = 'MUITO_ALTA';
            else confidenceForStake = 'ALTA';
          }
          break;
        case 'overUnder':
        case 'underdogOverUnder':
        case 'dynamicUnderdogOverUnder':
          const probOver = overUnderStats.probOver4;
          const probUnder = overUnderStats.probUnder5;
          const overUnderMaxProb = Math.max(probOver, probUnder);
          if (overUnderMaxProb > overUnderThreshold) {
            if (overUnderMaxProb > 80) confidenceForStake = 'MUITO_ALTA';
            else confidenceForStake = 'ALTA';
          }
          break;
      }
      
      const stakeConfig: SmartMartingaleConfig = { 
        baseStake: BASE_STAKE, 
        maxMartingaleLevels: maxLosses, 
        martingaleMultiplier: martingaleRecoveryFactor, 
        useAntiMartingale: false,
        isSmart: isSmartMartingale,
      };

      // ✅ PASSO 2: Passar a confiança correta para o gestor de stake.
      const stakeDecision = decideNextStake(pilot.tradeHistory, stakeConfig, bankrollState, confidenceForStake);
      
      if (stakeDecision.shouldPause) {
        setPilots(prev => ({ ...prev, [pilotKey]: { ...prev[pilotKey], status: 'CIRCUIT_BREAKER', currentTarget: stakeDecision.pauseReason || 'Limite de risco atingido' }}));
        return;
      }

      // --- LÓGICA DE EXECUÇÃO ---
      let tradeExecuted = false;
      
      if (pilotKey === 'matchesDiffers' && councilDecision.differs !== null && shouldTrade) {
          executeTrade('DIGITDIFF', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', councilDecision.differs, pilotKey);
          tradeExecuted = true;
      }
      // ✅ PASSO 3: Remover a dependência de `shouldTrade`
      else if (pilotKey === 'overUnder') {
        if (overUnderStats.probOver4 > overUnderThreshold) {
            executeTrade('DIGITOVER', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', 4, pilotKey);
            tradeExecuted = true;
        } else if (overUnderStats.probUnder5 > overUnderThreshold) {
            executeTrade('DIGITUNDER', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', 5, pilotKey);
            tradeExecuted = true;
        }
      }
      else if (pilotKey === 'evenOdd') {
        if (evenOddStats.probEven > evenOddThreshold) {
            executeTrade('DIGITEVEN', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', undefined, pilotKey);
            tradeExecuted = true;
        } else if ((100 - evenOddStats.probEven) > evenOddThreshold) {
            executeTrade('DIGITODD', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', undefined, pilotKey);
            tradeExecuted = true;
        }
      }
      else if (pilotKey === 'underdog' && councilDecision.matches !== null) {
        const digitFreq = digitStats.find(d => d.digit === councilDecision.matches);
        if (digitFreq && digitFreq.probability <= underdogThreshold) {
             if (isUnderdogInverse) {
                 executeTrade('DIGITDIFF', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', councilDecision.matches, pilotKey);
             } else {
                 executeTrade('DIGITMATCH', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', councilDecision.matches, pilotKey);
             }
             tradeExecuted = true;
        }
      }
      else if (pilotKey === 'underdogOverUnder') {
          if (overUnderStats.probOver4 < overUnderUnderdogThreshold) {
               executeTrade('DIGITOVER', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', 4, pilotKey);
               tradeExecuted = true;
          } else if (overUnderStats.probUnder5 < overUnderUnderdogThreshold) {
               executeTrade('DIGITUNDER', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', 5, pilotKey);
               tradeExecuted = true;
          }
      }
      else if (pilotKey === 'dynamicUnderdogOverUnder') {
          const underdogBlock = multiWindowAnalysis?.coldestConsensusDigit;
          if (underdogBlock !== undefined) {
              if (underdogBlock > 4) {
                 executeTrade('DIGITOVER', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', 4, pilotKey);
                 tradeExecuted = true;
              } else {
                 executeTrade('DIGITUNDER', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', 5, pilotKey);
                 tradeExecuted = true;
              }
          }
      }
      else if (pilotKey === 'underdogEvenOdd') {
          if (evenOddStats.probEven < evenOddUnderdogThreshold) {
               executeTrade('DIGITEVEN', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', undefined, pilotKey);
               tradeExecuted = true;
          } else if (100 - evenOddStats.probEven < evenOddUnderdogThreshold) {
               executeTrade('DIGITODD', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', undefined, pilotKey);
               tradeExecuted = true;
          }
      }
      
      if (tradeExecuted) {
        lastExecutionTimestampRef.current = now;
      }
    });
    
    executionRef.current = false;
  }, [
      priceTicks, pilots, operationsLog, signalQuality, shouldTrade, councilDecision, executeTrade, activeSymbol, toast, 
      dailyBalance, dailyTarget, maxLosses, martingaleRecoveryFactor, sessionInitialBankroll, accountBalance.balance, dailyPnl,
      overUnderStats, evenOddStats, overUnderThreshold, evenOddThreshold, underdogThreshold, isUnderdogInverse, overUnderUnderdogThreshold, evenOddUnderdogThreshold,
      executionCooldown, isSmartMartingale, isMartingaleEnabled, digitStats, multiWindowAnalysis
  ]);
  
  return {
    dailyBalance, setDailyBalance,
    dailyTarget, setDailyTarget,
    consensusThreshold, setConsensusThreshold,
    overUnderThreshold, setOverUnderThreshold,
    evenOddThreshold, setEvenOddThreshold,
    underdogThreshold, setUnderdogThreshold,
    isUnderdogInverse, setIsUnderdogInverse,
    overUnderUnderdogThreshold, setOverUnderUnderdogThreshold,
    evenOddUnderdogThreshold, setEvenOddUnderdogThreshold,
    isMartingaleEnabled, setIsMartingaleEnabled,
    isSmartMartingale, setIsSmartMartingale,
    martingaleRecoveryFactor, setMartingaleRecoveryFactor,
    cooldownTime, setCooldownTime,
    maxLosses, setMaxLosses,
    executionCooldown, setExecutionCooldown,
    
    isCouncilAutopilotOn: Object.values(pilots).some(p => p.isOn),
    digitStats,
    councilDecision,
    pilots,
    toggleAutopilot,

    windowsStats: analysisResults.windowsStats,
    mainWindowStats: analysisResults.mainWindowStats,
    multiWindowAnalysis,
    signalQuality,
    shouldTrade,
  };
}

const getDecimalPlaces = (pipSize: number | undefined): number => {
    if (pipSize === undefined || pipSize === null || pipSize <= 0) return 2;
    if (Math.floor(pipSize) === pipSize && pipSize >= 1) return 0;
    const pipString = String(pipSize);
    if (pipString.includes('.')) return pipString.split('.')[1].length;
    return 0;
};