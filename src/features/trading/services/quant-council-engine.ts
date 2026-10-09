import { TradeMemoryBuffer, AgentOpinion, CouncilDecision, CouncilTelemetry, AssetExecutionPermission, PortfolioRiskState } from '../types/council';
import { TradeMemoryManager } from './trade-memory-service';
import type { OllamaConfig } from '@/lib/types';

export const MIN_EXEC_CONFIDENCE = 65;
const RISK_DAMPING = 250;

const CONTRACT_SELECTION_GUIDE = `Contrato: BBW baixo→ACCUMULATORS | ADX>30→MULTIPLIERS | padrão→OPTIONS.`;

const AGENT_TIMEOUT_MS = 15000; 

/**
 * Valida se a execução é permitida pelos filtros de segurança institucional.
 */
function validateExecutionGate(
  symbol: string,
  decision: CouncilDecision,
  permissions: AssetExecutionPermission | undefined,
  portfolio: PortfolioRiskState,
  isFocused: boolean
): { allowed: boolean; reason?: string } {
  // 1. Bloqueio de Ciclo (Evitar duplicatas no mesmo tick)
  if (portfolio.lockedSymbols.has(symbol)) {
    return { allowed: false, reason: "Bloqueado: Ativo já processado neste ciclo." };
  }

  // 2. Permissão do Ativo
  if (!permissions || !permissions.enabled) {
    return { allowed: false, reason: "Bloqueado: Execução desativada para este ativo." };
  }

  // 3. Categoria de Contrato Permitida
  if (!permissions.allowedContracts.includes(decision.recommendedContract)) {
    return { allowed: false, reason: `Bloqueado: Categoria ${decision.recommendedContract} não permitida para ${symbol}.` };
  }

  // 3.1 Ação Direcional Permitida
  if (!permissions.allowedActions.includes(decision.finalAction as any)) {
    return { allowed: false, reason: `Bloqueado: Ação ${decision.finalAction} não permitida para ${symbol}.` };
  }

  // 4. Limites de Portfólio
  if (portfolio.openPositions >= portfolio.maxConcurrentPositions) {
    return { allowed: false, reason: `Bloqueado: Limite de posições simultâneas (${portfolio.maxConcurrentPositions}) atingido.` };
  }

  // 5. Exposição Total
  const plannedStake = portfolio.plannedStake ?? 1.0;
  const estimatedNewExposure = portfolio.totalExposure + plannedStake;
  if (estimatedNewExposure > portfolio.maxTotalExposure) {
    return { allowed: false, reason: `Bloqueado: Exposição total ($${estimatedNewExposure.toFixed(2)}) excederia o limite diário ($${portfolio.maxTotalExposure}).` };
  }

  return { allowed: true };
}

function calculateConsensusEntropy(opinions: AgentOpinion[]): number {
  if (opinions.length < 2) return 0.2; 
  const counts = { CALL: 0, PUT: 0, HOLD: 0 };
  opinions.forEach(o => {
      const action = o.action as 'CALL' | 'PUT' | 'HOLD';
      counts[action]++;
  });
  
  const probs = Object.values(counts).map(c => c / opinions.length);
  return -probs.reduce((sum, p) => p > 0 ? sum + p * Math.log2(p) : sum, 0) / 1.58; 
}

function selectBestContract(opinions: AgentOpinion[], winningAction: string): 'OPTIONS' | 'ACCUMULATORS' | 'MULTIPLIERS' {
    const contractScores: Record<string, number> = { OPTIONS: 0, ACCUMULATORS: 0, MULTIPLIERS: 0 };
    opinions
        .filter(o => o.action === winningAction)
        .forEach(o => {
            const weight = o.agentName === 'ARCHIVIST' ? 1.2 : 1.0; 
            contractScores[o.recommendedContract] = (contractScores[o.recommendedContract] || 0) + (o.confidence * weight);
        });
    const best = Object.entries(contractScores).sort((a, b) => b[1] - a[1])[0];
    return (best && best[1] > 0 ? best[0] : 'OPTIONS') as any;
}

/**
 * Executa o Conselho V3 com Governança Multi-Ativo.
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
    const hasMemory = (memoryBuffer.wins.length + memoryBuffer.losses.length) > 0;
    const agents: Array<AgentOpinion['agentName']> = ['MOMENTUM', 'RISK_CRITIC', 'ARCHIVIST'];

    const agentPromises = agents.map(name => fetchAgentWithTimeout(name, marketSnapshot, memoryContext, config));
    const results = await Promise.allSettled(agentPromises);
    
    const opinions: AgentOpinion[] = [];
    results.forEach((res, i) => {
        const agentName = agents[i];
        if (res.status === 'fulfilled' && res.value) {
            const op = res.value;
            trace.push(`${agentName}: ${op.action} ${op.confidence}% ${op.recommendedContract} veto=${op.vetoTriggered ? 'sim' : 'nao'} ${op.latencyMs}ms | "${op.reasoning.slice(0, 160)}"`);
            opinions.push(op);
        } else {
            trace.push(`${agentName}: SEM RESPOSTA (timeout/erro/parse)`);
        }
    });

    if (opinions.length < 1) throw new Error('NETWORK_FAILURE_ALL_AGENTS');

    const critic = opinions.find(o => o.agentName === 'RISK_CRITIC');
    if (critic?.vetoTriggered && critic.confidence > 70) {
      const endTime = performance.now();
      const debugVotes = opinions.map(o => `${o.agentName.charAt(0)}:${o.action}/${o.confidence}`).join(' ');
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
        debugVotes,
        trace
      };
    }

    const decision = synthesizeChairmanDecision(opinions, marketSnapshot, isShadowMode, startTime, hasMemory, trace);

    if (decision.finalAction !== 'HOLD' && portfolio && permissions) {
      const gate = validateExecutionGate(symbol, decision, permissions, portfolio, isFocused);
      trace.push(`GATE: ${gate.allowed ? 'ok' : gate.reason}`);
      if (!gate.allowed) {
        return {
          ...decision,
          finalAction: 'HOLD',
          holdReason: gate.reason
        };
      }
    }

    return decision;

  } catch (error: any) {
    const endTime = performance.now();
    trace.push(`FALLBACK: ${error.message}`);
    if (isFocused) {
      const fallback = executeMathFallback(marketSnapshot, isShadowMode, Math.round(endTime - startTime));
      return { ...fallback, trace };
    }
    return {
      finalAction: 'HOLD',
      recommendedContract: 'OPTIONS',
      stakeRatio: 0,
      consensusConfidence: 0,
      opinions: [],
      executedVia: 'MATH_FALLBACK',
      executionMode: 'SHADOW',
      t2tLatencyMs: Math.round(endTime - startTime),
      telemetry: { avgTokensPerSec: 0, totalTokens: 0, consensusEntropy: 1, jitterMs: 0, inferenceHealth: 0 },
      holdReason: "Failover bloqueado para background asset.",
      debugVotes: "FAIL",
      trace
    };
  }
}

async function fetchAgentWithTimeout(
    agentName: AgentOpinion['agentName'],
    snapshot: any,
    memoryContext: string,
    config: OllamaConfig
): Promise<AgentOpinion | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

    try {
        const opinion = await fetchAgentAnalysis(agentName, snapshot, memoryContext, config, controller.signal);
        clearTimeout(timeoutId);
        return opinion;
    } catch (e) {
        return null;
    }
}

async function fetchAgentAnalysis(
  agentName: AgentOpinion['agentName'],
  snapshot: any,
  memoryContext: string,
  config: OllamaConfig,
  signal: AbortSignal
): Promise<AgentOpinion> {
  const start = performance.now();
  
  const commonRules = `REGRA RSI: <30=COMPRA, >70=VENDA. 30-70=HOLD (ZONA NEUTRA). Sugerir trade na zona neutra é erro tático.`;

  const systemPrompts = {
    MOMENTUM: `Você é o analista 'Quant Momentum'. Identifique força de explosão nos extremos. ${commonRules} ${CONTRACT_SELECTION_GUIDE}`,
    RISK_CRITIC: `Você é o analista 'Risk Critic'. Sua função é vetar sinais fracos ou em zona neutra. confidence = quão forte é sua recomendação de EVITAR o trade. ${commonRules} ${CONTRACT_SELECTION_GUIDE}`,
    ARCHIVIST: `Você é o analista 'Pattern Archivist'. Compare com o histórico de vitórias/falhas. Se o histórico estiver vazio, responda action HOLD, confidence 0, reasoning 'sem histórico'. ${commonRules} ${CONTRACT_SELECTION_GUIDE}`
  };

  try {
    const response = await fetch('/api/ollama/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        systemPrompt: `${systemPrompts[agentName]}\n${memoryContext}`,
        marketSnapshot: snapshot,
        config: config
      })
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
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw err;
  }
}

function generateTelemetry(opinions: AgentOpinion[], start: number, end: number): CouncilTelemetry {
  const validOps = opinions.filter(o => o.tokensPerSec !== undefined && o.tokensPerSec > 0);
  const totalTokens = opinions.reduce((sum, o) => sum + (o.totalTokens || 0), 0);
  
  return {
    avgTokensPerSec: validOps.length ? validOps.reduce((a, b) => a + (b.tokensPerSec || 0), 0) / validOps.length : 0,
    totalTokens,
    consensusEntropy: calculateConsensusEntropy(opinions),
    jitterMs: opinions.length > 1 ? Math.max(...opinions.map(o => o.latencyMs || 0)) - Math.min(...opinions.map(o => o.latencyMs || 0)) : 0,
    inferenceHealth: Math.round((opinions.length / 3) * 100)
  };
}

function synthesizeChairmanDecision(
  opinions: AgentOpinion[],
  snapshot: any,
  isShadowMode: boolean,
  startTime: number,
  hasMemory: boolean,
  trace: string[]
): CouncilDecision {
  const endTime = performance.now();
  const telemetry = generateTelemetry(opinions, startTime, endTime);

  let callScore = 0;
  let putScore = 0;
  let totalWeights = 0;

  opinions.forEach(op => {
    let weight = 0;
    if (op.agentName === 'MOMENTUM') weight = 1.0;
    else if (op.agentName === 'ARCHIVIST' && hasMemory) weight = 1.2;

    if (weight > 0) {
      trace.push(`VOTANTE: ${op.agentName} peso=${weight} voto=${op.action} conf=${op.confidence}%`);
      totalWeights += weight;
      if (op.action === 'CALL') callScore += op.confidence * weight;
      if (op.action === 'PUT') putScore += op.confidence * weight;
    }
  });

  if (totalWeights === 0) {
    return {
      finalAction: 'HOLD',
      recommendedContract: 'OPTIONS',
      stakeRatio: 0,
      consensusConfidence: 0,
      opinions,
      executedVia: 'NO_VOTERS',
      executionMode: isShadowMode ? 'SHADOW' : 'REAL',
      t2tLatencyMs: Math.round(endTime - startTime),
      telemetry,
      holdReason: 'Votantes insuficientes ou sem memória.',
      debugVotes: opinions.map(o => `${o.agentName.charAt(0)}:${o.action}/${o.confidence}`).join(' '),
      trace
    };
  }

  const side = callScore > putScore ? 'CALL' : (putScore > callScore ? 'PUT' : 'HOLD');
  const avgConf = side === 'HOLD' ? 0 : (side === 'CALL' ? callScore : putScore) / totalWeights;

  const critic = opinions.find(o => o.agentName === 'RISK_CRITIC');
  let riskFactor = 1.0;
  if (critic && side !== 'HOLD' && critic.action !== side) {
    riskFactor = 1 - Math.min(critic.confidence, 100) / RISK_DAMPING;
  }

  const entropyPenalty = telemetry.consensusEntropy > 0.6 ? 0.6 : 1.0;
  const adjusted = avgConf * entropyPenalty * riskFactor;
  
  trace.push(`SÍNTESE: call=${callScore.toFixed(1)} put=${putScore.toFixed(1)} wsum=${totalWeights.toFixed(1)} side=${side}`);
  trace.push(`MÉTRICAS: avgConf=${avgConf.toFixed(1)} entropy=${telemetry.consensusEntropy.toFixed(2)} penalty=${entropyPenalty} riskFactor=${riskFactor.toFixed(2)}`);
  trace.push(`FINAL: ajustada=${adjusted.toFixed(1)} min=${MIN_EXEC_CONFIDENCE} -> ${adjusted >= MIN_EXEC_CONFIDENCE ? side : 'HOLD'}`);

  const finalAction = (side !== 'HOLD' && adjusted >= MIN_EXEC_CONFIDENCE) ? side : 'HOLD';
  const debugVotes = opinions.map(o => `${o.agentName.charAt(0)}:${o.action}/${o.confidence}`).join(' ');

  return {
    finalAction,
    recommendedContract: selectBestContract(opinions, finalAction),
    stakeRatio: finalAction !== 'HOLD' ? entropyPenalty : 0,
    consensusConfidence: Math.min(100, Math.round(adjusted)),
    opinions,
    executedVia: 'COUNCIL_LLM',
    executionMode: isShadowMode ? 'SHADOW' : 'REAL',
    t2tLatencyMs: Math.round(endTime - startTime),
    telemetry,
    zenThought: finalAction === 'HOLD' ? "O conselho está dividido ou em zona neutra. O silêncio é a melhor estratégia." : "Convergência detectada nos extremos de volatilidade.",
    debugVotes,
    trace
  };
}

function executeMathFallback(snapshot: any, isShadowMode: boolean, latency: number): CouncilDecision {
  const rsi = snapshot.rsi || 50;
  const action = rsi > 75 ? 'PUT' : rsi < 25 ? 'CALL' : 'HOLD';
  const debugVotes = `MATH:RSI=${Math.round(rsi)}`;

  return {
    finalAction: action,
    recommendedContract: 'OPTIONS',
    stakeRatio: action !== 'HOLD' ? 0.10 : 0,
    consensusConfidence: 60,
    opinions: [],
    executedVia: 'MATH_FALLBACK',
    executionMode: isShadowMode ? 'SHADOW' : 'REAL',
    t2tLatencyMs: latency,
    telemetry: { avgTokensPerSec: 0, totalTokens: 0, consensusEntropy: 1.0, jitterMs: 0, inferenceHealth: 0 },
    zenThought: "IA Instável. Operando por motor estocástico de emergência.",
    debugVotes
  };
}
