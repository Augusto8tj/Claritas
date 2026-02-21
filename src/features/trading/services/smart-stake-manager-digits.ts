// /src/features/trading/services/smart-stake-manager-digits.ts
'use client';

/**
 * @fileOverview Módulo de Gerenciamento de Risco e Stake para Trading de Dígitos.
 * Contém a lógica para "Martingale Inteligente" e "Critério de Kelly".
 * Este módulo é composto por funções puras, sem dependências de React ou UI.
 */

// ============================================================================
// 1. INTERFACES E TIPOS DE DADOS
// ============================================================================

export type ConfidenceLevel = 'MUITO_ALTA' | 'ALTA' | 'MEDIA' | 'BAIXA' | 'NULA';

export interface TradeResult {
  id: string;
  timestamp: number;
  stake: number;
  profit: number; // positivo para ganho, negativo para perda
  contractType: 'DIGITDIFF' | 'DIGITMATCH';
  signalConfidence: ConfidenceLevel;
}

export interface SmartMartingaleConfig {
  baseStake: number;
  maxMartingaleLevels: number;
  martingaleMultiplier: number;    // ex.: 1.3 a 1.5
  useAntiMartingale: boolean;
  isSmart: boolean; // NOVO: Flag para Martingale Inteligente
}

export interface BankrollState {
  currentBankroll: number;
  initialBankroll: number;
  maxDailyLoss: number;            // valor absoluto
  dailyProfitTarget: number;       // valor absoluto
}

export interface SmartStakeDecision {
  nextStake: number;
  shouldPause: boolean;
  pauseReason?: string;
}

// ============================================================================
// 2. FUNÇÕES AUXILIARES INTERNAS
// ============================================================================

const countConsecutiveLosses = (tradeHistory: TradeResult[]): number => {
  let consecutiveLosses = 0;
  for (let i = tradeHistory.length - 1; i >= 0; i--) {
    if (tradeHistory[i].profit < 0) {
      consecutiveLosses++;
    } else {
      break;
    }
  }
  return consecutiveLosses;
};

const sumConsecutiveLosses = (tradeHistory: TradeResult[]): number => {
  let accumulatedLoss = 0;
  for (let i = tradeHistory.length - 1; i >= 0; i--) {
    if (tradeHistory[i].profit < 0) {
      accumulatedLoss += Math.abs(tradeHistory[i].profit);
    } else {
      break;
    }
  }
  return accumulatedLoss;
};

const countConsecutiveWins = (tradeHistory: TradeResult[]): number => {
    let consecutiveWins = 0;
    for (let i = tradeHistory.length - 1; i >= 0; i--) {
        if (tradeHistory[i].profit > 0) {
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
  tradeHistory: TradeResult[],
  config: SmartMartingaleConfig,
  bankrollState: BankrollState,
  latestSignalConfidence: ConfidenceLevel
): SmartStakeDecision {
  const { baseStake, maxMartingaleLevels, martingaleMultiplier, useAntiMartingale, isSmart } = config;
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

  if (!lastTrade || lastTrade.profit > 0) {
    if (useAntiMartingale) {
        const wins = countConsecutiveWins(tradeHistory);
        if (wins >= 3) {
            return { nextStake: baseStake * 1.2, shouldPause: false };
        }
    }
    return { nextStake: baseStake, shouldPause: false };
  }

  // --- 3. Lógica de Martingale ---
  const consecutiveLosses = countConsecutiveLosses(tradeHistory);

  if (consecutiveLosses > maxMartingaleLevels) {
    return {
      nextStake: baseStake,
      shouldPause: true,
      pauseReason: `Limite de ${maxMartingaleLevels} perdas seguidas atingido. Resetando ciclo.`,
    };
  }

  // --- Bloco de Lógica Inteligente ---
  if (isSmart) {
      const isSignalStrongEnough = (latestSignalConfidence === 'ALTA' || latestSignalConfidence === 'MUITO_ALTA');
      if (!isSignalStrongEnough) {
          return { nextStake: baseStake, shouldPause: false, pauseReason: 'Sinal fraco, Martingale Inteligente não aplicado. Resetando para stake base.' };
      }
  }

  // Se chegou aqui, ou é Martingale Normal, ou o Smart foi aprovado.
  const accumulatedLoss = sumConsecutiveLosses(tradeHistory);
  const payoutRatio = 0.95; // Para dígitos

  const simpleMartingaleStake = lastTrade.stake * martingaleMultiplier;
  const recoveryStake = (accumulatedLoss + baseStake) / payoutRatio;
  
  let nextStake = Math.max(simpleMartingaleStake, recoveryStake);

  // Verificação de segurança: não apostar mais que 20% do capital atual
  const maxSafeStake = currentBankroll * 0.20;
  
  if (nextStake > maxSafeStake) {
    return {
      nextStake: baseStake,
      shouldPause: true, // Pausa o piloto para proteger o capital
      pauseReason: `Martingale vetado: próximo stake ($${nextStake.toFixed(2)}) excede 20% do capital.`,
    };
  }

  return { nextStake: parseFloat(nextStake.toFixed(2)), shouldPause: false };
}
