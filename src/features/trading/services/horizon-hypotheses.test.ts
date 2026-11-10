import { describe, it, expect } from 'vitest';
import { mulberry32 } from './leadlag-backtest';
import { alignBars, computeSignals, runHorizonHypotheses, buildHorizonReport } from './horizon-hypotheses';

function gauss(rng: () => number) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); }

/** BTC com saltos de alta esparsos; ETH independente, mas (se plant) cai forte nas 15 velas após o salto. */
function synth(n: number, plant: boolean, seed = 3, start = 1_700_000_000) {
    const rb = mulberry32(seed), re = mulberry32(seed + 7);
    let b = Math.log(60000), e = Math.log(3000);
    const drift = new Float64Array(n + 40);
    const btc: any[] = [], eth: any[] = [];
    for (let i = 0; i < n; i++) {
        const ob = b, oe = e;
        b += gauss(rb) * 1e-4;
        if (rb() < 1 / 200) { b += 1e-3; if (plant) for (let k = 1; k <= 15; k++) drift[i + k] -= 3e-4; }
        e += gauss(re) * 1e-4 + drift[i];
        const mk = (o: number, c: number) => ({ epoch: start + i * 60, open: Math.exp(o), close: Math.exp(c), high: Math.exp(Math.max(o, c) + 2e-5), low: Math.exp(Math.min(o, c) - 2e-5), volume: 1 });
        btc.push(mk(ob, b)); eth.push(mk(oe, e));
    }
    return { btc, eth };
}

describe('alignBars', () => {
    it('interseção por epoch e descarta velas inválidas', () => {
        const { btc, eth } = synth(50, false);
        const bars = alignBars(btc.slice(5), eth.slice(0, 40));
        expect(bars.epochs.length).toBe(35);
        const bad = [...eth]; bad[10] = { ...bad[10], close: NaN };
        expect(alignBars(btc, bad).epochs.length).toBe(49);
    });
});

describe('computeSignals', () => {
    it('H3: choque de alta do BTC gera PUT (fade) e é causal', () => {
        const { btc, eth } = synth(3000, false, 9);
        const bars = alignBars(btc, eth);
        const full = computeSignals(bars);
        const cut = alignBars(btc.slice(0, 2000), eth.slice(0, 2000));
        const part = computeSignals(cut);
        let any = 0;
        for (let i = 0; i < 2000; i++) { expect(part.dir['H3_ALTA'][i]).toBe(full.dir['H3_ALTA'][i]); expect(part.dir['H1'][i]).toBe(full.dir['H1'][i]); expect(part.dir['H2'][i]).toBe(full.dir['H2'][i]); if (full.dir['H3_ALTA'][i]) { any++; expect(full.dir['H3_ALTA'][i]).toBe(-1); } }
        expect(any).toBeGreaterThan(0);
        for (let i = 0; i < 3000; i++) if (full.dir['H3_QUEDA'][i]) expect(full.dir['H3_QUEDA'][i]).toBe(1);
    });
});

describe('runHorizonHypotheses', () => {
    it('falha com graça com poucas velas', () => {
        const { btc, eth } = synth(500, false);
        const r = runHorizonHypotheses(btc, eth);
        expect(r.ok).toBe(false);
        expect(buildHorizonReport(r)).toContain('DADOS INSUFICIENTES');
    });

    it('efeito plantado (ETH cai após choque de alta) vira EDGE CANDIDATO no H3_ALTA 15m', () => {
        const { btc, eth } = synth(40_000, true);
        const r = runHorizonHypotheses(btc, eth);
        expect(r.ok).toBe(true);
        const row = r.rows.find(x => x.id === 'H3_ALTA' && x.horizon === 15)!;
        expect(row.n).toBeGreaterThanOrEqual(30);
        expect(row.winRate).toBeGreaterThan(0.7); // inclui choques gaussianos sem efeito plantado
        expect(row.verdict).toBe('EDGE CANDIDATO');
        expect(r.conclusion).toContain('EDGE CANDIDATO');
    });

    it('sem efeito plantado: nenhuma hipótese vira edge', () => {
        const { btc, eth } = synth(40_000, false);
        const r = runHorizonHypotheses(btc, eth);
        expect(r.rows.filter(x => x.verdict === 'EDGE CANDIDATO')).toHaveLength(0);
        expect(r.conclusion).not.toContain('EDGE CANDIDATO em');
    });

    it('é determinístico', () => {
        const { btc, eth } = synth(8000, true, 4);
        const a = runHorizonHypotheses(btc, eth, { placeboReps: 99 }), b = runHorizonHypotheses(btc, eth, { placeboReps: 99 });
        expect(a.rows.map(x => x.pRaw)).toEqual(b.rows.map(x => x.pRaw));
        expect(buildHorizonReport(a)).toContain('CONCLUSÃO');
    });
});
