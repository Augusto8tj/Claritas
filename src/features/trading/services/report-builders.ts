// src/features/trading/services/report-builders.ts
import { SignalCandidate, SignalFeatures } from './signal-engine';
import { CouncilDecision, CouncilStats } from '../types/council';
import { RuleReport } from './backtest';
import { Operation } from '@/lib/types';
import { LeadLagReport } from './leadlag-backtest';

/**
 * @fileOverview REPORT BUILDERS V5.3 (SUPREME EDITION - HYPER-DENSE TELEMETRY)
 * Motor de síntese de dados para comunicação Homem-Máquina e Auditoria Institucional.
 * Otimizado para alimentar a IA Local (Ollama) com dados brutos inquestionáveis.
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
 * Constrói o relatório de status global do sistema com transparência total de banca.
 */
export function buildStatusReport(params: StatusReportParams): string {
    const { 
        isShadowMode, isAutoMode, accountType, balance, stats, 
        openPositions, maxConcurrentTrades, lockedProfitFloor = 0,
        sentinel, lastDecisions, staleMinutes 
    } = params;

    const nowStr = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const mode = isShadowMode ? 'SHADOW' : 'REAL';
    const pilot = isAutoMode ? 'ON' : 'OFF';
    
    let report = `[RELATÓRIO DE GOVERNANÇA V5.3] - EMISSÃO: ${nowStr}\n`;
    report += `==================================================\n`;
    report += `ESTADO DO TERMINAL:\n`;
    report += `- Operação: ${mode} | Piloto: ${pilot}\n`;
    report += `- Ambiente: ${accountType.toUpperCase()} | P&L Sessão: $${stats.hold > 0 ? 'CALCULANDO' : '0.00'}\n`;
    report += `- Capital: Saldo Real $${balance.toFixed(2)} | Lucro Travado (Floor) $${lockedProfitFloor.toFixed(2)}\n`;
    report += `- Exposição: ${openPositions.length} ativos de ${maxConcurrentTrades} permitidos\n\n`;

    report += `### MONITORAMENTO EM TEMPO REAL (TELEMETRIA ATIVA):\n`;
    
    Object.keys(sentinel).forEach(sym => {
        const min = staleMinutes(sym);
        const isStale = min !== null && min > 2.5;

        if (isStale) {
            report += `> ${sym}: [STATUS: OFFLINE] - Sem dados há ${Math.round(min)} minutos.\n`;
            return;
        }

        const sentData = sentinel[sym];
        const f = sentData?.features;
        const g = sentData?.gravity;
        const hist = lastDecisions[sym];

        report += `> ATIVO: ${sym}\n`;
        report += `  - Preço Spot: $${(f?.price ?? 0).toFixed(4)}\n`;
        if (f) {
            report += `  - Técnica: RSI:${f.rsi} | Eficiência(ER):${f.er.toFixed(2)} | Vol: ATR% ${f.atrPct.toFixed(3)}% (Ratio x${f.atrRatio.toFixed(2)})\n`;
            report += `  - Momentum: Mom5:${f.mom5.toFixed(2)} | Mom15:${f.mom15.toFixed(2)} | Streak:${f.streak}\n`;
        }
        if (g) {
            report += `  - Gravidade BTC: Beta:${g.beta.toFixed(3)} | Corr:${g.correlation.toFixed(3)} | Vetor:${g.btcVector}\n`;
            if (g.slingshotDetected) report += `  - ALERTA: SINAL DE SLINGSHOT (LAG DE PROPAGAÇÃO) ATIVO!\n`;
        }
        if (hist) {
            report += `  - Veredito Recente: ${hist.decision.finalAction} (${hist.decision.consensusConfidence}%) via ${hist.decision.executedVia}\n`;
        }
        report += `\n`;
    });

    return report;
}

/**
 * Constrói relatório detalhado para um ativo específico com assinatura gravitacional.
 */
export function buildAssetReport(params: {
    sym: string;
    sentData?: { features: SignalFeatures | null, candidates: SignalCandidate[], gravity?: any };
    hist?: { ts: number, decision: CouncilDecision };
    lastCandleClose?: number;
    staleMin: number | null;
}): string {
    const { sym, sentData, hist, lastCandleClose, staleMin } = params;
    
    let report = `[DOSSIER TÁTICO INSTITUCIONAL: ${sym}]\n`;
    report += `==================================================\n`;

    if (staleMin !== null && staleMin > 2.5) {
        report += `⚠️ ALERTA: Mercado fechado ou dados defasados (${Math.round(staleMin)} min).\n`;
        return report;
    }

    report += `TELEMETRIA DE PREÇO: $${(lastCandleClose || 0).toFixed(4)}\n\n`;

    if (sentData?.features) {
        const f = sentData.features;
        report += `MÉTRICAS DE ALTA FREQUÊNCIA:\n`;
        report += `- RSI(14): ${f.rsi}\n`;
        report += `- Índice de Eficiência (ER): ${f.er.toFixed(3)} (0=ruído, 1=tendência)\n`;
        report += `- Volatilidade Dinâmica: x${f.atrRatio.toFixed(2)} vs Mediana\n`;
        report += `- Momentum (5/15): ${f.mom5.toFixed(2)} / ${f.mom15.toFixed(2)}\n`;
        report += `- Alinhamento de Velas (Streak): ${f.streak}\n`;
        
        if (sentData.gravity) {
            const g = sentData.gravity;
            report += `\nASSINATURA GRAVITACIONAL (LÍDER: BTC):\n`;
            report += `- Coeficiente Beta: ${g.beta.toFixed(3)}\n`;
            report += `- Correlação de Pearson: ${g.correlation.toFixed(3)}\n`;
            report += `- Vetor BTC: ${g.btcVector}\n`;
            if (g.slingshotDetected) report += `- ESTRATÉGIA: Lead-Lag Arbitrage (SlingShot) Detectado.\n`;
        }
    }

    if (hist) {
        const d = hist.decision;
        const age = Math.round((Date.now() - hist.ts) / 1000);
        report += `\nÚLTIMA DELIBERAÇÃO DO CONSELHO (T-${age}s):\n`;
        report += `- Veredito: ${d.finalAction} | Confiança: ${d.consensusConfidence}%\n`;
        report += `- Contrato Recomendado: ${d.recommendedContract}\n`;
        report += `- Justificativa: ${d.zenThought || d.opinions[0]?.reasoning}\n`;
        
        report += `\nDECOMPOSIÇÃO DE OPINIÕES:\n`;
        d.opinions.forEach(o => {
            report += `  - [${o.agentName}]: ${o.action} (${o.confidence}%) -> ${o.reasoning}\n`;
        });
    }

    return report;
}

/**
 * Constrói relatório de backtest estatístico com intervalo de confiança Wilson.
 */
export function buildBacktestReport(params: {
    ts: number | null;
    payoutPct: number;
    assetMeta: Record<string, { n: number, from: string, to: string, mid?: string }>;
    merged: Record<string, { recent: RuleReport[] | null, older: RuleReport[] | null }>;
    perAsset: Record<string, { recent: RuleReport[], older?: RuleReport[] }>;
}): string {
    const { ts, payoutPct, assetMeta, merged } = params;
    if (!ts || Object.keys(merged).length === 0) return "Aguardando conclusão do Backtest Paginado...";
    
    const now = new Date(ts).toLocaleString('pt-BR');
    let report = `[AUDITORIA ESTATÍSTICA DE BACKTEST V5]\n`;
    report += `==================================================\n`;
    report += `DATA: ${now} | PAYOUT BASE: ${payoutPct}%\n\n`;

    Object.entries(assetMeta).forEach(([sym, meta]) => {
        report += `- ATIVO ${sym}: n=${meta.n} candles [${meta.from} -> ${meta.to}]\n`;
    });
    report += `\n`;

    Object.entries(merged).forEach(([group, periods]) => {
        report += `>>> SEGMENTO: ${group}\n`;
        
        ['recent', 'older'].forEach(pKey => {
            const reports = periods[pKey as 'recent' | 'older'];
            if (!reports) return;
            
            const pLabel = pKey === 'recent' ? "PERÍODO RECENTE" : "PERÍODO ANTERIOR";
            report += `\n[${pLabel}]\n`;
            
            reports.forEach(r => {
                const { n, rate, lo, hi } = r.stat;
                report += `- Regra: ${r.rule} (${r.contract})\n`;
                report += `  Acerto: ${(rate * 100).toFixed(1)}% | Wilson IC95: [${(lo * 100).toFixed(1)}% - ${(hi * 100).toFixed(1)}%]\n`;
                report += `  Baseline: Acaso ${(r.baseline * 100).toFixed(1)}% | Eq: ${r.breakeven ? (r.breakeven * 100).toFixed(1) + '%' : 'N/A'}\n`;
                if (r.move) report += `  Expectativa ATR: ${r.move.mean.toFixed(4)} (t-stat: ${r.move.t.toFixed(2)})\n`;
                report += `  VEREDITO: ${r.verdict.toUpperCase()}\n`;
            });
        });
        report += `--------------------------------------------------\n`;
    });

    return report;
}

/**
 * Constrói relatório de backtest Lead-Lag (V5.8)
 */
export function buildLeadLagReport(report: LeadLagReport): string {
    const now = new Date().toLocaleString('pt-BR');
    let out = `[RELATÓRIO LEAD-LAG WALK-FORWARD V5.8]\n`;
    out += `==================================================\n`;
    out += `DATA: ${now} | N EVENTOS (TESTE): ${report.n}\n`;
    out += `FREQUÊNCIA: ${report.eventsPerDay.toFixed(2)} eventos/dia\n\n`;

    report.horizons.forEach(h => {
        out += `>>> HORIZONTE: ${h.h} min | VARIANTE: ${h.variant}\n`;
        out += `- Taxa Acerto: ${(h.rate * 100).toFixed(1)}% | IC95: [${(h.wilson[0] * 100).toFixed(0)}% - ${(h.wilson[1] * 100).toFixed(0)}%]\n`;
        out += `- P-Valor: ${h.pValPermutation.toFixed(4)} (Adjusted: ${h.pValAdjusted.toFixed(4)})\n`;
        out += `- Veredito: ${h.veredito}\n`;
        if (h.variant === 'B' && h.veredito === 'SEM EDGE') {
            out += `⚠️ ALERTA: O edge não sobrevive à latência (Variante B).\n`;
        }
        out += `--------------------------------------------------\n`;
    });

    return out;
}

/**
 * Constrói dossiê tático denso para injeção em cada mensagem do Chat.
 * FORMATO V5.3: DADOS REAIS DO TERMINAL (PROIBIDO ALUCINAR).
 */
export function buildShortContext(params: {
    sentinel: Record<string, { features: SignalFeatures | null, candidates: SignalCandidate[], gravity?: any }>;
    lastDecisions: Record<string, { ts: number, decision: CouncilDecision }>;
    staleMinutes: (sym: string) => number | null;
    financialState?: { pnl: number, floor: number, balance: number };
}): string {
    const { sentinel, lastDecisions, staleMinutes, financialState } = params;
    const symbols = Object.keys(sentinel);
    
    let context = "### [DOSSIER DE TELEMETRIA REAL-TIME - V5.3]\n";
    context += "INSTRUÇÃO RÍGIDA: Use apenas os números abaixo. Proibido inventar dados.\n\n";
    
    if (financialState) {
        context += `ESTADO DA BANCA: Saldo=$${financialState.balance.toFixed(2)} | P&L Sessão=$${financialState.pnl.toFixed(2)} | Piso Travado=$${financialState.floor.toFixed(2)}\n\n`;
    }

    symbols.forEach(sym => {
        const min = staleMinutes(sym);
        if (min !== null && min > 2.5) {
            context += `[OFFLINE] ${sym}: Último sinal há ${Math.round(min)} min.\n`;
            return;
        }

        const sentData = sentinel[sym];
        const f = sentData?.features;
        const g = sentData?.gravity;
        const hist = lastDecisions[sym];
        
        if (f) {
            context += `[REAL DATA] ${sym}: Price $${f.price.toFixed(4)} | RSI:${f.rsi} | ER:${f.er.toFixed(3)} | ATR_Ratio:x${f.atrRatio.toFixed(2)}`;
            if (g) {
                context += ` | Beta:${g.beta.toFixed(3)} | Corr_BTC:${g.correlation.toFixed(3)} | Vector:${g.btcVector}`;
                if (g.slingshotDetected) context += " | SLINGSHOT_ACTIVE";
            }
            if (hist) {
                context += ` | ÚLTIMA_DECISÃO:${hist.decision.finalAction} (${hist.decision.consensusConfidence}%)`;
            }
            context += `\n`;
        }
    });
    
    context += "\n---------------------------------------------------------\n";
    return context.slice(0, 4000); 
}
