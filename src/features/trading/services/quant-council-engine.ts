
// /src/features/trading/services/quant-council-engine.ts
import { TradeMemoryBuffer, AgentOpinion, CouncilDecision, CouncilTelemetry, AssetExecutionPermission, PortfolioRiskState } from '../types/council';
import { TradeMemoryManager } from './trade-memory-service';
import type { OllamaConfig } from '@/lib/types';

export const MIN_EXEC_CONFIDENCE = 65;
const RISK_DAMPING = 250;

const CONTRACT_SELECTION_GUIDE = `Contrato: BBW baixo ou BTC Compression→ACCUMULATORS | ADX>30 ou BTC Impulse→MULTIPLIERS | padrão→OPTIONS.`;

const AGENT_TIMEOUT_MS = 15000; 

/**
 * Executa o Conselho V3 com Governança Multi-Ativo e Gravidade de Bitcoin.
 */
export async function runQuantCouncil(
  marketSnapshot: any,
  memoryBuffer: TradeMemoryBuffer,
  config: OllamaConfig,
  isShadowMode: boolean,
  isFocused: boolean,
  permissions?: AssetExecutionPermission,
  portfolio?: PortfolioRiskState
): Promise<CouncilDecision> {
  const startTime = performance.now();
  const symbol = marketSnapshot.symbol;
  const trace: string[] = [];

  try {
    const memoryContext = TradeMemoryManager.formatBufferForPrompt(memoryBuffer);
    const gravityContext = marketSnapshot.gravity ? 
      `BITCOIN GRAVITY: Estado=${marketSnapshot.gravity.btcVector} | zImpulse=${marketSnapshot.gravity.zImpulse.toFixed(2)} | expectedCatchUp=${marketSnapshot.gravity.expectedCatchUp.toFixed(4)} | lag=${marketSnapshot.gravity.leadLagSeconds}s` : 
      "BITCOIN GRAVITY: N/A";

    const hasMemory = (memoryBuffer.wins.length + memoryBuffer.losses.length) > 0;
    const agents: Array<AgentOpinion['agentName']> = ['MOMENTUM', 'RISK_CRITIC', 'ARCHIVIST'];

    const agentPromises = agents.map(name => fetchAgentWithTimeout(name, marketSnapshot, `${memoryContext}\n${gravityContext}`, config));
    const results = await Promise.allSettled(agentPromises);
    
    const opinions: AgentOpinion[] = [];
    results.forEach((res, i) => {
        const agentName = agents[i];
        if (res.status === 'fulfilled' && res.value) {
            const op = res.value;
            trace.push(`${agentName}: ${op.action} ${op.confidence}% ${op.recommendedContract} veto=${op.vetoTriggered ? 'sim' : 'nao'} | "${op.reasoning.slice(0, 100)}"`);
            opinions.push(op);
        } else {
            trace.push(`${agentName}: SEM RESPOSTA (timeout/erro)`);
        }
    });

    if (opinions.length < 1) throw new Error('NETWORK_FAILURE_ALL_AGENTS');

    const critic = opinions.find(o => o.agentName === 'RISK_CRITIC');
    if (critic?.vetoTriggered && critic.confidence > 70) {
      const endTime = performance.now();
      trace.push(`VETO: ${critic.reasoning}`);
      return {
        finalAction: 'HOLD',
        recommendedContract: 'OPTIONS',
        stakeRatio: 0,
        consensusConfidence: critic.confidence,
        opinions,
        executedVia: 'COUNCIL_VETO',
        executionMode: isShadowMode ? 'SHADOW' : 'REAL',
        t2tLatencyMs: Math.round(endTime - startTime),
        telemetry: generateTelemetry(opinions, startTime, endTime),
        zenThought: `Veto Soberano do Risco: ${critic.reasoning}`,
        holdReason: `VETO_RISK: ${critic.reasoning}`,
        debugVotes: opinions.map(o => `${o.agentName.charAt(0)}:${o.action}/${o.confidence}`).join(' '),
        trace
      };
    }

    return synthesizeChairmanDecision(opinions, marketSnapshot, isShadowMode, startTime, hasMemory, trace);

  } catch (error: any) {
    const endTime = performance.now();
    trace.push(`FALLBACK: ${error.message}`);
    return executeMathFallback(marketSnapshot, isShadowMode, Math.round(endTime - startTime), trace);
  }
}

async function fetchAgentWithTimeout(agentName: string, snapshot: any, context: string, config: OllamaConfig): Promise<AgentOpinion | null> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
    try {
        const res = await fetchAgentAnalysis(agentName as any, snapshot, context, config, controller.signal);
        clearTimeout(id);
        return res;
    } catch (e) { return null; }
}

async function fetchAgentAnalysis(agentName: AgentOpinion['agentName'], snapshot: any, context: string, config: OllamaConfig, signal: AbortSignal): Promise<AgentOpinion> {
  const start = performance.now();
  const systemPrompts = {
    MOMENTUM: `Você é o analista 'Quant Momentum'. Use o Bitcoin Gravity para capturar atrasos direcionais em Altcoins. ${CONTRACT_SELECTION_GUIDE}`,
    RISK_CRITIC: `Você é o analista 'Risk Critic'. Responda action=HOLD se o movimento da Altcoin divergir do impulso do Bitcoin. confidence = força do seu ceticismo.`,
    ARCHIVIST: `Você é o analista 'Pattern Archivist'. Compare o cenário e a gravidade do BTC com trades passados.`
  };

  const response = await fetch('/api/ollama/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ systemPrompt: `${systemPrompts[agentName]}\n${context}`, marketSnapshot: snapshot, config })
  });

  if (!response.ok) throw new Error(`Agent API Error: ${response.status}`);
  const data = await response.json();
  const end = performance.now();
  const opinion = data.opinion || {};

  return { 
    agentName,
    action: (opinion.action || 'HOLD').toUpperCase() as any,
    recommendedContract: (opinion.recommendedContract || 'OPTIONS').toUpperCase() as any,
    confidence: Number(opinion.confidence) || 0,
    reasoning: opinion.reasoning || 'Sem justificativa.',
    vetoTriggered: !!opinion.vetoTriggered,
    latencyMs: Math.round(end - start),
    tokensPerSec: data.metrics?.tokensPerSecond || 0,
    totalTokens: data.metrics?.totalTokens || 0
  };
}

function generateTelemetry(opinions: AgentOpinion[], start: number, end: number): CouncilTelemetry {
  const validOps = opinions.filter(o => o.tokensPerSec !== undefined && o.tokensPerSec > 0);
  return {
    avgTokensPerSec: validOps.length ? validOps.reduce((a, b) => a + (b.tokensPerSec || 0), 0) / validOps.length : 0,
    totalTokens: opinions.reduce((sum, o) => sum + (o.totalTokens || 0), 0),
    consensusEntropy: calculateConsensusEntropy(opinions),
    jitterMs: opinions.length > 1 ? Math.max(...opinions.map(o => o.latencyMs || 0)) - Math.min(...opinions.map(o => o.latencyMs || 0)) : 0,
    inferenceHealth: Math.round((opinions.length / 3) * 100)
  };
}

function calculateConsensusEntropy(opinions: AgentOpinion[]): number {
  if (opinions.length < 2) return 0;
  const counts = { CALL: 0, PUT: 0, HOLD: 0 };
  opinions.forEach(o => counts[o.action]++);
  const probs = Object.values(counts).map(c => c / opinions.length);
  return -probs.reduce((sum, p) => p > 0 ? sum + p * Math.log2(p) : sum, 0) / 1.58;
}

function synthesizeChairmanDecision(opinions: AgentOpinion[], snapshot: any, isShadowMode: boolean, startTime: number, hasMemory: boolean, trace: string[]): CouncilDecision {
  const endTime = performance.now();
  const telemetry = generateTelemetry(opinions, startTime, endTime);

  let callScore = 0; let putScore = 0; let totalWeights = 0;
  opinions.forEach(op => {
    let weight = op.agentName === 'ARCHIVIST' && hasMemory ? 1.2 : 1.0;
    totalWeights += weight;
    if (op.action === 'CALL') callScore += op.confidence * weight;
    if (op.action === 'PUT') putScore += op.confidence * weight;
  });

  const side = callScore > putScore ? 'CALL' : (putScore > callScore ? 'PUT' : 'HOLD');
  const avgConf = side === 'HOLD' ? 0 : (side === 'CALL' ? callScore : putScore) / totalWeights;
  const entropyPenalty = telemetry.consensusEntropy > 0.6 ? 0.6 : 1.0;
  const adjusted = avgConf * entropyPenalty;

  const finalAction = (side !== 'HOLD' && adjusted >= MIN_EXEC_CONFIDENCE) ? side : 'HOLD';
  const debugVotes = opinions.map(o => `${o.agentName.charAt(0)}:${o.action}/${o.confidence}`).join(' ');

  return {
    finalAction,
    recommendedContract: opinions.find(o => o.action === finalAction)?.recommendedContract || 'OPTIONS',
    stakeRatio: finalAction !== 'HOLD' ? entropyPenalty : 0,
    consensusConfidence: Math.min(100, Math.round(adjusted)),
    opinions,
    executedVia: 'COUNCIL_LLM',
    executionMode: isShadowMode ? 'SHADOW' : 'REAL',
    t2tLatencyMs: Math.round(endTime - startTime),
    telemetry,
    zenThought: finalAction === 'HOLD' ? "O conselho aguarda convergência gravitacional." : "Confluência detectada entre líderes e seguidores.",
    debugVotes,
    trace
  };
}

function executeMathFallback(snapshot: any, isShadowMode: boolean, latency: number, trace: string[]): CouncilDecision {
  const rsi = snapshot.rsi || 50;
  const action = rsi > 75 ? 'PUT' : rsi < 25 ? 'CALL' : 'HOLD';
  return {
    finalAction: action, recommendedContract: 'OPTIONS', stakeRatio: action !== 'HOLD' ? 0.1 : 0,
    consensusConfidence: 60, opinions: [], executedVia: 'MATH_FALLBACK', executionMode: isShadowMode ? 'SHADOW' : 'REAL',
    t2tLatencyMs: latency, telemetry: { avgTokensPerSec: 0, totalTokens: 0, consensusEntropy: 1, jitterMs: 0, inferenceHealth: 0 },
    debugVotes: `MATH:RSI=${Math.round(rsi)}`, trace
  };
}
