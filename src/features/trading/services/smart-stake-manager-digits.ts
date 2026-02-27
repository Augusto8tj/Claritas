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
    // Retorna 0.95 se o tipo não for encontrado, para segurança
    return PAYOUTS[contractType] || 0.95;
};

// Kelly Criterion Adaptativo
function calculateKellyStake(
  confidence: number,
  payoutOdds: number,
  bankroll: number,
  kellyFraction: number = 0.25
): number {
  if (confidence <= 0.5) return 0;
  
  const p = confidence;
  const q = 1 - p;
  const b = payoutOdds;

  // Se a vantagem for nula ou negativa, não apostar.
  const edge = (b * p) - q;
  if (edge <= 0) return 0;

  const kellyFull = edge / b;
  const kellyFractional = kellyFull * kellyFraction;
  const stake = kellyFractional * bankroll;

  return Math.max(0, stake);
}


// ============================================================================
// 3. FUNÇÃO PRINCIPAL DE DECISÃO DE STAKE (V3.1 - Martingale Preciso)
// ============================================================================

export function decideNextStake(
  tradeHistory: Operation[],
  config: SmartMartingaleConfig,
  bankrollState: BankrollState,
  contractType: DigitContractType,
  confidence: number = 0.55
): SmartStakeDecision {
  const { isEnabled, baseStake, maxMartingaleLevels, isSmart } = config;
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
  
  // MODO 1: KELLY CRITERION (se isSmart = true)
  if (isSmart) {
    const payoutOdds = getPayoutRatio(contractType);
    const kellyStake = calculateKellyStake(confidence, payoutOdds, currentBankroll);
    
    if (kellyStake > baseStake) {
      nextStake = kellyStake;
    }
  }

  // MODO 2: MARTINGALE PRECISO (se em sequência de perdas)
  if (isEnabled && consecutiveLosses > 0) {
    const lossesToRecover = tradeHistory
      .slice(-consecutiveLosses)
      .reduce((sum, trade) => sum + trade.stake, 0);

    const payoutRatio = getPayoutRatio(contractType);

    if (payoutRatio > 0) {
      // Fórmula: Próximo_Stake = (Total_Perdido + Lucro_Desejado) / Taxa_De_Pagamento
      const requiredStake = (lossesToRecover + baseStake) / payoutRatio;
      
      // A lógica de Martingale só se aplica se o stake calculado for maior que o stake atual (seja base ou Kelly)
      if (requiredStake > nextStake) {
        nextStake = requiredStake;
      }
    }
  }
  
  // --- 3. PROTEÇÃO DE LIMITE ---
  const maxSafeStake = Math.max(baseStake, currentBankroll * 0.10); // Nunca arriscar mais de 10% do capital atual
  if (nextStake > maxSafeStake) {
    nextStake = baseStake;
  }
  
  return { nextStake: parseFloat(nextStake.toFixed(2)), shouldPause: false };
}
