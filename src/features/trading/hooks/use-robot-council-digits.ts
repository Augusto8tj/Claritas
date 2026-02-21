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
    activeContractId: number | null; // NOVO: Rastreia o contrato ativo do piloto
}

const BASE_STAKE = 0.35;

const createInitialPilotState = (): PilotState => ({
    isOn: false,
    status: 'PAUSED',
    currentTarget: null,
    consecutiveLosses: 0,
    accumulatedLoss: 0,
    tradeHistory: [],
    activeContractId: null, // NOVO: Inicializado como nulo
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
  }, [accountBalance.balance, toast, setSessionInitialBankroll]);

  const toggleAutopilot = useCallback((pilotType: PilotType) => {
    let newIsOnState: boolean | undefined;
    setPilots(prev => {
        const pilot = prev[pilotType];
        if (!pilot) return prev;
        newIsOnState = !pilot.isOn;

        if (newIsOnState && sessionInitialBankroll === null) {
            setSessionInitialBankroll(accountBalance.balance ?? 1000);
        }
        
        return {
          ...prev,
          [pilotType]: {
            ...pilot,
            isOn: newIsOnState,
            status: newIsOnState ? 'TRADING' : 'PAUSED'
          }
        };
    });
    
    setTimeout(() => {
        if (newIsOnState !== undefined) {
             toast({ title: `Piloto ${pilotType} ${newIsOnState ? 'Ativado' : 'Desativado'}` });
        }
    }, 0);
  }, [sessionInitialBankroll, accountBalance.balance, toast, setSessionInitialBankroll]);
  
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
                activeContractId: null, // LIBERA O PILOTO
            }
        }));

        if (newStatus === 'COOLDOWN') {
          setTimeout(() => {
            setPilots(prev => {
              if (prev[pilotKey].status === 'COOLDOWN') {
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
          if (overUnderStats.probOver4 > overUnderThreshold) {
              shouldExecute = true;
              confidenceForStake = overUnderStats.probOver4 > 80 ? 'MUITO_ALTA' : 'ALTA';
              executionParams = ['DIGITOVER', 4, pilotKey];
          } else if (overUnderStats.probUnder5 > overUnderThreshold) {
              shouldExecute = true;
              confidenceForStake = overUnderStats.probUnder5 > 80 ? 'MUITO_ALTA' : 'ALTA';
              executionParams = ['DIGITUNDER', 5, pilotKey];
          }
          break;
        case 'evenOdd':
           if (evenOddStats.probEven > evenOddThreshold) {
              shouldExecute = true;
              confidenceForStake = evenOddStats.probEven > 80 ? 'MUITO_ALTA' : 'ALTA';
              executionParams = ['DIGITEVEN', undefined, pilotKey];
           } else if ((100 - evenOddStats.probEven) > evenOddThreshold) {
              shouldExecute = true;
              confidenceForStake = (100 - evenOddStats.probEven) > 80 ? 'MUITO_ALTA' : 'ALTA';
              executionParams = ['DIGITODD', undefined, pilotKey];
           }
           break;
        case 'underdog':
           const coldestDigitStat = digitStats.length > 0 ? [...digitStats].sort((a, b) => a.probability - b.probability)[0] : null;
           if (coldestDigitStat && (coldestDigitStat.probability * 100) <= underdogThreshold) {
               shouldExecute = true;
               confidenceForStake = 'ALTA';
               executionParams = [isUnderdogInverse ? 'DIGITDIFF' : 'DIGITMATCH', coldestDigitStat.digit, pilotKey];
           }
           break;
        case 'underdogOverUnder':
           if (overUnderStats.probOver4 < overUnderUnderdogThreshold) {
               shouldExecute = true; confidenceForStake = 'ALTA'; executionParams = ['DIGITOVER', 4, pilotKey];
           } else if (overUnderStats.probUnder5 < overUnderUnderdogThreshold) {
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
            if (evenOddStats.probEven < evenOddUnderdogThreshold) {
                shouldExecute = true; confidenceForStake = 'ALTA'; executionParams = ['DIGITEVEN', undefined, pilotKey];
            } else if (100 - evenOddStats.probEven < evenOddUnderdogThreshold) {
                shouldExecute = true; confidenceForStake = 'ALTA'; executionParams = ['DIGITODD', undefined, pilotKey];
            }
            break;
      }

      if (shouldExecute && executionParams) {
          const stakeConfig: SmartMartingaleConfig = { 
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
      cooldownTime
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
    resetSession,

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
```
- `src/services/deriv-data-service.ts`
- `src/features/trading/components/deriv-trader/DigitsDashboard.tsx`
- `src/features/trading/components/deriv-trader/council-autopilot-interface-digits.tsx`
- `src/services/financial-data-service-v3.ts`
- `src/features/financials/components/goals/goal-card.tsx`
- `src/features/financials/components/dashboard/main-goal.tsx`
- `src/features/financials/components/dashboard/monthly-balance.tsx`
- `src/features/financials/components/dashboard/net-worth-chart.tsx`
- `src/features/financials/components/dashboard/upcoming-bills.tsx`
- `src/features/trading/hooks/use-deriv-api-accumulators.tsx`
- `src/features/trading/hooks/use-accumulators-council.ts`
- `src/features/trading/hooks/use-time-master.ts`
- `src/features/trading/components/deriv-trader/VirtualArenaAccumulators.tsx`
- `src/features/trading/hooks/use-manual-time-apprentice.ts`
- `src/features/trading/components/deriv-trader/deriv-trader-interface-accumulators.tsx`
- `src/features/trading/components/deriv-trader/operations-log-accumulators.tsx`
- `src/features/trading/hooks/use-multipliers-council.ts`
- `src/features/trading/hooks/use-hf-strike-zone.tsx`
- `src/features/trading/services/hf-strike-logic.ts`
- `src/features/trading/backtest/hf-backtest-engine.ts`
- `src/features/trading/optimization/auto-calibrator.ts`
- `src/features/trading/components/hf-trader/StrategySignalMonitor.tsx`
- `src/features/trading/services/gbm-calibrator.ts`
- `src/app/hf-strike-zone/page.tsx`
- `src/features/trading/components/hf-trader/hf-stats-overview.tsx`
- `src/features/trading/hooks/use-stochastic-models.ts`
- `src/features/trading/services/volatility-forecast.ts`
- `src/features/trading/backtest/backtest-engine.ts`
- `src/app/volatility-analysis/page.tsx`
- `src/features/trading/hooks/use-master-autopilot.ts`
- `src/features/trading/services/predictive-logic.ts`
- `src/app/chat-insights/page.tsx`
- `src/ai/tools/trading-tools.ts`
- `src/app/actions/trading-actions.ts`
- `src/ai/tools/index.ts`
- `src/ai/flows/asset-analysis-flow.ts`
- `src/ai/flows/mql-analyzer-flow.ts`
- `src/ai/flows/operation-analysis-flow.ts`
- `src/ai/tools/financial-tools.ts`
- `src/ai/flows/financial-chatbot-insights.ts`
- `src/ai/dev.ts`
- `src/app/actions/goal-actions.ts`
- `src/app/actions.ts`
- `src/services/financial-data-service.ts`
- `src/app/goals/page.tsx`
- `src/features/financials/components/goals/add-goal-dialog.tsx`
- `src/app/help/page.tsx`
- `src/app/layout.tsx`
- `src/components/layout/app-layout.tsx`
- `src/app/audit-log/page.tsx`
- `src/components/deriv-trader/PredictiveLogViewer.tsx`
- `src/app/actions/audit-log-actions.ts`
- `src/lib/firebase.ts`
- `src/firebase/client-provider.tsx`
- `src/firebase/config.ts`
- `src/firebase/error-emitter.ts`
- `src/firebase/errors.ts`
- `src/firebase/firestore.ts`
- `src/firebase/firestore/index.ts`
- `src/firebase/firestore/use-collection.tsx`
- `src/firebase/firestore/use-doc.tsx`
- `src/firebase/index.ts`
- `src/firebase/non-blocking-updates.tsx`
- `src/firebase/provider.tsx`
- `src/features/auth/hooks/use-auth.tsx`
- `src/components/auth/auth-guard.tsx`
- `src/components/FirebaseErrorListener.tsx`
- `src/features/status/components/firestore-write-test-card.tsx`
- `src/app/portfolio/page.tsx`
- `src/features/trading/components/deriv-trader/OpenPositions.tsx`
- `src/app/page.tsx`
- `src/features/financials/components/dashboard/ai-insight-card.tsx`
- `src/features/financials/components/dashboard/first-transaction-guide.tsx`
- `src/features/financials/components/dashboard/upcoming-bills.tsx`
- `src/features/trading/services/smart-stake-manager-digits.ts`
- `src/app/deriv-trader-digits/page.tsx`
- `src/app/login/page.tsx`
- `src/app/signup/page.tsx`
- `src/app/verify-email/page.tsx`
- `src/components/auth/login-form.tsx`
- `src/components/auth/signup-form.tsx`
- `src/app/profile/page.tsx`
- `src/app/settings/page.tsx`
- `src/components/settings/api-keys-card.tsx`
- `src/features/trading/components/settings/api-keys-card.tsx`
- `src/app/status/page.tsx`
- `src/features/status/components/health-check-card.tsx`
- `src/features/status/components/deriv-connection-card.tsx`
- `src/features/status/components/list-models-card.tsx`
- `src/features/trading/hooks/use-deriv-api-v1.tsx`
- `src/app/deriv-trader/page.tsx`
- `src/features/trading/components/deriv-trader/deriv-trader-interface-v1.tsx`
- `src/features/trading/hooks/use-robot-council-v1.ts`
- `src/features/trading/hooks/use-strategy-evolution-v1.ts`
- `src/features/trading/components/deriv-trader/ai-trade-suggestion-v1.tsx`
- `src/features/trading/components/deriv-trader/asset-intelligence-card.tsx`
- `src/features/trading/components/deriv-trader/hall-of-fame.tsx`
- `src/app/deriv-trader-v2/page.tsx`
- `src/features/trading/hooks/use-deriv-api-v2.tsx`
- `src/features/trading/hooks/use-robot-council-v2.ts`
- `src/features/trading/services/advanced-trading-services.ts`
- `src/features/trading/config/trader-config.ts`
- `src/features/trading/hooks/use-strategy-evolution-v2.ts`
- `src/features/trading/components/deriv-trader/DebugCouncilView-v2.tsx`
- `src/app/deriv-trader-v3/page.tsx`
- `src/features/trading/hooks/use-deriv-api-v3.tsx`
- `src/features/trading/hooks/use-robot-council-v3.ts`
- `src/features/trading/hooks/use-strategy-evolution-v3.ts`
- `src/services/financial-data-service-v3.ts`
- `src/features/trading/components/deriv-trader/evolution-lab-v3.tsx`
- `src/app/deriv-trader-multipliers/page.tsx`
- `src/features/trading/hooks/use-deriv-api-multipliers.tsx`
- `src/features/trading/components/deriv-trader/operations-log-multipliers.tsx`
- `src/features/trading/components/deriv-trader/manage-position-dialog.tsx`
- `src/app/deriv-trader-accumulators/page.tsx`
- `README.md`
- `ARQUITETURA.md`
- `CHANGELOG.md`
- `docs/deriv-trader-v1-architecture.md`
- `docs/deriv-trader-accumulators-architecture.md`
- `docs/deriv-trader-digits-architecture.md`
- `docs/deriv-trader-multipliers-architecture.md`
- `docs/hf-strike-zone-architecture.md`
- `docs/volatility-analysis-architecture.md`
- `src/docs/deriv-trader-accumulators-architecture.md`
- `src/docs/deriv-trader-multipliers-architecture.md`
- `src/docs/master-autopilot-architecture.md`
- `src/docs/volatility-analysis-architecture.md`
- `home/studio-user/Claritas/README.md`
- `home/studio-user/Claritas/abort_rebase.sh`
- `home/studio-user/Claritas/docs/deriv-trader-digits-architecture.md`
- `home/studio-user/Claritas/force-push.sh`
- `home/studio-user/Claritas/update-and-rebase.sh`
- `abort_rebase.sh`
- `force-push.sh`
- `update-and-rebase.sh`
- `src/features/trading/components/deriv-trader/deriv-trader-interface-v2.tsx`
- `src/hooks/use-deriv-api.ts`
- `src/features/trading/components/deriv-trader/operations-log.tsx`
- `src/features/trading/components/hf-trader/institutional-metrics-dashboard.tsx`
- `src/ai/flows/goal-projection.ts`
- `src/components/ui/input.tsx`