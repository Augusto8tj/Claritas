import { z } from 'zod';
import { OperationSchema } from '@/lib/types/trading.types';

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
