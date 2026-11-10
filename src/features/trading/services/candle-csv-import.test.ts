import { describe, it, expect } from 'vitest';
import { mulberry32 } from './leadlag-backtest';
import { parseKlinesCsv, mergeCandles, assessQuality, buildQualityText } from './candle-csv-import';
import { runOosConfirmation } from './oos-confirmation';

describe('parseKlinesCsv', () => {
    it('lê Binance com microssegundos (formato BTCUSD-1m-2026-06.csv)', () => {
        const txt = [
            '1780272000000000,73453.70000000,73453.70000000,73453.70000000,73453.70000000,0.00000000,1780272059999999,0.00000000,0,0.00000000,0.00000000,0',
            '1780273020000000,73680.83000000,73680.83000000,73680.83000000,73680.83000000,0.01001000,1780273079999999,737.54510830,1,0.01001000,737.54510830,0',
        ].join('\n');
        const r = parseKlinesCsv(txt);
        expect(r.candles).toHaveLength(2);
        expect(new Date(r.candles[0].epoch * 1000).toISOString()).toBe('2026-06-01T00:00:00.000Z');
        expect(r.candles[0].volume).toBe(0);
        expect(r.candles[1].volume).toBeCloseTo(0.01001, 6);
        expect(r.candles[1].epoch - r.candles[0].epoch).toBe(1020);
    });
    it('aceita ms, segundos, cabeçalho, CRLF e o formato Kaggle (com "—")', () => {
        const r = parseKlinesCsv('open_time,o,h,l,c\r\n1780272000000,1,2,0.5,1.5,3\r\n1780272060,1,2,0.5,1.5\r\n');
        expect(r.candles.map(c => c.epoch)).toEqual([1780272000, 1780272060]);
        expect(r.skipped).toBe(1);
        const k = parseKlinesCsv('Date,Open,High,Low,Close\n2021-12-31 00:00:00,47110.3,47112.2,47097.03,47097.03\n2021-12-31 00:32:00,—,—,—,—');
        expect(k.candles).toHaveLength(1);
        expect(k.candles[0].epoch).toBe(Date.UTC(2021, 11, 31) / 1000);
        expect(k.candles[0].volume).toBeUndefined();
        expect(k.skipped).toBe(2); // cabeçalho + linha com "—"
    });
});

describe('mergeCandles / assessQuality', () => {
    it('ordena, remove duplicatas e conta conflitos', () => {
        const mk = (e: number, c: number) => ({ epoch: e, open: c, high: c, low: c, close: c, volume: 1 });
        const m = mergeCandles([mk(120, 3), mk(60, 1), mk(60, 1), mk(120, 4)]);
        expect(m.candles.map(c => c.epoch)).toEqual([60, 120]);
        expect(m.duplicates).toBe(2);
        expect(m.conflicts).toBe(1);
    });
    it('mede buracos, velas planas e sem volume e avisa mercado ralo', () => {
        const mk = (e: number, v: number) => ({ epoch: e, open: 1, high: 1, low: 1, close: 1, volume: v });
        const q = assessQuality('BTC', mergeCandles([mk(0, 0), mk(60, 0), mk(240, 1)]));
        expect(q.gaps).toBe(1);
        expect(q.missingMinutes).toBe(2);
        expect(q.maxGapMinutes).toBe(2);
        expect(q.flatShare).toBe(1);
        expect(q.zeroVolumeShare).toBeCloseTo(2 / 3, 6);
        expect(buildQualityText([q])).toContain('Mercado ralo');
    });
});

// ---------- OOS com dados importados: buracos e liquidez ----------
function gauss(rng: () => number) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); }
const START = 1_700_000_000;
function synth(n: number, opts: { plant: boolean; volume?: (i: number) => number; skip?: (i: number) => boolean; seed?: number }) {
    const rb = mulberry32(opts.seed ?? 3), re = mulberry32((opts.seed ?? 3) + 7);
    let b = Math.log(60000), e = Math.log(3000);
    const drift = new Float64Array(n + 40);
    const btc: any[] = [], eth: any[] = [];
    for (let i = 0; i < n; i++) {
        const ob = b, oe = e;
        b += gauss(rb) * 1e-4;
        if (rb() < 1 / 200) { b += 1e-3; if (opts.plant) for (let k = 1; k <= 15; k++) drift[i + k] -= 3e-4; }
        e += gauss(re) * 1e-4 + drift[i];
        if (opts.skip?.(i)) continue;
        const v = opts.volume ? opts.volume(i) : 1;
        const mk = (o: number, c: number) => ({ epoch: START + i * 60, open: Math.exp(o), close: Math.exp(c), high: Math.exp(Math.max(o, c) + 2e-5), low: Math.exp(Math.min(o, c) - 2e-5), volume: v });
        btc.push(mk(ob, b)); eth.push(mk(oe, e));
    }
    return { btc, eth };
}
const FAR = START + 10_000_000;

describe('OOS com dados importados', () => {
    it('buracos de tempo descartam sinais que cruzam o buraco e o resultado segue válido', () => {
        const base = synth(40_000, { plant: true });
        const holed = synth(40_000, { plant: true, skip: i => i >= 20_000 && i < 20_030 });
        const a = runOosConfirmation(base.btc, base.eth, { cutoffEpoch: FAR, placeboReps: 99, source: 'teste' });
        const b = runOosConfirmation(holed.btc, holed.eth, { cutoffEpoch: FAR, placeboReps: 99, source: 'teste' });
        expect(a.filters.gapDropped).toBe(0);
        expect(b.filters.gapDropped).toBeGreaterThanOrEqual(0);
        expect(b.n).toBeLessThanOrEqual(a.n);
        expect(b.verdict).toBe('CONFIRMADO');
        expect(a.meta.source).toBe('teste');
    });
    it('sinal em vela do BTC sem volume é descartado (artefato de mercado parado)', () => {
        const dead = synth(40_000, { plant: true, volume: i => (i % 2 === 0 ? 0 : 1) });
        const r = runOosConfirmation(dead.btc, dead.eth, { cutoffEpoch: FAR, placeboReps: 99 });
        expect(r.filters.liquidityFilterActive).toBe(true);
        expect(r.filters.liquidityDropped).toBeGreaterThan(0);
    });
    it('mercado majoritariamente plano (muitas velas planas) não gera eventos', () => {
        const flat = synth(30_000, { plant: true });
        flat.btc.forEach((c: any, i: number) => { if (i % 10 !== 0) { c.open = c.high = c.low = c.close = 60000; } });
        flat.eth.forEach((c: any, i: number) => { if (i % 10 !== 0) { c.open = c.high = c.low = c.close = 3000; } });
        const r = runOosConfirmation(flat.btc, flat.eth, { cutoffEpoch: FAR, placeboReps: 99 });
        expect(r.n).toBe(0);
        expect(r.filters.liquidityDropped + r.filters.gapDropped).toBeGreaterThanOrEqual(0);
    });
    it('sem volume (Deriv) o filtro de liquidez fica inativo e o resultado anterior se mantém', () => {
        const nv = synth(40_000, { plant: true });
        nv.btc.forEach((c: any) => delete c.volume); nv.eth.forEach((c: any) => delete c.volume);
        const r = runOosConfirmation(nv.btc, nv.eth, { cutoffEpoch: FAR, placeboReps: 99 });
        expect(r.filters.liquidityFilterActive).toBe(false);
        expect(r.verdict).toBe('CONFIRMADO');
    });
});

describe('qualidade por mês e sonda sem callput', () => {
    it('detalha velas planas por mês (acha o mês com mercado ralo)', () => {
        const base = Date.UTC(2026, 6, 31, 23, 50) / 1000; // 31/07 23:50 UTC
        const list: any[] = [];
        for (let i = 0; i < 20; i++) { const flat = i < 10; list.push({ epoch: base + i * 60, open: 1, high: flat ? 1 : 2, low: 1, close: flat ? 1 : 1.5, volume: 1 }); }
        const q = assessQuality('ETH', mergeCandles(list));
        expect(q.months.map(m => m.month)).toEqual(['2026-07', '2026-08']);
        expect(q.months[0].flatShare).toBe(1);
        expect(q.months[1].flatShare).toBe(0);
        expect(buildQualityText([q])).toContain('por mês');
    });
});
