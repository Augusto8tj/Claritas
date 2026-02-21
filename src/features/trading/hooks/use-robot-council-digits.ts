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
  const [martingaleRecoveryFactor, setMartingaleRecoveryFactor] = useState(1.3);
  const [cooldownTime, setCooldownTime] = useState(5);
  const [maxLosses, setMaxLosses] = useState(5);
  
  // NOVO: Estado para armazenar o bankroll inicial da sessão
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

  // --- LÓGICA DE EXECUÇÃO E ATUALIZAÇÃO ---
  const toggleAutopilot = useCallback((pilotType: PilotType) => {
    const pilot = pilots[pilotType];
    if (!pilot) return;

    const newIsOnState = !pilot.isOn;
    toast({ title: `Piloto ${pilotType} ${newIsOnState ? 'Ativado' : 'Desativado'}` });

    // NOVO: Captura o saldo da conta quando o primeiro piloto é ativado
    if (newIsOnState && sessionInitialBankroll === null) {
      setSessionInitialBankroll(accountBalance.balance ?? 1000); // Usa o saldo real da conta ou um fallback
    }

    setPilots(prev => ({
      ...prev,
      [pilotType]: { ...pilot, isOn: newIsOnState, status: newIsOnState ? 'TRADING' : 'PAUSED' },
    }));
  }, [toast, pilots, sessionInitialBankroll, accountBalance.balance]);
  
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

    // 2. Decidir e executar novos trades
    activePilotEntries.forEach(([key, pilot]) => {
      const pilotKey = key as PilotType;
      if (pilot.status !== 'TRADING' || !signalQuality) return;

      const initialBankroll = sessionInitialBankroll ?? (accountBalance.balance ?? 1000);
      const currentBankroll = initialBankroll + dailyPnl;
      
      // CORREÇÃO: Passa os valores corretos do estado para a função de decisão
      const bankrollState: BankrollState = { 
        currentBankroll, 
        initialBankroll, 
        maxDailyLoss: dailyBalance, 
        dailyProfitTarget: dailyTarget 
      };
      
      const stakeConfig: SmartMartingaleConfig = { baseStake: BASE_STAKE, maxMartingaleLevels: maxLosses, martingaleMultiplier: martingaleRecoveryFactor, useAntiMartingale: false };
      
      const stakeDecision = decideNextStake(pilot.tradeHistory, stakeConfig, bankrollState, signalQuality.confidenceLevel);
      
      if(stakeDecision.shouldPause) {
        setPilots(prev => ({ ...prev, [pilotKey]: { ...prev[pilotKey], status: 'CIRCUIT_BREAKER', currentTarget: stakeDecision.pauseReason || 'Limite de risco atingido' }}));
        toast({ title: `Piloto ${pilotKey} Pausado`, description: stakeDecision.pauseReason, variant: 'destructive'});
        return;
      }

      if (pilotKey === 'matchesDiffers' && councilDecision.differs !== null && shouldTrade) {
          executeTrade('DIGITDIFF', stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', councilDecision.differs);
      }
      // Adicionar lógica para outros pilotos aqui...
    });
    
    executionRef.current = false;
  }, [
      priceTicks, pilots, operationsLog, signalQuality, shouldTrade, councilDecision, executeTrade, activeSymbol, toast, 
      dailyBalance, dailyTarget, maxLosses, martingaleRecoveryFactor,
      // Novas dependências para a lógica de bankroll corrigida
      sessionInitialBankroll, accountBalance.balance, dailyPnl
  ]); 
  
  const digitStats = analysisResults.mainWindowStats?.frequencies || [];
  
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
    martingaleRecoveryFactor, setMartingaleRecoveryFactor,
    cooldownTime, setCooldownTime,
    maxLosses, setMaxLosses,
    
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
