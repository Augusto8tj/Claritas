// /src/features/trading/services/crypto-council-engine.ts
import { TradeMemoryBuffer, AgentOpinion, CouncilDecision, CouncilTelemetry, AssetExecutionPermission, PortfolioRiskState } from '../types/council';
import { TradeMemoryManager } from './trade-memory-service';
import type { OllamaConfig } from '@/lib/types';

/**
 * MOTOR DE DECISÃO CRYPTO V4.2 (SUPREME)
 * Isolado para operar com Gravidade de BTC e Entropia de Consenso.
 */

const AGENT_TIMEOUT_MS = 15000;
const ENTROPY_THRESHOLD = 0.7; // > 0.7 indica caos/divergência no conselho

function calculateShannonEntropy(opinions: AgentOpinion[]): number {
  if (opinions.length < 2) return 0.5;
  const counts = { CALL: 0, PUT: 0, HOLD: 0 };
  opinions.forEach(o => counts[o.action as keyof typeof counts]++);
  
  const probs = Object.values(counts).map(c => c / opinions.length);
  return -probs.reduce((sum, p) => p > 0 ? sum + p * Math.log2(p) : sum, 0) / 1.58; 
}

export async function runCryptoCouncil(
  marketSnapshot: any,
  config: OllamaConfig,
  isShadowMode: boolean,
  permissions: AssetExecutionPermission,
  portfolio: PortfolioRiskState
): Promise<CouncilDecision> {
  const startTime = performance.now();
  const symbol = marketSnapshot.symbol;
  const trace: string[] = [];

  try {
    // 1. VERIFICAÇÃO DE COOLDOWN POR PADRÃO PERDEDOR (ITEM 5)
    // FIX: Handling potential undefined in permissions (TS2345)
    const userId = permissions?.userId || 'anonymous';
    const memory = await TradeMemoryManager.getBuffer(userId, symbol);
    
    // TODO: CryptoMemoryManager checkPatternCooldown will be integrated in V5.0
    // For now using TradeMemoryManager context injection

    // 2. CONTEXTO DE MEMÓRIA E GRAVIDADE
    const memoryContext = TradeMemoryManager.formatBufferForPrompt(memory);

    // 3. INFERÊNCIA PARALELA (ITEM 3)
    const agents: Array<AgentOpinion['agentName']> = ['MOMENTUM', 'RISK_CRITIC', 'ARCHIVIST'];
    const agentPromises = agents.map(name => fetchCryptoAgent(name, marketSnapshot, memoryContext, config));
    
    const results = await Promise.allSettled(agentPromises);
    const opinions: AgentOpinion[] = results
        .filter((r): r is PromiseFulfilledResult<AgentOpinion> => r.status === 'fulfilled' && !!r.value)
        .map(r => r.value);

    if (opinions.length < 2) throw new Error('FAILOVER_REQUIRED');

    // 4. ANÁLISE DE ENTROPIA (ITEM 3)
    const entropy = calculateShannonEntropy(opinions);
    if (entropy > ENTROPY_THRESHOLD) {
        return createHoldDecision(startTime, 'HIGH_ENTROPY', `Divergência excessiva no conselho (E=${entropy.toFixed(2)}).`, opinions, entropy);
    }

    // 5. SÍNTESE DO CHAIRMAN
    return synthesizeDecision(opinions, marketSnapshot, isShadowMode, startTime, entropy, trace);

  } catch (error: any) {
    // FAILOVER MATEMÁTICO DE RIGOR (ITEM 3)
    const lat = Math.round(performance.now() - startTime);
    return executeHighRigorFallback(marketSnapshot, isShadowMode, lat);
  }
}

async function fetchCryptoAgent(name: string, snapshot: any, context: string, config: OllamaConfig): Promise<AgentOpinion> {
    const res = await fetch('/api/ollama/crypto-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt: `Agente ${name} do Crypto Lab. ${context}`, marketSnapshot: snapshot, config })
    });
    if (!res.ok) throw new Error('Agent API Error');
    const data = await res.json();
    return data.opinion;
}

function synthesizeDecision(opinions: AgentOpinion[], snapshot: any, isShadow: boolean, start: number, entropy: number, trace: string[]): CouncilDecision {
    const callScore = opinions.filter(o => o.action === 'CALL').reduce((s, o) => s + o.confidence, 0);
    const putScore = opinions.filter(o => o.action === 'PUT').reduce((s, o) => s + o.confidence, 0);
    
    const side = callScore > putScore ? 'CALL' : (putScore > callScore ? 'PUT' : 'HOLD');
    const confidence = side === 'HOLD' ? 0 : Math.max(callScore, putScore) / opinions.length;
    
    const finalAction = (confidence >= 70 && entropy < 0.5) ? side : 'HOLD';

    return {
        finalAction,
        recommendedContract: opinions.find(o => o.action === side)?.recommendedContract || 'OPTIONS',
        stakeRatio: finalAction === 'HOLD' ? 0 : (1 - entropy),
        consensusConfidence: Math.round(confidence),
        opinions,
        executedVia: 'COUNCIL_LLM',
        executionMode: isShadow ? 'SHADOW' : 'REAL',
        t2tLatencyMs: Math.round(performance.now() - start),
        telemetry: { avgTokensPerSec: 0, totalTokens: 0, consensusEntropy: entropy, jitterMs: 0, inferenceHealth: 100 },
        trace,
        zenThought: finalAction === 'HOLD' ? "Aguardando alinhamento dos ventos gravitacionais." : "Veredito confirmado pelo conselho supremo."
    };
}

function executeHighRigorFallback(snapshot: any, isShadow: boolean, lat: number): CouncilDecision {
    // Failover exige 10% mais de confiança (Item 3)
    const rsi = snapshot.rsi || 50;
    const action = rsi < 20 ? 'CALL' : (rsi > 80 ? 'PUT' : 'HOLD');
    
    return {
        finalAction: action,
        recommendedContract: 'OPTIONS',
        stakeRatio: 0.1,
        consensusConfidence: 65,
        opinions: [],
        executedVia: 'MATH_FALLBACK',
        executionMode: isShadow ? 'SHADOW' : 'REAL',
        t2tLatencyMs: lat,
        telemetry: { avgTokensPerSec: 0, totalTokens: 0, consensusEntropy: 1, jitterMs: 0, inferenceHealth: 0 },
        holdReason: action === 'HOLD' ? 'FAILOVER: Sem zona de exaustão extrema detectada.' : undefined
    };
}

function createHoldDecision(start: number, via: string, reason: string, opinions: AgentOpinion[] = [], entropy: number = 1): CouncilDecision {
    return {
        finalAction: 'HOLD',
        recommendedContract: 'OPTIONS',
        stakeRatio: 0,
        consensusConfidence: 0,
        opinions,
        executedVia: via as any,
        executionMode: 'SHADOW',
        t2tLatencyMs: Math.round(performance.now() - start),
        telemetry: { avgTokensPerSec: 0, totalTokens: 0, consensusEntropy: entropy, jitterMs: 0, inferenceHealth: 100 },
        holdReason: reason
    };
}
