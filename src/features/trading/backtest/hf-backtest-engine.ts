// src/features/trading/backtest/hf-backtest-engine.ts
import type { CandleData, TickData } from '@/lib/types';
import type { HFConfig } from '@/features/trading/components/hf-trader/hf-config-panel';
import { 
    analyzeBollingerBands, 
    analyzeRSI, 
    analyzeVolume, 
    detectStrikeZone,
    type StrikeZone
} from '../services/hf-strike-logic';
import type { Indicators } from '../services/indicator-service';

interface TradeResult {
  entryPrice: number;
  exitPrice: number;
  result: 'win' | 'loss';
  duration: number;
  strikeZone: StrikeZone;
}

interface BacktestResult {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  trades: TradeResult[];
}

function convertToTicks(candles: CandleData[]): TickData[] {
    return candles.map(c => ({ epoch: c.epoch, price: c.close }));
}

function simulateTradeOutcome(
  entryCandleIndex: number,
  strikeZone: StrikeZone,
  allCandles: CandleData[]
): { result: 'win' | 'loss'; exitPrice: number; exitIndex: number } {
  const entryPrice = strikeZone.entry.price;
  const { takeProfit, stopLoss } = strikeZone.targets;
  
  // Assume 1m candles, so duration in seconds needs to be converted
  const tradeDurationInCandles = Math.ceil(strikeZone.duration / 60);
  const exitWindow = allCandles.slice(entryCandleIndex + 1, entryCandleIndex + 1 + tradeDurationInCandles);

  for (let i = 0; i < exitWindow.length; i++) {
    const candle = exitWindow[i];
    if (!candle) continue; // Safety check

    if (strikeZone.type === 'LONG_ENTRY') {
      if (candle.high >= takeProfit) return { result: 'win', exitPrice: takeProfit, exitIndex: entryCandleIndex + 1 + i };
      if (candle.low <= stopLoss) return { result: 'loss', exitPrice: stopLoss, exitIndex: entryCandleIndex + 1 + i };
    } else { // SHORT_ENTRY
      if (candle.low <= takeProfit) return { result: 'win', exitPrice: takeProfit, exitIndex: entryCandleIndex + 1 + i };
      if (candle.high >= stopLoss) return { result: 'loss', exitPrice: stopLoss, exitIndex: entryCandleIndex + 1 + i };
    }
  }

  // If neither TP nor SL is hit, result is based on exit price at end of duration
  const lastCandle = exitWindow[exitWindow.length - 1];
  if (!lastCandle) {
      // If the exit window is empty (end of data), consider it a loss
      return { result: 'loss', exitPrice: entryPrice, exitIndex: entryCandleIndex };
  }
  
  const exitPrice = lastCandle.close;
  const result = strikeZone.type === 'LONG_ENTRY' 
    ? (exitPrice > entryPrice ? 'win' : 'loss')
    : (exitPrice < entryPrice ? 'win' : 'loss');

  return { result, exitPrice, exitIndex: entryCandleIndex + tradeDurationInCandles };
}

export async function runHFBacktest(
  historicalData: CandleData[],
  config: HFConfig,
  // Mock 'calculateAllIndicators' to avoid full dependency in this engine
  mockIndicatorsFn: (data: CandleData[]) => Partial<Indicators>
): Promise<BacktestResult> {
  const trades: TradeResult[] = [];
  let i = 60; // Warm-up period

  while (i < historicalData.length) {
    const windowCandles = historicalData.slice(0, i + 1);
    const windowTicks = convertToTicks(windowCandles);
    
    if(windowTicks.length === 0) {
        i++;
        continue;
    }
    
    const currentPrice = windowTicks[windowTicks.length - 1].price;
    const indicators = mockIndicatorsFn(windowCandles) as Indicators;
    
    // Call the pure analysis functions
    const bbAnalysis = analyzeBollingerBands(indicators.bb, indicators.bollingerBands, currentPrice);
    const rsiAnalysis = analyzeRSI(indicators.rsi || 50, windowCandles);
    const volumeAnalysis = analyzeVolume(windowTicks);
    const strikeZone = detectStrikeZone(bbAnalysis, rsiAnalysis, volumeAnalysis, currentPrice);
    
    if (strikeZone && strikeZone.confidence >= config.minConfidence) {
      const outcome = simulateTradeOutcome(i, strikeZone, historicalData);
      
      trades.push({
        entryPrice: strikeZone.entry.price,
        exitPrice: outcome.exitPrice,
        result: outcome.result,
        duration: (historicalData[outcome.exitIndex]?.epoch || historicalData[i].epoch) - historicalData[i].epoch,
        strikeZone: strikeZone
      });

      i = outcome.exitIndex; // Jump forward to the end of the trade
    } else {
      i++; // Move to the next candle
    }
  }

  // Calculate final metrics
  const wins = trades.filter(t => t.result === 'win').length;
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const totalPnl = trades.reduce((sum, trade) => {
      // Use a simplified P&L calculation for backtesting
      const pnl = trade.result === 'win' 
        ? Math.abs(trade.strikeZone.targets.riskReward) // Simplified win
        : -1; // Simplified loss
      return sum + pnl;
  }, 0);

  return { totalTrades, winRate, totalPnl, trades };
}
