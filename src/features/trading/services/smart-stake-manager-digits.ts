// /src/features/trading/services/smart-stake-manager-digits.ts
'use client';

/**
 * @fileOverview Módulo de Gerenciamento de Risco e Stake para Trading de Dígitos.
 * Contém a lógica para "Martingale Inteligente" e "Critério de Kelly".
 * Este módulo é composto por funções puras, sem dependências de React ou UI.
 */

import type { Operation } from '@/lib/types';
import type { ConfidenceLevel } from '@/features/trading/services/digits-analysis';

// ============================================================================
// 1. INTERFACES E TIPOS DE DADOS
// ============================================================================

export interface SmartMartingaleConfig {
  isEnabled: boolean;
  baseStake: number;
  maxMartingaleLevels: number;
  martingaleMultiplier: number;
  useAntiMartingale: boolean;
  isSmart: boolean; 
}

export interface BankrollState {
  currentBankroll: number;
  initialBankroll: number;
  maxDailyLoss: number;
  dailyProfitTarget: number;
}

export interface SmartStakeDecision {
  nextStake: number;
  shouldPause: boolean;
  pauseReason?: string;
}

// ============================================================================
// 2. FUNÇÕES AUXILIARES INTERNAS
// ============================================================================

const countConsecutiveLosses = (tradeHistory: Operation[]): number => {
  let consecutiveLosses = 0;
  for (let i = tradeHistory.length - 1; i >= 0; i--) {
    if ((tradeHistory[i].result ?? 0) < 0) {
      consecutiveLosses++;
    } else {
      break;
    }
  }
  return consecutiveLosses;
};

const sumConsecutiveLosses = (tradeHistory: Operation[]): number => {
  let accumulatedLoss = 0;
  for (let i = tradeHistory.length - 1; i >= 0; i--) {
    const trade = tradeHistory[i];
    if ((trade.result ?? 0) < 0) {
      accumulatedLoss += trade.stake; // A perda é o valor total da aposta
    } else {
      break;
    }
  }
  return accumulatedLoss;
};

const countConsecutiveWins = (tradeHistory: Operation[]): number => {
    let consecutiveWins = 0;
    for (let i = tradeHistory.length - 1; i >= 0; i--) {
        if ((tradeHistory[i].result ?? 0) > 0) {
            consecutiveWins++;
        } else {
            break;
        }
    }
    return consecutiveWins;
};

// ============================================================================
// 3. FUNÇÃO PRINCIPAL DE DECISÃO DE STAKE
// ============================================================================

export function decideNextStake(
  tradeHistory: Operation[],
  config: SmartMartingaleConfig,
  bankrollState: BankrollState,
  latestSignalConfidence: ConfidenceLevel
): SmartStakeDecision {
  const { isEnabled, baseStake, maxMartingaleLevels, martingaleMultiplier, useAntiMartingale, isSmart } = config;
  const { currentBankroll, initialBankroll, maxDailyLoss, dailyProfitTarget } = bankrollState;

  // --- 1. Circuit Breakers ---
  const dailyPnl = currentBankroll - initialBankroll;
  if (dailyPnl <= -maxDailyLoss) {
    return {
      nextStake: baseStake,
      shouldPause: true,
      pauseReason: `Stop Loss diário de $${maxDailyLoss.toFixed(2)} atingido.`,
    };
  }
  if (dailyPnl >= dailyProfitTarget) {
    return {
      nextStake: baseStake,
      shouldPause: true,
      pauseReason: `Meta de lucro diária de $${dailyProfitTarget.toFixed(2)} atingida.`,
    };
  }

  // --- 2. Lógica Principal ---
  const lastTrade = tradeHistory.length > 0 ? tradeHistory[tradeHistory.length - 1] : null;

  if (!lastTrade || (lastTrade.result ?? 0) > 0) {
    if (isEnabled && useAntiMartingale) {
        const wins = countConsecutiveWins(tradeHistory);
        if (wins >= 3) {
            return { nextStake: baseStake * 1.2, shouldPause: false };
        }
    }
    return { nextStake: baseStake, shouldPause: false };
  }

  // --- 3. Lógica de Martingale ---
  
  if (!isEnabled) {
    return { nextStake: baseStake, shouldPause: false, pauseReason: 'Martingale desativado.' };
  }

  const consecutiveLosses = countConsecutiveLosses(tradeHistory);

  if (consecutiveLosses > maxMartingaleLevels) {
    return {
      nextStake: baseStake,
      shouldPause: true,
      pauseReason: `Limite de ${maxMartingaleLevels} perdas seguidas atingido. Resetando ciclo.`,
    };
  }

  if (isSmart) {
      const isSignalStrongEnough = (latestSignalConfidence === 'ALTA' || latestSignalConfidence === 'MUITO_ALTA');
      if (!isSignalStrongEnough) {
          return { nextStake: baseStake, shouldPause: false, pauseReason: 'Sinal fraco, Martingale Inteligente não aplicado. Resetando para stake base.' };
      }
  }

  const accumulatedLoss = sumConsecutiveLosses(tradeHistory);
  const payoutRatio = 0.95; // Para dígitos

  const simpleMartingaleStake = lastTrade.stake * martingaleMultiplier;
  const recoveryStake = (accumulatedLoss + baseStake) / payoutRatio;
  
  let nextStake = Math.max(simpleMartingaleStake, recoveryStake);

  const maxSafeStake = currentBankroll * 0.20;
  
  if (nextStake > maxSafeStake) {
    return {
      nextStake: baseStake,
      shouldPause: true,
      pauseReason: `Martingale vetado: próximo stake ($${nextStake.toFixed(2)}) excede 20% do capital.`,
    };
  }

  return { nextStake: parseFloat(nextStake.toFixed(2)), shouldPause: false };
}
