// src/features/trading/optimization/digits-calibration-engine.ts
'use client';

/**
 * @fileOverview Motor de Calibração para Estratégias de Dígitos.
 * Realiza Grid Search e Walk-Forward Optimization para encontrar parâmetros robustos.
 */

import {
  runDigitsBacktest,
  type BacktestConfig,
  type BacktestSummary,
  type BacktestTradeResult,
} from '../backtest/digits-backtest-engine';
import type {
  DigitStrategyDefinition,
  PilotType,
} from '@/app/deriv-trader-digits/strategies-config';
import type { TickData } from '@/lib/types';
import { sanitizeForFirestore } from '@/services/utils/sanitize-for-firestore';

// ============================================================================
// 1. TIPOS E INTERFACES
// ============================================================================

export type StrategyParams = Record<string, number | string | boolean | number[] | undefined>;

export interface ParamSearchSpace {
  paramKey: string;
  values: (number | string | boolean)[];
}

export interface StrategyCalibrationConfig {
  strategyDef: DigitStrategyDefinition;
  searchSpaces: ParamSearchSpace[];
  backtestConfigBase: Omit<BacktestConfig, 'strategy' | 'paramsOverride'>;
}

export interface CalibrationResult {
  bestParams: StrategyParams;
  bestSummary: BacktestSummary;
  testedConfigs: Array<{
    params: StrategyParams;
    summary: BacktestSummary;
    qualityScore: number;
  }>;
  initialSummary: BacktestSummary; // Adicionado para comparação
}

// NOVO: Interface para resultados de Walk-Forward
export interface WalkForwardResult {
    inSampleSummary: BacktestSummary;
    outOfSampleSummary: BacktestSummary;
    params: StrategyParams;
    degradationPercent: number;
    isRobust: boolean;
}

// ============================================================================
// 2. DEFINIÇÃO DO ESPAÇO DE BUSCA DE PARÂMETROS
// ============================================================================

export const STRATEGY_SEARCH_SPACES: Record<string, ParamSearchSpace[]> = {
  matchesDiffers: [
    { paramKey: 'consensusThreshold', values: [15, 20, 25, 30, 35, 40] }
  ],
  overUnder: [
    { paramKey: 'overUnderThreshold', values: [55, 60, 65, 70, 75] }
  ],
  evenOdd: [
    { paramKey: 'evenOddThreshold', values: [55, 60, 65, 70, 75] }
  ],
  underdog: [
    { paramKey: 'underdogThreshold', values: [3.0, 4.0, 5.0, 6.0, 7.0] },
    { paramKey: 'isUnderdogInverse', values: [false] } 
  ],
  underdogOverUnder: [
    { paramKey: 'overUnderUnderdogThreshold', values: [35, 40, 45] }
  ],
  dynamicUnderdogOverUnder: [], // Sem parâmetros para otimizar por agora
  underdogEvenOdd: [
    { paramKey: 'evenOddUnderdogThreshold', values: [35, 40, 45] }
  ]
};


// ============================================================================
// 3. LÓGICA DO MOTOR DE CALIBRAÇÃO
// ============================================================================

function* generateParamCombinations(searchSpaces: ParamSearchSpace[]): Generator<StrategyParams> {
  if (searchSpaces.length === 0) {
    yield {};
    return;
  }
  const keys = searchSpaces.map(s => s.paramKey);
  const valueArrays = searchSpaces.map(s => s.values);
  function* recurse(index: number, currentParams: StrategyParams) {
    if (index === searchSpaces.length) {
      yield currentParams;
      return;
    }
    for (const value of valueArrays[index]) {
      const newParams = { ...currentParams, [keys[index]]: value };
      yield* recurse(index + 1, newParams);
    }
  }
  yield* recurse(0, {});
}

function calculateQualityScore(summary: BacktestSummary): number {
  const { totalProfit, winrate, maxDrawdown, profitFactor, totalTrades } = summary;
  
  if (totalProfit <= 0 || totalTrades < 10) return -1000 + totalProfit;

  // Normaliza o lucro pelo número de trades
  const profitPerTrade = totalProfit / totalTrades;
  
  // Penaliza fortemente drawdowns altos
  const drawdownPenalty = Math.pow((1 - (maxDrawdown / 100)), 2);

  const score = (profitPerTrade * winrate * profitFactor) * drawdownPenalty;
  
  // Bônus por baixo drawdown
  const consistencyBonus = (1 - (maxDrawdown / 100)) * 50;

  return score + consistencyBonus;
}

export function calibrateStrategyGridSearch(
  ticks: TickData[],
  config: StrategyCalibrationConfig
): CalibrationResult {
  const combinations = generateParamCombinations(config.searchSpaces);
  const testedConfigs: CalibrationResult['testedConfigs'] = [];
  let bestParams: StrategyParams = {};
  let bestSummary: BacktestSummary | null = null;
  let bestScore = -Infinity;

  // Executa um backtest inicial com os parâmetros padrão (vazios)
  const initialBacktestConfig: BacktestConfig = {
    ...config.backtestConfigBase,
    strategy: config.strategyDef,
    paramsOverride: {},
  };
  const { summary: initialSummary } = runDigitsBacktest(ticks, initialBacktestConfig);

  for (const params of combinations) {
    const backtestConfig: BacktestConfig = {
      ...config.backtestConfigBase,
      strategy: config.strategyDef,
      paramsOverride: params,
    };
    const { summary } = runDigitsBacktest(ticks, backtestConfig);
    const qualityScore = calculateQualityScore(summary);
    testedConfigs.push({ params, summary, qualityScore });
    if (qualityScore > bestScore) {
      bestScore = qualityScore;
      bestParams = params;
      bestSummary = summary;
    }
  }
  if (!bestSummary) throw new Error('Calibração falhou: Nenhum resultado de backtest foi gerado.');
  bestSummary.strategyId = config.strategyDef.id;
  return { bestParams, bestSummary, testedConfigs, initialSummary };
}

// NOVO: Função para Otimização Walk-Forward
export function calibrateStrategyWalkForward(
  ticks: TickData[],
  config: StrategyCalibrationConfig,
  numFolds: number = 5,
): WalkForwardResult[] {
    const totalTicks = ticks.length;
    const foldSize = Math.floor(totalTicks / numFolds);
    const stepSize = Math.floor(foldSize * 0.8); // 80% de sobreposição
    const testSize = foldSize - stepSize;
    const walkForwardResults: WalkForwardResult[] = [];
    
    for (let i = 0; i < numFolds - 1; i++) {
        const trainStart = i * stepSize;
        const trainEnd = trainStart + foldSize;
        const testStart = trainEnd;
        const testEnd = testStart + testSize;

        if (testEnd > totalTicks) break;

        const trainingData = ticks.slice(trainStart, trainEnd);
        const testingData = ticks.slice(testStart, testEnd);

        // 1. Otimizar parâmetros no conjunto de treino
        const { bestParams, bestSummary: inSampleSummary } = calibrateStrategyGridSearch(trainingData, config);

        // 2. Validar os melhores parâmetros no conjunto de teste (out-of-sample)
        const validationConfig: BacktestConfig = {
            ...config.backtestConfigBase,
            strategy: config.strategyDef,
            paramsOverride: bestParams,
        };
        const { summary: outOfSampleSummary } = runDigitsBacktest(testingData, validationConfig);
        
        // 3. Calcular degradação
        const degradation = inSampleSummary.totalProfit > 0 
            ? ((inSampleSummary.totalProfit - outOfSampleSummary.totalProfit) / inSampleSummary.totalProfit) * 100 
            : 0;

        walkForwardResults.push({
            inSampleSummary,
            outOfSampleSummary,
            params: bestParams,
            degradationPercent: degradation,
            isRobust: degradation < 30 && outOfSampleSummary.totalProfit > 0,
        });
    }

    return walkForwardResults;
}
