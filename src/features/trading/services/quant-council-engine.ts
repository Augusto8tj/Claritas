
import { TradeMemoryBuffer, AgentOpinion, CouncilDecision } from '../types/council';
import { TradeMemoryManager } from './trade-memory-service';
import type { OllamaConfig } from '@/lib/types';

const OLLAMA_TIMEOUT_MS = 1200;

export async function runQuantCouncil(
  marketSnapshot: any,
  memoryBuffer: TradeMemoryBuffer,
  config: OllamaConfig,
  isShadowMode: boolean
): Promise<CouncilDecision> {
  const startTime = performance.now();

  try {
    const memoryContext = TradeMemoryManager.formatBufferForPrompt(memoryBuffer);

    // 1. FAN-OUT: Dispara os 3 Analistas em Paralelo
    const agentPromises = [
      fetchAgentAnalysis('MOMENTUM', marketSnapshot, memoryContext, config),
      fetchAgentAnalysis('RISK_CRITIC', marketSnapshot, memoryContext, config),
      fetchAgentAnalysis('ARCHIVIST', marketSnapshot, memoryContext, config),
    ];

    // Race contra o timeout
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

    // Se o Advogado do Diabo (Risk Critic) emitir VETO com alta confiança, encerra imediatamente
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
        zenThought: "O Risk Critic identificou semelhança crítica com histórico recente de perda. Preservar capital é a maior vitória."
      };
    }

    // 2. FAN-IN: O CIO Chairman Consolida as Opiniões
    return synthesizeChairmanDecision(opinions, marketSnapshot, isShadowMode, startTime);

  } catch (error) {
    const endTime = performance.now();
    return executeMathFallback(marketSnapshot, isShadowMode, Math.round(endTime - startTime));
  }
}

async function fetchAgentAnalysis(
  agentType: AgentOpinion['agentName'],
  snapshot: any,
  memoryContext: string,
  config: OllamaConfig
): Promise<AgentOpinion> {
  const systemPrompts = {
    MOMENTUM: "Você é o 'Quant Momentum' (O Caçador). Foque estritamente em velocidade de ticks, ADX e força direcional na vela de 1M.",
    RISK_CRITIC: "Você é o 'Risk Critic' (O Advogado do Diabo). Seu objetivo é buscar motivos para NÃO operar. Compare a vela atual com os padrões de LOSS recentes. Se encontrar risco alto, defina vetoTriggered: true.",
    ARCHIVIST: "Você é o 'Pattern Archivist' (O Historiador). Compare a estrutura de pavio e corpo da vela de 1M com o histórico de WINS."
  };

  const response = await fetch('/api/ollama/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemPrompt: `${systemPrompts[agentType]}\n${memoryContext}`,
      marketSnapshot: snapshot,
      config: config
    })
  });

  if (!response.ok) throw new Error(`Agente ${agentType} falhou`);
  const data = await response.json();
  return { ...data, agentName: agentType };
}

function synthesizeChairmanDecision(
  opinions: AgentOpinion[],
  snapshot: any,
  isShadowMode: boolean,
  startTime: number
): CouncilDecision {
  const endTime = performance.now();
  const latency = Math.round(endTime - startTime);

  if (opinions.length === 0) {
    return executeMathFallback(snapshot, isShadowMode, latency);
  }

  let callScore = 0;
  let putScore = 0;

  opinions.forEach(op => {
    if (op.action === 'CALL') callScore += op.confidence;
    if (op.action === 'PUT') putScore += op.confidence;
  });

  const totalScore = callScore + putScore;
  const action = callScore > putScore && callScore > 130 ? 'CALL' : putScore > callScore && putScore > 130 ? 'PUT' : 'HOLD';

  return {
    finalAction: action,
    recommendedContract: opinions[0]?.recommendedContract || 'CALL',
    stakeRatio: action !== 'HOLD' ? 0.25 : 0,
    consensusConfidence: totalScore > 0 ? Math.round(Math.max(callScore, putScore) / opinions.length) : 0,
    opinions,
    executedVia: 'COUNCIL_LLM',
    executionMode: isShadowMode ? 'SHADOW' : 'REAL',
    t2tLatencyMs: latency,
    zenThought: "Consenso atingido pelo conselho quantitativo paralelo."
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
    zenThought: "Execução via Motor Matemático Fallback devido a limite de latência atingido no conselho."
  };
}
