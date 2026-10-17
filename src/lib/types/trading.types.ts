
// /src/lib/types/trading.types.ts
import { z } from 'zod';

export type MarketRegime = 
  | 'trending_bull'
  | 'trending_bear'
  | 'ranging'
  | 'high_volatility'
  | 'breakout';

export type StrategyType =
  | 'HF_MEAN_REVERSION'
  | 'STD_TREND_FOLLOW'
  | 'BOLLINGER_SQUEEZE'
  | 'VOLUME_ABSORPTION'
  | 'MICROSTRUCTURE_SCALP'
  | 'GBM_20S'
  | 'GBM_40S'
  | 'RANDOM_WALK'
  | 'ENSEMBLE';

export const DurationUnitSchema = z.enum(['t', 's', 'm', 'h', 'd']);
export type DurationUnit = z.infer<typeof DurationUnitSchema>;

export interface EnsembleSignal {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  participants: {
    strategy: StrategyType;
    vote: 'LONG' | 'SHORT' | 'NEUTRAL';
    weight: number;
    confidence: number;
  }[];
  reasoning: string;
  expectedWinRate: number;
  suggestedStake: number;
}

export interface MicrostructureFeatures {
  spreadPercentage: number;
  volumeImbalance: number;
  tickVelocity: number;
  priceAcceleration: number;
  parkinsonVolatility: number;
  yangZhangVolatility: number;
  gapRatio: number;
  meanReversion: number;
  isSpike: boolean;
  pressure: 'buy' | 'sell' | 'neutral';
  analysis: string;
}

export interface TradeAnnotation {
  id: string;
  contractId: string;
  entryTime: number;
  entryPrice: number;
  exitTime?: number;
  exitPrice?: number;
  direction: 'rise' | 'fall';
  status: 'pending' | 'won' | 'lost';
  stake: number;
  symbol: string;
  profit?: number;
  expirationTime?: number;
  contractType: 'option' | 'multiplier' | 'accumulator';
}

export const OperationSchema = z.object({
  id: z.number(),
  asset: z.string(),
  direction: z.enum(['rise', 'fall']),
  stake: z.number(),
  status: z.enum(['pending', 'won', 'lost']),
  result: z.number().optional(),
  timestamp: z.string().describe("The ISO 8601 timestamp of when the operation was created."),
  initiator: z.string().optional(),
  strategy: z.string().optional(),
  duration: z.number().optional(),
  durationUnit: z.string().optional(),
  entryPrice: z.number().optional(),
  exitPrice: z.number().optional(),
  exitTimestamp: z.string().optional(),
  isSellable: z.boolean().optional(),
  expirationTime: z.number().optional(),
  multiplier: z.number().optional(),
  contractType: z.string().optional(),
  takeProfit: z.number().optional(),
  stopLoss: z.number().optional(),
  trailingStop: z.number().optional(),
  apiStatus: z.enum(['won', 'lost']).optional(),
  validationLog: z.any().optional(),
  executionLatency: z.number().optional(),
  resolvedBy: z.enum(['api', 'timeout', 'shadow']).optional(),
  payoutPct: z.number().optional(), 
});

export const RobotStrategySchema = z.object({
    id: z.string().describe("A unique identifier for the robot, e.g., 'rsi_scalper'."),
    strategyType: z.enum([
        "RSI", "STOCHASTIC", "MOVING_AVERAGE_CROSS", "BOLLINGER_BANDS", "MACD_CROSS",
        "PRICE_ACTION_PATTERN", "ADX_TREND", "ICHIMOKU_CLOUD", "AWESOME_OSCILLATOR",
        "VOLUME_PROFILE", "KAMA", "VWAP", "Z_SCORE", "STOCH_RSI", "MFI",
        "TRIX", "ROC", "DONCHIAN_CHANNELS", "RVI", "PARABOLIC_SAR", "CHANDELIER_EXIT", "OBV",
    ]).describe("The type of strategy the robot employs."),
    justification: z.string().describe("A brief, one-sentence justification."),
    strongConfidence: z.number().min(0).max(100),
    weakConfidence: z.number().min(0).max(100),
    period: z.number().optional(),
    strongBuyThreshold: z.number().optional(),
    weakBuyThreshold: z.number().optional(),
    strongSellThreshold: z.number().optional(),
    weakSellThreshold: z.number().optional(),
    shortPeriod: z.number().optional(),
    longPeriod: z.number().optional(),
    fastPeriod: z.number().optional(),
    slowPeriod: z.number().optional(),
    signalPeriod: z.number().optional(),
    stdDev: z.number().optional(),
    pattern: z.enum(['hammer', 'shooting_star']).optional(),
    trendStrengthThreshold: z.number().optional(),
    profileBars: z.number().optional(),
    fastEnd: z.number().optional(),
    slowEnd: z.number().optional(),
    zScoreThreshold: z.number().optional(),
    acceleration: z.number().optional(),
    maxAcceleration: z.number().optional(),
    multiplier: z.number().optional(),
    chandelierPeriod: z.number().optional(),
    chandelierMultiplier: z.number().optional(),
    suggestedStake: z.number(),
    optimalDuration: z.number(),
    optimalDurationUnit: DurationUnitSchema,
});
export type RobotStrategy = z.infer<typeof RobotStrategySchema>;

export const TradeHistoryEventSchema = z.object({
  profit: z.number(),
  regime: z.string().optional(),
  timestamp: z.number(),
});
export type TradeHistoryEvent = z.infer<typeof TradeHistoryEventSchema>;

export const RobotVoteSchema = z.object({
  vote: z.enum(['RISE', 'FALL', 'HOLD']),
  confidence: z.number(),
  weight: z.number(),
  suggestedStake: z.number(),
  optimalDuration: z.number(),
  optimalDurationUnit: DurationUnitSchema,
  reason: z.string(),
});
export type RobotVote = z.infer<typeof RobotVoteSchema>;

export type CouncilVotes = Record<string, RobotVote>;

export const BayesianVoteSchema = z.object({
    vote: z.enum(['RISE', 'FALL', 'HOLD']),
    reason: z.string(),
    rawConfidence: z.number(),
    calibratedConfidence: z.number(),
    bayesianProbability: z.number(),
    weight: z.number(),
    optimalDuration: z.number(),
    optimalDurationUnit: DurationUnitSchema,
    suggestedStake: z.number(),
    regime: z.string(),
    sharpeRatio: z.number().optional(),
    strategy: RobotStrategySchema.optional(),
});
export type BayesianVote = z.infer<typeof BayesianVoteSchema>;

export const VirtualTradeLogSchema = z.object({
    robotId: z.string(),
    robotType: z.string(),
    vote: z.enum(['RISE', 'FALL']),
    entryPrice: z.number(),
    entryEpoch: z.number(),
    exitEpoch: z.number(),
});
export type VirtualTradeLog = z.infer<typeof VirtualTradeLogSchema>;

export const IndicatorsSchema = z.object({
  rsi: z.number().nullable(),
  stoch: z.number().nullable(),
  atr: z.number().nullable(),
  atrSeries: z.array(z.number().nullable()),
  adx: z.number().nullable(),
  adxSeries: z.array(z.number().nullable()),
  pdi: z.number().nullable(),
  ndi: z.number().nullable(),
  macd: z.object({
    macd: z.number().nullable(),
    signal: z.number().nullable(),
    histogram: z.number().nullable(),
  }),
  ma: z.object({
    short: z.number().nullable(),
    long: z.number().nullable(),
  }),
  sma: z.array(z.number().nullable()),
  ema: z.array(z.number().nullable()),
  vwap: z.array(z.number().nullable()),
  bb: z.object({
    upper: z.number().nullable(),
    middle: z.number().nullable(),
    lower: z.number().nullable(),
  }),
  bollingerBands: z.array(z.object({ upper: z.number(), middle: z.number(), lower: z.number() }).nullable()),
  donchian: z.object({
    upper: z.number().nullable(),
    lower: z.number().nullable(),
  }).nullable(),
  kama: z.number().nullable(),
  bbw: z.number().nullable(),
  bbwSeries: z.array(z.number().nullable()),
  stochRSI: z.number().nullable(),
  zScore: z.number().nullable(),
  ao: z.number().nullable(),
  aoPrev: z.number().nullable(),
  trix: z.number().nullable(),
  trixPrev: z.number().nullable(),
  roc: z.number().nullable(),
  psar: z.number().nullable(),
  ichimoku: z.object({
    tenkan: z.number().nullable(),
    confirmado: z.boolean().optional(),
    kijun: z.number().nullable(),
    spanA: z.number().nullable(),
    spanB: z.number().nullable(),
  }).nullable(),
  mfi: z.number().nullable(),
  obv: z.number().nullable(),
  obvPrev: z.number().nullable(),
  chandelier: z.object({
    exitLong: z.number().nullable(),
    exitShort: z.number().nullable(),
  }).nullable(),
  rvi: z.number().nullable(),
  volSma: z.array(z.number().nullable()).optional(),
});
export type Indicators = z.infer<typeof IndicatorsSchema>;

export const TradeDecisionLogSchema = z.object({
  id: z.string(),
  contractId: z.number().optional(),
  timestamp: z.string(),
  asset: z.string(),
  timePeriod: z.string(),
  tradeParams: z.object({
    direction: z.enum(['RISE', 'FALL', 'HOLD']),
    stake: z.number(),
    duration: z.number(),
    durationUnit: DurationUnitSchema,
  }),
  context: z.object({
    marketRegime: z.string(),
    regimeConfidence: z.number(),
    microstructure: z.any().nullable(),
    indicators: IndicatorsSchema.nullable(),
    supervisionReason: z.string().optional(),
    payout: z.number().optional(),
    entryPrice: z.number().optional(),
    exitPrice: z.number().optional(),
  }),
  consensus: z.object({
    bayesianProbability: z.number().optional(),
    kellyStake: z.number().optional(),
    consensusSum: z.object({rise: z.number(), fall: z.number()}).optional(),
    consensusThreshold: z.number().optional(),
    activeRobots: z.number(),
    votes: z.record(z.string(), z.any()),
    virtualTrades: z.array(VirtualTradeLogSchema).optional(),
  }),
  result: z.enum(['pending', 'won', 'lost', 'hold']),
  pnl: z.number(),
});
export type TradeDecisionLog = z.infer<typeof TradeDecisionLogSchema>;

export const AssertivenessSnapshotEntrySchema = z.object({
  horizon: z.string(),
  accuracy: z.number(),
  vote: z.enum(['RISE', 'FALL', 'HOLD']),
});
export type AssertivenessSnapshotEntry = z.infer<typeof AssertivenessSnapshotEntrySchema>;

export const PredictiveTradeLogSchema = z.object({
  id: z.string(),
  contractId: z.number(),
  timestamp: z.string(),
  asset: z.string(),
  tradeParams: z.object({
    direction: z.enum(['RISE', 'FALL', 'HOLD']),
    stake: z.number(),
    duration: z.number(),
    durationUnit: DurationUnitSchema,
  }),
  context: z.object({
    triggerReason: z.string(),
    assertivenessSnapshot: z.array(AssertivenessSnapshotEntrySchema),
  }),
  result: z.enum(['pending', 'won', 'lost']),
  pnl: z.number(),
});
export type PredictiveTradeLog = z.infer<typeof PredictiveTradeLogSchema>;

/**
 * Shadow Trade V4.2
 */
export interface CryptoShadowTrade {
  id?: string;
  symbol: string;
  direction: 'CALL' | 'PUT' | 'NONE';
  contract: 'OPTIONS' | 'ACCUMULATORS' | 'MULTIPLIERS';
  entryPrice: number;
  exitPrice?: number;
  timestamp: string;
  duration: number;
  durationUnit: string;
  gravityState: string;
  rule: string;
  score: number;
  confidence: number;
  payoutRatio: number;
  ev: number;
  result?: 'won' | 'lost' | 'draw';
  pnl?: number;
  status: 'pending' | 'completed';
  stake: number; 
  // Metadata 8A
  decisionTs?: number;
  entryTs?: number;
  exitTs?: number;
  llmLatencyMs?: number;
  settleDelayMs?: number;
  lateSettle?: boolean;
  rsiAtEntry?: number;
  bbwAtEntry?: number;
  correlationAtEntry?: number;
  entropyAtEntry?: number;
}

/**
 * Edge Metrics V4.2
 */
export interface RuleEdgeStats {
  rule: string;
  gravityState: string;
  symbol: string;
  n: number;
  wins: number;
  pnl: number;
  posteriorMean: number; // p-hat
  lowerBound: number;    // Wilson Lower Limit
  avgProfit: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
}

export const EnhancedRobotPerformanceSchema = z.object({
  id: z.string(),
  strategyType: z.string(),
  strategy: RobotStrategySchema,
  wins: z.number(),
  losses: z.number(),
  totalProfit: z.number(),
  winRate: z.number(),
  sharpeRatio: z.number(),
  maxDrawdown: z.number(),
  avgWin: z.number(),
  avgLoss: z.number(),
  profitFactor: z.number(),
  kellyFraction: z.number(),
  effectiveRegimes: z.array(z.string()),
  monteCarloScore: z.number(),
  lastUpdated: z.number(),
  tradeHistory: z.array(TradeHistoryEventSchema),
  status: z.enum(['Probation', 'Certified']).optional(),
});
export type EnhancedRobotPerformance = z.infer<typeof EnhancedRobotPerformanceSchema>;

export const RobotPerformanceSchema = z.object({
    id: z.string(),
    strategyType: z.string(),
    strategy: RobotStrategySchema,
    wins: z.number(),
    losses: z.number(),
    totalProfit: z.number(),
    winRate: z.number().optional(),
    sharpeRatio: z.number().optional(),
    tradeHistory: z.array(TradeHistoryEventSchema).optional(),
    status: z.enum(['Probation', 'Certified']).optional(),
});
export type RobotPerformance = z.infer<typeof RobotPerformanceSchema>;

export const AssetProfileV1Schema = z.object({
  id: z.string(),
  assetSymbol: z.string(),
  lastAnalyzed: z.string(),
  notes: z.string().optional(),
  preferredRegime: z.enum(['TRENDING', 'RANGING', 'NEUTRAL']).optional(),
  optimalConsensusThreshold: z.number().optional(),
});
export type AssetProfileV1 = z.infer<typeof AssetProfileV1Schema>;

export interface TradeResult {
  success: boolean;
  message: string;
  contractId?: number;
  entryPrice?: number;
}

export interface DurationLimits {
  t: { min: number; max: number } | null;
  s: { min: number; max: number } | null;
  m: { min: number; max: number } | null;
  h: { min: number; max: number } | null;
  d: { min: number; max: number } | null;
}

export interface ExecutionModel {
  spread: number;
  slippage: number;
  rejectionRate: number;
  latencyMs: number;
}

export interface InstitutionalBacktestResult {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  trades: any[];
  metrics: {
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    maxDrawdown: number;
    maxDrawdownDuration: number;
    volatility: number;
    profitFactor: number;
    expectancy: number;
    avgWin: number;
    avgLoss: number;
    largestWin: number;
    largestLoss: number;
    consecutiveWins: number;
    consecutiveLosses: number;
    winStreakAvg: number;
    lossStreakAvg: number;
    avgTradeDuration: number;
    avgHoldingTimeMinutes: number;
    tradesPerDay: number;
    avgSpreadCost: number;
    avgSlippage: number;
    rejectionRate: number;
  };
  equityCurve: any[];
  monthlyPerformance: any[];
  note?: string;
}

export interface WalkForwardResult {
  inSample: InstitutionalBacktestResult;
  outOfSample: InstitutionalBacktestResult;
  degradation: {
    sharpeRatio: number;
    winRate: number;
    profitFactor: number;
  };
  isRobust: boolean;
}

export interface MonteCarloResult {
  scenarios: InstitutionalBacktestResult[];
  statistics: {
    meanSharpe: number;
    stdDevSharpe: number;
    percentile5: number;
    percentile50: number;
    percentile95: number;
  };
  probabilityOfProfit: number;
  valueAtRisk95: number;
}

export interface AssetAnalysisInput {
  symbol: string;
  historicalData: any[];
  balance: number;
  dailyBalance: number;
  currency: string;
  stake: number;
  duration: number;
  durationUnit: string;
  recentTrades: any[];
}

export interface TradePostMortem {
  id: string;
  timestamp: number;
  contract: 'ACCUMULATORS' | 'MULTIPLIERS' | 'OPTIONS';
  result: 'WIN' | 'LOSS' | 'DRAW';
  pnl: number;
  rsi: number;
  volatilityYangZhang: number;
  candlePattern: string;
  failureDiagnosis?: string;
  btcRegime?: string;
  gravityCorrelation?: number;
  councilEntropy?: number;
  // Campos 8A
  entryPrice?: number;
  exitPrice?: number;
  executionLatency?: number;
  lateSettle?: boolean;
}
