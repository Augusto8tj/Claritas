import { describe, it, expect } from 'vitest';
import { mulberry32 } from './leadlag-backtest';
import { parseForexCsv, detectPairFromFilename, fillShortGaps, derivForexSymbol } from './forex-import';
import { buildUsdBasket, usdLeg } from './usd-basket';
import { fetchDerivCandlesPaged } from './deriv-candle-fetch';
import { runSuperReport } from './super-report';
import { readCandlesFromFile } from './candle-csv-import';

describe('parseForexCsv', () => {
    it('HistData (EST = UTC-5): soma 5 h para chegar em UTC', () => {
        const r = parseForexCsv('20260601 000000;1.08123;1.08130;1.08120;1.08125;0\n20260601 000100;1.08125;1.08140;1.08125;1.08138;0', { tzOffsetHours: 5 });
        expect(r.candles).toHaveLength(2);
        expect(new Date(r.candles[0].epoch * 1000).toISOString()).toBe('2026-06-01T05:00:00.000Z');
        expect(r.candles[1].epoch - r.candles[0].epoch).toBe(60);
        expect(r.formats.histdata).toBe(2);
    });
    it('Dukascopy (DD.MM.YYYY, GMT, com cabeçalho e milissegundos)', () => {
        const r = parseForexCsv('Gmt time,Open,High,Low,Close,Volume\n01.06.2026 00:00:00.000,1.08123,1.08130,1.08120,1.08125,123.4\n01.06.2026 00:01:00.000,1.08125,1.08140,1.08125,1.08138,99', {});
        expect(r.candles).toHaveLength(2);
        expect(new Date(r.candles[0].epoch * 1000).toISOString()).toBe('2026-06-01T00:00:00.000Z');
        expect(r.candles[0].volume).toBeCloseTo(123.4, 6);
        expect(r.skipped).toBe(1);
        expect(r.formats.dukascopy).toBe(2);
    });
    it('MetaTrader (data e hora em colunas separadas) e fuso negativo', () => {
        const r = parseForexCsv('2026.06.01,10:30,1.08,1.09,1.07,1.085,500', { tzOffsetHours: -2 });
        expect(r.candles).toHaveLength(1);
        expect(new Date(r.candles[0].epoch * 1000).toISOString()).toBe('2026-06-01T08:30:00.000Z');
        expect(r.candles[0].high).toBe(1.09);
        expect(r.formats.metatrader).toBe(1);
    });
    it('genérico (ISO e epoch) e linhas inválidas descartadas', () => {
        const r = parseForexCsv('2026-06-01 00:00:00,150.1,150.2,150.0,150.15\n1780272060,150.15,150.3,150.1,150.2\n2026-06-01 00:02:00,0,0,0,0\nlixo');
        expect(r.candles).toHaveLength(2);
        expect(r.skipped).toBe(2);
    });
    it('abre .zip com o .csv dentro usando o parser de Forex', async () => {
        const { deflateRawSync } = await import('node:zlib');
        const csv = '20260601 000000;1.1;1.1;1.1;1.1;0';
        const raw = new TextEncoder().encode(csv), comp = new Uint8Array(deflateRawSync(raw)), name = new TextEncoder().encode('x.csv');
        const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
        lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(18, comp.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, name.length, true); lh.set(name, 30);
        const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(20, comp.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, name.length, true); ch.set(name, 46);
        const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true); ev.setUint32(12, ch.length, true); ev.setUint32(16, lh.length + comp.length, true);
        const all = new Uint8Array(lh.length + comp.length + ch.length + eocd.length); all.set(lh, 0); all.set(comp, lh.length); all.set(ch, lh.length + comp.length); all.set(eocd, lh.length + comp.length + ch.length);
        const r = await readCandlesFromFile({ name: 'DAT_ASCII_EURUSD_M1_2026.zip', arrayBuffer: async () => all.buffer }, t => parseForexCsv(t, { tzOffsetHours: 5 }));
        expect(r.fromZip).toBe(true);
        expect(r.candles).toHaveLength(1);
        expect(new Date(r.candles[0].epoch * 1000).toISOString()).toBe('2026-06-01T05:00:00.000Z');
    });
});

describe('par pelo nome do arquivo', () => {
    it('reconhece variações e rejeita o que não é par', () => {
        expect(detectPairFromFilename('EURUSD_2026-06.csv')).toBe('EURUSD');
        expect(detectPairFromFilename('DAT_ASCII_GBPUSD_M1_2026.zip')).toBe('GBPUSD');
        expect(detectPairFromFilename('usd-jpy-1m.csv')).toBe('USDJPY');
        expect(detectPairFromFilename('C:\\dados\\frxAUDUSD.csv')).toBe('AUDUSD');
        expect(detectPairFromFilename('BTCUSDT-1m-2026-06.csv')).toBeNull();
        expect(detectPairFromFilename('dados.csv')).toBeNull();
        expect(derivForexSymbol('EURUSD')).toBe('frxEURUSD');
    });
});

describe('fillShortGaps', () => {
    const mk = (m: number, p: number) => ({ epoch: 1_000_000 + m * 60, open: p, high: p, low: p, close: p });
    it('preenche até 5 min e deixa buracos maiores (fim de semana)', () => {
        const r = fillShortGaps([mk(0, 1), mk(3, 2), mk(100, 3)], 5);
        expect(r.filled).toBe(2);
        expect(r.candles).toHaveLength(5);
        expect(r.candles[1]).toMatchObject({ close: 1, volume: 0 });
        expect(r.candles[2].epoch - r.candles[1].epoch).toBe(60);
        expect(r.candles[4].epoch - r.candles[3].epoch).toBe(97 * 60); // não preencheu
    });
});

describe('usd-basket', () => {
    const series = (f: (i: number) => number) => Array.from({ length: 50 }, (_, i) => ({ epoch: 1_000_000 + i * 60, open: f(i), high: f(i), low: f(i), close: f(i) }));
    it('sinais e pesos: EURUSD sobe => índice do USD cai; USDJPY sobe => sobe', () => {
        expect(usdLeg('EURUSD')).toEqual({ ccy: 'EUR', sign: -1 });
        expect(usdLeg('USDJPY')).toEqual({ ccy: 'JPY', sign: 1 });
        expect(usdLeg('EURJPY')).toBeNull();
        const s = { EURUSD: series(i => 1.1 * (1 + i * 1e-4)), GBPUSD: series(() => 1.3), USDJPY: series(() => 150), USDCAD: series(() => 1.35) };
        const b = buildUsdBasket(s)!;
        expect(b.pairs.sort()).toEqual(['EURUSD', 'GBPUSD', 'USDCAD', 'USDJPY']);
        expect(Object.values(b.weights).reduce((a, c) => a + c, 0)).toBeCloseTo(1, 9);
        expect(b.candles[49].close).toBeLessThan(b.candles[0].close);
    });
    it('exclui o alvo e o espelho; recusa cesta com menos de 3 pares', () => {
        const s = { EURUSD: series(() => 1.1), GBPUSD: series(() => 1.3), USDJPY: series(() => 150), USDCAD: series(() => 1.35) };
        const b = buildUsdBasket(s, 'USDJPY')!;
        expect(b.pairs).not.toContain('USDJPY');
        expect(buildUsdBasket(s, 'EURUSD', 4)).toBeNull();
        expect(buildUsdBasket({ EURUSD: series(() => 1.1), GBPUSD: series(() => 1.3) })).toBeNull();
    });
});

describe('fetchDerivCandlesPaged', () => {
    it('pagina para trás sem duplicar e para quando o histórico acaba', async () => {
        const all = Array.from({ length: 12_000 }, (_, i) => ({ epoch: 1_000_000 + i * 60, open: 1, high: 1, low: 1, close: 1 }));
        const fetchPage = async (_s: string, _st: 'candles', count: number, _g?: string, end?: number) => all.filter(c => end === undefined || c.epoch <= end).slice(-count);
        const out = await fetchDerivCandlesPaged(fetchPage, 'frxEURUSD', 20_000, undefined, 0);
        expect(out).toHaveLength(12_000);
        expect(new Set(out.map(c => c.epoch)).size).toBe(12_000);
        expect(out[0].epoch).toBeLessThan(out[1].epoch);
    });
});

// ---------- super relatório do Forex: nomes e walk-forward ----------
function gauss(rng: () => number) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); }
function synth(days: number, plant: boolean, seed = 5) {
    const n = days * 1440, rb = mulberry32(seed), re = mulberry32(seed + 7), START = Date.UTC(2026, 0, 5) / 1000;
    let b = Math.log(100), e = Math.log(1.1);
    const drift = new Float64Array(n + 40), btc: any[] = [], eth: any[] = [];
    for (let i = 0; i < n; i++) {
        const ob = b, oe = e, ep = START + i * 60;
        b += gauss(rb) * 1e-4;
        if (rb() < 1 / 200) { b += 1e-3; if (plant) for (let k = 1; k <= 15; k++) drift[i + k] -= 3e-4; }
        e += gauss(re) * 1e-4 + drift[i];
        const mk = (o: number, c: number) => ({ epoch: ep, open: Math.exp(o), close: Math.exp(c), high: Math.exp(Math.max(o, c) + 2e-5), low: Math.exp(Math.min(o, c) - 2e-5) });
        btc.push(mk(ob, b)); eth.push(mk(oe, e));
    }
    return { btc, eth };
}
const fx = { names: { ref: 'USDX', target: 'EURUSD' }, title: '[SUPER RELATÓRIO FOREX V25]', includeWindows: false, holdoutFraction: 0.4, placeboReps: 49, payouts: [85, 90, 95], costScenarios: [0.5, 1, 2] };

describe('super relatório FOREX', () => {
    it('usa os nomes do par nos ids e no texto, sem regra congelada nem janelas', () => {
        const { btc, eth } = synth(60, false);
        const r = runSuperReport(btc, eth, fx);
        expect(r.ok).toBe(true);
        expect(r.frozenId).toBeNull();
        expect(r.results.some(x => x.rule.id === 'A_USDX5_z2.5_ALTA_FADE_h15')).toBe(true);
        expect(r.results.some(x => x.rule.id.includes('BTC'))).toBe(false);
        expect(r.text).toContain('[SUPER RELATÓRIO FOREX V25]');
        expect(r.text).toContain('referência: USDX | alvo: EURUSD');
        expect(r.text).toContain('Rise/Fall payout único 95% (hipotético)');
        expect(r.text).toContain('não aplicável');
    });
    it('walk-forward: efeito real é selecionado no treino e confirmado no holdout', () => {
        const { btc, eth } = synth(150, true);
        const r = runSuperReport(btc, eth, fx);
        const w = r.walkForward!;
        expect(w).toBeDefined();
        expect(w.selected).toBeGreaterThan(0);
        expect(w.confirmed).toBeGreaterThan(0);
        expect(w.rows.some(x => x.id === 'A_USDX5_z2.5_ALTA_FADE_h15' && x.confirmed)).toBe(true);
        expect(w.trainTo).toBeLessThan(w.testFrom);
        expect(r.text).toContain('WALK-FORWARD');
        expect(r.text).toContain('CONFIRMADA');
    });
    it('walk-forward: sem efeito não confirma nada', () => {
        const { btc, eth } = synth(150, false);
        const r = runSuperReport(btc, eth, fx);
        expect(r.walkForward!.confirmed).toBe(0);
        expect(r.survivors).toBe(0);
        expect(r.text).toContain('nenhuma regra da biblioteca');
    });
});
