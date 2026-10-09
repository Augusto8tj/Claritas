export interface TradePostMortem {
  id: string;
  timestamp: number;
  contract: 'ACCUMULATORS' | 'MULTIPLIERS' | 'OPTIONS';
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
  recommendedContract: 'ACCUMULATORS' | 'MULTIPLIERS' | 'OPTIONS';
  confidence: number;
  reasoning: string;
  vetoTriggered?: boolean;
  tokensPerSec?: number;
  totalTokens?: number;
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
  recommendedContract: 'ACCUMULATORS' | 'MULTIPLIERS' | 'OPTIONS';
  stakeRatio: number;
  consensusConfidence: number;
  opinions: AgentOpinion[];
  executedVia: 'COUNCIL_LLM' | 'MATH_FALLBACK' | 'COUNCIL_VETO' | 'NO_VOTERS';
  executionMode: 'REAL' | 'SHADOW';
  t2tLatencyMs: number;
  telemetry: CouncilTelemetry;
  zenThought?: string;
  holdReason?: string; // Motivo detalhado se a decisão for HOLD
  debugVotes?: string; // NOVO: Formato "M:CALL/78 R:HOLD/20 A:HOLD/0"
}

/**
 * Permissões granulares de ações (direção).
 */
export interface AllowedActionsV3 {
  'CALL': boolean;
  'PUT': boolean;
}

/**
 * Categorias de contrato permitidas.
 */
export interface AllowedContractsV3 {
  'OPTIONS': boolean;
  'ACCUMULATORS': boolean;
  'MULTIPLIERS': boolean;
}

/**
 * Permissões granulares de execução por ativo.
 */
export interface AssetExecutionPermission {
  symbol: string;
  allowedContracts: ('ACCUMULATORS' | 'MULTIPLIERS' | 'OPTIONS')[];
  allowedActions: ('CALL' | 'PUT')[];
  maxStake: number;
  enabled: boolean;
}

/**
 * Estado global de risco do portfólio V3.
 */
export interface PortfolioRiskState {
  openPositions: number;
  maxConcurrentPositions: number;
  totalExposure: number;
  maxTotalExposure: number;
  lockedSymbols: Set<string>; // Ativos já processados neste ciclo
  plannedStake?: number;
}