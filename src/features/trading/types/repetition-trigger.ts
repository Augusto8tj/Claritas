// src/features/trading/types/repetition-trigger.ts
'use client';

import type { DigitContractType } from '../hooks/use-vagalume-alternante';

export interface RepetitionSequence {
  digit: number;                    // Dígito repetido
  length: number;                   // Comprimento da sequência (2, 3, 4+)
  startEpoch: number;              // Quando começou
  lastEpoch: number;               // Último tick da sequência
  ticks: number[];                 // Array dos ticks [5,5,5]
}

export interface RepetitionSignal {
  shouldTrade: boolean;
  contract: DigitContractType;
  digit?: number;
  confidence: number;               // 0.88-0.95
  sequence: RepetitionSequence;
  reason: string;
  expectedWinRate: number;
  advancedMetrics?: {
    volatilityContext: 'LOW' | 'MEDIUM' | 'HIGH';
    chiSquareValid: boolean;
    digitIsHot: boolean;            // z-score > 1.5
    recommendationBoost: number;    // Multiplicador de confidence
  };
}

export interface RepetitionTriggerConfig {
  enabled: boolean;
  minSequenceLength: number;        // 2, 3, ou 4
  maxSequenceLength: number;        // Limite superior (ex: 6)
  maxWaitTime: number;              // ms desde última repetição
  
  // Confidence por comprimento
  confidenceMap: {
    2: number;  // 0.90
    3: number;  // 0.92
    4: number;  // 0.95
    5: number;  // 0.97
  };
  
  // Contratos disponíveis
  contracts: {
    useDIGITDIFF: boolean;         // Preferencial (payout 10.1x, ~11%)
    useEVENODD: boolean;           // Fallback
    useOVERUNDER: boolean;         // Fallback
  };
  
  // Filtros avançados
  filters: {
    requireChiSquareConfirmation: boolean;
    requireVolatilityCheck: boolean;
    minDigitZScore: number;        // Ex: 1.0 (dígito deve estar quente)
  };
  
  // Integração híbrida
  hybridMode: {
    enabled: boolean;
    priorityStrategy: 'trigger' | 'vagalume' | 'auto';
    switchOnPerformance: boolean;
  };
  
  // Circuit breakers
  safety: {
    maxDailyTrades: number;
    minTimeBetweenTrades: number;  // segundos
    stopLossWinRate: number;       // Ex: 0.75
    maxConsecutiveLosses: number;
  };
}

export interface RepetitionStats {
  totalSequences: number;
  sequencesByLength: Record<number, number>;
  winsByLength: Record<number, number>;
  avgWinRateByLength: Record<number, number>;
  totalTrades: number;
  wins: number;
  losses: number;
  overallWinRate: number;
  avgConfidence: number;
  profitLoss: number;
}

export const DEFAULT_REPETITION_CONFIG: RepetitionTriggerConfig = {
  enabled: true,
  minSequenceLength: 2,
  maxSequenceLength: 6,
  maxWaitTime: 2000,
  
  confidenceMap: {
    2: 0.90,
    3: 0.92,
    4: 0.95,
    5: 0.97,
  },
  
  contracts: {
    useDIGITDIFF: true,
    useEVENODD: true,
    useOVERUNDER: false,
  },
  
  filters: {
    requireChiSquareConfirmation: false,
    requireVolatilityCheck: true,
    minDigitZScore: 0.5,
  },
  
  hybridMode: {
    enabled: false,
    priorityStrategy: 'auto',
    switchOnPerformance: true,
  },
  
  safety: {
    maxDailyTrades: 20,
    minTimeBetweenTrades: 30,
    stopLossWinRate: 0.75,
    maxConsecutiveLosses: 3,
  },
};
