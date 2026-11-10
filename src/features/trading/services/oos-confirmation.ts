// src/features/trading/services/oos-confirmation.ts
'use client';

/**
 * @fileOverview ETAPA 19 — CONFIRMAÇÃO FORA DA AMOSTRA DA REGRA CONGELADA H3_ALTA @ 15 min.
 *
 * A regra (choque de alta do BTC em 5 min com z >= 2.5 => PUT na ETH por 15 min) foi o melhor de 14 testes na
 * janela de 13/10 a 09/11/2026 (N=225, acerto 62,2%, Wilson inferior 55,7%). Aquele resultado sofre de "efeito do
 * vencedor". Aqui a regra é testada UMA vez, SEM alterar nenhum parâmetro, em dados ANTERIORES (nunca vistos).
 *
 * Critérios definidos ANTES de rodar (m = 1 teste):
 *   CONFIRMADO     : N >= 100, Wilson inferior > breakeven, as duas metades > breakeven (>= 30 eventos cada),
 *                    placebo (deslocamento circular) p < 0.05 e variante B (entrada 1 vela depois) > breakeven.
 *   NÃO CONFIRMADO : acerto pontual < breakeven OU Wilson superior < breakeven.
 *   INCONCLUSIVO   : qualquer outro caso (ex.: amostra pequena).
 * Também reporta: taxa-base de PUT em 15 min no período (deriva), acerto por blocos de 15 dias e se o acerto de
 * referência (62,2%) cabe no IC fora da amostra.
 *
 * LIMITAÇÕES: velas de 1 min; payout assumido (use a sonda de payout); empate = perda; só Rise/Fall; a regra
 * continua sendo UMA de 14 candidatas — confirmar aqui reduz, mas não elimina, o risco de falso positivo.
 */

import type { CandleData } from '@/lib/types';
import { wilsonInterval, mulberry32, blockBootstrapDays } from './leadlag-backtest';
import { alignBars, computeSignals, DEFAULT_HYP_CONFIG } from './horizon-hypotheses';

/** Regra congelada (NÃO editar sem registrar nova hipótese). */
export const FROZEN_RULE = { id: 'H3_ALTA', horizon: 15, direction: 'PUT', config: DEFAULT_HYP_CONFIG } as const;
/** Referência da janela de descoberta (relatório V18). */
export const IN_SAMPLE_REF = { n: 225, winRate: 0.622, wilsonLower: 0.557, from: '13/10/2026', to: '09/11/2026' } as const;
/** 12/10/2026 00:00 UTC: >= 27 h antes da primeira vela da janela de descoberta (folga contra sobreposição). */
export const DEFAULT_CUTOFF_EPOCH = Date.UTC(2026, 9, 12, 0, 0, 0) / 1000;
export const MIN_OOS_EVENTS = 100;
export const MIN_OOS_HALF = 30;

export type OosVerdict = 'CONFIRMADO' | 'NÃO CONFIRMADO' | 'INCONCLUSIVO';

export interface OosReport {
    ok: boolean; reason?: string;
    meta: { from: number; to: number; days: number; candles: number; cutoffEpoch: number; candlesAfterCutoffDiscarded: number };
    payoutPct: number; breakeven: number;
    n: number; wins: number; ties: number; winRate: number; wilson: [number, number];
    halves: [number | null, number | null]; dayBootstrap: [number, number] | null;
    winRateB: number | null; pPlacebo: number; basePutRate: number;
    blocks: { from: number; to: number; n: number; winRate: number | null }[];
    refInside: boolean; verdict: OosVerdict; motivo: string; conclusion: string;
}

function failReport(reason: string, meta: Partial<OosReport['meta']>, payoutPct: number): OosReport {
    return {
        ok: false, reason, meta: { from: 0, to: 0, days: 0, candles: 0, cutoffEpoch: 0, candlesAfterCutoffDiscarded: 0, ...meta },
        payoutPct, breakeven: 1 / (1 + payoutPct / 100), n: 0, wins: 0, ties: 0, winRate: 0, wilson: [0, 1], halves: [null, null],
        dayBootstrap: null, winRateB: null, pPlacebo: 1, basePutRate: 0, blocks: [], refInside: false,
        verdict: 'INCONCLUSIVO', motivo: reason, conclusion: `DADOS INSUFICIENTES: ${reason}`,
    };
}

export function runOosConfirmation(
    btc: CandleData[], eth: CandleData[],
    opts: { cutoffEpoch?: number; payoutPct?: number; placeboReps?: number; seed?: number; blockDays?: number } = {}
): OosReport {
    const cutoff = opts.cutoffEpoch ?? DEFAULT_CUTOFF_EPOCH;
    const payoutPct = opts.payoutPct ?? 80;
    const reps = opts.placeboReps ?? 999, seed = opts.seed ?? 19, blockDays = opts.blockDays ?? 15;
    const H = FROZEN_RULE.horizon;
    const all = alignBars(btc, eth);
    const keep = all.epochs.filter(e => e < cutoff).length;
    const discarded = all.epochs.length - keep;
    const cut = <T,>(a: T[]) => a.slice(0, keep);
    const bars = {
        epochs: cut(all.epochs),
        o: { b: cut(all.o.b), e: cut(all.o.e) }, h: { b: cut(all.h.b), e: cut(all.h.e) },
        l: { b: cut(all.l.b), e: cut(all.l.e) }, c: { b: cut(all.c.b), e: cut(all.c.e) },
    };
    const n = bars.epochs.length;
    if (n < 3000) return failReport(`apenas ${n} velas anteriores ao corte (mínimo 3000). Baixe mais histórico (candles por ativo maior).`, { candles: n, cutoffEpoch: cutoff, candlesAfterCutoffDiscarded: discarded }, payoutPct);

    const { dir, warmup } = computeSignals(bars, FROZEN_RULE.config);
    const sig = dir[FROZEN_RULE.id];
    const le = bars.c.e.map(Math.log);
    const breakeven = 1 / (1 + payoutPct / 100);

    const t: number[] = [], win: boolean[] = [], tie: boolean[] = [], winB: boolean[] = [];
    let next = 0;
    for (let i = warmup; i < n - H - 1; i++) {
        const d = sig[i];
        if (!d || i < next) continue;
        const rA = (le[i + H] - le[i]) * d, rB = (le[i + 1 + H] - le[i + 1]) * d;
        t.push(i); win.push(rA > 0); tie.push(rA === 0); winB.push(rB > 0);
        next = i + H;
    }
    const N = t.length, wins = win.filter(Boolean).length, ties = tie.filter(Boolean).length;
    const wilson = wilsonInterval(wins, N);
    const mid = Math.floor(N / 2);
    const rate = (a: boolean[]) => (a.length >= MIN_OOS_HALF ? a.filter(Boolean).length / a.length : null);
    const halves: [number | null, number | null] = [rate(win.slice(0, mid)), rate(win.slice(mid))];
    const dayBootstrap = blockBootstrapDays(t.map((i, k) => ({ day: Math.floor(bars.epochs[i] / 86400), win: win[k], retBps: 0 })), 500, seed);
    const winRateB = N ? winB.filter(Boolean).length / N : null;
    const obs = N ? wins / N : 0;

    // placebo (um teste): mesmos instantes, direção PUT, retornos da ETH em instantes deslocados circularmente
    const rng = mulberry32(seed);
    const minShift = Math.min(1440, Math.floor(n * 0.1));
    let ge = 0, used = 0;
    for (let r = 0; r < reps && N > 0; r++) {
        const s = minShift + Math.floor(rng() * Math.max(1, n - 2 * minShift));
        let w = 0, c = 0;
        for (let k = 0; k < N; k++) {
            const j = (t[k] + s) % n;
            if (j + H >= n) continue;
            c++; if ((le[j + H] - le[j]) * -1 > 0) w++;
        }
        if (c > 0) { used++; if (w / c >= obs) ge++; }
    }
    const pPlacebo = N && used ? (ge + 1) / (used + 1) : 1;

    // taxa-base: fração de janelas de 15 min em que a ETH cai (deriva do período)
    let down = 0, tot = 0;
    for (let i = warmup; i < n - H; i++) { tot++; if (le[i + H] < le[i]) down++; }
    const basePutRate = tot ? down / tot : 0;

    // blocos cronológicos de `blockDays` dias
    const blocks: OosReport['blocks'] = [];
    if (N) {
        const span = blockDays * 86400, t0 = bars.epochs[t[0]];
        const byBlock = new Map<number, { w: number; n: number }>();
        t.forEach((i, k) => { const b = Math.floor((bars.epochs[i] - t0) / span); const x = byBlock.get(b) ?? { w: 0, n: 0 }; x.n++; if (win[k]) x.w++; byBlock.set(b, x); });
        Array.from(byBlock.keys()).sort((a, b) => a - b).forEach(b => {
            const x = byBlock.get(b)!;
            blocks.push({ from: t0 + b * span, to: t0 + (b + 1) * span, n: x.n, winRate: x.n >= 10 ? x.w / x.n : null });
        });
    }

    const refInside = IN_SAMPLE_REF.winRate >= wilson[0] && IN_SAMPLE_REF.winRate <= wilson[1];
    let verdict: OosVerdict, motivo: string;
    if (N < MIN_OOS_EVENTS) { verdict = 'INCONCLUSIVO'; motivo = `amostra insuficiente (N=${N} < ${MIN_OOS_EVENTS})`; }
    else if (obs < breakeven || wilson[1] < breakeven) { verdict = 'NÃO CONFIRMADO'; motivo = obs < breakeven ? 'acerto pontual abaixo do breakeven' : 'limite superior do Wilson abaixo do breakeven'; }
    else {
        const falhas: string[] = [];
        if (!(wilson[0] > breakeven)) falhas.push('limite inferior do Wilson <= breakeven');
        if (halves[0] === null || halves[1] === null) falhas.push('metade com poucos eventos');
        else if (!(halves[0] > breakeven && halves[1] > breakeven)) falhas.push('uma das metades <= breakeven');
        if (!(pPlacebo < 0.05)) falhas.push(`placebo p=${pPlacebo.toFixed(3)} >= 0.05`);
        if (winRateB === null || !(winRateB > breakeven)) falhas.push('variante B <= breakeven');
        if (falhas.length === 0) { verdict = 'CONFIRMADO'; motivo = 'todos os critérios pré-definidos atendidos'; }
        else { verdict = 'INCONCLUSIVO'; motivo = falhas.join('; '); }
    }
    const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
    const conclusion = verdict === 'CONFIRMADO'
        ? `CONFIRMADO fora da amostra: ${pc(obs)} em N=${N} (Wilson [${pc(wilson[0])} - ${pc(wilson[1])}]). Próximo passo: shadow à frente no tempo com a regra congelada. Ainda NÃO autoriza execução.`
        : verdict === 'NÃO CONFIRMADO'
            ? `NÃO CONFIRMADO: ${pc(obs)} em N=${N} (${motivo}). O resultado de 62,2% provavelmente foi efeito de seleção. Não executar.`
            : `INCONCLUSIVO: ${motivo}. Não executar; aumente o histórico ou aguarde mais dados.`;

    return {
        ok: true, meta: { from: bars.epochs[0], to: bars.epochs[n - 1], days: (bars.epochs[n - 1] - bars.epochs[0]) / 86400, candles: n, cutoffEpoch: cutoff, candlesAfterCutoffDiscarded: discarded },
        payoutPct, breakeven, n: N, wins, ties, winRate: obs, wilson, halves, dayBootstrap, winRateB, pPlacebo, basePutRate, blocks, refInside, verdict, motivo, conclusion,
    };
}

export function buildOosReport(r: OosReport): string {
    const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
    const d = (e: number) => new Date(e * 1000).toLocaleDateString();
    const L: string[] = ['[RELATÓRIO CONFIRMAÇÃO FORA DA AMOSTRA V19]', '='.repeat(50)];
    if (!r.ok) { L.push(r.conclusion); return L.join('\n'); }
    L.push(`REGRA CONGELADA: ${FROZEN_RULE.id} @ ${FROZEN_RULE.horizon}m (${FROZEN_RULE.direction}) | zShock=${FROZEN_RULE.config.zShock}, janela ${FROZEN_RULE.config.shockWin}m, sem alterações`);
    L.push(`DESCOBERTA (referência): ${IN_SAMPLE_REF.from} a ${IN_SAMPLE_REF.to} | N=${IN_SAMPLE_REF.n} | acerto ${pc(IN_SAMPLE_REF.winRate)} | Wilson inferior ${pc(IN_SAMPLE_REF.wilsonLower)}`);
    L.push(`FORA DA AMOSTRA: ${d(r.meta.from)} a ${d(r.meta.to)} (${r.meta.days.toFixed(1)} dias, ${r.meta.candles} velas) | corte em ${d(r.meta.cutoffEpoch)} | descartadas após o corte: ${r.meta.candlesAfterCutoffDiscarded}`);
    L.push(`Payout ${r.payoutPct}% => breakeven ${pc(r.breakeven)} | m=1 teste`, '', `>>> VEREDITO: ${r.verdict}`, `>>> ${r.conclusion}`, '');
    L.push(`- N=${r.n} (${(r.n / Math.max(1, r.meta.days)).toFixed(1)}/dia) | acerto ${pc(r.winRate)} | Wilson95 [${pc(r.wilson[0])} - ${pc(r.wilson[1])}] | empates ${r.ties}`);
    L.push(`- Metades: ${r.halves[0] === null ? 'n/d' : pc(r.halves[0])} / ${r.halves[1] === null ? 'n/d' : pc(r.halves[1])} | bootstrap/dia ${r.dayBootstrap ? `[${pc(r.dayBootstrap[0])} - ${pc(r.dayBootstrap[1])}]` : 'n/d'}`);
    L.push(`- Variante B (1 vela depois): ${r.winRateB === null ? 'n/d' : pc(r.winRateB)} | placebo p=${r.pPlacebo.toFixed(4)} | taxa-base de PUT 15m no período: ${pc(r.basePutRate)}`);
    L.push(`- Acerto de referência (${pc(IN_SAMPLE_REF.winRate)}) ${r.refInside ? 'CABE' : 'NÃO cabe'} no IC fora da amostra | encolhimento: ${((IN_SAMPLE_REF.winRate - r.winRate) * 100).toFixed(1)} pp`);
    L.push('- Blocos cronológicos: ' + (r.blocks.length ? r.blocks.map(b => `${d(b.from)}: N=${b.n} ${b.winRate === null ? 'n/d' : pc(b.winRate)}`).join(' | ') : 'n/d'));
    L.push(`- Motivo: ${r.motivo}`, '', 'NOTAS E LIMITAÇÕES:',
        '* Teste único, parâmetros congelados; critérios definidos antes de rodar. Velas de 1 min; payout assumido; empate = perda; só Rise/Fall.',
        '* A regra foi a melhor de 14 candidatas na descoberta. Confirmar aqui reduz o risco de falso positivo, não o elimina.',
        '* Confirmação NÃO autoriza execução: o próximo passo é shadow à frente no tempo; REAL continua bloqueado.');
    return L.join('\n');
}
