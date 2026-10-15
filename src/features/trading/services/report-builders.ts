import { SignalCandidate, SignalFeatures } from './signal-engine';
import { CouncilDecision, CouncilStats } from '../types/council';
import { RuleReport } from './backtest';
import { Operation } from '@/lib/types';

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
    sentinel: Record<string, { features: SignalFeatures | null, candidates: SignalCandidate[], ts: number, gravity?: any }>;
    sentinelCounts: Record<string, number>;
    lastDecisions: Record<string, { ts: number, decision: CouncilDecision }>;
    staleMinutes: (sym: string) => number | null;
}

export function buildStatusReport(params: StatusReportParams): string {
    const { isShadowMode, isAutoMode, accountType, balance, stats, openPositions, maxConcurrentTrades, sentinel, sentinelCounts, lastDecisions, staleMinutes } = params;
    const nowStr = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const mode = isShadowMode ? 'SHADOW' : 'REAL';
    const pilot = isAutoMode ? 'ON' : 'OFF';
    const symbols = Object.keys(sentinel);
    
    let report = `RELATÓRIO TÁTICO SUPREME ${nowStr} | ${mode} | piloto ${pilot} | conta ${accountType} | saldo $${balance.toFixed(2)}\n`;
    report += `Performance: ${stats.total} evals | HOLD ${stats.total > 0 ? Math.round(stats.hold/stats.total*100) : 0}% | CALL ${stats.call} | PUT ${stats.put} | Latência Médio: ${(stats.avgLatencyMs/1000).toFixed(1)}s\n`;
    report += `Posições abertas: ${openPositions.length}/${maxConcurrentTrades}\n\n`;

    symbols.forEach(sym => {
        const sentData = sentinel[sym];
        const min = staleMinutes(sym);
        const isStale = min !== null && min > 2.5;

        if (isStale) {
            report += `${sym} [OFFLINE - ${Math.round(min)} min atrás]\n\n`;
            return;
        }

        const price = sentData?.features?.price ?? 0;
        report += `${sym} $${price.toFixed(4)}\n`;
        if (sentData?.features) {
            const f = sentData.features;
            report += `  Métricas: RSI ${f.rsi} | %B ${f.bbPos.toFixed(2)} | ER ${f.er.toFixed(2)} | vol x${f.atrRatio.toFixed(2)}\n`;
            
            // Injeção de Gravidade (Específico V4.2)
            if (sentData.gravity) {
                const g = sentData.gravity;
                report += `  Gravidade BTC: Correlação ${g.correlation.toFixed(2)} | Beta ${g.beta.toFixed(2)} | Vector: ${g.btcVector}\n`;
                if (g.slingshotDetected) report += `  ALERTA: SlingShot (Lag de Propagação) Detectado!\n`;
            }

            const getScore = (cat: string) => {
                const c = sentData.candidates.find(x => x.contract === cat);
                return c ? `${c.score}${c.direction === 'CALL' ? '↑' : c.direction === 'PUT' ? '↓' : ''}` : "--";
            };
            report += `  Sentinela: O:${getScore('OPTIONS')} M:${getScore('MULTIPLIERS')} A:${getScore('ACCUMULATORS')}\n`;
        }
        
        const hist = lastDecisions[sym];
        if (hist) {
            const age = Math.round((Date.now() - hist.ts) / 1000);
            const d = hist.decision;
            report += `  Última Decisão (${age}s atrás): ${d.finalAction} ${d.consensusConfidence}% via ${d.executedVia}\n`;
        }
        report += "\n";
    });

    return report;
}

export function buildAssetReport(params: {
    sym: string;
    sentData?: { features: SignalFeatures | null, candidates: SignalCandidate[], gravity?: any };
    hist?: { ts: number, decision: CouncilDecision };
    lastCandleClose?: number;
    staleMin: number | null;
}): string {
    const { sym, sentData, hist, lastCandleClose, staleMin } = params;
    let report = `ANÁLISE DE ATIVO (SUPREME): ${sym}\n`;
    if (staleMin !== null && staleMin > 2.5) {
        report += `STATUS: MERCADO FECHADO (${Math.round(staleMin)} min atrás)\n\n`;
    } else {
        report += `Preço Spot: $${(lastCandleClose || 0).toFixed(4)}\n\n`;
    }

    if (sentData?.features && (staleMin === null || staleMin <= 2.5)) {
        const f = sentData.features;
        report += `MÉTRICAS QUANTITATIVAS:\n`;
        report += `- RSI: ${f.rsi}\n- ER (Trend Efficiency): ${f.er.toFixed(2)}\n- Volatilidade: x${f.atrRatio.toFixed(2)}\n`;
        
        if (sentData.gravity) {
            const g = sentData.gravity;
            report += `- Correlação BTC (Pearson): ${g.correlation.toFixed(2)}\n`;
            report += `- Elasticidade (Beta): ${g.beta.toFixed(2)}\n`;
            report += `- Vetor Gravitacional: ${g.btcVector}\n`;
        }
        
        report += `\nCANDIDATOS SENTINELA:\n`;
        sentData.candidates.forEach(c => {
            report += `- ${c.contract}: score ${c.score} [${c.rule}] -> ${c.reasons.join(', ')}\n`;
        });
        report += '\n';
    }

    if (hist) {
        const d = hist.decision;
        const age = Math.round((Date.now() - hist.ts) / 1000);
        report += `DECISÃO DO CONSELHO (há ${age}s):\n`;
        report += `Veredito: ${d.finalAction} ${d.consensusConfidence}% (${d.recommendedContract})\n`;
        if (d.holdReason) report += `Justificativa Hold: ${d.holdReason}\n`;
        
        report += `\nOPINIÕES ESPECÍFICAS:\n`;
        d.opinions.forEach(o => {
            report += `- ${o.agentName}: ${o.action} ${o.confidence}% | ${o.reasoning.slice(0, 100)}...\n`;
        });
    }

    return report;
}

export function buildBacktestReport(params: {
    ts: number | null;
    payoutPct: number;
    assetMeta: Record<string, { n: number, from: string, to: string, mid?: string }>;
    merged: Record<string, { recent: RuleReport[] | null, older: RuleReport[] | null }>;
    perAsset: Record<string, { recent: RuleReport[], older?: RuleReport[] }>;
}): string {
    const { ts, payoutPct, assetMeta, merged, perAsset } = params;
    if (!ts || Object.keys(merged).length === 0) return "Nenhum backtest realizado nesta sessão.";
    
    const now = new Date(ts).toLocaleString('pt-BR');
    let report = `==================================================\n`;
    report += `QUANT LAB V3 - RELATÓRIO DE BACKTEST\n`;
    report += `GERADO EM: ${now}\n`;
    report += `CONFIG: ${payoutPct}% Payout\n`;
    report += `==================================================\n\n`;

    Object.entries(assetMeta).forEach(([sym, meta]) => {
        const candles = meta.n;
        const days = meta.from && meta.to ? ((new Date(meta.to).getTime() - new Date(meta.from).getTime()) / 86400000).toFixed(1) : "0";
        report += `${sym}: ${candles} candles, ${days} dias, de ${meta.from || '?'} a ${meta.to || '?'}\n`;
    });
    report += `\n`;

    Object.entries(merged).forEach(([group, periods]) => {
        report += `>>> MERCADO: ${group}\n`;
        report += `--------------------------------------------------\n`;
        
        ['recent', 'older'].forEach(pKey => {
            const reports = periods[pKey as 'recent' | 'older'];
            if (!reports) return;
            
            const hasDivision = Object.values(assetMeta).some(m => m.mid);
            const pLabel = !hasDivision ? "PERÍODO ÚNICO" : (pKey === 'recent' ? "RECENTE (50%)" : "ANTERIOR (CONFIRMAÇÃO, 50%)");
            report += `[${pLabel}]\n\n`;
            
            reports.forEach(r => {
                const { n, rate, lo, hi } = r.stat;
                const bLine = (r.baseline * 100).toFixed(1);
                const bEven = r.breakeven !== null ? (r.breakeven * 100).toFixed(1) : null;
                const moveStr = r.move ? ` | mov=${r.move.mean.toFixed(3)} ATR t=${r.move.t.toFixed(1)}` : '';
                
                report += `REGRA: ${r.rule} (${r.contract})\n`;
                report += `- Amostra: n=${n} | Acerto: ${(rate * 100).toFixed(1)}% [IC95: ${(lo * 100).toFixed(0)}%-${(hi * 100).toFixed(0)}%]\n`;
                report += `- Acaso: ${bLine}% | Equilíbrio: ${bEven ? bEven + '%' : '—'}${moveStr}\n`;
                report += `- LEITURA: ${r.verdict.toUpperCase()}\n`;
                
                report += `- Breakdown por Score:\n`;
                r.buckets.forEach(b => {
                    report += `  * ${b.label}: ${(b.stat.rate * 100).toFixed(1)}% (n=${b.stat.n})\n`;
                });
                
                report += `- Acerto por Ativo:\n`;
                const groupAssets = Object.keys(perAsset).filter(sym => groupOf(sym) === group);
                groupAssets.forEach(sym => {
                    const assetRep = (pKey === 'recent' ? perAsset[sym].recent : perAsset[sym].older)?.find(x => x.rule === r.rule);
                    const val = assetRep ? `${((assetRep.stat.rate ?? 0) * 100).toFixed(1)}% (n=${assetRep.stat.n})` : "sem período anterior";
                    report += `  * ${sym}: ${val}\n`;
                });
                report += `\n`;
            });
            report += `--------------------------------------------------\n`;
        });
        report += `\n`;
    });

    report += `OBSERVAÇÕES TÉCNICAS:\n`;
    report += `- 'n' conta episódios independentes (anti-sobreposição de 5 candles).\n`;
    report += `- OPTIONS: direção do candle de 60s seguinte.\n`;
    report += `- MULTIPLIERS: direção após 5 candles (sem TP/SL);\n`;
    report += `- ACCUMULATORS: proxy de calma (não é o contrato real).\n`;
    report += `- Payout assumido: ${payoutPct}%.\n`;
    report += `- Várias regras/faixas aumentam a chance de falso positivo.\n`;
    report += `==================================================`;
    
    return report;
}

export function buildShortContext(params: {
    sentinel: Record<string, { features: SignalFeatures | null, candidates: SignalCandidate[], gravity?: any }>;
    lastDecisions: Record<string, { ts: number, decision: CouncilDecision }>;
    staleMinutes: (sym: string) => number | null;
}): string {
    const { sentinel, lastDecisions, staleMinutes } = params;
    const symbols = Object.keys(sentinel);
    let context = "DADOS OPERACIONAIS (CLUSTER CRIPTO V4.2 SUPREME):\n";
    
    symbols.forEach(sym => {
        const min = staleMinutes(sym);
        const isStale = min !== null && min > 2.5;

        if (isStale) {
            context += `${sym}: OFFLINE (${Math.round(min)} min)\n`;
            return;
        }

        const sentData = sentinel[sym];
        const price = sentData?.features?.price ?? 0;
        const hist = lastDecisions[sym];
        
        context += `${sym}: $${price.toFixed(4)}\n`;
        if (sentData?.features) {
            const f = sentData.features;
            context += `  - RSI:${f.rsi} | %B:${f.bbPos.toFixed(2)} | Vol:x${f.atrRatio.toFixed(2)}`;
            if (sentData.gravity) {
                const g = sentData.gravity;
                context += ` | Corr_BTC:${g.correlation.toFixed(2)} | Beta:${g.beta.toFixed(2)} | ${g.btcVector}`;
            }
            context += `\n`;
        }
        if (hist) {
            const d = hist.decision;
            context += `  - ÚLTIMO CONSELHO: ${d.finalAction} ${d.consensusConfidence}% (${d.recommendedContract})\n`;
        }
    });
    
    return context.slice(0, 2500);
}