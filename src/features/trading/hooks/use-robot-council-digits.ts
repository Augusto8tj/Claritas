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
    type CalibrationResult
} from '@/features/trading/optimization/digits-calibration-engine';
import { runDigitsBacktest, type BacktestSummary } from '@/features/trading/backtest/digits-backtest-engine';
import { STRATEGY_DEFINITIONS, type GlobalRiskConfig, type MartingaleConfig } from '@/app/deriv-trader-digits/strategies-config';
import { loadHistoricalTicksForDigits } from '@/services/digits-data-service';
import { useAuth } from '@/features/auth/hooks/use-auth';

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
    activeContractId: number | null; 
}

export interface StrategyBacktestResult extends BacktestSummary {
  strategyId: PilotType;
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

  const underdogDigitStats = useMemo(() => {
    const decimalPlaces = getDecimalPlaces(activeAsset?.pip);
    if (!priceTicks || priceTicks.length < 100) {
      return [];
    }
    return calculateDigitStatsForWindow(priceTicks, 100, decimalPlaces).frequencies;
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

  const overUnderStats = useMemo(() => {
    if (!analysisResults.mainWindowStats) return { probOver4: 0, probUnder5: 0 };
    const stats = analysisResults.mainWindowStats.frequencies;
    const probOver4 = stats.filter(s => s.digit > 4).reduce((sum, s) => sum + s.probability, 0);
    const probUnder5 = stats.filter(s => s.digit < 5).reduce((sum, s) => sum + s.probability, 0);
    return { probOver4, probUnder5 };
  }, [analysisResults.mainWindowStats]);

  const evenOddStats = useMemo(() => {
    if (!analysisResults.mainWindowStats) return { probEven: 0 };
    const stats = analysisResults.mainWindowStats.frequencies;
    const probEven = stats.filter(s => s.digit % 2 === 0).reduce((sum, s) => sum + s.probability, 0);
    return { probEven };
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
    const activePilotEntries = Object.entries(pilots).filter(([, p]) => p.isOn);
    if (activePilotEntries.length === 0) return;

    executionRef.current = true;
    
    const lastOp = operationsLog.length > 0 ? operationsLog[0] : null;
    if (lastOp && lastOp.id !== lastProcessedOpIdRef.current && lastOp.status !== 'pending') {
      lastProcessedOpIdRef.current = lastOp.id;
      
      const pilotKey = lastOp.strategy as PilotType;
      const owningPilot = Object.values(pilots).find(p => p.activeContractId === lastOp.id);
      
      if (pilotKey && pilots[pilotKey] && owningPilot) {
        const pilot = pilots[pilotKey];
        const newTradeResult: StakeManagerTradeResult = {
            id: String(lastOp.id),
            timestamp: new Date(lastOp.timestamp).getTime(),
            stake: lastOp.stake,
            profit: lastOp.result || -lastOp.stake,
            contractType: lastOp.contractType as any,
            signalConfidence: 'ALTA' 
        };
        
        const updatedHistory = [...pilot.tradeHistory, newTradeResult];
        const newLosses = newTradeResult.profit < 0 ? pilot.consecutiveLosses + 1 : 0;
        const newAccumulatedLoss = newTradeResult.profit < 0 ? pilot.accumulatedLoss + Math.abs(newTradeResult.profit) : 0;

        const newStatus: AutopilotStatus = newLosses >= maxLosses ? 'CIRCUIT_BREAKER' : 'COOLDOWN';

        setPilots(prev => ({
            ...prev,
            [pilotKey]: {
                ...pilot,
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
              if (prev[pilotKey]?.status === 'COOLDOWN') {
                return { ...prev, [pilotKey]: { ...prev[pilotKey], status: 'TRADING' } };
              }
              return prev;
            });
          }, cooldownTime * 1000);
        }
      }
    }

    const now = Date.now();
    if (now - lastExecutionTimestampRef.current < executionCooldown * 1000) {
      executionRef.current = false;
      return; 
    }

    let tradeExecutedThisCycle = false;

    for (const [key, pilot] of activePilotEntries) {
      if (tradeExecutedThisCycle) break; 
      
      const pilotKey = key as PilotType;
      if (pilot.status !== 'TRADING' || pilot.activeContractId !== null) continue;
      
      const initialBankroll = sessionInitialBankroll ?? (accountBalance.balance ?? 1000);
      const currentBankroll = initialBankroll + dailyPnl;
      
      const bankrollState: BankrollState = { currentBankroll, initialBankroll, maxDailyLoss: dailyBalance, dailyProfitTarget: dailyTarget };
      
      let shouldExecute = false;
      let executionParams: [DigitContractType, number?, string?] | null = null;
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
          const stakeConfig: SmartMartingaleConfig = { 
              isEnabled: isMartingaleEnabled,
              baseStake: BASE_STAKE, 
              maxMartingaleLevels: maxLosses, 
              martingaleMultiplier: martingaleRecoveryFactor,
              useAntiMartingale: false,
              isSmart: isSmartMartingale,
          };
          const stakeDecision = decideNextStake(pilot.tradeHistory, stakeConfig, bankrollState, confidenceForStake);

          if (stakeDecision.shouldPause) {
            setPilots(prev => ({ ...prev, [pilotKey]: { ...prev[pilotKey], status: 'CIRCUIT_BREAKER', currentTarget: stakeDecision.pauseReason || 'Limite de risco atingido' }}));
            continue;
          }

          executeTrade(executionParams[0], stakeDecision.nextStake, activeSymbol!, 1, 't', 'Piloto', executionParams[1], executionParams[2])
            .then(tradeResult => {
                if (tradeResult.success && tradeResult.contractId) {
                    setPilots(prev => ({
                        ...prev,
                        [pilotKey]: { ...prev[pilotKey], activeContractId: tradeResult.contractId! }
                    }));
                }
            });
          tradeExecutedThisCycle = true;
      }
    }
    
    if (tradeExecutedThisCycle) {
      lastExecutionTimestampRef.current = now;
    }
    
    executionRef.current = false;
  }, [
      priceTicks, pilots, operationsLog, signalQuality, shouldTrade, councilDecision, executeTrade, activeSymbol, toast, 
      dailyBalance, dailyTarget, maxLosses, martingaleRecoveryFactor, sessionInitialBankroll, accountBalance.balance, dailyPnl,
      overUnderStats, evenOddStats, overUnderThreshold, evenOddThreshold, underdogThreshold, isUnderdogInverse, overUnderUnderdogThreshold, evenOddUnderdogThreshold,
      executionCooldown, isMartingaleEnabled, isSmartMartingale, analysisResults.mainWindowStats, multiWindowAnalysis, digitStats,
      cooldownTime, consensusThreshold, underdogDigitStats
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
            try {
                const { summary } = runDigitsBacktest(ticksForBacktest, {
                    strategy: strategyDef,
                    initialBankroll: 100,
                    stakePerTrade: 1,
                    maxTrades: 200,
                    paramsOverride: currentParams,
                });
                results[strategyDef.id] = { ...summary, strategyId: strategyDef.id };
            } catch (e) {
                console.error(`Backtest para ${strategyDef.name} falhou:`, e);
            }
        });

        setBacktestResults(results);
        setIsBacktesting(false);
        toast({ title: "Backtest Concluído!" });
    }, 50); 
  }, [backtestTicks, toast, consensusThreshold, overUnderThreshold, evenOddThreshold, underdogThreshold, isUnderdogInverse, overUnderUnderdogThreshold, evenOddUnderdogThreshold]);

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
          const searchSpaces = STRATEGY_SEARCH_SPACES[strategyDef.id];
          if (!searchSpaces || searchSpaces.length === 0) continue;
          
          const calibrationConfig = {
            strategyDef,
            searchSpaces,
            backtestConfigBase: { initialBankroll: 100, stakePerTrade: 1, maxTrades: 500 }
          };
          
          const result = calibrateStrategyGridSearch(ticks, calibrationConfig);
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

  }, [isCalibrating, backtestTicks, toast]);

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
- `src/features/trading/components/deriv-trader/digits-backtest-panel.tsx` is being replaced by `src/features/trading/components/deriv-trader/DigitsOptimizationPanel.tsx`. So I will provide the new file and delete the old one. This is better done as a modification of the existing file to avoid dealing with file deletions. I will just replace the content.

Final list of files to change:
- `src/features/trading/hooks/use-robot-council-digits.ts`
- `src/features/trading/components/deriv-trader/digits-backtest-panel.tsx`
- `src/app/deriv-trader-digits/page.tsx`

This should be a complete solution.Com certeza! Você está descrevendo um ciclo completo de otimização: **analisar dados históricos, encontrar os melhores parâmetros e aplicá-los para melhorar a performance futura.** Implementei exatamente este fluxo de trabalho, transformando o "Simulador" em um verdadeiro "Painel de Otimização".

As principais melhorias são:

1.  **Carregamento de Dados Históricos:** Agora há um botão **"Carregar Dados para Análise"**. Ele busca os últimos 5000 ticks que foram salvos em segundo plano, garantindo que a otimização seja feita com um conjunto de dados robusto e consistente.
2.  **Motor de Calibração Completo:** O botão **"Iniciar Otimização"** agora executa o motor de calibração que testa *centenas de combinações de parâmetros* para cada estratégia. Ele usa uma métrica de "Qualidade" que prioriza o lucro ajustado ao risco (Sharpe Ratio), evitando configurações que parecem lucrativas mas são muito arriscadas.
3.  **Resultados Claros e Comparativos:** Após a calibração, a interface exibe uma tabela detalhada mostrando a performance *antes* e *depois* da otimização para cada estratégia. Você pode ver claramente o impacto da calibração no Lucro/Prejuízo, Winrate e Sharpe Ratio.
4.  **Aplicação com Um Clique:** O mais importante: um botão **"Aplicar Parâmetros Otimizados"** aparece junto aos resultados. Ao clicar, ele **atualiza instantaneamente todos os sliders de "Ajuste Fino" na interface** com os melhores parâmetros encontrados pela calibração, permitindo que você ative os pilotos automáticos com a configuração mais inteligente e validada.

Com essa implementação, você agora tem um ciclo completo para refinar suas estratégias: **Coletar Dados -> Otimizar -> Analisar -> Aplicar**.

Abaixo estão os arquivos com todas as modificações necessárias para habilitar este novo e poderoso fluxo de trabalho.

<changes>
  <description>Refatorei o painel de simulação de dígitos para um "Painel de Otimização" completo. Ele agora carrega dados históricos do Firestore, executa uma calibração exaustiva (grid search) para encontrar os melhores parâmetros, exibe os resultados de "antes e depois", e permite aplicar os parâmetros otimizados diretamente nas estratégias ativas com um único clique.</description>
  <change>
    <file>/src/app/deriv-trader-digits/page.tsx</file>
    <content><![CDATA[// /src/app/deriv-trader-digits/page.tsx
'use client';

import React from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import DerivTraderInterfaceDigits from "@/features/trading/components/deriv-trader/deriv-trader-interface-digits";
import { AssetSelectorDigits } from "@/features/trading/components/deriv-trader/asset-selector-digits";
import { Skeleton } from "@/components/ui/skeleton";
import { DerivApiProviderDigits, useDerivApiDigits } from "@/features/trading/hooks/use-deriv-api-digits";
import { OperationsLogDigits } from "@/features/trading/components/deriv-trader/operations-log-digits";
import { digitSchema, type DigitFormValues } from "@/features/trading/components/deriv-trader/deriv-trader-interface-digits.types";
import { DigitsAutopilotManager } from "@/features/trading/components/deriv-trader/council-autopilot-interface-digits";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useRobotCouncilDigits } from "@/features/trading/hooks/use-robot-council-digits";
import { ApiStatusIndicatorDigits } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorDigits";
import { DigitStatsChart } from "@/features/trading/components/deriv-trader/digit-stats-chart";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BrainCircuit, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import DigitsDashboard from "@/features/trading/components/deriv-trader/DigitsDashboard";
import { DigitsOptimizationPanel } from "@/features/trading/components/deriv-trader/digits-backtest-panel";
import { setBacktestAssetContext } from '@/features/trading/backtest/digits-backtest-engine';


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

function HeaderDigits() {
    const {
        accountType, 
        setAccountType, 
        accountBalance, 
        isConnecting,
        isAssetsLoading,
        assetGroups,
        activeSymbol,
        setActiveSymbol,
    } = useDerivApiDigits();
    
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left">
                Deriv Digits
            </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div className="flex justify-center">
                    <AssetSelectorDigits
                        selectedAsset={activeSymbol || ""} 
                        onAssetChange={(asset) => setActiveSymbol(asset)} 
                        assetGroups={assetGroups}
                        isAssetsLoading={isAssetsLoading}
                    />
                </div>
                <div className="flex justify-center">
                    <ApiStatusIndicatorDigits />
                </div>
                <div className="flex items-center justify-center md:justify-end gap-4">
                    <ToggleGroup type="single" value={accountType} onValueChange={(value: any) => value && setAccountType(value)} defaultValue="demo" aria-label="Tipo de Conta">
                        <ToggleGroupItem value="demo" aria-label="Usar conta demo">Demo</ToggleGroupItem>
                        <ToggleGroupItem value="real" aria-label="Usar conta real">Real</ToggleGroupItem>
                    </ToggleGroup>
                    <div className="text-right">
                        {accountBalance.loading || isConnecting ? (
                            <div className="space-y-1">
                                <Skeleton className="h-4 w-16" />
                                <Skeleton className="h-5 w-24" />
                            </div>
                        ) : accountBalance.balance !== null ? (
                            <div>
                                <p className="text-xs text-muted-foreground">Saldo:</p>
                                <p className="text-lg font-bold text-foreground leading-tight">
                                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: accountBalance.currency || 'USD' }).format(accountBalance.balance)}
                                </p>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
};

function CurrentPriceDisplay() {
    const { priceTicks, activeAsset } = useDerivApiDigits();
    const lastTick = priceTicks.length > 0 ? priceTicks[priceTicks.length - 1] : null;
    const prevTick = priceTicks.length > 1 ? priceTicks[priceTicks.length - 2] : null;

    if (!lastTick) {
        return (
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="font-headline text-lg">Preço Atual ({activeAsset?.label || 'A carregar...'})</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-center h-32">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </CardContent>
            </Card>
        );
    }
    
    const decimalPlaces = Math.max(2, getDecimalPlaces(activeAsset?.pip));
    const change = prevTick ? lastTick.price - prevTick.price : 0;
    const isUp = change > 0;
    const isDown = change < 0;

    const priceString = lastTick.price.toFixed(decimalPlaces);
    
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="font-headline text-lg">Preço Atual ({activeAsset?.label || 'A carregar...'})</CardTitle>
                <CardDescription>O último preço recebido para o ativo selecionado.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex items-baseline justify-center">
                    <p className="text-5xl font-bold font-mono text-foreground">
                        {priceString.slice(0, -1)}
                        <span className="text-primary">{priceString.slice(-1)}</span>
                    </p>
                </div>
                <div className={cn(
                    "flex items-center justify-center gap-1 text-sm font-semibold mt-1",
                    isUp && "text-green-600",
                    isDown && "text-red-600",
                    !isUp && !isDown && "text-muted-foreground"
                )}>
                    {isUp && <TrendingUp className="h-4 w-4" />}
                    {isDown && <TrendingDown className="h-4 w-4" />}
                    <span>{change.toFixed(decimalPlaces)}</span>
                </div>
            </CardContent>
        </Card>
    );
}

function DerivTraderPageContentDigits() {
    const { 
        activeSymbol, priceTicks, operationsLog, activeAsset, clearActiveContracts, 
    } = useDerivApiDigits();
    
    const robotCouncil = useRobotCouncilDigits(activeSymbol, priceTicks, activeAsset);
    
    React.useEffect(() => {
        setBacktestAssetContext(activeAsset ? { pip: activeAsset.pip || 2 } : null);
    }, [activeAsset]);

    return (
        <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
            <HeaderDigits />
             <Alert className="bg-primary/5 border-primary/10">
                <BrainCircuit className="h-4 w-4 text-primary" />
                <AlertTitle className="text-primary font-headline">Foco em Índices Sintéticos</AlertTitle>
                <AlertDescription className="text-primary/90">
                    Esta plataforma foca-se nos Índices de Volatilidade (Sintéticos) porque a sua geração algorítmica constante permite uma análise estatística mais pura e previsível, livre de ruídos de eventos económicos externos.
                </AlertDescription>
            </Alert>
            
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-6">
                <div className="lg:col-span-2 space-y-6">
                    <CurrentPriceDisplay />
                    <DerivTraderInterfaceDigits symbol={activeSymbol || ""} />
                    <OperationsLogDigits operations={operationsLog} priceTicks={priceTicks} activeAsset={activeAsset} clearActiveContracts={clearActiveContracts} />
                </div>

                <div className="lg:col-span-3 space-y-6">
                    <DigitStatsChart priceTicks={priceTicks} pip={activeAsset?.pip} />
                    <DigitsDashboard 
                        signalQuality={robotCouncil.signalQuality}
                        multiWindowAnalysis={robotCouncil.multiWindowAnalysis}
                    />
                    <DigitsAutopilotManager {...robotCouncil} />
                    <DigitsOptimizationPanel {...robotCouncil} />
                </div>
            </div>
        </div>
    );
}

export default function DerivTraderDigitsPage() {
  const form = useForm<DigitFormValues>({
    resolver: zodResolver(digitSchema),
    defaultValues: {
      stake: 0.35,
      duration: 1,
      duration_unit: "t",
      last_digit_prediction: 5,
    },
  });

  return (
    <DerivApiProviderDigits>
        <FormProvider {...form}>
            <DerivTraderPageContentDigits />
        </FormProvider>
    </DerivApiProviderDigits>
  );
}
