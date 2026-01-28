// /src/lib/types/trading.types.ts
import { z } from 'zod';
import type { TimePeriod } from '.';

export type MarketRegime = 
  | 'trending_bull'
  | 'trending_bear'
  | 'ranging'
  | 'high_volatility'
  | 'breakout';

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

export const OperationSchema = z.object({
  id: z.number(),
  asset: z.string(),
  direction: z.enum(['rise', 'fall']),
  stake: z.number(),
  status: z.enum(['pending', 'won', 'lost']),
  result: z.number().optional(),
  timestamp: z.string().describe("The ISO 8601 timestamp of when the operation was created."),
  initiator: z.string().optional(),
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
});


export const RobotStrategySchema = z.object({
    id: z.string().describe("A unique identifier for the robot, e.g., 'rsi_scalper'."),
    strategyType: z.enum([
        "RSI", 
        "STOCHASTIC", 
        "MOVING_AVERAGE_CROSS", 
        "BOLLINGER_BANDS", 
        "MACD_CROSS",
        "PRICE_ACTION_PATTERN",
        "ADX_TREND",
        "ICHIMOKU_CLOUD",
        "AWESOME_OSCILLATOR",
        "VOLUME_PROFILE",
        "KAMA",
        "VWAP",
        "Z_SCORE",
        "STOCH_RSI",
        "MFI",
        "TRIX",
        "ROC",
        "DONCHIAN_CHANNELS",
        "RVI",
        "PARABOLIC_SAR",
        "CHANDELIER_EXIT",
        "OBV",
    ]).describe("The type of strategy the robot employs."),
    justification: z.string().describe("A brief, one-sentence justification for the robot's parameters, including the timeframe context, e.g., 'Usa RSI curto (5) para scalp em Ticks.'."),
    strongConfidence: z.number().min(0).max(100).describe("The confidence level (0-100) for a strong buy/sell signal."),
    weakConfidence: z.number().min(0).max(100).describe("The confidence level (0-100) for a weak buy/sell signal."),
    
    // RSI, Stochastic, MFI, RVI
    period: z.number().optional().describe("The lookback period for the indicator."),
    strongBuyThreshold: z.number().optional().describe("The threshold for a strong buy signal (e.g., RSI < 20)."),
    weakBuyThreshold: z.number().optional().describe("The threshold for a weak buy signal (e.g., RSI < 30)."),
    strongSellThreshold: z.number().optional().describe("The threshold for a strong sell signal (e.g., RSI > 80)."),
    weakSellThreshold: z.number().optional().describe("The threshold for a weak buy signal (e.g., RSI > 70)."),

    // Moving Averages & MACD
    shortPeriod: z.number().optional().describe("The short period for moving average crosses."),
    longPeriod: z.number().optional().describe("The long period for moving average crosses."),
    fastPeriod: z.number().optional().describe("Fast period for MACD."),
    slowPeriod: z.number().optional().describe("Slow period for MACD."),
    signalPeriod: z.number().optional().describe("Signal period for MACD."),

    // Bollinger Bands
    stdDev: z.number().optional().describe("The number of standard deviations for Bollinger Bands."),

    // Price Action
    pattern: z.enum(['hammer', 'shooting_star']).optional().describe("The specific candle pattern to look for."),

    // ADX
    trendStrengthThreshold: z.number().optional().describe("The ADX level above which a strong trend is considered present."),
    
    // Volume Profile
    profileBars: z.number().optional().describe("Number of bars to use for the volume profile calculation."),

    // KAMA
    fastEnd: z.number().optional(),
    slowEnd: z.number().optional(),

    // Z-Score
    zScoreThreshold: z.number().optional(),

    // Parabolic SAR
    acceleration: z.number().optional(),
    maxAcceleration: z.number().optional(),

    // Chandelier Exit
    multiplier: z.number().optional(),
    chandelierPeriod: z.number().optional(),
    chandelierMultiplier: z.number().optional(),
    
    // AutoTrader specific
    suggestedStake: z.number().describe("The suggested stake amount for this trade, based on risk analysis. Should be a percentage of the balance, e.g., 1-2%."),
    
    // DYNAMIC DURATION
    optimalDuration: z.number().describe("The optimal duration for this specific strategy."),
    optimalDurationUnit: z.enum(['t', 's', 'm', 'h', 'd']).describe("The optimal duration unit for this strategy."),
});
export type RobotStrategy = z.infer<typeof RobotStrategySchema>;


export const TradeHistoryEventSchema = z.object({
  profit: z.number(),
  regime: z.string().optional(), // Tornar opcional para compatibilidade
  timestamp: z.number(),
});
export type TradeHistoryEvent = z.infer<typeof TradeHistoryEventSchema>;

export const BayesianVoteSchema = z.object({
    vote: z.enum(['RISE', 'FALL', 'HOLD']),
    reason: z.string().describe("Justificativa técnica para o voto, ex: 'RSI (28.5) < 30' ou 'Cruzamento de Médias'"),
    rawConfidence: z.number().describe("Confiança bruta do sinal técnico (0-100)"),
    calibratedConfidence: z.number().describe("Confiança calibrada via Platt Scaling (0-1)"),
    bayesianProbability: z.number().describe("Probabilidade posterior do voto ser correto (0-1)"),
    weight: z.number().describe("Peso final do voto no consenso, ajustado por meritocracia."),
    optimalDuration: z.number(),
    optimalDurationUnit: z.enum(['t', 's', 'm', 'h', 'd']),
    suggestedStake: z.number(),
    regime: z.string(), // Mantido como string para flexibilidade
    sharpeRatio: z.number().optional().describe("O Sharpe Ratio do robô no momento do voto."),
    strategy: RobotStrategySchema.optional().describe("Snapshot da configuração da estratégia no momento do voto."),
});
export type BayesianVote = z.infer<typeof BayesianVoteSchema>;


export interface EnhancedRobotPerformance {
  id: string;
  strategyType: RobotStrategy['strategyType'];
  strategy: RobotStrategy;
  wins: number;
  losses: number;
  totalProfit: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  kellyFraction: number;
  effectiveRegimes: MarketRegime[];
  monteCarloScore: number;
  lastUpdated: number;
  tradeHistory: TradeHistoryEvent[];
  status?: 'Probation' | 'Certified';
}

// Schema for a snapshot of all indicators at a given time
export const IndicatorsSchema = z.object({
  rsi: z.number().nullable(),
  stoch: z.number().nullable(),
  atr: z.number().nullable(),
  adx: z.number().nullable(),
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
  bbw: z.number().nullable(), // Bollinger Bandwidth
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
});

export const RobotVoteSchema = z.object({
  vote: z.enum(['RISE', 'FALL', 'HOLD']),
  confidence: z.number(),
  weight: z.number(),
  suggestedStake: z.number(),
  optimalDuration: z.number(),
  optimalDurationUnit: z.enum(['t', 's', 'm', 'h', 'd']),
  reason: z.string(),
});
export type RobotVote = z.infer<typeof RobotVoteSchema>;

export type CouncilVotes = Record<string, RobotVote>;

export const VirtualTradeLogSchema = z.object({
    robotId: z.string(),
    robotType: z.string(),
    vote: z.enum(['RISE', 'FALL']),
    entryPrice: z.number(),
    entryEpoch: z.number(),
    exitEpoch: z.number(),
});
export type VirtualTradeLog = z.infer<typeof VirtualTradeLogSchema>;

export const TradeDecisionLogSchema = z.object({
  id: z.string(),
  contractId: z.number().optional(),
  timestamp: z.string(),
  asset: z.string(),
  timePeriod: z.custom<TimePeriod>(),
  tradeParams: z.object({
    direction: z.enum(['RISE', 'FALL', 'HOLD']),
    stake: z.number(),
    duration: z.number(),
    durationUnit: z.enum(['t', 's', 'm', 'h', 'd']),
  }),
  context: z.object({
    marketRegime: z.string(),
    regimeConfidence: z.number(),
    microstructure: z.custom<MicrostructureFeatures | null>().nullable(),
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
    votes: z.record(z.string(), z.union([RobotVoteSchema, BayesianVoteSchema])),
    virtualTrades: z.array(VirtualTradeLogSchema).optional(),
  }),
  result: z.enum(['pending', 'won', 'lost', 'hold']),
  pnl: z.number(),
  processed: z.boolean().optional(),
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
    durationUnit: z.enum(['t', 's', 'm', 'h', 'd']),
  }),
  context: z.object({
    triggerReason: z.string(),
    assertivenessSnapshot: z.array(AssertivenessSnapshotEntrySchema),
  }),
  result: z.enum(['pending', 'won', 'lost']),
  pnl: z.number(),
});
export type PredictiveTradeLog = z.infer<typeof PredictiveTradeLogSchema>;

export const RobotPerformanceSchema = z.object({
    id: z.string(),
    strategyType: z.string(),
    strategy: RobotStrategySchema,
    wins: z.number(),
    losses: z.number(),
    totalProfit: z.number(),
    winRate: z.number().optional(),
    winRateTrend: z.number().optional(),
    winRateRange: z.number().optional(),
    sharpeRatio: z.number().optional(),
    tradeHistory: z.array(TradeHistoryEventSchema).optional(),
    status: z.enum(['Probation', 'Certified']).default('Probation').optional(),
});
export type RobotPerformance = z.infer<typeof RobotPerformanceSchema>;

export const AssetProfileV1Schema = z.object({
  id: z.string(), // asset symbol will be the id
  assetSymbol: z.string(),
  lastAnalyzed: z.string(),
  preferredRegime: z.enum(["TRENDING", "RANGING", "NEUTRAL"]).optional(),
  optimalConsensusThreshold: z.number().optional(),
  performanceSummary: z.object({
    totalTrades: z.number(),
    winRate: z.number(),
    totalPnl: z.number(),
    sharpeRatio: z.number(),
  }).optional(),
  notes: z.string().optional(),
});
export type AssetProfileV1 = z.infer<typeof AssetProfileV1Schema>;

export interface TradeResult {
  success: boolean;
  message: string;
  contractId?: number;
  entryPrice?: number;
}

const DurationUnitSchema = z.enum(['t', 's', 'm', 'h', 'd']);
export type DurationUnit = z.infer<typeof DurationUnitSchema>;

export const baseRiseFallSchema = z.object({
  stake: z.coerce.number().min(0.35, "O valor mínimo é $0.35."),
  duration: z.coerce.number().min(1, "A duração deve ser de pelo menos 1."),
  duration_unit: DurationUnitSchema,
  allowEquals: z.boolean().default(false),
});
