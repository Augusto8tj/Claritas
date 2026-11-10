import { describe, it, expect } from 'vitest';
import { mulberry32 } from './leadlag-backtest';
import { runOosConfirmation } from './oos-confirmation';
import { bootstrapMeanByDay, evaluateMultiplier, buildMultiplierReport } from './multiplier-economics';
import { probeMultiplier, buildMultiplierProbeText } from './payout-probe';

function gauss(rng: () => number) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); }
const START = 1_700_000_000;
function synth(n: number, plant: boolean, seed = 3) {
    const rb = mulberry32(seed), re = mulberry32(seed + 7);
    let b = Math.log(60000), e = Math.log(3000);
    const drift = new Float64Array(n + 40);
    const btc: any[] = [], eth: any[] = [];
    for (let i = 0; i < n; i++) {
        const ob = b, oe = e;
        b += gauss(rb) * 1e-4;
        if (rb() < 1 / 200) { b += 1e-3; if (plant) for (let k = 1; k <= 15; k++) drift[i + k] -= 3e-4; }
        e += gauss(re) * 1e-4 + drift[i];
        const mk = (o: number, c: number) => ({ epoch: START + i * 60, open: Math.exp(o), close: Math.exp(c), high: Math.exp(Math.max(o, c) + 2e-5), low: Math.exp(Math.min(o, c) - 2e-5), volume: 1 });
        btc.push(mk(ob, b)); eth.push(mk(oe, e));
    }
    return { btc, eth };
}
const FAR = START + 10_000_000;

describe('bootstrapMeanByDay', () => {
    it('IC contém a média e precisa de >= 5 dias', () => {
        const items = Array.from({ length: 400 }, (_, i) => ({ day: Math.floor(i / 20), x: 10 + (i % 7) - 3 }));
        const ci = bootstrapMeanByDay(items)!;
        expect(ci[0]).toBeLessThan(10); expect(ci[1]).toBeGreaterThan(10);
        expect(bootstrapMeanByDay(items.slice(0, 60))).toBeNull();
    });
});

describe('OOS com estatística de retorno', () => {
    it('efeito plantado: retorno bruto médio grande e positivo, placebo significativo, MAE medido', () => {
        const { btc, eth } = synth(40_000, true);
        const r = runOosConfirmation(btc, eth, { cutoffEpoch: FAR, placeboReps: 199 });
        expect(r.events.length).toBe(r.n);
        expect(r.grossMeanBps).toBeGreaterThan(20);
        expect(r.pPlaceboMean).toBeLessThan(0.05);
        expect(r.events.every(e => e.maeBps >= 0)).toBe(true);
    });
});

describe('evaluateMultiplier', () => {
    const { btc, eth } = synth(40_000, true);
    const r = runOosConfirmation(btc, eth, { cutoffEpoch: FAR, placeboReps: 199 });
    it('custo baixo medido => CONFIRMADO', () => {
        const rows = evaluateMultiplier(r, [{ multiplier: 100, costBps: 2 }, { multiplier: 200, costBps: 2 }]);
        expect(rows[0].verdict).toBe('CONFIRMADO');
        expect(rows[0].netBps).toBeGreaterThan(0);
        expect(buildMultiplierReport(r, rows)).toContain('CONFIRMADO');
    });
    it('custo alto => NÃO CONFIRMADO', () => {
        const rows = evaluateMultiplier(r, [{ multiplier: 100, costBps: 500 }]);
        expect(rows[0].verdict).toBe('NÃO CONFIRMADO');
    });
    it('custo não medido nunca confirma', () => {
        const rows = evaluateMultiplier(r, [{ multiplier: 100, costBps: null }]);
        expect(rows[0].verdict).toBe('INCONCLUSIVO');
        expect(rows[0].motivo).toContain('não medido');
    });
    it('multiplicador alto estoura o stop-out e piora o resultado', () => {
        const a = evaluateMultiplier(r, [{ multiplier: 100, costBps: 0 }])[0];
        const b = evaluateMultiplier(r, [{ multiplier: 5000, costBps: 0 }])[0];
        expect(b.stopOutShare).toBeGreaterThanOrEqual(a.stopOutShare);
        expect(b.netBps).toBeLessThanOrEqual(a.netBps);
    });
});

describe('probeMultiplier', () => {
    const cf = { contracts_for: { available: [
        { contract_category: 'multiplier', contract_type: 'MULTUP', multiplier_range: [100, 200] },
        { contract_category: 'multiplier', contract_type: 'MULTDOWN', multiplier_range: [200, 100, 500] },
    ] } };
    it('calcula custo em bps = comissão / (stake * multiplicador)', async () => {
        const calls: any[] = [];
        const r = await probeMultiplier(async () => cf, async (p: any) => { calls.push(p); return { proposal: { ask_price: 10.5, commission: 0.5 } }; }, 'cryETHUSD', 10);
        expect(r.ok).toBe(true);
        expect(r.quotes.map(q => q.multiplier)).toEqual([100, 200, 500]);
        expect(r.quotes[0].costBps).toBeCloseTo((0.5 / (10 * 100)) * 1e4, 6);
        expect(r.quotes[0].stopOutPct).toBeCloseTo(1, 6);
        expect(calls[0]).toMatchObject({ contract_type: 'MULTDOWN', multiplier: 100, basis: 'stake' });
        expect(buildMultiplierProbeText(r)).toContain('nenhuma compra');
    });
    it('sem commission no proposal usa ask - stake; erros são reportados', async () => {
        const r = await probeMultiplier(async () => cf, async () => ({ proposal: { ask_price: 10.2 } }), 'cryETHUSD', 10);
        expect(r.quotes[0].commission).toBeCloseTo(0.2, 6);
        const e = await probeMultiplier(async () => cf, async () => ({ error: { message: 'x' } }), 'cryETHUSD', 10);
        expect(e.ok).toBe(false);
        const none = await probeMultiplier(async () => ({ contracts_for: { available: [] } }), async () => ({}), 'cryETHUSD', 10);
        expect(none.error).toContain('nenhum contrato multiplier');
    });
});
