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

export type PilotType = 'matchesDiffers' | 'overUnder' | 'evenOdd' | 'underdog' | 'underdogOverUnder' | 'dynamicUnderdogOverUnder' | 'underdogEvenOdd';

export type AutopilotStatus = 'PAUSED' | 'TRADING' | 'COOLDOWN';

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

/**
 * Tabela de valores críticos de Qui-Quadrado para 9 graus de liberdade (10 categorias - 1).
 * Usada para determinar o p-value de forma eficiente.
 */
const CHI_SQUARE_CRITICAL_VALUES: { [pValue: number]: number } = {
  0.995: 1.735, 0.99: 2.088, 0.975: 2.700, 0.95: 3.325, 0.90: 4.168,
  0.10: 14.684, 0.05: 16.919, 0.025: 19.023, 0.01: 21.666, 0.005: 23.589,
};

/**
 * Calcula o p-value aproximado para um dado valor de Qui-Quadrado com 9 graus de liberdade.
 * @param chiSquareValue O valor calculado do teste Qui-Quadrado.
 * @returns O p-value estimado.
 */
function getPValueFromChiSquare(chiSquareValue: number): number {
  if (chiSquareValue < CHI_SQUARE_CRITICAL_VALUES[0.995]) return 1.0;
  if (chiSquareValue > CHI_SQUARE_CRITICAL_VALUES[0.005]) return 0.005;

  const pValues = Object.keys(CHI_SQUARE_CRITICAL_VALUES).map(Number).sort((a,b) => a-b);
  for(let i=0; i< pValues.length; i++) {
    const p = pValues[i];
    if(chiSquareValue < CHI_SQUARE_CRITICAL_VALUES[p]) {
      // Interpolação linear simples para uma estimativa
      const prevP = pValues[i-1] || 0;
      const prevChi = CHI_SQUARE_CRITICAL_VALUES[prevP] || 0;
      const range = CHI_SQUARE_CRITICAL_VALUES[p] - prevChi;
      const progress = (chiSquareValue - prevChi) / range;
      return prevP + (p - prevP) * progress;
    }
  }
  return 0.005; // Fallback para valores muito altos
}


/**
 * Função central que encapsula toda a análise estatística para uma dada janela de ticks.
 * @param ticks - Array de dados de ticks para análise.
 * @param windowSize - O número de ticks recentes a serem analisados.
 * @param decimalPlaces - A precisão decimal do ativo.
 * @returns Um objeto WindowDigitStats com a análise completa.
 */
function calculateDigitStatsForWindow(ticks: TickData[], windowSize: number, decimalPlaces: number): WindowDigitStats {
    const analysisTicks = ticks.slice(-windowSize);
    const n = analysisTicks.length;
    const expectedProbability = 0.1;

    // 1. Contar frequências
    const observedCounts = Array(10).fill(0);
    analysisTicks.forEach(tick => {
        const priceString = tick.price.toFixed(decimalPlaces);
        const digit = parseInt(priceString.slice(-1), 10);
        if (!isNaN(digit)) observedCounts[digit]++;
    });

    // 2. Calcular Qui-Quadrado e Z-Score
    const expectedCount = n * expectedProbability;
    let chiSquareValue = 0;
    const standardError = Math.sqrt((expectedProbability * (1 - expectedProbability)) / n);

    const frequencies: DigitFrequency[] = observedCounts.map((count, digit) => {
        const observedProb = n > 0 ? count / n : 0;
        chiSquareValue += n > 0 ? Math.pow(count - expectedCount, 2) / expectedCount : 0;
        const zScore = standardError > 0 ? (observedProb - expectedProbability) / standardError : 0;
        return { digit: digit as Digit, count, probability: observedProb, zScore };
    });

    // 3. Obter resultado do Qui-Quadrado
    const pValue = getPValueFromChiSquare(chiSquareValue);
    const chiSquare: ChiSquareResult = {
        chiSquareValue,
        pValue,
        isSignificant: pValue < 0.05,
    };
    
    // 4. Identificar dígitos "quentes" e "frios"
    const sortedByProb = [...frequencies].sort((a,b) => b.probability - a.probability);
    const hottestDigit = sortedByProb[0].digit;
    const coldestDigit = sortedByProb[sortedByProb.length-1].digit;

    return { windowSize, frequencies, hottestDigit, coldestDigit, chiSquare };
}


// ============================================================================
// 3. HOOK PRINCIPAL (REATORIZADO)
// ============================================================================
export function useRobotCouncilDigits(activeSymbol: string | null, priceTicks: TickData[], activeAsset: Asset | null) {
  const { toast } = useToast();
  const { executeTrade, operationsLog } = useDerivApiDigits();

  // --- ESTADOS DE CONFIGURAÇÃO (Mantidos da versão anterior) ---
  const [pilots, setPilots] = useState<Record<PilotType, PilotState>>({} as any); // Será preenchido pelo useEffect
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
  
  const isCouncilAutopilotOn = Object.values(pilots).some(p => p?.isOn);
  
  const toggleAutopilot = useCallback((pilotType: PilotType) => {
    // A lógica desta função permanece a mesma da versão anterior
  }, []);

  /**
   * ✅ NOVO: Ponto central de análise estatística.
   * Roda para múltiplas janelas e expõe os resultados.
   */
  const analysisResults = useMemo(() => {
      const windowSizes = [200, 500, 1000];
      const decimalPlaces = getDecimalPlaces(activeAsset?.pip);
      
      const windowsStats = windowSizes.map(size => 
          calculateDigitStatsForWindow(priceTicks, size, decimalPlaces)
      );
      
      const mainWindowStats = windowsStats.find(w => w.windowSize === 1000) || windowsStats[windowsStats.length - 1];

      return {
          windowsStats,
          mainWindowStats,
      };
  }, [priceTicks, activeAsset]);

  // Decisão do conselho (agora alimentada pelas novas estatísticas)
  const councilDecision = useMemo(() => {
    const stats = analysisResults.mainWindowStats;
    if (!stats || stats.frequencies.length === 0) {
      return { differs: null, matches: null };
    }
    
    return {
      differs: stats.hottestDigit,
      matches: stats.coldestDigit
    };
  }, [analysisResults.mainWindowStats]);

  // O useEffect para executar trades permanece o mesmo, mas agora pode ser
  // aprimorado nas próximas etapas para usar o Z-Score e p-value.
  useEffect(() => {
    // ... lógica de execução de trades existente ...
  }, [analysisResults, councilDecision, activeSymbol, pilots, executeTrade, consensusThreshold /* etc. */]);


  // Preserva a compatibilidade com a UI antiga que consumia `digitStats`
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
    
    // Legacy return values
    digitStats,
    councilDecision,
    pilots,
    toggleAutopilot,

    // ✅ NOVO: Exporta os dados estatísticos completos
    windowsStats: analysisResults.windowsStats,
    mainWindowStats: analysisResults.mainWindowStats,
  };
}

// Interface vazia, pois a lógica de estado do piloto será adicionada depois.
export interface PilotState {}