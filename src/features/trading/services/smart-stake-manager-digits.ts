// src/features/trading/services/smart-stake-manager-digits.ts
'use client';

/**
 * @fileOverview Módulo de Gerenciamento de Risco e Stake V2 para Trading de Dígitos.
 * Contém a lógica para "Martingale Inteligente" e "Critério de Kelly Adaptativo".
 * Este módulo é composto por funções puras, sem dependências de React ou UI.
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
// 2. FUNÇÕES AUXILIARES OTIMIZADAS
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

/**
 * ✅ NOVO E OTIMIZADO: Calcula o Payout Ratio dinamicamente.
 */
const getPayoutRatio = (contractType: DigitContractType): number => {
    // Para contratos de dígitos da Deriv, o payout é ~95% sobre o stake.
    // O ganho líquido é stake * 0.95. A "odd" (b) no Critério de Kelly é o retorno líquido.
    if (contractType.includes('MATCH')) return 8.0; // Payout ~800%, odd ~8
    if (contractType.includes('DIFF')) return 0.10; // Payout ~10%, odd ~0.1
    return 0.95; // Para Par/Ímpar e Acima/Abaixo
};


/**
 * ✅ NOVO E OTIMIZADO: Critério de Kelly para dimensionamento de aposta.
 */
const calculateKellyStake = (
    confidence: ConfidenceLevel,
    payoutRatio: number,
    bankroll: number,
    baseStake: number,
    kellyFraction: number = 0.25 // Quarto de Kelly para segurança
): number => {
    // Mapear confiança para uma probabilidade de ganho (win probability)
    const confidenceToProb: Record<ConfidenceLevel, number> = {
        'MUITO_ALTA': 0.65, // Vantagem estatística muito forte
        'ALTA': 0.58,       // Vantagem moderada
        'MEDIA': 0.54,      // Vantagem marginal
        'BAIXA': 0.51,      // Quase aleatório, apostar mínimo
        'NULA': 0.50,       // Sem vantagem
    };

    const winProbability = confidenceToProb[confidence];
    const lossProbability = 1 - winProbability;
    
    // Odds (b) = lucro líquido / perda líquida
    // Ex: se aposta $1 e ganha $0.95, b = 0.95 / 1 = 0.95
    const b = payoutRatio; 

    // Fórmula de Kelly: f* = (bp - q) / b
    const kellyValue = (b * winProbability - lossProbability) / b;
    
    if (kellyValue <= 0) {
        return baseStake; // Se não há vantagem estatística, aposta o mínimo
    }
    
    const fractionalKellyStake = kellyValue * kellyFraction * bankroll;

    // Garante que o stake está entre o mínimo e um máximo de 5% da banca.
    return Math.max(baseStake, Math.min(fractionalKellyStake, bankroll * 0.05));
};

// ============================================================================
// 3. FUNÇÃO PRINCIPAL DE DECISÃO DE STAKE (VERSÃO CORRIGIDA)
// ============================================================================

export function decideNextStake(
  tradeHistory: Operation[],
  config: SmartMartingaleConfig,
  bankrollState: BankrollState,
  latestSignalConfidence: ConfidenceLevel,
  contractType: DigitContractType // ✅ NOVO: Recebe o tipo de contrato
): SmartStakeDecision {
  const { isEnabled, baseStake, maxMartingaleLevels, martingaleMultiplier, isSmart } = config;
  const { currentBankroll, initialBankroll, maxDailyLoss, dailyProfitTarget } = bankrollState;

  // --- 1. Circuit Breakers (Proteções de Risco) ---
  const dailyPnl = currentBankroll - initialBankroll;
  if (dailyPnl <= -maxDailyLoss) {
    return { nextStake: baseStake, shouldPause: true, pauseReason: `Stop Loss diário de $${maxDailyLoss.toFixed(2)} atingido.` };
  }
  if (dailyPnl >= dailyProfitTarget) {
    return { nextStake: baseStake, shouldPause: true, pauseReason: `Meta de lucro diária de $${dailyProfitTarget.toFixed(2)} atingida.` };
  }

  const consecutiveLosses = countConsecutiveLosses(tradeHistory);
  if (consecutiveLosses >= maxMartingaleLevels) {
    return { nextStake: baseStake, shouldPause: true, pauseReason: `Limite de ${maxMartingaleLevels} perdas seguidas atingido. Resetando ciclo.` };
  }

  // ✅ NOVO: Proteção contra drawdown excessivo baseado na performance da sessão
  if (consecutiveLosses >= 3 && tradeHistory.length > 10) {
      const totalWins = tradeHistory.filter(t => (t.result ?? 0) > 0).length;
      const sessionWinRate = totalWins / tradeHistory.length;
      if (sessionWinRate < 0.45) {
          return {
              nextStake: baseStake,
              shouldPause: true,
              pauseReason: `Win rate da sessão (${(sessionWinRate * 100).toFixed(1)}%) abaixo de 45%. Pausando para revisão.`,
          };
      }
  }

  // --- 2. Lógica Principal ---
  const payoutRatio = getPayoutRatio(contractType);
  let nextStake = calculateKellyStake(latestSignalConfidence, payoutRatio, currentBankroll, baseStake);

  const lastTrade = tradeHistory.length > 0 ? tradeHistory[tradeHistory.length - 1] : null;

  // Se a última operação foi uma perda e o Martingale está ativo
  if (isEnabled && lastTrade && (lastTrade.result ?? 0) < 0) {
    if (isSmart && (latestSignalConfidence === 'BAIXA' || latestSignalConfidence === 'NULA')) {
      // Martingale Inteligente: não aumenta aposta em sinal fraco
      return { nextStake: baseStake, shouldPause: false };
    }
    
    // ✅ CORREÇÃO: Martingale agora é um multiplicador sobre o stake calculado por Kelly,
    // tornando-o um "Adaptive Martingale", muito mais seguro.
    nextStake = nextStake * Math.pow(martingaleMultiplier, consecutiveLosses);
  }

  const maxSafeStake = currentBankroll * 0.20; // Não arriscar mais de 20% da banca em um trade
  if (nextStake > maxSafeStake) {
      return {
          nextStake: baseStake,
          shouldPause: true,
          pauseReason: `Martingale vetado: próximo stake ($${nextStake.toFixed(2)}) excede 20% do capital.`,
      };
  }

  return { nextStake: parseFloat(nextStake.toFixed(2)), shouldPause: false };
}
