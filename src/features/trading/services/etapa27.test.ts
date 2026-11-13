import { describe, it, expect } from 'vitest';
import type { CandleData } from '@/lib/types';
import { mulberry32 } from './leadlag-backtest';
import { isUsDst, rolloverUtcHour, rolloverMask } from './fx-calendar';
import { runSuperReport } from './super-report';
import { runConfirmation } from './forex-confirmation';

const ep = (s: string) => Date.parse(s + 'Z') / 1000;

describe('calendário FX', () => {
    it('horário de verão dos EUA 2026 (8/3 07:00 UTC a 1/11 06:00 UTC)', () => {
        expect(isUsDst(ep('2026-03-08T06:59:00'))).toBe(false); expect(isUsDst(ep('2026-03-08T07:00:00'))).toBe(true);
        expect(isUsDst(ep('2026-10-31T23:00:00'))).toBe(true); expect(isUsDst(ep('2026-11-01T06:00:00'))).toBe(false);
    });
    it('hora da virada: 21 no verão, 22 no inverno, inclusive no dia da troca', () => {
        expect(rolloverUtcHour(ep('2026-07-15T10:00:00'))).toBe(21); expect(rolloverUtcHour(ep('2026-11-13T10:00:00'))).toBe(22);
        expect(rolloverUtcHour(ep('2026-11-01T21:30:00'))).toBe(22); expect(rolloverUtcHour(ep('2026-03-08T21:30:00'))).toBe(21);
    });
    it('máscara: 46 velas por dia ([-15, +30] min), nas horas certas', () => {
        const eps: number[] = []; for (let m = 0; m < 1440; m++) eps.push(ep('2026-07-15T00:00:00') + m * 60);
        const mk = rolloverMask(eps);
        expect(mk.reduce((a, x) => a + x, 0)).toBe(46);
        expect(mk[20 * 60 + 45]).toBe(1); expect(mk[20 * 60 + 44]).toBe(0); expect(mk[21 * 60 + 30]).toBe(1); expect(mk[21 * 60 + 31]).toBe(0);
        const w: number[] = []; for (let m = 0; m < 1440; m++) w.push(ep('2026-11-10T00:00:00') + m * 60);
        expect(rolloverMask(w)[21 * 60 + 45]).toBe(1); expect(rolloverMask(w)[20 * 60 + 45]).toBe(0);
    });
});

function gauss(r: () => number) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function series(days: number, plant: boolean) {
    const r = mulberry32(31), t0 = ep('2026-06-01T00:00:00');
    const a: CandleData[] = [], b: CandleData[] = []; let pa = 1.1, pb = 0.7;
    for (let d = 0; d < days; d++) for (let m = 0; m < 1440; m++) {
        const t = t0 + d * 86400 + m * 60, dow = new Date(t * 1000).getUTCDay();
        if (dow === 6 || (dow === 5 && m >= 21 * 60) || (dow === 0 && m < 21 * 60)) continue;
        // artefato de cotação: bid cai 12 bps entre 20:00 e 21:00 e volta entre 21:00 e 22:00 (verão: virada 21:00 UTC)
        const h = Math.floor(m / 60), drift = plant ? (h === 20 ? -12 / 60 : h === 21 ? 12 / 60 : 0) : 0;
        const oa = pa, ob = pb;
        pa *= Math.exp(gauss(r) * 1e-4); pb *= Math.exp((gauss(r) * 1e-4) + drift * 1e-4);
        a.push({ epoch: t, open: oa, high: Math.max(oa, pa), low: Math.min(oa, pa), close: pa, volume: 1 });
        b.push({ epoch: t, open: ob, high: Math.max(ob, pb), low: Math.min(ob, pb), close: pb, volume: 1 });
    }
    return { a, b };
}

describe('filtro da virada no super relatório', () => {
    it('artefato plantado: aparece como "padrão" sem o filtro e some com o filtro', () => {
        const { a, b } = series(75, true);
        const base = { names: { ref: 'USDX', target: 'AUDUSD' }, includeWindows: false, extended: true, placeboReps: 0, minCandles: 20000 };
        const off = runSuperReport(a, b, { ...base, excludeRollover: false });
        const on = runSuperReport(a, b, { ...base, excludeRollover: true });
        const e20off = off.results.find(x => x.rule.id === 'E_HORA20_h60')!, e20on = on.results.find(x => x.rule.id === 'E_HORA20_h60')!;
        expect(e20off.stats.n).toBeGreaterThan(40); expect(e20off.pAdj).toBeLessThan(0.05); expect(off.survivors).toBeGreaterThanOrEqual(1);
        expect(e20on.stats.n).toBe(0);
        expect(on.survivors).toBe(0);
        expect(on.text).toContain('FILTRO DA VIRADA ATIVO'); expect(off.text).toContain('FILTRO DA VIRADA DESLIGADO');
    }, 120000);
});

describe('replicação exploratória com Bonferroni no veredito', () => {
    it('texto informa alfa = 5%/K', () => {
        const r = mulberry32(5), N = 60000, t0 = ep('2026-06-01T00:00:00');
        const base: number[] = []; let p = 0; for (let i = 0; i < N; i++) { p += gauss(r) * 1e-4; base.push(p); }
        const mk = (seed: number, beta: number): CandleData[] => { const q = mulberry32(seed); let x = 0; return base.map((b, i) => { x += gauss(q) * 6e-5; const c = Math.exp(beta * b + x); return { epoch: t0 + i * 60, open: c, high: c, low: c, close: c, volume: 1 }; }); };
        const s: Record<string, CandleData[]> = { EURUSD: mk(1, -1), GBPUSD: mk(2, -0.9), USDJPY: mk(3, 1), USDCAD: mk(4, 0.8), USDCHF: mk(5, 0.9), AUDUSD: mk(6, -0.7) };
        const out = runConfirmation(s, { cutoffEpoch: t0 + 25 * 86400 });
        expect(out.text).toContain('alfa = 5%/5');
        expect(out.results.find(x => x.target === 'AUDUSD')!.ok).toBe(true);
    }, 120000);
});
