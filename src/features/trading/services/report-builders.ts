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
    sentinel: Record<string, { features: SignalFeatures | null, candidates: SignalCandidate[], ts: number }>;
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
    
    let report = `RELATÓRIO ${nowStr} | ${mode} | piloto ${pilot} | conta ${accountType} | saldo $${balance}\n`;
    report += `Conselho: ${stats.total} avaliações | HOLD ${stats.total > 0 ? Math.round(stats.hold/stats.total*100) : 0}% | CALL ${stats.call} | PUT ${stats.put} | vetos ${stats.vetoes} | fallbacks ${stats.fallbacks} | ${(stats.avgLatencyMs/1000).toFixed(1)}s/ativo\n`;
    report += `Posições abertas: ${openPositions.length}/${maxConcurrentTrades}\n`;
    report += `Episódios do Sentinela: O ${sentinelCounts.OPTIONS} | M ${sentinelCounts.MULTIPLIERS} | A ${sentinelCounts.ACCUMULATORS}\n\n`;

    if (openPositions.length > 0) {
        report += `POSIÇÕES ABERTAS (${openPositions.length}):\n`;
        openPositions.forEach(op => {
            const ageMs = Date.now() - new Date(op.timestamp).getTime();
            const min = Math.floor(ageMs / 60000);
            const ageStr = min > 1440 ? `${(min/1440).toFixed(1)}d` : `${min}min`;
            report += `- #${op.id} ${op.asset} ${op.contractType || 'OPTIONS'} $${op.stake} há ${ageStr} por ${op.initiator}\n`;
        });
        report += "\n";
    }

    symbols.forEach(sym => {
        const sentData = sentinel[sym];
        const min = staleMinutes(sym);
        const isStale = min !== null && min > 2.5;

        if (isStale) {
            report += `${sym} [MERCADO FECHADO (último candle há ${Math.round(min)} min)]\n\n`;
            return;
        }

        const price = sentData?.features?.price ?? 0;
        report += `${sym} $${price.toFixed(4)}\n`;
        if (sentData?.features) {
            const f = sentData.features;
            report += `  Metrics: RSI ${f.rsi} | %B ${f.bbPos.toFixed(2)} | ER ${f.er.toFixed(2)} | vol x${f.atrRatio.toFixed(2)} | mom15 ${f.mom15.toFixed(1)} ATR | seq ${f.streak}\n`;
            const getScore = (cat: string) => {
                const c = sentData.candidates.find(x => x.contract === cat);
                return c ? `${c.score}${c.direction === 'CALL' ? '↑CALL' : c.direction === 'PUT' ? '↓PUT' : ''}` : "--";
            };
            report += `  Sentinela: Opções ${getScore('OPTIONS')} | Multiplicadores ${getScore('MULTIPLIERS')} | Acumuladores ${getScore('ACCUMULATORS')}\n`;
        }
        
        const hist = lastDecisions[sym];
        if (hist) {
            const age = Math.round((Date.now() - hist.ts) / 1000);
            const d = hist.decision;
            const contractDisplay = d.finalAction === 'HOLD' ? '—' : d.recommendedContract;
            report += `  Conselho: há ${age}s ${d.finalAction} ${d.consensusConfidence}% ${contractDisplay} votos[${d.debugVotes}] ${d.holdReason ? d.holdReason.slice(0, 100) : ''}\n`;
        }
        report += "\n";
    });

    const candidates = Object.values(sentinel)
        .flatMap(s => s.candidates)
        .filter(c => c.score >= 55)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    report += `MELHORES CANDIDATOS (score >= 55):\n`;
    if (candidates.length > 0) {
        candidates.forEach(c => {
            const hist = lastDecisions[c.symbol];
            const lastAct = hist?.decision.finalAction || 'ainda não avaliou';
            report += `  ${c.symbol} ${c.contract} ${c.direction !== 'NONE' ? c.direction : 'sem direção'} score ${c.score} regra ${c.rule} (${c.reasons.join(', ')}) | Conselho: ${lastAct}\n`;
        });
    } else {
        report += `  nenhum candidato acima do gatilho\n`;
    }

    report += `\nSinais são hipóteses sobre índices sintéticos aleatórios; validar no Shadow.`;
    return report;
}

export function buildAssetReport(params: {
    sym: string;
    sentData?: { features: SignalFeatures | null, candidates: SignalCandidate[] };
    hist?: { ts: number, decision: CouncilDecision };
    lastCandleClose?: number;
    staleMin: number | null;
}): string {
    const { sym, sentData, hist, lastCandleClose, staleMin } = params;
    let report = `ANÁLISE DETALHADA: ${sym}\n`;
    if (staleMin !== null && staleMin > 2.5) {
        report += `STATUS: MERCADO FECHADO (último candle há ${Math.round(staleMin)} min)\n\n`;
    } else {
        report += `Preço: $${(lastCandleClose || 0).toFixed(4)}\n\n`;
    }

    if (sentData?.features && (staleMin === null || staleMin <= 2.5)) {
        const f = sentData.features;
        report += `MÉTRICAS AO VIVO:\n`;
        report += `- RSI: ${f.rsi}\n- %B (Posição Bandas): ${f.bbPos.toFixed(3)}\n- ER (Eficiência): ${f.er.toFixed(2)}\n- Volatilidade: x${f.atrRatio.toFixed(2)}\n- Momentum 15: ${f.mom15.toFixed(1)} ATR\n- Streak: ${f.streak}\n\n`;
        
        report += `SENTINELA (CANDIDATOS):\n`;
        sentData.candidates.forEach(c => {
            report += `- ${c.contract}: score ${c.score} [${c.rule}] -> ${c.reasons.join(', ')}\n`;
        });
        report += '\n';
    }

    if (hist) {
        const d = hist.decision;
        const age = Math.round((Date.now() - hist.ts) / 1000);
        const contractDisplay = d.finalAction === 'HOLD' ? '—' : d.recommendedContract;
        report += `ÚLTIMA DELIBERAÇÃO (há ${age}s):\n`;
        report += `Veredito: ${d.finalAction} ${d.consensusConfidence}% (${contractDisplay})\n`;
        if (d.holdReason) report += `Hold Reason: ${d.holdReason}\n`;
        
        report += `\nOPINIÕES DOS AGENTES:\n`;
        d.opinions.forEach(o => {
            report += `- ${o.agentName}: ${o.action} ${o.confidence}% ${o.action === 'HOLD' ? '—' : o.recommendedContract} — ${o.reasoning.slice(0, 160)}\n`;
        });

        if (d.trace && d.trace.length > 0) {
            report += `\nTRACE DO CHAIRMAN:\n`;
            d.trace.forEach(t => report += `  > ${t}\n`);
        }
    } else {
        report += `Conselho ainda não realizou varredura para este ativo.`;
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
    sentinel: Record<string, { features: SignalFeatures | null, candidates: SignalCandidate[] }>;
    lastDecisions: Record<string, { ts: number, decision: CouncilDecision }>;
    staleMinutes: (sym: string) => number | null;
}): string {
    const { sentinel, lastDecisions, staleMinutes } = params;
    const symbols = Object.keys(sentinel);
    let context = "LEGENDA: Sentinela = pontuação 0-100 por tipo de contrato (Opções, Multiplicadores, Acumuladores); >= 55 é gatilho; ↑ CALL, ↓ PUT; Acumuladores não têm direção. %B 0-1 (posição nas bandas); ER 0-1 (1 = tendência limpa); vol xN = volatilidade atual / mediana; mom15 em ATRs.\n\n";
    
    symbols.forEach(sym => {
        const min = staleMinutes(sym);
        const isStale = min !== null && min > 2.5;

        if (isStale) {
            context += `${sym}: MERCADO FECHADO (último candle há ${Math.round(min)} min)\n\n`;
            return;
        }

        const sentData = sentinel[sym];
        const price = sentData?.features?.price ?? 0;
        const hist = lastDecisions[sym];
        
        context += `${sym}: $${price.toFixed(4)}\n`;
        if (sentData?.features) {
            const f = sentData.features;
            context += `  Metrics: RSI ${f.rsi} | %B ${f.bbPos.toFixed(2)} | ER ${f.er.toFixed(2)} | vol x${f.atrRatio.toFixed(2)} | mom15 ${f.mom15.toFixed(1)} | streak ${f.streak}\n`;
            const getScore = (cat: string) => {
                const c = sentData.candidates.find(x => x.contract === cat);
                return c ? `${c.score}${c.direction === 'CALL' ? '↑C' : c.direction === 'PUT' ? '↓P' : ''}` : "--";
            };
            context += `  Sentinel: O:${getScore('OPTIONS')} M:${getScore('MULTIPLIERS')} A:${getScore('ACCUMULATORS')}\n`;
        }
        if (hist) {
            const age = Math.round((Date.now() - hist.ts) / 1000);
            const d = hist.decision;
            const contractDisplay = d.finalAction === 'HOLD' ? '—' : d.recommendedContract;
            context += `  Council (${age}s ago): ${d.finalAction} ${d.consensusConfidence}% [${d.debugVotes}] ${d.holdReason || ''} contract=${contractDisplay}\n`;
        }
        context += "\n";
    });
    
    return context.slice(0, 2200);
}