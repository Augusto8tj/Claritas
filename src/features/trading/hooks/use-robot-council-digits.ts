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
} from '@/features/trading/services/smart-stake-manager-digits';
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


// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

export type PilotType = 'matchesDiffers' | 'overUnder' | 'evenOdd' | 'underdog' | 'underdogOverUnder' | 'dynamicUnderdogOverUnder' | 'underdogEvenOdd' | 'vagalume';
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

export interface StrategyBacktestResult extends BacktestSummary {
  strategyId: PilotType;
}

export interface CalibrationResult {
  bestParams: any;
  bestSummary: BacktestSummary;
  initialSummary: BacktestSummary;
}

const BASE_STAKE = 0.35;

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

export function useRobotCouncilDigits(activeSymbol: string | null, priceTicks: TickData[], activeAsset: Asset | null) {
  const { user } = useAuth();
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
  const [vagalumeConfig, setVagalumeConfig] = useState<VagalumeConfig>({
      maxStreak: 2,
      stateW1_matchThreshold: 8,
      stateL1_differsThreshold: 15,
      resetMultiplier: 1.2,
      pauseAfterFailedResets: 2,
      kellyFraction: 0.25,
      usePredictiveAnalysis: true,
  });
  
  // --- GESTÃO DE RISCO AVANÇADA (MARTINGALE) ---
  const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(false);
  const [isSmartMartingale, setIsSmartMartingale] = useState(true);
  const [martingaleRecoveryFactor, setMartingaleRecoveryFactor] = useState(1.3);
  const [cooldownTime, setCooldownTime] = useState(5);
  const [maxLosses, setMaxLosses] = useState(5);
  
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


  const [pilots, setPilots] = useState<Record<PilotType, PilotState>>({
    matchesDiffers: createInitialPilotState(),
    overUnder: createInitialPilotState(),
    evenOdd: createInitialPilotState(),
    underdog: createInitialPilotState(),
    underdogOverUnder: createInitialPilotState(),
    dynamicUnderdogOverUnder: createInitialPilotState(),
    underdogEvenOdd: createInitialPilotState(),
    vagalume: createInitialPilotState(),
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
    });
    setSessionInitialBankroll(accountBalance.balance ?? 1000);
    lastProcessedOpIdRef.current = null;
    toast({
      title: "Sessão de Dígitos Reiniciada",
      description: "O histórico de P&L e os estados dos pilotos foram resetados.",
    });
  }, [accountBalance.balance, toast]);

  const toggleAutopilot = useCallback((pilotType: PilotType | 'vagalume') => {
    setPilots(prev => {
        const pilot = prev[pilotType];
        if (!pilot) return prev;
        const newIsOnState = !pilot.isOn;

        if (newIsOnState && sessionInitialBankroll === null) {
            setSessionInitialBankroll(accountBalance.balance ?? 1000);
        }
        
        setTimeout(() => {
            toast({ title: `Piloto ${strategyLabels[pilotType] || 'Vagalume'} ${newIsOnState ? 'Ativado' : 'Desativado'}` });
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
                    ...pilotToUpdate, tradeHistory: updatedHistory, consecutiveLosses: newLosses,
                    accumulatedLoss: newAccumulatedLoss, status: newStatus, activeContractId: null,
                }
            }));

            if (newStatus === 'COOLDOWN') {
              setTimeout(() => {
                setPilots(prev => {
                  const currentPilot = prev[pilotKey as PilotType];
                  if (currentPilot?.status === 'COOLDOWN') {
                    return { ...prev, [pilotKey as PilotType]: { ...currentPilot, status: 'TRADING' } };
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

    const vagalumePilot = pilots.vagalume;
    if (vagalumePilot.isOn && vagalumePilot.status === 'TRADING' && vagalumePilot.activeContractId === null && vagalumeSignal) {
      tradeExecutedThisCycle = true;

      if (vagalumeSignal.shouldTrade) {
          const measureExecution = timingMonitor.startMeasurement();
          const currentTickEpoch = priceTicks[priceTicks.length - 1]?.epoch || 0;
          const tickAge = Date.now() - (currentTickEpoch * 1000);

          if (tickAge > 1500) {
              console.warn(`⏸️ [Vagalume] Tick muito antigo (${tickAge}ms). Aguardando.`);
              timingMonitor.recordTiming('vagalume', { analysisTime: 0, executionTime: 0, totalLatency: 0, tickAge }, true, 'Tick antigo');
          } else if (!vagalumeConfig.usePredictiveAnalysis && vagalumeSignal.analysisWindowEnd !== currentTickEpoch) {
              console.warn(`⏸️ [Vagalume] Novo tick chegou durante análise. Recalculando...`);
              timingMonitor.recordTiming('vagalume', { analysisTime: 0, executionTime: 0, totalLatency: 0, tickAge }, true, 'Novo tick durante análise');
          } else {
              const initialBankroll = sessionInitialBankroll ?? (accountBalance.balance ?? 1000);
              const currentBankroll = initialBankroll + dailyPnl;
              const bankrollState: BankrollState = { currentBankroll, initialBankroll, maxDailyLoss: dailyBalance, dailyProfitTarget: dailyTarget };
              const stakeConfig: SmartMartingaleConfig = { 
                  isEnabled: isMartingaleEnabled, baseStake: BASE_STAKE, maxMartingaleLevels: maxLosses, 
                  martingaleMultiplier: martingaleRecoveryFactor, useAntiMartingale: false, isSmart: isSmartMartingale,
              };
              const stakeDecision = decideNextStake(vagalumePilot.tradeHistory, stakeConfig, bankrollState, vagalumeSignal.suggestedContract, vagalumeSignal.adjustedConfidence);

              if (!stakeDecision.shouldPause) {
                  const finalStake = stakeDecision.nextStake * vagalumeSignal.suggestedStakeMultiplier;
                  
                  executeTrade(
                      vagalumeSignal.suggestedContract, 
                      finalStake, 
                      activeSymbol!, 
                      1, 't', 'Piloto', 
                      vagalumeSignal.suggestedDigit, 'vagalume'
                  ).then(tradeResult => {
                      const executionTime = measureExecution.end();
                      timingMonitor.recordTiming('vagalume', { analysisTime: vagalumeSignal.advancedScore?.analysisTime || 0, executionTime, totalLatency: executionTime + tickAge, tickAge });
                      if (tradeResult.success && tradeResult.contractId) {
                        setPilots(prev => ({ ...prev, vagalume: { ...prev.vagalume, activeContractId: tradeResult.contractId! } }));
                      }
                  });
                  lastExecutionTimestampRef.current = now;
              } else {
                  setPilots(prev => ({...prev, vagalume: {...prev.vagalume, status: 'CIRCUIT_BREAKER', currentTarget: stakeDecision.pauseReason || 'Limite de risco atingido'}}));
              }
          }
      }
      
      if (vagalumeSignal && (vagalumeSignal.state === 'W2' || vagalumeSignal.state === 'L2')) {
          tradeExecutedThisCycle = true;
      }
    }
    
    if (!tradeExecutedThisCycle) {
        for (const [key, pilot] of activePilotEntries) {
          if (pilot.status !== 'TRADING' || pilot.activeContractId !== null) continue;
          
          const pilotKey = key as PilotType;
          if (pilotKey === 'vagalume') continue;

          const initialBankroll = sessionInitialBankroll ?? (accountBalance.balance ?? 1000);
          const currentBankroll = initialBankroll + dailyPnl;
          const bankrollState: BankrollState = { currentBankroll, initialBankroll, maxDailyLoss: dailyBalance, dailyProfitTarget: dailyTarget };
          
          let shouldExecute = false;
          let executionParams: [DigitContractType, number?, string?] | null = null;
          let confidenceForStake: ConfidenceLevel = 'NULA';
          let contractTypeForStake: DigitContractType = 'DIGITDIFF';
          
          switch (pilotKey) {
            case 'matchesDiffers':
              if (shouldTrade && councilDecision.differs !== null) {
                  shouldExecute = true;
                  confidenceForStake = signalQuality!.confidenceLevel;
                  executionParams = ['DIGITDIFF', councilDecision.differs, pilotKey];
                  contractTypeForStake = 'DIGITDIFF';
              }
              break;
            case 'overUnder':
              if (overUnderStats.probOver4 > overUnderThreshold / 100) {
                  shouldExecute = true;
                  confidenceForStake = overUnderStats.probOver4 > 0.8 ? 'MUITO_ALTA' : 'ALTA';
                  executionParams = ['DIGITOVER', 4, pilotKey];
                  contractTypeForStake = 'DIGITOVER';
              } else if (overUnderStats.probUnder5 > overUnderThreshold / 100) {
                  shouldExecute = true;
                  confidenceForStake = overUnderStats.probUnder5 > 0.8 ? 'MUITO_ALTA' : 'ALTA';
                  executionParams = ['DIGITUNDER', 5, pilotKey];
                  contractTypeForStake = 'DIGITUNDER';
              }
              break;
            case 'evenOdd':
               if (evenOddStats.probEven > evenOddThreshold / 100) {
                  shouldExecute = true;
                  confidenceForStake = evenOddStats.probEven > 0.8 ? 'MUITO_ALTA' : 'ALTA';
                  executionParams = ['DIGITEVEN', undefined, pilotKey];
                  contractTypeForStake = 'DIGITEVEN';
               } else if ((1 - evenOddStats.probEven) > evenOddThreshold / 100) {
                  shouldExecute = true;
                  confidenceForStake = (1 - evenOddStats.probEven) > 0.8 ? 'MUITO_ALTA' : 'ALTA';
                  executionParams = ['DIGITODD', undefined, pilotKey];
                  contractTypeForStake = 'DIGITODD';
               }
               break;
            case 'underdog':
               const coldestDigitStat = underdogDigitStats.length > 0 ? [...underdogDigitStats].sort((a, b) => a.probability - b.probability)[0] : null;
               if (coldestDigitStat && coldestDigitStat.probability <= (underdogThreshold / 100)) {
                   shouldExecute = true;
                   confidenceForStake = 'ALTA';
                   contractTypeForStake = isUnderdogInverse ? 'DIGITDIFF' : 'DIGITMATCH';
                   executionParams = [contractTypeForStake, coldestDigitStat.digit, pilotKey];
               }
               break;
            case 'underdogOverUnder':
               if (overUnderStats.probOver4 < overUnderUnderdogThreshold / 100) {
                   shouldExecute = true; confidenceForStake = 'ALTA'; executionParams = ['DIGITOVER', 4, pilotKey]; contractTypeForStake = 'DIGITOVER';
               } else if (overUnderStats.probUnder5 < overUnderUnderdogThreshold / 100) {
                   shouldExecute = true; confidenceForStake = 'ALTA'; executionParams = ['DIGITUNDER', 5, pilotKey]; contractTypeForStake = 'DIGITUNDER';
               }
               break;
            case 'dynamicUnderdogOverUnder':
                const underdogBlock = multiWindowAnalysis?.coldestConsensusDigit;
                if (underdogBlock !== undefined) {
                    shouldExecute = true; confidenceForStake = 'ALTA';
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
                    shouldExecute = true; confidenceForStake = 'ALTA'; executionParams = ['DIGITEVEN', undefined, pilotKey]; contractTypeForStake = 'DIGITEVEN';
                } else if (1 - evenOddStats.probEven < evenOddUnderdogThreshold / 100) {
                    shouldExecute = true; confidenceForStake = 'ALTA'; executionParams = ['DIGITODD', undefined, pilotKey]; contractTypeForStake = 'DIGITODD';
                }
                break;
          }

          if (shouldExecute && executionParams) {
              const pilotKeyForStake = executionParams[2] as PilotType;
              const pilotForStake = pilots[pilotKeyForStake];
              const stakeConfig: SmartMartingaleConfig = { 
                  isEnabled: isMartingaleEnabled, baseStake: BASE_STAKE, maxMartingaleLevels: maxLosses, 
                  martingaleMultiplier: martingaleRecoveryFactor, useAntiMartingale: false, isSmart: isSmartMartingale,
              };
              const stakeDecision = decideNextStake(pilotForStake.tradeHistory, stakeConfig, bankrollState, contractTypeForStake, confidenceForStake);

              if (stakeDecision.shouldPause) {
                setPilots(prev => ({ ...prev, [pilotKeyForStake]: { ...prev[pilotKeyForStake], status: 'CIRCUIT_BREAKER', currentTarget: stakeDecision.pauseReason || 'Limite de risco atingido' }}));
                continue;
              }

              const finalStake = stakeDecision.nextStake;

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
      dailyBalance, dailyTarget, maxLosses, martingaleRecoveryFactor, sessionInitialBankroll, accountBalance.balance, dailyPnl,
      overUnderStats, evenOddStats, overUnderThreshold, evenOddThreshold, underdogThreshold, isUnderdogInverse, overUnderUnderdogThreshold, evenOddUnderdogThreshold,
      executionCooldown, isMartingaleEnabled, isSmartMartingale, analysisResults.mainWindowStats, multiWindowAnalysis, digitStats,
      cooldownTime, consensusThreshold, underdogDigitStats, onVagalumeTradeCompleted, vagalumeConfig, vagalumeSignal
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
            if (strategyDef.id === 'vagalume') return;
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
          if (strategyDef.id === 'vagalume') continue;
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
    resetSession,
    multiWindowAnalysis,
    signalQuality,
    shouldTrade,
    // Vagalume
    vagalumeSignal,
    vagalumeConfig,
    setVagalumeConfig,
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
  };
}

const getDecimalPlaces = (pipSize: number | undefined): number => {
    if (pipSize === undefined || pipSize === null || pipSize <= 0) return 2;
    if (Math.floor(pipSize) === pipSize && pipSize >= 1) return 0;
    const pipString = String(pipSize);
    if (pipString.includes('.')) return pipString.split('.')[1].length;
    return 0;
};
```
- src/lib/types/trading.types.ts:
<content><![CDATA[// /src/lib/types/trading.types.ts
import { z } from 'zod';
import type { TimePeriod } from '.';

export type MarketRegime = 
  | 'trending_bull'
  | 'trending_bear'
  | 'ranging'
  | 'high_volatility'
  | 'breakout';

export type StrategyType =
  | 'HF_MEAN_REVERSION'
  | 'STD_TREND_FOLLOW'
  | 'BOLLINGER_SQUEEZE'
  | 'VOLUME_ABSORPTION'
  | 'MICROSTRUCTURE_SCALP'
  | 'GBM_20S'
  | 'GBM_40S';
  
export interface MicrostructureFeatures {
  spreadPercentage: number;
  volumeImbalance: number;
  tickVelocity: number;
  priceAcceleration: number;
  parkinsonVolatility: number;
  yangZhangVolatility: number;
  gapRatio: number;
  meanReversion: number;
  isSpike: boolean;
  pressure: 'buy' | 'sell' | 'neutral';
  analysis: string;
}

export const OperationSchema = z.object({
  id: z.number(),
  asset: z.string(),
  direction: z.enum(['rise', 'fall']),
  stake: z.number(),
  status: z.enum(['pending', 'won', 'lost']),
  result: z.number().optional(),
  timestamp: z.string().describe("The ISO 8601 timestamp of when the operation was created."),
  initiator: z.string().optional(),
  strategy: z.string().optional(),
  duration: z.number().optional(),
  durationUnit: z.string().optional(),
  entryPrice: z.number().optional(),
  exitPrice: z.number().optional(),
  exitTimestamp: z.string().optional(),
  isSellable: z.boolean().optional(),
  expirationTime: z.number().optional(),
  multiplier: z.number().optional(),
  contractType: z.string().optional(),
  takeProfit: z.number().optional(),
  stopLoss: z.number().optional(),
  trailingStop: z.number().optional(),
  apiStatus: z.enum(['won', 'lost']).optional(),
  validationLog: z.any().optional(),
  executionLatency: z.number().optional(),
});


export const RobotStrategySchema = z.object({
    id: z.string().describe("A unique identifier for the robot, e.g., 'rsi_scalper'."),
    strategyType: z.enum([
        "RSI", 
        "STOCHASTIC", 
        "MOVING_AVERAGE_CROSS", 
        "BOLLINGER_BANDS", 
        "MACD_CROSS",
        "PRICE_ACTION_PATTERN",
        "ADX_TREND",
        "ICHIMOKU_CLOUD",
        "AWESOME_OSCILLATOR",
        "VOLUME_PROFILE",
        "KAMA",
        "VWAP",
        "Z_SCORE",
        "STOCH_RSI",
        "MFI",
        "TRIX",
        "ROC",
        "DONCHIAN_CHANNELS",
        "RVI",
        "PARABOLIC_SAR",
        "CHANDELIER_EXIT",
        "OBV",
    ]).describe("The type of strategy the robot employs."),
    justification: z.string().describe("A brief, one-sentence justification for the robot's parameters, including the timeframe context, e.g., 'Usa RSI curto (5) para scalp em Ticks.'."),
    strongConfidence: z.number().min(0).max(100).describe("The confidence level (0-100) for a strong buy/sell signal."),
    weakConfidence: z.number().min(0).max(100).describe("The confidence level (0-100) for a weak buy/sell signal."),
    
    // RSI, Stochastic, MFI, RVI
    period: z.number().optional().describe("The lookback period for the indicator."),
    strongBuyThreshold: z.number().optional().describe("The threshold for a strong buy signal (e.g., RSI < 20)."),
    weakBuyThreshold: z.number().optional().describe("The threshold for a weak buy signal (e.g., RSI < 30)."),
    strongSellThreshold: z.number().optional().describe("The threshold for a strong sell signal (e.g., RSI > 80)."),
    weakSellThreshold: z.number().optional().describe("The threshold for a weak buy signal (e.g., RSI > 70)."),

    // Moving Averages & MACD
    shortPeriod: z.number().optional().describe("The short period for moving average crosses."),
    longPeriod: z.number().optional().describe("The long period for moving average crosses."),
    fastPeriod: z.number().optional().describe("Fast period for MACD."),
    slowPeriod: z.number().optional().describe("Slow period for MACD."),
    signalPeriod: z.number().optional().describe("Signal period for MACD."),

    // Bollinger Bands
    stdDev: z.number().optional().describe("The number of standard deviations for Bollinger Bands."),

    // Price Action
    pattern: z.enum(['hammer', 'shooting_star']).optional().describe("The specific candle pattern to look for."),

    // ADX
    trendStrengthThreshold: z.number().optional().describe("The ADX level above which a strong trend is considered present."),
    
    // Volume Profile
    profileBars: z.number().optional().describe("Number of bars to use for the volume profile calculation."),

    // KAMA
    fastEnd: z.number().optional(),
    slowEnd: z.number().optional(),

    // Z-Score
    zScoreThreshold: z.number().optional(),

    // Parabolic SAR
    acceleration: z.number().optional(),
    maxAcceleration: z.number().optional(),

    // Chandelier Exit
    multiplier: z.number().optional(),
    chandelierPeriod: z.number().optional(),
    chandelierMultiplier: z.number().optional(),
    
    // AutoTrader specific
    suggestedStake: z.number().describe("The suggested stake amount for this trade, based on risk analysis. Should be a percentage of the balance, e.g., 1-2%."),
    
    // DYNAMIC DURATION
    optimalDuration: z.number().describe("The optimal duration for this specific strategy."),
    optimalDurationUnit: z.enum(['t', 's', 'm', 'h', 'd']).describe("The optimal duration unit for this strategy."),
});
export type RobotStrategy = z.infer<typeof RobotStrategySchema>;


export const TradeHistoryEventSchema = z.object({
  profit: z.number(),
  regime: z.string().optional(), // Tornar opcional para compatibilidade
  timestamp: z.number(),
});
export type TradeHistoryEvent = z.infer<typeof TradeHistoryEventSchema>;

export const BayesianVoteSchema = z.object({
    vote: z.enum(['RISE', 'FALL', 'HOLD']),
    reason: z.string().describe("Justificativa técnica para o voto, ex: 'RSI (28.5) < 30' ou 'Cruzamento de Médias'"),
    rawConfidence: z.number().describe("Confiança bruta do sinal técnico (0-100)"),
    calibratedConfidence: z.number().describe("Confiança calibrada via Platt Scaling (0-1)"),
    bayesianProbability: z.number().describe("Probabilidade posterior do voto ser correto (0-1)"),
    weight: z.number().describe("Peso final do voto no consenso, ajustado por meritocracia."),
    optimalDuration: z.number(),
    optimalDurationUnit: z.enum(['t', 's', 'm', 'h', 'd']),
    suggestedStake: z.number(),
    regime: z.string(), // Mantido como string para flexibilidade
    sharpeRatio: z.number().optional().describe("O Sharpe Ratio do robô no momento do voto."),
    strategy: RobotStrategySchema.optional().describe("Snapshot da configuração da estratégia no momento do voto."),
});
export type BayesianVote = z.infer<typeof BayesianVoteSchema>;


export interface EnhancedRobotPerformance {
  id: string;
  strategyType: RobotStrategy['strategyType'];
  strategy: RobotStrategy;
  wins: number;
  losses: number;
  totalProfit: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  kellyFraction: number;
  effectiveRegimes: MarketRegime[];
  monteCarloScore: number;
  lastUpdated: number;
  tradeHistory: TradeHistoryEvent[];
  status?: 'Probation' | 'Certified';
}

// Schema for a snapshot of all indicators at a given time
export const IndicatorsSchema = z.object({
  rsi: z.number().nullable(),
  stoch: z.number().nullable(),
  atr: z.number().nullable(),
  atrSeries: z.array(z.number().nullable()),
  adx: z.number().nullable(),
  adxSeries: z.array(z.number().nullable()),
  pdi: z.number().nullable(),
  ndi: z.number().nullable(),
  macd: z.object({
    macd: z.number().nullable(),
    signal: z.number().nullable(),
    histogram: z.number().nullable(),
  }),
  ma: z.object({
    short: z.number().nullable(),
    long: z.number().nullable(),
  }),
  sma: z.array(z.number().nullable()),
  ema: z.array(z.number().nullable()),
  vwap: z.array(z.number().nullable()),
  bb: z.object({
    upper: z.number().nullable(),
    middle: z.number().nullable(),
    lower: z.number().nullable(),
  }),
  bollingerBands: z.array(z.object({ upper: z.number(), middle: z.number(), lower: z.number() }).nullable()),
  donchian: z.object({
    upper: z.number().nullable(),
    lower: z.number().nullable(),
  }).nullable(),
  kama: z.number().nullable(),
  bbw: z.number().nullable(), // Bollinger Bandwidth
  bbwSeries: z.array(z.number().nullable()),
  stochRSI: z.number().nullable(),
  zScore: z.number().nullable(),
  ao: z.number().nullable(),
  aoPrev: z.number().nullable(),
  trix: z.number().nullable(),
  trixPrev: z.number().nullable(),
  roc: z.number().nullable(),
  psar: z.number().nullable(),
  ichimoku: z.object({
    tenkan: z.number().nullable(),
    kijun: z.number().nullable(),
    spanA: z.number().nullable(),
    spanB: z.number().nullable(),
  }).nullable(),
  mfi: z.number().nullable(),
  obv: z.number().nullable(),
  obvPrev: z.number().nullable(),
  chandelier: z.object({
    exitLong: z.number().nullable(),
    exitShort: z.number().nullable(),
  }).nullable(),
  rvi: z.number().nullable(),
  volSma: z.array(z.number().nullable()).optional(),
});
export type Indicators = z.infer<typeof IndicatorsSchema>;

export const RobotVoteSchema = z.object({
  vote: z.enum(['RISE', 'FALL', 'HOLD']),
  confidence: z.number(),
  weight: z.number(),
  suggestedStake: z.number(),
  optimalDuration: z.number(),
  optimalDurationUnit: z.enum(['t', 's', 'm', 'h', 'd']),
  reason: z.string(),
});
export type RobotVote = z.infer<typeof RobotVoteSchema>;

export type CouncilVotes = Record<string, RobotVote>;

export const VirtualTradeLogSchema = z.object({
    robotId: z.string(),
    robotType: z.string(),
    vote: z.enum(['RISE', 'FALL']),
    entryPrice: z.number(),
    entryEpoch: z.number(),
    exitEpoch: z.number(),
});
export type VirtualTradeLog = z.infer<typeof VirtualTradeLogSchema>;

export const TradeDecisionLogSchema = z.object({
  id: z.string(),
  contractId: z.number().optional(),
  timestamp: z.string(),
  asset: z.string(),
  timePeriod: z.custom<TimePeriod>(),
  tradeParams: z.object({
    direction: z.enum(['RISE', 'FALL', 'HOLD']),
    stake: z.number(),
    duration: z.number(),
    durationUnit: z.enum(['t', 's', 'm', 'h', 'd']),
  }),
  context: z.object({
    marketRegime: z.string(),
    regimeConfidence: z.number(),
    microstructure: z.custom<MicrostructureFeatures | null>().nullable(),
    indicators: IndicatorsSchema.nullable(),
    supervisionReason: z.string().optional(),
    payout: z.number().optional(),
    entryPrice: z.number().optional(),
    exitPrice: z.number().optional(),
  }),
  consensus: z.object({
    bayesianProbability: z.number().optional(),
    kellyStake: z.number().optional(),
    consensusSum: z.object({rise: z.number(), fall: z.number()}).optional(),
    consensusThreshold: z.number().optional(),
    activeRobots: z.number(),
    votes: z.record(z.string(), z.union([RobotVoteSchema, BayesianVoteSchema])),
    virtualTrades: z.array(VirtualTradeLogSchema).optional(),
  }),
  result: z.enum(['pending', 'won', 'lost', 'hold']),
  pnl: z.number(),
  processed: z.boolean().optional(),
});
export type TradeDecisionLog = z.infer<typeof TradeDecisionLogSchema>;

export const AssertivenessSnapshotEntrySchema = z.object({
  horizon: z.string(),
  accuracy: z.number(),
  vote: z.enum(['RISE', 'FALL', 'HOLD']),
});
export type AssertivenessSnapshotEntry = z.infer<typeof AssertivenessSnapshotEntrySchema>;

export const PredictiveTradeLogSchema = z.object({
  id: z.string(),
  contractId: z.number(),
  timestamp: z.string(),
  asset: z.string(),
  tradeParams: z.object({
    direction: z.enum(['RISE', 'FALL', 'HOLD']),
    stake: z.number(),
    duration: z.number(),
    durationUnit: z.enum(['t', 's', 'm', 'h', 'd']),
  }),
  context: z.object({
    triggerReason: z.string(),
    assertivenessSnapshot: z.array(AssertivenessSnapshotEntrySchema),
  }),
  result: z.enum(['pending', 'won', 'lost']),
  pnl: z.number(),
});
export type PredictiveTradeLog = z.infer<typeof PredictiveTradeLogSchema>;

export const RobotPerformanceSchema = z.object({
    id: z.string(),
    strategyType: z.string(),
    strategy: RobotStrategySchema,
    wins: z.number(),
    losses: z.number(),
    totalProfit: z.number(),
    winRate: z.number().optional(),
    winRateTrend: z.number().optional(),
    winRateRange: z.number().optional(),
    sharpeRatio: z.number().optional(),
    tradeHistory: z.array(TradeHistoryEventSchema).optional(),
    status: z.enum(['Probation', 'Certified']).default('Probation').optional(),
});
export type RobotPerformance = z.infer<typeof RobotPerformanceSchema>;

export const AssetProfileV1Schema = z.object({
  id: z.string(), // asset symbol will be the id
  assetSymbol: z.string(),
  lastAnalyzed: z.string(),
  notes: z.string().optional(),
  preferredRegime: z.enum(['TRENDING', 'RANGING', 'NEUTRAL']).optional(),
  optimalConsensusThreshold: z.number().optional(),
});
export type AssetProfileV1 = z.infer<typeof AssetProfileV1Schema>;

export interface TradeResult {
  success: boolean;
  message: string;
  contractId?: number;
  entryPrice?: number;
}

const DurationUnitSchema = z.enum(['t', 's', 'm', 'h', 'd']);
export type DurationUnit = z.infer<typeof DurationUnitSchema>;

export const baseRiseFallSchema = z.object({
  stake: z.coerce.number().min(0.35, "O valor mínimo é $0.35."),
  duration: z.coerce.number().min(1, "A duração deve ser de pelo menos 1."),
  duration_unit: DurationUnitSchema,
  allowEquals: z.boolean().default(false),
});

// --- NOVAS INTERFACES PARA BACKTESTING INSTITUCIONAL ---

export interface ExecutionModel {
  spread: number;
  slippage: number;
  rejectionRate: number;
  latencyMs: number;
}

export interface InstitutionalBacktestResult {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  trades: TradeResult[];
  note?: string;
  metrics: {
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    maxDrawdown: number;
    maxDrawdownDuration: number;
    volatility: number;
    profitFactor: number;
    expectancy: number;
    avgWin: number;
    avgLoss: number;
    largestWin: number;
    largestLoss: number;
    consecutiveWins: number;
    consecutiveLosses: number;
    winStreakAvg: number;
    lossStreakAvg: number;
    avgTradeDuration: number;
    avgHoldingTimeMinutes: number;
    tradesPerDay: number;
    avgSpreadCost: number;
    avgSlippage: number;
    rejectionRate: number;
  };
  equityCurve: Array<{ candle: number; equity: number; drawdown: number; }>;
  monthlyPerformance: Array<{ month: string; trades: number; pnl: number; winRate: number; }>;
}

export interface WalkForwardResult {
  inSample: InstitutionalBacktestResult;
  outOfSample: InstitutionalBacktestResult;
  degradation: {
    sharpeRatio: number;
    winRate: number;
    profitFactor: number;
  };
  isRobust: boolean;
}

export interface MonteCarloResult {
  scenarios: InstitutionalBacktestResult[];
  statistics: {
    meanSharpe: number;
    stdDevSharpe: number;
    percentile5: number;
    percentile50: number;
    percentile95: number;
  };
  probabilityOfProfit: number;
  valueAtRisk95: number;
}
