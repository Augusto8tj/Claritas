import { TradeMemoryBuffer, AgentOpinion, CouncilDecision, CouncilTelemetry } from '../types/council';
import { TradeMemoryManager } from './trade-memory-service';
import type { OllamaConfig } from '@/lib/types';

// V3.7: Timeouts relaxados para suportar modelos locais mais pesados (ex: Llama3/Llava)
const OLLAMA_TIMEOUT_MS = 5000; 
const TOTAL_FAILOVER_TIMEOUT_MS = 8000;

/**
 * Calcula a Entropia de Shannon para medir a divisão do conselho.
 */
function calculateConsensusEntropy(opinions: AgentOpinion[]): number {
  if (opinions.length < 2) return 0.5; // Incerteza base com poucos dados
  const counts = { CALL: 0, PUT: 0, HOLD: 0 };
  opinions.forEach(o => counts[o.action]++);
  
  const probs = Object.values(counts).map(c => c / opinions.length);
  // Entropia normalizada: 0 (harmonia) a 1 (caos)
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

    // Fan-Out: Disparo paralelo dos analistas
    const agentPromises = [
      fetchAgentAnalysis('MOMENTUM', marketSnapshot, memoryContext, config),
      fetchAgentAnalysis('RISK_CRITIC', marketSnapshot, memoryContext, config),
      fetchAgentAnalysis('ARCHIVIST', marketSnapshot, memoryContext, config),
    ];

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('COUNCIL_TIMEOUT')), OLLAMA_TIMEOUT_MS)
    );

    const raceResults = await Promise.race([
        Promise.allSettled(agentPromises),
        timeoutPromise
    ]);

    const opinions: AgentOpinion[] = [];
    if (Array.isArray(raceResults)) {
        raceResults.forEach(res => {
            if (res.status === 'fulfilled') opinions.push(res.value);
        });
    }

    // Atalho de Veto: Se o Crítico identificou perigo iminente
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
        zenThought: "Veto estratégico: O Risk Critic identificou semelhança com perdas anteriores."
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
    MOMENTUM: "Aja como 'Quant Momentum'. Foco: força e velocidade. Responda apenas JSON ultra-conciso.",
    RISK_CRITIC: "Aja como 'Risk Critic'. Foco: VETO e erros passados. Responda apenas JSON ultra-conciso.",
    ARCHIVIST: "Aja como 'Pattern Archivist'. Foco: semelhança com vitórias. Responda apenas JSON ultra-conciso."
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

  if (!response.ok) throw new Error(`Agente ${agentName} offline`);
  const data = await response.json();
  const end = performance.now();
  
  // V3.7: Agora usamos as métricas REAIS enviadas pelo Ollama através da nossa rota API
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

  if (opinions.length === 0) {
    return executeMathFallback(snapshot, isShadowMode, Math.round(endTime - startTime));
  }

  let callScore = 0;
  let putScore = 0;

  opinions.forEach(op => {
    if (op.action === 'CALL') callScore += op.confidence;
    if (op.action === 'PUT') putScore += op.confidence;
  });

  // Penalidade por desordem (Entropia)
  const entropyPenalty = telemetry.consensusEntropy > 0.6 ? 0.7 : 1.0;
  const maxScore = Math.max(callScore, putScore) * entropyPenalty;
  
  // Exige pelo menos 2 opiniões ou uma opinião muito forte
  const minRequiredScore = opinions.length > 1 ? 120 : 85;
  const action = callScore > putScore && maxScore > minRequiredScore ? 'CALL' : putScore > callScore && maxScore > minRequiredScore ? 'PUT' : 'HOLD';

  return {
    finalAction: action,
    recommendedContract: opinions.find(o => o.action === action)?.recommendedContract || 'CALL',
    stakeRatio: action !== 'HOLD' ? 0.25 : 0,
    consensusConfidence: Math.round(maxScore / Math.max(1, opinions.length)),
    opinions,
    executedVia: 'COUNCIL_LLM',
    executionMode: isShadowMode ? 'SHADOW' : 'REAL',
    t2tLatencyMs: Math.round(endTime - startTime),
    telemetry,
    zenThought: telemetry.consensusEntropy < 0.3 ? "Conselho em harmonia. Execução otimizada." : "Divergência detectada. Reduzindo exposição."
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
        consensusEntropy: 1.0, // Sinaliza incerteza máxima para a telemetria
        jitterMs: 0,
        inferenceHealth: 0
    },
    zenThought: "IA silenciada (timeout/erro). Operando via motor estocástico de segurança."
  };
}
