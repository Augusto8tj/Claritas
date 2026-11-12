import { describe, it, expect } from 'vitest';
import { mulberry32 } from './leadlag-backtest';
import { alignBars } from './horizon-hypotheses';
import { computeFeatures, buildRules, runSuperReport, summarizeEvents, FROZEN_LIB_ID, type Ev } from './super-report';

function gauss(rng: () => number) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); }
const START = Date.UTC(2026, 5, 1) / 1000;
/** plant: choque de alta do BTC => ETH cai nos 15 min seguintes. hourDrift: {hora UTC: drift por vela} aplicado por 60 velas a partir de :00. */
function synth(days: number, opts: { plant?: boolean; hourDrift?: Record<number, number>; seed?: number } = {}) {
    const n = days * 1440, seed = opts.seed ?? 5;
    const rb = mulberry32(seed), re = mulberry32(seed + 7);
    let b = Math.log(60000), e = Math.log(3000);
    const drift = new Float64Array(n + 80);
    const btc: any[] = [], eth: any[] = [];
    for (let i = 0; i < n; i++) {
        const ob = b, oe = e, ep = START + i * 60;
        b += gauss(rb) * 1e-4;
        if (rb() < 1 / 200) { b += 1e-3; if (opts.plant) for (let k = 1; k <= 15; k++) drift[i + k] -= 3e-4; }
        const hr = Math.floor(ep / 3600) % 24;
        if (opts.hourDrift && opts.hourDrift[hr] !== undefined && Math.floor(ep / 60) % 60 === 0) for (let k = 1; k <= 60; k++) drift[i + k] += opts.hourDrift[hr];
        e += gauss(re) * 1e-4 + drift[i];
        const mk = (o: number, c: number) => ({ epoch: ep, open: Math.exp(o), close: Math.exp(c), high: Math.exp(Math.max(o, c) + 2e-5), low: Math.exp(Math.min(o, c) - 2e-5), volume: 1 });
        btc.push(mk(ob, b)); eth.push(mk(oe, e));
    }
    return { btc, eth };
}
const opts = { includeWindows: false, placeboReps: 99 };

describe('biblioteca de regras', () => {
    it('tem 150 regras com ids únicos e a divisão por família esperada', () => {
        const { btc, eth } = synth(5);
        const rules = buildRules(computeFeatures(alignBars(btc, eth)));
        expect(rules).toHaveLength(150);
        expect(new Set(rules.map(r => r.id)).size).toBe(150);
        const c = (f: string) => rules.filter(r => r.family === f).length;
        expect([c('A'), c('B'), c('C'), c('D'), c('E')]).toEqual([48, 48, 18, 12, 24]);
        expect(rules.some(r => r.id === FROZEN_LIB_ID)).toBe(true);
    });
});

describe('summarizeEvents', () => {
    const mk = (day: number, r: number, i: number): Ev => ({ i, day, month: '2026-06', dir: 1, retLong: r, advLong: 0, advShort: 0 });
    it('z agrupado por dia: ruído não dá significância; efeito constante dá', () => {
        const rng = mulberry32(1);
        const noise = Array.from({ length: 600 }, (_, k) => mk(Math.floor(k / 10), gauss(rng) * 10, k));
        expect(summarizeEvents(noise).p).toBeGreaterThan(0.01);
        const shifted = Array.from({ length: 600 }, (_, k) => mk(Math.floor(k / 10), 5 + gauss(rng) * 10, k));
        const s = summarizeEvents(shifted);
        expect(s.z).toBeGreaterThan(4);
        expect(s.p).toBeLessThan(0.001);
        expect(s.winRate).toBeGreaterThan(0.6);
    });
    it('com menos de 10 dias não calcula p (evita falsa precisão)', () => {
        const few = Array.from({ length: 50 }, (_, k) => mk(k % 5, 3, k));
        expect(summarizeEvents(few).p).toBe(1);
    });
});

describe('runSuperReport', () => {
    it('poucos dados => ok false', () => {
        const { btc, eth } = synth(5);
        const r = runSuperReport(btc, eth, opts);
        expect(r.ok).toBe(false);
        expect(r.text).toContain('DADOS INSUFICIENTES');
    });

    it('efeito plantado: a regra congelada sobrevive e o relatório traz todas as seções e simulações', () => {
        const { btc, eth } = synth(90, { plant: true });
        const r = runSuperReport(btc, eth, opts);
        expect(r.ok).toBe(true);
        const frozen = r.results.find(x => x.rule.id === FROZEN_LIB_ID)!;
        expect(frozen.survivor).toBe(true);
        expect(frozen.stats.mean).toBeGreaterThan(20);
        expect(r.survivors).toBeGreaterThanOrEqual(1);
        for (const s of ['1) RESUMO EXECUTIVO', '2) RANKING', '3) EXCESSO DE SINAL', '5) SIMULAÇÃO DE CONTRATOS', '7) ESTABILIDADE MENSAL', 'Rise/Fall payout 85%', 'Multiplier x100']) expect(r.text).toContain(s);
        expect(r.results.filter(x => x.placebo !== undefined)).toHaveLength(10);
    });

    it('sem efeito: nenhuma sobrevivente', () => {
        const { btc, eth } = synth(90);
        const r = runSuperReport(btc, eth, opts);
        expect(r.survivors).toBe(0);
        expect(r.text).toContain('nenhuma regra da biblioteca');
    });

    it('efeito de hora do dia: CALL sobrevive e o lado negativo vira PUT (bilateral)', () => {
        const { btc, eth } = synth(130, { hourDrift: { 5: 2e-4, 9: -2e-4 } }); // 1 evento/dia/hora: precisa de >= 100 dias
        const r = runSuperReport(btc, eth, opts);
        const up = r.results.find(x => x.rule.id === 'E_HORA05_h60')!, dn = r.results.find(x => x.rule.id === 'E_HORA09_h60')!;
        expect(up.survivor).toBe(true); expect(up.flipped).toBe(false);
        expect(dn.survivor).toBe(true); expect(dn.flipped).toBe(true);
        expect(dn.stats.mean).toBeGreaterThan(0);
    });

    it('é determinístico e a comparação de janelas não lança com dados fora das janelas', () => {
        const { btc, eth } = synth(40, { plant: true }, );
        const a = runSuperReport(btc, eth, { placeboReps: 49 }), b = runSuperReport(btc, eth, { placeboReps: 49 });
        expect(a.text).toBe(b.text);
        expect(a.windowsText.length).toBeGreaterThan(0);
    });
});
