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
  martingaleMultiplier: number; // This will be deprecated by the new logic, but kept for compatibility
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
    // A loss is when the result is negative. It includes the stake.
    if ((trade.result ?? 0) < 0) {
      consecutiveLosses++;
    } else {
      break; // Stop at the first win
    }
  }
  return consecutiveLosses;
};

// Payouts Corrigidos e Centralizados
const PAYOUTS: Record<DigitContractType, number> = {
  DIGITMATCH: 9.5,   // ~950% return on stake
  DIGITDIFF: 0.11,   // ~11% return on stake
  DIGITOVER: 0.95,   // ~95% return on stake
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
  kellyFraction: number = 0.25 // Quarter Kelly
): number {
  if (confidence <= 0.5) return 0;
  
  const p = confidence;
  const q = 1 - p;
  const b = payoutOdds; // Odds, ex: 0.95 para um contrato que paga 95%

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
      if (consecutiveLosses >= 3 && winRate < 0.45) { // Se WR for baixa após perdas, pausa.
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
    // ✅ CORRIGIDO: Usa o payout do contrato atual para o Kelly Criterion
    const payoutOdds = getPayoutRatio(contractType);
    const kellyStake = calculateKellyStake(confidence, payoutOdds, currentBankroll);
    
    // Usa o Kelly Stake se for maior que a base, indicando uma vantagem clara.
    if (kellyStake > baseStake) {
      nextStake = kellyStake;
    }
  }

  // MODO 2: MARTINGALE PRECISO (se em sequência de perdas)
  if (isEnabled && consecutiveLosses > 0) {
    const lossesToRecover = tradeHistory
      .slice(-consecutiveLosses)
      .reduce((sum, trade) => sum + trade.stake, 0); // Soma o stake perdido, não o resultado

    const payoutRatio = getPayoutRatio(contractType);

    if (payoutRatio > 0) {
      // Fórmula: Próximo_Stake = (Total_Perdido + Lucro_Desejado) / Taxa_De_Pagamento
      // Lucro desejado é a aposta base, para recuperar e ter um pequeno lucro.
      const requiredStake = (lossesToRecover + baseStake) / payoutRatio;
      
      // A lógica de Martingale só se aplica se o stake calculado for maior que o stake atual (seja base ou Kelly)
      if (requiredStake > nextStake) {
        nextStake = requiredStake;
      }
    }
  }
  
  // --- 3. PROTEÇÃO DE LIMITE ---
  // Nunca arriscar mais de 10% do capital atual em uma única aposta.
  const maxSafeStake = Math.max(baseStake, currentBankroll * 0.10); 
  if (nextStake > maxSafeStake) {
    // Se o stake calculado for muito alto, volta para a aposta base como medida de segurança.
    nextStake = baseStake;
  }
  
  return { nextStake: parseFloat(nextStake.toFixed(2)), shouldPause: false };
}
