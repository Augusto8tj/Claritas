// src/features/trading/backtest/digits-backtest-engine.ts
'use client';

/**
 * @fileOverview Motor de Backtesting Offline V2 para Estratégias de Dígitos.
 *
 * NOVO NA V2:
 * - CONSENSO MULTI-TIMEFRAME: As decisões agora são baseadas no consenso de 3 janelas
 *   de tempo (50, 200, 1000 ticks), tornando os sinais mais robustos.
 * - ANÁLISE DE BASELINE: O sumário agora inclui uma comparação com o Valor Esperado (EV)
 *   de uma aposta aleatória para o mesmo tipo de contrato.
 */

import type { TickData } from '@/lib/types';
import type { DigitStrategyDefinition, PilotType, DigitContractType } from '@/app/deriv-trader-digits/strategies-config';
import { calculateDigitStatsForWindow, type WindowDigitStats } from '@/features/trading/services/digits-analysis';


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
  strategyId?: PilotType;
  evPerTrade: number;
  randomBaselineEv: number;
  isProfitableVsRandom: boolean;
}

export interface StrategyBacktestResult extends BacktestSummary {
  strategyId: PilotType;
}

// ============================================================================
// 2. FUNÇÕES AUXILIARES E CONSTANTES
// ============================================================================
const WINDOW_SIZES = [50, 200, 1000];
const CONSENSUS_THRESHOLD = 2; // Pelo menos 2 das 3 janelas devem concordar

const getLastDigit = (price: number): number => {
    const priceString = String(price);
    if (priceString.includes('.')) {
        return parseInt(priceString.slice(-1), 10);
    }
    return price % 10;
};

const PAYOUTS = {
  DIGITDIFF: 0.10,
  DIGITMATCH: 9.0,
  DIGITOVER: 0.95,
  DIGITUNDER: 0.95,
  DIGITEVEN: 0.95,
  DIGITODD: 0.95,
};

const RANDOM_WINRATES = {
  DIGITDIFF: 0.90,
  DIGITMATCH: 0.10,
  DIGITOVER: 0.50, // 5,6,7,8,9 vs 0,1,2,3,4
  DIGITUNDER: 0.50,
  DIGITEVEN: 0.50,
  DIGITODD: 0.50,
};

// ============================================================================
// 3. MOTOR PRINCIPAL DE BACKTEST
// ============================================================================

export function runDigitsBacktest(
  ticks: TickData[],
  config: BacktestConfig
): { summary: BacktestSummary; trades: BacktestTradeResult[] } {
  const { strategy, paramsOverride, stakePerTrade } = config;
  const trades: BacktestTradeResult[] = [];
  
  const params = { ...strategy.otherParams, ...paramsOverride };
  const DURATION_IN_TICKS = 1;
  const maxWindow = Math.max(...WINDOW_SIZES);

  for (let i = maxWindow; i < ticks.length - DURATION_IN_TICKS; i++) {
    if (config.maxTrades && trades.length >= config.maxTrades) break;

    const entryTick = ticks[i];
    const exitTick = ticks[i + DURATION_IN_TICKS];
    const actualDigit = getLastDigit(exitTick.price);

    const windowStats = WINDOW_SIZES.map(size => 
      calculateDigitStatsForWindow(ticks.slice(0, i + 1), size, getDecimalPlaces(activeAsset?.pip ?? 2))
    );

    let tradeTriggered = false;
    let contractType: DigitContractType | null = null;
    let targetDigit: number | undefined;

    switch (strategy.id as PilotType) {
        case 'matchesDiffers': {
            const threshold = (params.consensusThreshold ?? 25) / 100;
            const hottestDigits = windowStats.map(w => w.hottestDigit);
            const consensusHottest = findConsensusDigit(hottestDigits);
            
            if (consensusHottest !== null && windowStats[0].frequencies[consensusHottest].probability > threshold) {
                tradeTriggered = true;
                contractType = 'DIGITDIFF';
                targetDigit = consensusHottest;
            }
            break;
        }
        case 'underdog': {
            const threshold = (params.underdogThreshold ?? 5.0) / 100;
            const isInverse = params.isUnderdogInverse ?? false;
            const coldestDigits = windowStats.map(w => w.coldestDigit);
            const consensusColdest = findConsensusDigit(coldestDigits);

            if (consensusColdest !== null && windowStats[0].frequencies[consensusColdest].probability <= threshold) {
                tradeTriggered = true;
                contractType = isInverse ? 'DIGITDIFF' : 'DIGITMATCH';
                targetDigit = consensusColdest;
            }
            break;
        }
        // ... Lógica para outras estratégias com consenso
    }
    
    if (tradeTriggered && contractType) {
        let win = false;
        switch (contractType) {
            case 'DIGITDIFF': win = actualDigit !== targetDigit; break;
            case 'DIGITMATCH': win = actualDigit === targetDigit; break;
            // ...
        }
        
        const payoutRate = PAYOUTS[contractType];
        const pnl = win ? stakePerTrade * payoutRate : -stakePerTrade;

        trades.push({
            tickIndex: i, entryPrice: entryTick.price, exitPrice: exitTick.price,
            contractType, targetDigit, actualDigit, stake: stakePerTrade, pnl, win,
        });
    }
  }

  const summary = calculateBacktestSummary(trades, config.initialBankroll, config.strategy);
  return { summary, trades };
}

function findConsensusDigit(digits: number[]): number | null {
    const counts: Record<number, number> = {};
    digits.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
    const consensusEntry = Object.entries(counts).find(([, count]) => count >= CONSENSUS_THRESHOLD);
    return consensusEntry ? parseInt(consensusEntry[0], 10) : null;
}

function calculateBacktestSummary(
  trades: BacktestTradeResult[],
  initialBankroll: number,
  strategy: DigitStrategyDefinition
): BacktestSummary {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return { totalTrades: 0, wins: 0, losses: 0, winrate: 0, totalProfit: 0, maxDrawdown: 0, profitFactor: 0, evPerTrade: 0, randomBaselineEv: 0, isProfitableVsRandom: false };
  }

  const wins = trades.filter(t => t.win).length;
  const losses = totalTrades - wins;
  const winrate = (wins / totalTrades) * 100;
  const totalProfit = trades.reduce((sum, t) => sum + t.pnl, 0);

  let peakBankroll = initialBankroll;
  let maxDrawdown = 0;
  let currentBankroll = initialBankroll;
  trades.forEach(trade => {
    currentBankroll += trade.pnl;
    if (currentBankroll > peakBankroll) peakBankroll = currentBankroll;
    const drawdown = ((peakBankroll - currentBankroll) / peakBankroll) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  });

  const grossProfit = trades.filter(t => t.win).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => !t.win).reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;
  
  const evPerTrade = totalProfit / totalTrades;
  
  // Calcula o EV de uma aposta aleatória para o principal tipo de contrato da estratégia
  const contractTypeForEv = strategy.contractTypes[0];
  const randomWinrate = RANDOM_WINRATES[contractTypeForEv];
  const payout = PAYOUTS[contractTypeForEv];
  const randomBaselineEv = (randomWinrate * payout) - ((1 - randomWinrate) * 1);

  return {
    totalTrades, wins, losses, winrate, totalProfit, maxDrawdown, profitFactor,
    evPerTrade, randomBaselineEv, isProfitableVsRandom: evPerTrade > randomBaselineEv,
  };
}

const getDecimalPlaces = (pipSize: number | undefined): number => {
    if (pipSize === undefined || pipSize === null || pipSize <= 0) {
        return 2; 
    }
    if (Math.floor(pipSize) === pipSize && pipSize >= 1) {
        return 0;
    }
    const pipString = String(pipSize);
    if (pipString.includes('.')) {
        return pipString.split('.')[1].length;
    }
    return 0;
};

// Adicione esta variável global no topo do seu arquivo
let activeAsset: { pip: number } | null = null;

// E esta função para permitir que a UI atualize
export const setBacktestAssetContext = (asset: { pip: number } | null) => {
    activeAsset = asset;
};

```