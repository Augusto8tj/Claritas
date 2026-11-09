// src/features/trading/services/leadlag-tick-study.ts
'use client';

/**
 * @fileOverview ETAPA 17 — EVENT STUDY COM TICKS (BTC -> ETH), grade de 1 segundo.
 *
 * Pergunta: quando o BTC dá um salto em poucos segundos, em quanto tempo a ETH responde, e essa
 * resposta ainda existe DEPOIS da latência real do sistema (análise + LLM + proposal + contrato)?
 *
 * Método (tudo causal, sem olhar o futuro para detectar o evento):
 *  - Ticks -> grade de 1 s com "último valor conhecido" (LOCF) e idade do último tick de cada série.
 *  - Evento: retorno do BTC em W s com |z| >= k, z medido contra o desvio-padrão dos retornos de W s
 *    da janela anterior (900 s). Cooldown > maior atraso + maior horizonte => eventos independentes.
 *  - Escopos: "all" (todo salto do BTC) e "quiet" (a ETH ainda não se mexeu: |z_ETH| <= quietZ).
 *  - Para cada atraso de entrada d (latência) e horizonte h do contrato: vitória = ETH sobe/desce na direção
 *    do salto do BTC entre t+d e t+d+h. EMPATE CONTA COMO NÃO-VITÓRIA (Rise/Fall perde no empate).
 *  - Estatística: Wilson, breakeven do payout, metades do período, bootstrap por dia, placebo por deslocamento
 *    circular da ETH (mantém tempos e direções dos eventos, quebra a relação com o BTC), Holm sobre TODAS as
 *    linhas testadas.
 *  - Curva de resposta média da ETH (bps, na direção do BTC) em 1..60 s, tempo de meia-resposta e fração da
 *    resposta que AINDA falta quando o sistema consegue entrar (latencySec).
 *
 * LIMITAÇÕES: ticks da Deriv têm resolução de 1 s (epoch inteiro) e a ETH pode ter ticks esparsos (LOCF gera
 * zeros e empates); preço de entrada/saída do contrato real é o próximo tick, não o da grade; payout assumido;
 * sem LLM; janela curta (dias) => baixo poder estatístico para edges pequenos.
 */

import { wilsonInterval, holmAdjust, mulberry32, blockBootstrapDays, classifyEdge, MIN_EVENTS, MIN_HALF_EVENTS } from './leadlag-backtest';

// ============================================================================
// TIPOS
// ============================================================================
export interface Tick { epoch: number; price: number; }
export type TickVerdict = 'SEM EDGE' | 'INCONCLUSIVO' | 'EDGE EM TICKS';
export type TickScope = 'all' | 'quiet';

export interface TickStudyConfig {
    windowSec: number;        // janela do salto do BTC
    k: number;                // |z| mínimo do salto
    quietZ: number;           // |z| máximo da ETH para o escopo "quiet"
    sigmaLookbackSec: number; // janela para o desvio-padrão
    maxStaleSec: number;      // idade máxima do último tick para aceitar um ponto
    delays: number[];         // atrasos de entrada (s)
    horizons: number[];       // horizontes do contrato (s)
    curveSecs: number[];      // pontos da curva de resposta
    payoutPct: number;
    latencySec: number;       // latência real assumida do sistema
    placeboReps: number;
    seed: number;
    cooldownSec: number;
    maxLag: number;           // perfil de correlação cruzada: -maxLag..+maxLag
}

export const DEFAULT_TICK_CONFIG: TickStudyConfig = {
    windowSec: 5, k: 3, quietZ: 0.7, sigmaLookbackSec: 900, maxStaleSec: 5,
    delays: [0, 2, 5, 10], horizons: [5, 15, 60], curveSecs: [1, 2, 3, 5, 10, 15, 30, 60],
    payoutPct: 80, latencySec: 4, placeboReps: 999, seed: 17, cooldownSec: 75, maxLag: 10,
};

export interface Grid { t0: number; prices: Float64Array; age: Int32Array; }

export interface TickRow {
    scope: TickScope; delaySec: number; horizonSec: number;
    n: number; wins: number; ties: number; winRate: number;
    wilson: [number, number]; breakeven: number;
    halves: [number | null, number | null];
    dayBootstrap: [number, number] | null;
    meanRetBps: number;
    pRaw: number; pAdj: number;
    verdict: TickVerdict; motivo: string;
}

export interface CurveSummary {
    secs: number[]; meanBps: (number | null)[]; seBps: (number | null)[];
    halfTimeSec: number | null; remainingAtLatency: number | null;
    preMoveBps: number | null; btcJumpBps: number | null; n: number;
}

export interface TickStudyReport {
    ok: boolean; reason?: string;
    config: TickStudyConfig;
    meta: { from: number; to: number; days: number; btcTicks: number; ethTicks: number; btcFreshPct: number; ethFreshPct: number };
    events: { all: number; quiet: number; perDay: number };
    curves: Record<TickScope, CurveSummary>;
    lagProfile: { lag: number; corr: number }[];
    peakLag: number | null;
    rows: TickRow[];
    conclusion: string;
}

// ============================================================================
// GRADE DE 1 s
// ============================================================================
export function toGrid(ticks: Tick[], t0: number, t1: number): Grid {
    const n = Math.max(0, t1 - t0 + 1);
    const prices = new Float64Array(n).fill(NaN);
    const fresh = new Uint8Array(n);
    let cur = NaN, a = 1e9;
    for (const tk of ticks) {
        if (tk.epoch < t0) { cur = tk.price; a = t0 - tk.epoch - 1; continue; }
        if (tk.epoch > t1) break;
        prices[tk.epoch - t0] = tk.price; fresh[tk.epoch - t0] = 1;
    }
    const age = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        if (fresh[i]) { cur = prices[i]; a = 0; } else if (a < 1e9) { a += 1; }
        prices[i] = cur; age[i] = a;
    }
    return { t0, prices, age };
}

function prepTicks(ticks: Tick[]): Tick[] {
    const t = ticks.filter(x => Number.isFinite(x.epoch) && Number.isFinite(x.price) && x.price > 0);
    for (let i = 1; i < t.length; i++) if (t[i].epoch < t[i - 1].epoch) { t.sort((a, b) => a.epoch - b.epoch); break; }
    return t;
}

// ============================================================================
// PAGINAÇÃO DE ticks_history (para trás a partir de `to`)
// ============================================================================
export type TickPageFetcher = (symbol: string, style: 'ticks', count: number, period?: undefined, endEpoch?: number) => Promise<{ epoch: number; price?: number }[]>;

export async function fetchTicksPaged(
    fetchPage: TickPageFetcher, symbol: string, fromEpoch: number, toEpoch: number,
    onProgress?: (msg: string) => void, opts: { pageSize?: number; maxPages?: number; pauseMs?: number } = {}
): Promise<Tick[]> {
    const pageSize = opts.pageSize ?? 5000, maxPages = opts.maxPages ?? 400, pauseMs = opts.pauseMs ?? 150;
    const seen = new Set<string>();
    let all: Tick[] = [];
    let end = toEpoch, prevMin = Infinity;
    for (let p = 0; p < maxPages; p++) {
        const page = await fetchPage(symbol, 'ticks', pageSize, undefined, end);
        const valid = page.filter(x => typeof x.price === 'number' && Number.isFinite(x.price)) as Tick[];
        if (valid.length === 0) break;
        const minEpoch = valid.reduce((m, v) => Math.min(m, v.epoch), valid[0].epoch);
        for (const v of valid) {
            const key = `${v.epoch}|${v.price}`;
            if (!seen.has(key)) { seen.add(key); all.push({ epoch: v.epoch, price: v.price }); }
        }
        onProgress?.(`Ticks ${symbol}: ${all.length} (até ${new Date(minEpoch * 1000).toLocaleString()})`);
        if (minEpoch <= fromEpoch) break;
        end = minEpoch >= prevMin ? minEpoch - 1 : minEpoch;
        prevMin = minEpoch;
        if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
    }
    all = all.filter(t => t.epoch >= fromEpoch && t.epoch <= toEpoch).sort((a, b) => a.epoch - b.epoch);
    return all;
}

// ============================================================================
// ESTUDO
// ============================================================================
interface Ev { t: number; dir: 1 | -1; quiet: boolean; }

function emptyCurve(cfg: TickStudyConfig): CurveSummary {
    return { secs: cfg.curveSecs, meanBps: cfg.curveSecs.map(() => null), seBps: cfg.curveSecs.map(() => null), halfTimeSec: null, remainingAtLatency: null, preMoveBps: null, btcJumpBps: null, n: 0 };
}

function failReport(cfg: TickStudyConfig, reason: string, meta?: Partial<TickStudyReport['meta']>): TickStudyReport {
    return {
        ok: false, reason, config: cfg,
        meta: { from: 0, to: 0, days: 0, btcTicks: 0, ethTicks: 0, btcFreshPct: 0, ethFreshPct: 0, ...meta },
        events: { all: 0, quiet: 0, perDay: 0 }, curves: { all: emptyCurve(cfg), quiet: emptyCurve(cfg) },
        lagProfile: [], peakLag: null, rows: [], conclusion: `DADOS INSUFICIENTES: ${reason}`,
    };
}

function interpCurve(secs: number[], vals: (number | null)[], s: number): number | null {
    let px = 0, py = 0;
    for (let i = 0; i < secs.length; i++) {
        const y = vals[i]; if (y === null) return null;
        if (s <= secs[i]) return secs[i] === px ? y : py + ((y - py) * (s - px)) / (secs[i] - px);
        px = secs[i]; py = y;
    }
    return py;
}

function summarizeCurve(grid: { E: Grid }, evs: Ev[], r5b: Float64Array, r5e: Float64Array, cfg: TickStudyConfig): CurveSummary {
    const out = emptyCurve(cfg);
    out.n = evs.length;
    if (evs.length === 0) return out;
    const E = grid.E;
    out.btcJumpBps = (evs.reduce((s, e) => s + e.dir * r5b[e.t], 0) / evs.length) * 1e4;
    out.preMoveBps = (evs.reduce((s, e) => s + e.dir * r5e[e.t], 0) / evs.length) * 1e4;
    cfg.curveSecs.forEach((s, ci) => {
        const xs: number[] = [];
        for (const e of evs) {
            const j = e.t + s;
            if (j >= E.prices.length || E.age[j] > cfg.maxStaleSec) continue;
            xs.push(e.dir * Math.log(E.prices[j] / E.prices[e.t]) * 1e4);
        }
        if (xs.length < 5) return;
        const m = xs.reduce((a, b) => a + b, 0) / xs.length;
        const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
        out.meanBps[ci] = m; out.seBps[ci] = Math.sqrt(v / xs.length);
    });
    const last = out.meanBps[out.meanBps.length - 1], lastSe = out.seBps[out.seBps.length - 1];
    if (last !== null && lastSe !== null && last > 0 && last / Math.max(lastSe, 1e-12) >= 2) {
        const half = last * 0.5;
        let px = 0, py = 0;
        for (let i = 0; i < cfg.curveSecs.length; i++) {
            const y = out.meanBps[i]; if (y === null) break;
            if (y >= half) { out.halfTimeSec = y === py ? cfg.curveSecs[i] : px + ((half - py) * (cfg.curveSecs[i] - px)) / (y - py); break; }
            px = cfg.curveSecs[i]; py = y;
        }
        const rL = interpCurve(cfg.curveSecs, out.meanBps, cfg.latencySec);
        if (rL !== null) out.remainingAtLatency = Math.min(1, Math.max(0, 1 - rL / last));
    }
    return out;
}

export function runTickStudy(btcTicksIn: Tick[], ethTicksIn: Tick[], overrides: Partial<TickStudyConfig> = {}): TickStudyReport {
    const cfg: TickStudyConfig = { ...DEFAULT_TICK_CONFIG, ...overrides };
    const btcT = prepTicks(btcTicksIn), ethT = prepTicks(ethTicksIn);
    if (btcT.length < 100 || ethT.length < 100) return failReport(cfg, 'poucos ticks baixados', { btcTicks: btcT.length, ethTicks: ethT.length });

    const t0 = Math.max(btcT[0].epoch, ethT[0].epoch), t1 = Math.min(btcT[btcT.length - 1].epoch, ethT[ethT.length - 1].epoch);
    const W = cfg.windowSec, L = cfg.sigmaLookbackSec;
    const maxD = Math.max(...cfg.delays), maxH = Math.max(...cfg.horizons), maxC = Math.max(...cfg.curveSecs);
    const tail = Math.max(maxD + maxH, maxC);
    const n = t1 - t0 + 1;
    if (n < 2 * W + L + tail + 100) return failReport(cfg, 'janela de tempo comum curta demais', { btcTicks: btcT.length, ethTicks: ethT.length });

    const B = toGrid(btcT, t0, t1), E = toGrid(ethT, t0, t1);
    const freshPct = (g: Grid) => { let c = 0; for (let i = 0; i < n; i++) if (g.age[i] === 0) c++; return (100 * c) / n; };

    // retornos de W s e variância móvel (soma de quadrados dos retornos de W s que terminam ANTES da janela atual)
    const r5b = new Float64Array(n), r5e = new Float64Array(n);
    const q5b = new Float64Array(n + 1), q5e = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
        if (i >= W) { r5b[i] = Math.log(B.prices[i] / B.prices[i - W]); r5e[i] = Math.log(E.prices[i] / E.prices[i - W]); }
        q5b[i + 1] = q5b[i] + r5b[i] * r5b[i]; q5e[i + 1] = q5e[i] + r5e[i] * r5e[i];
    }
    const sigma = (q: Float64Array, t: number) => { // índices (t-W-L+1 .. t-W)
        const a = t - W - L + 1, b = t - W; if (a < 0) return 0;
        return Math.sqrt((q[b + 1] - q[a]) / L);
    };

    // detecção de eventos (causal)
    const evs: Ev[] = [];
    let nextAllowed = 0;
    const startI = 2 * W + L;
    for (let t = startI; t < n - tail; t++) {
        if (t < nextAllowed) continue;
        if (B.age[t] > cfg.maxStaleSec || B.age[t - W] > cfg.maxStaleSec || E.age[t] > cfg.maxStaleSec || E.age[t - W] > cfg.maxStaleSec) continue;
        const sb = sigma(q5b, t); if (!(sb > 0)) continue;
        const z = r5b[t] / sb;
        if (Math.abs(z) < cfg.k) continue;
        const se = sigma(q5e, t);
        const quiet = se > 0 ? Math.abs(r5e[t]) / se <= cfg.quietZ : false;
        evs.push({ t, dir: z > 0 ? 1 : -1, quiet });
        nextAllowed = t + cfg.cooldownSec;
    }
    const evQuiet = evs.filter(e => e.quiet);
    const days = (t1 - t0) / 86400;

    const scopes: { scope: TickScope; evs: Ev[] }[] = [{ scope: 'all', evs }, { scope: 'quiet', evs: evQuiet }];
    const breakeven = 1 / (1 + cfg.payoutPct / 100);

    // avaliação de uma (evento, d, h) numa série E (com deslocamento opcional para o placebo)
    const evalAt = (e: Ev, d: number, h: number, shift: number): { win: boolean; tie: boolean; retBps: number } | null => {
        const i0 = e.t + d + shift, i1 = i0 + h;
        if (i1 >= n) return null;
        if (E.age[i0] > cfg.maxStaleSec || E.age[i1] > cfg.maxStaleSec) return null;
        const r = Math.log(E.prices[i1] / E.prices[i0]) * e.dir;
        return { win: r > 0, tie: r === 0, retBps: r * 1e4 };
    };

    // linhas observadas
    type Pre = { scope: TickScope; d: number; h: number; evs: Ev[]; res: { t: number; win: boolean; tie: boolean; retBps: number }[] };
    const pre: Pre[] = [];
    for (const sc of scopes) for (const d of cfg.delays) for (const h of cfg.horizons) {
        const res: Pre['res'] = [];
        for (const e of sc.evs) { const r = evalAt(e, d, h, 0); if (r) res.push({ t: e.t, ...r }); }
        pre.push({ scope: sc.scope, d, h, evs: sc.evs, res });
    }

    // placebo: desloca a ETH circularmente (tempos e direções dos eventos preservados)
    const nRows = pre.length;
    const obsRate = pre.map(p => (p.res.length ? p.res.filter(r => r.win).length / p.res.length : 0));
    const ge = new Array<number>(nRows).fill(0), used = new Array<number>(nRows).fill(0);
    const rng = mulberry32(cfg.seed);
    const rowIndex = new Map<string, number>();
    pre.forEach((p, i) => rowIndex.set(`${p.scope}|${p.d}|${p.h}`, i));
    const minOff = Math.min(3600, Math.floor(n * 0.2));
    for (let rep = 0; rep < cfg.placeboReps; rep++) {
        const off = minOff + Math.floor(rng() * Math.max(1, n - 2 * minOff));
        const wins = new Array<number>(nRows).fill(0), cnt = new Array<number>(nRows).fill(0);
        for (const e of evs) {
            for (const d of cfg.delays) for (const h of cfg.horizons) {
                const i0 = (e.t + d + off) % n, i1 = i0 + h;
                if (i1 >= n || E.age[i0] > cfg.maxStaleSec || E.age[i1] > cfg.maxStaleSec) continue;
                const win = Math.log(E.prices[i1] / E.prices[i0]) * e.dir > 0;
                const ia = rowIndex.get(`all|${d}|${h}`)!;
                cnt[ia]++; if (win) wins[ia]++;
                if (e.quiet) { const iq = rowIndex.get(`quiet|${d}|${h}`)!; cnt[iq]++; if (win) wins[iq]++; }
            }
        }
        for (let r = 0; r < nRows; r++) { if (cnt[r] === 0) continue; used[r]++; if (wins[r] / cnt[r] >= obsRate[r]) ge[r]++; }
    }
    const pRaw = pre.map((p, r) => (p.res.length === 0 || used[r] === 0 ? 1 : (ge[r] + 1) / (used[r] + 1)));
    const pAdj = holmAdjust(pRaw);

    const rows: TickRow[] = pre.map((p, r) => {
        const N = p.res.length, wins = p.res.filter(x => x.win).length, ties = p.res.filter(x => x.tie).length;
        const wilson = wilsonInterval(wins, N);
        const mid = Math.floor(N / 2);
        const rate = (arr: typeof p.res) => (arr.length >= MIN_HALF_EVENTS ? arr.filter(x => x.win).length / arr.length : null);
        const halves: [number | null, number | null] = [rate(p.res.slice(0, mid)), rate(p.res.slice(mid))];
        const dayBootstrap = blockBootstrapDays(p.res.map(x => ({ day: Math.floor((t0 + x.t) / 86400), win: x.win, retBps: x.retBps })), 500, cfg.seed + r);
        const meanRetBps = N ? p.res.reduce((a, x) => a + x.retBps, 0) / N : 0;
        const c = classifyEdge({ n: N, wilson, breakeven, halves, pAdj: pAdj[r] });
        return {
            scope: p.scope, delaySec: p.d, horizonSec: p.h, n: N, wins, ties, winRate: N ? wins / N : 0,
            wilson, breakeven, halves, dayBootstrap, meanRetBps, pRaw: pRaw[r], pAdj: pAdj[r],
            verdict: c.verdict === 'EDGE EM 1m' ? 'EDGE EM TICKS' : c.verdict, motivo: c.motivo,
        };
    });

    // curvas de resposta
    const curves: Record<TickScope, CurveSummary> = {
        all: summarizeCurve({ E }, evs, r5b, r5e, cfg),
        quiet: summarizeCurve({ E }, evQuiet, r5b, r5e, cfg),
    };

    // perfil de correlação cruzada (lag>0 = ETH atrasada em relação ao BTC), retornos de 1 s
    const r1b = new Float64Array(n), r1e = new Float64Array(n);
    for (let i = 1; i < n; i++) { r1b[i] = Math.log(B.prices[i] / B.prices[i - 1]); r1e[i] = Math.log(E.prices[i] / E.prices[i - 1]); }
    const lagProfile: { lag: number; corr: number }[] = [];
    for (let lag = -cfg.maxLag; lag <= cfg.maxLag; lag++) {
        let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, m = 0;
        for (let i = Math.max(1, -lag + 1); i < Math.min(n, n - lag); i++) {
            const x = r1b[i], y = r1e[i + lag];
            sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; m++;
        }
        const den = Math.sqrt((sxx - (sx * sx) / m) * (syy - (sy * sy) / m));
        lagProfile.push({ lag, corr: m > 2 && den > 0 ? (sxy - (sx * sy) / m) / den : 0 });
    }
    const peak = lagProfile.reduce((a, b) => (b.corr > a.corr ? b : a), lagProfile[0]);

    // conclusão
    const edgeRows = rows.filter(r => r.verdict === 'EDGE EM TICKS');
    const reachable = edgeRows.filter(r => r.delaySec >= cfg.latencySec);
    let conclusion: string;
    if (evs.length < 100) conclusion = `DADOS INSUFICIENTES: apenas ${evs.length} eventos independentes (mínimo recomendado: 100). Aumente a janela de dias.`;
    else if (reachable.length > 0) conclusion = `EDGE CANDIDATO ALCANÇÁVEL: ${reachable.length} linha(s) com atraso >= ${cfg.latencySec}s passam em todos os critérios. Confirmar em dados fora da amostra antes de qualquer execução.`;
    else if (edgeRows.length > 0) conclusion = `EDGE EXISTE SÓ COM ATRASO < ${cfg.latencySec}s: não é alcançável com a latência assumida do sistema (análise + LLM + contrato).`;
    else if (rows.filter(r => r.delaySec >= cfg.latencySec).every(r => r.verdict === 'SEM EDGE')) conclusion = `SEM EDGE: com atraso >= ${cfg.latencySec}s todas as linhas ficam abaixo do breakeven. A tese lead-lag Rise/Fall está refutada nesta amostra.`;
    else conclusion = 'INCONCLUSIVO: nenhuma linha passa em todos os critérios e nem todas ficam abaixo do breakeven. Mais dias de dados aumentam o poder estatístico.';

    return {
        ok: true, config: cfg,
        meta: { from: t0, to: t1, days, btcTicks: btcT.length, ethTicks: ethT.length, btcFreshPct: freshPct(B), ethFreshPct: freshPct(E) },
        events: { all: evs.length, quiet: evQuiet.length, perDay: days > 0 ? evs.length / days : 0 },
        curves, lagProfile, peakLag: peak ? peak.lag : null, rows, conclusion,
    };
}

// ============================================================================
// RELATÓRIO EM TEXTO
// ============================================================================
export function buildTickStudyReport(r: TickStudyReport): string {
    const f = (x: number | null, d = 1) => (x === null ? 'n/d' : x.toFixed(d));
    const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
    const L: string[] = [];
    L.push('[RELATÓRIO EVENT STUDY COM TICKS V17]', '='.repeat(50));
    if (!r.ok) { L.push(r.conclusion); return L.join('\n'); }
    const c = r.config;
    L.push(`PERÍODO: ${new Date(r.meta.from * 1000).toLocaleString()} a ${new Date(r.meta.to * 1000).toLocaleString()} (${r.meta.days.toFixed(2)} dias)`);
    L.push(`TICKS: BTC ${r.meta.btcTicks} (${r.meta.btcFreshPct.toFixed(0)}% dos segundos com tick) | ETH ${r.meta.ethTicks} (${r.meta.ethFreshPct.toFixed(0)}%)`);
    L.push(`EVENTOS (saltos do BTC |z|>=${c.k} em ${c.windowSec}s, cooldown ${c.cooldownSec}s): ${r.events.all} (${r.events.perDay.toFixed(1)}/dia) | com ETH parada: ${r.events.quiet}`);
    L.push(`LATÊNCIA ASSUMIDA DO SISTEMA: ${c.latencySec}s | payout ${c.payoutPct}% => breakeven ${pc(1 / (1 + c.payoutPct / 100))}`);
    L.push('', `>>> CONCLUSÃO: ${r.conclusion}`, '');
    for (const sc of ['all', 'quiet'] as TickScope[]) {
        const cu = r.curves[sc];
        L.push(`>>> CURVA DE RESPOSTA DA ETH (escopo ${sc === 'all' ? 'todos os saltos' : 'ETH parada'}, N=${cu.n})`);
        L.push(`- Salto médio do BTC: ${f(cu.btcJumpBps)} bps | ETH já se moveu na janela: ${f(cu.preMoveBps)} bps`);
        L.push('- Resposta média (bps, direção do BTC) por segundo após o evento: ' + cu.secs.map((s, i) => `${s}s=${f(cu.meanBps[i])}`).join(' | '));
        L.push(`- Tempo de meia-resposta: ${cu.halfTimeSec === null ? 'sem resposta mensurável' : cu.halfTimeSec.toFixed(1) + 's'} | resposta que ainda falta após ${c.latencySec}s: ${cu.remainingAtLatency === null ? 'n/d' : pc(cu.remainingAtLatency)}`);
        L.push('');
    }
    L.push(`>>> CORRELAÇÃO CRUZADA 1s (lag>0 = ETH atrasada): pico em lag=${r.peakLag}s`);
    L.push(r.lagProfile.map(p => `${p.lag}:${p.corr.toFixed(3)}`).join(' '), '');
    L.push(`>>> LINHAS (atraso de entrada x horizonte) — Holm sobre m=${r.rows.length}`, '-'.repeat(50));
    for (const row of r.rows) {
        L.push(`[${row.scope}] atraso ${row.delaySec}s | horizonte ${row.horizonSec}s | N=${row.n} | acerto ${pc(row.winRate)} | Wilson95 [${pc(row.wilson[0])} - ${pc(row.wilson[1])}] | empates ${row.ties}`);
        L.push(`   metades ${row.halves[0] === null ? 'n/d' : pc(row.halves[0])} / ${row.halves[1] === null ? 'n/d' : pc(row.halves[1])} | bootstrap/dia ${row.dayBootstrap ? `[${pc(row.dayBootstrap[0])} - ${pc(row.dayBootstrap[1])}]` : 'n/d (poucos dias)'} | ret médio ${row.meanRetBps.toFixed(2)} bps | placebo p=${row.pRaw.toFixed(4)} | Holm ${row.pAdj.toFixed(4)}`);
        L.push(`   => ${row.verdict} (${row.motivo})`);
    }
    L.push('', 'NOTAS E LIMITAÇÕES:',
        '* Grade de 1 s com último valor conhecido; ticks esparsos geram empates (contam como não-vitória).',
        '* Entrada/saída reais do contrato usam o próximo tick, não a grade. Payout assumido. Sem custos de Multiplier. Sem LLM.',
        `* Mínimo de ${MIN_EVENTS} eventos por linha e ${MIN_HALF_EVENTS} por metade; poucos dias de dados dão baixo poder estatístico.`,
        '* Edge só é reportado se: Wilson inferior > breakeven, as duas metades > breakeven e p ajustado (Holm) < 0,05.');
    return L.join('\n');
}
