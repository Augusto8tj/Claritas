
import { TradeMemoryBuffer, AgentOpinion, CouncilDecision, CouncilTelemetry } from '../types/council';
import { TradeMemoryManager } from './trade-memory-service';
import type { OllamaConfig } from '@/lib/types';

// V4.6: Timeouts resilientes para evitar Failed to Fetch
const AGENT_TIMEOUT_MS = 15000; 

/**
 * Calcula a Entropia de Shannon para medir a divisão do conselho.
 */
function calculateConsensusEntropy(opinions: AgentOpinion[]): number {
  if (opinions.length < 2) return 0.2; 
  const counts = { CALL: 0, PUT: 0, HOLD: 0 };
  opinions.forEach(o => counts[o.action]++);
  
  const probs = Object.values(counts).map(c => c / opinions.length);
  return -probs.reduce((sum, p) => p > 0 ? sum + p * Math.log2(p) : sum, 0) / 1.58; 
}

export async function runQuantCouncil(
  marketSnapshot: any,
  memoryBuffer: TradeMemoryBuffer,
  config: OllamaConfig,
  isShadowMode: boolean
): Promise<CouncilDecision> {
  const startTime = performance.now();

  try {
    const memoryContext = TradeMemoryManager.formatBufferForPrompt(memoryBuffer);

    // Lista de agentes para o conselho
    const agents: Array<AgentOpinion['agentName']> = ['MOMENTUM', 'RISK_CRITIC', 'ARCHIVIST'];

    // Disparo paralelo com resiliência: colhe o que for possível se houver falhas parciais
    const agentPromises = agents.map(name => fetchAgentWithTimeout(name, marketSnapshot, memoryContext, config));

    const results = await Promise.allSettled(agentPromises);
    const opinions: AgentOpinion[] = [];
    results.forEach(res => {
        if (res.status === 'fulfilled' && res.value) {
            opinions.push(res.value);
        }
    });

    // Diagnóstico de Quórum
    if (opinions.length < 1) {
        throw new Error('NETWORK_FAILURE_ALL_AGENTS');
    }

    // REGRA DE OURO: Veto do Crítico de Risco tem peso dobrado na segurança
    const critic = opinions.find(o => o.agentName === 'RISK_CRITIC');
    if (critic?.vetoTriggered && critic.confidence > 70) {
      const endTime = performance.now();
      return {
        finalAction: 'HOLD',
        recommendedContract: 'CALL',
        stakeRatio: 0,
        consensusConfidence: critic.confidence,
        opinions,
        executedVia: 'RISK_VETO',
        executionMode: isShadowMode ? 'SHADOW' : 'REAL',
        t2tLatencyMs: Math.round(endTime - startTime),
        telemetry: generateTelemetry(opinions, startTime, endTime),
        zenThought: `Veto Soberano do Risco: ${critic.reasoning}`
      };
    }

    return synthesizeChairmanDecision(opinions, marketSnapshot, isShadowMode, startTime);

  } catch (error: any) {
    const endTime = performance.now();
    return executeMathFallback(marketSnapshot, isShadowMode, Math.round(endTime - startTime));
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
        // Silencia erro de fetch individual para manter a estabilidade do conselho
        console.warn(`[Agent ${agentName}] Fetch failed:`, e);
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
  
  const systemPrompts = {
    MOMENTUM: `Você é o analista 'Quant Momentum'. 
    MISSÃO: Identificar força de explosão e velocidade de ticks. 
    FOCO: RSI, ADX e inclinação de preços. 
    COMPORTAMENTO: Você é agressivo e busca lucro rápido. 
    SAÍDA: JSON estrito.`,
    
    RISK_CRITIC: `Você é o analista 'Risk Critic'. 
    MISSÃO: Encontrar motivos para o trade FALHAR. 
    FOCO: Volatilidade (BBW), reversões bruscas e incerteza. 
    COMPORTAMENTO: Você é cético e pessimista. Use 'vetoTriggered: true' se o risco for alto. 
    SAÍDA: JSON estrito.`,
    
    ARCHIVIST: `Você é o analista 'Pattern Archivist'. 
    MISSÃO: Comparar o estado atual com o histórico de vitórias/derrotas. 
    FOCO: Memória de curto prazo e recorrência de padrões de velas. 
    COMPORTAMENTO: Você é metódico e conservador. 
    SAÍDA: JSON estrito.`
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

    if (!response.ok) throw new Error(`Agent API responded with ${response.status}`);
    
    const data = await response.json();
    const end = performance.now();
    
    return { 
      ...data.opinion, 
      agentName, 
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
  startTime: number
): CouncilDecision {
  const endTime = performance.now();
  const telemetry = generateTelemetry(opinions, startTime, endTime);

  let callScore = 0;
  let putScore = 0;

  opinions.forEach(op => {
    // Pesos: Momentum(1.0), Archivist(1.2), Risk_Critic(0.8 p/ ação, 2.0 p/ veto)
    const weight = op.agentName === 'ARCHIVIST' ? 1.2 : 1.0;
    if (op.action === 'CALL') callScore += op.confidence * weight;
    if (op.action === 'PUT') putScore += op.confidence * weight;
  });

  const entropyPenalty = telemetry.consensusEntropy > 0.6 ? 0.6 : 1.0;
  const maxScore = Math.max(callScore, putScore) * entropyPenalty;
  
  // Limiar adaptativo: exige confiança mínima baseada no número de agentes que responderam
  const threshold = opinions.length >= 2 ? 140 : 85; 
  const action = callScore > putScore && maxScore > threshold ? 'CALL' : putScore > callScore && maxScore > threshold ? 'PUT' : 'HOLD';

  return {
    finalAction: action,
    recommendedContract: opinions.find(o => o.action === action)?.recommendedContract || 'CALL',
    stakeRatio: action !== 'HOLD' ? 0.25 * entropyPenalty : 0,
    consensusConfidence: Math.round(maxScore / Math.max(1, opinions.length)),
    opinions,
    executedVia: 'CHAIRMAN_SYNTHESIS',
    executionMode: isShadowMode ? 'SHADOW' : 'REAL',
    t2tLatencyMs: Math.round(endTime - startTime),
    telemetry,
    zenThought: action === 'HOLD' ? "O conselho está dividido. O silêncio é a melhor estratégia." : "Convergência detectada entre especialistas."
  };
}

function executeMathFallback(snapshot: any, isShadowMode: boolean, latency: number): CouncilDecision {
  const rsi = snapshot.rsi || 50;
  const action = rsi > 75 ? 'PUT' : rsi < 25 ? 'CALL' : 'HOLD';

  return {
    finalAction: action,
    recommendedContract: 'CALL',
    stakeRatio: action !== 'HOLD' ? 0.10 : 0,
    consensusConfidence: 60,
    opinions: [],
    executedVia: 'MATH_FALLBACK',
    executionMode: isShadowMode ? 'SHADOW' : 'REAL',
    t2tLatencyMs: latency,
    telemetry: { avgTokensPerSec: 0, totalTokens: 0, consensusEntropy: 1.0, jitterMs: 0, inferenceHealth: 0 },
    zenThought: "IA Instável ou Lenta. Operando por motor estocástico de emergência."
  };
}
