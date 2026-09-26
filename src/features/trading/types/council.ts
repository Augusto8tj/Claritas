
export interface TradePostMortem {
  id: string;
  timestamp: number;
  contract: 'ACCUMULATORS' | 'MULTIPLIERS' | 'CALL' | 'PUT';
  result: 'WIN' | 'LOSS';
  pnl: number;
  rsi: number;
  volatilityYangZhang: number;
  candlePattern: string;
  failureDiagnosis?: string;
}

export interface TradeMemoryBuffer {
  wins: TradePostMortem[];
  losses: TradePostMortem[];
}

export interface AgentOpinion {
  agentName: 'MOMENTUM' | 'RISK_CRITIC' | 'ARCHIVIST';
  action: 'CALL' | 'PUT' | 'HOLD';
  recommendedContract: 'ACCUMULATORS' | 'MULTIPLIERS' | 'CALL' | 'PUT';
  confidence: number;
  reasoning: string;
  vetoTriggered?: boolean;
  tokensPerSec?: number;
  latencyMs?: number;
}

export interface CouncilTelemetry {
  avgTokensPerSec: number;
  totalTokens: number;
  consensusEntropy: number; // Medida de desordem (0 = certeza, 1 = caos)
  jitterMs: number; // Variabilidade entre agentes
  inferenceHealth: number; // 0-100%
}

export interface CouncilDecision {
  finalAction: 'CALL' | 'PUT' | 'HOLD';
  recommendedContract: 'ACCUMULATORS' | 'MULTIPLIERS' | 'CALL' | 'PUT';
  stakeRatio: number;
  consensusConfidence: number;
  opinions: AgentOpinion[];
  executedVia: 'COUNCIL_LLM' | 'MATH_FALLBACK';
  executionMode: 'REAL' | 'SHADOW';
  t2tLatencyMs: number;
  telemetry: CouncilTelemetry;
  zenThought?: string;
}
