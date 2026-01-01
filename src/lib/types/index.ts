// /src/lib/types/index.ts
import { z } from 'zod';
import type { RobotStrategy as RobotStrategyT, RobotVote as RobotVoteT, RobotPerformance as RobotPerformanceT, EnhancedRobotPerformance as EnhancedRobotPerformanceType, MarketRegime as MarketRegimeType, MicrostructureFeatures as MicrostructureFeaturesType, BayesianVote as BayesianVoteType } from './trading.types';

// =================================================================
// Financial Types
// =================================================================
export type Goal = {
  id: string;
  name: string;
  currentAmount: number;
  targetAmount: number;
  imageUrl: string;
  imageHint: string;
};

export type BudgetCategory = {
    name: string;
    budgeted: number;
    spent: number;
};

export type Transaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
};

// =================================================================
// Chart & Trading Hook Types
// =================================================================

export type TimePeriod = '1m' | '2m' | '3m' | '5m' | '10m' | '15m' | '30m' | '1h' | '8h' | '1d';
export type ChartType = 'Area' | 'Candle';

export type TickData = {
  epoch: number;
  price: number;
};
export type CandleData = {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type ChartData = TickData | CandleData;

export type DurationUnit = 't' | 's' | 'm' | 'h' | 'd';

export type DurationLimits = Record<DurationUnit, { min: number; max: number }>;

export interface TradeAnnotation {
  id: string;
  contractId: string;
  entryTime: number; // epoch timestamp
  entryPrice: number;
  exitTime?: number;
  exitPrice?: number;
  direction: 'rise' | 'fall';
  status: 'pending' | 'won' | 'lost';
  stake: number;
  profit?: number;
  symbol: string;
}

export type OperationStatus = 'pending' | 'won' | 'lost';
export type OperationInitiator = 'Manual' | 'Piloto' | 'Conselho';

export interface Operation {
  id: number;
  asset: string;
  direction: 'rise' | 'fall';
  stake: number;
  status: OperationStatus;
  result?: number; // Profit or loss amount
  timestamp: string; // ISO format
  exitTimestamp?: string; // ISO format for when the contract was closed
  duration: number;
  durationUnit: DurationUnit;
  initiator: OperationInitiator;
  entryPrice?: number;
  exitPrice?: number;
  isSellable?: boolean;
  expirationTime?: number; // Expiration time in milliseconds
}

// =================================================================
// Re-exporting trading types for central access
// =================================================================
export type RobotStrategy = RobotStrategyT;
export type RobotVote = RobotVoteT;
export type RobotPerformance = RobotPerformanceT;
export type EnhancedRobotPerformance = EnhancedRobotPerformanceType;
export type MarketRegime = MarketRegimeType;
export type MicrostructureFeatures = MicrostructureFeaturesType;
export type BayesianVote = BayesianVoteType;


// =================================================================
// Trading AI Flow Types
// =================================================================

// Base Operation for reuse
export const OperationSchema = z.object({
  id: z.number(),
  asset: z.string(),
  direction: z.enum(['rise', 'fall']),
  stake: z.number(),
  status: z.enum(['pending', 'won', 'lost']),
  result: z.number().optional(),
  timestamp: z.string().datetime().describe("The ISO 8601 timestamp of when the operation was created."),
});

// From asset-analysis.types.ts
export const AssetAnalysisInputSchema = z.object({
  symbol: z.string().describe("The trading symbol of the asset to be analyzed."),
  historicalData: z.array(z.object({
    date: z.string(),
    price: z.number(),
  })).describe("An array of recent historical price data for the asset."),
  balance: z.number().describe("The user's current total account balance."),
  dailyBalance: z.number().describe("The user's designated trading balance for the day."),
  currency: z.string().describe("The currency of the account balance."),
  stake: z.number().describe("The current stake amount the user is considering."),
  duration: z.number().describe("The current trade duration set by the user."),
  durationUnit: z.string().describe("The unit for the trade duration (e.g., 't' for ticks, 's' for seconds)."),
  recentTrades: z.array(OperationSchema).describe("A list of the user's most recent trades in the current session."),
});
export type AssetAnalysisInput = z.infer<typeof AssetAnalysisInputSchema>;

export const AssetAnalysisOutputSchema = z.object({
  suggestion: z.enum(['RISE', 'FALL', 'HOLD']).describe("The suggested trading direction: RISE for an expected price increase, FALL for an expected decrease, or HOLD if the direction is unclear."),
  justification: z.string().describe("A brief, clear justification for the trading suggestion based on both technical analysis and user context."),
  confidenceScore: z.number().min(0).max(100).describe("A score from 0 to 100 indicating the AI's confidence in its suggestion. High confidence (>70) implies a clear trend and low risk."),
  suggestedStake: z.number().optional().describe("An optional suggested stake amount, if the AI recommends a change for risk management."),
  suggestedDuration: z.number().optional().describe("An optional suggested duration, if the AI identifies a better timeframe."),
  analysisDataPointsCount: z.number().optional().describe("The number of historical data points used for the analysis."),
});
export type AssetAnalysisOutput = z.infer<typeof AssetAnalysisOutputSchema>;


// From financial-chatbot.types.ts
const MessageSchema = z.object({
  role: z.enum(['user', 'model']),
  content: z.string(),
});
export const FinancialChatbotInsightsInputSchema = z.object({
  history: z.array(MessageSchema).describe('The conversation history.'),
  query: z.string().describe('The user query about their finances.'),
});
export type FinancialChatbotInsightsInput = z.infer<typeof FinancialChatbotInsightsInputSchema>;

export const FinancialChatbotInsightsOutputSchema = z.object({
  response: z.string().describe('The AI-generated response to the user query.'),
});
export type FinancialChatbotInsightsOutput = z.infer<typeof FinancialChatbotInsightsOutputSchema>;

// From mql-analyzer.types.ts
export const MqlAnalyzerInputSchema = z.object({
  mqlCode: z.string().describe('The MQL5 source code of a trading robot.'),
});
export type MqlAnalyzerInput = z.infer<typeof MqlAnalyzerInputSchema>;

export const MqlAnalyzerOutputSchema = z.object({
  strategyDescription: z.string().describe('A natural language description of the trading strategy extracted from the MQL5 code.'),
});
export type MqlAnalyzerOutput = z.infer<typeof MqlAnalyzerOutputSchema>;


// From operation-analysis.types.ts
export const OperationAnalysisInputSchema = z.object({
  operations: z.array(OperationSchema).describe('An array of trading operations from the current session.'),
});
export type OperationAnalysisInput = z.infer<typeof OperationAnalysisInputSchema>;

export const OperationAnalysisOutputSchema = z.object({
  analysis: z.string().describe('A natural language summary of the trading performance analysis, including key metrics.'),
});
export type OperationAnalysisOutput = z.infer<typeof OperationAnalysisOutputSchema>;


// From deriv-trader-interface.types.ts
export const riseFallSchema = z.object({
  stake: z.coerce.number().min(0.35, "O valor mínimo é $0.35."),
  duration: z.coerce.number().min(1, "A duração deve ser de pelo menos 1."),
  duration_unit: z.enum(['t', 's', 'm', 'h', 'd']),
  allowEquals: z.boolean().default(false),
});

export type RiseFallFormValues = z.infer<typeof riseFallSchema>;


// =================================================================
// Goal Image Generation Types
// =================================================================
export const GenerateGoalImageInputSchema = z.object({
  goalName: z.string().describe('The name of the financial goal.'),
});
export type GenerateGoalImageInput = z.infer<typeof GenerateGoalImageInputSchema>;

export const GenerateGoalImageOutputSchema = z.object({
  imageUrl: z.string().describe('The data URI of the generated image.'),
});
export type GenerateGoalImageOutput = z.infer<typeof GenerateGoalImageOutputSchema>;
