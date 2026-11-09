import { describe, it, expect } from 'vitest';
import { mulberry32 } from './leadlag-backtest';
import { toGrid, runTickStudy, fetchTicksPaged, buildTickStudyReport, type Tick } from './leadlag-tick-study';

function gauss(rng: () => number) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); }

/** BTC: passeio aleatório 1 tick/s com saltos esparsos. ETH = BTC atrasado `lag` s (+ ruído) ou independente. */
function synth(seconds: number, lag: number | null, seed = 5, start = 1_700_000_000) {
    const rng = mulberry32(seed), rng2 = mulberry32(seed + 99);
    const btcLog = new Float64Array(seconds), ethInd = new Float64Array(seconds);
    let b = Math.log(60000), e = Math.log(3000);
    for (let i = 0; i < seconds; i++) {
        b += gauss(rng) * 1e-4;
        if (rng() < 1 / 150) b += (rng() < 0.5 ? -1 : 1) * 9e-4;
        e += gauss(rng2) * 1e-4;
        btcLog[i] = b; ethInd[i] = e;
    }
    const btc: Tick[] = [], eth: Tick[] = [];
    for (let i = 0; i < seconds; i++) {
        btc.push({ epoch: start + i, price: Math.exp(btcLog[i]) });
        const base = lag === null ? ethInd[i] : btcLog[Math.max(0, i - lag)] + gauss(rng2) * 3e-5;
        eth.push({ epoch: start + i, price: Math.exp(base) * (lag === null ? 1 : 0.05) });
    }
    return { btc, eth };
}

describe('toGrid', () => {
    it('carrega o último valor e mede a idade do tick', () => {
        const g = toGrid([{ epoch: 100, price: 1 }, { epoch: 103, price: 2 }], 100, 105);
        expect(Array.from(g.prices)).toEqual([1, 1, 1, 2, 2, 2]);
        expect(Array.from(g.age)).toEqual([0, 1, 2, 0, 1, 2]);
    });
    it('usa o último tick do mesmo segundo e o tick anterior ao início', () => {
        const g = toGrid([{ epoch: 98, price: 7 }, { epoch: 100, price: 1 }, { epoch: 100, price: 3 }], 99, 100);
        expect(Array.from(g.prices)).toEqual([7, 3]);
        expect(g.age[0]).toBe(1);
    });
});

describe('fetchTicksPaged', () => {
    it('pagina para trás, remove duplicatas e respeita from/to', async () => {
        const all: Tick[] = Array.from({ length: 1000 }, (_, i) => ({ epoch: 1000 + i, price: 1 + i }));
        const calls: number[] = [];
        const fetchPage = async (_s: string, _st: 'ticks', count: number, _p: undefined, end?: number) => {
            calls.push(end!);
            return all.filter(t => t.epoch <= end!).slice(-count);
        };
        const out = await fetchTicksPaged(fetchPage, 'X', 1200, 1999, undefined, { pageSize: 300, pauseMs: 0 });
        expect(out[0].epoch).toBe(1200);
        expect(out[out.length - 1].epoch).toBe(1999);
        expect(out.length).toBe(800);
        expect(new Set(out.map(t => t.epoch)).size).toBe(800);
        expect(calls.length).toBeGreaterThan(2);
    });
    it('para quando a API devolve vazio', async () => {
        const out = await fetchTicksPaged(async () => [], 'X', 0, 100, undefined, { pauseMs: 0 });
        expect(out).toEqual([]);
    });
});

describe('runTickStudy', () => {
    it('falha com graça com poucos ticks', () => {
        const r = runTickStudy([], []);
        expect(r.ok).toBe(false);
        expect(buildTickStudyReport(r)).toContain('DADOS INSUFICIENTES');
    });

    it('ETH que segue o BTC com 3 s de atraso: acha o lag, edge existe só antes da latência', () => {
        const { btc, eth } = synth(86_400, 3);
        const r = runTickStudy(btc, eth, { latencySec: 4 });
        expect(r.ok).toBe(true);
        expect(r.events.all).toBeGreaterThan(200);
        expect(r.peakLag).toBe(3);
        const cu = r.curves.all;
        expect(cu.halfTimeSec).not.toBeNull();
        expect(cu.halfTimeSec!).toBeGreaterThan(1.5);
        expect(cu.halfTimeSec!).toBeLessThan(4);
        expect(cu.remainingAtLatency!).toBeLessThan(0.15);
        const d0 = r.rows.find(x => x.scope === 'all' && x.delaySec === 0 && x.horizonSec === 5)!;
        const d5 = r.rows.find(x => x.scope === 'all' && x.delaySec === 5 && x.horizonSec === 5)!;
        expect(d0.winRate).toBeGreaterThan(0.9);
        expect(d0.verdict).toBe('EDGE EM TICKS');
        expect(d5.verdict).not.toBe('EDGE EM TICKS');
        expect(r.conclusion).toContain('SÓ COM ATRASO');
    });

    it('ETH independente: nenhuma linha vira edge', () => {
        const { btc, eth } = synth(86_400, null);
        const r = runTickStudy(btc, eth);
        expect(r.ok).toBe(true);
        expect(r.rows.filter(x => x.verdict === 'EDGE EM TICKS')).toHaveLength(0);
        expect(Math.min(...r.rows.map(x => x.pAdj))).toBeGreaterThan(0.05);
        expect(r.conclusion).not.toContain('CANDIDATO');
    });

    it('é determinístico e o relatório em texto é gerado', () => {
        const { btc, eth } = synth(30_000, 3, 11);
        const a = runTickStudy(btc, eth, { placeboReps: 99 }), b = runTickStudy(btc, eth, { placeboReps: 99 });
        expect(a.rows.map(x => x.pRaw)).toEqual(b.rows.map(x => x.pRaw));
        const txt = buildTickStudyReport(a);
        expect(txt).toContain('CONCLUSÃO');
        expect(txt).toContain('CORRELAÇÃO CRUZADA');
    });

    it('ticks da ETH parados (stale) não geram pontos', () => {
        const { btc, eth } = synth(30_000, 3, 12);
        const stale = eth.filter(t => t.epoch % 60 === 0); // 1 tick por minuto: com maxStaleSec=2 nunca há dois pontos frescos a 5 s
        const r = runTickStudy(btc, stale, { placeboReps: 99, maxStaleSec: 2 });
        expect(r.ok ? r.events.all : 0).toBe(0);
    });
});
