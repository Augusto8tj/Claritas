
import { TradeMemoryBuffer, AgentOpinion, CouncilDecision, CouncilTelemetry } from '../types/council';
import { TradeMemoryManager } from './trade-memory-service';
import type { OllamaConfig } from '@/lib/types';

const OLLAMA_TIMEOUT_MS = 1200;

/**
 * Calcula a Entropia de Shannon para medir a divisão do conselho.
 */
function calculateConsensusEntropy(opinions: AgentOpinion[]): number {
  if (opinions.length === 0) return 1;
  const counts = { CALL: 0, PUT: 0, HOLD: 0 };
  opinions.forEach(o => counts[o.action]++);
  
  const probs = Object.values(counts).map(c => c / opinions.length);
  return -probs.reduce((sum, p) => p > 0 ? sum + p * Math.log2(p) : sum, 0) / 1.58; // Normalizado para 0-1
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

    const agentPromises = [
      fetchAgentAnalysis('MOMENTUM', marketSnapshot, memoryContext, config),
      fetchAgentAnalysis('RISK_CRITIC', marketSnapshot, memoryContext, config),
      fetchAgentAnalysis('ARCHIVIST', marketSnapshot, memoryContext, config),
    ];

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('TIMEOUT')), OLLAMA_TIMEOUT_MS)
    );

    const results = await Promise.allSettled([
      Promise.race([Promise.all(agentPromises), timeoutPromise])
    ]);

    const opinions: AgentOpinion[] = [];
    if (results[0].status === 'fulfilled') {
      const agentResults = results[0].value as AgentOpinion[];
      opinions.push(...agentResults);
    }

    const criticVeto = opinions.find(o => o.agentName === 'RISK_CRITIC' && o.vetoTriggered);
    if (criticVeto && criticVeto.confidence > 75) {
      const endTime = performance.now();
      return {
        finalAction: 'HOLD',
        recommendedContract: 'CALL',
        stakeRatio: 0,
        consensusConfidence: criticVeto.confidence,
        opinions,
        executedVia: 'COUNCIL_LLM',
        executionMode: isShadowMode ? 'SHADOW' : 'REAL',
        t2tLatencyMs: Math.round(endTime - startTime),
        telemetry: generateTelemetry(opinions, startTime, endTime),
        zenThought: "O Risk Critic identificou semelhança crítica com histórico recente de perda. Preservar capital é a maior vitória."
      };
    }

    return synthesizeChairmanDecision(opinions, marketSnapshot, isShadowMode, startTime);

  } catch (error) {
    const endTime = performance.now();
    return executeMathFallback(marketSnapshot, isShadowMode, Math.round(endTime - startTime));
  }
}

async function fetchAgentAnalysis(
  agentName: AgentOpinion['agentName'],
  snapshot: any,
  memoryContext: string,
  config: OllamaConfig
): Promise<AgentOpinion> {
  const start = performance.now();
  const systemPrompts = {
    MOMENTUM: "Você é o 'Quant Momentum'. Analise velocidade de ticks e força direcional.",
    RISK_CRITIC: "Você é o 'Risk Critic'. Busque motivos para VETO baseados em perdas recentes.",
    ARCHIVIST: "Você é o 'Pattern Archivist'. Compare a estrutura da vela com vitórias passadas."
  };

  const response = await fetch('/api/ollama/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemPrompt: `${systemPrompts[agentName]}\n${memoryContext}`,
      marketSnapshot: snapshot,
      config: config
    })
  });

  if (!response.ok) throw new Error(`Agente ${agentName} falhou`);
  const data = await response.json();
  const end = performance.now();
  const latency = end - start;

  // Em um app real, o backend retornaria eval_count. Aqui simulamos para o monitor.
  const simulatedTokens = Math.floor(latency / 10); 

  return { 
    ...data, 
    agentName, 
    latencyMs: Math.round(latency),
    tokensPerSec: Math.round(simulatedTokens / (latency / 1000))
  };
}

function generateTelemetry(opinions: AgentOpinion[], start: number, end: number): CouncilTelemetry {
  const latencies = opinions.map(o => o.latencyMs || 0);
  const tps = opinions.map(o => o.tokensPerSec || 0);
  
  return {
    avgTokensPerSec: tps.length ? tps.reduce((a, b) => a + b, 0) / tps.length : 0,
    totalTokens: tps.length ? tps.reduce((a, b) => a + b, 0) : 0,
    consensusEntropy: calculateConsensusEntropy(opinions),
    jitterMs: latencies.length ? Math.max(...latencies) - Math.min(...latencies) : 0,
    inferenceHealth: opinions.length === 3 ? 100 : (opinions.length / 3) * 100
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

  if (opinions.length === 0) {
    return executeMathFallback(snapshot, isShadowMode, Math.round(endTime - startTime));
  }

  let callScore = 0;
  let putScore = 0;

  opinions.forEach(op => {
    if (op.action === 'CALL') callScore += op.confidence;
    if (op.action === 'PUT') putScore += op.confidence;
  });

  // PENALIDADE NERD: Se a entropia for alta (> 0.7), reduzimos a confiança do consenso
  const entropyPenalty = telemetry.consensusEntropy > 0.7 ? 0.8 : 1.0;
  const maxScore = Math.max(callScore, putScore) * entropyPenalty;
  const action = callScore > putScore && maxScore > 130 ? 'CALL' : putScore > callScore && maxScore > 130 ? 'PUT' : 'HOLD';

  return {
    finalAction: action,
    recommendedContract: opinions[0]?.recommendedContract || 'CALL',
    stakeRatio: action !== 'HOLD' ? 0.25 : 0,
    consensusConfidence: Math.round(maxScore / Math.max(1, opinions.length)),
    opinions,
    executedVia: 'COUNCIL_LLM',
    executionMode: isShadowMode ? 'SHADOW' : 'REAL',
    t2tLatencyMs: Math.round(endTime - startTime),
    telemetry,
    zenThought: telemetry.consensusEntropy < 0.3 ? "Conselho em harmonia absoluta. Configuração de alta probabilidade." : "Há divergências no conselho. Cautela recomendada."
  };
}

function executeMathFallback(snapshot: any, isShadowMode: boolean, latency: number): CouncilDecision {
  const isOverbought = (snapshot.rsi || 50) > 70;
  const isOversold = (snapshot.rsi || 50) < 30;
  const action = isOverbought ? 'PUT' : isOversold ? 'CALL' : 'HOLD';

  return {
    finalAction: action,
    recommendedContract: 'CALL',
    stakeRatio: action !== 'HOLD' ? 0.15 : 0,
    consensusConfidence: 75,
    opinions: [],
    executedVia: 'MATH_FALLBACK',
    executionMode: isShadowMode ? 'SHADOW' : 'REAL',
    t2tLatencyMs: latency,
    telemetry: {
        avgTokensPerSec: 0,
        totalTokens: 0,
        consensusEntropy: 1,
        jitterMs: 0,
        inferenceHealth: 0
    },
    zenThought: "Execução via Motor Matemático Fallback devido a limite de latência atingido no conselho."
  };
}
