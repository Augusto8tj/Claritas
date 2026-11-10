// src/features/trading/services/multiplier-economics.ts
/**
 * @fileOverview ETAPA 21 — ECONOMIA DE CONTRATOS MULTIPLIER (a Deriv só oferece MULTUP/MULTDOWN para cripto nesta conta).
 *
 * No Multiplier não existe breakeven de taxa de acerto: o lucro é stake * multiplicador * retorno do ativo - comissão, e a perda
 * é limitada ao stake (stop-out quando o movimento contra atinge 1/multiplicador). O que importa é o RETORNO MÉDIO LÍQUIDO por
 * operação, não quantas vezes acerta.
 *
 * Critérios (definidos antes de rodar), para cada multiplicador testado:
 *   CONFIRMADO     : custo MEDIDO, N >= 100, limite inferior do IC (bootstrap por dia, alfa 5% bilateral dividido por nº de
 *                    multiplicadores) do retorno líquido médio > 0, as duas metades > 0 e placebo do retorno bruto p < 0.05.
 *   NÃO CONFIRMADO : retorno líquido médio <= 0 ou limite superior do IC < 0.
 *   INCONCLUSIVO   : demais casos (inclui custo não medido).
 * Retorno efetivo por evento = max(retorno, -1e4/m) (stop-out perde o stake) em bps do ativo; líquido = efetivo - custo(bps).
 * LIMITAÇÕES: usa máximas/mínimas de velas de 1 min da fonte importada (Binance), não os ticks da Deriv; custo = comissão
 * de abertura medida por `proposal` (spread, cancelamento e custos de saída NÃO incluídos); sem slippage.
 */
import type { OosReport } from './oos-confirmation';
import { mulberry32 } from './leadlag-backtest';

export interface DayItem { day: number; x: number; }

/** Bootstrap por dia (reamostra dias inteiros) do retorno médio. Retorna [limite inferior, limite superior] com cobertura 1-alpha. */
export function bootstrapMeanByDay(items: DayItem[], reps = 1000, seed = 21, alpha = 0.05): [number, number] | null {
    const byDay = new Map<number, { s: number; n: number }>();
    for (const it of items) { const g = byDay.get(it.day) ?? { s: 0, n: 0 }; g.s += it.x; g.n++; byDay.set(it.day, g); }
    const days = Array.from(byDay.values());
    if (days.length < 5) return null;
    const rng = mulberry32(seed);
    const means: number[] = [];
    for (let r = 0; r < reps; r++) {
        let s = 0, n = 0;
        for (let k = 0; k < days.length; k++) { const d = days[Math.floor(rng() * days.length)]; s += d.s; n += d.n; }
        if (n > 0) means.push(s / n);
    }
    means.sort((a, b) => a - b);
    const lo = means[Math.floor((alpha / 2) * means.length)], hi = means[Math.min(means.length - 1, Math.floor((1 - alpha / 2) * means.length))];
    return [lo, hi];
}

export interface MultOption { multiplier: number; costBps: number | null; }
export type MultVerdict = 'CONFIRMADO' | 'NÃO CONFIRMADO' | 'INCONCLUSIVO';
export interface MultRow {
    multiplier: number; costBps: number; costMeasured: boolean; stopOutShare: number;
    grossBps: number; netBps: number; ci: [number, number] | null; halves: [number, number];
    verdict: MultVerdict; motivo: string;
}

export function evaluateMultiplier(r: OosReport, options: MultOption[], seed = 21): MultRow[] {
    const ev = r.events;
    const k = Math.max(1, options.length);
    return options.map(o => {
        const stop = 1e4 / o.multiplier;
        const eff = ev.map(e => (e.maeBps >= stop ? -stop : e.retBps));
        const measured = o.costBps !== null;
        const cost = o.costBps ?? 0;
        const net = eff.map(x => x - cost);
        const n = net.length;
        const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
        const netMean = mean(net), grossMean = mean(eff);
        const mid = Math.floor(n / 2);
        const halves: [number, number] = [mean(net.slice(0, mid)), mean(net.slice(mid))];
        const ci = bootstrapMeanByDay(ev.map((e, i) => ({ day: e.day, x: net[i] })), 1000, seed, 0.05 / k);
        const stopOutShare = n ? ev.filter(e => e.maeBps >= stop).length / n : 0;
        let verdict: MultVerdict, motivo: string;
        if (n < 100) { verdict = 'INCONCLUSIVO'; motivo = `amostra insuficiente (N=${n} < 100)`; }
        else if (netMean <= 0 || (ci && ci[1] < 0)) { verdict = 'NÃO CONFIRMADO'; motivo = netMean <= 0 ? 'retorno líquido médio <= 0' : 'limite superior do IC < 0'; }
        else {
            const f: string[] = [];
            if (!measured) f.push('custo do Multiplier não medido (rode a sonda)');
            if (!ci || !(ci[0] > 0)) f.push('limite inferior do IC <= 0');
            if (!(halves[0] > 0 && halves[1] > 0)) f.push('uma das metades <= 0');
            if (!(r.pPlaceboMean < 0.05)) f.push(`placebo do retorno p=${r.pPlaceboMean.toFixed(3)} >= 0.05`);
            if (f.length === 0) { verdict = 'CONFIRMADO'; motivo = 'todos os critérios atendidos'; } else { verdict = 'INCONCLUSIVO'; motivo = f.join('; '); }
        }
        return { multiplier: o.multiplier, costBps: cost, costMeasured: measured, stopOutShare, grossBps: grossMean, netBps: netMean, ci, halves, verdict, motivo };
    });
}

export function buildMultiplierReport(r: OosReport, rows: MultRow[]): string {
    const f = (x: number) => x.toFixed(2);
    const L = ['[RELATÓRIO ECONOMIA DO MULTIPLIER V21]', '='.repeat(50)];
    L.push(`REGRA CONGELADA: H3_ALTA @ 15m (MULTDOWN na ETH, saída após 15 min) | fonte: ${r.meta.source}`);
    L.push(`N=${r.n} | retorno BRUTO médio do ativo: ${f(r.grossMeanBps)} bps${r.grossCiBps ? ` (IC95 por dia [${f(r.grossCiBps[0])}, ${f(r.grossCiBps[1])}])` : ''} | placebo do retorno p=${r.pPlaceboMean.toFixed(4)}`, '');
    for (const w of rows) {
        L.push(`[x${w.multiplier}] custo ${f(w.costBps)} bps do ativo${w.costMeasured ? ' (medido)' : ' (NÃO medido, assumido 0)'} | stop-out em ${(100 / w.multiplier).toFixed(2)}% | operações com stop-out: ${(w.stopOutShare * 100).toFixed(1)}%`);
        L.push(`   retorno efetivo ${f(w.grossBps)} bps | líquido ${f(w.netBps)} bps | IC (por dia) ${w.ci ? `[${f(w.ci[0])}, ${f(w.ci[1])}]` : 'n/d'} | metades ${f(w.halves[0])} / ${f(w.halves[1])}`);
        L.push(`   => ${w.verdict} (${w.motivo})`);
    }
    L.push('', 'NOTAS E LIMITAÇÕES:',
        '* Sem taxa de acerto de referência: o Multiplier paga pelo retorno, não pelo acerto. Perda máxima = stake (stop-out).',
        '* Máximas/mínimas das velas de 1 min da fonte importada; custo = comissão de abertura medida por proposal; spread e custos de saída não incluídos.',
        '* Resultado do OOS é uma única janela; a regra é uma entre 14 candidatas. Confirmação NÃO autoriza execução; REAL continua bloqueado.');
    return L.join('\n');
}
