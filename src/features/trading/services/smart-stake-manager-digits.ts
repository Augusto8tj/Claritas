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

// Payouts Corrigidos
const PAYOUTS: Record<DigitContractType, number> = {
  DIGITMATCH: 9.5,
  DIGITDIFF: 0.11,
  DIGITOVER: 0.95,
  DIGITUNDER: 0.95,
  DIGITEVEN: 0.95,
  DIGITODD: 0.95,
};

const getPayoutRatio = (contractType: DigitContractType): number => {
    return PAYOUTS[contractType] || 0.95;
};

// Kelly Criterion Adaptativo
function calculateKellyStake(
  confidence: number,
  payoutOdds: number,
  bankroll: number,
  kellyFraction: number = 0.25
): number {
  const p = confidence;
  const q = 1 - p;
  const b = payoutOdds;

  const kellyFull = (b * p - q) / b;

  if (kellyFull <= 0) return 0;

  const kellyFractional = kellyFull * kellyFraction;
  const stake = kellyFractional * bankroll;

  return Math.max(0, stake);
}


// ============================================================================
// 3. FUNÇÃO PRINCIPAL DE DECISÃO DE STAKE (V3.0 - Kelly + Martingale)
// ============================================================================

export function decideNextStake(
  tradeHistory: Operation[],
  config: SmartMartingaleConfig,
  bankrollState: BankrollState,
  contractType: DigitContractType,
  confidence: number = 0.55
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
  const totalTrades = tradeHistory.length;
  if(totalTrades > 5) {
      const winRate = tradeHistory.filter(t => (t.result ?? 0) > 0).length / totalTrades;
      if (consecutiveLosses >= 3 && winRate < 0.45) {
          return {
              nextStake: baseStake,
              shouldPause: true,
              pauseReason: `Win rate da sessão (${(winRate * 100).toFixed(1)}%) abaixo de 45%. Pausando para revisão.`
          };
      }
  }

  if (isEnabled && consecutiveLosses >= maxMartingaleLevels) {
    return { nextStake: baseStake, shouldPause: true, pauseReason: `Limite de ${maxMartingaleLevels} perdas seguidas atingido.` };
  }
  
  // --- 2. Lógica de Stake ---
  let nextStake = baseStake; 
  const lastTrade = tradeHistory.length > 0 ? tradeHistory[tradeHistory.length - 1] : null;

  // MODO 1: KELLY CRITERION (se isSmart = true)
  if (isSmart && confidence > 0.5) {
    const payoutOdds = getPayoutRatio(contractType);
    const kellyStake = calculateKellyStake(confidence, payoutOdds, currentBankroll, 0.25);
    
    if (kellyStake > baseStake) {
      nextStake = kellyStake;
    }
  }

  // MODO 2: MARTINGALE (se perda recente)
  if (isEnabled && lastTrade && (lastTrade.result ?? 0) < 0) {
    const martingaleStake = lastTrade.stake * martingaleMultiplier;
    if (martingaleStake > nextStake) {
      nextStake = martingaleStake;
    }
  }
  
  // --- 3. PROTEÇÃO DE LIMITE ---
  const maxSafeStake = Math.max(baseStake, currentBankroll * 0.10); // Nunca arriscar mais de 10%
  if (nextStake > maxSafeStake) {
    nextStake = baseStake;
  }
  
  return { nextStake: parseFloat(nextStake.toFixed(2)), shouldPause: false };
}
