import { TradeMemoryBuffer, AgentOpinion, CouncilDecision, CouncilTelemetry } from '../types/council';
import { TradeMemoryManager } from './trade-memory-service';
import type { OllamaConfig } from '@/lib/types';

// V3.8: Timeouts otimizados para evitar failover matemático em hardware com Jitter alto
const AGENT_TIMEOUT_MS = 7000; 
const CHAIRMAN_THRESHOLD_MS = 9000;

/**
 * Calcula a Entropia de Shannon para medir a divisão do conselho.
 */
function calculateConsensusEntropy(opinions: AgentOpinion[]): number {
  if (opinions.length < 2) return 0.2; // Baixa entropia se houver poucos dados (assumindo quórum)
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

    // Disparo paralelo com timeout individual por agente (Resiliência)
    const agentPromises = agents.map(name => fetchAgentWithTimeout(name, marketSnapshot, memoryContext, config));

    // Aguarda o assentamento de todas as promessas (allSettled impede que uma falha cancele as outras)
    const results = await Promise.allSettled(agentPromises);

    const opinions: AgentOpinion[] = [];
    results.forEach(res => {
        if (res.status === 'fulfilled' && res.value) {
            opinions.push(res.value);
        }
    });

    // Diagnóstico de Quórum
    if (opinions.length < 2) {
        throw new Error('QUORUM_FAILURE');
    }

    // Atalho de Veto Prioritário
    const criticVeto = opinions.find(o => o.agentName === 'RISK_CRITIC' && o.vetoTriggered);
    if (criticVeto && criticVeto.confidence > 75) {
      const endTime = performance.now();
      return {
        finalAction: 'HOLD',
        recommendedContract: 'CALL',
        stakeRatio: 0,
        consensusConfidence: criticVeto.confidence,
        opinions,
        executedVia: 'COUNCIL_VETO',
        executionMode: isShadowMode ? 'SHADOW' : 'REAL',
        t2tLatencyMs: Math.round(endTime - startTime),
        telemetry: generateTelemetry(opinions, startTime, endTime),
        zenThought: "Veto estratégico: Risco detectado pela maioria do quórum."
      };
    }

    return synthesizeChairmanDecision(opinions, marketSnapshot, isShadowMode, startTime);

  } catch (error: any) {
    const endTime = performance.now();
    const latency = Math.round(endTime - startTime);
    
    // Se o erro for de quórum, tentamos o fallback matemático
    return executeMathFallback(marketSnapshot, isShadowMode, latency);
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
        console.warn(`[Council] Agente ${agentName} falhou ou excedeu timeout.`);
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
    MOMENTUM: "Analista 'Quant Momentum'. Foco: velocidade de ticks e força atual. Responda JSON.",
    RISK_CRITIC: "Analista 'Risk Critic'. Foco: buscar motivos para NÃO operar (VETO). Responda JSON.",
    ARCHIVIST: "Analista 'Pattern Archivist'. Foco: comparar com histórico de vitórias. Responda JSON."
  };

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

  if (!response.ok) throw new Error(`Agente ${agentName} offline`);
  const data = await response.json();
  const end = performance.now();
  
  return { 
    ...data.opinion, 
    agentName, 
    latencyMs: Math.round(end - start),
    tokensPerSec: data.metrics?.tokensPerSecond || 0,
    totalTokens: data.metrics?.totalTokens || 0
  };
}

function generateTelemetry(opinions: AgentOpinion[], start: number, end: number): CouncilTelemetry {
  const validOps = opinions.filter(o => o.tokensPerSec !== undefined);
  const tps = validOps.map(o => o.tokensPerSec || 0);
  const latencies = opinions.map(o => o.latencyMs || 0);
  
  return {
    avgTokensPerSec: tps.length ? tps.reduce((a, b) => a + b, 0) / tps.length : 0,
    totalTokens: validOps.reduce((sum, o) => sum + (o.totalTokens || 0), 0),
    consensusEntropy: calculateConsensusEntropy(opinions),
    jitterMs: latencies.length > 1 ? Math.max(...latencies) - Math.min(...latencies) : 0,
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

  if (opinions.length < 2) {
    return executeMathFallback(snapshot, isShadowMode, Math.round(endTime - startTime));
  }

  let callScore = 0;
  let putScore = 0;

  opinions.forEach(op => {
    if (op.action === 'CALL') callScore += op.confidence;
    if (op.action === 'PUT') putScore += op.confidence;
  });

  // Ajuste por Jitter (Se a variabilidade for > 1s, o sinal pode estar "velho")
  const jitterPenalty = telemetry.jitterMs > 1000 ? 0.8 : 1.0;
  
  // Penalidade por desordem (Entropia)
  const entropyPenalty = telemetry.consensusEntropy > 0.6 ? 0.7 : 1.0;
  
  const finalPenalty = jitterPenalty * entropyPenalty;
  const maxScore = Math.max(callScore, putScore) * finalPenalty;
  
  const quorumAdjustedMinScore = (opinions.length / 3) * 120;
  const action = callScore > putScore && maxScore > quorumAdjustedMinScore ? 'CALL' : putScore > callScore && maxScore > quorumAdjustedMinScore ? 'PUT' : 'HOLD';

  return {
    finalAction: action,
    recommendedContract: opinions.find(o => o.action === action)?.recommendedContract || 'CALL',
    stakeRatio: action !== 'HOLD' ? 0.25 * finalPenalty : 0,
    consensusConfidence: Math.round(maxScore / Math.max(1, opinions.length)),
    opinions,
    executedVia: 'COUNCIL_LLM',
    executionMode: isShadowMode ? 'SHADOW' : 'REAL',
    t2tLatencyMs: Math.round(endTime - startTime),
    telemetry,
    zenThought: telemetry.jitterMs > 1000 ? "Hardware sob pressão. Calibrando execução conservadora." : "Conselho operando com latência otimizada."
  };
}

function executeMathFallback(snapshot: any, isShadowMode: boolean, latency: number): CouncilDecision {
  const isOverbought = (snapshot.rsi || 50) > 75;
  const isOversold = (snapshot.rsi || 50) < 25;
  const action = isOverbought ? 'PUT' : isOversold ? 'CALL' : 'HOLD';

  return {
    finalAction: action,
    recommendedContract: 'CALL',
    stakeRatio: action !== 'HOLD' ? 0.10 : 0,
    consensusConfidence: 65,
    opinions: [],
    executedVia: 'MATH_FALLBACK',
    executionMode: isShadowMode ? 'SHADOW' : 'REAL',
    t2tLatencyMs: latency,
    telemetry: {
        avgTokensPerSec: 0,
        totalTokens: 0,
        consensusEntropy: 1.0,
        jitterMs: 0,
        inferenceHealth: 0
    },
    zenThought: "Resiliência: IA ocupada ou lenta. Operando via motor de emergência."
  };
}