import { describe, it, expect } from 'vitest';
import { mulberry32 } from './leadlag-backtest';
import { runOosConfirmation } from './oos-confirmation';
import { compareWindows, buildWindowComparisonReport, normalCdf, twoProportionTest, DESC_START_EPOCH } from './window-comparison';

function gauss(rng: () => number) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); }
const START = Date.UTC(2026, 5, 1) / 1000; // 01/06/2026 00:00 UTC
/** plantFromEpoch: o efeito (ETH cai após choque de alta do BTC) só existe a partir dessa época (ou nunca). */
function synth(days: number, plantFromEpoch: number | null, seed = 5) {
    const n = days * 1440;
    const rb = mulberry32(seed), re = mulberry32(seed + 7);
    let b = Math.log(60000), e = Math.log(3000);
    const drift = new Float64Array(n + 40);
    const btc: any[] = [], eth: any[] = [];
    for (let i = 0; i < n; i++) {
        const ob = b, oe = e, ep = START + i * 60;
        b += gauss(rb) * 1e-4;
        if (rb() < 1 / 200) { b += 1e-3; if (plantFromEpoch !== null && ep >= plantFromEpoch) for (let k = 1; k <= 15; k++) drift[i + k] -= 3e-4; }
        e += gauss(re) * 1e-4 + drift[i];
        const mk = (o: number, c: number) => ({ epoch: ep, open: Math.exp(o), close: Math.exp(c), high: Math.exp(Math.max(o, c) + 2e-5), low: Math.exp(Math.min(o, c) - 2e-5), volume: 1 });
        btc.push(mk(ob, b)); eth.push(mk(oe, e));
    }
    return { btc, eth };
}

describe('estatística auxiliar', () => {
    it('normalCdf e teste de duas proporções', () => {
        expect(normalCdf(0)).toBeCloseTo(0.5, 6);
        expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
        expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
        const t = twoProportionTest(180, 300, 150, 300);
        expect(t.diff).toBeCloseTo(0.1, 6);
        expect(t.p).toBeLessThan(0.05);
        expect(twoProportionTest(150, 300, 150, 300).p).toBeCloseTo(1, 6);
        expect(twoProportionTest(1, 0, 1, 1).p).toBe(1);
    });
});

describe('janela de eventos no OOS', () => {
    it('conta só eventos dentro de [from, to] e informa a janela', () => {
        const { btc, eth } = synth(40, null);
        const all = runOosConfirmation(btc, eth, { cutoffEpoch: START + 40 * 86400, placeboReps: 49 });
        const part = runOosConfirmation(btc, eth, { cutoffEpoch: START + 40 * 86400, placeboReps: 49, eventFromEpoch: START + 20 * 86400, eventToEpoch: START + 30 * 86400 });
        expect(part.n).toBeGreaterThan(0);
        expect(part.n).toBeLessThan(all.n);
        expect(part.meta.window.days).toBeCloseTo(10, 1);
    });
});

describe('compareWindows', () => {
    it('efeito só na janela de descoberta => "efeito só na janela" e diferença significativa', () => {
        const { btc, eth } = synth(150, DESC_START_EPOCH);
        const c = compareWindows(btc, eth, { placeboReps: 49, source: 'teste' });
        expect(c.ok).toBe(true);
        expect(c.desc.winRate).toBeGreaterThan(0.7);
        expect(c.pre.winRate).toBeLessThan(0.62);
        expect(c.pDiff).toBeLessThan(0.05);
        expect(c.reproduces).toBe(true);
        expect(c.interpretation).toContain('SÓ NA JANELA DE DESCOBERTA');
        expect(buildWindowComparisonReport(c)).toContain('DIFERENÇA DESC - PRÉ');
    });
    it('sem efeito em lugar nenhum => a fonte não reproduz os 62,2%', () => {
        const { btc, eth } = synth(150, null);
        const c = compareWindows(btc, eth, { placeboReps: 49 });
        expect(c.reproduces).toBe(false);
        expect(c.interpretation).toContain('NÃO REPRODUZ');
    });
    it('PRÉ com poucos dias (só outubro) => não conclui', () => {
        const { btc, eth } = synth(150, DESC_START_EPOCH);
        const oct = Date.UTC(2026, 9, 1) / 1000;
        const c = compareWindows(btc.filter((x: any) => x.epoch >= oct), eth.filter((x: any) => x.epoch >= oct), { placeboReps: 49 });
        expect(c.interpretation).toContain('COBERTURA INSUFICIENTE da janela PRÉ');
    });
    it('cobertura curta da janela de descoberta => sem conclusão', () => {
        const { btc, eth } = synth(138, null); // termina ~17/10: só ~4 dias da janela
        const c = compareWindows(btc, eth, { placeboReps: 49 });
        expect(c.interpretation).toContain('COBERTURA INSUFICIENTE');
    });
});
