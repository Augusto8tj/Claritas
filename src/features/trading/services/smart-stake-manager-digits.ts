// src/features/trading/services/smart-stake-manager-digits.ts
'use client';

import type { Operation } from '@/lib/types';
import type { ConfidenceLevel } from '@/features/trading/services/digits-analysis';
import type { DigitContractType } from '../hooks/use-vagalume-alternante';

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
  initialBankroll: number | null;
  maxDailyLoss: number;
  dailyProfitTarget: number;
}

export interface SmartStakeDecision {
  nextStake: number;
  shouldPause: boolean;
  pauseReason?: string;
}

// ============================================================================
// 2. FUNÇÕES AUXILIARES OTIMIZADAS
// ============================================================================

const countConsecutiveLosses = (tradeHistory: Operation[]): number => {
  let consecutiveLosses = 0;
  for (let i = tradeHistory.length - 1; i >= 0; i--) {
    const trade = tradeHistory[i];
    if ((trade.result ?? 0) < 0) {
      consecutiveLosses++;
    } else {
      break;
    }
  }
  return consecutiveLosses;
};

const PAYOUTS: Record<DigitContractType, number> = {
  DIGITMATCH: 8.0, // Retorno líquido ~800%
  DIGITDIFF: 0.10, // Retorno líquido ~10%
  DIGITOVER: 0.95, // Retorno líquido ~95%
  DIGITUNDER: 0.95,
  DIGITEVEN: 0.95,
  DIGITODD: 0.95,
};

const getPayoutRatio = (contractType: DigitContractType): number => {
    return PAYOUTS[contractType] || 0.95;
};

// ============================================================================
// 3. FUNÇÃO PRINCIPAL DE DECISÃO DE STAKE (VERSÃO 2.2 - Simplificada)
// ============================================================================

export function decideNextStake(
  tradeHistory: Operation[],
  config: SmartMartingaleConfig,
  bankrollState: BankrollState,
  contractType: DigitContractType
): SmartStakeDecision {
  const { isEnabled, baseStake, maxMartingaleLevels, martingaleMultiplier, isSmart } = config;
  const { currentBankroll, initialBankroll, maxDailyLoss, dailyProfitTarget } = bankrollState;

  // --- 1. Circuit Breakers (Proteções de Risco) ---
  const dailyPnl = currentBankroll - (initialBankroll ?? currentBankroll);
  if (dailyPnl <= -maxDailyLoss) {
    return { nextStake: baseStake, shouldPause: true, pauseReason: `Stop Loss diário de $${maxDailyLoss.toFixed(2)} atingido.` };
  }
  if (dailyPnl >= dailyProfitTarget) {
    return { nextStake: baseStake, shouldPause: true, pauseReason: `Meta de lucro diária de $${dailyProfitTarget.toFixed(2)} atingida.` };
  }

  const consecutiveLosses = countConsecutiveLosses(tradeHistory);
  if (isEnabled && consecutiveLosses >= maxMartingaleLevels) {
    return { nextStake: baseStake, shouldPause: true, pauseReason: `Limite de ${maxMartingaleLevels} perdas seguidas atingido.` };
  }
  
  // --- 2. Lógica de Stake (Simplificada) ---
  
  let nextStake = baseStake; 
  const lastTrade = tradeHistory.length > 0 ? tradeHistory[tradeHistory.length - 1] : null;

  if (isEnabled && lastTrade && (lastTrade.result ?? 0) < 0) {
    nextStake = lastTrade.stake * martingaleMultiplier;
  }
  
  const maxSafeStake = Math.max(baseStake, currentBankroll * 0.10);
  if (nextStake > maxSafeStake) {
      console.warn(`[StakeManager] Martingale stake ($${nextStake.toFixed(2)}) excedeu limite de segurança ($${maxSafeStake.toFixed(2)}). Resetando para stake base.`);
      nextStake = baseStake;
  }
  
  return { nextStake: parseFloat(nextStake.toFixed(2)), shouldPause: false };
}
