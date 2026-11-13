import { describe, it, expect } from 'vitest';
import { mulberry32 } from './leadlag-backtest';
import { inSkewWindow, collectSkewOnce, serializeSkewCsv, parseSkewCsv, mergeSkew, buildSkewEvents, testSkew, skewDiagnostics, buildSkewReport, SKEW_PREREG, type SkewSample } from './payout-skew';

const MON = Date.UTC(2026, 10, 16, 0, 0, 0); // segunda 16/11/2026
const at = (day: number, h: number, m: number) => MON + day * 86400000 + h * 3600000 + m * 60000;

describe('janela de coleta', () => {
    it('seg–sex 08:00 <= h < 16:00 UTC', () => {
        expect(inSkewWindow(at(0, 8, 0))).toBe(true); expect(inSkewWindow(at(0, 15, 59))).toBe(true);
        expect(inSkewWindow(at(0, 7, 59))).toBe(false); expect(inSkewWindow(at(0, 16, 0))).toBe(false);
        expect(inSkewWindow(at(5, 10, 0))).toBe(false); expect(inSkewWindow(at(6, 10, 0))).toBe(false); // sáb/dom
    });
});

describe('coletor (só proposal)', () => {
    it('4 proposals por símbolo, payout líquido em %, spot do proposal, nunca "buy"', async () => {
        const reqs: any[] = [];
        const gp = async (r: any) => { reqs.push(r); return { proposal: { ask_price: 1, payout: r.contract_type === 'CALL' ? 1.86 : 1.77, spot: 1.1 } }; };
        const r = await collectSkewOnce(gp, ['frxEURUSD', 'frxGBPUSD'], () => 5, 0);
        expect(reqs.length).toBe(8); expect(reqs.some(q => 'buy' in q)).toBe(false);
        expect(reqs.every(q => q.underlying_symbol && q.basis === 'stake' && q.duration_unit === 'm')).toBe(true);
        expect(r.samples).toHaveLength(2);
        expect(r.samples[0]).toMatchObject({ symbol: 'frxEURUSD', spot: 1.1, t: 5 });
        expect(r.samples[0].c15).toBeCloseTo(86, 9); expect(r.samples[0].p15).toBeCloseTo(77, 9);
    });
    it('erro de proposal vira null e fica registrado; conexão caída interrompe sem gerar lixo', async () => {
        let n = 0;
        const gp = async () => { n++; if (n === 2) return { error: { message: 'x' } }; return { proposal: { ask_price: 1, payout: 1.8, spot: 2 } }; };
        const r = await collectSkewOnce(gp, ['frxEURUSD'], () => 1, 0);
        expect(r.samples[0].p15).toBeNull(); expect(r.errors.length).toBe(1);
        let m = 0;
        const gp2 = async () => { m++; if (m > 1) throw new Error('WS Closed'); return { proposal: { ask_price: 1, payout: 1.8, spot: 2 } }; };
        const r2 = await collectSkewOnce(gp2, ['frxEURUSD', 'frxGBPUSD'], () => 1, 0);
        expect(r2.down).toBe(true); expect(m).toBe(2); expect(r2.samples).toHaveLength(0);
    });
});

describe('CSV', () => {
    it('ida e volta com nulos; merge sem duplicar', () => {
        const a: SkewSample[] = [{ t: 1, symbol: 'frxEURUSD', spot: 1.1, c15: 86, p15: null, c30: 82, p30: 82 }, { t: 2, symbol: 'frxGBPUSD', spot: 1.3, c15: 80, p15: 70, c30: null, p30: null }];
        const back = parseSkewCsv(serializeSkewCsv(a));
        expect(back).toEqual(a);
        expect(mergeSkew(a, [{ ...a[0], c15: 90 }, { t: 3, symbol: 'frxEURUSD', spot: 1, c15: 1, p15: 1, c30: null, p30: null }]).map(x => [x.t, x.c15])).toEqual([[1, 90], [2, 80], [3, 1]]);
        expect(parseSkewCsv('lixo\n1,2')).toEqual([]);
    });
});

function mk(days: number, seed: number, mode: 'null' | 'planted' | 'past'): SkewSample[] {
    const r = mulberry32(seed), out: SkewSample[] = [];
    for (const sym of ['frxEURUSD', 'frxGBPUSD']) for (let d = 0; d < days; d++) {
        const base = at(d, 8, 0); if (!inSkewWindow(base)) continue;
        const n = 96, spots: number[] = []; let p = 1.1; for (let i = 0; i < n + 4; i++) { p *= 1 + (r() - 0.5) * 4e-4; spots.push(p); }
        for (let i = 0; i < n; i++) {
            let up: boolean;
            if (mode === 'planted') up = (spots[i + 3] > spots[i]) === (r() < 0.7);   // skew aponta (70%) para o lado que vai ganhar
            else if (mode === 'past') up = i >= 3 ? spots[i] < spots[i - 3] : r() < 0.5; // casa "contra" o movimento recente
            else up = r() < 0.5;
            // up = lado com maior payout é CALL
            out.push({ t: base + i * 300000, symbol: sym, spot: spots[i], c15: up ? 90 : 70, p15: up ? 70 : 90, c30: 82, p30: 82 });
        }
    }
    return out;
}

describe('eventos pré-registrados', () => {
    it('lado de maior payout, vitória só estrita, empate=perda, cooldown 15 min, exige t+15 min e janela', () => {
        const base = at(0, 9, 0);
        const S = (m: number, spot: number, c: number, p: number): SkewSample => ({ t: base + m * 60000, symbol: 'frxEURUSD', spot, c15: c, p15: p, c30: null, p30: null });
        const s = [S(0, 1.0, 90, 70), S(5, 1.0, 90, 70), S(10, 1.0, 90, 70), S(15, 1.01, 75, 70), S(20, 1.0, 70, 90), S(25, 1.0, 70, 90), S(30, 0.99, 70, 90), S(35, 1.0, 70, 90), S(45, 1.0, 80, 79)];
        const ev = buildSkewEvents(s);
        // t=0: CALL (90), spot em t+15 = 1.01 > 1.0 => vitória, EV +0.90; t=5 e t=10 ficam no cooldown; t=15: skew 5 pp < 10 => fora;
        // t=20: PUT (90), spot em t+35 = 1.0 (= entrada 1.0) => empate = perda (-1), t=25 em cooldown; t=45: sem t+60 => fora
        expect(ev.map(e => [e.side, e.win, e.ev])).toEqual([['CALL', true, 0.9], ['PUT', false, -1]]);
        const out = buildSkewEvents([S(-120, 1, 90, 70), S(-105, 1.01, 70, 90)]); // 06:58 UTC: fora da janela
        expect(out).toHaveLength(0);
    });
});

describe('teste pré-registrado (m=1)', () => {
    it('ruído puro: NÃO é confirmado (e o EV é negativo pela margem da casa)', () => {
        const ev = buildSkewEvents(mk(60, 11, 'null')), t = testSkew(ev);
        expect(t.n).toBeGreaterThanOrEqual(300); expect(t.verdict).toBe('NÃO CONFIRMADO'); expect(t.mean).toBeLessThan(0);
    });
    it('skew plantado (70% de acerto no lado de maior payout): CONFIRMADO', () => {
        const t = testSkew(buildSkewEvents(mk(60, 12, 'planted')));
        expect(t.verdict).toBe('CONFIRMADO'); expect(t.mean).toBeGreaterThan(0); expect(t.halves[0]).toBeGreaterThan(0); expect(t.halves[1]).toBeGreaterThan(0);
    });
    it('N pequeno: INCONCLUSIVO', () => {
        const t = testSkew(buildSkewEvents(mk(4, 13, 'planted')));
        expect(t.verdict).toBe('INCONCLUSIVO');
    });
    it('diagnóstico descritivo: skew guiado pelo movimento recente aparece como correlação', () => {
        const d = skewDiagnostics(mk(30, 14, 'past')), d0 = skewDiagnostics(mk(30, 15, 'null'));
        expect(Math.abs(d.rPast15)).toBeGreaterThan(0.3); expect(Math.abs(d0.rPast15)).toBeLessThan(0.1);
        expect(d.fracBig).toBeCloseTo(1, 9);
    });
    it('relatório', () => {
        const txt = buildSkewReport(mk(20, 16, 'null'));
        expect(txt).toContain(SKEW_PREREG.id); expect(txt).toContain('VEREDITO'); expect(txt).toContain('Nada aqui autoriza execução'); expect(txt).toContain('Poder');
        expect(buildSkewReport([])).toContain('Sem amostras');
    });
});
