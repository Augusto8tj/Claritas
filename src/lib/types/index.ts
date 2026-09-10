// /src/lib/types/index.ts
import { z } from 'zod';
import { 
    RobotStrategySchema,
    RobotVoteSchema,
    EnhancedRobotPerformanceSchema,
    TradeDecisionLogSchema,
    AssetProfileV1Schema,
    OperationSchema,
    PredictiveTradeLogSchema,
    IndicatorsSchema,
    DurationUnitSchema,
} from './trading.types';

import type { 
    RobotStrategy as RobotStrategyT, 
    RobotVote as RobotVoteT, 
    RobotPerformance as RobotPerformanceT, 
    EnhancedRobotPerformance as EnhancedRobotPerformanceType, 
    MarketRegime as MarketRegimeType, 
    MicrostructureFeatures as MicrostructureFeaturesType, 
    BayesianVote as BayesianVoteType, 
    TradeDecisionLog as TradeDecisionLogType, 
    AssetProfileV1 as AssetProfileV1Type,
    CouncilVotes as CouncilVotesT,
    VirtualTradeLog as VirtualTradeLogT,
    TradeHistoryEvent as TradeHistoryEventT,
    TradeResult as TradeResultT,
    DurationUnit as DurationUnitT,
    ExecutionModel as ExecutionModelT,
    InstitutionalBacktestResult as InstitutionalBacktestResultT,
    WalkForwardResult as WalkForwardResultT,
    MonteCarloResult as MonteCarloResultT,
    TradeAnnotation as TradeAnnotationT,
    PredictiveTradeLog as PredictiveTradeLogT,
    DurationLimits as DurationLimitsT,
    StrategyType as StrategyTypeT,
    EnsembleSignal as EnsembleSignalT,
    AssetAnalysisInput as AssetAnalysisInputT,
} from './trading.types';

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
// Ollama / Local IA Types
// =================================================================
export interface OllamaConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature: number;
  keepAlive: string;
}

// =================================================================
// Chart & Trading Hook Types
// =================================================================
export interface Asset {
  value: string;
  label: string;
  marketIsOpen: boolean;
  submarket: string;
  market: string;
  minDuration: string;
  pip?: number;
}

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

export type DurationUnit = DurationUnitT;
export type DurationLimits = DurationLimitsT;

export type OperationStatus = 'pending' | 'won' | 'lost';
export type OperationInitiator = 'Manual' | 'Piloto' | 'Conselho' | 'HF_Strike' | 'Repetition Trigger' | 'Vagalume';

export interface Operation {
  id: number;
  asset: string;
  direction: 'rise' | 'fall';
  stake: number;
  status: OperationStatus;
  result?: number; 
  timestamp: string; 
  exitTimestamp?: string; 
  duration: number;
  durationUnit: DurationUnit;
  initiator: OperationInitiator;
  entryPrice?: number;
  exitPrice?: number;
  isSellable?: boolean;
  expirationTime?: number; 
  multiplier?: number;
  contractType?: string;
  takeProfit?: number;
  stopLoss?: number;
  trailingStop?: number;
  strategy?: string;
  apiStatus?: 'won' | 'lost';
  validationLog?: any;
  executionLatency?: number;
  resolvedBy?: 'api' | 'timeout';
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
export type TradeDecisionLog = TradeDecisionLogType;
export type AssetProfileV1 = AssetProfileV1Type;
export type CouncilVotes = CouncilVotesT;
export type VirtualTradeLog = VirtualTradeLogT;
export type TradeHistoryEvent = TradeHistoryEventT;
export type TradeResult = TradeResultT;
export type ExecutionModel = ExecutionModelT;
export type InstitutionalBacktestResult = InstitutionalBacktestResultT;
export type WalkForwardResult = WalkForwardResultT;
export type MonteCarloResult = MonteCarloResultT;
export type TradeAnnotation = TradeAnnotationT;
export type PredictiveTradeLog = PredictiveTradeLogT;
export type StrategyType = StrategyTypeT;
export type EnsembleSignal = EnsembleSignalT;
export type AssetAnalysisInput = AssetAnalysisInputT;

// =================================================================
// Trading AI Flow Types
// =================================================================

// From financial-chatbot.types.ts
const MessageSchema = z.object({
  role: z.enum(['user', 'model', 'assistant', 'system']),
  content: z.string(),
});
export const financialChatbotInsightsInputSchema = z.object({
  history: z.array(MessageSchema).describe('The conversation history.'),
  query: z.string().describe('The user query about their finances.'),
});
export type FinancialChatbotInsightsInput = z.infer<typeof financialChatbotInsightsInputSchema>;

export const financialChatbotInsightsOutputSchema = z.object({
  response: z.string().describe('The AI-generated response to the user query.'),
});
export type FinancialChatbotInsightsOutput = z.infer<typeof financialChatbotInsightsOutputSchema>;

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
export const baseRiseFallSchema = z.object({
  stake: z.coerce.number().min(0.35, "O valor mínimo é $0.35."),
  duration: z.coerce.number().min(1, "A duração deve ser de pelo menos 1."),
  duration_unit: DurationUnitSchema,
  allowEquals: z.boolean().default(false),
});

export const riseFallSchema = baseRiseFallSchema.refine(
  (data) => {
    if (data.duration_unit === 's') {
      return (data as any).duration >= 15;
    }
    return true;
  },
  {
    message: "A duração para segundos deve ser de no mínimo 15.",
    path: ["duration"],
  }
).refine(
  (data) => {
    if (data.duration_unit === 't') {
      return (data as any).duration <= 10;
    }
    return true;
  },
  {
    message: "A duração para ticks deve ser de no máximo 10.",
    path: ["duration"],
  }
);

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

export { IndicatorsSchema, OperationSchema };
