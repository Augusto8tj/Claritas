// src/lib/types/trading.types.ts
import { z } from 'zod';

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
    weakSellThreshold: z.number().optional().describe("The threshold for a weak sell signal (e.g., RSI > 70)."),

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
    
    // AutoTrader specific
    suggestedStake: z.number().describe("The suggested stake amount for this trade, based on risk analysis. Should be a percentage of the balance, e.g., 1-2%."),
    
    // DYNAMIC DURATION - NEW
    optimalDuration: z.number().describe("The optimal duration for this specific strategy."),
    optimalDurationUnit: z.enum(['t', 's', 'm', 'h', 'd']).describe("The optimal duration unit for this strategy."),
});

export type RobotStrategy = z.infer<typeof RobotStrategySchema>;

// NOVO: Tipo para o voto do robô, que agora inclui sugestões de stake e duração
export const RobotVoteSchema = z.object({
  vote: z.enum(['RISE', 'FALL', 'HOLD']),
  confidence: z.number(),
  weight: z.number(),
  suggestedStake: z.number(),
  optimalDuration: z.number(),
  optimalDurationUnit: z.enum(['t', 's', 'm', 'h', 'd']),
});

export type RobotVote = z.infer<typeof RobotVoteSchema>;
