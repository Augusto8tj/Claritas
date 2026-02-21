// src/features/trading/hooks/use-robot-council-digits.ts
'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { TickData, Asset, Operation } from '@/lib/types';
import { useDerivApiDigits } from './use-deriv-api-digits';

// ============================================================================
// 1. TIPOS E INTERFACES (NOVA ESTRUTURA ESTATÍSTICA)
// ============================================================================
export type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface DigitFrequency {
  digit: Digit;
  count: number;
  probability: number; // 0–1
  zScore: number;
}

export interface ChiSquareResult {
  chiSquareValue: number;
  pValue: number;
  isSignificant: boolean; // pValue < 0.05
}

export interface WindowDigitStats {
  windowSize: number;
  frequencies: DigitFrequency[];
  hottestDigit: Digit;
  coldestDigit: Digit;
  chiSquare: ChiSquareResult;
}

export type ConfidenceLevel = 'MUITO_ALTA' | 'ALTA' | 'MEDIA' | 'BAIXA' | 'NULA';

export interface MultiWindowAnalysis {
  windows: WindowDigitStats[];
  hottestConsensusDigit?: Digit;
  coldestConsensusDigit?: Digit;
  consensusStrength: ConfidenceLevel;
}

export interface SignalQuality {
  targetDigit: Digit;
  contractType: 'DIGITDIFF' | 'DIGITMATCH';
  mainWindow: WindowDigitStats;
  multiWindowAnalysis: MultiWindowAnalysis;
  recentWinrate?: number;
  confidenceLevel: ConfidenceLevel;
}

export type PilotType = 'matchesDiffers' | 'overUnder' | 'evenOdd' | 'underdog' | 'underdogOverUnder' | 'dynamicUnderdogOverUnder' | 'underdogEvenOdd';

export type AutopilotStatus = 'PAUSED' | 'TRADING' | 'COOLDOWN';

export interface PilotState {
    isOn: boolean;
    status: AutopilotStatus;
    currentTarget: string | null;
    consecutiveLosses: number;
    accumulatedLoss: number;
}

const BASE_STAKE = 0.35;

// ============================================================================
// 2. FUNÇÕES AUXILIARES ESTATÍSTICAS
// ============================================================================

const getDecimalPlaces = (pipSize: number | undefined): number => {
    if (pipSize === undefined || pipSize === null || pipSize <= 0) return 2;
    if (Math.floor(pipSize) === pipSize && pipSize >= 1) return 0;
    const pipString = String(pipSize);
    if (pipString.includes('.')) return pipString.split('.')[1].length;
    return 0;
};

const CHI_SQUARE_CRITICAL_VALUES: { [pValue: number]: number } = {
  0.995: 1.735, 0.99: 2.088, 0.975: 2.700, 0.95: 3.325, 0.90: 4.168,
  0.10: 14.684, 0.05: 16.919, 0.025: 19.023, 0.01: 21.666, 0.005: 23.589,
};

function getPValueFromChiSquare(chiSquareValue: number): number {
  if (chiSquareValue < CHI_SQUARE_CRITICAL_VALUES[0.995]) return 1.0;
  if (chiSquareValue > CHI_SQUARE_CRITICAL_VALUES[0.005]) return 0.005;

  const pValues = Object.keys(CHI_SQUARE_CRITICAL_VALUES).map(Number).sort((a,b) => a-b);
  for(let i=0; i< pValues.length; i++) {
    const p = pValues[i];
    if(chiSquareValue < CHI_SQUARE_CRITICAL_VALUES[p]) {
      const prevP = pValues[i-1] || 0;
      const prevChi = CHI_SQUARE_CRITICAL_VALUES[prevP] || 0;
      const range = CHI_SQUARE_CRITICAL_VALUES[p] - prevChi;
      const progress = (chiSquareValue - prevChi) / range;
      return prevP + (p - prevP) * progress;
    }
  }
  return 0.005;
}

function calculateDigitStatsForWindow(ticks: TickData[], windowSize: number, decimalPlaces: number): WindowDigitStats {
    const analysisTicks = ticks.slice(-windowSize);
    const n = analysisTicks.length;
    const expectedProbability = 0.1;

    const observedCounts = Array(10).fill(0);
    analysisTicks.forEach(tick => {
        const priceString = tick.price.toFixed(decimalPlaces);
        const digit = parseInt(priceString.slice(-1), 10);
        if (!isNaN(digit)) observedCounts[digit]++;
    });

    let chiSquareValue = 0;
    const standardError = n > 0 ? Math.sqrt((expectedProbability * (1 - expectedProbability)) / n) : 0;

    const frequencies: DigitFrequency[] = observedCounts.map((count, digit) => {
        const observedProb = n > 0 ? count / n : 0;
        const expectedCount = n * expectedProbability;
        chiSquareValue += n > 0 ? Math.pow(count - expectedCount, 2) / expectedCount : 0;
        const zScore = standardError > 0 ? (observedProb - expectedProbability) / standardError : 0;
        return { digit: digit as Digit, count, probability: observedProb, zScore };
    });

    const pValue = getPValueFromChiSquare(chiSquareValue);
    const chiSquare: ChiSquareResult = { chiSquareValue, pValue, isSignificant: pValue < 0.05 };
    
    const sortedByProb = [...frequencies].sort((a,b) => b.probability - a.probability);
    const hottestDigit = sortedByProb[0].digit;
    const coldestDigit = sortedByProb[sortedByProb.length-1].digit;

    return { windowSize, frequencies, hottestDigit, coldestDigit, chiSquare };
}

function getMultiWindowAnalysis(windows: WindowDigitStats[]): MultiWindowAnalysis {
    const hottestCounts: Record<string, number> = {};
    const coldestCounts: Record<string, number> = {};
    
    windows.forEach(w => {
        hottestCounts[w.hottestDigit] = (hottestCounts[w.hottestDigit] || 0) + 1;
        coldestCounts[w.coldestDigit] = (coldestCounts[w.coldestDigit] || 0) + 1;
    });

    const findConsensusDigit = (counts: Record<string, number>): number | undefined => {
        const entry = Object.entries(counts).find(([, count]) => count >= 2);
        return entry ? parseInt(entry[0], 10) : undefined;
    };

    const hottestConsensusDigit = findConsensusDigit(hottestCounts) as Digit | undefined;
    const coldestConsensusDigit = findConsensusDigit(coldestCounts) as Digit | undefined;

    const maxHottestCount = Math.max(0, ...Object.values(hottestCounts));
    const maxColdestCount = Math.max(0, ...Object.values(coldestCounts));
    const maxConsensusCount = Math.max(maxHottestCount, maxColdestCount);

    let consensusStrength: ConfidenceLevel = 'BAIXA';
    if (maxConsensusCount === 3) consensusStrength = 'MUITO_ALTA';
    else if (maxConsensusCount === 2) consensusStrength = 'ALTA';
    
    return {
        windows,
        hottestConsensusDigit,
        coldestConsensusDigit,
        consensusStrength,
    };
}

function determineSignalQuality(
    multiWindowAnalysis: MultiWindowAnalysis,
    mainWindow: WindowDigitStats
): SignalQuality | null {
    const { hottestConsensusDigit, coldestConsensusDigit, consensusStrength } = multiWindowAnalysis;
    const { isSignificant, pValue } = mainWindow.chiSquare;

    let targetDigit: Digit | undefined;
    let contractType: 'DIGITDIFF' | 'DIGITMATCH' | undefined;
    let signalZScore = 0;
    
    // Prioriza o sinal de "DIFFERS" (mais seguro) se houver consenso
    if (hottestConsensusDigit !== undefined) {
        targetDigit = hottestConsensusDigit;
        contractType = 'DIGITDIFF';
        signalZScore = mainWindow.frequencies.find(f => f.digit === targetDigit)?.zScore || 0;
    } else if (coldestConsensusDigit !== undefined) {
        targetDigit = coldestConsensusDigit;
        contractType = 'DIGITMATCH';
        signalZScore = mainWindow.frequencies.find(f => f.digit === targetDigit)?.zScore || 0;
    }

    if (targetDigit === undefined || !contractType) return null;
    
    let confidenceLevel: ConfidenceLevel = 'BAIXA';
    if (isSignificant) {
        if (consensusStrength === 'MUITO_ALTA' && Math.abs(signalZScore) > 2.5) confidenceLevel = 'MUITO_ALTA';
        else if (consensusStrength === 'ALTA' && Math.abs(signalZScore) > 1.96) confidenceLevel = 'ALTA';
        else if (consensusStrength === 'MEDIA' || Math.abs(signalZScore) > 1.5) confidenceLevel = 'MEDIA';
    }

    return {
        targetDigit,
        contractType,
        mainWindow,
        multiWindowAnalysis,
        confidenceLevel,
    };
}

const createInitialPilotState = (): PilotState => ({
    isOn: false,
    status: 'PAUSED',
    currentTarget: null,
    consecutiveLosses: 0,
    accumulatedLoss: 0,
});

// ============================================================================
// 3. HOOK PRINCIPAL (REATORIZADO)
// ============================================================================
export function useRobotCouncilDigits(activeSymbol: string | null, priceTicks: TickData[], activeAsset: Asset | null) {
  const { toast } = useToast();
  const { executeTrade, operationsLog } = useDerivApiDigits();

  const [pilots, setPilots] = useState<Record<PilotType, PilotState>>({
    matchesDiffers: createInitialPilotState(), overUnder: createInitialPilotState(),
    evenOdd: createInitialPilotState(), underdog: createInitialPilotState(),
    underdogOverUnder: createInitialPilotState(), dynamicUnderdogOverUnder: createInitialPilotState(),
    underdogEvenOdd: createInitialPilotState(),
  });
  
  // Existing state...
  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusThreshold, setConsensusThreshold] = useState(25);
  const [overUnderThreshold, setOverUnderThreshold] = useState(65);
  const [evenOddThreshold, setEvenOddThreshold] = useState(65);
  const [underdogThreshold, setUnderdogThreshold] = useState(5.0);
  const [isUnderdogInverse, setIsUnderdogInverse] = useState(false);
  const [overUnderUnderdogThreshold, setOverUnderUnderdogThreshold] = useState(40);
  const [evenOddUnderdogThreshold, setEvenOddUnderdogThreshold] = useState(40);
  const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(false);
  const [martingaleRecoveryFactor, setMartingaleRecoveryFactor] = useState(1.5);
  const [cooldownTime, setCooldownTime] = useState(0);
  const [maxLosses, setMaxLosses] = useState(40);
  
  const isCouncilAutopilotOn = Object.values(pilots).some(p => p.isOn);
  
  const toggleAutopilot = useCallback((pilotType: PilotType) => {
    const pilotToToggle = pilots[pilotType];
    if (!pilotToToggle) return;
    const newIsOnState = !pilotToToggle.isOn;
    toast({ title: `Piloto ${pilotType} ${newIsOnState ? 'Ativado' : 'Desativado'}` });
    setPilots(prev => ({
        ...prev,
        [pilotType]: { ...prev[pilotType], isOn: newIsOnState, status: newIsOnState ? 'TRADING' : 'PAUSED' },
    }));
  }, [toast, pilots]);

  const analysisResults = useMemo(() => {
      const windowSizes = [200, 500, 1000];
      const decimalPlaces = getDecimalPlaces(activeAsset?.pip);
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

  useEffect(() => {
    // A lógica de execução do trade será movida para cá nas próximas etapas
  }, [shouldTrade, signalQuality]);

  const digitStats = analysisResults.mainWindowStats?.frequencies || [];
  
  return {
    isCouncilAutopilotOn,
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
    
    digitStats, // Preservado para a UI existente
    councilDecision, // Preservado para a UI existente
    pilots,
    toggleAutopilot,

    // NOVO: Exposto para a UI
    windowsStats: analysisResults.windowsStats,
    mainWindowStats: analysisResults.mainWindowStats,
    multiWindowAnalysis,
    signalQuality,
    shouldTrade,
  };
}
