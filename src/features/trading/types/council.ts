// /src/features/trading/types/council.ts
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
  executedVia: 'COUNCIL_LLM' | 'MATH_FALLBACK' | 'COUNCIL_VETO' | 'NO_VOTERS' | 'COOLDOWN_PATTERN' | 'HIGH_ENTROPY';
  executionMode: 'REAL' | 'SHADOW';
  t2tLatencyMs: number;
  telemetry: CouncilTelemetry;
  zenThought?: string;
  holdReason?: string; // Motivo detalhado se a decisão for HOLD
  debugVotes?: string; // Formato "M:CALL/78 R:HOLD/20 A:HOLD/0"
  trace?: string[];
  backtestEdge?: 'positive' | 'negative' | 'neutral';
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
  userId?: string;
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

/**
 * Estatísticas agregadas de uma regra (por estado de gravidade e símbolo).
 */
export interface RuleEdgeStats {
  rule: string;
  gravityState: string;
  symbol: string;
  n: number;
  wins: number;
  pnl: number;
  posteriorMean: number;
  lowerBound: number;
  avgProfit: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  // Campos Etapa 15
  lastBacktestRate?: number;
  driftBps?: number;
  consistencyStatus?: 'CONSISTENTE' | 'DEGRADAÇÃO' | 'RECALIBRAR';
}

export interface CouncilStats {
  total: number;
  call: number;
  put: number;
  hold: number;
  vetoes: number;
  fallbacks: number;
  avgLatencyMs: number;
}

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

export interface RuleCalibration {
    zBtc: number;
    zTargetMax: number;
    corrMin: number;
    horizon: number;
    variant: 'A' | 'B';
    suggestedDuration: number;
    payoutAssumed: number;
    verdict: string;
    trainWinRate: number;
    testWinRate: number;
    n: number;
    periodFrom: number;
    periodTo: number;
    symbols: string[];
    timestamp: string;
}
