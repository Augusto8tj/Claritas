// src/features/trading/hooks/use-robot-council-digits.tsx
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
    type WindowDigitStats
} from '@/features/trading/services/digits-analysis';
import {
    decideNextStake,
    type SmartMartingaleConfig,
    type BankrollState,
} from '@/features/trading/services/smart-stake-manager-digits';
import { calculateAdvancedSignalScore } from '@/features/trading/services/digit-indicators';
import type { ConfidenceLevel } from '@/features/trading/services/digits-analysis';
import { 
    calibrateStrategyGridSearch, 
    STRATEGY_SEARCH_SPACES,
} from '@/features/trading/optimization/digits-calibration-engine';
import { runDigitsBacktest, type BacktestSummary } from '@/features/trading/backtest/digits-backtest-engine';
import { STRATEGY_DEFINITIONS, type GlobalRiskConfig, type MartingaleConfig, strategyLabels } from '@/app/deriv-trader-digits/strategies-config';
import { loadHistoricalTicksForDigits } from '@/services/digits-data-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useVagalumeAlternante, type VagalumeConfig, type VagalumeSignal, type DigitContractType } from './use-vagalume-alternante';
import { globalLatencyMonitor, LatencyMetrics } from '../utils/latency-monitor';
import { buildTransitionMatrix, predictNTicksAhead, BlockProbs } from '../services/sherlock-multi-step';
import { detectRepetitionSequence } from '../services/repetition-detector';

// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

export type PilotType = 'matchesDiffers' | 'overUnder' | 'evenOdd' | 'underdog' | 'underdogOverUnder' | 'dynamicUnderdogOverUnder' | 'underdogEvenOdd' | 'vagalume' | 'sherlock';
export type AutopilotStatus = 'PAUSED' | 'TRADING' | 'COOLDOWN' | 'CIRCUIT_BREAKER';

export interface PilotState {
    isOn: boolean;
    status: AutopilotStatus;
    currentTarget: string | null;
    consecutiveLosses: number;
    accumulatedLoss: number;
    tradeHistory: Operation[];
    activeContractId: number | null; 
    isMartingaleEnabled: boolean;
    martingaleRecoveryInstallments: number;
}

export interface SherlockAnalysis {
  lastDigit: number;
  probabilities: { digit: number, probability: number }[];
  recommendedBlock: keyof BlockProbs;
  blockProbability: number;
  compensationSteps: number;
}

export interface StrategyBacktestResult extends BacktestSummary {
  strategyId: PilotType;
}

export interface CalibrationResult {
  bestParams: any;
  bestSummary: BacktestSummary;
  initialSummary: BacktestSummary;
}

const createInitialPilotState = (): PilotState => ({
    isOn: false,
    status: 'PAUSED',
    currentTarget: null,
    consecutiveLosses: 0,
    accumulatedLoss: 0,
    tradeHistory: [],
    activeContractId: null,
    isMartingaleEnabled: true,
    martingaleRecoveryInstallments: 3,
});

// ============================================================================
// 2. HOOK PRINCIPAL
// ============================================================================

export function useRobotCouncilDigits(activeSymbol: string | null, priceTicks: TickData[], activeAsset: Asset | null, formStake: number) {
  const BASE_STAKE = formStake;
  const { user } = useAuth();
  const { toast } = useToast();
  const { executeTrade, operationsLog, accountBalance } = useDerivApiDigits();

  // --- CONFIGURAÇÕES DE RISCO E ESTRATÉGIA (ESTADO LOCAL) ---
  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusThreshold, setConsensusThreshold] = useState(4.0);
  const [overUnderThreshold, setOverUnderThreshold] = useState(2.0);
  const [evenOddThreshold, setEvenOddThreshold] = useState(2.0);
  const [underdogThreshold, setUnderdogThreshold] = useState(5.0);
  const [isUnderdogInverse, setIsUnderdogInverse] = useState(false);
  const [overUnderUnderdogThreshold, setOverUnderUnderdogThreshold] = useState(1.5);
  const [evenOddUnderdogThreshold, setEvenOddUnderdogThreshold] = useState(1.5);
  const [sherlockThreshold, setSherlockThreshold] = useState(52);
  const [sherlockLookback, setSherlockLookback] = useState(500);
  const [disableSherlockCompensation, setDisableSherlockCompensation] = useState(false);
  const [sherlockWinRateThreshold, setSherlockWinRateThreshold] = useState(52);
  
  const [matchesDiffersLookback, setMatchesDiffersLookback] = useState(1000);
  const [overUnderLookback, setOverUnderLookback] = useState(1000);
  const [evenOddLookback, setEvenOddLookback] = useState(1000);
  const [underdogLookback, setUnderdogLookback] = useState(100);
  const [underdogOverUnderLookback, setUnderdogOverUnderLookback] = useState(1000);
  const [dynamicUnderdogOverUnderLookback, setDynamicUnderdogOverUnderLookback] = useState(1000);
  const [underdogEvenOddLookback, setUnderdogEvenOddLookback] = useState(1000);

  const [vagalumeConfig, setVagalumeConfig] = useState<VagalumeConfig>({
      minSequenceLength: 1,
      usePredictiveAnalysis: true,
      contextualThreshold: 55,
      zScoreThreshold: 1.5,
      requireRangingRegime: true,
      allowedContracts: {
        MATCHDIFFERS: true,
        EVENODD: true,
        OVERUNDER: true,
      },
  });
  
  // --- GESTÃO DE RISCO AVANÇADA (MARTINGALE & CONSENSO) ---
  const [isSmartMartingale, setIsSmartMartingale] = useState(false);
  const [cooldownTime, setCooldownTime] = useState(5);
  const [maxLosses, setMaxLosses] = useState(5);
  
  const [isConsensusMode, setIsConsensusMode] = useState(false);
  const [minConsensus, setMinConsensus] = useState(2);
  
  const [executionCooldown, setExecutionCooldown] = useState(1);
  const lastExecutionTimestampRef = useRef(0);

  const [sessionInitialBankroll, setSessionInitialBankroll] = useState<number | null>(null);

  // --- OTIMIZAÇÃO E BACKTESTING ---
  const [backtestTicks, setBacktestTicks] = useState<TickData[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [backtestResults, setBacktestResults] = useState<Record<string, StrategyBacktestResult> | null>(null);
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [calibrationResults, setCalibrationResults] = useState<Record<string, CalibrationResult> | null>(null);
  const [isCalibrating, setIsCalibrating] = useState(false);


  // --- LATENCY MONITOR ---
  const [latencyMetrics, setLatencyMetrics] = useState<LatencyMetrics | null>(null);

  const [pilots, setPilots] = useState<Record<PilotType, PilotState>>({
    matchesDiffers: createInitialPilotState(),
    overUnder: createInitialPilotState(),
    evenOdd: createInitialPilotState(),
    underdog: createInitialPilotState(),
    underdogOverUnder: createInitialPilotState(),
    dynamicUnderdogOverUnder: createInitialPilotState(),
    underdogEvenOdd: createInitialPilotState(),
    vagalume: createInitialPilotState(),
    sherlock: createInitialPilotState(),
  });
  
  const executionRef = useRef(false);
  const lastProcessedOpIdRef = useRef<number | null>(null);
  const decimalPlaces = useMemo(() => getDecimalPlaces(activeAsset?.pip), [activeAsset]);

  const { 
    signal: vagalumeSignal, 
    onTradeCompleted: onVagalumeTradeCompleted,
    pauseReason: vagalumePauseReason
  } = useVagalumeAlternante(
    priceTicks,
    pilots.vagalume.tradeHistory,
    vagalumeConfig,
    accountBalance.balance ?? 1000,
    decimalPlaces
  );

  // --- ANÁLISE ESTATÍSTICA ---
  const analysisResults = useMemo(() => {
    const maxLookback = Math.max(
        matchesDiffersLookback, overUnderLookback, evenOddLookback,
        underdogOverUnderLookback, dynamicUnderdogOverUnderLookback, underdogEvenOddLookback
    );
    const windowSizes = [50, 200, maxLookback].filter((v, i, a) => a.indexOf(v) === i); 
    if (!priceTicks || priceTicks.length < 50) {
      return { windowsStats: [], mainWindowStats: null };
    }
    const windowsStats = windowSizes.map(size => {
        if(priceTicks.length < size) return null;
        return calculateDigitStatsForWindow(priceTicks, size, decimalPlaces);
    }).filter(w => w !== null) as WindowDigitStats[];

    const mainWindowStats = windowsStats.length > 0 ? windowsStats[windowsStats.length - 1] : null; 
    return { windowsStats, mainWindowStats };
  }, [priceTicks, decimalPlaces, matchesDiffersLookback, overUnderLookback, evenOddLookback, underdogOverUnderLookback, dynamicUnderdogOverUnderLookback, underdogEvenOddLookback]);

  const sherlockAnalysis = useMemo((): SherlockAnalysis | null => {
      if (priceTicks.length < sherlockLookback) return null;
      const ticksForMatrix = priceTicks.slice(-sherlockLookback);
      const metrics = globalLatencyMonitor.getMetrics();
      const compensationSteps = disableSherlockCompensation 
        ? 0 
        : Math.min(Math.max(Math.ceil(metrics.avgLatency / 100), 1), 2);
      const { transitionMatrix, lastDigit } = buildTransitionMatrix(ticksForMatrix, decimalPlaces);
      const prediction = predictNTicksAhead(lastDigit, transitionMatrix, compensationSteps);
      const bestBlock = Object.entries(prediction.blockProbs).sort(([, a], [, b]) => b - a)[0];
      return {
          lastDigit,
          probabilities: prediction.digitProbs.map((p, i) => ({ digit: i, probability: p })),
          recommendedBlock: bestBlock[0] as keyof BlockProbs,
          blockProbability: bestBlock[1],
          compensationSteps,
      };
  }, [priceTicks, decimalPlaces, sherlockLookback, disableSherlockCompensation]);

  const matchesDiffersStats = useMemo(() => {
    if (!priceTicks || priceTicks.length < matchesDiffersLookback) return null;
    return calculateDigitStatsForWindow(priceTicks, matchesDiffersLookback, decimalPlaces);
  }, [priceTicks, decimalPlaces, matchesDiffersLookback]);

  const overUnderSpecificStats = useMemo(() => {
      if (!priceTicks || priceTicks.length < overUnderLookback) return null;
      return calculateDigitStatsForWindow(priceTicks, overUnderLookback, decimalPlaces);
  }, [priceTicks, decimalPlaces, overUnderLookback]);

  const evenOddSpecificStats = useMemo(() => {
      if (!priceTicks || priceTicks.length < evenOddLookback) return null;
      return calculateDigitStatsForWindow(priceTicks, evenOddLookback, decimalPlaces);
  }, [priceTicks, decimalPlaces, evenOddLookback]);

  const underdogSpecificStats = useMemo(() => {
      if (!priceTicks || priceTicks.length < underdogLookback) return [];
      return calculateDigitStatsForWindow(priceTicks, underdogLookback, decimalPlaces).frequencies;
  }, [priceTicks, decimalPlaces, underdogLookback]);
  
  const multiWindowAnalysis = useMemo(() => {
    if (analysisResults.windowsStats.length === 0) return null;
    return getMultiWindowAnalysis(analysisResults.windowsStats);
  }, [analysisResults.windowsStats]);
  
  const signalQuality = useMemo(() => {
    if (!multiWindowAnalysis || !analysisResults.mainWindowStats) return null;
    return determineSignalQuality(multiWindowAnalysis, analysisResults.mainWindowStats);
  }, [multiWindowAnalysis, analysisResults.mainWindowStats]);

  const shouldTrade = useMemo(() => {
    if (!multiWindowAnalysis) return false;
    const { hottestScore } = multiWindowAnalysis;
    return hottestScore > consensusThreshold;
  }, [multiWindowAnalysis, consensusThreshold]);
  

  const councilDecision = useMemo(() => {
    if (!multiWindowAnalysis) return { differs: null, matches: null };
    return {
      differs: multiWindowAnalysis.consensusHottestDigit,
      matches: multiWindowAnalysis.consensusColdestDigit,
    };
  }, [multiWindowAnalysis]);

  const dailyPnl = useMemo(() => {
    const allTrades = Object.values(pilots).flatMap(p => p.tradeHistory);
    return allTrades.reduce((sum, trade) => {
        if (trade.status === 'pending' || trade.result === undefined) return sum;
        return sum + trade.result;
    }, 0);
  }, [pilots]);

  const overUnderStats = useMemo(() => {
    if (!analysisResults.mainWindowStats) return { probOver4: 0, probUnder5: 0, zScoreOver4: 0 };
    return {
        probOver4: analysisResults.mainWindowStats.probOver4,
        probUnder5: analysisResults.mainWindowStats.probUnder5,
        zScoreOver4: analysisResults.mainWindowStats.zScoreOver4,
    };
  }, [analysisResults.mainWindowStats]);

  const evenOddStats = useMemo(() => {
    if (!analysisResults.mainWindowStats) return { probEven: 0, zScoreEven: 0 };
    return { 
        probEven: analysisResults.mainWindowStats.probEven,
        zScoreEven: analysisResults.mainWindowStats.zScoreEven,
    };
  }, [analysisResults.mainWindowStats]);

  const resetSession = useCallback(() => {
    setPilots({
      matchesDiffers: createInitialPilotState(),
      overUnder: createInitialPilotState(),
      evenOdd: createInitialPilotState(),
      underdog: createInitialPilotState(),
      underdogOverUnder: createInitialPilotState(),
      dynamicUnderdogOverUnder: createInitialPilotState(),
      underdogEvenOdd: createInitialPilotState(),
      vagalume: createInitialPilotState(),
      sherlock: createInitialPilotState(),
    });
    setSessionInitialBankroll(accountBalance.balance ?? 1000);
    lastProcessedOpIdRef.current = null;
    toast({
      title: "Sessão de Dígitos Reiniciada",
      description: "O histórico de P&L e os estados dos pilotos foram resetados.",
    });
  }, [accountBalance.balance, toast]);

  const toggleAutopilot = useCallback((pilotType: PilotType) => {
    setPilots(prev => {
        const pilot = prev[pilotType];
        if (!pilot) return prev;
        const newIsOnState = !pilot.isOn;

        if (newIsOnState && sessionInitialBankroll === null) {
            setSessionInitialBankroll(accountBalance.balance ?? 1000);
        }
        
        const toastTitle = `Piloto ${strategyLabels[pilotType] || 'Desconhecido'} ${newIsOnState ? 'Ativado' : 'Desativado'}`;
        setTimeout(() => {
            toast({ title: toastTitle });
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
  
  const togglePilotMartingale = useCallback((pilotKey: PilotType) => {
    setPilots(prev => {
        if (!prev[pilotKey]) return prev;
        return {
            ...prev,
            [pilotKey]: {
                ...prev[pilotKey],
                isMartingaleEnabled: !prev[pilotKey].isMartingaleEnabled,
            }
        };
    });
  }, []);

  const setPilotMartingaleInstallments = useCallback((pilotKey: PilotType, installments: number) => {
      setPilots(prev => {
          if (!prev[pilotKey]) return prev;
          return {
              ...prev,
              [pilotKey]: {
                  ...prev[pilotKey],
                  martingaleRecoveryInstallments: installments,
              }
          }
      })
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
        setLatencyMetrics(globalLatencyMonitor.getMetrics());
    }, 2000);
    return () => clearInterval(interval);
  }, []);
  
  useEffect(() => {
    if (executionRef.current) return;
    const activePilotEntries = Object.entries(pilots).filter(([, p]) => p.isOn);
    if (activePilotEntries.length === 0) return;

    executionRef.current = true;
    
    const lastOp = operationsLog.length > 0 ? operationsLog[0] : null;
    if (lastOp && lastOp.id !== lastProcessedOpIdRef.current && lastOp.status !== 'pending') {
      lastProcessedOpIdRef.current = lastOp.id;
      
      const isConsensusStrategy = lastOp.strategy?.startsWith('consensus:');
      if (isConsensusStrategy) {
          const consensusPilots = lastOp.strategy!.replace('consensus:', '').split(',');
          setPilots(prev => {
              const updated = { ...prev };
              consensusPilots.forEach(pk => {
                  if (updated[pk as PilotType] && updated[pk as PilotType].activeContractId !== null) {
                      updated[pk as PilotType] = { ...updated[pk as PilotType], activeContractId: null };
                  }
              });
              return updated;
          });
      }

      const pilotKey = lastOp.strategy as PilotType | 'vagalume' | undefined;

      if (pilotKey) {
        if (pilotKey === 'vagalume') {
            onVagalumeTradeCompleted(lastOp);
        }

        const pilotToUpdate = pilots[pilotKey as PilotType];
        if (pilotToUpdate) {
            const updatedHistory = [...pilotToUpdate.tradeHistory, lastOp];
            
            const profit = lastOp.result ?? 0;
            const isLoss = profit < 0;

            const oldAccumulatedLoss = pilotToUpdate.accumulatedLoss;
            let newLosses: number;
            let newAccumulatedLoss: number;
            let newInstallments: number = pilotToUpdate.martingaleRecoveryInstallments;

            const defaultInstallments = createInitialPilotState().martingaleRecoveryInstallments;

            if (isLoss) {
                newLosses = pilotToUpdate.consecutiveLosses + 1;
                newAccumulatedLoss = oldAccumulatedLoss + lastOp.stake;

                if (pilotToUpdate.consecutiveLosses > 0) { 
                    newInstallments = Math.min(10, pilotToUpdate.martingaleRecoveryInstallments * 2);
                     toast({
                        title: `🛡️ Risco Diluído para ${strategyLabels[pilotKey as PilotType]}`,
                        description: `Parcelas de recuperação aumentadas para ${newInstallments} após nova perda.`,
                        variant: 'destructive',
                        duration: 7000,
                    });
                }
            } else {
                newLosses = 0;
                newAccumulatedLoss = Math.max(0, oldAccumulatedLoss - profit);
                
                if (newAccumulatedLoss === 0 && oldAccumulatedLoss > 0) {
                    newInstallments = defaultInstallments;
                    toast({
                        title: `✅ Recuperação Concluída para ${strategyLabels[pilotKey as PilotType]}`,
                        description: 'O montante de perdas foi recuperado com sucesso.',
                        duration: 7000,
                    });
                }
            }

            const newStatus: AutopilotStatus = 
                newLosses >= maxLosses 
                    ? 'CIRCUIT_BREAKER'
                    : isLoss
                        ? 'COOLDOWN'
                        : 'TRADING';

            setPilots(prev => ({
                ...prev,
                [pilotKey as PilotType]: {
                    ...prev[pilotKey as PilotType], 
                    tradeHistory: updatedHistory, 
                    consecutiveLosses: newLosses,
                    accumulatedLoss: newAccumulatedLoss, 
                    status: newStatus, 
                    activeContractId: null,
                    martingaleRecoveryInstallments: newInstallments,
                }
            }));

            if (newStatus === 'COOLDOWN') {
              setTimeout(() => {
                setPilots(prev => {
                  const currentPilot = prev[pilotKey as PilotType];
                  if (currentPilot?.status === 'COOLDOWN') {
                    const newTarget = `Pausa de ${cooldownTime}s terminada`;
                    if (currentPilot.currentTarget === newTarget) return prev;
                    return { ...prev, [pilotKey as PilotType]: { ...currentPilot, status: 'TRADING', currentTarget: newTarget } };
                  }
                  return prev;
                });
              }, cooldownTime * 1000);
            }
        }
      }
    }

    const now = Date.now();
    if (now - lastExecutionTimestampRef.current < executionCooldown * 1000) {
      executionRef.current = false;
      return; 
    }

    let tradeExecutedThisCycle = false;
    
    if (!activeSymbol) {
        executionRef.current = false;
        return;
    }
    
    if (isConsensusMode) {
        const activePilots = activePilotEntries.map(([key]) => key as PilotType);
        const signals: Array<{ pilotKey: PilotType, contract: DigitContractType, digit?: number, confidence: number }> = [];

        for (const pilotKey of activePilots) {
          const pilot = pilots[pilotKey];
          if (pilot.status !== 'TRADING' || pilot.activeContractId !== null) continue;

          let signalData: { contract: DigitContractType | null, digit?: number, confidence: number } = { contract: null, confidence: 0 };
          
          if (pilotKey === 'sherlock' && sherlockAnalysis && (sherlockAnalysis.blockProbability * 100) > sherlockThreshold) {
            const wins = pilot.tradeHistory.filter(t => t.result && t.result > 0).length;
            const winRate = pilot.tradeHistory.length > 0 ? (wins / pilot.tradeHistory.length) * 100 : 100;
            if (winRate > sherlockWinRateThreshold) {
                if (sherlockAnalysis.recommendedBlock === 'even') signalData = { contract: 'DIGITEVEN', confidence: sherlockAnalysis.blockProbability };
                else if (sherlockAnalysis.recommendedBlock === 'odd') signalData = { contract: 'DIGITODD', confidence: sherlockAnalysis.blockProbability };
                else if (sherlockAnalysis.recommendedBlock === 'above4') signalData = { contract: 'DIGITOVER', digit: 4, confidence: sherlockAnalysis.blockProbability };
                else if (sherlockAnalysis.recommendedBlock === 'below5') signalData = { contract: 'DIGITUNDER', digit: 5, confidence: sherlockAnalysis.blockProbability };
            }
          } else if (pilotKey === 'matchesDiffers' && shouldTrade && councilDecision.differs !== null) {
              signalData = { contract: 'DIGITDIFF', digit: councilDecision.differs, confidence: 0.7 };
          } else if (pilotKey === 'evenOdd') {
              const useStats = evenOddSpecificStats || evenOddStats;
              if (useStats.zScoreEven > evenOddThreshold) 
                  signalData = { contract: 'DIGITEVEN', confidence: 0.65 };
              else if (useStats.zScoreEven < -evenOddThreshold) 
                  signalData = { contract: 'DIGITODD', confidence: 0.65 };
          } else if (pilotKey === 'overUnder') {
              const useStats = overUnderSpecificStats || overUnderStats;
              if (useStats.zScoreOver4 > overUnderThreshold) 
                  signalData = { contract: 'DIGITOVER', digit: 4, confidence: 0.65 };
              else if (useStats.zScoreOver4 < -overUnderThreshold) 
                  signalData = { contract: 'DIGITUNDER', digit: 5, confidence: 0.65 };
          } else if (pilotKey === 'vagalume' && vagalumeSignal?.shouldTrade) {
              signalData = { contract: vagalumeSignal.suggestedContract, digit: vagalumeSignal.suggestedDigit, confidence: vagalumeSignal.confidence || 0.6 };
          }

          if (signalData.contract) {
            signals.push({ pilotKey, contract: signalData.contract, digit: signalData.digit, confidence: signalData.confidence });
          }
        }
        
        const groupedSignals: Record<string, typeof signals> = {};
        signals.forEach(s => {
          const key = `${s.contract}-${s.digit ?? 'x'}`;
          if (!groupedSignals[key]) groupedSignals[key] = [];
          groupedSignals[key].push(s);
        });

        for (const key in groupedSignals) {
          const group = groupedSignals[key];
          if (group.length >= minConsensus) {
            const avgConfidence = group.reduce((sum, s) => sum + s.confidence, 0) / group.length;
            const leadSignal = group[0];
            const pilotForStake = pilots[leadSignal.pilotKey];
            const stakeConfig: SmartMartingaleConfig = { isEnabled: pilotForStake.isMartingaleEnabled, baseStake: BASE_STAKE, maxMartingaleLevels: maxLosses, martingaleRecoveryInstallments: pilotForStake.martingaleRecoveryInstallments, isSmart: false };
            const bankrollState: BankrollState = { currentBankroll: (sessionInitialBankroll ?? 100) + dailyPnl, initialBankroll: sessionInitialBankroll, maxDailyLoss: dailyBalance, dailyProfitTarget: dailyTarget };
            const stakeDecision = decideNextStake(pilots[leadSignal.pilotKey].tradeHistory, stakeConfig, bankrollState, leadSignal.contract, avgConfidence, pilotForStake.accumulatedLoss, pilotForStake.consecutiveLosses);
            
            if (!stakeDecision.shouldPause) {
                executeTrade(leadSignal.contract, stakeDecision.nextStake, activeSymbol, 1, 't', 'Piloto', leadSignal.digit, `consensus:${group.map(s => s.pilotKey).join(',')}`)
                    .then(tradeResult => {
                        if (tradeResult.success && tradeResult.contractId) {
                            setPilots(prev => {
                                const newPilots = { ...prev };
                                group.forEach(s => {
                                    newPilots[s.pilotKey] = { ...newPilots[s.pilotKey], activeContractId: tradeResult.contractId! };
                                });
                                return newPilots;
                            });
                        }
                    });
            }
          }
        }

    } else {
        for (const [key, pilot] of activePilotEntries) {
          if (tradeExecutedThisCycle) break;
          if (pilot.status !== 'TRADING' || pilot.activeContractId !== null) continue;
          
          const pilotKey = key as PilotType;
          
          const initialBankroll = sessionInitialBankroll ?? (accountBalance.balance ?? 1000);
          const currentBankroll = initialBankroll + dailyPnl;
          const bankrollState: BankrollState = { currentBankroll, initialBankroll, maxDailyLoss: dailyBalance, dailyProfitTarget: dailyTarget };
          
          let shouldExecute = false;
          let executionParams: [DigitContractType, number?, string?] | null = null;
          let contractTypeForStake: DigitContractType = 'DIGITDIFF';
          
          switch (pilotKey) {
            case 'matchesDiffers':
              const hottest = matchesDiffersStats?.frequencies.sort((a,b) => b.zScore - a.zScore)[0];
              if (hottest && hottest.zScore > consensusThreshold) {
                  shouldExecute = true;
                  executionParams = ['DIGITDIFF', hottest.digit, pilotKey];
                  contractTypeForStake = 'DIGITDIFF';
                  setPilots(prev => {
                      const newTarget = `🎯 DIFFERS ${hottest.digit} (Z-Score: ${hottest.zScore.toFixed(2)})`;
                      if (prev.matchesDiffers.currentTarget === newTarget) return prev;
                      return { ...prev, matchesDiffers: { ...prev.matchesDiffers, currentTarget: newTarget }};
                  });
              } else {
                  setPilots(prev => {
                      const newTarget = hottest ? `⏳ Aguardando (Z-Score: ${hottest.zScore.toFixed(2)} < ${consensusThreshold.toFixed(1)})` : '📊 Coletando dados...';
                      if (prev.matchesDiffers.currentTarget === newTarget) return prev;
                      return { ...prev, matchesDiffers: { ...prev.matchesDiffers, currentTarget: newTarget }};
                  });
              }
              break;
            case 'overUnder':
              const useOverUnderStats = overUnderSpecificStats || overUnderStats;
              if (useOverUnderStats.zScoreOver4 > overUnderThreshold) {
                  shouldExecute = true;
                  executionParams = ['DIGITOVER', 4, pilotKey];
                  contractTypeForStake = 'DIGITOVER';
                  setPilots(prev => {
                      const newTarget = `🔺 OVER 4 (z-score: ${useOverUnderStats.zScoreOver4.toFixed(2)})`;
                      if (prev.overUnder.currentTarget === newTarget) return prev;
                      return {...prev, overUnder: {...prev.overUnder, currentTarget: newTarget }};
                  });
              } else if (useOverUnderStats.zScoreOver4 < -overUnderThreshold) {
                  shouldExecute = true;
                  executionParams = ['DIGITUNDER', 5, pilotKey];
                  contractTypeForStake = 'DIGITUNDER';
                  setPilots(prev => {
                      const newTarget = `🔻 UNDER 5 (z-score: ${useOverUnderStats.zScoreOver4.toFixed(2)})`;
                      if (prev.overUnder.currentTarget === newTarget) return prev;
                      return {...prev, overUnder: {...prev.overUnder, currentTarget: newTarget }};
                  });
              } else {
                  setPilots(prev => {
                      const newTarget = `⏳ Aguardando (|z|: ${Math.abs(useOverUnderStats.zScoreOver4).toFixed(2)} < ${overUnderThreshold})`;
                      if (prev.overUnder.currentTarget === newTarget) return prev;
                      return {...prev, overUnder: {...prev.overUnder, currentTarget: newTarget}};
                  });
              }
              break;
            case 'evenOdd':
                const useEvenOddStats = evenOddSpecificStats || evenOddStats;
                if (useEvenOddStats.zScoreEven > evenOddThreshold) {
                    shouldExecute = true; 
                    executionParams = ['DIGITEVEN', undefined, pilotKey]; 
                    contractTypeForStake = 'DIGITEVEN';
                    setPilots(prev => {
                        const newTarget = `🔢 PAR (z-score: ${useEvenOddStats.zScoreEven.toFixed(2)})`;
                        if (prev.evenOdd.currentTarget === newTarget) return prev;
                        return {...prev, evenOdd: {...prev.evenOdd, currentTarget: newTarget }};
                    });
                } else if (useEvenOddStats.zScoreEven < -evenOddThreshold) {
                    shouldExecute = true; 
                    executionParams = ['DIGITODD', undefined, pilotKey]; 
                    contractTypeForStake = 'DIGITODD';
                    setPilots(prev => {
                        const newTarget = `🔢 ÍMPAR (z-score: ${useEvenOddStats.zScoreEven.toFixed(2)})`;
                        if (prev.evenOdd.currentTarget === newTarget) return prev;
                        return {...prev, evenOdd: {...prev.evenOdd, currentTarget: newTarget}};
                    });
                } else {
                    setPilots(prev => {
                        const newTarget = `⏳ Aguardando (|z|: ${Math.abs(useEvenOddStats.zScoreEven).toFixed(2)} < ${evenOddThreshold})`;
                        if (prev.evenOdd.currentTarget === newTarget) return prev;
                        return {...prev, evenOdd: {...prev.evenOdd, currentTarget: newTarget}};
                    });
                }
                break;
            case 'underdog':
               const coldestDigitStat = underdogSpecificStats.length > 0 
                   ? [...underdogSpecificStats].sort((a, b) => a.probability - b.probability)[0] 
                   : null;
               
               if (coldestDigitStat && coldestDigitStat.probability <= (underdogThreshold / 100)) {
                   shouldExecute = true;
                   contractTypeForStake = isUnderdogInverse ? 'DIGITDIFF' : 'DIGITMATCH';
                   executionParams = [contractTypeForStake, coldestDigitStat.digit, pilotKey];
                   setPilots(prev => {
                       const newTarget = `🎲 ${isUnderdogInverse ? 'DIFFERS' : 'MATCH'} ${coldestDigitStat.digit} (${(coldestDigitStat.probability * 100).toFixed(1)}%)`;
                       if (prev.underdog.currentTarget === newTarget) return prev;
                       return {...prev, underdog: {...prev.underdog, currentTarget: newTarget}};
                   });
               } else {
                   setPilots(prev => {
                       const newTarget = coldestDigitStat ? `⏳ Aguardando (Min: ${(coldestDigitStat.probability * 100).toFixed(1)}% > ${underdogThreshold}%)` : '📊 Coletando dados...';
                       if (prev.underdog.currentTarget === newTarget) return prev;
                       return {...prev, underdog: {...prev.underdog, currentTarget: newTarget}};
                   });
               }
               break;
            case 'underdogOverUnder': {
                const uouLookbackStats = calculateDigitStatsForWindow(priceTicks, underdogOverUnderLookback, decimalPlaces);
                const zScoreThreshold = overUnderUnderdogThreshold; // Repurposing the threshold state
                if (uouLookbackStats.zScoreOver4 < -zScoreThreshold) {
                    shouldExecute = true; executionParams = ['DIGITOVER', 4, pilotKey]; contractTypeForStake = 'DIGITOVER';
                    setPilots(prev => {
                        const newTarget = `🔺 OVER 4 'atrasado' (z: ${uouLookbackStats.zScoreOver4.toFixed(2)})`;
                        if (prev.underdogOverUnder.currentTarget === newTarget) return prev;
                        return {...prev, underdogOverUnder: {...prev.underdogOverUnder, currentTarget: newTarget}};
                    });
                } else if (uouLookbackStats.zScoreOver4 > zScoreThreshold) {
                    shouldExecute = true; executionParams = ['DIGITUNDER', 5, pilotKey]; contractTypeForStake = 'DIGITUNDER';
                     setPilots(prev => {
                        const newTarget = `🔻 UNDER 5 'atrasado' (z: ${uouLookbackStats.zScoreOver4.toFixed(2)})`;
                        if (prev.underdogOverUnder.currentTarget === newTarget) return prev;
                        return {...prev, underdogOverUnder: {...prev.underdogOverUnder, currentTarget: newTarget}};
                    });
                } else {
                    setPilots(prev => {
                       const newTarget = `⏳ Aguardando desvio > ${zScoreThreshold.toFixed(1)}σ`;
                       if (prev.underdogOverUnder.currentTarget === newTarget) return prev;
                       return {...prev, underdogOverUnder: {...prev.underdogOverUnder, currentTarget: newTarget}};
                   });
                }
                break;
            }
            case 'dynamicUnderdogOverUnder':
                if (multiWindowAnalysis?.coldestConsensusDigit !== undefined && multiWindowAnalysis?.coldestConsensusDigit !== null) {
                    shouldExecute = true;
                    const digit = multiWindowAnalysis.coldestConsensusDigit;
                    if (digit > 4) { executionParams = ['DIGITUNDER', 5, pilotKey]; contractTypeForStake = 'DIGITUNDER'; }
                    else { executionParams = ['DIGITOVER', 4, pilotKey]; contractTypeForStake = 'DIGITOVER'; }
                    setPilots(prev => {
                        const newTarget = `🎯 Bloco Oposto ao Azarão ${digit}`;
                        if (prev.dynamicUnderdogOverUnder.currentTarget === newTarget) return prev;
                        return {...prev, dynamicUnderdogOverUnder: {...prev.dynamicUnderdogOverUnder, currentTarget: newTarget}};
                    });
                } else {
                    setPilots(prev => {
                        const newTarget = '⏳ Aguardando Consenso de Azarão';
                        if (prev.dynamicUnderdogOverUnder.currentTarget === newTarget) return prev;
                        return {...prev, dynamicUnderdogOverUnder: {...prev.dynamicUnderdogOverUnder, currentTarget: newTarget}};
                    });
                }
                break;
            case 'underdogEvenOdd': {
                const uoeLookbackStats = calculateDigitStatsForWindow(priceTicks, underdogEvenOddLookback, decimalPlaces);
                const zScoreThreshold = evenOddUnderdogThreshold; // Repurposing the threshold state
                
                if (uoeLookbackStats.zScoreEven < -zScoreThreshold) {
                    shouldExecute = true; executionParams = ['DIGITEVEN', undefined, pilotKey]; contractTypeForStake = 'DIGITEVEN';
                    setPilots(prev => {
                        const newTarget = `🔢 PAR 'atrasado' (z: ${uoeLookbackStats.zScoreEven.toFixed(2)})`;
                        if (prev.underdogEvenOdd.currentTarget === newTarget) return prev;
                        return {...prev, underdogEvenOdd: {...prev.underdogEvenOdd, currentTarget: newTarget}};
                    });
                } 
                else if (uoeLookbackStats.zScoreEven > zScoreThreshold) {
                    shouldExecute = true; executionParams = ['DIGITODD', undefined, pilotKey]; contractTypeForStake = 'DIGITODD';
                    setPilots(prev => {
                        const newTarget = `🔢 ÍMPAR 'atrasado' (z: ${uoeLookbackStats.zScoreEven.toFixed(2)})`;
                        if (prev.underdogEvenOdd.currentTarget === newTarget) return prev;
                        return {...prev, underdogEvenOdd: {...prev.underdogEvenOdd, currentTarget: newTarget}};
                    });
                } else {
                    setPilots(prev => {
                       const newTarget = `⏳ Aguardando desvio > ${zScoreThreshold.toFixed(1)}σ`;
                       if (prev.underdogEvenOdd.currentTarget === newTarget) return prev;
                       return {...prev, underdogEvenOdd: {...prev.underdogEvenOdd, currentTarget: newTarget}};
                   });
                }
                break;
            }
            case 'vagalume':
                if (vagalumeSignal?.shouldTrade) {
                    shouldExecute = true;
                    executionParams = [vagalumeSignal.suggestedContract, vagalumeSignal.suggestedDigit, pilotKey];
                    contractTypeForStake = vagalumeSignal.suggestedContract;
                    setPilots(prev => {
                        const newTarget = `✨ ${vagalumeSignal.reason}`;
                        if (prev.vagalume.currentTarget === newTarget) return prev;
                        return { ...prev, vagalume: { ...prev.vagalume, currentTarget: newTarget } };
                    });
                } else {
                    setPilots(prev => {
                        const newTarget = `⏳ ${vagalumePauseReason || 'Aguardando contexto...'}`;
                        if (prev.vagalume.currentTarget === newTarget) return prev;
                        return {...prev, vagalume: {...prev.vagalume, currentTarget: newTarget}};
                    });
                }
                break;
            case 'sherlock':
                if(sherlockAnalysis && (sherlockAnalysis.blockProbability * 100) > sherlockThreshold) {
                    const wins = pilot.tradeHistory.filter(t => t.result && t.result > 0).length;
                    const winRate = pilot.tradeHistory.length > 0 ? (wins / pilot.tradeHistory.length) * 100 : 100;
                    
                    setPilots(prev => {
                        const newTarget = `🕵️ ${sherlockAnalysis.recommendedBlock.toUpperCase()} (${(sherlockAnalysis.blockProbability*100).toFixed(1)}%). WR: ${winRate.toFixed(0)}%`;
                        if (prev.sherlock.currentTarget === newTarget) return prev;
                        return {...prev, sherlock: {...prev.sherlock, currentTarget: newTarget}};
                    });

                    if (winRate > sherlockWinRateThreshold) {
                        shouldExecute = true;
                        if(sherlockAnalysis.recommendedBlock === 'even') { executionParams = ['DIGITEVEN', undefined, pilotKey]; contractTypeForStake = 'DIGITEVEN'; }
                        else if (sherlockAnalysis.recommendedBlock === 'odd') { executionParams = ['DIGITODD', undefined, pilotKey]; contractTypeForStake = 'DIGITODD'; }
                        else if (sherlockAnalysis.recommendedBlock === 'above4') { executionParams = ['DIGITOVER', 4, pilotKey]; contractTypeForStake = 'DIGITOVER'; }
                        else if (sherlockAnalysis.recommendedBlock === 'below5') { executionParams = ['DIGITUNDER', 5, pilotKey]; contractTypeForStake = 'DIGITUNDER'; }
                    }
                } else {
                    setPilots(prev => {
                        const newTarget = `⏳ Aguardando P(bloco) > ${sherlockThreshold}%`;
                        if (prev.sherlock.currentTarget === newTarget) return prev;
                        return {...prev, sherlock: {...prev.sherlock, currentTarget: newTarget}};
                    });
                }
                break;
          }

          if (shouldExecute && executionParams) {
              const pilotKeyForStake = executionParams[2] as PilotType;
              const pilotForStake = pilots[pilotKeyForStake];
              const stakeConfig: SmartMartingaleConfig = { 
                  isEnabled: pilotForStake.isMartingaleEnabled, baseStake: BASE_STAKE, maxMartingaleLevels: maxLosses, 
                  martingaleRecoveryInstallments: pilotForStake.martingaleRecoveryInstallments, isSmart: isSmartMartingale,
              };
              const confidenceForStake = signalQuality?.confidenceLevel === 'MUITO_ALTA' ? 0.85 : signalQuality?.confidenceLevel === 'ALTA' ? 0.75 : signalQuality?.confidenceLevel === 'MEDIA' ? 0.65 : 0.55;
              
              const stakeDecision = decideNextStake(
                pilotForStake.tradeHistory, 
                stakeConfig, 
                bankrollState, 
                contractTypeForStake, 
                confidenceForStake,
                pilotForStake.accumulatedLoss,
                pilotForStake.consecutiveLosses,
              );

              if (stakeDecision.shouldPause) {
                setPilots(prev => ({ ...prev, [pilotKeyForStake]: { ...prev[pilotKeyForStake], status: 'CIRCUIT_BREAKER', currentTarget: stakeDecision.pauseReason || 'Limite de risco atingido' }}));
                continue;
              }

              const finalStake = stakeDecision.nextStake;
              
              executeTrade(executionParams[0], finalStake, activeSymbol, 1, 't', 'Piloto', executionParams[1], executionParams[2])
                .then(tradeResult => {
                    if (tradeResult.success && tradeResult.contractId) {
                        setPilots(prev => ({
                            ...prev,
                            [pilotKeyForStake]: { ...prev[pilotKeyForStake], activeContractId: tradeResult.contractId! }
                        }));
                    }
                });
              tradeExecutedThisCycle = true;
              lastExecutionTimestampRef.current = now;
              break;
          }
        }
    }
    
    executionRef.current = false;
  }, [
      priceTicks, pilots, operationsLog, shouldTrade, councilDecision, executeTrade, activeSymbol, toast, 
      dailyBalance, dailyTarget, maxLosses, sessionInitialBankroll, accountBalance.balance, dailyPnl,
      overUnderStats, evenOddStats, overUnderThreshold, evenOddThreshold, underdogThreshold, isUnderdogInverse, overUnderUnderdogThreshold, evenOddUnderdogThreshold,
      executionCooldown, isSmartMartingale, analysisResults.mainWindowStats, multiWindowAnalysis,
      cooldownTime, consensusThreshold, onVagalumeTradeCompleted, vagalumeConfig, vagalumeSignal, vagalumePauseReason,
      isConsensusMode, minConsensus, sherlockAnalysis, sherlockThreshold, sherlockWinRateThreshold,
      matchesDiffersLookback, overUnderLookback, evenOddLookback, underdogLookback, underdogOverUnderLookback, dynamicUnderdogOverUnderLookback, underdogEvenOddLookback,
      matchesDiffersStats, overUnderSpecificStats, evenOddSpecificStats, underdogSpecificStats
  ]);
  
  // --- FUNÇÕES DE OTIMIZAÇÃO E APLICAÇÃO ---

  const loadDataForBacktest = useCallback(async () => {
    if (!user || !activeSymbol) return;
    setIsDataLoading(true);
    setBacktestTicks([]);
    try {
        const ticks = await loadHistoricalTicksForDigits(user.uid, activeSymbol, { limit: 5000 });
        if (ticks.length < 1000) {
            toast({ title: "Dados Insuficientes", description: `Apenas ${ticks.length} ticks encontrados. Deixe o app aberto para coletar mais.`, variant: "destructive" });
        } else {
            toast({ title: "Dados Carregados!", description: `${ticks.length} ticks históricos prontos para análise.`});
        }
        setBacktestTicks(ticks);
    } catch(e) {
        toast({ title: "Erro ao Carregar Dados", description: (e as Error).message, variant: "destructive" });
    } finally {
        setIsDataLoading(false);
    }
  }, [user, activeSymbol, toast]);

  const runBacktestForAllStrategies = useCallback(() => {
    if (backtestTicks.length < 1000) {
      toast({ title: "Dados Insuficientes", description: `Carregue pelo menos 1000 ticks para rodar o backtest.`, variant: "destructive" });
      return;
    }
    
    setIsBacktesting(true);
    setBacktestResults(null);
    toast({ title: "Iniciando Backtest Rápido...", description: "Simulando estratégias com os parâmetros atuais." });

    setTimeout(() => {
        const ticksForBacktest = backtestTicks.slice(-1000);
        const results: Record<string, StrategyBacktestResult> = {};
        const currentParams = {
            consensusThreshold, overUnderThreshold, evenOddThreshold, underdogThreshold,
            isUnderdogInverse, overUnderUnderdogThreshold, evenOddUnderdogThreshold,
        };
        
        STRATEGY_DEFINITIONS.forEach(strategyDef => {
            if (strategyDef.id === 'vagalume' || strategyDef.id === 'sherlock' || strategyDef.id === 'dynamicUnderdogOverUnder') return;
            try {
                const { summary } = runDigitsBacktest(ticksForBacktest, {
                    strategy: strategyDef,
                    initialBankroll: 100,
                    stakePerTrade: 1,
                    maxTrades: 200,
                    paramsOverride: currentParams,
                }, decimalPlaces);
                results[strategyDef.id] = { ...summary, strategyId: strategyDef.id };
            } catch (e) {
                console.error(`Backtest para ${strategyDef.name} falhou:`, e);
            }
        });

        setBacktestResults(results);
        setIsBacktesting(false);
        toast({ title: "Backtest Concluído!" });
    }, 50); 
  }, [backtestTicks, toast, consensusThreshold, overUnderThreshold, evenOddThreshold, underdogThreshold, isUnderdogInverse, overUnderUnderdogThreshold, evenOddUnderdogThreshold, decimalPlaces]);

  const runCalibration = useCallback(async () => {
    if (isCalibrating) return;
    if (backtestTicks.length < 5000) {
      toast({ title: "Dados Insuficientes", description: "A calibração requer 5000 ticks. Carregue mais dados.", variant: "destructive" });
      return;
    }
    
    setIsCalibrating(true);
    setCalibrationResults(null);
    toast({ title: "Iniciando Calibração...", description: "Testando centenas de parâmetros, isso pode levar um momento." });

    setTimeout(async () => {
      try {
        const ticks = backtestTicks.slice(-5000);
        const results: Record<string, CalibrationResult> = {};
        
        for (const strategyDef of STRATEGY_DEFINITIONS) {
          if (strategyDef.id === 'vagalume' || strategyDef.id === 'sherlock') continue;
          const searchSpaces = STRATEGY_SEARCH_SPACES[strategyDef.id];
          if (!searchSpaces || searchSpaces.length === 0) continue;
          
          const calibrationConfig = {
            strategyDef,
            searchSpaces,
            backtestConfigBase: { initialBankroll: 100, stakePerTrade: 1, maxTrades: 500 }
          };
          
          const result = calibrateStrategyGridSearch(ticks, calibrationConfig, decimalPlaces);
          results[strategyDef.id] = result;
        }

        setCalibrationResults(results);
        toast({ title: "Calibração Concluída!", description: "Parâmetros otimizados estão prontos para serem aplicados." });
      } catch (error) {
        toast({ title: "Erro na Calibração", description: (error as Error).message, variant: "destructive" });
      } finally {
        setIsCalibrating(false);
      }
    }, 50);

  }, [isCalibrating, backtestTicks, toast, decimalPlaces]);

  const applyCalibration = useCallback(() => {
    if (!calibrationResults) {
        toast({ title: "Nenhum Resultado", description: "Execute a calibração primeiro.", variant: "destructive" });
        return;
    }

    let appliedCount = 0;
    for (const key in calibrationResults) {
        const result = calibrationResults[key];
        const strategyDef = STRATEGY_DEFINITIONS.find(def => def.id === result.bestSummary.strategyId);

        if (strategyDef && strategyDef.paramKey) {
            const paramValue = result.bestParams[strategyDef.paramKey];
            if (paramValue !== undefined) {
                switch(strategyDef.paramKey) {
                    case 'consensusThreshold': setConsensusThreshold(paramValue as number); break;
                    case 'overUnderThreshold': setOverUnderThreshold(paramValue as number); break;
                    case 'evenOddThreshold': setEvenOddThreshold(paramValue as number); break;
                    case 'underdogThreshold': setUnderdogThreshold(paramValue as number); break;
                    case 'overUnderUnderdogThreshold': setOverUnderUnderdogThreshold(paramValue as number); break;
                    case 'evenOddUnderdogThreshold': setEvenOddUnderdogThreshold(paramValue as number); break;
                    case 'sherlockThreshold': setSherlockThreshold(paramValue as number); break;
                }
                appliedCount++;
            }
        }
        if (strategyDef?.otherParams?.isInverseKey) {
            const paramValue = result.bestParams[strategyDef.otherParams.isInverseKey];
            if (paramValue !== undefined) {
                setIsUnderdogInverse(paramValue as boolean);
            }
        }
    }
    toast({ title: "Parâmetros Aplicados!", description: `${appliedCount} ajustes foram aplicados aos pilotos automáticos.` });
  }, [calibrationResults, toast]);


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
    sherlockThreshold, setSherlockThreshold,
    sherlockLookback, setSherlockLookback,
    disableSherlockCompensation, setDisableSherlockCompensation,
    sherlockWinRateThreshold, setSherlockWinRateThreshold,
    isSmartMartingale, setIsSmartMartingale,
    cooldownTime, setCooldownTime,
    maxLosses, setMaxLosses,
    executionCooldown, setExecutionCooldown,
    isCouncilAutopilotOn: Object.values(pilots).some(p => p.isOn),
    councilDecision,
    pilots,
    toggleAutopilot,
    togglePilotMartingale,
    setPilotMartingaleInstallments,
    resetSession,
    multiWindowAnalysis,
    signalQuality,
    shouldTrade,
    vagalumeSignal,
    vagalumeConfig,
    setVagalumeConfig,
    sherlockAnalysis,
    latencyMetrics,
    backtestTicks,
    isDataLoading,
    loadDataForBacktest,
    backtestResults,
    isBacktesting,
    runBacktestForAllStrategies,
    calibrationResults,
    isCalibrating,
    runCalibration,
    applyCalibration,
    isConsensusMode,
    setIsConsensusMode,
    minConsensus,
    setMinConsensus,
    matchesDiffersLookback, setMatchesDiffersLookback,
    overUnderLookback, setOverUnderLookback,
    evenOddLookback, setEvenOddLookback,
    underdogLookback, setUnderdogLookback,
    underdogOverUnderLookback, setUnderdogOverUnderLookback,
    dynamicUnderdogOverUnderLookback, setDynamicUnderdogOverUnderLookback,
    underdogEvenOddLookback, setUnderdogEvenOddLookback,
  };
}

const getDecimalPlaces = (pipSize: number | undefined): number => {
    if (pipSize === undefined || pipSize === null || pipSize <= 0) {
        return 2; 
    }
    if (Math.floor(pipSize) === pipSize && pipSize >= 1) {
        return 0;
    }
    const priceString = String(pipSize);
    if (priceString.includes('.')) {
        return priceString.split('.')[1].length;
    }
    return 0;
};
