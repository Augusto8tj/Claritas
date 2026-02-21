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
// 2. FUNÇÃO DE CÁLCULO DE KELLY
// ============================================================================

/**
 * Calcula o tamanho ideal da aposta usando o Critério de Kelly Fracionado.
 * @param winrate - A taxa de acerto histórica (0 a 1).
 * @param averageWin - O lucro médio das operações vencedoras.
 * @param averageLoss - O prejuízo médio das operações perdedoras (valor positivo).
 * @param bankroll - O capital total disponível.
 * @returns O valor da aposta recomendado.
 */
export function calculateKellyStake(
  winrate: number,
  averageWin: number,
  averageLoss: number,
  bankroll: number
): number {
  if (averageLoss === 0 || winrate <= 0) {
    return 0; // Evita divisão por zero ou cenários sem vitórias.
  }

  const p = winrate;
  const q = 1 - p;
  const b = averageWin / averageLoss; // Payout ratio

  // Se a vantagem matemática (edge) for negativa ou nula, não aposta nada.
  const edge = b * p - q;
  if (edge <= 0) {
    return 0;
  }

  const kellyFraction = edge / b;

  // Aplicar Quarter Kelly (25%) para segurança.
  const quarterKellyFraction = kellyFraction * 0.25;

  // Calcular o stake e aplicar um teto de segurança (ex: 5% do bankroll).
  const recommendedStake = bankroll * quarterKellyFraction;
  const cappedStake = Math.min(recommendedStake, bankroll * 0.05);

  return cappedStake;
}

// ============================================================================
// 3. FUNÇÕES AUXILIARES INTERNAS
// ============================================================================

/**
 * Conta o número de perdas consecutivas no final do histórico.
 */
const countConsecutiveLosses = (tradeHistory: TradeResult[]): number => {
  let consecutiveLosses = 0;
  for (let i = tradeHistory.length - 1; i >= 0; i--) {
    if (tradeHistory[i].profit < 0) {
      consecutiveLosses++;
    } else {
      break; // Interrompe na primeira vitória encontrada.
    }
  }
  return consecutiveLosses;
};

/**
 * Soma o valor das perdas consecutivas no final do histórico.
 */
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


/**
 * Conta o número de vitórias consecutivas no final do histórico.
 */
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
// 4. FUNÇÃO PRINCIPAL DE DECISÃO DE STAKE
// ============================================================================

/**
 * Decide o valor da próxima aposta com base no histórico, configurações e estado do capital.
 */
export function decideNextStake(
  tradeHistory: TradeResult[],
  config: SmartMartingaleConfig,
  bankrollState: BankrollState,
  latestSignalConfidence: ConfidenceLevel
): SmartStakeDecision {
  const { baseStake, maxMartingaleLevels, martingaleMultiplier, useAntiMartingale } = config;
  const { currentBankroll, initialBankroll, maxDailyLoss, dailyProfitTarget } = bankrollState;

  // --- 1. Circuit Breakers (Verificações de Segurança Máximas) ---
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

  // Se não houver histórico ou o último trade foi um ganho, reseta para o stake base.
  if (!lastTrade || lastTrade.profit > 0) {
    // Lógica Anti-Martingale (Opcional)
    if (useAntiMartingale) {
        const wins = countConsecutiveWins(tradeHistory);
        if (wins >= 3) { // Exemplo: aumentar após 3 vitórias seguidas
            return { nextStake: baseStake * 1.2, shouldPause: false };
        }
    }
    return { nextStake: baseStake, shouldPause: false };
  }

  // --- 3. Lógica de Martingale Inteligente (se o último trade foi perda) ---
  const consecutiveLosses = countConsecutiveLosses(tradeHistory);

  // Condição para aplicar o Martingale:
  const isSignalStrongEnough = latestSignalConfidence === 'ALTA' || latestSignalConfidence === 'MUITO_ALTA';
  const isWithinLevelLimit = consecutiveLosses <= maxMartingaleLevels;

  if (isSignalStrongEnough && isWithinLevelLimit) {
    // CORREÇÃO: Usa o acumulado de perdas para calcular a recuperação.
    const accumulatedLoss = sumConsecutiveLosses(tradeHistory);
    // Payout médio de 95% para contratos de dígito.
    const payoutRatio = 0.95; 
    const stakeToRecover = (accumulatedLoss + baseStake) / payoutRatio;
    
    // Aplica o multiplicador de agressividade
    const nextStake = stakeToRecover * martingaleMultiplier;

    const maxSafeStake = currentBankroll * 0.20;
    
    if (nextStake > maxSafeStake) {
         return {
            nextStake: baseStake,
            shouldPause: false,
            pauseReason: `Martingale vetado: próximo stake ($${nextStake.toFixed(2)}) excede 20% do capital.`
        };
    }

    return { nextStake: parseFloat(nextStake.toFixed(2)), shouldPause: false };

  } else {
    // Se o sinal não for forte o suficiente ou o limite de níveis foi atingido, reseta.
    const reason = !isSignalStrongEnough 
      ? 'Sinal fraco, Martingale não aplicado.' 
      : `Limite de ${maxMartingaleLevels} níveis de Martingale atingido. Resetando stake.`;
    
    return { nextStake: baseStake, shouldPause: false, pauseReason: reason };
  }
}
