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
  gbmConfidenceThreshold: number; 
}

export interface CalibrationResult {
  strategy: StrategyType;
  success: boolean;
  initialTrades: number;
  finalTrades: number;
  initialSharpe: number;
  finalSharpe: number;
  finalParams: any;
  initialParams: any;
}

export interface AutoCalibrationResults extends Partial<Record<StrategyType, CalibrationResult>> {
    finalGbmThreshold?: number;
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
    // GBM strategies are handled in the main loop
    default:
      break;
  }
  return newParams;
};


export async function runAutoCalibration(
  config: AutoCalibratorConfig
): Promise<AutoCalibrationResults> {
  const { candles, initialParams, hfConfig, assetSymbol, targetTradeFrequency, maxIterations, onProgress, gbmConfidenceThreshold } = config;
  
  const finalResults: Partial<Record<StrategyType, CalibrationResult>> = {};

  const strategiesToCalibrate: StrategyType[] = [
    'HF_MEAN_REVERSION', 'STD_TREND_FOLLOW', 'BOLLINGER_SQUEEZE', 'VOLUME_ABSORPTION', 'MICROSTRUCTURE_SCALP', 'GBM_20S', 'GBM_40S'
  ];

  let sharedGbmThreshold = gbmConfidenceThreshold;

  for (const strategy of strategiesToCalibrate) {
    onProgress(strategy, 0, `Iniciando calibração para ${strategy}...`);

    let currentParams = { ...initialParams[strategy] };
    let currentGbmThresholdForLoop = sharedGbmThreshold;
    
    let bestParams = { ...currentParams };
    let bestGbmThreshold = currentGbmThresholdForLoop;

    const initialStrategyResult = runSingleStrategyBacktest(candles, hfConfig, strategy, assetSymbol, currentParams, { gbmConfidenceThreshold: currentGbmThresholdForLoop });
    let bestSharpe = initialStrategyResult?.metrics?.sharpeRatio ?? -Infinity;
    let bestTradeCount = initialStrategyResult?.totalTrades ?? 0;
    
    let iteration = 0;
    let goalMet = bestTradeCount >= targetTradeFrequency;

    while (iteration < maxIterations) {
      iteration++;
      
      let tempParams = { ...currentParams };
      let tempGbmThreshold = currentGbmThresholdForLoop;

      if (strategy === 'GBM_20S' || strategy === 'GBM_40S') {
        tempGbmThreshold = Math.max(5, tempGbmThreshold - 1);
      } else {
        tempParams = perturbParams(tempParams, strategy);
      }

      const currentRunResult = runSingleStrategyBacktest(candles, hfConfig, strategy, assetSymbol, tempParams, { gbmConfidenceThreshold: tempGbmThreshold });
      const currentTrades = currentRunResult?.totalTrades ?? 0;
      const currentSharpe = currentRunResult?.metrics?.sharpeRatio ?? -Infinity;
      
      onProgress(strategy, (iteration / maxIterations) * 100, `Iteração ${iteration}: ${currentTrades} trades, Sharpe ${currentSharpe.toFixed(2)}`);

      if (!goalMet) {
        if (currentTrades >= targetTradeFrequency) {
          goalMet = true;
          bestTradeCount = currentTrades;
          bestSharpe = currentSharpe;
          bestParams = tempParams;
          bestGbmThreshold = tempGbmThreshold;
        } else if (currentTrades > bestTradeCount) {
          bestTradeCount = currentTrades;
          bestSharpe = currentSharpe;
          bestParams = tempParams;
          bestGbmThreshold = tempGbmThreshold;
        }
      } else {
        if (currentTrades >= targetTradeFrequency && currentSharpe > bestSharpe) {
          bestTradeCount = currentTrades;
          bestSharpe = currentSharpe;
          bestParams = tempParams;
          bestGbmThreshold = tempGbmThreshold;
        }
      }
      
       currentParams = tempParams;
       currentGbmThresholdForLoop = tempGbmThreshold;

      if (goalMet && (strategy !== 'GBM_20S' && strategy !== 'GBM_40S')) break;
      if (iteration === maxIterations && !goalMet) {
          onProgress(strategy, 100, `Meta não atingida. Melhor resultado: ${bestTradeCount} trades.`);
      }
    }
    
    if (strategy === 'GBM_20S' || strategy === 'GBM_40S') {
        sharedGbmThreshold = bestGbmThreshold;
    }

    finalResults[strategy] = {
        strategy,
        success: bestTradeCount >= targetTradeFrequency,
        initialTrades: initialStrategyResult?.totalTrades ?? 0,
        finalTrades: bestTradeCount,
        initialSharpe: initialStrategyResult?.metrics?.sharpeRatio ?? -Infinity,
        finalSharpe: bestSharpe,
        finalParams: bestParams,
        initialParams: initialParams[strategy],
    };
     onProgress(strategy, 100, "Calibração concluída.");
  }
  
  const finalResultObject = { ...finalResults, finalGbmThreshold: sharedGbmThreshold };
  return finalResultObject as AutoCalibrationResults;
}
