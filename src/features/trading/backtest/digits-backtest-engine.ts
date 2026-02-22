// src/features/trading/backtest/digits-backtest-engine.ts
'use client';

/**
 * @fileOverview Motor de Backtesting Offline para Estratégias de Dígitos.
 *
 * OBJETIVO:
 * Este módulo permite a simulação de estratégias de dígitos em dados históricos de ticks,
 * fornecendo um resumo estatístico da performance para validar e calibrar as estratégias
 * antes de usá-las em tempo real.
 */

import type { TickData } from '@/lib/types';
import type { DigitStrategyDefinition, PilotType, DigitContractType } from '@/app/deriv-trader-digits/strategies-config';

// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

export interface BacktestConfig {
  strategy: DigitStrategyDefinition;
  paramsOverride?: Partial<Record<string, any>>;
  initialBankroll: number;
  stakePerTrade: number;
  maxTrades?: number;
}

export interface BacktestTradeResult {
  tickIndex: number;
  entryPrice: number;
  exitPrice: number;
  contractType: DigitContractType;
  targetDigit?: number;
  actualDigit: number;
  stake: number;
  pnl: number;
  win: boolean;
}

export interface BacktestSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winrate: number;
  totalProfit: number;
  maxDrawdown: number;
  profitFactor: number;
}

// ============================================================================
// 2. FUNÇÕES AUXILIARES E CONSTANTES
// ============================================================================

const getLastDigit = (price: number): number => {
    const priceString = String(price);
    if (priceString.includes('.')) {
        return parseInt(priceString.slice(-1), 10);
    }
    return price % 10;
};

/**
 * Payouts simplificados para cada tipo de contrato.
 * Em um sistema real, isso poderia ser obtido dinamicamente da API.
 */
const PAYOUTS = {
  DIGITDIFF: 0.10, // ~10% de lucro sobre a aposta
  DIGITMATCH: 9.0, // Retorno de 900% (stake * 9)
  DIGITOVER: 0.95, // ~95% de lucro
  DIGITUNDER: 0.95,
  DIGITEVEN: 0.95,
  DIGITODD: 0.95,
};


// ============================================================================
// 3. MOTOR PRINCIPAL DE BACKTEST
// ============================================================================

/**
 * Executa um backtest para uma estratégia de dígitos específica.
 * @param ticks - Array de dados históricos de ticks.
 * @param config - Configuração para o backtest, incluindo a estratégia.
 * @returns Um objeto com o resumo da performance e o log de trades.
 */
export function runDigitsBacktest(
  ticks: TickData[],
  config: BacktestConfig
): { summary: BacktestSummary; trades: BacktestTradeResult[] } {
  const { strategy, paramsOverride, stakePerTrade } = config;
  const trades: BacktestTradeResult[] = [];
  
  // Utiliza os parâmetros da definição da estratégia, mas permite overrides para calibração.
  const params = { ...strategy.otherParams, ...paramsOverride };

  // Para este motor, a duração do contrato é sempre de 1 tick.
  const DURATION_IN_TICKS = 1; 
  
  // A janela de análise é fixada em 100 ticks para consistência com a UI.
  const WINDOW_SIZE = 100;
  
  // O loop começa após a primeira janela poder ser formada e deixa um tick no final para o resultado.
  for (let i = WINDOW_SIZE; i < ticks.length - DURATION_IN_TICKS; i++) {
    
    // Para a simulação se o número máximo de trades for atingido.
    if (config.maxTrades && trades.length >= config.maxTrades) {
      break;
    }

    const analysisWindow = ticks.slice(i - WINDOW_SIZE, i);
    const entryTick = ticks[i];
    const exitTick = ticks[i + DURATION_IN_TICKS];
    const actualDigit = getLastDigit(exitTick.price);

    // Calcula as estatísticas de frequência dos dígitos na janela de análise.
    const counts = Array(10).fill(0);
    analysisWindow.forEach(tick => {
      const digit = getLastDigit(tick.price);
      if (!isNaN(digit)) {
        counts[digit]++;
      }
    });

    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    
    const stats = counts.map((count, digit) => ({
      digit,
      probability: (count / total) * 100,
    }));

    let tradeTriggered = false;
    let contractType: DigitContractType | null = null;
    let targetDigit: number | undefined;

    // --- LÓGICA DE DECISÃO PARA CADA ESTRATÉGIA ---
    switch (strategy.id as PilotType) {
        case 'matchesDiffers': {
            const threshold = params.consensusThreshold ?? 25;
            const mostProbable = [...stats].sort((a,b) => b.probability - a.probability)[0];
            if (mostProbable && mostProbable.probability > threshold) {
                tradeTriggered = true;
                contractType = 'DIGITDIFF';
                targetDigit = mostProbable.digit;
            }
            break;
        }
        case 'underdog': {
            const threshold = params.underdogThreshold ?? 5.0;
            const isInverse = params.isUnderdogInverse ?? false;
            const coldest = [...stats].sort((a,b) => a.probability - b.probability)[0];
            if (coldest && coldest.probability <= threshold) {
                tradeTriggered = true;
                contractType = isInverse ? 'DIGITDIFF' : 'DIGITMATCH';
                targetDigit = coldest.digit;
            }
            break;
        }
        case 'overUnder': {
            const threshold = params.overUnderThreshold ?? 65;
            const probOver4 = stats.filter(s => s.digit > 4).reduce((sum, s) => sum + s.probability, 0);
            if (probOver4 > threshold) {
                tradeTriggered = true;
                contractType = 'DIGITOVER';
                targetDigit = 4;
            } else if ((100 - probOver4) < (100 - threshold)) { // Probabilidade de ser < 5
                tradeTriggered = true;
                contractType = 'DIGITUNDER';
                targetDigit = 5;
            }
            break;
        }
        case 'evenOdd': {
            const threshold = params.evenOddThreshold ?? 65;
            const probEven = stats.filter(s => s.digit % 2 === 0).reduce((sum, s) => sum + s.probability, 0);
            if (probEven > threshold) {
                tradeTriggered = true;
                contractType = 'DIGITEVEN';
            } else if ((100 - probEven) > threshold) { // Probabilidade de Ímpar
                tradeTriggered = true;
                contractType = 'DIGITODD';
            }
            break;
        }
        // Futuras estratégias seriam adicionadas aqui...
    }
    
    // Se uma condição de trade foi satisfeita
    if (tradeTriggered && contractType) {
        let win = false;
        switch (contractType) {
            case 'DIGITDIFF': win = actualDigit !== targetDigit; break;
            case 'DIGITMATCH': win = actualDigit === targetDigit; break;
            case 'DIGITOVER': win = actualDigit > targetDigit!; break;
            case 'DIGITUNDER': win = actualDigit < targetDigit!; break;
            case 'DIGITEVEN': win = actualDigit % 2 === 0; break;
            case 'DIGITODD': win = actualDigit % 2 !== 0; break;
        }
        
        const payoutRate = PAYOUTS[contractType];
        const pnl = win ? stakePerTrade * payoutRate : -stakePerTrade;

        trades.push({
            tickIndex: i,
            entryPrice: entryTick.price,
            exitPrice: exitTick.price,
            contractType,
            targetDigit,
            actualDigit,
            stake: stakePerTrade,
            pnl,
            win,
        });
    }
  }

  // 4. CALCULAR O RESUMO FINAL
  const summary = calculateBacktestSummary(trades, config.initialBankroll);

  return { summary, trades };
}

/**
 * Calcula as métricas de resumo a partir de uma lista de trades.
 * @param trades - Array de trades resultantes do backtest.
 * @param initialBankroll - O capital inicial da simulação.
 * @returns Um objeto `BacktestSummary`.
 */
function calculateBacktestSummary(trades: BacktestTradeResult[], initialBankroll: number): BacktestSummary {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return { totalTrades: 0, wins: 0, losses: 0, winrate: 0, totalProfit: 0, maxDrawdown: 0, profitFactor: 0 };
  }

  const wins = trades.filter(t => t.win).length;
  const losses = totalTrades - wins;
  const winrate = (wins / totalTrades) * 100;
  const totalProfit = trades.reduce((sum, t) => sum + t.pnl, 0);

  // Cálculo do Max Drawdown
  let peakBankroll = initialBankroll;
  let maxDrawdown = 0;
  let currentBankroll = initialBankroll;
  trades.forEach(trade => {
    currentBankroll += trade.pnl;
    if (currentBankroll > peakBankroll) {
      peakBankroll = currentBankroll;
    }
    const drawdown = ((peakBankroll - currentBankroll) / peakBankroll) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  });

  // Cálculo do Profit Factor
  const grossProfit = trades.filter(t => t.win).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => !t.win).reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

  /**
   * COMPARAÇÃO COM BASELINE ALEATÓRIO (Documentação)
   * 
   * Para um contrato "Difere", a chance aleatória de ganhar é 90%. Com um payout de 10%,
   * o Valor Esperado (EV) aleatório é: (0.90 * 0.10) - (0.10 * 1) = -0.01. Ou seja, ligeiramente perdedor.
   * Nossa estratégia deve ter um EV > 0.
   * 
   * Para um contrato "Acima 4", a chance é de 50% (5/10 dígitos). Com payout de 95%,
   * o EV aleatório é: (0.5 * 0.95) - (0.5 * 1) = -0.025. Também perdedor.
   * 
   * A nossa estratégia será considerada viável se o `totalProfit / totalTrades` for positivo.
   */

  return {
    totalTrades,
    wins,
    losses,
    winrate,
    totalProfit,
    maxDrawdown,
    profitFactor,
  };
}
