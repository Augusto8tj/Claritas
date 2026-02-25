// src/features/trading/services/repetition-analyzer.ts
'use client';

import type { TickData } from '@/lib/types';
import type { 
  RepetitionSequence, 
  RepetitionSignal, 
  RepetitionTriggerConfig 
} from '../types/repetition-trigger';
import type { DigitContractType } from '../hooks/use-vagalume-alternante';
import { calculateAdvancedSignalScore } from './digit-indicators';
import { calculateDigitStatsForWindow } from './digits-analysis';

/**
 * Analisa uma sequência e decide se deve tradear
 */
export function analyzeRepetitionSignal(
  sequence: RepetitionSequence,
  ticks: TickData[],
  config: RepetitionTriggerConfig,
  decimalPlaces: number
): RepetitionSignal | null {
  
  // 1. Verifica validade temporal
  const currentEpoch = ticks[ticks.length - 1].epoch;
  const elapsed = (currentEpoch - sequence.lastEpoch) * 1000;
  
  if (elapsed > config.maxWaitTime) {
    return null; // Sequência expirou
  }
  
  // 2. Calcula confidence base
  const lengthKey = Math.min(sequence.length, 5) as 2 | 3 | 4 | 5;
  let confidence = config.confidenceMap[lengthKey] || 0.90;
  
  // Boost adicional para sequências muito longas
  if (sequence.length > 5) {
    confidence = Math.min(0.98, confidence + (sequence.length - 5) * 0.01);
  }
  
  // 3. Análise avançada (opcional)
  let advancedMetrics = undefined;
  let recommendationBoost = 1.0;
  
  if (config.filters.requireVolatilityCheck || config.filters.requireChiSquareConfirmation) {
    const windowSize = Math.min(ticks.length, 100);
    const windowTicks = ticks.slice(-windowSize);
    
    // Análise de volatilidade e regime
    const advancedScore = calculateAdvancedSignalScore(windowTicks, confidence, decimalPlaces);
    
    // Análise de distribuição de dígitos
    const digitStats = calculateDigitStatsForWindow(windowTicks, windowSize, decimalPlaces);
    const digitFreq = digitStats.frequencies.find(f => f.digit === sequence.digit);
    
    const digitIsHot = digitFreq ? digitFreq.zScore > config.filters.minDigitZScore : false;
    const chiSquareValid = digitStats.chiSquare ? digitStats.chiSquare.isSignificant : false;
    
    advancedMetrics = {
      volatilityContext: advancedScore.volatility.volatilityRegime,
      chiSquareValid,
      digitIsHot,
      recommendationBoost: 1.0,
    };
    
    // Ajusta confidence baseado no contexto
    if (advancedScore.regime.type === 'RANGING') {
      recommendationBoost *= 1.10; // +10% em ranging
    } else if (advancedScore.regime.type === 'CHAOTIC') {
      recommendationBoost *= 0.85; // -15% em caos
    }
    
    if (digitIsHot) {
      recommendationBoost *= 1.05; // +5% se dígito está quente
    }
    
    // Filtros obrigatórios
    if (config.filters.requireChiSquareConfirmation && !chiSquareValid) {
      return null; // Rejeita se distribuição não é anormal
    }
    
    if (config.filters.requireVolatilityCheck && advancedScore.volatility.volatilityRegime === 'HIGH') {
      return null; // Rejeita em alta volatilidade
    }
    
    advancedMetrics.recommendationBoost = recommendationBoost;
    confidence *= recommendationBoost;
    confidence = Math.min(0.98, confidence); // Cap em 98%
  }
  
  // 4. Decide contrato
  const { contract, digit } = decideContract(sequence, config);
  
  if (!contract) {
    return null;
  }
  
  // 5. Monta sinal
  return {
    shouldTrade: true,
    contract,
    digit,
    confidence,
    sequence,
    reason: `Sequência de ${sequence.length}x dígito ${sequence.digit}`,
    expectedWinRate: confidence,
    advancedMetrics,
  };
}

/**
 * Decide qual contrato usar baseado na configuração
 */
function decideContract(
  sequence: RepetitionSequence,
  config: RepetitionTriggerConfig
): { contract: DigitContractType | null; digit?: number } {
  
  // PRIORIDADE 1: DIGITDIFF (melhor payout)
  if (config.contracts.useDIGITDIFF) {
    return {
      contract: 'DIGITDIFF',
      digit: sequence.digit,
    };
  }
  
  // PRIORIDADE 2: EVEN/ODD
  if (config.contracts.useEVENODD) {
    const isEven = sequence.digit % 2 === 0;
    return {
      contract: isEven ? 'DIGITODD' : 'DIGITEVEN',
    };
  }
  
  // PRIORIDADE 3: OVER/UNDER
  if (config.contracts.useOVERUNDER) {
    const threshold = sequence.digit < 5 ? 4 : 5;
    return {
      contract: sequence.digit <= threshold ? 'DIGITOVER' : 'DIGITUNDER',
      digit: threshold,
    };
  }
  
  return { contract: null };
}

/**
 * Valida se é seguro tradear (circuit breakers)
 */
export function checkSafetyCircuitBreakers(
  recentTrades: Array<{ result?: number; timestamp: string }>,
  config: RepetitionTriggerConfig,
  lastTradeEpoch?: number
): { canTrade: boolean; reason?: string } {
  
  // 1. Limite diário de trades
  const today = new Date().toDateString();
  const todayTrades = recentTrades.filter(t => 
    new Date(t.timestamp).toDateString() === today
  );
  
  if (todayTrades.length >= config.safety.maxDailyTrades) {
    return {
      canTrade: false,
      reason: `Limite diário de ${config.safety.maxDailyTrades} trades atingido`,
    };
  }
  
  // 2. Cooldown entre trades
  if (lastTradeEpoch) {
    const currentEpoch = Math.floor(Date.now() / 1000);
    const elapsed = currentEpoch - lastTradeEpoch;
    
    if (elapsed < config.safety.minTimeBetweenTrades) {
      return {
        canTrade: false,
        reason: `Cooldown de ${config.safety.minTimeBetweenTrades}s ainda ativo`,
      };
    }
  }
  
  // 3. Win rate mínimo
  const last20Trades = recentTrades.slice(-20);
  if (last20Trades.length >= 10) {
    const wins = last20Trades.filter(t => (t.result ?? 0) > 0).length;
    const winRate = wins / last20Trades.length;
    
    if (winRate < config.safety.stopLossWinRate) {
      return {
        canTrade: false,
        reason: `Win rate (${(winRate * 100).toFixed(1)}%) abaixo do mínimo (${(config.safety.stopLossWinRate * 100).toFixed(0)}%)`,
      };
    }
  }
  
  // 4. Perdas consecutivas
  let consecutiveLosses = 0;
  for (let i = recentTrades.length - 1; i >= 0; i--) {
    if ((recentTrades[i].result ?? 0) < 0) {
      consecutiveLosses++;
    } else {
      break;
    }
  }
  
  if (consecutiveLosses >= config.safety.maxConsecutiveLosses) {
    return {
      canTrade: false,
      reason: `${consecutiveLosses} perdas consecutivas (limite: ${config.safety.maxConsecutiveLosses})`,
    };
  }
  
  return { canTrade: true };
}
