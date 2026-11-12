// src/features/trading/services/super-report.ts
'use client';

/**
 * @fileOverview ETAPA 24 — SUPER RELATÓRIO: uma biblioteca de 150 regras pré-registradas (BTC/ETH, velas de 1 min) avaliada
 * com UMA correção de multiplicidade (Holm bilateral sobre as 150), mais a regra H3_ALTA @ 15m em duas janelas, estabilidade
 * mensal e simulação de contratos (Rise/Fall com payouts 80/85/90 e Multiplier x100/x200/x500 com custo de equilíbrio).
 *
 * POR QUE UM TESTE ANALÍTICO E NÃO O PLACEBO PARA TODAS: com m=150, Holm exige p < 0,05/150 = 3,3e-4 para a regra mais forte;
 * o placebo só resolve até 1/(reps+1). O z agrupado por dia (erro-padrão robusto a eventos do mesmo dia) dá p fino; o placebo
 * (deslocamento circular da ETH, 2999 repetições) fica como confirmação das 10 regras mais fortes.
 *
 * Famílias (todas fixas, sem ajuste de parâmetros):
 *   A  choque de 5 min do BTC (z 2.0/2.5/3.0; alta/queda; desfazer/seguir; horizontes 5/15/30/60)           = 48 regras
 *   B  choque de 5 min da própria ETH (mesma grade de A)                                                     = 48 regras
 *   C  spread ETH-beta*BTC em 30 min (|z| 1.5/2.0/2.5; com/sem BTC "parado"; reversão; horizontes 15/30/60)  = 18 regras
 *   D  choque de 15 min do BTC (z 2.5; alta/queda; desfazer/seguir; horizontes 15/30/60)                      = 12 regras
 *   E  hora do dia (CALL na ETH por 60 min no início de cada hora UTC; teste bilateral)                       = 24 regras
 *
 * LIMITAÇÕES: velas de 1 min (entrada no fechamento); só ETH como alvo; Rise/Fall NÃO é oferecido para cripto nesta conta
 * (a simulação serve de referência e para uma futura extensão a Forex); Multiplier usa máx/mín de velas, custo de comissão
 * em bps como cenário (ou medido pela sonda); sem spread, slippage ou custos de saída; a janela de dados é única e o
 * resultado não autoriza execução.
 */

import type { CandleData } from '@/lib/types';
import { wilsonInterval, holmAdjust, mulberry32 } from './leadlag-backtest';
import { alignBars, type Bars } from './horizon-hypotheses';
import { normalCdf, compareWindows, buildWindowComparisonReport } from './window-comparison';
import { evaluateMultiplier, buildMultiplierReport } from './multiplier-economics';

export const SUPER_WARMUP = 800;
export type Family = 'A' | 'B' | 'C' | 'D' | 'E';

export interface Features { n: number; zB5: Float64Array; zE5: Float64Array; zB15: Float64Array; zB3: Float64Array; zS: Float64Array; hour: Int8Array; minuteOfHour: Int8Array; }
export interface RuleSpec { id: string; family: Family; label: string; horizon: number; twoSided: boolean; dirAt: (i: number) => number; }

const SIGMA_WIN = 120;

function winZ(l: Float64Array, q: Float64Array, w: number): Float64Array {
    const n = l.length, z = new Float64Array(n).fill(NaN);
    for (let i = w + SIGMA_WIN + 1; i < n; i++) {
        const e = i - w, a = e - SIGMA_WIN + 1; // retornos de 1 min em [a, e]
        const s1 = Math.sqrt((q[e + 1] - q[a]) / SIGMA_WIN);
        if (s1 > 0) z[i] = (l[i] - l[i - w]) / (s1 * Math.sqrt(w));
    }
    return z;
}

export function computeFeatures(bars: Bars): Features {
    const n = bars.epochs.length;
    const lb = Float64Array.from(bars.c.b, Math.log), le = Float64Array.from(bars.c.e, Math.log);
    const r1b = new Float64Array(n), r1e = new Float64Array(n);
    for (let i = 1; i < n; i++) { r1b[i] = lb[i] - lb[i - 1]; r1e[i] = le[i] - le[i - 1]; }
    const qb = new Float64Array(n + 1), qe = new Float64Array(n + 1), cbe = new Float64Array(n + 1), cbb = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { qb[i + 1] = qb[i] + r1b[i] * r1b[i]; qe[i + 1] = qe[i] + r1e[i] * r1e[i]; cbe[i + 1] = cbe[i] + r1b[i] * r1e[i]; cbb[i + 1] = cbb[i] + r1b[i] * r1b[i]; }
    const W = 30, BW = 240, SW = 480;
    const spread = new Float64Array(n), ps = new Float64Array(n + 1), ps2 = new Float64Array(n + 1);
    for (let i = BW + W; i < n; i++) {
        const a = i - BW + 1, varB = cbb[i + 1] - cbb[a], beta = varB > 0 ? (cbe[i + 1] - cbe[a]) / varB : 1;
        spread[i] = (le[i] - le[i - W]) - beta * (lb[i] - lb[i - W]);
    }
    for (let i = 0; i < n; i++) { ps[i + 1] = ps[i] + spread[i]; ps2[i + 1] = ps2[i] + spread[i] * spread[i]; }
    const zS = new Float64Array(n).fill(NaN);
    for (let i = BW + W + SW; i < n; i++) {
        const a = i - SW, m = (ps[i] - ps[a]) / SW, sd = Math.sqrt(Math.max(0, (ps2[i] - ps2[a]) / SW - m * m));
        if (sd > 0) zS[i] = (spread[i] - m) / sd;
    }
    const hour = new Int8Array(n), minuteOfHour = new Int8Array(n);
    for (let i = 0; i < n; i++) { hour[i] = Math.floor(bars.epochs[i] / 3600) % 24; minuteOfHour[i] = Math.floor(bars.epochs[i] / 60) % 60; }
    return { n, zB5: winZ(lb, qb, 5), zE5: winZ(le, qe, 5), zB15: winZ(lb, qb, 15), zB3: winZ(lb, qb, 3), zS, hour, minuteOfHour };
}

export function buildRules(f: Features, names: { ref: string; target: string } = { ref: 'BTC', target: 'ETH' }): RuleSpec[] {
    const rules: RuleSpec[] = [];
    const shock = (fam: Family, name: string, zArr: Float64Array, zs: number[], hs: number[]) => {
        for (const z of zs) for (const side of ['ALTA', 'QUEDA'] as const) for (const act of ['FADE', 'FOLLOW'] as const) for (const h of hs) {
            const sgn = (side === 'ALTA' ? 1 : -1) * (act === 'FADE' ? -1 : 1);
            rules.push({
                id: `${fam}_${name}_z${z}_${side}_${act}_h${h}`, family: fam, horizon: h, twoSided: false,
                label: `${name} ${side === 'ALTA' ? 'alta' : 'queda'} z${side === 'ALTA' ? '>=' : '<=-'}${z} ${act === 'FADE' ? 'desfazer' : 'seguir'} ${h}m`,
                dirAt: (i: number) => (side === 'ALTA' ? (zArr[i] >= z ? sgn : 0) : (zArr[i] <= -z ? sgn : 0)),
            });
        }
    };
    shock('A', `${names.ref}5`, f.zB5, [2, 2.5, 3], [5, 15, 30, 60]);
    shock('B', `${names.target}5`, f.zE5, [2, 2.5, 3], [5, 15, 30, 60]);
    for (const thr of [1.5, 2, 2.5]) for (const quiet of [false, true]) for (const h of [15, 30, 60]) {
        rules.push({
            id: `C_SPREAD_z${thr}_${quiet ? 'QUIETO' : 'LIVRE'}_h${h}`, family: 'C', horizon: h, twoSided: false,
            label: `spread |z|>=${thr}${quiet ? ' c/ BTC parado' : ''} reversão ${h}m`,
            dirAt: (i: number) => { const z = f.zS[i]; if (!(Math.abs(z) >= thr)) return 0; if (quiet && !(Math.abs(f.zB3[i]) < 0.5)) return 0; return z > 0 ? -1 : 1; },
        });
    }
    shock('D', `${names.ref}15`, f.zB15, [2.5], [15, 30, 60]);
    for (let hr = 0; hr < 24; hr++) {
        rules.push({ id: `E_HORA${String(hr).padStart(2, '0')}_h60`, family: 'E', horizon: 60, twoSided: true, label: `CALL ${String(hr).padStart(2, '0')}:00 UTC por 60m (bilateral)`, dirAt: (i: number) => (f.hour[i] === hr && f.minuteOfHour[i] === 0 ? 1 : 0) });
    }
    return rules;
}

export interface Ev { i: number; day: number; month: string; dir: number; retLong: number; advLong: number; advShort: number; }
const ret = (e: Ev) => e.dir * e.retLong;
const adv = (e: Ev) => (e.dir === 1 ? e.advLong : e.advShort);

export function collectEvents(bars: Bars, rule: RuleSpec, gc: Int32Array, lb = 750): Ev[] {
    const n = bars.epochs.length, h = rule.horizon, out: Ev[] = [];
    const le = bars.c.e;
    let next = 0;
    for (let i = SUPER_WARMUP; i < n - h - 1; i++) {
        if (i < next) continue;
        const d = rule.dirAt(i);
        if (!d) continue;
        if (gc[i + h] !== gc[i - lb]) continue;
        let lo = Infinity, hi = -Infinity;
        for (let j = i + 1; j <= i + h; j++) { if (bars.l.e[j] < lo) lo = bars.l.e[j]; if (bars.h.e[j] > hi) hi = bars.h.e[j]; }
        out.push({
            i, day: Math.floor(bars.epochs[i] / 86400), month: new Date(bars.epochs[i] * 1000).toISOString().slice(0, 7), dir: d,
            retLong: Math.log(le[i + h] / le[i]) * 1e4, advLong: Math.max(0, Math.log(le[i] / lo) * 1e4), advShort: Math.max(0, Math.log(hi / le[i]) * 1e4),
        });
        next = i + h;
    }
    return out;
}

export interface RuleStats {
    n: number; wins: number; ties: number; winRate: number; wilson: [number, number]; mean: number; se: number; z: number; p: number;
    halves: [number, number]; months: { month: string; n: number; mean: number }[];
}
const meanOf = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function summarizeEvents(evs: Ev[]): RuleStats {
    const x = evs.map(ret), n = x.length, m = meanOf(x);
    const wins = x.filter(v => v > 0).length, ties = x.filter(v => v === 0).length;
    const byDay = new Map<number, number>();
    evs.forEach((e, k) => byDay.set(e.day, (byDay.get(e.day) ?? 0) + (x[k] - m)));
    let se = NaN, z = 0, p = 1;
    if (byDay.size >= 10 && n > 1) {
        let s2 = 0; byDay.forEach(v => { s2 += v * v; });
        se = Math.sqrt(s2) / n;
        if (se > 0) { z = m / se; p = 2 * (1 - normalCdf(Math.abs(z))); }
    }
    const mid = Math.floor(n / 2), mm = new Map<string, number[]>();
    evs.forEach((e, k) => { const a = mm.get(e.month) ?? []; a.push(x[k]); mm.set(e.month, a); });
    return {
        n, wins, ties, winRate: n ? wins / n : 0, wilson: wilsonInterval(wins, n), mean: m, se, z, p,
        halves: [meanOf(x.slice(0, mid)), meanOf(x.slice(mid))],
        months: Array.from(mm.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([month, a]) => ({ month, n: a.length, mean: meanOf(a) })),
    };
}

export interface RuleResult { rule: RuleSpec; events: Ev[]; rawEvents: Ev[]; stats: RuleStats; pAdj: number; survivor: boolean; flipped: boolean; placebo?: number; }

export interface WalkForwardRow { id: string; label: string; flipped: boolean; trainN: number; trainMean: number; trainPAdj: number; testN: number; testMean: number; testZ: number; testPAdj: number; confirmed: boolean; }
export interface WalkForward { k: number; trainFrom: number; trainTo: number; testFrom: number; testTo: number; selected: number; confirmed: number; rows: WalkForwardRow[]; }

export interface SuperReport {
    ok: boolean; reason?: string; days: number; from: number; to: number; candles: number;
    results: RuleResult[]; survivors: number; rawSignificant: number; expectedRawSignificant: number;
    frozenId: string | null; windowsText: string; multiplierText: string; text: string; walkForward?: WalkForward;
}

export const FROZEN_LIB_ID = 'A_BTC5_z2.5_ALTA_FADE_h15';

export interface ReportCfg {
    title: string; names: { ref: string; target: string }; payouts: number[]; multipliers: number[]; costScenarios: number[]; frozenId: string | null; assetNote: string;
}
export const CRYPTO_REPORT_CFG: ReportCfg = {
    title: '[SUPER RELATÓRIO V24]', names: { ref: 'BTC', target: 'ETH' }, payouts: [80, 85, 90], multipliers: [100, 200, 500], costScenarios: [2, 5, 10], frozenId: FROZEN_LIB_ID,
    assetNote: 'o Rise/Fall NÃO é oferecido para cripto nesta conta; as linhas servem de referência (e para Forex).',
};

export interface SuperOpts {
    includeWindows?: boolean; placeboReps?: number; seed?: number; extraNotes?: string[]; costs?: { multiplier: number; costBps: number | null }[]; source?: string;
    names?: { ref: string; target: string }; frozenId?: string | null; title?: string; payouts?: number[]; multipliers?: number[]; costScenarios?: number[]; assetNote?: string;
    holdoutFraction?: number; minCandles?: number;
}

function runWalkForward(results: RuleResult[], bars: Bars, holdout: number): WalkForward | undefined {
    const n = bars.epochs.length, k = Math.floor(n * (1 - holdout));
    if (!(holdout > 0 && holdout < 0.8) || k < SUPER_WARMUP * 4) return undefined;
    const prep = results.map(r => {
        const h = r.rule.horizon;
        let tr = r.rawEvents.filter(e => e.i + h < k), te = r.rawEvents.filter(e => e.i >= k);
        let trS = summarizeEvents(tr), flipped = false;
        if (r.rule.twoSided && trS.mean < 0) { tr = tr.map(e => ({ ...e, dir: -e.dir })); te = te.map(e => ({ ...e, dir: -e.dir })); trS = summarizeEvents(tr); flipped = true; }
        return { r, trS, te, flipped };
    });
    const pAdjTrain = holmAdjust(prep.map(x => x.trS.p));
    const sel = prep.map((x, idx) => ({ ...x, pAdjTrain: pAdjTrain[idx] })).filter(x => x.pAdjTrain < 0.10 && x.trS.mean > 0 && x.trS.n >= 50);
    const tests = sel.map(x => summarizeEvents(x.te));
    const pOne = tests.map(t => (t.n >= 30 && t.se > 0 && Number.isFinite(t.se) ? 1 - normalCdf(t.z) : 1));
    const pAdjTest = holmAdjust(pOne);
    const rows: WalkForwardRow[] = sel.map((x, idx) => ({
        id: x.r.rule.id, label: x.r.rule.label, flipped: x.flipped, trainN: x.trS.n, trainMean: x.trS.mean, trainPAdj: x.pAdjTrain,
        testN: tests[idx].n, testMean: tests[idx].mean, testZ: tests[idx].z, testPAdj: pAdjTest[idx],
        confirmed: pAdjTest[idx] < 0.05 && tests[idx].mean > 0 && tests[idx].n >= 30,
    }));
    return { k, trainFrom: bars.epochs[0], trainTo: bars.epochs[k - 1], testFrom: bars.epochs[k], testTo: bars.epochs[n - 1], selected: rows.length, confirmed: rows.filter(r => r.confirmed).length, rows };
}

export function runSuperReport(btc: CandleData[], eth: CandleData[], opts: SuperOpts = {}): SuperReport {
    const cfg: ReportCfg = {
        ...CRYPTO_REPORT_CFG,
        ...(opts.names ? { names: opts.names, frozenId: null } : {}),
        ...(opts.frozenId !== undefined ? { frozenId: opts.frozenId } : {}),
        ...(opts.title ? { title: opts.title } : {}), ...(opts.payouts ? { payouts: opts.payouts } : {}), ...(opts.multipliers ? { multipliers: opts.multipliers } : {}),
        ...(opts.costScenarios ? { costScenarios: opts.costScenarios } : {}), ...(opts.assetNote ? { assetNote: opts.assetNote } : {}),
    };
    const bars = alignBars(btc, eth);
    const n = bars.epochs.length;
    const minC = opts.minCandles ?? 20_000;
    const empty = (reason: string): SuperReport => ({ ok: false, reason, days: 0, from: 0, to: 0, candles: n, results: [], survivors: 0, rawSignificant: 0, expectedRawSignificant: 0, frozenId: cfg.frozenId, windowsText: '', multiplierText: '', text: `${cfg.title}\nDADOS INSUFICIENTES: ${reason}` });
    if (n < minC) return empty(`apenas ${n} velas alinhadas (mínimo ${minC}, ~${Math.round(minC / 1440)} dias)`);

    const features = computeFeatures(bars);
    const rules = buildRules(features, cfg.names);
    const gc = new Int32Array(n);
    for (let i = 1; i < n; i++) gc[i] = gc[i - 1] + (bars.epochs[i] - bars.epochs[i - 1] !== 60 ? 1 : 0);

    const results: RuleResult[] = rules.map(rule => {
        const rawEvents = collectEvents(bars, rule, gc);
        let events = rawEvents;
        let stats = summarizeEvents(events), flipped = false;
        if (rule.twoSided && stats.mean < 0) { events = events.map(e => ({ ...e, dir: -e.dir })); stats = summarizeEvents(events); flipped = true; }
        return { rule, events, rawEvents, stats, pAdj: 1, survivor: false, flipped };
    });
    const pAdj = holmAdjust(results.map(r => r.stats.p));
    results.forEach((r, k) => {
        r.pAdj = pAdj[k];
        const s = r.stats, sign = Math.sign(s.mean);
        r.survivor = r.pAdj < 0.05 && s.n >= 100 && sign !== 0 && Math.sign(s.halves[0]) === sign && Math.sign(s.halves[1]) === sign;
    });
    const rawSig = results.filter(r => r.stats.p < 0.05 && r.stats.n >= 30).length;
    const survivors = results.filter(r => r.survivor).length;

    // placebo (deslocamento circular) nas 10 regras de maior |z|. ATENÇÃO: otimista (ver notas do relatório).
    const reps = opts.placeboReps ?? 2999, rng = mulberry32(opts.seed ?? 24);
    const top = [...results].filter(r => r.stats.n >= 30).sort((a, b) => Math.abs(b.stats.z) - Math.abs(a.stats.z)).slice(0, 10);
    const lE = Float64Array.from(bars.c.e, Math.log), minShift = Math.min(1440, Math.floor(n * 0.1));
    for (const r of top) {
        const h = r.rule.horizon, obs = r.stats.mean, sg = Math.sign(obs) || 1;
        let ge = 0, used = 0;
        for (let k = 0; k < reps; k++) {
            const s = minShift + Math.floor(rng() * Math.max(1, n - 2 * minShift));
            let sum = 0, c = 0;
            for (const e of r.events) { const j = (e.i + s) % n; if (j + h >= n || gc[j + h] !== gc[j]) continue; c++; sum += e.dir * (lE[j + h] - lE[j]) * 1e4; }
            if (c > 0) { used++; if ((sum / c) * sg >= obs * sg) ge++; }
        }
        r.placebo = used ? (ge + 1) / (used + 1) : 1;
    }

    let windowsText = '', multiplierText = '';
    if (opts.includeWindows !== false && cfg.frozenId) {
        try {
            const cmp = compareWindows(btc, eth, { source: opts.source });
            windowsText = buildWindowComparisonReport(cmp);
            const costs = opts.costs && opts.costs.length ? opts.costs : [100, 200, 500].map(m => ({ multiplier: m, costBps: null as number | null }));
            const parts: string[] = [];
            if (cmp.desc.ok) parts.push('--- JANELA DE DESCOBERTA ---\n' + buildMultiplierReport(cmp.desc, evaluateMultiplier(cmp.desc, costs)));
            if (cmp.pre.ok) parts.push('--- PRÉ-DESCOBERTA ---\n' + buildMultiplierReport(cmp.pre, evaluateMultiplier(cmp.pre, costs)));
            multiplierText = parts.join('\n\n');
        } catch (e) { windowsText = `Falha na comparação de janelas: ${(e as Error).message}`; }
    }
    const walkForward = opts.holdoutFraction ? runWalkForward(results, bars, opts.holdoutFraction) : undefined;

    const rep: SuperReport = {
        ok: true, days: (bars.epochs[n - 1] - bars.epochs[0]) / 86400, from: bars.epochs[0], to: bars.epochs[n - 1], candles: n,
        results, survivors, rawSignificant: rawSig, expectedRawSignificant: 0.05 * results.length, frozenId: cfg.frozenId, windowsText, multiplierText, text: '', walkForward,
    };
    rep.text = buildSuperReportText(rep, opts.extraNotes ?? [], opts.source, cfg);
    return rep;
}

// ---------------- TEXTO ----------------
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : 'n/d');
const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
const fp = (p: number) => (p < 0.0001 ? '<0.0001' : p.toFixed(4));

function contractSim(r: RuleResult, cfg: ReportCfg): string[] {
    const L: string[] = [], evs = r.events, n = evs.length, s = r.stats;
    if (n === 0) return L;
    for (const pay of cfg.payouts) {
        const be = 1 / (1 + pay / 100), ev = s.winRate * (pay / 100) - (1 - s.winRate);
        L.push(`     Rise/Fall payout ${pay}%: breakeven ${pc(be)} | acerto ${pc(s.winRate)} (Wilson inf. ${pc(s.wilson[0])}) | EV/stake ${ev >= 0 ? '+' : ''}${(ev * 100).toFixed(1)}% | ${s.wilson[0] > be ? 'Wilson acima do breakeven' : 'Wilson NÃO supera o breakeven'}`);
    }
    for (const m of cfg.multipliers) {
        const stop = 1e4 / m, eff = meanOf(evs.map(e => (adv(e) >= stop ? -stop : ret(e))));
        const so = evs.filter(e => adv(e) >= stop).length / n;
        L.push(`     Multiplier x${m}: retorno efetivo ${f2(eff)} bps | stop-out ${pc(so)} | custo de equilíbrio ${f2(eff)} bps | líquido c/ custo ${cfg.costScenarios.join('/')} bps: ${cfg.costScenarios.map(c => f2(eff - c)).join(' / ')}`);
    }
    return L;
}

export function buildSuperReportText(r: SuperReport, extraNotes: string[], source: string | undefined, cfg: ReportCfg = CRYPTO_REPORT_CFG): string {
    const L: string[] = [cfg.title, '='.repeat(60)];
    const d = (e: number) => new Date(e * 1000).toISOString().slice(0, 10);
    const res = r.results;
    const frozen = r.frozenId ? res.find(x => x.rule.id === r.frozenId) : undefined;
    const ranked = [...res].filter(x => x.stats.n >= 30).sort((a, b) => Math.abs(b.stats.z) - Math.abs(a.stats.z));
    const best = ranked[0];
    L.push(`FONTE: ${source ?? 'n/d'} | ${d(r.from)} a ${d(r.to)} (${r.days.toFixed(0)} dias, ${r.candles} velas alinhadas de 1 min) | referência: ${cfg.names.ref} | alvo: ${cfg.names.target}`);
    L.push('', '1) RESUMO EXECUTIVO');
    L.push(`- Regras testadas: ${res.length} (famílias A..E). Correção: Holm bilateral sobre ${res.length} testes (z agrupado por dia). Sobrevivente = Holm < 5% + N >= 100 + as duas metades com o mesmo sinal da média.`);
    L.push(`- SOBREVIVENTES: ${r.survivors}. Regras com p bruto < 5%: ${r.rawSignificant} (esperado só por acaso: ~${r.expectedRawSignificant.toFixed(1)}). As regras "desfazer" e "seguir" são gêmeas (mesmo |z|), então o nº efetivo de testes é menor que ${res.length}.`);
    if (best) L.push(`- Regra mais forte (|z|): ${best.rule.id} [${best.rule.label}] N=${best.stats.n}, retorno ${f2(best.stats.mean)} bps, z=${f2(best.stats.z)}, p ajustado ${fp(best.pAdj)}${best.placebo !== undefined ? `, placebo p=${fp(best.placebo)} (otimista)` : ''}.`);
    if (frozen) L.push(`- Regra congelada H3_ALTA@15m (${r.frozenId}) na amostra inteira: N=${frozen.stats.n}, acerto ${pc(frozen.stats.winRate)}, retorno ${f2(frozen.stats.mean)} bps, z=${f2(frozen.stats.z)}, p ajustado ${fp(frozen.pAdj)}, metades ${f2(frozen.stats.halves[0])} / ${f2(frozen.stats.halves[1])} bps.`);
    if (r.walkForward) L.push(`- WALK-FORWARD (seleção no treino, confirmação no holdout): ${r.walkForward.selected} regra(s) selecionada(s) no treino; CONFIRMADAS no holdout: ${r.walkForward.confirmed}.`);
    const wfOk = r.walkForward ? r.walkForward.confirmed > 0 : false;
    L.push(`- CONCLUSÃO AUTOMÁTICA: ${r.survivors === 0 && !wfOk ? 'nenhuma regra da biblioteca tem retorno bruto distinguível de zero depois da correção para ' + res.length + ' testes' + (r.walkForward ? ' e nenhuma se confirma no holdout' : '') + '. Não há base para executar.' : `${r.survivors} regra(s) passam na correção${r.walkForward ? ` e ${r.walkForward.confirmed} se confirmam no holdout` : ''}; são CANDIDATAS (precisam de dados novos à frente no tempo e de custo medido) e não estão confirmadas.`}`);
    L.push(`- Poder: com os eventos disponíveis, só efeitos grandes passam por uma correção de ${res.length} testes. Efeitos pequenos reais podem ficar invisíveis.`);

    L.push('', `2) RANKING: 25 REGRAS DE MAIOR |z| (de ${res.length})`);
    ranked.slice(0, 25).forEach((x, k) => {
        const s = x.stats;
        L.push(`${String(k + 1).padStart(2)}. ${x.rule.id}${x.flipped ? ' (PUT)' : ''} | N=${s.n} | acerto ${pc(s.winRate)} | ret ${f2(s.mean)} bps | z=${f2(s.z)} | p adj ${fp(x.pAdj)} | metades ${f2(s.halves[0])}/${f2(s.halves[1])}${x.placebo !== undefined ? ` | placebo ${fp(x.placebo)}` : ''}${x.survivor ? ' | SOBREVIVENTE' : ''}`);
    });

    L.push('', '3) EXCESSO DE SINAL POR FAMÍLIA (p bruto < 5% observado x esperado por acaso)');
    for (const fam of ['A', 'B', 'C', 'D', 'E'] as Family[]) {
        const g = res.filter(x => x.rule.family === fam);
        const sig = g.filter(x => x.stats.p < 0.05 && x.stats.n >= 30).length;
        L.push(`- Família ${fam}: ${g.length} regras | p<5%: ${sig} (acaso: ~${(0.05 * g.length).toFixed(1)}) | média dos retornos: ${f2(meanOf(g.map(x => x.stats.mean)))} bps`);
    }

    L.push('', '4) REGRA CONGELADA: JANELA DE DESCOBERTA x PRÉ-DESCOBERTA');
    L.push(r.windowsText || '(não aplicável: não há regra congelada neste laboratório)');

    L.push('', `5) SIMULAÇÃO DE CONTRATOS (${frozen ? 'regra congelada e ' : ''}5 mais fortes, amostra inteira)`);
    const picks = [frozen, ...ranked.filter(x => x.rule.id !== r.frozenId).slice(0, 5)].filter((x): x is RuleResult => !!x);
    for (const x of picks) { L.push(`- ${x.rule.id}${x.flipped ? ' (PUT)' : ''} [${x.rule.label}] N=${x.stats.n}`); contractSim(x, cfg).forEach(l => L.push(l)); }
    L.push(`  Nota: ${cfg.assetNote} O custo de equilíbrio do Multiplier é o retorno bruto efetivo: a comissão real tem de ser MENOR que ele.`);

    L.push('', '6) MULTIPLIER DA REGRA CONGELADA POR JANELA');
    L.push(r.multiplierText || '(não aplicável)');

    L.push('', `7) ESTABILIDADE MENSAL (retorno médio em bps por mês: ${frozen ? 'regra congelada e ' : ''}5 mais fortes)`);
    for (const x of picks) L.push(`- ${x.rule.id}: ` + x.stats.months.map(m => `${m.month} ${f2(m.mean)} (N=${m.n})`).join(' | '));

    if (r.walkForward) {
        const w = r.walkForward;
        L.push('', `8) WALK-FORWARD: treino ${d(w.trainFrom)} a ${d(w.trainTo)} | holdout ${d(w.testFrom)} a ${d(w.testTo)}`);
        L.push(`- Seleção no treino: Holm(${res.length}) < 10%, retorno > 0, N >= 50. Confirmação no holdout: z unilateral agrupado por dia, Holm sobre as ${w.selected} selecionadas, retorno > 0, N >= 30.`);
        if (w.rows.length === 0) L.push('- Nenhuma regra passou na seleção do treino.');
        w.rows.slice(0, 20).forEach(x => L.push(`- ${x.id}${x.flipped ? ' (PUT)' : ''} | treino N=${x.trainN} ret ${f2(x.trainMean)} bps (p adj ${fp(x.trainPAdj)}) | holdout N=${x.testN} ret ${f2(x.testMean)} bps z=${f2(x.testZ)} p adj ${fp(x.testPAdj)}${x.confirmed ? ' | CONFIRMADA' : ''}`));
    }

    if (extraNotes.length) { L.push('', `${r.walkForward ? '9' : '8'}) SONDAS DA DERIV E QUALIDADE DOS DADOS`); extraNotes.forEach(t => { L.push(t); L.push(''); }); }

    L.push('', 'NOTAS E LIMITAÇÕES:',
        `* ${res.length} regras fixas avaliadas na MESMA amostra: o Holm controla o risco de falso positivo da lista, mas não o de ter escolhido a lista depois de ver resultados anteriores.`,
        '* Retornos em bps do ativo, na direção da regra, entrada no fechamento da vela do sinal; eventos independentes (cooldown = horizonte).',
        '* O placebo por deslocamento circular é OTIMISTA (instantes aleatórios têm menos volatilidade que os eventos): use o z agrupado e o Holm, não o placebo.',
        '* Máx/mín de velas de 1 min para o stop-out; sem spread, slippage ou custos de saída. Sem LLM.',
        '* Nada aqui autoriza execução; REAL continua bloqueado. Um candidato só avança com dados posteriores à amostra (shadow à frente no tempo) e custo medido.');
    return L.join('\n');
}
