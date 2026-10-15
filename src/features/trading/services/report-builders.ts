import { SignalCandidate, SignalFeatures } from './signal-engine';
import { CouncilDecision, CouncilStats } from '../types/council';
import { RuleReport } from './backtest';
import { Operation } from '@/lib/types';

/**
 * @fileOverview REPORT BUILDERS V5.0 (SUPREME EDITION)
 * Motor de síntese de dados para comunicação Homem-Máquina e Auditoria Institucional.
 * Recuperado e expandido para suportar Cluster Cripto, Gravidade e Trailing Floor.
 */

const REAL_MARKET_RE = /^(frx|cry|OTC_)/;
export const groupOf = (sym: string) => REAL_MARKET_RE.test(sym) ? 'REAIS' : 'SINTETICOS';

interface StatusReportParams {
    isShadowMode: boolean;
    isAutoMode: boolean;
    accountType: string;
    balance: number;
    stats: CouncilStats;
    openPositions: Operation[];
    maxConcurrentTrades: number;
    lockedProfitFloor?: number; 
    sentinel: Record<string, { features: SignalFeatures | null, candidates: SignalCandidate[], ts: number, gravity?: any }>;
    sentinelCounts?: Record<string, number>;
    lastDecisions: Record<string, { ts: number, decision: CouncilDecision }>;
    staleMinutes: (sym: string) => number | null;
}

/**
 * Constrói o relatório de status global do sistema.
 */
export function buildStatusReport(params: StatusReportParams): string {
    const { 
        isShadowMode, isAutoMode, accountType, balance, stats, 
        openPositions, maxConcurrentTrades, lockedProfitFloor = 0,
        sentinel, sentinelCounts, lastDecisions, staleMinutes 
    } = params;

    const nowStr = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const mode = isShadowMode ? 'SHADOW' : 'REAL';
    const pilot = isAutoMode ? 'ON' : 'OFF';
    const symbols = Object.keys(sentinel);
    
    let report = `[RELATÓRIO TÁTICO SUPREME] ${nowStr}\n`;
    report += `--------------------------------------------------\n`;
    report += `MODO: ${mode} | PILOTO: ${pilot} | CONTA: ${accountType.toUpperCase()}\n`;
    report += `SALDO: $${balance.toFixed(2)} | PISO TRAVADO: $${lockedProfitFloor.toFixed(2)}\n`;
    report += `POSIÇÕES ATIVAS: ${openPositions.length}/${maxConcurrentTrades}\n`;
    report += `PERFORMANCE: ${stats.total} evals | HOLD ${stats.total > 0 ? Math.round(stats.hold/stats.total*100) : 0}% | Latência: ${(stats.avgLatencyMs/1000).toFixed(1)}s\n\n`;

    report += `>>> MONITORAMENTO DO CLUSTER:\n`;
    symbols.forEach(sym => {
        const sentData = sentinel[sym];
        const min = staleMinutes(sym);
        const isStale = min !== null && min > 2.5;

        if (isStale) {
            report += `- ${sym}: [OFFLINE - Último dado há ${Math.round(min)} min]\n`;
            return;
        }

        const price = sentData?.features?.price ?? 0;
        const hist = lastDecisions[sym];
        
        report += `- ${sym}: $${price.toFixed(4)}\n`;
        if (sentData?.features) {
            const f = sentData.features;
            report += `  Técnico: RSI ${f.rsi} | %B ${f.bbPos.toFixed(2)} | ER ${f.er.toFixed(2)}\n`;
            
            if (sentData.gravity) {
                const g = sentData.gravity;
                report += `  Gravidade: Corr ${g.correlation.toFixed(2)} | Beta ${g.beta.toFixed(2)} | Vector: ${g.btcVector}\n`;
                if (g.slingshotDetected) report += `  SINAL: SLINGSHOT (Arbitragem de Atraso) ATIVO!\n`;
            }

            const topCand = sentData.candidates.sort((a,b) => b.score - a.score)[0];
            if (topCand && topCand.score > 40) {
                report += `  Melhor Setup: ${topCand.contract} (${topCand.direction}) Score: ${topCand.score}\n`;
            }
        }
        
        if (hist) {
            const age = Math.round((Date.now() - hist.ts) / 1000);
            report += `  Veredito (${age}s atrás): ${hist.decision.finalAction} (${hist.decision.consensusConfidence}%) via ${hist.decision.executedVia}\n`;
        }
    });

    return report;
}

/**
 * Constrói relatório detalhado para um ativo específico.
 */
export function buildAssetReport(params: {
    sym: string;
    sentData?: { features: SignalFeatures | null, candidates: SignalCandidate[], gravity?: any };
    hist?: { ts: number, decision: CouncilDecision };
    lastCandleClose?: number;
    staleMin: number | null;
}): string {
    const { sym, sentData, hist, lastCandleClose, staleMin } = params;
    
    let report = `==================================================\n`;
    report += `ANÁLISE PROFUNDA: ${sym}\n`;
    report += `==================================================\n`;

    if (staleMin !== null && staleMin > 2.5) {
        report += `STATUS CRÍTICO: MERCADO FECHADO/DEFASADO (${Math.round(staleMin)} min)\n`;
        return report;
    }

    report += `PREÇO ATUAL: $${(lastCandleClose || 0).toFixed(4)}\n\n`;

    if (sentData?.features) {
        const f = sentData.features;
        report += `MÉTRICAS QUANTITATIVAS:\n`;
        report += `- RSI (14): ${f.rsi}\n`;
        report += `- Trend Efficiency (ER): ${f.er.toFixed(2)}\n`;
        report += `- Volatilidade Relativa: x${f.atrRatio.toFixed(2)}\n`;
        report += `- Momentum (Short/Mid): ${f.mom5.toFixed(2)} / ${f.mom15.toFixed(2)}\n`;
        
        if (sentData.gravity) {
            const g = sentData.gravity;
            report += `\nGRAVIDADE BITCOIN (LÍDER):\n`;
            report += `- Correlação Pearson: ${g.correlation.toFixed(2)}\n`;
            report += `- Beta Dinâmico: ${g.beta.toFixed(2)}\n`;
            report += `- Vetor BTC: ${g.btcVector}\n`;
            if (g.slingshotDetected) report += `- ALERTA: Ativo atrasado em relação ao impulso do BTC.\n`;
        }
        
        report += `\nESTADO SENTINELA:\n`;
        sentData.candidates.forEach(c => {
            if (c.score > 0) {
                report += `- [${c.contract}] Dir: ${c.direction} | Score: ${c.score} | ${c.reasons.join(', ')}\n`;
            }
        });
    }

    if (hist) {
        const d = hist.decision;
        const age = Math.round((Date.now() - hist.ts) / 1000);
        report += `\nÚLTIMA DECISÃO DO CONSELHO (há ${age}s):\n`;
        report += `- Veredito: ${d.finalAction} | Confiança: ${d.consensusConfidence}%\n`;
        report += `- Instrumento: ${d.recommendedContract} | Via: ${d.executedVia}\n`;
        if (d.holdReason) report += `- Motivo HOLD: ${d.holdReason}\n`;
        
        report += `\nAUDITORIA DOS AGENTES:\n`;
        d.opinions.forEach(o => {
            report += `  [${o.agentName}] ${o.action} (${o.confidence}%): ${o.reasoning}\n`;
        });
    }

    return report;
}

/**
 * Constrói relatório de backtest estatístico.
 */
export function buildBacktestReport(params: {
    ts: number | null;
    payoutPct: number;
    assetMeta: Record<string, { n: number, from: string, to: string, mid?: string }>;
    merged: Record<string, { recent: RuleReport[] | null, older: RuleReport[] | null }>;
    perAsset: Record<string, { recent: RuleReport[], older?: RuleReport[] }>;
}): string {
    const { ts, payoutPct, assetMeta, merged, perAsset } = params;
    if (!ts || Object.keys(merged).length === 0) return "Nenhum dado de backtest disponível.";
    
    const now = new Date(ts).toLocaleString('pt-BR');
    let report = `==================================================\n`;
    report += `CLARITAS QUANT LAB - AUDITORIA ESTATÍSTICA\n`;
    report += `GERADO EM: ${now} | PAYOUT: ${payoutPct}%\n`;
    report += `==================================================\n\n`;

    Object.entries(assetMeta).forEach(([sym, meta]) => {
        report += `- ${sym}: ${meta.n} candles [${meta.from} até ${meta.to}]\n`;
    });
    report += `\n`;

    Object.entries(merged).forEach(([group, periods]) => {
        report += `>>> MERCADO: ${group}\n`;
        
        ['recent', 'older'].forEach(pKey => {
            const reports = periods[pKey as 'recent' | 'older'];
            if (!reports) return;
            
            const pLabel = pKey === 'recent' ? "RECENTE (50% final)" : "ANTERIOR (Confirmação 50%)";
            report += `\n[${pLabel}]\n`;
            
            reports.forEach(r => {
                const { n, rate, lo, hi } = r.stat;
                report += `Regra: ${r.rule} (${r.contract})\n`;
                report += `  - Amostra: n=${n} | Acerto: ${(rate * 100).toFixed(1)}%\n`;
                report += `  - IC95: [${(lo * 100).toFixed(1)}% - ${(hi * 100).toFixed(1)}%]\n`;
                report += `  - Acaso: ${(r.baseline * 100).toFixed(1)}% | Eq: ${r.breakeven ? (r.breakeven * 100).toFixed(1) + '%' : 'N/A'}\n`;
                if (r.move) report += `  - Movimento Médio: ${r.move.mean.toFixed(3)} ATR (t=${r.move.t.toFixed(1)})\n`;
                report += `  - VEREDITO: ${r.verdict.toUpperCase()}\n\n`;
            });
        });
        report += `--------------------------------------------------\n`;
    });

    return report;
}

/**
 * Constrói contexto curto e denso para injeção no prompt do chat.
 */
export function buildShortContext(params: {
    sentinel: Record<string, { features: SignalFeatures | null, candidates: SignalCandidate[], gravity?: any }>;
    lastDecisions: Record<string, { ts: number, decision: CouncilDecision }>;
    staleMinutes: (sym: string) => number | null;
    financialState?: { pnl: number, floor: number, balance: number };
}): string {
    const { sentinel, lastDecisions, staleMinutes, financialState } = params;
    const symbols = Object.keys(sentinel);
    
    let context = "TELEMETRIA ATIVA (CLUSTER SUPREME):\n";
    
    if (financialState) {
        context += `BANCA: Bal $${financialState.balance.toFixed(2)} | P&L $${financialState.pnl.toFixed(2)} | Floor $${financialState.floor.toFixed(2)}\n`;
    }

    symbols.forEach(sym => {
        const min = staleMinutes(sym);
        if (min !== null && min > 2.5) {
            context += `${sym}: OFFLINE (${Math.round(min)} min)\n`;
            return;
        }

        const sentData = sentinel[sym];
        const price = sentData?.features?.price ?? 0;
        const hist = lastDecisions[sym];
        
        context += `${sym}: $${price.toFixed(4)}`;
        if (sentData?.features) {
            const f = sentData.features;
            context += ` | RSI:${f.rsi} | ER:${f.er.toFixed(2)}`;
            if (sentData.gravity) {
                context += ` | Corr_BTC:${sentData.gravity.correlation.toFixed(2)}`;
            }
        }
        if (hist) {
            context += ` | ÚLTIMO:${hist.decision.finalAction} ${hist.decision.consensusConfidence}%`;
        }
        context += `\n`;
    });
    
    return context.slice(0, 2500); 
}
