// src/features/trading/hooks/use-sherlock-holmes.ts
'use client';

import { useState, useMemo, useEffect } from 'react';
import type { TickData } from '@/lib/types';
import { getLastDigit } from '../services/repetition-detector';

// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

export interface TransitionMatrix {
  [fromDigit: number]: {
    [toDigit: number]: number;
    _total: number;
  };
}

export interface ConditionalProbability {
  digit: number;
  probability: number;
}

export interface SherlockAnalysis {
  lastDigit: number | null;
  probabilities: ConditionalProbability[];
  recommendedBlock: 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | 'NONE';
  blockProbability: number;
}

export interface SherlockSignal {
    contract: 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER';
    barrier?: number;
    confidence: number;
    reason: string;
}

// ============================================================================
// 2. LÓGICA DE ANÁLISE
// ============================================================================

function analyzeTransitions(ticks: TickData[], decimalPlaces: number): TransitionMatrix {
  const matrix: TransitionMatrix = {};
  for (let i = 0; i < 10; i++) {
    matrix[i] = { _total: 0 };
    for (let j = 0; j < 10; j++) {
      matrix[i][j] = 0;
    }
  }

  for (let i = 1; i < ticks.length; i++) {
    const prevDigit = getLastDigit(ticks[i - 1].price, decimalPlaces);
    const currDigit = getLastDigit(ticks[i].price, decimalPlaces);

    matrix[prevDigit][currDigit]++;
    matrix[prevDigit]._total++;
  }

  return matrix;
}

function calculateConditionalProbabilities(matrix: TransitionMatrix, lastDigit: number | null): ConditionalProbability[] {
  if (lastDigit === null || !matrix[lastDigit] || matrix[lastDigit]._total === 0) {
    // Se não há dados, retorna uma distribuição uniforme como fallback
    return Array.from({ length: 10 }, (_, i) => ({ digit: i, probability: 0.1 }));
  }

  const transitions = matrix[lastDigit];
  const total = transitions._total;

  const probabilities: ConditionalProbability[] = [];
  for (let i = 0; i < 10; i++) {
    probabilities.push({
      digit: i,
      probability: transitions[i] / total,
    });
  }

  return probabilities.sort((a, b) => b.probability - a.probability);
}

// ============================================================================
// 3. HOOK PRINCIPAL
// ============================================================================

export function useSherlockHolmes(ticks: TickData[], decimalPlaces: number) {
  const [analysis, setAnalysis] = useState<SherlockAnalysis | null>(null);

  useEffect(() => {
    if (ticks.length < 500) {
      setAnalysis(null);
      return;
    }

    const windowTicks = ticks.slice(-500);
    const lastDigit = getLastDigit(windowTicks[windowTicks.length - 1].price, decimalPlaces);

    const transitionMatrix = analyzeTransitions(windowTicks, decimalPlaces);
    const probabilities = calculateConditionalProbabilities(transitionMatrix, lastDigit);

    // Lógica para recomendar o bloco
    const probEven = probabilities
      .filter(p => p.digit % 2 === 0)
      .reduce((sum, p) => sum + p.probability, 0);
    const probOdd = 1 - probEven;

    const probOver4 = probabilities
      .filter(p => p.digit > 4)
      .reduce((sum, p) => sum + p.probability, 0);
    const probUnder5 = 1 - probOver4;

    let recommendedBlock: SherlockAnalysis['recommendedBlock'] = 'NONE';
    let blockProbability = 0;

    if (probEven > probOdd && probEven > probOver4 && probEven > probUnder5) {
      recommendedBlock = 'EVEN';
      blockProbability = probEven;
    } else if (probOdd > probEven && probOdd > probOver4 && probOdd > probUnder5) {
      recommendedBlock = 'ODD';
      blockProbability = probOdd;
    } else if (probOver4 > probUnder5) {
      recommendedBlock = 'OVER';
      blockProbability = probOver4;
    } else {
      recommendedBlock = 'UNDER';
      blockProbability = probUnder5;
    }

    setAnalysis({
      lastDigit,
      probabilities,
      recommendedBlock,
      blockProbability,
    });

  }, [ticks, decimalPlaces]);

  return {
    analysis,
  };
}