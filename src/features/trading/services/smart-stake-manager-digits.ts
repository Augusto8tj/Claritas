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
  martingaleRecoveryInstallments: number; // NOVO: Número de parcelas para recuperação
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
  reasoning: string[]; // NOVO: Para explicar a decisão
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

  const edge = (b * p) - q;
  if (edge <= 0) return 0;

  const kellyFull = edge / b;
  const kellyFractional = kellyFull * kellyFraction;
  const stake = kellyFractional * bankroll;

  return Math.max(0, stake);
}


// ============================================================================
// 3. FUNÇÃO PRINCIPAL DE DECISÃO DE STAKE (V3.2 - RECUPERAÇÃO GRADUAL)
// ============================================================================

export function decideNextStake(
  tradeHistory: Operation[],
  config: SmartMartingaleConfig,
  bankrollState: BankrollState,
  contractType: DigitContractType,
  confidence: number = 0.55
): SmartStakeDecision {
  const { isEnabled, baseStake, maxMartingaleLevels, isSmart, martingaleRecoveryInstallments } = config;
  const { currentBankroll, initialBankroll, maxDailyLoss, dailyProfitTarget } = bankrollState;
  const reasoning: string[] = [];

  // --- 1. Circuit Breakers (Proteções de Risco) ---
  const dailyPnl = currentBankroll - (initialBankroll ?? currentBankroll);
  if (dailyPnl <= -maxDailyLoss) {
    return { nextStake: baseStake, shouldPause: true, pauseReason: `Stop Loss diário de $${maxDailyLoss.toFixed(2)} atingido.`, reasoning: ['Limite de perda diária atingido.'] };
  }
  if (dailyPnl >= dailyProfitTarget) {
    return { nextStake: baseStake, shouldPause: true, pauseReason: `Meta de lucro diária de $${dailyProfitTarget.toFixed(2)} atingida.`, reasoning: ['Meta de lucro diária atingida.'] };
  }
  
  const consecutiveLosses = countConsecutiveLosses(tradeHistory);
  const totalTrades = tradeHistory.length;
  if(totalTrades > 5) {
      const winRate = tradeHistory.filter(t => (t.result ?? 0) > 0).length / totalTrades;
      if (consecutiveLosses >= 3 && winRate < 0.45) {
          return {
              nextStake: baseStake,
              shouldPause: true,
              pauseReason: `Win rate da sessão (${(winRate * 100).toFixed(1)}%) abaixo de 45%. Pausando para revisão.`,
              reasoning: ['Baixo win rate após sequência de perdas.']
          };
      }
  }

  if (isEnabled && consecutiveLosses >= maxMartingaleLevels) {
    return { nextStake: baseStake, shouldPause: true, pauseReason: `Limite de ${maxMartingaleLevels} perdas seguidas atingido.`, reasoning: [`Atingido o limite de ${maxMartingaleLevels} perdas consecutivas.`] };
  }
  
  // --- 2. Lógica de Stake ---
  let nextStake = baseStake; 
  reasoning.push(`Aposta Base: $${baseStake.toFixed(2)}.`);
  
  // MODO 1: RECUPERAÇÃO GRADUAL (se em sequência de perdas)
  if (isEnabled && consecutiveLosses > 0) {
    // 1. Achar o montante total a recuperar (soma dos stakes perdidos)
    const lossesToRecover = tradeHistory
      .slice(-consecutiveLosses)
      .reduce((sum, trade) => sum + trade.stake, 0);

    const payoutRatio = getPayoutRatio(contractType);

    if (payoutRatio > 0 && martingaleRecoveryInstallments > 0) {
      // 2. Calcular o lucro extra necessário por trade para recuperar em N parcelas
      const requiredExtraProfitPerTrade = lossesToRecover / martingaleRecoveryInstallments;
      
      // 3. Calcular o stake adicional para gerar esse lucro
      // Lucro = StakeAdicional * PayoutRatio. Logo, StakeAdicional = Lucro / PayoutRatio
      const stakeAddon = requiredExtraProfitPerTrade / payoutRatio;
      
      nextStake += stakeAddon;
      reasoning.push(`Recuperação Gradual: +$${stakeAddon.toFixed(2)} para recuperar $${lossesToRecover.toFixed(2)} em ${martingaleRecoveryInstallments}x.`);
    }
  }
  // MODO 2: KELLY CRITERION (se isSmart e não em recuperação)
  else if (isSmart) {
    const payoutOdds = getPayoutRatio(contractType);
    const kellyStake = calculateKellyStake(confidence, payoutOdds, currentBankroll);
    
    if (kellyStake > baseStake) {
      nextStake = kellyStake;
      reasoning.pop(); // Remove aposta base
      reasoning.push(`Kelly Stake (Vantagem Detectada): $${kellyStake.toFixed(2)}.`);
    }
  }
  
  // --- 3. PROTEÇÃO DE LIMITE ---
  const maxSafeStake = Math.max(baseStake, currentBankroll * 0.10); 
  if (nextStake > maxSafeStake) {
    reasoning.push(`⚠️ Stake de $${nextStake.toFixed(2)} excede o limite de segurança ($${maxSafeStake.toFixed(2)}). Reduzindo para aposta base.`);
    nextStake = baseStake;
  }
  
  return { nextStake: parseFloat(nextStake.toFixed(2)), shouldPause: false, reasoning };
}
