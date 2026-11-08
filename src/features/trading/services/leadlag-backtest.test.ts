// src/features/trading/services/leadlag-backtest.test.ts
import { describe, it, expect } from 'vitest';
import {
    wilsonInterval, holmAdjust, placeboPValue, blockBootstrapDays, classifyEdge, mulberry32,
    alignByEpoch, computeRawMetricsSync, runLeadLagBacktest, getLeadLagEvents, LOOKBACK,
} from './leadlag-backtest';

function gauss(r: () => number) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

/**
 * Gerador: BTC com saltos; ETH acompanha o BTC no mesmo candle (beta 0.8) na maior parte do tempo.
 * Em parte dos saltos o ETH "dorme" no candle do salto (atraso):
 *  - lagMode 'catchup': o ETH recupera o movimento no candle seguinte (EDGE real, só sem latência)
 *  - lagMode 'none'   : o ETH simplesmente ignora o salto, sem recuperar (SEM EDGE)
 */
function genSeries(n: number, seed: number, lagMode: 'catchup' | 'none', jumpProb = 0.06, lagProb = 0.5) {
    const r = mulberry32(seed);
    const btc: any[] = [], eth: any[] = [];
    let b = 60000, e = 3000;
    let pendingCatchup = 0;
    for (let i = 0; i < n; i++) {
        let rb = 0.001 * gauss(r);
        const jump = r() < jumpProb;
        if (jump) rb = (r() < 0.5 ? 1 : -1) * 0.006 * (1 + r());
        let re = 0.8 * rb + 0.0003 * gauss(r);
        if (jump && r() < lagProb) { re = 0.0003 * gauss(r); if (lagMode === 'catchup') pendingCatchup = 0.8 * rb; }
        else if (pendingCatchup !== 0) { re += pendingCatchup; pendingCatchup = 0; }
        b *= Math.exp(rb); e *= Math.exp(re);
        const epoch = 1_700_000_000 + i * 60;
        btc.push({ epoch, close: b, open: b, high: b, low: b });
        eth.push({ epoch, close: e, open: e, high: e, low: e });
    }
    return { btc, eth };
}

describe('Estatística', () => {
    it('Wilson: 50/100 => ~[0.404, 0.596]; 0/0 => [0,1]', () => {
        const [lo, hi] = wilsonInterval(50, 100);
        expect(lo).toBeCloseTo(0.404, 2); expect(hi).toBeCloseTo(0.596, 2);
        expect(wilsonInterval(0, 0)).toEqual([0, 1]);
    });
    it('Holm: p=[0.01,0.04,0.03] => [0.03,0.06,0.06]', () => {
        const a = holmAdjust([0.01, 0.04, 0.03]);
        expect(a[0]).toBeCloseTo(0.03); expect(a[1]).toBeCloseTo(0.06); expect(a[2]).toBeCloseTo(0.06);
    });
    it('Placebo: com deriva de alta (60% CALL ganha) um acerto de 60% NÃO é significativo; 85% é', () => {
        const pool = Array.from({ length: 1000 }, (_, i) => ({ callWin: i % 10 < 6, putWin: i % 10 >= 6 }));
        const pDrift = placeboPValue(60, 100, 1, pool, 2000, 1);
        const pEdge = placeboPValue(85, 100, 1, pool, 2000, 1);
        expect(pDrift).toBeGreaterThan(0.2);
        expect(pEdge).toBeLessThan(0.01);
    });
    it('Bootstrap por dia: poucos dias => null; vários dias => IC contendo a taxa observada', () => {
        const few = Array.from({ length: 20 }, (_, i) => ({ day: i % 3, win: true, retBps: 1 }));
        expect(blockBootstrapDays(few, 500, 1)).toBeNull();
        const many = Array.from({ length: 200 }, (_, i) => ({ day: i % 20, win: i % 10 < 6, retBps: 1 }));
        const ci = blockBootstrapDays(many, 1000, 1)!;
        expect(ci[0]).toBeLessThanOrEqual(0.6); expect(ci[1]).toBeGreaterThanOrEqual(0.6);
    });
    it('classifyEdge: exige N, Wilson inferior > breakeven, metades e p ajustado', () => {
        const be = 1 / 1.8;
        expect(classifyEdge({ n: 10, wilson: [0.5, 0.9], breakeven: be, halves: [0.9, 0.9], pAdj: 0.001 }).verdict).toBe('INCONCLUSIVO');
        expect(classifyEdge({ n: 100, wilson: [0.3, 0.5], breakeven: be, halves: [0.4, 0.4], pAdj: 0.5 }).verdict).toBe('SEM EDGE');
        expect(classifyEdge({ n: 100, wilson: [0.58, 0.75], breakeven: be, halves: [0.7, 0.6], pAdj: 0.01 }).verdict).toBe('EDGE EM 1m');
        expect(classifyEdge({ n: 100, wilson: [0.58, 0.75], breakeven: be, halves: [0.7, 0.5], pAdj: 0.01 }).verdict).toBe('INCONCLUSIVO');
        expect(classifyEdge({ n: 100, wilson: [0.58, 0.75], breakeven: be, halves: [0.7, 0.6], pAdj: 0.2 }).verdict).toBe('INCONCLUSIVO');
    });
});

describe('Sem lookahead', () => {
    it('alterar candles FUTUROS não muda as métricas dos instantes anteriores', () => {
        const { btc, eth } = genSeries(600, 5, 'catchup');
        const a = computeRawMetricsSync(alignByEpoch(btc, eth));
        const btc2 = btc.map((c, i) => (i > 400 ? { ...c, close: c.close * 1.5 } : c));
        const eth2 = eth.map((c, i) => (i > 400 ? { ...c, close: c.close * 0.5 } : c));
        const b = computeRawMetricsSync(alignByEpoch(btc2, eth2));
        const upto = a.filter(p => p.i <= 400);
        expect(upto.length).toBeGreaterThan(100);
        upto.forEach(p => {
            const q = b.find(x => x.i === p.i)!;
            expect(q.corr).toBe(p.corr); expect(q.zBtc).toBe(p.zBtc); expect(q.zTarget).toBe(p.zTarget);
        });
    });
    it('lacuna de tempo: eventos sem candle consecutivo não geram resultado', () => {
        const { btc, eth } = genSeries(800, 9, 'catchup');
        const ev = getLeadLagEvents(btc, eth);
        expect(ev.length).toBeGreaterThan(0);
        ev.forEach(e => expect(Object.keys(e.outcomes).length).toBeGreaterThan(0));
    });
});

describe('Backtest lead-lag (sintético)', () => {
    it('ETH recupera o salto no candle seguinte: A tem EDGE em h=1; B (1 candle de atraso) não; calibração = INCONCLUSIVO', async () => {
        const { btc, eth } = genSeries(14000, 11, 'catchup');
        const rep = await runLeadLagBacktest(btc, eth, { reps: 1000 });
        const a1 = rep.horizons.find(r => r.h === 1 && r.variant === 'A')!;
        const b1 = rep.horizons.find(r => r.h === 1 && r.variant === 'B')!;
        expect(rep.calibration).not.toBeNull();
        expect(a1.n).toBeGreaterThanOrEqual(30);
        expect(a1.rate).toBeGreaterThan(0.8);
        expect(a1.veredito).toBe('EDGE EM 1m');
        expect(b1.veredito).not.toBe('EDGE EM 1m');
        expect(rep.calibration!.verdict).toBe('INCONCLUSIVO'); // edge só sem latência
        expect(rep.notes!.join(' ')).toMatch(/não sobrevive à latência/);
        expect(rep.horizons[0]).toBeDefined();
    }, 120000);

    it('ETH ignora o salto sem recuperar (sem edge): nunca declara EDGE (25 simulações, falsos positivos <= 2)', async () => {
        let falsos = 0;
        for (let s = 1; s <= 25; s++) {
            const { btc, eth } = genSeries(6000, 100 + s, 'none', 0.10, 0.5);
            const rep = await runLeadLagBacktest(btc, eth, { reps: 400, seed: s });
            if (rep.horizons.some(r => r.veredito === 'EDGE EM 1m')) falsos++;
        }
        expect(falsos).toBeLessThanOrEqual(2);
    }, 300000);

    it('é determinístico: mesma entrada => mesmo relatório (exceto timestamp)', async () => {
        const { btc, eth } = genSeries(5000, 21, 'catchup', 0.08);
        const r1 = await runLeadLagBacktest(btc, eth, { reps: 300 });
        const r2 = await runLeadLagBacktest(btc, eth, { reps: 300 });
        const strip = (r: any) => JSON.stringify({ ...r, calibration: r.calibration && { ...r.calibration, timestamp: '' } });
        expect(strip(r1)).toBe(strip(r2));
    }, 120000);

    it('dados insuficientes => relatório vazio sem calibração', async () => {
        const { btc, eth } = genSeries(300, 1, 'none');
        const rep = await runLeadLagBacktest(btc, eth);
        expect(rep.calibration).toBeNull(); expect(rep.n).toBe(0);
    });

    it(`janela mínima: LOOKBACK=${LOOKBACK}`, () => { expect(LOOKBACK).toBe(120); });
});
