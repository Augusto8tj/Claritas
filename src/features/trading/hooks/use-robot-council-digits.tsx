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
import { timingMonitor } from '@/features/trading/utils/timing-monitor';
import { globalLatencyMonitor, LatencyMetrics } from '../utils/latency-monitor';
import { buildTransitionMatrix, predictNTicksAhead, BlockProbs } from '../services/sherlock-multi-step';

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
  const [overUnderThreshold, setOverUnderThreshold] = useState(65);
  const [evenOddThreshold, setEvenOddThreshold] = useState(65);
  const [underdogThreshold, setUnderdogThreshold] = useState(5.0);
  const [isUnderdogInverse, setIsUnderdogInverse] = useState(false);
  const [overUnderUnderdogThreshold, setOverUnderUnderdogThreshold] = useState(40);
  const [evenOddUnderdogThreshold, setEvenOddUnderdogThreshold] = useState(40);
  const [sherlockThreshold, setSherlockThreshold] = useState(60);
  const [sherlockLookback, setSherlockLookback] = useState(500);
  const [disableSherlockCompensation, setDisableSherlockCompensation] = useState(false);
  const [sherlockWinRateThreshold, setSherlockWinRateThreshold] = useState(45);

  const [vagalumeConfig, setVagalumeConfig] = useState<VagalumeConfig>({
      minSequenceLength: 3,
      usePredictiveAnalysis: true,
      contextualThreshold: 55,
      requireRangingRegime: true,
      allowedContracts: {
        MATCHDIFFERS: true,
        EVENODD: true,
        OVERUNDER: true,
      },
      maxStreak: 2,
      stateW1_matchThreshold: 8,
      stateL1_differsThreshold: 15,
      resetMultiplier: 1.2,
      pauseAfterFailedResets: 2,
      kellyFraction: 0.25,
  });
  
  // --- GESTÃO DE RISCO AVANÇADA (MARTINGALE & CONSENSO) ---
  const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(false);
  const [isSmartMartingale, setIsSmartMartingale] = useState(false);
  const [martingaleRecoveryInstallments, setMartingaleRecoveryInstallments] = useState(3);
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

  const { signal: vagalumeSignal, onTradeCompleted: onVagalumeTradeCompleted } = useVagalumeAlternante(
    priceTicks,
    pilots.vagalume.tradeHistory,
    vagalumeConfig,
    accountBalance.balance ?? 1000,
    decimalPlaces
  );

  // --- ANÁLISE ESTATÍSTICA ---
  const analysisResults = useMemo(() => {
    const windowSizes = [50, 200, 1000];
    if (!priceTicks || priceTicks.length < 50) {
      return { windowsStats: [], mainWindowStats: null };
    }
    const windowsStats = windowSizes.map(size => {
        if(priceTicks.length < size) return null;
        return calculateDigitStatsForWindow(priceTicks, size, decimalPlaces);
    }).filter(w => w !== null) as WindowDigitStats[];

    const mainWindowStats = windowsStats.find(w => w.windowSize === 1000) || windowsStats[windowsStats.length - 1];
    return { windowsStats, mainWindowStats };
  }, [priceTicks, decimalPlaces]);
  
  const digitStats = useMemo(() => analysisResults.mainWindowStats?.frequencies || [], [analysisResults.mainWindowStats]);

  const underdogDigitStats = useMemo(() => {
    if (!priceTicks || priceTicks.length < 100) return [];
    return calculateDigitStatsForWindow(priceTicks, 100, decimalPlaces).frequencies;
  }, [priceTicks, decimalPlaces]);

  const multiWindowAnalysis = useMemo(() => {
    if (analysisResults.windowsStats.length === 0) return null;
    return getMultiWindowAnalysis(analysisResults.windowsStats);
  }, [analysisResults.windowsStats]);
  
  const signalQuality = useMemo(() => {
    if (!multiWindowAnalysis || !analysisResults.mainWindowStats) return null;
    return determineSignalQuality(multiWindowAnalysis, analysisResults.mainWindowStats);
  }, [multiWindowAnalysis, analysisResults.mainWindowStats]);
  
  const sherlockAnalysis = useMemo((): SherlockAnalysis | null => {
      if (priceTicks.length < sherlockLookback) return null;
      
      const ticksForMatrix = priceTicks.slice(-sherlockLookback);
      const metrics = globalLatencyMonitor.getMetrics();
      
      const compensationSteps = disableSherlockCompensation 
        ? 0 
        : Math.min(Math.ceil(metrics.avgLatency / 1000), 3);
      
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
        const profit = trade.result || 0;
        return sum + profit;
    }, 0);
  }, [pilots]);

  const overUnderStats = useMemo(() => {
    if (!analysisResults.mainWindowStats) return { probOver4: 0, probUnder5: 0 };
    return {
        probOver4: analysisResults.mainWindowStats.probOver4,
        probUnder5: analysisResults.mainWindowStats.probUnder5,
    };
  }, [analysisResults.mainWindowStats]);

  const evenOddStats = useMemo(() => {
    if (!analysisResults.mainWindowStats) return { probEven: 0 };
    return { probEven: analysisResults.mainWindowStats.probEven };
  }, [analysisResults.mainWindowStats]);

  // --- LÓGICA DE EXECUÇÃO E ATUALIZAÇÃO ---
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
        
        setTimeout(() => {
            toast({ title: `Piloto ${strategyLabels[pilotType] || 'Desconhecido'} ${newIsOnState ? 'Ativado' : 'Desativado'}` });
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
    const interval = setInterval(() => {
        setLatencyMetrics(globalLatencyMonitor.getMetrics());
    }, 2000);
    return () => clearInterval(interval);
  }, []);
  
  useEffect(() => {
    const cycleStart = performance.now();
    
    if (executionRef.current) return;
    const activePilotEntries = Object.entries(pilots).filter(([, p]) => p.isOn);
    if (activePilotEntries.length === 0) return;

    executionRef.current = true;
    
    const lastOp = operationsLog.length > 0 ? operationsLog[0] : null;
    if (lastOp && lastOp.id !== lastProcessedOpIdRef.current && lastOp.status !== 'pending') {
      lastProcessedOpIdRef.current = lastOp.id;
      
      const pilotKey = lastOp.strategy as PilotType | 'vagalume' | undefined;

      if (pilotKey) {
        if (pilotKey === 'vagalume') {
            onVagalumeTradeCompleted(lastOp);
        }

        const pilotToUpdate = pilots[pilotKey as PilotType];
        if (pilotToUpdate) {
            const updatedHistory = [...pilotToUpdate.tradeHistory, lastOp];
            const newLosses = (lastOp.result ?? 0) < 0 ? pilotToUpdate.consecutiveLosses + 1 : 0;
            const newAccumulatedLoss = (lastOp.result ?? 0) < 0 ? pilotToUpdate.accumulatedLoss + Math.abs(lastOp.result || -lastOp.stake) : 0;
            const newStatus: AutopilotStatus = newLosses >= maxLosses ? 'CIRCUIT_BREAKER' : 'COOLDOWN';

            setPilots(prev => ({
                ...prev,
                [pilotKey as PilotType]: {
                    ...prev[pilotKey as PilotType], 
                    tradeHistory: updatedHistory, 
                    consecutiveLosses: newLosses,
                    accumulatedLoss: newAccumulatedLoss, 
                    status: newStatus, 
                    activeContractId: null,
                }
            }));

            if (newStatus === 'COOLDOWN') {
              setTimeout(() => {
                setPilots(prev => {
                  const currentPilot = prev[pilotKey as PilotType];
                  if (currentPilot?.status === 'COOLDOWN') {
                    return { ...prev, [pilotKey as PilotType]: { ...currentPilot, status: 'TRADING', currentTarget: `Pausa de ${cooldownTime}s terminada` } };
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
    
    if (isConsensusMode) {
        const activePilots = activePilotEntries.map(([key]) => key as PilotType);
        const signals: Array<{ pilotKey: PilotType, contract: DigitContractType, digit?: number, confidence: number }> = [];

        for (const pilotKey of activePilots) {
          const pilot = pilots[pilotKey];
          if (pilot.status !== 'TRADING' || pilot.activeContractId !== null) continue;

          let signalData: { contract: DigitContractType | null, digit?: number, confidence: number } = { contract: null, confidence: 0 };
          
          if (pilotKey === 'sherlock' && sherlockAnalysis && (sherlockAnalysis.blockProbability * 100) > sherlockThreshold) {
            // ... (lógica do sherlock para obter contrato e dígito)
          } else if (pilotKey !== 'sherlock') {
             // ... (lógica para os outros pilotos)
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
            const stakeConfig: SmartMartingaleConfig = { isEnabled: isMartingaleEnabled, baseStake: BASE_STAKE, maxMartingaleLevels: maxLosses, martingaleRecoveryInstallments: martingaleRecoveryInstallments, isSmart: isSmartMartingale };
            const bankrollState: BankrollState = { currentBankroll: (sessionInitialBankroll ?? 100) + dailyPnl, initialBankroll: sessionInitialBankroll, maxDailyLoss: dailyBalance, dailyProfitTarget: dailyTarget };
            const stakeDecision = decideNextStake(pilots[leadSignal.pilotKey].tradeHistory, stakeConfig, bankrollState, leadSignal.contract, avgConfidence);
            
            if (!stakeDecision.shouldPause) {
                executeTrade(leadSignal.contract, stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', leadSignal.digit, `consensus:${group.map(s => s.pilotKey).join(',')}`);
                tradeExecutedThisCycle = true;
                lastExecutionTimestampRef.current = now;
                
                setPilots(prev => {
                    const newPilots = { ...prev };
                    group.forEach(s => {
                        newPilots[s.pilotKey] = { ...newPilots[s.pilotKey], activeContractId: -1 };
                    });
                    return newPilots;
                });
                break;
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
              if (shouldTrade && councilDecision.differs !== null) {
                  shouldExecute = true;
                  executionParams = ['DIGITDIFF', councilDecision.differs, pilotKey];
                  contractTypeForStake = 'DIGITDIFF';
              }
              break;
            case 'overUnder':
              if (overUnderStats.probOver4 > overUnderThreshold / 100) {
                  shouldExecute = true;
                  executionParams = ['DIGITOVER', 4, pilotKey];
                  contractTypeForStake = 'DIGITOVER';
              } else if (overUnderStats.probUnder5 > overUnderThreshold / 100) {
                  shouldExecute = true;
                  executionParams = ['DIGITUNDER', 5, pilotKey];
                  contractTypeForStake = 'DIGITUNDER';
              }
              break;
            case 'evenOdd':
               if (evenOddStats.probEven > evenOddThreshold / 100) {
                  shouldExecute = true;
                  executionParams = ['DIGITEVEN', undefined, pilotKey];
                  contractTypeForStake = 'DIGITEVEN';
               } else if ((1 - evenOddStats.probEven) > evenOddThreshold / 100) {
                  shouldExecute = true;
                  executionParams = ['DIGITODD', undefined, pilotKey];
                  contractTypeForStake = 'DIGITODD';
               }
               break;
            case 'underdog':
               const coldestDigitStat = underdogDigitStats.length > 0 ? [...underdogDigitStats].sort((a, b) => a.probability - b.probability)[0] : null;
               if (coldestDigitStat && coldestDigitStat.probability <= (underdogThreshold / 100)) {
                   shouldExecute = true;
                   contractTypeForStake = isUnderdogInverse ? 'DIGITDIFF' : 'DIGITMATCH';
                   executionParams = [contractTypeForStake, coldestDigitStat.digit, pilotKey];
               }
               break;
            case 'underdogOverUnder':
               if (overUnderStats.probOver4 < overUnderUnderdogThreshold / 100) {
                   shouldExecute = true; executionParams = ['DIGITOVER', 4, pilotKey]; contractTypeForStake = 'DIGITOVER';
               } else if (overUnderStats.probUnder5 < overUnderUnderdogThreshold / 100) {
                   shouldExecute = true; executionParams = ['DIGITUNDER', 5, pilotKey]; contractTypeForStake = 'DIGITUNDER';
               }
               break;
            case 'dynamicUnderdogOverUnder':
                const underdogBlock = multiWindowAnalysis?.coldestConsensusDigit;
                if (underdogBlock !== undefined) {
                    shouldExecute = true;
                    if (underdogBlock > 4) {
                      executionParams = ['DIGITUNDER', 5, pilotKey];
                      contractTypeForStake = 'DIGITUNDER';
                    }
                    else {
                      executionParams = ['DIGITOVER', 4, pilotKey];
                      contractTypeForStake = 'DIGITOVER';
                    }
                }
                break;
            case 'underdogEvenOdd':
                if (evenOddStats.probEven < evenOddUnderdogThreshold / 100) {
                    shouldExecute = true; executionParams = ['DIGITEVEN', undefined, pilotKey]; contractTypeForStake = 'DIGITEVEN';
                } else if (1 - evenOddStats.probEven < evenOddUnderdogThreshold / 100) {
                    shouldExecute = true; executionParams = ['DIGITODD', undefined, pilotKey]; contractTypeForStake = 'DIGITODD';
                }
                break;
            case 'vagalume':
                if(vagalumeSignal && vagalumeSignal.shouldTrade) {
                    shouldExecute = true;
                    executionParams = [vagalumeSignal.suggestedContract, vagalumeSignal.suggestedDigit, pilotKey];
                    contractTypeForStake = vagalumeSignal.suggestedContract;
                }
                break;
            case 'sherlock':
                if(sherlockAnalysis && (sherlockAnalysis.blockProbability * 100) > sherlockThreshold) {
                    const wins = pilot.tradeHistory.filter(t => t.result && t.result > 0).length;
                    const winRate = pilot.tradeHistory.length > 0 ? (wins / pilot.tradeHistory.length) * 100 : 100;

                    if (winRate > sherlockWinRateThreshold) {
                        shouldExecute = true;
                        if(sherlockAnalysis.recommendedBlock === 'even') { executionParams = ['DIGITEVEN', undefined, pilotKey]; contractTypeForStake = 'DIGITEVEN'; }
                        else if (sherlockAnalysis.recommendedBlock === 'odd') { executionParams = ['DIGITODD', undefined, pilotKey]; contractTypeForStake = 'DIGITODD'; }
                        else if (sherlockAnalysis.recommendedBlock === 'above4') { executionParams = ['DIGITOVER', 4, pilotKey]; contractTypeForStake = 'DIGITOVER'; }
                        else if (sherlockAnalysis.recommendedBlock === 'below5') { executionParams = ['DIGITUNDER', 5, pilotKey]; contractTypeForStake = 'DIGITUNDER'; }
                    }
                }
                break;
          }

          if (shouldExecute && executionParams) {
              const pilotKeyForStake = executionParams[2] as PilotType;
              const pilotForStake = pilots[pilotKeyForStake];
              const stakeConfig: SmartMartingaleConfig = { 
                  isEnabled: isMartingaleEnabled, baseStake: BASE_STAKE, maxMartingaleLevels: maxLosses, 
                  martingaleRecoveryInstallments: martingaleRecoveryInstallments, isSmart: isSmartMartingale,
              };
              const confidenceForStake = signalQuality?.confidenceLevel === 'MUITO_ALTA' ? 0.85 : signalQuality?.confidenceLevel === 'ALTA' ? 0.75 : signalQuality?.confidenceLevel === 'MEDIA' ? 0.65 : 0.55;
              const stakeDecision = decideNextStake(pilotForStake.tradeHistory, stakeConfig, bankrollState, contractTypeForStake, confidenceForStake);

              if (stakeDecision.shouldPause) {
                setPilots(prev => ({ ...prev, [pilotKeyForStake]: { ...prev[pilotKeyForStake], status: 'CIRCUIT_BREAKER', currentTarget: stakeDecision.pauseReason || 'Limite de risco atingido' }}));
                continue;
              }

              const finalStake = stakeDecision.nextStake;
              const currentTickEpoch = priceTicks.length > 0 ? priceTicks[priceTicks.length - 1].epoch : 0;
              
              executeTrade(executionParams[0], finalStake, activeSymbol!, 1, 't', 'Piloto', executionParams[1], executionParams[2])
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
      priceTicks, pilots, operationsLog, signalQuality, shouldTrade, councilDecision, executeTrade, activeSymbol, toast, 
      dailyBalance, dailyTarget, maxLosses, martingaleRecoveryInstallments, sessionInitialBankroll, accountBalance.balance, dailyPnl,
      overUnderStats, evenOddStats, overUnderThreshold, evenOddThreshold, underdogThreshold, isUnderdogInverse, overUnderUnderdogThreshold, evenOddUnderdogThreshold,
      executionCooldown, isMartingaleEnabled, isSmartMartingale, analysisResults.mainWindowStats, multiWindowAnalysis, digitStats,
      cooldownTime, consensusThreshold, underdogDigitStats, onVagalumeTradeCompleted, vagalumeConfig, vagalumeSignal,
      isConsensusMode, minConsensus, sherlockAnalysis, sherlockThreshold, sherlockWinRateThreshold
  ]);
  
  // --- FUNÇÕES DE OTIMIZAÇÃO E APLICAÇÃO (sem alterações) ---

  const loadDataForBacktest = useCallback(async () => { /* ... */ }, [user, activeSymbol, toast]);
  const runBacktestForAllStrategies = useCallback(() => { /* ... */ }, [/* ... */]);
  const runCalibration = useCallback(async () => { /* ... */ }, [/* ... */]);
  const applyCalibration = useCallback(() => { /* ... */ }, [calibrationResults, toast]);


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
    isMartingaleEnabled, setIsMartingaleEnabled,
    isSmartMartingale, setIsSmartMartingale,
    martingaleRecoveryInstallments, setMartingaleRecoveryInstallments,
    cooldownTime, setCooldownTime,
    maxLosses, setMaxLosses,
    executionCooldown, setExecutionCooldown,
    isCouncilAutopilotOn: Object.values(pilots).some(p => p.isOn),
    digitStats,
    councilDecision,
    pilots,
    toggleAutopilot,
    resetSession,
    multiWindowAnalysis,
    signalQuality,
    shouldTrade,
    // Vagalume
    vagalumeSignal,
    vagalumeConfig,
    setVagalumeConfig,
    // Sherlock
    sherlockAnalysis,
    latencyMetrics,
    // Backtesting & Calibration
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
    // NOVO: Expor controles de consenso
    isConsensusMode,
    setIsConsensusMode,
    minConsensus,
    setMinConsensus,
  };
}

const getDecimalPlaces = (pipSize: number | undefined): number => {
    if (pipSize === undefined || pipSize === null || pipSize <= 0) {
        return 2; 
    }
    if (Math.floor(pipSize) === pipSize && pipSize >= 1) {
        return 0;
    }
    const pipString = String(pipSize);
    if (pipString.includes('.')) {
        return pipString.split('.')[1].length;
    }
    return 0;
};
