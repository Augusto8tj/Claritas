import { SignalCandidate, SignalFeatures } from './signal-engine';
import { CouncilDecision, CouncilStats } from '../types/council';
import { RuleReport } from './backtest';
import { Operation } from '@/lib/types';

/**
 * @fileOverview REPORT BUILDERS V5.2 (SUPREME EDITION - DENSE TELEMETRY)
 * Motor de síntese de dados para comunicação Homem-Máquina e Auditoria Institucional.
 * Otimizado para alimentar a IA Local (Ollama) com dados inquestionáveis do terminal.
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
        sentinel, sentinelCounts, lastDecisions, staleMinutes 
    } = params;

    const nowStr = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const mode = isShadowMode ? 'SHADOW' : 'REAL';
    const pilot = isAutoMode ? 'ON' : 'OFF';
    const symbols = Object.keys(sentinel);
    
    let report = `[STATUS GLOBAL DO SISTEMA V5.2] ${nowStr}\n`;
    report += `--------------------------------------------------\n`;
    report += `GOVERNANÇA: Modo=${mode} | Piloto=${pilot} | Conta=${accountType.toUpperCase()}\n`;
    report += `FINANCEIRO: Saldo=$${balance.toFixed(2)} | Piso Travado (Floor)=$${lockedProfitFloor.toFixed(2)}\n`;
    report += `EXPOSIÇÃO: Ativos=${openPositions.length}/${maxConcurrentTrades} | P&L Sessão: $${stats.hold > 0 ? 'CALCULANDO' : '0.00'}\n`;
    report += `TELEMETRIA: Latência Média: ${stats.avgLatencyMs.toFixed(0)}ms | Entropia Ativa: ${stats.total > 0 ? 'MONITORADA' : 'N/A'}\n\n`;

    report += `>>> DOSSIER DE ATIVOS (DADOS REAIS):\n`;
    symbols.forEach(sym => {
        const sentData = sentinel[sym];
        const min = staleMinutes(sym);
        const isStale = min !== null && min > 2.5;

        if (isStale) {
            report += `- ${sym}: OFFLINE (Há ${Math.round(min)}m)\n`;
            return;
        }

        const price = sentData?.features?.price ?? 0;
        const hist = lastDecisions[sym];
        const f = sentData?.features;
        const g = sentData?.gravity;
        
        report += `- ${sym}: $${price.toFixed(4)}\n`;
        if (f) {
            report += `  TÉCNICO: RSI:${f.rsi} | %B:${f.bbPos.toFixed(2)} | ER:${f.er.toFixed(2)} | Mom5:${f.mom5.toFixed(2)}\n`;
        }
        if (g) {
            report += `  GRAVIDADE (BTC): Beta:${g.beta.toFixed(2)} | Corr:${g.correlation.toFixed(2)} | Vector:${g.btcVector}\n`;
            if (g.slingshotDetected) report += `  SINAL: SLINGSHOT (LAG DE PROPAGAÇÃO) DETECTADO!\n`;
        }
        
        if (hist) {
            const age = Math.round((Date.now() - hist.ts) / 1000);
            report += `  ÚLTIMO VEREDITO (${age}s atrás): ${hist.decision.finalAction} (${hist.decision.consensusConfidence}%)\n`;
        }
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
    
    let report = `==================================================\n`;
    report += `AUDITORIA PROFUNDA: ${sym}\n`;
    report += `==================================================\n`;

    if (staleMin !== null && staleMin > 2.5) {
        report += `MERCADO FECHADO: Dados com defasagem de ${Math.round(staleMin)} minutos.\n`;
        return report;
    }

    report += `PREÇO SPOT: $${(lastCandleClose || 0).toFixed(4)}\n\n`;

    if (sentData?.features) {
        const f = sentData.features;
        report += `MÉTRICAS DE ALTA FREQUÊNCIA:\n`;
        report += `- RSI (14): ${f.rsi}\n`;
        report += `- Eficiência de Kaufman (ER): ${f.er.toFixed(2)}\n`;
        report += `- Volatilidade Yang-Zhang (Ratio): x${f.atrRatio.toFixed(2)}\n`;
        report += `- Momentum (Curto/Médio): ${f.mom5.toFixed(2)} / ${f.mom15.toFixed(2)}\n`;
        report += `- Streak: ${f.streak} candles alinhados\n`;
        
        if (sentData.gravity) {
            const g = sentData.gravity;
            report += `\nASSINATURA GRAVITACIONAL (REFERÊNCIA BTC):\n`;
            report += `- Coeficiente Beta: ${g.beta.toFixed(2)}\n`;
            report += `- Correlação Pearson: ${g.correlation.toFixed(2)}\n`;
            report += `- Vetor de Momentum BTC: ${g.btcVector}\n`;
            if (g.slingshotDetected) report += `- ALERTA: Ativo em atraso de resposta (SlingShot Ativo).\n`;
        }
    }

    if (hist) {
        const d = hist.decision;
        const age = Math.round((Date.now() - hist.ts) / 1000);
        report += `\nAUDITORIA DA ÚLTIMA DECISÃO (T-${age}s):\n`;
        report += `- Ação: ${d.finalAction} | Confiança: ${d.consensusConfidence}%\n`;
        report += `- Motor: ${d.recommendedContract} | Via: ${d.executedVia}\n`;
        if (d.holdReason) report += `- Hold Reason: ${d.holdReason}\n`;
        
        report += `\nOPINIÕES DOS AGENTES:\n`;
        d.opinions.forEach(o => {
            report += `  [${o.agentName}] ${o.action} (${o.confidence}%): ${o.reasoning}\n`;
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
    let report = `==================================================\n`;
    report += `CLARITAS QUANT LAB - RELATÓRIO DE BACKTEST V5\n`;
    report += `AUDITORIA EM: ${now} | PAYOUT BASE: ${payoutPct}%\n`;
    report += `==================================================\n\n`;

    Object.entries(assetMeta).forEach(([sym, meta]) => {
        report += `- ATIVO ${sym}: ${meta.n} candles [Analise de ${meta.from} até ${meta.to}]\n`;
    });
    report += `\n`;

    Object.entries(merged).forEach(([group, periods]) => {
        report += `>>> SEGMENTO: ${group}\n`;
        
        ['recent', 'older'].forEach(pKey => {
            const reports = periods[pKey as 'recent' | 'older'];
            if (!reports) return;
            
            const pLabel = pKey === 'recent' ? "PERÍODO RECENTE (Out-of-Sample)" : "PERÍODO ANTERIOR (In-Sample)";
            report += `\n[${pLabel}]\n`;
            
            reports.forEach(r => {
                const { n, rate, lo, hi } = r.stat;
                report += `Regra: ${r.rule} (${r.contract})\n`;
                report += `  - Amostra: n=${n} | Taxa de Acerto: ${(rate * 100).toFixed(1)}%\n`;
                report += `  - Wilson IC95: [${(lo * 100).toFixed(1)}% - ${(hi * 100).toFixed(1)}%]\n`;
                report += `  - Baselines: Acaso ${(r.baseline * 100).toFixed(1)}% | Eq: ${r.breakeven ? (r.breakeven * 100).toFixed(1) + '%' : 'N/A'}\n`;
                if (r.move) report += `  - Expectativa ATR: ${r.move.mean.toFixed(3)} (t-stat: ${r.move.t.toFixed(1)})\n`;
                report += `  - VEREDITO: ${r.verdict.toUpperCase()}\n\n`;
            });
        });
        report += `--------------------------------------------------\n`;
    });

    return report;
}

/**
 * Constrói dossiê tático denso para injeção em cada mensagem do Chat.
 * Este é o "segredo" para evitar as alucinações da IA local.
 */
export function buildShortContext(params: {
    sentinel: Record<string, { features: SignalFeatures | null, candidates: SignalCandidate[], gravity?: any }>;
    lastDecisions: Record<string, { ts: number, decision: CouncilDecision }>;
    staleMinutes: (sym: string) => number | null;
    financialState?: { pnl: number, floor: number, balance: number };
}): string {
    const { sentinel, lastDecisions, staleMinutes, financialState } = params;
    const symbols = Object.keys(sentinel);
    
    let context = "--- DOSSIER DE TELEMETRIA REAL-TIME (PROIBIDO ALUCINAR) ---\n";
    
    if (financialState) {
        context += `BANCA ATUAL: Saldo=$${financialState.balance.toFixed(2)} | P&L Sessão=$${financialState.pnl.toFixed(2)} | Piso Travado (Floor)=$${financialState.floor.toFixed(2)}\n`;
    }

    symbols.forEach(sym => {
        const min = staleMinutes(sym);
        if (min !== null && min > 2.5) {
            context += `${sym}: [OFFLINE - ${Math.round(min)} min atrás]\n`;
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
                const g = sentData.gravity;
                context += ` | Beta:${g.beta.toFixed(2)} | Corr_BTC:${g.correlation.toFixed(2)} | Vector:${g.btcVector}`;
            }
        }
        if (hist) {
            context += ` | ÚLTIMA_DECISÃO:${hist.decision.finalAction} (${hist.decision.consensusConfidence}%)`;
        }
        context += `\n`;
    });
    
    context += "---------------------------------------------------------\n";
    return context.slice(0, 3000); 
}
