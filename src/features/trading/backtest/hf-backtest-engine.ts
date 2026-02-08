// src/features/trading/backtest/hf-backtest-engine.ts
import type { CandleData, TickData } from '@/lib/types';
import type { HFConfig } from '@/features/trading/components/hf-trader/hf-config-panel';
import { 
    detectHFMeanReversionZone, 
    detectStandardTrendZone,
    detectBollingerSqueezeZone,
    detectVolumeAbsorptionZone,
    detectMicrostructureScalpZone,
    type StrikeZone,
    StrategyType
} from '@/features/trading/services/hf-strike-logic';
import { calculateAllIndicators } from '@/features/trading/services/indicator-service';
import { getCouncilStrategies } from '@/features/trading/services/council-strategies';
import { strategyMetadata } from '@/features/trading/services/hf-strike-logic';


// --- TYPES ---
export interface TradeResult {
  entryPrice: number;
  exitPrice: number;
  result: 'win' | 'loss';
  pnl: number;
  durationInCandles: number;
  strikeZone: StrikeZone;
  strategy: StrategyType;
}

export interface BacktestResult {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  trades: TradeResult[];
}

// --- HELPERS ---
function convertToTicks(candles: CandleData[]): TickData[] {
    return candles.map(c => ({ epoch: c.epoch, price: c.close }));
}

function calculateBacktestMetrics(trades: TradeResult[]): BacktestResult {
  const wins = trades.filter(t => t.result === 'win').length;
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);

  return { totalTrades, winRate, totalPnl, trades };
}

function simulateTradeOutcome(
  entryCandleIndex: number,
  strikeZone: StrikeZone,
  allCandles: CandleData[],
  strategy: StrategyType,
  stake: number
): { exitPrice: number; exitIndex: number; result: 'win' | 'loss'; pnl: number, durationInCandles: number } {
  const entryPrice = strikeZone.entry.price;
  const { takeProfit, stopLoss } = strikeZone.targets;
  
  let tradeDurationInCandles: number;

  switch (strategy) {
    case 'MICROSTRUCTURE_SCALP':
        tradeDurationInCandles = 1; // Approx. 5 ticks within the next candle
        break;
    case 'STD_TREND_FOLLOW':
    case 'VOLUME_ABSORPTION':
        tradeDurationInCandles = 3; // Based on 15m chart, so 3 candles of 1m data
        break;
    default: // HF strategies based on seconds
        const candleDurationSeconds = allCandles[1] ? allCandles[1].epoch - allCandles[0].epoch : 60;
        tradeDurationInCandles = Math.max(1, Math.ceil(strikeZone.duration / candleDurationSeconds));
        break;
  }
  
  const exitWindow = allCandles.slice(entryCandleIndex + 1, entryCandleIndex + 1 + tradeDurationInCandles);

  for (let i = 0; i < exitWindow.length; i++) {
    const candle = exitWindow[i];
    if (!candle) continue;

    if (strikeZone.type === 'LONG_ENTRY') {
      if (candle.high >= takeProfit) return { result: 'win', pnl: stake * strikeZone.targets.riskReward, exitPrice: takeProfit, exitIndex: entryCandleIndex + 1 + i, durationInCandles: i+1 };
      if (candle.low <= stopLoss) return { result: 'loss', pnl: -stake, exitPrice: stopLoss, exitIndex: entryCandleIndex + 1 + i, durationInCandles: i+1 };
    } else { // SHORT_ENTRY
      if (candle.low <= takeProfit) return { result: 'win', pnl: stake * strikeZone.targets.riskReward, exitPrice: takeProfit, exitIndex: entryCandleIndex + 1 + i, durationInCandles: i+1 };
      if (candle.high >= stopLoss) return { result: 'loss', pnl: -stake, exitPrice: stopLoss, exitIndex: entryCandleIndex + 1 + i, durationInCandles: i+1 };
    }
  }

  const lastCandle = exitWindow[exitWindow.length - 1];
  if (!lastCandle) {
      return { result: 'loss', pnl: -stake, exitPrice: entryPrice, exitIndex: entryCandleIndex, durationInCandles: 0 };
  }
  
  const exitPrice = lastCandle.close;
  
  const finalPnl = strikeZone.type === 'LONG_ENTRY'
    ? (exitPrice > entryPrice ? stake * strikeZone.targets.riskReward : -stake)
    : (exitPrice < entryPrice ? stake * strikeZone.targets.riskReward : -stake);

  return { 
    result: finalPnl > 0 ? 'win' : 'loss', 
    pnl: finalPnl, 
    exitPrice, 
    exitIndex: entryCandleIndex + tradeDurationInCandles,
    durationInCandles: tradeDurationInCandles
  };
}

export function runAllStrategiesBacktest(
  historicalData: CandleData[],
  config: HFConfig,
): Record<StrategyType, BacktestResult> {
  const BACKTEST_STAKE = 1.0;
  const allStrategies: StrategyType[] = Object.keys(strategyMetadata) as StrategyType[];
  const allResults: Record<string, BacktestResult> = {};
  const initialStrategies = getCouncilStrategies('standard');

  for (const strategy of allStrategies) {
    const trades: TradeResult[] = [];
    let i = 100;
    let prevRsi = 50;
    
    const timePeriodForIndicators = strategyMetadata[strategy]?.isHF ? '1m' : '15m';

    while (i < historicalData.length - 30) {
      const windowCandles = historicalData.slice(0, i + 1);
      
      const indicators = calculateAllIndicators(windowCandles, initialStrategies, timePeriodForIndicators, { duration: 15, unit: 's' });
      if (!indicators) { i++; continue; }
      
      const currentPrice = windowCandles[windowCandles.length - 1].close;
      const windowTicks = convertToTicks(windowCandles); 

      let strikeZone: StrikeZone | null = null;
      switch (strategy) {
        case 'HF_MEAN_REVERSION':
          strikeZone = detectHFMeanReversionZone(indicators, currentPrice);
          break;
        case 'STD_TREND_FOLLOW':
          strikeZone = detectStandardTrendZone(indicators, currentPrice, prevRsi);
          break;
        case 'BOLLINGER_SQUEEZE':
          strikeZone = detectBollingerSqueezeZone(indicators, currentPrice);
          break;
        case 'VOLUME_ABSORPTION':
          strikeZone = detectVolumeAbsorptionZone(windowCandles, indicators);
          break;
        case 'MICROSTRUCTURE_SCALP':
          strikeZone = detectMicrostructureScalpZone(windowTicks, windowCandles, indicators, currentPrice);
          break;
      }
      
      if (indicators.rsi) prevRsi = indicators.rsi;
      
      if (strikeZone && strikeZone.confidence >= config.minConfidence && !strikeZone.triggers.some(t => t.startsWith('VETO'))) {
        const outcome = simulateTradeOutcome(i, strikeZone, historicalData, strategy, BACKTEST_STAKE);
        trades.push({ ...outcome, strikeZone, strategy });
        i = outcome.exitIndex;
      } else {
        i++;
      }
    }
    allResults[strategy] = calculateBacktestMetrics(trades);
  }

  return allResults as Record<StrategyType, BacktestResult>;
}
