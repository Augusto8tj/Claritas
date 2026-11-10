// src/features/trading/services/horizon-hypotheses.ts
'use client';

/**
 * @fileOverview ETAPA 18 — HIPÓTESES PRÉ-REGISTRADAS PARA CONTRATOS DE 15/30 MIN (BTC como referência, ETH como alvo).
 *
 * 100% determinístico: nenhuma chamada a LLM. Regras fixas e declaradas ANTES de olhar os resultados
 * (sem varredura de parâmetros => sem sobreajuste por seleção; o risco restante é a multiplicidade, tratada por Holm).
 *
 *  H1  Elástico beta-ajustado: spread = R_eth(30m) - beta*R_btc(30m); |z|>=2.2 e BTC "parou" (|z BTC 3m| < 0.5)
 *      => aposta na reversão do spread (direção = -sinal do z).
 *  H2  Divergência de exaustão: BTC rompe a máxima (mínima) das últimas 30 velas, a ETH NÃO rompe, e o BTC fecha de
 *      volta abaixo (acima) do extremo anterior => FALL (RISE) na ETH.
 *  H3  Choque de 5 min do BTC (|z|>=2.5): desfaz (fade) o movimento. Alta e queda em hipóteses SEPARADAS.
 *  +VR Filtro de regime: razão de variância VR(15) da ETH nas últimas 120 velas < 0.85 (reversão à média).
 *
 * Entrada no fechamento da vela do sinal (variante A) ou 1 vela depois (variante B, robustez). Empate = perda.
 * Eventos independentes: cooldown = horizonte. Estatística: Wilson, metades, bootstrap por dia, placebo por
 * deslocamento circular, Holm sobre TODAS as linhas. Edge só se todos os critérios passarem.
 *
 * LIMITAÇÕES: velas de 1 min (sinal e entrada no fechamento); payout assumido; sem custos de Multiplier;
 * tipos de contrato além de Rise/Fall (Higher/Lower, Touch, Accumulators) NÃO são modelados aqui;
 * a janela de dados (dias) limita o poder estatístico.
 */

import type { CandleData } from '@/lib/types';
import { wilsonInterval, holmAdjust, mulberry32, blockBootstrapDays, classifyEdge, MIN_EVENTS, MIN_HALF_EVENTS } from './leadlag-backtest';

export type HypId = 'H1' | 'H1+VR' | 'H2' | 'H3_ALTA' | 'H3_QUEDA' | 'H3_ALTA+VR' | 'H3_QUEDA+VR';
export type HypVerdict = 'SEM EDGE' | 'INCONCLUSIVO' | 'EDGE CANDIDATO';

export interface HypConfig {
    horizons: number[]; payoutPct: number; spreadWin: number; betaWin: number; spreadStdWin: number; zSpread: number; zBtcQuiet: number;
    breakoutWin: number; shockWin: number; zShock: number; sigmaWin: number; vrWin: number; vrQ: number; vrMax: number;
    placeboReps: number; seed: number;
}
export const DEFAULT_HYP_CONFIG: HypConfig = {
    horizons: [15, 30], payoutPct: 80, spreadWin: 30, betaWin: 240, spreadStdWin: 480, zSpread: 2.2, zBtcQuiet: 0.5,
    breakoutWin: 30, shockWin: 5, zShock: 2.5, sigmaWin: 120, vrWin: 120, vrQ: 15, vrMax: 0.85, placeboReps: 999, seed: 18,
};

export interface Bars { epochs: number[]; o: { b: number[]; e: number[] }; h: { b: number[]; e: number[] }; l: { b: number[]; e: number[] }; c: { b: number[]; e: number[] }; }

export interface HypRow {
    id: HypId; horizon: number; n: number; wins: number; ties: number; winRate: number; wilson: [number, number];
    breakeven: number; halves: [number | null, number | null]; dayBootstrap: [number, number] | null;
    winRateB: number | null; pRaw: number; pAdj: number; verdict: HypVerdict; motivo: string; callShare: number;
}
export interface HypReport {
    ok: boolean; reason?: string; config: HypConfig;
    meta: { from: number; to: number; days: number; candles: number };
    rows: HypRow[]; conclusion: string;
}

export function alignBars(btc: CandleData[], eth: CandleData[]): Bars {
    const m = new Map<number, CandleData>(); btc.forEach(c => m.set(c.epoch, c));
    const sorted = [...eth].sort((a, b) => a.epoch - b.epoch);
    const out: Bars = { epochs: [], o: { b: [], e: [] }, h: { b: [], e: [] }, l: { b: [], e: [] }, c: { b: [], e: [] } };
    for (const e of sorted) {
        const b = m.get(e.epoch); if (!b) continue;
        const v = [b.open, b.high, b.low, b.close, e.open, e.high, e.low, e.close].map(Number);
        if (!v.every(x => Number.isFinite(x) && x > 0)) continue;
        if (out.epochs.length && e.epoch <= out.epochs[out.epochs.length - 1]) continue;
        out.epochs.push(e.epoch);
        out.o.b.push(v[0]); out.h.b.push(v[1]); out.l.b.push(v[2]); out.c.b.push(v[3]);
        out.o.e.push(v[4]); out.h.e.push(v[5]); out.l.e.push(v[6]); out.c.e.push(v[7]);
    }
    return out;
}

const HYPS: HypId[] = ['H1', 'H1+VR', 'H2', 'H3_ALTA', 'H3_QUEDA', 'H3_ALTA+VR', 'H3_QUEDA+VR'];

/** Sinais (direção +1 CALL / -1 PUT / 0 nada) por vela, usando SÓ dados até a vela i (causal). */
export function computeSignals(bars: Bars, cfg: HypConfig = DEFAULT_HYP_CONFIG): { dir: Record<HypId, Int8Array>; warmup: number } {
    const n = bars.epochs.length;
    const lb = bars.c.b.map(Math.log), le = bars.c.e.map(Math.log);
    const r1b = new Float64Array(n), r1e = new Float64Array(n);
    for (let i = 1; i < n; i++) { r1b[i] = lb[i] - lb[i - 1]; r1e[i] = le[i] - le[i - 1]; }
    const qb = new Float64Array(n + 1), cbe = new Float64Array(n + 1), cbb = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { qb[i + 1] = qb[i] + r1b[i] * r1b[i]; cbe[i + 1] = cbe[i] + r1b[i] * r1e[i]; cbb[i + 1] = cbb[i] + r1b[i] * r1b[i]; }
    const sigma1b = (end: number, w: number) => { const a = Math.max(0, end - w + 1); return Math.sqrt((qb[end + 1] - qb[a]) / Math.max(1, end - a + 1)); };

    const W = cfg.spreadWin;
    const warmup = Math.max(cfg.betaWin + W, cfg.spreadStdWin + cfg.betaWin + W, cfg.sigmaWin + cfg.shockWin, cfg.vrWin + cfg.vrQ, cfg.breakoutWin + 5) + 5;
    const spread = new Float64Array(n);
    const ready = new Uint8Array(n);
    for (let i = cfg.betaWin + W; i < n; i++) {
        const a = i - cfg.betaWin + 1;
        const cov = cbe[i + 1] - cbe[a], varB = cbb[i + 1] - cbb[a];
        const beta = varB > 0 ? cov / varB : 1;
        spread[i] = (le[i] - le[i - W]) - beta * (lb[i] - lb[i - W]);
        ready[i] = 1;
    }
    const ps = new Float64Array(n + 1), ps2 = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { ps[i + 1] = ps[i] + spread[i]; ps2[i + 1] = ps2[i] + spread[i] * spread[i]; }

    const vrOk = (i: number): boolean => { // VR(q) da ETH nas últimas vrWin velas
        const q = cfg.vrQ, from = i - cfg.vrWin + 1;
        if (from - q < 0) return false;
        let s1 = 0, sq = 0;
        for (let j = from; j <= i; j++) { s1 += r1e[j] * r1e[j]; const d = le[j] - le[j - q]; sq += d * d; }
        if (s1 <= 0) return false;
        return sq / (q * s1) < cfg.vrMax;
    };

    const dir = {} as Record<HypId, Int8Array>;
    HYPS.forEach(h => { dir[h] = new Int8Array(n); });
    const K = cfg.breakoutWin;
    for (let i = warmup; i < n; i++) {
        // H1
        if (ready[i]) {
            const a = i - cfg.spreadStdWin, cnt = cfg.spreadStdWin; // janela [a, i-1]
            const mean = (ps[i] - ps[a]) / cnt;
            const sd = Math.sqrt(Math.max(0, (ps2[i] - ps2[a]) / cnt - mean * mean));
            if (sd > 0) {
                const z = (spread[i] - mean) / sd;
                const sb = sigma1b(i - 3, cfg.sigmaWin) * Math.sqrt(3);
                const zb3 = sb > 0 ? (lb[i] - lb[i - 3]) / sb : 99;
                if (Math.abs(z) >= cfg.zSpread && Math.abs(zb3) < cfg.zBtcQuiet) {
                    const d: 1 | -1 = z > 0 ? -1 : 1;
                    dir['H1'][i] = d;
                    if (vrOk(i)) dir['H1+VR'][i] = d;
                }
            }
        }
        // H2 (topo => PUT, fundo => CALL)
        {
            let topB = -Infinity, topE = -Infinity, botB = Infinity, botE = Infinity;
            for (let j = i - K; j <= i - 3; j++) { topB = Math.max(topB, bars.h.b[j]); topE = Math.max(topE, bars.h.e[j]); botB = Math.min(botB, bars.l.b[j]); botE = Math.min(botE, bars.l.e[j]); }
            let hB = -Infinity, hE = -Infinity, lB = Infinity, lE = Infinity;
            for (let j = i - 2; j <= i; j++) { hB = Math.max(hB, bars.h.b[j]); hE = Math.max(hE, bars.h.e[j]); lB = Math.min(lB, bars.l.b[j]); lE = Math.min(lE, bars.l.e[j]); }
            const topSig = hB > topB && hE <= topE && bars.c.b[i] < topB;
            const botSig = lB < botB && lE >= botE && bars.c.b[i] > botB;
            if (topSig && !botSig) dir['H2'][i] = -1; else if (botSig && !topSig) dir['H2'][i] = 1;
        }
        // H3
        {
            const sb = sigma1b(i - cfg.shockWin, cfg.sigmaWin) * Math.sqrt(cfg.shockWin);
            if (sb > 0) {
                const z = (lb[i] - lb[i - cfg.shockWin]) / sb;
                if (z >= cfg.zShock) { dir['H3_ALTA'][i] = -1; if (vrOk(i)) dir['H3_ALTA+VR'][i] = -1; }
                else if (z <= -cfg.zShock) { dir['H3_QUEDA'][i] = 1; if (vrOk(i)) dir['H3_QUEDA+VR'][i] = 1; }
            }
        }
    }
    return { dir, warmup };
}

export function runHorizonHypotheses(btc: CandleData[], eth: CandleData[], overrides: Partial<HypConfig> = {}): HypReport {
    const cfg: HypConfig = { ...DEFAULT_HYP_CONFIG, ...overrides };
    const bars = alignBars(btc, eth);
    const n = bars.epochs.length;
    const fail = (reason: string): HypReport => ({ ok: false, reason, config: cfg, meta: { from: 0, to: 0, days: 0, candles: n }, rows: [], conclusion: `DADOS INSUFICIENTES: ${reason}` });
    const maxH = Math.max(...cfg.horizons);
    if (n < 3000) return fail(`apenas ${n} velas alinhadas (mínimo 3000)`);

    const { dir, warmup } = computeSignals(bars, cfg);
    const le = bars.c.e.map(Math.log);
    const breakeven = 1 / (1 + cfg.payoutPct / 100);
    const days = (bars.epochs[n - 1] - bars.epochs[0]) / 86400;

    type Pre = { id: HypId; h: number; t: number[]; d: (1 | -1)[]; win: boolean[]; tie: boolean[]; winB: boolean[] };
    const pre: Pre[] = [];
    for (const id of HYPS) for (const h of cfg.horizons) {
        const p: Pre = { id, h, t: [], d: [], win: [], tie: [], winB: [] };
        let next = 0;
        for (let i = warmup; i < n - maxH - 1; i++) {
            const d = dir[id][i];
            if (!d || i < next) continue;
            const rA = (le[i + h] - le[i]) * d, rB = (le[i + 1 + h] - le[i + 1]) * d;
            p.t.push(i); p.d.push(d as 1 | -1); p.win.push(rA > 0); p.tie.push(rA === 0); p.winB.push(rB > 0);
            next = i + h;
        }
        pre.push(p);
    }

    // placebo: mesmos instantes e direções, retornos da ETH em instantes deslocados circularmente
    const rng = mulberry32(cfg.seed);
    const minShift = Math.min(1440, Math.floor(n * 0.1));
    const ge = new Array<number>(pre.length).fill(0), used = new Array<number>(pre.length).fill(0);
    const obs = pre.map(p => (p.t.length ? p.win.filter(Boolean).length / p.t.length : 0));
    for (let rep = 0; rep < cfg.placeboReps; rep++) {
        const s = minShift + Math.floor(rng() * Math.max(1, n - 2 * minShift));
        pre.forEach((p, r) => {
            if (!p.t.length) return;
            let w = 0, c = 0;
            for (let k = 0; k < p.t.length; k++) {
                const j = (p.t[k] + s) % n;
                if (j + p.h >= n) continue;
                c++; if ((le[j + p.h] - le[j]) * p.d[k] > 0) w++;
            }
            if (c > 0) { used[r]++; if (w / c >= obs[r]) ge[r]++; }
        });
    }
    const pRaw = pre.map((p, r) => (!p.t.length || !used[r] ? 1 : (ge[r] + 1) / (used[r] + 1)));
    const pAdj = holmAdjust(pRaw);

    const rows: HypRow[] = pre.map((p, r) => {
        const N = p.t.length, wins = p.win.filter(Boolean).length, ties = p.tie.filter(Boolean).length;
        const wilson = wilsonInterval(wins, N), mid = Math.floor(N / 2);
        const rate = (a: boolean[]) => (a.length >= MIN_HALF_EVENTS ? a.filter(Boolean).length / a.length : null);
        const halves: [number | null, number | null] = [rate(p.win.slice(0, mid)), rate(p.win.slice(mid))];
        const dayBootstrap = blockBootstrapDays(p.t.map((i, k) => ({ day: Math.floor(bars.epochs[i] / 86400), win: p.win[k], retBps: 0 })), 500, cfg.seed + r);
        const c = classifyEdge({ n: N, wilson, breakeven, halves, pAdj: pAdj[r] });
        const winRateB = N ? p.winB.filter(Boolean).length / N : null;
        let verdict: HypVerdict = c.verdict === 'EDGE EM 1m' ? 'EDGE CANDIDATO' : c.verdict;
        let motivo = c.motivo;
        if (verdict === 'EDGE CANDIDATO' && winRateB !== null && winRateB <= breakeven) { verdict = 'INCONCLUSIVO'; motivo = 'variante B (1 vela depois) <= breakeven'; }
        return {
            id: p.id, horizon: p.h, n: N, wins, ties, winRate: N ? wins / N : 0, wilson, breakeven, halves, dayBootstrap, winRateB,
            pRaw: pRaw[r], pAdj: pAdj[r], verdict, motivo, callShare: N ? p.d.filter(d => d === 1).length / N : 0,
        };
    });

    const edge = rows.filter(r => r.verdict === 'EDGE CANDIDATO');
    const enough = rows.filter(r => r.n >= MIN_EVENTS).length;
    let conclusion: string;
    if (enough === 0) conclusion = 'DADOS INSUFICIENTES: nenhuma hipótese gerou eventos suficientes. Aumente os candles por ativo.';
    else if (edge.length) conclusion = `EDGE CANDIDATO em ${edge.length} linha(s): ${edge.map(e => `${e.id}@${e.horizon}m`).join(', ')}. Confirmar com dados novos (janela posterior) e piloto DEMO antes de qualquer execução.`;
    else if (rows.filter(r => r.n >= MIN_EVENTS).every(r => r.verdict === 'SEM EDGE')) conclusion = 'SEM EDGE: todas as hipóteses com amostra suficiente ficam abaixo do breakeven.';
    else conclusion = 'INCONCLUSIVO: nenhuma hipótese passa em todos os critérios. Não executar. Mais dados aumentam o poder estatístico.';
    return { ok: true, config: cfg, meta: { from: bars.epochs[0], to: bars.epochs[n - 1], days, candles: n }, rows, conclusion };
}

export function buildHorizonReport(r: HypReport): string {
    const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
    const L: string[] = ['[RELATÓRIO HIPÓTESES 15/30 MIN V18]', '='.repeat(50)];
    if (!r.ok) { L.push(r.conclusion); return L.join('\n'); }
    L.push(`PERÍODO: ${new Date(r.meta.from * 1000).toLocaleDateString()} a ${new Date(r.meta.to * 1000).toLocaleDateString()} (${r.meta.days.toFixed(1)} dias, ${r.meta.candles} velas alinhadas)`);
    L.push(`Payout ${r.config.payoutPct}% => breakeven ${pc(1 / (1 + r.config.payoutPct / 100))} | Holm sobre m=${r.rows.length} | sem LLM`, '', `>>> CONCLUSÃO: ${r.conclusion}`, '');
    for (const w of r.rows) {
        L.push(`[${w.id}] horizonte ${w.horizon}m | N=${w.n} (CALL ${pc(w.callShare)}) | acerto ${pc(w.winRate)} | Wilson95 [${pc(w.wilson[0])} - ${pc(w.wilson[1])}] | empates ${w.ties}`);
        L.push(`   metades ${w.halves[0] === null ? 'n/d' : pc(w.halves[0])} / ${w.halves[1] === null ? 'n/d' : pc(w.halves[1])} | bootstrap/dia ${w.dayBootstrap ? `[${pc(w.dayBootstrap[0])} - ${pc(w.dayBootstrap[1])}]` : 'n/d'} | variante B ${w.winRateB === null ? 'n/d' : pc(w.winRateB)} | placebo p=${w.pRaw.toFixed(4)} | Holm ${w.pAdj.toFixed(4)}`);
        L.push(`   => ${w.verdict} (${w.motivo})`);
    }
    L.push('', 'NOTAS E LIMITAÇÕES:',
        '* Regras pré-registradas (sem busca de parâmetros). Velas de 1 min; entrada no fechamento (A) ou 1 vela depois (B).',
        '* Empate conta como perda. Payout assumido. Só Rise/Fall; Higher/Lower, Touch e Accumulators não foram modelados.',
        `* Mínimo de ${MIN_EVENTS} eventos por linha e ${MIN_HALF_EVENTS} por metade. Edge exige Wilson inferior > breakeven, as duas metades > breakeven, Holm < 0,05 e variante B > breakeven.`);
    return L.join('\n');
}
