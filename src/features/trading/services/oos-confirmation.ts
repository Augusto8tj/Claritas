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
 * Validade dos dados (ETAPA 20, vale para qualquer fonte): eventos cuja janela cruza buraco de tempo são descartados; se as velas
 * trazem volume (CSV da Binance), exige-se negócio real (volume > 0) no sinal do BTC e nas velas de entrada/saída da ETH e que
 * no máximo 50% das últimas 120 velas de cada ativo sejam planas — senão o "choque" é artefato de mercado parado, não de preço.
 * Sem volume (Deriv) esses filtros de liquidez não se aplicam.
 *
 * LIMITAÇÕES: velas de 1 min; payout assumido (use a sonda de payout); empate = perda; só Rise/Fall; a regra
 * continua sendo UMA de 14 candidatas — confirmar aqui reduz, mas não elimina, o risco de falso positivo.
 */

import type { CandleData } from '@/lib/types';
import { wilsonInterval, mulberry32, blockBootstrapDays } from './leadlag-backtest';
import { alignBars, computeSignals, DEFAULT_HYP_CONFIG } from './horizon-hypotheses';
import { bootstrapMeanByDay } from './multiplier-economics';

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
    meta: { from: number; to: number; days: number; candles: number; cutoffEpoch: number; candlesAfterCutoffDiscarded: number; source: string };
    filters: { gapDropped: number; liquidityDropped: number; liquidityFilterActive: boolean };
    payoutPct: number; breakeven: number;
    n: number; wins: number; ties: number; winRate: number; wilson: [number, number];
    halves: [number | null, number | null]; dayBootstrap: [number, number] | null;
    winRateB: number | null; pPlacebo: number; basePutRate: number;
    blocks: { from: number; to: number; n: number; winRate: number | null }[];
    events: { day: number; retBps: number; maeBps: number }[];
    grossMeanBps: number; grossCiBps: [number, number] | null; pPlaceboMean: number;
    refInside: boolean; verdict: OosVerdict; motivo: string; conclusion: string;
}

function failReport(reason: string, meta: Partial<OosReport['meta']>, payoutPct: number): OosReport {
    return {
        ok: false, reason, meta: { from: 0, to: 0, days: 0, candles: 0, cutoffEpoch: 0, candlesAfterCutoffDiscarded: 0, source: 'n/d', ...meta },
        filters: { gapDropped: 0, liquidityDropped: 0, liquidityFilterActive: false },
        payoutPct, breakeven: 1 / (1 + payoutPct / 100), n: 0, wins: 0, ties: 0, winRate: 0, wilson: [0, 1], halves: [null, null],
        dayBootstrap: null, winRateB: null, pPlacebo: 1, basePutRate: 0, blocks: [], events: [], grossMeanBps: 0, grossCiBps: null, pPlaceboMean: 1, refInside: false,
        verdict: 'INCONCLUSIVO', motivo: reason, conclusion: `DADOS INSUFICIENTES: ${reason}`,
    };
}

export function runOosConfirmation(
    btc: CandleData[], eth: CandleData[],
    opts: { cutoffEpoch?: number; payoutPct?: number; placeboReps?: number; seed?: number; blockDays?: number; source?: string } = {}
): OosReport {
    const cutoff = opts.cutoffEpoch ?? DEFAULT_CUTOFF_EPOCH;
    const payoutPct = opts.payoutPct ?? 80;
    const reps = opts.placeboReps ?? 999, seed = opts.seed ?? 19, blockDays = opts.blockDays ?? 15;
    const source = opts.source ?? 'Deriv (API)';
    const H = FROZEN_RULE.horizon;
    const all = alignBars(btc, eth);
    const keep = all.epochs.filter(e => e < cutoff).length;
    const discarded = all.epochs.length - keep;
    const cut = <T,>(a: T[]) => a.slice(0, keep);
    const bars = {
        epochs: cut(all.epochs), v: { b: cut(all.v.b), e: cut(all.v.e) },
        o: { b: cut(all.o.b), e: cut(all.o.e) }, h: { b: cut(all.h.b), e: cut(all.h.e) },
        l: { b: cut(all.l.b), e: cut(all.l.e) }, c: { b: cut(all.c.b), e: cut(all.c.e) },
    };
    const n = bars.epochs.length;
    if (n < 3000) return failReport(`apenas ${n} velas anteriores ao corte (mínimo 3000). Baixe mais histórico (candles por ativo maior).`, { candles: n, cutoffEpoch: cutoff, candlesAfterCutoffDiscarded: discarded, source }, payoutPct);

    const { dir, warmup } = computeSignals(bars, FROZEN_RULE.config);
    const sig = dir[FROZEN_RULE.id];
    const le = bars.c.e.map(Math.log);
    const breakeven = 1 / (1 + payoutPct / 100);

    // validade dos dados: buracos de tempo e liquidez (ver cabeçalho)
    const gc = new Int32Array(n);
    for (let i = 1; i < n; i++) gc[i] = gc[i - 1] + (bars.epochs[i] - bars.epochs[i - 1] !== 60 ? 1 : 0);
    const hasVol = bars.v.b.some(x => Number.isFinite(x)) && bars.v.e.some(x => Number.isFinite(x));
    const flatB = new Int32Array(n + 1), flatE = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
        flatB[i + 1] = flatB[i] + (bars.o.b[i] === bars.h.b[i] && bars.h.b[i] === bars.l.b[i] && bars.l.b[i] === bars.c.b[i] ? 1 : 0);
        flatE[i + 1] = flatE[i] + (bars.o.e[i] === bars.h.e[i] && bars.h.e[i] === bars.l.e[i] && bars.l.e[i] === bars.c.e[i] ? 1 : 0);
    }
    const LB = FROZEN_RULE.config.sigmaWin + FROZEN_RULE.config.shockWin + 2;
    const noGap = (a: number, b: number) => a >= 0 && b < n && gc[a] === gc[b];
    const traded = (i: number) => !hasVol || (bars.v.e[i] > 0);
    const activeMarket = (i: number) => {
        if (!hasVol) return true;
        const a = Math.max(0, i - FROZEN_RULE.config.sigmaWin + 1), len = i - a + 1;
        return (flatB[i + 1] - flatB[a]) / len <= 0.5 && (flatE[i + 1] - flatE[a]) / len <= 0.5;
    };
    const liquidAt = (i: number) => !hasVol || (bars.v.b[i] > 0 && bars.v.e[i] > 0 && traded(i + H) && activeMarket(i));

    const t: number[] = [], win: boolean[] = [], tie: boolean[] = [], winB: boolean[] = [];
    const retBpsArr: number[] = [], maeArr: number[] = [];
    let next = 0, gapDropped = 0, liquidityDropped = 0;
    for (let i = warmup; i < n - H - 1; i++) {
        const d = sig[i];
        if (!d || i < next) continue;
        if (!noGap(i - LB, i + H + 1)) { gapDropped++; continue; }
        if (!liquidAt(i)) { liquidityDropped++; continue; }
        const rA = (le[i + H] - le[i]) * d, rB = (le[i + 1 + H] - le[i + 1]) * d;
        t.push(i); win.push(rA > 0); tie.push(rA === 0); winB.push(rB > 0);
        retBpsArr.push(rA * 1e4);
        let adv = 0; // excursão adversária máxima (máx/mín intravela) durante os H minutos, em bps do ativo
        for (let j = i + 1; j <= i + H; j++) {
            const a = d === -1 ? Math.log(bars.h.e[j] / bars.c.e[i]) : Math.log(bars.c.e[i] / bars.l.e[j]);
            if (a > adv) adv = a;
        }
        maeArr.push(adv * 1e4);
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
    const obsMean = N ? retBpsArr.reduce((a, b) => a + b, 0) / N : 0;
    let ge = 0, used = 0, geMean = 0;
    for (let r = 0; r < reps && N > 0; r++) {
        const s = minShift + Math.floor(rng() * Math.max(1, n - 2 * minShift));
        let w = 0, c = 0, rs = 0;
        for (let k = 0; k < N; k++) {
            const j = (t[k] + s) % n;
            if (j + H >= n) continue;
            c++; rs += (le[j + H] - le[j]) * -1e4; if ((le[j + H] - le[j]) * -1 > 0) w++;
        }
        if (c > 0) { used++; if (w / c >= obs) ge++; if (rs / c >= obsMean) geMean++; }
    }
    const pPlacebo = N && used ? (ge + 1) / (used + 1) : 1;
    const pPlaceboMean = N && used ? (geMean + 1) / (used + 1) : 1;
    const events = t.map((i, k) => ({ day: Math.floor(bars.epochs[i] / 86400), retBps: retBpsArr[k], maeBps: maeArr[k] }));
    const grossCiBps = bootstrapMeanByDay(events.map(e => ({ day: e.day, x: e.retBps })), 1000, seed);

    // taxa-base: fração de janelas de 15 min em que a ETH cai (deriva do período)
    let down = 0, tot = 0;
    for (let i = warmup; i < n - H; i++) { if (!noGap(i, i + H) || (hasVol && !(traded(i) && traded(i + H)))) continue; tot++; if (le[i + H] < le[i]) down++; }
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
        ok: true, meta: { from: bars.epochs[0], to: bars.epochs[n - 1], days: (bars.epochs[n - 1] - bars.epochs[0]) / 86400, candles: n, cutoffEpoch: cutoff, candlesAfterCutoffDiscarded: discarded, source },
        filters: { gapDropped, liquidityDropped, liquidityFilterActive: hasVol },
        payoutPct, breakeven, n: N, wins, ties, winRate: obs, wilson, halves, dayBootstrap, winRateB, pPlacebo, basePutRate, blocks, events, grossMeanBps: obsMean, grossCiBps, pPlaceboMean, refInside, verdict, motivo, conclusion,
    };
}

export function buildOosReport(r: OosReport): string {
    const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
    const d = (e: number) => new Date(e * 1000).toLocaleDateString();
    const L: string[] = ['[RELATÓRIO CONFIRMAÇÃO FORA DA AMOSTRA V19]', '='.repeat(50)];
    if (!r.ok) { L.push(r.conclusion); return L.join('\n'); }
    L.push(`REGRA CONGELADA: ${FROZEN_RULE.id} @ ${FROZEN_RULE.horizon}m (${FROZEN_RULE.direction}) | zShock=${FROZEN_RULE.config.zShock}, janela ${FROZEN_RULE.config.shockWin}m, sem alterações`);
    L.push(`DESCOBERTA (referência): ${IN_SAMPLE_REF.from} a ${IN_SAMPLE_REF.to} | N=${IN_SAMPLE_REF.n} | acerto ${pc(IN_SAMPLE_REF.winRate)} | Wilson inferior ${pc(IN_SAMPLE_REF.wilsonLower)}`);
    L.push(`FONTE DOS DADOS: ${r.meta.source}`);
    L.push(`FORA DA AMOSTRA: ${d(r.meta.from)} a ${d(r.meta.to)} (${r.meta.days.toFixed(1)} dias, ${r.meta.candles} velas) | corte em ${d(r.meta.cutoffEpoch)} | descartadas após o corte: ${r.meta.candlesAfterCutoffDiscarded}`);
    L.push(`Payout ${r.payoutPct}% => breakeven ${pc(r.breakeven)} | m=1 teste`, '', `>>> VEREDITO: ${r.verdict}`, `>>> ${r.conclusion}`, '');
    L.push(`- N=${r.n} (${(r.n / Math.max(1, r.meta.days)).toFixed(1)}/dia) | acerto ${pc(r.winRate)} | Wilson95 [${pc(r.wilson[0])} - ${pc(r.wilson[1])}] | empates ${r.ties}`);
    L.push(`- Metades: ${r.halves[0] === null ? 'n/d' : pc(r.halves[0])} / ${r.halves[1] === null ? 'n/d' : pc(r.halves[1])} | bootstrap/dia ${r.dayBootstrap ? `[${pc(r.dayBootstrap[0])} - ${pc(r.dayBootstrap[1])}]` : 'n/d'}`);
    L.push(`- Variante B (1 vela depois): ${r.winRateB === null ? 'n/d' : pc(r.winRateB)} | placebo p=${r.pPlacebo.toFixed(4)} | taxa-base de PUT 15m no período: ${pc(r.basePutRate)}`);
    L.push(`- Retorno médio bruto por operação (PUT 15m): ${r.grossMeanBps.toFixed(2)} bps${r.grossCiBps ? ` (IC95 por dia [${r.grossCiBps[0].toFixed(2)}, ${r.grossCiBps[1].toFixed(2)}])` : ''} | placebo do retorno p=${r.pPlaceboMean.toFixed(4)}`);
    L.push(`- Acerto de referência (${pc(IN_SAMPLE_REF.winRate)}) ${r.refInside ? 'CABE' : 'NÃO cabe'} no IC fora da amostra | encolhimento: ${((IN_SAMPLE_REF.winRate - r.winRate) * 100).toFixed(1)} pp`);
    L.push('- Blocos cronológicos: ' + (r.blocks.length ? r.blocks.map(b => `${d(b.from)}: N=${b.n} ${b.winRate === null ? 'n/d' : pc(b.winRate)}`).join(' | ') : 'n/d'));
    L.push(`- Validade dos dados: sinais descartados por buraco de tempo: ${r.filters.gapDropped} | por mercado parado/sem volume: ${r.filters.liquidityDropped}${r.filters.liquidityFilterActive ? '' : ' (filtro de liquidez inativo: velas sem volume)'}`);
    L.push(`- Motivo: ${r.motivo}`, '', 'NOTAS E LIMITAÇÕES:',
        '* Teste único, parâmetros congelados; critérios definidos antes de rodar. Velas de 1 min; payout assumido; empate = perda; só Rise/Fall.',
        '* A regra foi a melhor de 14 candidatas na descoberta. Confirmar aqui reduz o risco de falso positivo, não o elimina.',
        '* Confirmação NÃO autoriza execução: o próximo passo é shadow à frente no tempo; REAL continua bloqueado.');
    return L.join('\n');
}
