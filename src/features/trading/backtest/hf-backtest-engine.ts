// src/features/trading/backtest/hf-backtest-engine.ts
// ✅ VERSION FULLY REWRITTEN TO INSTITUTIONAL STANDARD
import type { CandleData, TickData, ExecutionModel, InstitutionalBacktestResult, TradeResult as BaseTradeResult, WalkForwardResult, MonteCarloResult } from '@/lib/types';
import type { HFConfig } from '@/features/trading/components/hf-trader/hf-config-panel';
import { 
    detectHFMeanReversionZone, 
    detectStandardTrendZone,
    detectBollingerSqueezeZone,
    detectVolumeAbsorptionZone,
    detectMicrostructureScalpZone,
    detectRandomWalkZone,
    detectGBM20sZone,
    detectGBM40sZone,
    type StrikeZone,
    StrategyType,
    strategyMetadata,
    StrategyParams,
    getRandomAssetParams,
} from '@/features/trading/services/hf-strike-logic';
import { calculateAllIndicators } from '@/features/trading/services/indicator-service';
import { getCouncilStrategies } from '@/features/trading/services/council-strategies';
import { analyzeOptimalDuration } from '../services/gbm-calibrator';


// ============================================================================
// 1. MODELOS DE EXECUÇÃO E CUSTOS DE TRANSAÇÃO
// ============================================================================
interface TradeResult extends BaseTradeResult {
  durationInCandles: number;
}

const executionModels: Record<string, ExecutionModel> = {
  // Sintéticos Deriv
  '1HZ10V': { spread: 0.0002, slippage: 0.5, rejectionRate: 0.02, latencyMs: 100 },
  '1HZ25V': { spread: 0.0003, slippage: 1.0, rejectionRate: 0.05, latencyMs: 120 },
  '1HZ75V': { spread: 0.0005, slippage: 2.0, rejectionRate: 0.10, latencyMs: 150 },
  'R_75': { spread: 0.0004, slippage: 1.5, rejectionRate: 0.08, latencyMs: 130 },
  
  // Forex majors
  'frxEURUSD': { spread: 0.00008, slippage: 0.3, rejectionRate: 0.01, latencyMs: 80 },
  'frxGBPUSD': { spread: 0.00012, slippage: 0.5, rejectionRate: 0.02, latencyMs: 90 },
  'frxUSDJPY': { spread: 0.00010, slippage: 0.4, rejectionRate: 0.015, latencyMs: 85 },

  'default': { spread: 0.0003, slippage: 1.0, rejectionRate: 0.05, latencyMs: 120 },
};

function simulateRealisticExecution(
  targetPrice: number,
  candle: CandleData,
  direction: 'long' | 'short',
  model: ExecutionModel
): { executed: boolean; fillPrice: number; slippagePips: number } {
  const spreadCost = targetPrice * model.spread;
  const candleRange = candle.high - candle.low;
  const volatilityMultiplier = Math.min(2.0, candleRange / (candle.close * 0.001 || 0.0001));
  const actualSlippage = model.slippage * volatilityMultiplier;
  
  const isGap = candleRange > candle.close * 0.005;
  if (isGap && Math.random() < model.rejectionRate) {
    return { executed: false, fillPrice: 0, slippagePips: 0 };
  }
  
  let fillPrice: number;
  if (direction === 'long') {
    fillPrice = targetPrice + spreadCost + (actualSlippage * targetPrice / 10000);
  } else {
    fillPrice = targetPrice - spreadCost - (actualSlippage * targetPrice / 10000);
  }
  
  const wouldStillProfit = direction === 'long' 
    ? candle.high >= fillPrice 
    : candle.low <= fillPrice;
  
  return { 
    executed: wouldStillProfit, 
    fillPrice: wouldStillProfit ? fillPrice : targetPrice, 
    slippagePips: actualSlippage 
  };
}

function simulateTradeOutcome(
  entryCandleIndex: number,
  strikeZone: StrikeZone,
  allCandles: CandleData[],
  strategy: StrategyType,
  stake: number,
  execModel: ExecutionModel
): { exitPrice: number; exitIndex: number; result: 'win' | 'loss'; pnl: number, durationInCandles: number } {
  const entryPrice = strikeZone.entry.price;
  const { takeProfit, stopLoss } = strikeZone.targets;
  
  let tradeDurationInCandles: number;

  const candleDurationSeconds = allCandles && allCandles.length > 1 && allCandles[1].epoch > allCandles[0].epoch ? allCandles[1].epoch - allCandles[0].epoch : 60;
  
  switch (strategy) {
    case 'MICROSTRUCTURE_SCALP': tradeDurationInCandles = 1; break;
    case 'STD_TREND_FOLLOW':
    case 'VOLUME_ABSORPTION': tradeDurationInCandles = 3; break;
    default:
        tradeDurationInCandles = Math.max(1, Math.ceil(strikeZone.duration / candleDurationSeconds));
        break;
  }
  
  const exitWindow = allCandles.slice(entryCandleIndex + 1, entryCandleIndex + 1 + tradeDurationInCandles);

  for (let i = 0; i < exitWindow.length; i++) {
    const candle = exitWindow[i];
    if (!candle) continue;

    if (strikeZone.type === 'LONG_ENTRY') {
      const tpExec = simulateRealisticExecution(takeProfit, candle, 'long', execModel);
      if (tpExec.executed) return { result: 'win', pnl: stake * strikeZone.targets.riskReward, exitPrice: tpExec.fillPrice, exitIndex: entryCandleIndex + 1 + i, durationInCandles: i+1 };
      
      const slExec = simulateRealisticExecution(stopLoss, candle, 'long', execModel);
      if (candle.low <= slExec.fillPrice) return { result: 'loss', pnl: -stake, exitPrice: slExec.fillPrice, exitIndex: entryCandleIndex + 1 + i, durationInCandles: i+1 };

    } else { // SHORT_ENTRY
      const tpExec = simulateRealisticExecution(takeProfit, candle, 'short', execModel);
      if (tpExec.executed) return { result: 'win', pnl: stake * strikeZone.targets.riskReward, exitPrice: tpExec.fillPrice, exitIndex: entryCandleIndex + 1 + i, durationInCandles: i+1 };

      const slExec = simulateRealisticExecution(stopLoss, candle, 'short', execModel);
      if (candle.high >= slExec.fillPrice) return { result: 'loss', pnl: -stake, exitPrice: slExec.fillPrice, exitIndex: entryCandleIndex + 1 + i, durationInCandles: i+1 };
    }
  }

  const lastCandle = exitWindow[exitWindow.length - 1];
  if (!lastCandle) return { result: 'loss', pnl: -stake, exitPrice: entryPrice, exitIndex: entryCandleIndex, durationInCandles: 0 };
  
  const finalPnl = strikeZone.type === 'LONG_ENTRY'
    ? (lastCandle.close > entryPrice ? stake * strikeZone.targets.riskReward : -stake)
    : (lastCandle.close < entryPrice ? stake * strikeZone.targets.riskReward : -stake);

  return { result: finalPnl > 0 ? 'win' : 'loss', pnl: finalPnl, exitPrice: lastCandle.close, exitIndex: entryCandleIndex + tradeDurationInCandles, durationInCandles: tradeDurationInCandles };
}

// ============================================================================
// 2. MOTOR DE TICK SINTÉTICO
// ============================================================================

function generateSyntheticTicks(candle: CandleData, ticksPerCandle: number = 60): TickData[] {
  const ticks: TickData[] = [];
  const timeIncrement = 60 / ticksPerCandle;
  const drift = (candle.close - candle.open) / candle.open;
  const volatility = (candle.high - candle.low) / (candle.open || 1);
  let currentPrice = candle.open;
  for (let i = 0; i < ticksPerCandle; i++) {
    const dt = 1 / ticksPerCandle;
    const randomShock = (Math.random() - 0.5) * 2;
    const priceChange = currentPrice * (drift * dt + volatility * Math.sqrt(dt) * randomShock);
    currentPrice += priceChange;
    currentPrice = Math.max(candle.low, Math.min(candle.high, currentPrice));
    ticks.push({ epoch: candle.epoch - 60 + (i * timeIncrement), price: currentPrice });
  }
  ticks[ticks.length - 1].price = candle.close;
  return ticks;
}

function convertCandlesToSyntheticTicks(candles: CandleData[], ticksPerCandle: number = 60): TickData[] {
  return candles.flatMap(candle => generateSyntheticTicks(candle, ticksPerCandle));
}


// ============================================================================
// 3. CÁLCULO DE MÉTRICAS INSTITUCIONAIS
// ============================================================================

function getEmptyMetrics(): InstitutionalBacktestResult['metrics'] {
    return {
        sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0, maxDrawdown: 0, maxDrawdownDuration: 0,
        volatility: 0, profitFactor: 0, expectancy: 0, avgWin: 0, avgLoss: 0, largestWin: 0,
        largestLoss: 0, consecutiveWins: 0, consecutiveLosses: 0, winStreakAvg: 0,
        lossStreakAvg: 0, avgTradeDuration: 0, avgHoldingTimeMinutes: 0, tradesPerDay: 0,
        avgSpreadCost: 0, avgSlippage: 0, rejectionRate: 0,
    };
}

function calculateInstitutionalMetrics(trades: TradeResult[], historicalData: CandleData[], startingCapital: number = 1000, riskFreeRate: number = 0.02): InstitutionalBacktestResult['metrics'] {
    if (trades.length < 10) return getEmptyMetrics();

    const equityCurve = [startingCapital];
    trades.forEach(trade => equityCurve.push(equityCurve[equityCurve.length - 1] + trade.pnl));
    const returns = trades.map(t => t.pnl / startingCapital);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const annualizedReturn = avgReturn * 252;
    const annualizedStdDev = stdDev * Math.sqrt(252);
    const sharpeRatio = annualizedStdDev > 0 ? (annualizedReturn - riskFreeRate) / annualizedStdDev : 0;
    
    const downsideReturns = returns.filter(r => r < 0);
    const downsideVariance = downsideReturns.length > 0 ? downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length : 0;
    const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252);
    const sortinoRatio = downsideDeviation > 0 ? (annualizedReturn - riskFreeRate) / downsideDeviation : 0;
    
    let peak = equityCurve[0]; let maxDD = 0; let maxDDDuration = 0; let currentDDDuration = 0;
    equityCurve.forEach(equity => {
        if (equity > peak) { peak = equity; currentDDDuration = 0; }
        else { currentDDDuration++; const drawdown = ((peak - equity) / peak) * 100;
            if (drawdown > maxDD) { 
                maxDD = drawdown; 
                maxDDDuration = currentDDDuration;
            }
        }
    });
    
    const totalReturn = ((equityCurve[equityCurve.length - 1] - equityCurve[0]) / equityCurve[0]) * 100;
    
    const totalDays = (historicalData && historicalData.length > 1)
      ? (historicalData[historicalData.length - 1].epoch - historicalData[0].epoch) / 86400
      : 0;

    const cagr = totalDays > 0 ? (Math.pow(1 + totalReturn / 100, 365 / totalDays) - 1) * 100 : 0;
    const calmarRatio = maxDD > 0 ? cagr / maxDD : 0;
    
    const wins = trades.filter(t => t.result === 'win'); const losses = trades.filter(t => t.result === 'loss');
    const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;
    
    const winRate = wins.length / trades.length; const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
    const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);
    
    let currentStreak = 0; let maxWinStreak = 0; let maxLossStreak = 0; const winStreaks: number[] = []; const lossStreaks: number[] = [];
    trades.forEach(trade => {
        if (trade.result === 'win') { if (currentStreak < 0) lossStreaks.push(Math.abs(currentStreak)); currentStreak = currentStreak > 0 ? currentStreak + 1 : 1; maxWinStreak = Math.max(maxWinStreak, currentStreak); }
        else { if (currentStreak > 0) winStreaks.push(currentStreak); currentStreak = currentStreak < 0 ? currentStreak - 1 : -1; maxLossStreak = Math.max(maxLossStreak, Math.abs(currentStreak)); }
    });
    
    const winStreakAvg = winStreaks.length > 0 ? winStreaks.reduce((a, b) => a + b, 0) / winStreaks.length : 0;
    const lossStreakAvg = lossStreaks.length > 0 ? lossStreaks.reduce((a, b) => a + b, 0) / lossStreaks.length : 0;
    
    const avgTradeDuration = trades.reduce((sum, t) => sum + t.durationInCandles, 0) / trades.length;
    
    return {
        sharpeRatio: parseFloat(sharpeRatio.toFixed(2)), sortinoRatio: parseFloat(sortinoRatio.toFixed(2)), calmarRatio: parseFloat(calmarRatio.toFixed(2)),
        maxDrawdown: parseFloat(maxDD.toFixed(2)), maxDrawdownDuration: maxDDDuration,
        volatility: parseFloat((annualizedStdDev * 100).toFixed(2)),
        profitFactor: parseFloat(profitFactor.toFixed(2)), expectancy: parseFloat(expectancy.toFixed(2)),
        avgWin: parseFloat(avgWin.toFixed(2)), avgLoss: parseFloat(avgLoss.toFixed(2)),
        largestWin: Math.max(...wins.map(t => t.pnl), 0), largestLoss: Math.min(...losses.map(t => t.pnl), 0),
        consecutiveWins: maxWinStreak, consecutiveLosses: maxLossStreak,
        winStreakAvg: parseFloat(winStreakAvg.toFixed(1)), lossStreakAvg: parseFloat(lossStreakAvg.toFixed(1)),
        avgTradeDuration: parseFloat(avgTradeDuration.toFixed(1)), avgHoldingTimeMinutes: 0,
        tradesPerDay: totalDays > 0 ? trades.length / totalDays : 0, avgSpreadCost: 0, avgSlippage: 0, rejectionRate: 0,
    };
}

function calculateEquityAndMonthly(trades: TradeResult[], startingCapital: number): { equityCurve: any[], monthlyPerformance: any[] } {
    const equityCurve: any[] = [{ candle: 0, equity: startingCapital, drawdown: 0 }];
    const monthlyPerformance: Record<string, { month: string, trades: number, pnl: number, wins: number }> = {};
    let peakEquity = startingCapital;

    trades.forEach((trade, index) => {
        const prevEquity = equityCurve[equityCurve.length - 1].equity;
        const newEquity = prevEquity + trade.pnl;
        if (newEquity > peakEquity) peakEquity = newEquity;
        const drawdown = peakEquity > 0 ? ((peakEquity - newEquity) / peakEquity) * 100 : 0;
        equityCurve.push({ candle: index + 1, equity: newEquity, drawdown });
        
        const date = new Date(trade.strikeZone.entry.timestamp);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyPerformance[monthKey]) monthlyPerformance[monthKey] = { month: monthKey, trades: 0, pnl: 0, wins: 0 };
        monthlyPerformance[monthKey].trades++;
        monthlyPerformance[monthKey].pnl += trade.pnl;
        if (trade.result === 'win') monthlyPerformance[monthKey].wins++;
    });

    const monthlyArray = Object.values(monthlyPerformance).map(m => ({ ...m, winRate: (m.wins / m.trades) * 100 }));
    return { equityCurve, monthlyPerformance: monthlyArray };
}


// ============================================================================
// 4. MOTOR PRINCIPAL DO BACKTEST
// ============================================================================

function runSingleStrategyBacktest(
  historicalData: CandleData[],
  config: HFConfig,
  strategy: StrategyType,
  assetSymbol: string,
  params: StrategyParams
): InstitutionalBacktestResult {
    const BACKTEST_STAKE = 1.0;
    const trades: TradeResult[] = [];
    let i = 100;
    let prevRsi = 50;
    const timePeriodForIndicators = strategyMetadata[strategy]?.isHF ? '1m' : '15m';
    const initialStrategies = getCouncilStrategies('standard');
    const execModel = executionModels[assetSymbol] || executionModels.default;

    while (i < historicalData.length - 30) {
        const windowCandles = historicalData.slice(0, i + 1);
        const indicators = calculateAllIndicators(windowCandles, initialStrategies, timePeriodForIndicators, { duration: 15, unit: 's' });
        if (!indicators) { i++; continue; }
        
        const currentPrice = windowCandles[windowCandles.length - 1].close;
        
        let strikeZone: StrikeZone | null = null;
        switch (strategy) {
            case 'HF_MEAN_REVERSION': 
                strikeZone = detectHFMeanReversionZone(indicators, currentPrice, params.HF_MEAN_REVERSION); 
                break;
            case 'STD_TREND_FOLLOW': 
                strikeZone = detectStandardTrendZone(indicators, currentPrice, prevRsi, params.STD_TREND_FOLLOW); 
                break;
            case 'BOLLINGER_SQUEEZE': 
                strikeZone = detectBollingerSqueezeZone(indicators, currentPrice, params.BOLLINGER_SQUEEZE); 
                break;
            case 'VOLUME_ABSORPTION': 
                strikeZone = detectVolumeAbsorptionZone(windowCandles, indicators, params.VOLUME_ABSORPTION); 
                break;
            case 'MICROSTRUCTURE_SCALP':
                const syntheticTicks = convertCandlesToSyntheticTicks(windowCandles.slice(-20));
                strikeZone = detectMicrostructureScalpZone(syntheticTicks, windowCandles, indicators, currentPrice, params.MICROSTRUCTURE_SCALP);
                break;
            case 'GBM_20S':
                strikeZone = detectGBM20sZone(indicators, currentPrice, windowCandles, assetSymbol);
                break;
            case 'GBM_40S':
                strikeZone = detectGBM40sZone(indicators, currentPrice, windowCandles, assetSymbol);
                break;
        }
        
        if (indicators.rsi) prevRsi = indicators.rsi;
      
        if (strikeZone && strikeZone.confidence >= config.minConfidence && !strikeZone.triggers.some(t => t.startsWith('VETO'))) {
            const outcome = simulateTradeOutcome(i, strikeZone, historicalData, strategy, BACKTEST_STAKE, execModel);
            trades.push({ ...outcome, strikeZone, strategy });
            i = outcome.exitIndex;
        } else {
            i++;
        }
    }
    
    const metrics = calculateInstitutionalMetrics(trades, historicalData);
    const { equityCurve, monthlyPerformance } = calculateEquityAndMonthly(trades, 1000);
    const winRate = trades.length > 0 ? (trades.filter(t => t.result === 'win').length / trades.length) * 100 : 0;
    
    return {
        totalTrades: trades.length,
        winRate,
        totalPnl: trades.reduce((sum, t) => sum + t.pnl, 0),
        trades,
        metrics,
        equityCurve,
        monthlyPerformance,
        note: strategy === 'MICROSTRUCTURE_SCALP' ? 'Resultados baseados em ticks sintéticos.' : undefined
    };
}


export function runAllStrategiesBacktest(
  historicalData: CandleData[],
  config: HFConfig,
  assetSymbol: string,
  params: StrategyParams
): Record<StrategyType, InstitutionalBacktestResult> & { _optimalDurations?: any } {
  
  const allStrategies: StrategyType[] = Object.keys(strategyMetadata) as StrategyType[];
  const allResults: Partial<Record<StrategyType, InstitutionalBacktestResult>> = {};

  for (const strategy of allStrategies) {
    allResults[strategy] = runSingleStrategyBacktest(historicalData, config, strategy, assetSymbol, params);
  }

  // Consolidar todos os trades de todas as estratégias
  const allTrades = Object.values(allResults).flatMap(r => r?.trades || []);
  
  // Calcular duração dos candles em segundos
  const candleDurationSeconds = historicalData.length > 1 
    ? historicalData[1].epoch - historicalData[0].epoch 
    : 60;
  
  // Analisar tempo ótimo por estratégia
  const optimalDurations = analyzeOptimalDuration(allTrades, candleDurationSeconds);
  
  // Retornar junto com os resultados
  return {
    ...allResults,
    _optimalDurations: Object.fromEntries(optimalDurations),
  } as Record<StrategyType, InstitutionalBacktestResult> & { _optimalDurations: any };
}

// ============================================================================
// 5. ANÁLISE AVANÇADA (WALK-FORWARD & MONTE CARLO)
// ============================================================================

export function runWalkForwardAnalysis(
  historicalData: CandleData[],
  config: HFConfig,
  strategy: StrategyType,
  assetSymbol: string,
  params: StrategyParams,
  folds: number = 3
): WalkForwardResult[] {
  const foldSize = Math.floor(historicalData.length / (folds + 1));
  const results: WalkForwardResult[] = [];
  
  for (let i = 0; i < folds; i++) {
    const inSampleStart = i * foldSize;
    const inSampleEnd = inSampleStart + Math.floor(foldSize * 0.7);
    const inSampleData = historicalData.slice(inSampleStart, inSampleEnd);
    
    const oosSampleStart = inSampleEnd;
    const oosSampleEnd = oosSampleStart + Math.floor(foldSize * 0.3);
    const oosSampleData = historicalData.slice(oosSampleStart, oosSampleEnd);
    
    const inSampleResult = runSingleStrategyBacktest(inSampleData, config, strategy, assetSymbol, params);
    const oosSampleResult = runSingleStrategyBacktest(oosSampleData, config, strategy, assetSymbol, params);
    
    const sharpeDegradation = inSampleResult.metrics.sharpeRatio > 0
      ? ((inSampleResult.metrics.sharpeRatio - oosSampleResult.metrics.sharpeRatio) / inSampleResult.metrics.sharpeRatio) * 100
      : 0;
    
    const winRateDegradation = inSampleResult.winRate > 0
      ? ((inSampleResult.winRate - oosSampleResult.winRate) / inSampleResult.winRate) * 100
      : 0;
    
    const pfDegradation = inSampleResult.metrics.profitFactor > 0
      ? ((inSampleResult.metrics.profitFactor - oosSampleResult.metrics.profitFactor) / inSampleResult.metrics.profitFactor) * 100
      : 0;
    
    const avgDegradation = (sharpeDegradation + winRateDegradation + pfDegradation) / 3;
    
    results.push({
      inSample: inSampleResult,
      outOfSample: oosSampleResult,
      degradation: {
        sharpeRatio: sharpeDegradation,
        winRate: winRateDegradation,
        profitFactor: pfDegradation,
      },
      isRobust: avgDegradation < 20,
    });
  }
  
  return results;
}

const calculateStdDev = (arr: number[]): number => {
    if(arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / arr.length);
};

const calculateVaR = (pnlArray: number[], percentile: number): number => {
    if(pnlArray.length === 0) return 0;
    const sortedPnL = [...pnlArray].sort((a,b) => a - b);
    const index = Math.floor(pnlArray.length * (1 - percentile));
    return sortedPnL[index] || 0;
};

export function runMonteCarloSimulation(
  baselineResult: InstitutionalBacktestResult,
  historicalData: CandleData[],
  iterations: number = 1000
): MonteCarloResult {
  const scenarios: InstitutionalBacktestResult[] = [];
  
  for (let i = 0; i < iterations; i++) {
    const shuffledTrades = [...baselineResult.trades]
      .sort(() => Math.random() - 0.5);
    
    const scenarioResult = {
      ...baselineResult,
      trades: shuffledTrades,
      metrics: calculateInstitutionalMetrics(shuffledTrades, historicalData, 1000),
      ...calculateEquityAndMonthly(shuffledTrades, 1000)
    };
    
    scenarios.push(scenarioResult);
  }
  
  const sharpeRatios = scenarios.map(s => s.metrics.sharpeRatio).sort((a, b) => a - b);
  const profitableScenarios = scenarios.filter(s => s.totalPnl > 0).length;
  
  return {
    scenarios,
    statistics: {
      meanSharpe: sharpeRatios.reduce((a, b) => a + b, 0) / sharpeRatios.length,
      stdDevSharpe: calculateStdDev(sharpeRatios),
      percentile5: sharpeRatios[Math.floor(iterations * 0.05)],
      percentile50: sharpeRatios[Math.floor(iterations * 0.50)],
      percentile95: sharpeRatios[Math.floor(iterations * 0.95)],
    },
    probabilityOfProfit: (profitableScenarios / iterations) * 100,
    valueAtRisk95: calculateVaR(scenarios.map(s => s.totalPnl), 0.95),
  };
}
