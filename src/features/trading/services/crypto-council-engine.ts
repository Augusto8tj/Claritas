// src/features/trading/services/crypto-council-engine.ts
import { TradeMemoryBuffer, AgentOpinion, CouncilDecision, CouncilTelemetry, AssetExecutionPermission, PortfolioRiskState } from '../types/council';
import { TradeMemoryManager } from './trade-memory-service';
import { RuleReport } from './backtest';
import type { OllamaConfig } from '@/lib/types';

export const MIN_EXEC_CONFIDENCE = 65;
const RISK_DAMPING = 250;
const AGENT_TIMEOUT_MS = 15000; 

const CONTRACT_SELECTION_GUIDE = `Contrato: BBW baixo ou BTC Compression→ACCUMULATORS | ADX>30 ou BTC Impulse→MULTIPLIERS | padrão→OPTIONS.`;

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

export async function runCryptoCouncil(
  marketSnapshot: any,
  memoryBuffer: TradeMemoryBuffer,
  config: OllamaConfig,
  isShadowMode: boolean,
  isFocused: boolean,
  permissions?: AssetExecutionPermission,
  portfolio?: PortfolioRiskState,
  backtestReports?: RuleReport[]
): Promise<CouncilDecision> {
  const startTime = performance.now();
  const symbol = marketSnapshot.symbol;
  const trace: string[] = [];

  try {
    const memoryContext = TradeMemoryManager.formatBufferForPrompt(memoryBuffer);
    
    let backtestContext = "";
    if (backtestReports && backtestReports.length > 0) {
        backtestContext = "\n### VALIDAÇÃO ESTATÍSTICA (BACKTEST RECENTE):\n";
        backtestReports.forEach(r => {
            backtestContext += `- Regra ${r.rule}: acerto ${ (r.stat.rate * 100).toFixed(1) }% (n=${r.stat.n}) → ${r.verdict.toUpperCase()}\n`;
        });
    }

    const gravityContext = marketSnapshot.gravity ? 
      `\n### BITCOIN GRAVITY (CORRELAÇÃO LÍDER):\nEstado=${marketSnapshot.gravity.btcVector} | zBtc=${marketSnapshot.gravity.zBtc?.toFixed(2)} | zTarget=${marketSnapshot.gravity.zTarget?.toFixed(2)} | Corr=${marketSnapshot.gravity.correlation.toFixed(3)} | Slingshot=${marketSnapshot.gravity.slingshotDetected}` : 
      "\nBITCOIN GRAVITY: N/A";

    const agents: Array<AgentOpinion['agentName']> = ['MOMENTUM', 'RISK_CRITIC', 'ARCHIVIST'];

    // V5.3: Execução escalonada (Prioridade Momentum/Risk para análise de choque)
    const priorityAgents = ['MOMENTUM', 'RISK_CRITIC'] as const;
    const priorityPromises = priorityAgents.map(name => fetchAgentWithTimeout(name, marketSnapshot, memoryContext + backtestContext + gravityContext, config));
    
    // Delay estratégico para o Archivist (reduz concorrência na VRAM local)
    await new Promise(r => setTimeout(r, 250));
    const archivistPromise = fetchAgentWithTimeout('ARCHIVIST', marketSnapshot, memoryContext + backtestContext + gravityContext, config);

    const results = await Promise.allSettled([...priorityPromises, archivistPromise]);
    
    const opinions: AgentOpinion[] = [];
    results.forEach((res, i) => {
        const agentName = i < 2 ? priorityAgents[i] : 'ARCHIVIST';
        if (res.status === 'fulfilled' && res.value) {
            const op = res.value;
            trace.push(`${agentName}: ${op.action} ${op.confidence}% ${op.recommendedContract} veto=${op.vetoTriggered ? 'sim' : 'nao'}`);
            opinions.push(op);
        }
    });

    if (opinions.length < 1) throw new Error('NETWORK_FAILURE_ALL_AGENTS');

    return synthesizeChairmanDecision(opinions, marketSnapshot, isShadowMode, startTime, backtestReports, trace, permissions);

  } catch (error: any) {
    const endTime = performance.now();
    return executeHighRigorFallback(marketSnapshot, isShadowMode, Math.round(endTime - startTime));
  }
}

async function fetchAgentWithTimeout(
    agentName: AgentOpinion['agentName'],
    snapshot: any,
    context: string,
    config: OllamaConfig
): Promise<AgentOpinion | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

    try {
        const opinion = await fetchAgentAnalysis(agentName, snapshot, context, config, controller.signal);
        clearTimeout(timeoutId);
        return opinion;
    } catch (e) {
        return null;
    }
}

async function fetchAgentAnalysis(
  agentName: AgentOpinion['agentName'],
  snapshot: any,
  context: string,
  config: OllamaConfig,
  signal: AbortSignal
): Promise<AgentOpinion> {
  const start = performance.now();
  const isSling = snapshot.sentinel?.rule === 'LEADLAG_SLINGSHOT';
  
  const strategyInstruction = isSling 
    ? `MODO LEAD-LAG ATIVO: Siga o sentinel.direction. O Bitcoin está puxando o mercado. Ignore o RSI se houver arraste gravitacional.`
    : `MODO REVERSÃO/MOMENTUM: RSI < 35 = COMPRA, RSI > 65 = VENDA.`;

  const systemPrompts = {
    MOMENTUM: `VOCÊ É UNICAMENTE O ANALISTA 'QUANT MOMENTUM'. ${strategyInstruction} Foque no zBtc e no Momentum do alvo. ${CONTRACT_SELECTION_GUIDE}`,
    RISK_CRITIC: `VOCÊ É UNICAMENTE O ANALISTA 'RISK CRITIC'. ${strategyInstruction} Verifique se zTarget está começando a seguir zBtc. ${CONTRACT_SELECTION_GUIDE}`,
    ARCHIVIST: `VOCÊ É UNICAMENTE O ANALISTA 'PATTERN ARCHIVIST'. ${strategyInstruction} Compare com padrões de Lead-Lag passados. ${CONTRACT_SELECTION_GUIDE}`
  };

  try {
    // V13: Fallback transparente de endpoint
    let endpoint = '/api/ollama/crypto-agent';
    let response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ systemPrompt: `${systemPrompts[agentName]}\n${context}`, marketSnapshot: snapshot, config: config })
    });

    if (response.status === 404) {
      endpoint = '/api/ollama/agent';
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ systemPrompt: `${systemPrompts[agentName]}\n${context}`, marketSnapshot: snapshot, config: config })
      });
    }

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
  
  // V13: Jitter desconta o tempo de fila/staggering para medir eficiência do hardware
  const latencies = opinions.map(o => o.latencyMs || 0);
  const jitterMs = latencies.length > 1 ? Math.max(...latencies) - Math.min(...latencies) : 0;

  return {
    avgTokensPerSec: validOps.length ? validOps.reduce((a, b) => a + (b.tokensPerSec || 0), 0) / validOps.length : 0,
    totalTokens,
    consensusEntropy: calculateConsensusEntropy(opinions),
    jitterMs,
    inferenceHealth: Math.round((opinions.length / 3) * 100)
  };
}

function synthesizeChairmanDecision(
  opinions: AgentOpinion[], 
  snapshot: any, 
  isShadow: boolean, 
  start: number, 
  backtestReports: RuleReport[] | undefined, 
  trace: string[],
  permissions?: AssetExecutionPermission
): CouncilDecision {
    const entropy = calculateConsensusEntropy(opinions);
    
    // 1. Implementação Real do COUNCIL_VETO (Spec V5.3)
    const criticalVeto = opinions.find(o => (o.agentName === 'RISK_CRITIC' || o.agentName === 'ARCHIVIST') && o.vetoTriggered && o.confidence >= 70);
    if (criticalVeto) {
        return {
            finalAction: 'HOLD',
            recommendedContract: 'OPTIONS',
            stakeRatio: 0,
            consensusConfidence: criticalVeto.confidence,
            opinions,
            executedVia: 'COUNCIL_VETO',
            executionMode: isShadow ? 'SHADOW' : 'REAL',
            t2tLatencyMs: Math.round(performance.now() - start),
            telemetry: generateTelemetry(opinions, start, performance.now()),
            holdReason: `VETO DO CONSELHO: ${criticalVeto.agentName} (${criticalVeto.reasoning})`,
            debugVotes: opinions.map(o => `${o.agentName.charAt(0)}:${o.action}/${o.confidence}`).join(' '),
            trace,
            zenThought: `Sinal vetado por salvaguarda institucional: ${criticalVeto.agentName}.`
        };
    }

    const callScore = opinions.filter(o => o.action === 'CALL').reduce((s, o) => s + o.confidence, 0);
    const putScore = opinions.filter(o => o.action === 'PUT').reduce((s, o) => s + o.confidence, 0);
    
    const side = callScore > putScore ? 'CALL' : (putScore > callScore ? 'PUT' : 'HOLD');
    let finalAction = side;
    let holdReason = undefined;

    // 2. Validação de Permissões
    if (permissions && finalAction !== 'HOLD') {
        if (!permissions.allowedActions.includes(finalAction as any)) {
            finalAction = 'HOLD';
            holdReason = `VETO_PERMISSÃO: Direção ${finalAction} não autorizada para este ativo.`;
        }
    }
    
    const winningOpinions = opinions.filter(o => o.action === side);
    const avgConfidence = finalAction === 'HOLD' ? 0 : (winningOpinions.reduce((s, o) => s + o.confidence, 0)) / (winningOpinions.length || 1);

    if (entropy > 0.7 && finalAction !== 'HOLD') {
        finalAction = 'HOLD';
        holdReason = `HIGH_ENTROPY: Conselho excessivamente dividido (${entropy.toFixed(2)}).`;
    }

    if (finalAction !== 'HOLD' && avgConfidence < MIN_EXEC_CONFIDENCE) {
        finalAction = 'HOLD';
        holdReason = `CONFIANÇA BAIXA: Média de ${avgConfidence.toFixed(0)}% < ${MIN_EXEC_CONFIDENCE}%.`;
    }

    let recommendedContract = selectBestContract(opinions, side as string);
    if (permissions && !permissions.allowedContracts.includes(recommendedContract)) {
        recommendedContract = permissions.allowedContracts[0] || 'OPTIONS';
    }

    return {
        finalAction: finalAction as 'CALL' | 'PUT' | 'HOLD',
        recommendedContract,
        stakeRatio: finalAction === 'HOLD' ? 0 : (1 - (entropy * 0.5)),
        consensusConfidence: Math.round(avgConfidence),
        opinions,
        executedVia: 'COUNCIL_LLM',
        executionMode: isShadow ? 'SHADOW' : 'REAL',
        t2tLatencyMs: Math.round(performance.now() - start),
        telemetry: generateTelemetry(opinions, start, performance.now()),
        holdReason,
        debugVotes: opinions.map(o => `${o.agentName.charAt(0)}:${o.action}/${o.confidence}`).join(' '),
        trace
    };
}

function executeHighRigorFallback(marketSnapshot: any, isShadowMode: boolean, lat: number): CouncilDecision {
    const sentinel = marketSnapshot.sentinel;
    const gravity = marketSnapshot.gravity;

    // V13: Failover Inteligente com critério de altíssimo rigor heurístico
    const score = sentinel?.score || 0;
    const correlation = gravity?.correlation || 0;
    const hasGravityVeto = !!gravity?.vetoReason;

    if (sentinel && score >= 85 && !hasGravityVeto && correlation >= 0.75) {
        return {
            finalAction: sentinel.direction as any,
            recommendedContract: gravity?.slingshotDetected ? 'MULTIPLIERS' : 'OPTIONS',
            stakeRatio: 0.5, 
            consensusConfidence: MIN_EXEC_CONFIDENCE,
            opinions: [],
            executedVia: 'MATH_FALLBACK',
            executionMode: isShadowMode ? 'SHADOW' : 'REAL',
            t2tLatencyMs: lat,
            telemetry: { avgTokensPerSec: 0, totalTokens: 0, consensusEntropy: 0.1, jitterMs: 0, inferenceHealth: 50 },
            zenThought: "Failover Ativado: Sentinel de altíssimo rigor detectado. Executando via heurística matemática.",
            trace: ["FAILOVER_INTELLIGENT_SUCCESS"]
        };
    }

    return {
        finalAction: 'HOLD',
        recommendedContract: 'OPTIONS',
        stakeRatio: 0,
        consensusConfidence: 0,
        opinions: [],
        executedVia: 'MATH_FALLBACK',
        executionMode: isShadowMode ? 'SHADOW' : 'REAL',
        t2tLatencyMs: lat,
        telemetry: { avgTokensPerSec: 0, totalTokens: 0, consensusEntropy: 1, jitterMs: 0, inferenceHealth: 0 },
        holdReason: 'FAILOVER_CONSERVATIVE: Heurística matemática não atingiu limiar de segurança (Score < 85).',
        debugVotes: "FALLBACK_HOLD",
        trace: ["FAILOVER_REJECTED"]
    };
}
