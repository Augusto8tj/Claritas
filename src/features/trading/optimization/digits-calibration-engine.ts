// src/features/trading/optimization/digits-calibration-engine.ts
'use client';

/**
 * @fileOverview Motor de Calibração e Otimização para Estratégias de Dígitos.
 *
 * OBJETIVO:
 * Este módulo utiliza o `digits-backtest-engine` para executar uma busca em grade (grid search)
 * sobre os parâmetros de uma estratégia, identificando a combinação que produz os melhores
 * resultados ajustados ao risco em dados históricos.
 */

import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
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
}

// ============================================================================
// 2. DEFINIÇÃO DO ESPAÇO DE BUSCA DE PARÂMETROS
// ============================================================================

/**
 * Mapeia cada estratégia ao seu espaço de busca de parâmetros.
 * Este é o "mapa genético" para a otimização.
 */
export const STRATEGY_SEARCH_SPACES: Record<string, ParamSearchSpace[]> = {
  matchesDiffers: [
    { paramKey: 'consensusThreshold', values: [15, 20, 25, 30, 35, 40] }
  ],
  overUnder: [
    { paramKey: 'overUnderThreshold', values: [60, 65, 70, 75] }
  ],
  evenOdd: [
    { paramKey: 'evenOddThreshold', values: [60, 65, 70, 75] }
  ],
  underdog: [
    { paramKey: 'underdogThreshold', values: [4.0, 5.0, 6.0, 7.0] },
    { paramKey: 'isUnderdogInverse', values: [true, false] }
  ],
  underdogOverUnder: [
    { paramKey: 'overUnderUnderdogThreshold', values: [35, 40, 45] }
  ],
  underdogEvenOdd: [
    { paramKey: 'evenOddUnderdogThreshold', values: [35, 40, 45] }
  ],
  // Estratégias sem parâmetros de usuário não são calibradas desta forma.
  dynamicUnderdogOverUnder: [],
};


// ============================================================================
// 3. LÓGICA DO MOTOR DE CALIBRAÇÃO
// ============================================================================

/**
 * Gera todas as combinações de parâmetros para a busca em grade.
 * @param searchSpaces - A configuração do espaço de busca.
 * @returns Um iterador para as combinações de parâmetros.
 */
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

/**
 * Heurística para pontuar a qualidade de um resultado de backtest.
 * Recompensa lucro e winrate, mas penaliza severamente o drawdown.
 * @param summary - O resumo do backtest.
 * @returns Uma pontuação numérica.
 */
function calculateQualityScore(summary: BacktestSummary): number {
  const { totalProfit, winrate, maxDrawdown, profitFactor, totalTrades } = summary;

  if (totalProfit <= 0 || totalTrades < 10) {
    return -1000 + totalProfit; // Penalidade forte para estratégias não lucrativas ou com poucos dados
  }
  
  // Normalizar Drawdown para ser um fator de penalidade (quanto maior, pior)
  const drawdownPenalty = 1 + (maxDrawdown / 100);

  // A pontuação base prioriza o Profit Factor (relação lucro/prejuízo)
  // e a taxa de acerto.
  const score = (profitFactor * winrate) / drawdownPenalty;
  
  // Bônus por consistência (baixo drawdown)
  const consistencyBonus = (1 - (maxDrawdown / 100)) * 10;
  
  return score + consistencyBonus;
}

/**
 * Executa uma calibração por busca em grade para uma dada estratégia.
 * @param ticks - Array de dados de ticks históricos.
 * @param config - A configuração da calibração.
 * @returns Uma Promise com os resultados da calibração.
 */
export async function calibrateStrategy(
  ticks: TickData[],
  config: StrategyCalibrationConfig
): Promise<CalibrationResult> {
  
  const combinations = generateParamCombinations(config.searchSpaces);
  const testedConfigs: CalibrationResult['testedConfigs'] = [];
  
  let bestParams: StrategyParams = {};
  let bestSummary: BacktestSummary | null = null;
  let bestScore = -Infinity;

  for (const params of combinations) {
    const backtestConfig: BacktestConfig = {
      ...config.backtestConfigBase,
      strategy: config.strategyDef,
      paramsOverride: params,
    };
    
    // A função de backtest é síncrona, não precisamos de await aqui.
    const { summary } = runDigitsBacktest(ticks, backtestConfig);
    const qualityScore = calculateQualityScore(summary);
    
    testedConfigs.push({ params, summary, qualityScore });
    
    if (qualityScore > bestScore) {
      bestScore = qualityScore;
      bestParams = params;
      bestSummary = summary;
    }
  }
  
  if (!bestSummary) {
    throw new Error('Calibração falhou: Nenhum resultado de backtest foi gerado.');
  }

  // CORREÇÃO: Garante que bestSummary tenha strategyId
  bestSummary.strategyId = config.strategyDef.id;

  return { bestParams, bestSummary, testedConfigs };
}

// ============================================================================
// 4. INTEGRAÇÃO COM FIRESTORE (PLACEHOLDERS)
// ============================================================================

/**
 * Salva o resultado de uma calibração no Firestore.
 * @param userId - O ID do usuário.
 * @param strategyId - O ID da estratégia.
 * @param result - O objeto CalibrationResult a ser salvo.
 */
export async function saveCalibrationResult(userId: string, strategyId: PilotType, result: CalibrationResult): Promise<void> {
  // if (!userId) throw new Error("Usuário não autenticado.");
  // const docRef = doc(db, 'users', userId, 'digits_calibrations', strategyId);
  // const dataToSave = {
  //   lastCalibrated: new Date().toISOString(),
  //   bestParams: result.bestParams,
  //   bestSummary: result.bestSummary,
  // };
  // await setDoc(docRef, sanitizeForFirestore(dataToSave), { merge: true });
  console.log(`[Placeholder] Salvaria no Firestore para ${userId}/${strategyId}:`, result.bestParams);
}

/**
 * Carrega o último resultado de calibração do Firestore.
 * @param userId - O ID do usuário.
 * @param strategyId - O ID da estratégia.
 * @returns Os melhores parâmetros e resumo, ou null.
 */
export async function loadLastCalibration(userId: string, strategyId: PilotType): Promise<{ params: StrategyParams; summary: BacktestSummary } | null> {
  // if (!userId) return null;
  // const docRef = doc(db, 'users', userId, 'digits_calibrations', strategyId);
  // const docSnap = await getDoc(docRef);
  // if (docSnap.exists()) {
  //   const data = docSnap.data();
  //   return { params: data.bestParams, summary: data.bestSummary };
  // }
  // return null;
  console.log(`[Placeholder] Carregaria do Firestore para ${userId}/${strategyId}`);
  return null;
}
