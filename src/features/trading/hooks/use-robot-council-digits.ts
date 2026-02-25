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
import { 
    calibrateStrategyGridSearch, 
    STRATEGY_SEARCH_SPACES,
} from '@/features/trading/optimization/digits-calibration-engine';
import { runDigitsBacktest, type BacktestSummary } from '@/features/trading/backtest/digits-backtest-engine';
import { STRATEGY_DEFINITIONS, type GlobalRiskConfig, type MartingaleConfig, strategyLabels } from '@/app/deriv-trader-digits/strategies-config';
import { loadHistoricalTicksForDigits } from '@/services/digits-data-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useVagalumeAlternante, type VagalumeConfig, type VagalumeSignal, type DigitContractType } from './use-vagalume-alternante';


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
      maxStreak: 2, stateW1_matchThreshold: 8, stateL1_differsThreshold: 15,
      resetMultiplier: 1.2, pauseAfterFailedResets: 2, kellyFraction: 0.25
  });
  
  // --- GESTÃO DE RISCO AVANÇADA (MARTINGALE) ---
  const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(true);
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
    const windowSizes = [200, 500, 1000];
    if (!priceTicks || priceTicks.length < 200) {
      return { windowsStats: [], mainWindowStats: null };
    }
    const windowsStats = windowSizes.map(size => calculateDigitStatsForWindow(priceTicks, size, decimalPlaces));
    const mainWindowStats = windowsStats.find(w => w.windowSize === 1000) || windowsStats[windowsStats.length - 1];
    return { windowsStats, mainWindowStats };
  }, [priceTicks, decimalPlaces]);
  
  const digitStats = useMemo(() => analysisResults.mainWindowStats?.frequencies || [], [analysisResults.mainWindowStats]);

  const underdogDigitStats = useMemo(() => {
    if (!priceTicks || priceTicks.length < 100) return [];
    return calculateDigitStatsForWindow(priceTicks, 100, decimalPlaces).frequencies;
  }, [priceTicks, decimalPlaces]);

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
    const allTrades = Object.values(pilots).flatMap(p => p.tradeHistory);
    return allTrades.reduce((sum, trade) => {
        const profit = trade.result || 0;
        return sum + (profit > 0 ? profit : -trade.stake);
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
            const newLosses = (lastOp.result || 0) < 0 ? pilotToUpdate.consecutiveLosses + 1 : 0;
            const newAccumulatedLoss = (lastOp.result || 0) < 0 ? pilotToUpdate.accumulatedLoss + Math.abs(lastOp.result || -lastOp.stake) : 0;
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

    // --- HIERARQUIA DE EXECUÇÃO: Vagalume primeiro ---
    const vagalumePilot = pilots.vagalume;
    if (vagalumePilot.isOn && vagalumePilot.status !== 'PAUSED' && vagalumePilot.activeContractId === null && vagalumeSignal) {
        tradeExecutedThisCycle = true; // Vagalume sempre tem prioridade, mesmo que decida não operar

        if (vagalumeSignal.shouldTrade) {
            const confidenceForStake: ConfidenceLevel = vagalumeSignal.confidence > 0.8 ? 'MUITO_ALTA' : 'ALTA';
            const initialBankroll = sessionInitialBankroll ?? (accountBalance.balance ?? 1000);
            const currentBankroll = initialBankroll + dailyPnl;
            const bankrollState: BankrollState = { currentBankroll, initialBankroll, maxDailyLoss: dailyBalance, dailyProfitTarget: dailyTarget };
            const stakeConfig: SmartMartingaleConfig = { 
                isEnabled: isMartingaleEnabled, baseStake: BASE_STAKE, maxMartingaleLevels: maxLosses, 
                martingaleMultiplier: martingaleRecoveryFactor, useAntiMartingale: false, isSmart: isSmartMartingale,
            };
            const stakeDecision = decideNextStake(vagalumePilot.tradeHistory, stakeConfig, bankrollState, confidenceForStake);

            if (!stakeDecision.shouldPause) {
                const finalStake = stakeDecision.nextStake * vagalumeSignal.suggestedStakeMultiplier;
                
                executeTrade(vagalumeSignal.suggestedContract, finalStake, activeSymbol!, 1, 't', 'Piloto', vagalumeSignal.suggestedDigit, 'vagalume')
                  .then(tradeResult => {
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
    
    // Se o Vagalume não executou um trade, avalia os outros
    if (!tradeExecutedThisCycle) {
        for (const [key, pilot] of activePilotEntries) {
          if (tradeExecutedThisCycle) break; 
          
          const pilotKey = key as PilotType;
          if (pilotKey === 'vagalume') continue;

          if (pilot.status !== 'TRADING' || pilot.activeContractId !== null) continue;
          
          const initialBankroll = sessionInitialBankroll ?? (accountBalance.balance ?? 1000);
          const currentBankroll = initialBankroll + dailyPnl;
          
          const bankrollState: BankrollState = { currentBankroll, initialBankroll, maxDailyLoss: dailyBalance, dailyProfitTarget: dailyTarget };
          
          let shouldExecute = false;
          let executionParams: [DigitContractType, number?, string?, number?] | null = null;
          let confidenceForStake: ConfidenceLevel = 'NULA';
          
          switch (pilotKey) {
            case 'matchesDiffers':
              if (shouldTrade && councilDecision.differs !== null) {
                  shouldExecute = true;
                  confidenceForStake = signalQuality!.confidenceLevel;
                  executionParams = ['DIGITDIFF', councilDecision.differs, pilotKey];
              }
              break;
            case 'overUnder':
              if (overUnderStats.probOver4 > overUnderThreshold / 100) {
                  shouldExecute = true;
                  confidenceForStake = overUnderStats.probOver4 > 0.8 ? 'MUITO_ALTA' : 'ALTA';
                  executionParams = ['DIGITOVER', 4, pilotKey];
              } else if (overUnderStats.probUnder5 > overUnderThreshold / 100) {
                  shouldExecute = true;
                  confidenceForStake = overUnderStats.probUnder5 > 0.8 ? 'MUITO_ALTA' : 'ALTA';
                  executionParams = ['DIGITUNDER', 5, pilotKey];
              }
              break;
            case 'evenOdd':
               if (evenOddStats.probEven > evenOddThreshold / 100) {
                  shouldExecute = true;
                  confidenceForStake = evenOddStats.probEven > 0.8 ? 'MUITO_ALTA' : 'ALTA';
                  executionParams = ['DIGITEVEN', undefined, pilotKey];
               } else if ((1 - evenOddStats.probEven) > evenOddThreshold / 100) {
                  shouldExecute = true;
                  confidenceForStake = (1 - evenOddStats.probEven) > 0.8 ? 'MUITO_ALTA' : 'ALTA';
                  executionParams = ['DIGITODD', undefined, pilotKey];
               }
               break;
            case 'underdog':
               const coldestDigitStat = underdogDigitStats.length > 0 ? [...underdogDigitStats].sort((a, b) => a.probability - b.probability)[0] : null;
               if (coldestDigitStat && coldestDigitStat.probability <= (underdogThreshold / 100)) {
                   shouldExecute = true;
                   confidenceForStake = 'ALTA';
                   executionParams = [isUnderdogInverse ? 'DIGITDIFF' : 'DIGITMATCH', coldestDigitStat.digit, pilotKey];
               }
               break;
            case 'underdogOverUnder':
               if (overUnderStats.probOver4 < overUnderUnderdogThreshold / 100) {
                   shouldExecute = true; confidenceForStake = 'ALTA'; executionParams = ['DIGITOVER', 4, pilotKey];
               } else if (overUnderStats.probUnder5 < overUnderUnderdogThreshold / 100) {
                   shouldExecute = true; confidenceForStake = 'ALTA'; executionParams = ['DIGITUNDER', 5, pilotKey];
               }
               break;
            case 'dynamicUnderdogOverUnder':
                const underdogBlock = multiWindowAnalysis?.coldestConsensusDigit;
                if (underdogBlock !== undefined) {
                    shouldExecute = true; confidenceForStake = 'ALTA';
                    if (underdogBlock > 4) executionParams = ['DIGITOVER', 4, pilotKey];
                    else executionParams = ['DIGITUNDER', 5, pilotKey];
                }
                break;
            case 'underdogEvenOdd':
                if (evenOddStats.probEven < evenOddUnderdogThreshold / 100) {
                    shouldExecute = true; confidenceForStake = 'ALTA'; executionParams = ['DIGITEVEN', undefined, pilotKey];
                } else if (1 - evenOddStats.probEven < evenOddUnderdogThreshold / 100) {
                    shouldExecute = true; confidenceForStake = 'ALTA'; executionParams = ['DIGITODD', undefined, pilotKey];
                }
                break;
          }

          if (shouldExecute && executionParams) {
              const stakeMultiplier = executionParams[3] as number | undefined ?? 1.0;
              const pilotKeyForStake = executionParams[2] as PilotType;
              const pilotForStake = pilots[pilotKeyForStake];
              const stakeConfig: SmartMartingaleConfig = { 
                  isEnabled: isMartingaleEnabled, baseStake: BASE_STAKE, maxMartingaleLevels: maxLosses, 
                  martingaleMultiplier: martingaleRecoveryFactor, useAntiMartingale: false, isSmart: isSmartMartingale,
              };
              const stakeDecision = decideNextStake(pilotForStake.tradeHistory, stakeConfig, bankrollState, confidenceForStake);

              if (stakeDecision.shouldPause) {
                setPilots(prev => ({ ...prev, [pilotKeyForStake]: { ...prev[pilotKeyForStake], status: 'CIRCUIT_BREAKER', currentTarget: stakeDecision.pauseReason || 'Limite de risco atingido' }}));
                continue;
              }

              const finalStake = stakeDecision.nextStake * stakeMultiplier;

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
            toast({ title: "Dados Insuficientes", description: `Apenas ${ticks.length} ticks encontrados. São necessários pelo menos 1000. Deixe o app aberto para coletar mais.`, variant: "destructive" });
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
