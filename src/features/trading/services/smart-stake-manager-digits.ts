// src/features/trading/services/smart-stake-manager-digits.ts
'use client';

/**
 * @fileOverview Módulo de Gerenciamento de Risco e Stake V2.1 para Trading de Dígitos.
 * Contém a lógica para "Martingale Inteligente" e gerenciamento de capital.
 * Esta versão remove o Critério de Kelly para um controle mais direto do stake.
 */

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
  useAntiMartingale: boolean; // Not used in this version, but kept for interface consistency
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
    // Considera uma perda se o resultado for negativo.
    if ((trade.result ?? 0) < 0) {
      consecutiveLosses++;
    } else {
      // Para o contador na primeira vitória encontrada.
      break;
    }
  }
  return consecutiveLosses;
};


// ============================================================================
// 3. FUNÇÃO PRINCIPAL DE DECISÃO DE STAKE (VERSÃO 2.1)
// ============================================================================

export function decideNextStake(
  tradeHistory: Operation[],
  config: SmartMartingaleConfig,
  bankrollState: BankrollState,
  latestSignalConfidence: ConfidenceLevel
  // contractType é mantido para compatibilidade de assinatura, mas não usado ativamente nesta versão
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
    return { nextStake: baseStake, shouldPause: true, pauseReason: `Limite de ${maxMartingaleLevels} perdas seguidas atingido. Resetando para stake base.` };
  }

  // --- 2. Lógica de Stake ---
  
  let nextStake = baseStake; // O padrão é sempre o stake base.
  const lastTrade = tradeHistory.length > 0 ? tradeHistory[tradeHistory.length - 1] : null;

  // Aplica Martingale APENAS se estiver ativo E a última operação foi uma perda.
  if (isEnabled && lastTrade && (lastTrade.result ?? 0) < 0) {
    // Martingale Inteligente: não aumenta a aposta em um sinal de baixa confiança
    if (isSmart && (latestSignalConfidence === 'BAIXA' || latestSignalConfidence === 'NULA')) {
      return { nextStake: baseStake, shouldPause: false };
    }
    
    // Lógica Martingale simples: multiplica o stake *anterior* pelo fator.
    nextStake = lastTrade.stake * martingaleMultiplier;
  }
  
  // --- 3. Proteção Final de Capital ---
  const maxSafeStake = currentBankroll * 0.25; // Nunca arriscar mais de 25% da banca em um único trade.
  if (nextStake > maxSafeStake) {
    return {
      nextStake: baseStake,
      shouldPause: true,
      pauseReason: `Martingale vetado: próximo stake ($${nextStake.toFixed(2)}) excede 25% do capital. Resetando.`,
    };
  }
  
  return { nextStake: parseFloat(nextStake.toFixed(2)), shouldPause: false };
}
