// src/features/trading/services/leadlag-backtest.ts
'use client';

/**
 * @fileOverview BACKTEST LEAD-LAG 1m (BTC -> alvo) V6.1
 *
 * - Reusa o código de produção: as métricas (correlação pré-evento, zBtc, zTarget) vêm de
 *   calculateBitcoinGravity e a decisão do SlingShot vem de evaluateSlingshot (paridade Live/Backtest).
 * - Tempo linear: janela móvel de LOOKBACK candles (nada de recalcular o histórico inteiro a cada candle).
 * - Estatística real: Wilson, placebo de deriva (retornos reais do alvo), bootstrap em blocos por dia,
 *   Holm sobre os horizontes testados e walk-forward (escolhe no treino, valida no teste).
 * - Determinístico: PRNG com semente (resultados reproduzíveis).
 *
 * LIMITAÇÕES (explícitas no relatório): resolução de 1 minuto (não enxerga lag de segundos);
 * entrada no fechamento do candle (variante A) ou 1 candle depois (variante B, pessimista);
 * payout assumido; sem custos de Multiplier; sem LLM.
 */

import type { CandleData } from '@/lib/types';
import { calculateBitcoinGravity, evaluateSlingshot, type CryptoAssetFeatures } from './crypto-gravity-engine';
import type { RuleCalibration } from '../types/council';

// ============================================================================
// TIPOS E CONSTANTES
// ============================================================================
export type Thresholds = { zBtc: number; zTargetMax: number; corrMin: number };
export type Verdict = 'SEM EDGE' | 'INCONCLUSIVO' | 'EDGE EM 1m';
export type Variant = 'A' | 'B';

export const HORIZONS = [1, 2, 3, 5] as const;
export const MIN_EVENTS = 30;
export const MIN_HALF_EVENTS = 10;
export const COOLDOWN_CANDLES = 6; // > maior horizonte + 1 (variante B): amostras independentes
export const LOOKBACK = 120;
export const CORR_WINDOW = 60;
export const STEP_SEC = 60;
export const DEFAULT_THRESHOLDS: Thresholds = { zBtc: 1.8, zTargetMax: 1.0, corrMin: 0.65 };

export const DEFAULT_GRID: Thresholds[] = (() => {
    const g: Thresholds[] = [];
    for (const zBtc of [1.5, 1.8, 2.2]) for (const zTargetMax of [0.7, 1.0]) for (const corrMin of [0.5, 0.65, 0.8]) g.push({ zBtc, zTargetMax, corrMin });
    return g;
})();

export interface AlignedSeries { epochs: number[]; btc: number[]; target: number[]; }
export interface RawPoint { i: number; epoch: number; corr: number; zBtc: number; zTarget: number; }

export interface LeadLagEvent {
    epoch: number;
    idx: number;
    direction: 'CALL' | 'PUT';
    metrics: { corr: number; zBtc: number; zTarget: number };
    outcomes: Record<number, boolean>;        // horizonte -> ganhou (variante A: entrada no fechamento de t)
    outcomesDelayed: Record<number, boolean>; // horizonte -> ganhou (variante B: entrada 1 candle depois)
    retBpsA: Record<number, number>;          // retorno na direção do sinal, em bps
    retBpsB: Record<number, number>;
}

export interface LeadLagRow {
    h: number;
    variant: Variant;
    n: number;
    rate: number;
    wilson: [number, number];
    breakeven80: number;
    breakeven85: number;
    pValPermutation: number;
    pValAdjusted: number;
    veredito: Verdict;
    motivo: string;
    halves: [number | null, number | null];
    bootstrapCI: [number, number] | null;
    meanRetBps: number;
    noLag: { n: number; rate: number | null };
}

export interface LeadLagReport {
    n: number;
    eventsPerDay: number;
    horizons: LeadLagRow[];
    params?: Thresholds;
    combosTested?: number;
    trainEvents?: number;
    trainRate?: number | null;
    payout?: number;
    periodFrom?: number;
    periodTo?: number;
    calibration?: RuleCalibration | null;
    notes?: string[];
}

export interface BacktestOptions {
    payout?: number;
    grid?: Thresholds[];
    reps?: number;
    seed?: number;
    symbols?: string[];
    onProgress?: (msg: string) => void;
    isCancelled?: () => boolean;
}

// ============================================================================
// ESTATÍSTICA
// ============================================================================
export function wilsonInterval(wins: number, n: number, z = 1.96): [number, number] {
    if (n <= 0) return [0, 1];
    const p = wins / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
    return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** Holm-Bonferroni (step-down). Retorna p ajustados na ordem original. */
export function holmAdjust(pvals: number[]): number[] {
    const m = pvals.length;
    const order = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
    const adj = new Array<number>(m).fill(1);
    let running = 0;
    order.forEach((o, rank) => {
        running = Math.max(running, Math.min(1, (m - rank) * o.p));
        adj[o.i] = running;
    });
    return adj;
}

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Placebo de deriva: mesmos N eventos, instantes sorteados do próprio período (com os retornos REAIS do alvo)
 * e mesma proporção CALL/PUT. Responde: "um timing aleatório, com esta mesma mistura de direções, faria igual?"
 */
export function placeboPValue(
    actualWins: number, n: number, callShare: number,
    pool: { callWin: boolean; putWin: boolean }[], reps: number, seed: number
): number {
    if (n <= 0 || pool.length === 0) return 1;
    const rng = mulberry32(seed);
    let count = 0;
    for (let r = 0; r < reps; r++) {
        let wins = 0;
        for (let k = 0; k < n; k++) {
            const p = pool[Math.floor(rng() * pool.length)];
            if (rng() < callShare ? p.callWin : p.putWin) wins++;
        }
        if (wins >= actualWins) count++;
    }
    return (count + 1) / (reps + 1);
}

/** Bootstrap em blocos (dias): reamostra DIAS com reposição, preservando a dependência intradiária. */
export function blockBootstrapDays(
    items: { day: number; win: boolean; retBps: number }[], reps: number, seed: number
): [number, number] | null {
    const byDay = new Map<number, { w: number; n: number }>();
    items.forEach(it => {
        const d = byDay.get(it.day) ?? { w: 0, n: 0 };
        d.n++; if (it.win) d.w++;
        byDay.set(it.day, d);
    });
    const days = Array.from(byDay.values());
    if (days.length < 5) return null;
    const rng = mulberry32(seed);
    const rates: number[] = [];
    for (let r = 0; r < reps; r++) {
        let w = 0, n = 0;
        for (let k = 0; k < days.length; k++) {
            const d = days[Math.floor(rng() * days.length)];
            w += d.w; n += d.n;
        }
        rates.push(n > 0 ? w / n : 0);
    }
    rates.sort((a, b) => a - b);
    return [rates[Math.floor(reps * 0.025)], rates[Math.min(reps - 1, Math.floor(reps * 0.975))]];
}

export function classifyEdge(p: {
    n: number; wilson: [number, number]; breakeven: number; halves: [number | null, number | null]; pAdj: number;
}): { verdict: Verdict; motivo: string } {
    if (p.n < MIN_EVENTS) return { verdict: 'INCONCLUSIVO', motivo: `amostra insuficiente (N=${p.n} < ${MIN_EVENTS})` };
    if (p.wilson[1] < p.breakeven) return { verdict: 'SEM EDGE', motivo: 'limite superior do Wilson abaixo do breakeven' };
    const falhas: string[] = [];
    if (!(p.wilson[0] > p.breakeven)) falhas.push('limite inferior do Wilson <= breakeven');
    const [h1, h2] = p.halves;
    if (h1 === null || h2 === null) falhas.push('metade do teste com poucos eventos');
    else if (!(h1 > p.breakeven && h2 > p.breakeven)) falhas.push('uma das metades do teste <= breakeven');
    if (!(p.pAdj < 0.05)) falhas.push(`p ajustado ${p.pAdj.toFixed(3)} >= 0.05`);
    if (falhas.length === 0) return { verdict: 'EDGE EM 1m', motivo: 'todos os critérios atendidos' };
    return { verdict: 'INCONCLUSIVO', motivo: falhas.join('; ') };
}

// ============================================================================
// SÉRIES E MÉTRICAS BRUTAS (produção)
// ============================================================================
export function alignByEpoch(btc: CandleData[], target: CandleData[]): AlignedSeries {
    const btcMap = new Map<number, number>();
    btc.forEach(c => btcMap.set(c.epoch, Number(c.close)));
    const sorted = [...target].sort((a, b) => a.epoch - b.epoch);
    const out: AlignedSeries = { epochs: [], btc: [], target: [] };
    sorted.forEach(c => {
        const b = btcMap.get(c.epoch);
        if (b !== undefined && Number.isFinite(b) && Number.isFinite(Number(c.close))) {
            out.epochs.push(c.epoch); out.btc.push(b); out.target.push(Number(c.close));
        }
    });
    return out;
}

const mkFeatures = (symbol: string, prices: number[], epochs: number[]): CryptoAssetFeatures => ({
    symbol, currentPrice: prices[prices.length - 1], priceHistory: prices, epochHistory: epochs,
    // Campos de indicador não influenciam correlação/z-scores/slingshot; valores neutros.
    rsi: 50, adx: 25, atrNow: 0, bbw: 1, volatilityRatio: 1, momentumShort: 0, momentumMedium: 0, atrRatio: 1,
});

/** Métricas no candle i usando SÓ candles <= i (todos fechados => dropForming=false). */
export function rawPointAt(s: AlignedSeries, i: number, lookback = LOOKBACK, window = CORR_WINDOW): RawPoint | null {
    if (i < lookback - 1 || i >= s.epochs.length) return null;
    const from = i - lookback + 1;
    const ep = s.epochs.slice(from, i + 1);
    const g = calculateBitcoinGravity(
        mkFeatures('BTC', s.btc.slice(from, i + 1), ep),
        mkFeatures('TARGET', s.target.slice(from, i + 1), ep),
        window, false
    );
    return { i, epoch: s.epochs[i], corr: g.correlation, zBtc: g.zBtc ?? 0, zTarget: g.zTarget ?? 0 };
}

export function computeRawMetricsSync(s: AlignedSeries, lookback = LOOKBACK, window = CORR_WINDOW): RawPoint[] {
    const out: RawPoint[] = [];
    for (let i = lookback - 1; i < s.epochs.length; i++) { const p = rawPointAt(s, i, lookback, window); if (p) out.push(p); }
    return out;
}

async function computeRawMetrics(s: AlignedSeries, opts: BacktestOptions): Promise<RawPoint[]> {
    const out: RawPoint[] = [];
    const total = s.epochs.length;
    for (let i = LOOKBACK - 1; i < total; i++) {
        const p = rawPointAt(s, i);
        if (p) out.push(p);
        if (i % 2000 === 0) {
            opts.onProgress?.(`Calculando métricas lead-lag: ${Math.round((i / total) * 100)}%`);
            await new Promise(r => setTimeout(r, 0)); // cede o loop de eventos (UI não trava)
            if (opts.isCancelled?.()) throw new Error('BACKTEST_CANCELADO');
        }
    }
    return out;
}

/** Retorno simples do alvo de (i+delay) até (i+delay+h); undefined se faltar candle ou houver lacuna de tempo. */
function forwardReturn(s: AlignedSeries, i: number, h: number, delay: number): number | undefined {
    const entry = i + delay, exit = entry + h;
    if (exit >= s.epochs.length) return undefined;
    if (s.epochs[entry] - s.epochs[i] !== STEP_SEC * delay) return undefined;
    if (s.epochs[exit] - s.epochs[entry] !== STEP_SEC * h) return undefined;
    return s.target[exit] / s.target[entry] - 1;
}

// ============================================================================
// EVENTOS
// ============================================================================
function selectEvents(
    s: AlignedSeries, raw: RawPoint[], th: Thresholds, from: number, to: number, requireLag = true
): LeadLagEvent[] {
    const events: LeadLagEvent[] = [];
    const last: Record<string, number> = { CALL: -1e9, PUT: -1e9 };
    for (const p of raw) {
        if (p.i < from || p.i >= to) continue;
        const ok = requireLag
            ? evaluateSlingshot({ correlation: p.corr, zBtc: p.zBtc, zTarget: p.zTarget }, th)
            : (p.corr >= th.corrMin && Math.abs(p.zBtc) >= th.zBtc);
        if (!ok || p.zBtc === 0) continue;
        const direction: 'CALL' | 'PUT' = p.zBtc > 0 ? 'CALL' : 'PUT';
        if (p.i - last[direction] < COOLDOWN_CANDLES) continue;
        last[direction] = p.i;
        const sign = direction === 'CALL' ? 1 : -1;
        const ev: LeadLagEvent = {
            epoch: p.epoch, idx: p.i, direction,
            metrics: { corr: p.corr, zBtc: p.zBtc, zTarget: p.zTarget },
            outcomes: {}, outcomesDelayed: {}, retBpsA: {}, retBpsB: {},
        };
        for (const h of HORIZONS) {
            const a = forwardReturn(s, p.i, h, 0);
            if (a !== undefined) { ev.outcomes[h] = sign * a > 0; ev.retBpsA[h] = sign * a * 1e4; }
            const b = forwardReturn(s, p.i, h, 1);
            if (b !== undefined) { ev.outcomesDelayed[h] = sign * b > 0; ev.retBpsB[h] = sign * b * 1e4; }
        }
        events.push(ev);
    }
    return events;
}

/** API de ponte (Etapa 16): eventos LEADLAG_SLINGSHOT reais de um histórico. */
export function getLeadLagEvents(btc: CandleData[], target: CandleData[], thresholds: Thresholds = DEFAULT_THRESHOLDS): LeadLagEvent[] {
    const s = alignByEpoch(btc, target);
    const raw = computeRawMetricsSync(s);
    return selectEvents(s, raw, thresholds, 0, s.epochs.length, true);
}

// ============================================================================
// RELATÓRIO
// ============================================================================
function evalRow(
    events: LeadLagEvent[], noLagEvents: LeadLagEvent[], s: AlignedSeries, mid: number,
    h: number, variant: Variant, payout: number, pool: { callWin: boolean; putWin: boolean }[],
    reps: number, seed: number
): Omit<LeadLagRow, 'pValAdjusted' | 'veredito' | 'motivo'> {
    const pick = (e: LeadLagEvent) => (variant === 'A' ? e.outcomes[h] : e.outcomesDelayed[h]);
    const ret = (e: LeadLagEvent) => (variant === 'A' ? e.retBpsA[h] : e.retBpsB[h]);
    const valid = events.filter(e => pick(e) !== undefined);
    const wins = valid.filter(e => pick(e) === true).length;
    const n = valid.length;
    const calls = valid.filter(e => e.direction === 'CALL').length;

    const half = (list: LeadLagEvent[]): number | null => (list.length >= MIN_HALF_EVENTS ? list.filter(e => pick(e)).length / list.length : null);
    const h1 = half(valid.filter(e => e.idx < mid));
    const h2 = half(valid.filter(e => e.idx >= mid));

    const nl = noLagEvents.filter(e => pick(e) !== undefined);
    const nlRate = nl.length > 0 ? nl.filter(e => pick(e)).length / nl.length : null;

    return {
        h, variant, n,
        rate: n > 0 ? wins / n : 0,
        wilson: wilsonInterval(wins, n),
        breakeven80: 1 / (1 + 0.80),
        breakeven85: 1 / (1 + 0.85),
        pValPermutation: placeboPValue(wins, n, n > 0 ? calls / n : 0.5, pool, reps, seed + h * 10 + (variant === 'A' ? 1 : 2)),
        halves: [h1, h2],
        bootstrapCI: blockBootstrapDays(valid.map(e => ({ day: Math.floor(e.epoch / 86400), win: pick(e) === true, retBps: ret(e) })), 2000, seed + 7 + h),
        meanRetBps: n > 0 ? valid.reduce((a, e) => a + ret(e), 0) / n : 0,
        noLag: { n: nl.length, rate: nlRate },
    };
}

export async function runLeadLagBacktest(btc: CandleData[], target: CandleData[], opts: BacktestOptions = {}): Promise<LeadLagReport> {
    const payout = opts.payout ?? 0.80;
    const grid = opts.grid ?? DEFAULT_GRID;
    const reps = opts.reps ?? 2000;
    const seed = opts.seed ?? 12345;
    const notes: string[] = [
        'Resolução: candles de 1 minuto (não enxerga lag de segundos).',
        'Variante A: entrada no fechamento do candle do sinal. Variante B: 1 candle depois (modela latência; pessimista).',
        `Payout assumido: ${(payout * 100).toFixed(0)}% => breakeven ${(100 / (1 + payout)).toFixed(1)}%. Sem custos de Multiplier. Sem LLM.`,
        'Controle: "sem filtro de atraso" = seguir o BTC sem exigir que o alvo esteja parado.',
        'Regras base (OPT_REV/OPT_MOM) ainda NÃO entram como referência neste relatório.',
    ];

    const s = alignByEpoch(btc, target);
    const n = s.epochs.length;
    const empty: LeadLagReport = { n: 0, eventsPerDay: 0, horizons: [], payout, calibration: null, notes: [...notes, 'DADOS INSUFICIENTES (<500 candles alinhados).'] };
    if (n < 500) return empty;

    opts.onProgress?.('Calculando métricas lead-lag...');
    const raw = await computeRawMetrics(s, opts);

    const split = Math.floor(n * 0.6);
    const maxH = Math.max(...HORIZONS) + 1;
    const trainRange: [number, number] = [LOOKBACK - 1, split];
    const testRange: [number, number] = [split, n - maxH - 1];

    // --- TREINO: escolhe (limiares, horizonte) pelo maior limite inferior do Wilson, variante A, N >= MIN_EVENTS
    let best: { th: Thresholds; h: number; lb: number; rate: number } | null = null;
    for (const th of grid) {
        const ev = selectEvents(s, raw, th, trainRange[0], trainRange[1], true);
        for (const h of HORIZONS) {
            const v = ev.filter(e => e.outcomes[h] !== undefined);
            if (v.length < MIN_EVENTS) continue;
            const w = v.filter(e => e.outcomes[h]).length;
            const lb = wilsonInterval(w, v.length)[0];
            if (!best || lb > best.lb) best = { th, h, lb, rate: w / v.length };
        }
    }
    const combosTested = grid.length * HORIZONS.length;
    const chosen: Thresholds = best?.th ?? DEFAULT_THRESHOLDS;
    if (!best) notes.push('Treino sem combinação com N>=30: nenhuma calibração gerada (limiares padrão usados só para exibição).');

    // --- TESTE (dados que a seleção nunca viu)
    const testEvents = selectEvents(s, raw, chosen, testRange[0], testRange[1], true);
    const noLagEvents = selectEvents(s, raw, chosen, testRange[0], testRange[1], false);
    const mid = Math.floor((testRange[0] + testRange[1]) / 2);

    const pools = new Map<string, { callWin: boolean; putWin: boolean }[]>();
    for (const h of HORIZONS) for (const v of ['A', 'B'] as Variant[]) {
        const pool: { callWin: boolean; putWin: boolean }[] = [];
        for (let i = testRange[0]; i < testRange[1]; i++) {
            const r = forwardReturn(s, i, h, v === 'A' ? 0 : 1);
            if (r !== undefined) pool.push({ callWin: r > 0, putWin: r < 0 });
        }
        pools.set(`${h}${v}`, pool);
    }

    const rows = HORIZONS.flatMap(h => (['A', 'B'] as Variant[]).map(v =>
        evalRow(testEvents, noLagEvents, s, mid, h, v, payout, pools.get(`${h}${v}`)!, reps, seed)));
    const adj = holmAdjust(rows.map(r => r.pValPermutation)); // m = 8 hipóteses reportadas no teste
    const finalRows: LeadLagRow[] = rows.map((r, k) => {
        const be = 1 / (1 + payout);
        const c = classifyEdge({ n: r.n, wilson: r.wilson, breakeven: be, halves: r.halves, pAdj: adj[k] });
        return { ...r, pValAdjusted: adj[k], veredito: c.verdict, motivo: c.motivo };
    });

    // --- CALIBRAÇÃO (só com treino válido)
    let calibration: RuleCalibration | null = null;
    let first: LeadLagRow | undefined;
    if (best) {
        const rowA = finalRows.find(r => r.h === best!.h && r.variant === 'A')!;
        const rowB = finalRows.find(r => r.h === best!.h && r.variant === 'B')!;
        let verdict: Verdict; let variant: Variant; let chosenRow: LeadLagRow;
        if (rowB.veredito === 'EDGE EM 1m') { verdict = 'EDGE EM 1m'; variant = 'B'; chosenRow = rowB; }
        else if (rowA.veredito === 'EDGE EM 1m') {
            verdict = 'INCONCLUSIVO'; variant = 'A'; chosenRow = rowA;
            notes.push('Edge só na variante A: não sobrevive à latência de 1 candle. Operar apenas em DEMO, medindo a latência real.');
        } else if (rowA.veredito === 'SEM EDGE') { verdict = 'SEM EDGE'; variant = 'A'; chosenRow = rowA; }
        else { verdict = 'INCONCLUSIVO'; variant = 'A'; chosenRow = rowA; }
        first = chosenRow;
        calibration = {
            zBtc: chosen.zBtc, zTargetMax: chosen.zTargetMax, corrMin: chosen.corrMin,
            horizon: best.h, variant, suggestedDuration: best.h * STEP_SEC, payoutAssumed: payout, verdict,
            trainWinRate: best.rate, testWinRate: chosenRow.rate, n: testEvents.length,
            periodFrom: s.epochs[0], periodTo: s.epochs[n - 1],
            symbols: opts.symbols ?? ['cryBTCUSD', 'cryETHUSD'], timestamp: new Date().toISOString(),
        };
    }

    const ordered = first ? [first, ...finalRows.filter(r => r !== first)] : finalRows;
    const days = Math.max(1, (testRange[1] - testRange[0]) / 1440);
    return {
        n: testEvents.length, eventsPerDay: testEvents.length / days, horizons: ordered,
        params: chosen, combosTested, trainEvents: best ? selectEvents(s, raw, chosen, trainRange[0], trainRange[1], true).length : 0,
        trainRate: best?.rate ?? null, payout, periodFrom: s.epochs[0], periodTo: s.epochs[n - 1], calibration, notes,
    };
}
