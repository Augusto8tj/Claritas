// src/features/trading/optimization/auto-calibrator.ts
'use client';

import type { CandleData, InstitutionalBacktestResult } from '@/lib/types';
import type { StrategyParams, StrategyType } from '../services/hf-strike-logic';
import { runSingleStrategyBacktest } from '../backtest/hf-backtest-engine';
import type { HFConfig } from '../components/hf-trader/hf-config-panel';

export interface AutoCalibratorConfig {
  targetTradeFrequency: number; // Mínimo de trades por 1500 velas
  maxIterations: number;
  candles: CandleData[];
  initialParams: StrategyParams;
  hfConfig: HFConfig;
  assetSymbol: string;
  onProgress: (strategy: StrategyType, progress: number, details: string) => void;
}

export interface CalibrationResult {
  strategy: StrategyType;
  success: boolean;
  initialTrades: number;
  finalTrades: number;
  initialSharpe: number;
  finalSharpe: number;
  finalParams: any;
}

// Função para perturbar os parâmetros de forma mais agressiva
const perturbParams = (params: any, strategy: StrategyType): any => {
  const newParams = JSON.parse(JSON.stringify(params)); // Deep copy
  switch (strategy) {
    case 'HF_MEAN_REVERSION':
      newParams.rsiThreshold = Math.max(20, newParams.rsiThreshold - 1);
      newParams.tolerance = Math.min(0.1, newParams.tolerance + 0.005);
      break;
    case 'STD_TREND_FOLLOW':
      newParams.adxStrength = Math.max(15, newParams.adxStrength - 1);
      newParams.rsiMomentum = Math.max(50, newParams.rsiMomentum - 0.5);
      break;
    case 'BOLLINGER_SQUEEZE':
      newParams.bbwThreshold = Math.min(4.0, newParams.bbwThreshold + 0.2);
      break;
    case 'VOLUME_ABSORPTION':
      newParams.climaxMultiplier = Math.max(1.3, newParams.climaxMultiplier - 0.1);
      newParams.atrMultiplier = Math.max(0.5, newParams.atrMultiplier - 0.1);
      break;
    case 'MICROSTRUCTURE_SCALP':
        newParams.velocityThreshold = Math.max(0.8, newParams.velocityThreshold - 0.1);
        break;
    default:
      break;
  }
  return newParams;
};


export async function runAutoCalibration(
  config: AutoCalibratorConfig
): Promise<Record<StrategyType, CalibrationResult>> {
  const { candles, initialParams, hfConfig, assetSymbol, targetTradeFrequency, maxIterations, onProgress } = config;
  
  const finalResults: Record<string, CalibrationResult> = {};
  const strategiesToCalibrate: StrategyType[] = [
    'HF_MEAN_REVERSION', 'STD_TREND_FOLLOW', 'BOLLINGER_SQUEEZE', 'VOLUME_ABSORPTION', 'MICROSTRUCTURE_SCALP'
  ];

  for (const strategy of strategiesToCalibrate) {
    onProgress(strategy, 0, `Iniciando calibração para ${strategy}...`);

    let currentParams = { ...initialParams[strategy] };
    let bestParams = { ...currentParams };
    let bestResult: InstitutionalBacktestResult | null = null;
    let iteration = 0;

    // Run initial backtest to get a baseline
    const initialStrategyResult = runSingleStrategyBacktest(candles, hfConfig, strategy, assetSymbol, currentParams);
    let bestSharpe = initialStrategyResult?.metrics?.sharpeRatio ?? -Infinity;
    let bestTradeCount = initialStrategyResult?.totalTrades ?? 0;
    
    if (bestTradeCount >= targetTradeFrequency) {
        finalResults[strategy] = {
            strategy, success: true, initialTrades: bestTradeCount, finalTrades: bestTradeCount,
            initialSharpe: bestSharpe, finalSharpe: bestSharpe, finalParams: bestParams
        };
        onProgress(strategy, 100, "Meta já atingida com parâmetros iniciais.");
        continue;
    }

    while (iteration < maxIterations) {
      iteration++;
      currentParams = perturbParams(currentParams, strategy);

      const currentRunResult = runSingleStrategyBacktest(candles, hfConfig, strategy, assetSymbol, currentParams);
      
      const currentTrades = currentRunResult?.totalTrades ?? 0;
      const currentSharpe = currentRunResult?.metrics?.sharpeRatio ?? -Infinity;
      
      onProgress(strategy, (iteration / maxIterations) * 100, `Iteração ${iteration}: ${currentTrades} trades, Sharpe ${currentSharpe.toFixed(2)}`);
      
      if (currentTrades >= targetTradeFrequency) {
        if (currentSharpe > bestSharpe) {
          bestSharpe = currentSharpe;
          bestParams = { ...currentParams };
          bestTradeCount = currentTrades;
        }
      }
      
      // Stop if we found a decent balance
      if (currentTrades >= targetTradeFrequency && currentSharpe > 0.5) break;
    }

    finalResults[strategy] = {
        strategy, success: bestTradeCount >= targetTradeFrequency,
        initialTrades: initialStrategyResult?.totalTrades ?? 0, finalTrades: bestTradeCount,
        initialSharpe: initialStrategyResult?.metrics?.sharpeRatio ?? -Infinity, finalSharpe: bestSharpe,
        finalParams: bestParams
    };
     onProgress(strategy, 100, "Calibração concluída.");
  }

  return finalResults as Record<StrategyType, CalibrationResult>;
}
