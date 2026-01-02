// src/lib/types/trading.types.ts
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
}

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
  tradeHistory: number[];
}


export const RobotStrategySchema = z.object({
    id: z.string().describe("A unique identifier for the robot, e.g., 'RSI_BOT_1'."),
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

// Voto do robô, que agora inclui sugestões de stake e duração
export const RobotVoteSchema = z.object({
  vote: z.enum(['RISE', 'FALL', 'HOLD']),
  confidence: z.number(),
  weight: z.number(),
  suggestedStake: z.number(),
  optimalDuration: z.number(),
  optimalDurationUnit: z.enum(['t', 's', 'm', 'h', 'd']),
});

export type RobotVote = z.infer<typeof RobotVoteSchema>;

// Desempenho do robô, incluindo win rates por regime
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
});

export type RobotPerformance = z.infer<typeof RobotPerformanceSchema>;

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
  ema20: z.number().nullable(),
  ema50: z.number().nullable(),
  vwap: z.array(z.number().nullable()),
  bb: z.object({
    upper: z.number().nullable(),
    middle: z.number().nullable(),
    lower: z.number().nullable(),
  }),
  bollingerBands: z.array(z.object({ upper: z.number(), middle: z.number(), lower: z.number() }).nullable()),
  donchianChannels: z.array(z.object({ upper: z.number(), middle: z.number(), lower: z.number() }).nullable()),
  kama: z.number().nullable(),
  bbw: z.number().nullable(), // Bollinger Bandwidth
  stochRSI: z.number().nullable(),
  zScore: z.number().nullable(),
  awesomeOscillator: z.number().nullable(),
  trix: z.number().nullable(),
  roc: z.number().nullable(),
  parabolicSAR: z.number().nullable(),
  ichimoku: z.object({
    tenkan: z.number().nullable(),
    kijun: z.number().nullable(),
    senkouA: z.number().nullable(),
    senkouB: z.number().nullable(),
  }).nullable(),
  mfi: z.number().nullable(),
  obv: z.number().nullable(),
  chandelierExit: z.number().nullable(),
  rvi: z.number().nullable(),
});

// Full audit log for a single trade decision
export const TradeDecisionLogSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  asset: z.string(),
  timePeriod: z.custom<TimePeriod>(),
  tradeParams: z.object({
    direction: z.enum(['RISE', 'FALL']),
    stake: z.number(),
    duration: z.number(),
    durationUnit: z.enum(['t', 's', 'm', 'h', 'd']),
  }),
  context: z.object({
    marketRegime: z.string(),
    regimeConfidence: z.number(),
    microstructure: z.custom<MicrostructureFeatures | null>(),
    indicators: IndicatorsSchema.nullable(),
  }),
  consensus: z.object({
    bayesianProbability: z.number(),
    kellyStake: z.number(),
    activeRobots: z.number(),
    votes: z.record(z.string(), BayesianVoteSchema),
  }),
  result: z.enum(['pending', 'won', 'lost']),
  pnl: z.number().optional(),
});

export type TradeDecisionLog = z.infer<typeof TradeDecisionLogSchema>;