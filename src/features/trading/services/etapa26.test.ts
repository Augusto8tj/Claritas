import { describe, it, expect } from 'vitest';
import type { CandleData } from '@/lib/types';
import { mulberry32 } from './leadlag-backtest';
import { parseForexCsv, weekendFuseDiagnostics } from './forex-import';
import { durationStrToSeconds, secondsToApiDuration, normalizeContractEntries, buildContractsForDump, sweepPayouts, buildSweepText, dumpContractsFor } from './payout-probe';
import { sideEv, computeFeatures, buildRules, runSuperReport, type Ev } from './super-report';
import { alignBars } from './horizon-hypotheses';
import { kellyFraction, martingaleCycle, simulateScheme, runBankrollSimulation, DEFAULT_BANKROLL_CFG } from './bankroll-sim';
import { confirmRule, runConfirmation, PREREG_FX } from './forex-confirmation';

// ---------- dados sintéticos ----------
const T0 = Date.UTC(2026, 5, 1, 0, 0, 0) / 1000; // segunda 01/06/2026 00:00 UTC
function walk(n: number, seed: number, sigma = 1e-4, start = 1.1): number[] {
    const r = mulberry32(seed), out: number[] = []; let lp = Math.log(start);
    const gauss = () => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    for (let i = 0; i < n; i++) { lp += sigma * gauss(); out.push(Math.exp(lp)); }
    return out;
}
function candles(closes: number[], t0 = T0): CandleData[] {
    return closes.map((c, i) => { const o = i ? closes[i - 1] : c; return { epoch: t0 + i * 60, open: o, high: Math.max(o, c) * 1.00002, low: Math.min(o, c) * 0.99998, close: c, volume: 100 }; });
}

describe('forexsb Forex Strategy Builder (arquivo real do usuário)', () => {
    const FSB = [
        '"2026-05-01 20:55\t1.17201\t1.17201\t1.17188\t1.17198\t119"',
        '"2026-05-01 20:56\t1.17203\t1.17209\t1.17192\t1.17193\t134"',
        '"2026-05-01 20:59\t1.17194\t1.17197\t1.17163\t1.17169\t147"',
        '"2026-05-03 21:00\t1.17461\t1.17462\t1.17454\t1.17462\t10"',
        '"2026-05-03 21:01\t1.17465\t1.17465\t1.17448\t1.17448\t18"',
    ].join('\n');
    it('lê aspas externas + tab + sem segundos, em UTC (tz 0), formato fsb', () => {
        const r = parseForexCsv(FSB, { tzOffsetHours: 0 });
        expect(r.candles).toHaveLength(5);
        expect(r.skipped).toBe(0);
        expect(r.formats.fsb).toBe(5);
        expect(new Date(r.candles[0].epoch * 1000).toISOString()).toBe('2026-05-01T20:55:00.000Z');
        expect(r.candles[0]).toMatchObject({ open: 1.17201, high: 1.17201, low: 1.17188, close: 1.17198, volume: 119 });
        expect(new Date(r.candles[3].epoch * 1000).toISOString()).toBe('2026-05-03T21:00:00.000Z');
    });
    it('a versão com cabeçalho e coluna Spread (MetaTrader do forexsb) também é lida', () => {
        const r = parseForexCsv('"Time\tOpen\tHigh\tLow\tClose\tVolume\tSpread"\n"2026-05-01 06:53:00\t1.17405\t1.1743\t1.17404\t1.17429\t379\t3"', {});
        expect(r.candles).toHaveLength(1);
        expect(r.skipped).toBe(1);
        expect(r.candles[0].volume).toBe(379);
    });
});

describe('diagnóstico de fuso pelo fim de semana', () => {
    // fecha sexta 20:59 UTC e reabre domingo 21:00 UTC (verão dos EUA), 5 semanas
    const mk = (shiftH: number) => {
        const out: CandleData[] = [];
        for (let w = 0; w < 5; w++) {
            const fri = Date.UTC(2026, 4, 1 + 7 * w, 20 + shiftH, 55, 0) / 1000, sun = Date.UTC(2026, 4, 3 + 7 * w, 21 + shiftH, 0, 0) / 1000;
            for (let k = 0; k < 5; k++) out.push({ epoch: fri + k * 60, open: 1, high: 1, low: 1, close: 1 });
            for (let k = 0; k < 3; k++) out.push({ epoch: sun + k * 60, open: 1, high: 1, low: 1, close: 1 });
        }
        return out;
    };
    it('UTC correto: não suspeito', () => {
        const d = weekendFuseDiagnostics(mk(0));
        expect(d.gaps.length).toBe(5);
        expect(d.closeHours['20']).toBe(5); expect(d.openHours['21']).toBe(5);
        expect(d.suspicious).toBe(false);
    });
    it('deslocado em 5 h: suspeito', () => {
        const d = weekendFuseDiagnostics(mk(-8)); // 12h/13h UTC
        expect(d.suspicious).toBe(true);
        expect(d.text).toContain('SUSPEITO');
    });
});

describe('contracts_for bruto e varredura de payout', () => {
    const available = [
        { contract_category: 'callput', contract_type: 'CALL', start_type: 'spot', expiry_type: 'intraday', barrier_category: 'euro_atm', min_contract_duration: '15m', max_contract_duration: '1d' },
        { contract_category: 'callput', contract_type: 'PUT', start_type: 'spot', expiry_type: 'intraday', barrier_category: 'euro_atm', min_contract_duration: '15m', max_contract_duration: '1d' },
        { contract_category: 'callput', contract_type: 'CALL', start_type: 'spot', expiry_type: 'daily', barrier_category: 'euro_atm', min_contract_duration: '1d', max_contract_duration: '365d' },
        { contract_category: 'callput', contract_type: 'CALL', start_type: 'forward', expiry_type: 'intraday', barrier_category: 'euro_atm', min_contract_duration: '5m', max_contract_duration: '1d' },
        { contract_category: 'callput', contract_type: 'CALL', start_type: 'spot', expiry_type: 'tick', barrier_category: 'euro_atm', min_contract_duration: '5t', max_contract_duration: '10t' },
    ];
    it('converte durações', () => {
        expect(durationStrToSeconds('15m')).toBe(900); expect(durationStrToSeconds('1d')).toBe(86400); expect(durationStrToSeconds('5t')).toBeNull();
        expect(secondsToApiDuration(900)).toEqual({ duration: 15, duration_unit: 'm' }); expect(secondsToApiDuration(7200)).toEqual({ duration: 2, duration_unit: 'h' });
        expect(secondsToApiDuration(86400)).toEqual({ duration: 1, duration_unit: 'd' });
    });
    it('dump mostra a discrepância: "min 1d" (daily) e "min 15m" (intraday) são entradas diferentes', () => {
        const txt = buildContractsForDump('frxAUDUSD', normalizeContractEntries(available));
        expect(txt).toContain('5 entradas');
        expect(txt).toContain('expiry=daily'); expect(txt).toContain('expiry=intraday');
        expect(txt).toContain('CALL/intraday: 15m..1d');
    });
    it('varredura: só proposal (nunca compra), payout/breakeven por lado, tick e forward ignorados', async () => {
        const calls: any[] = [];
        const getContractsFor = async () => ({ contracts_for: { available } });
        const getProposal = async (p: any) => { calls.push(p); if (p.contract_type === 'CALL') return { proposal: { ask_price: 1, payout: 1.91 } }; if (p.contract_type === 'PUT') return { proposal: { ask_price: 1, payout: 1.71 } }; return { error: { message: 'não oferecido' } }; };
        const r = await sweepPayouts(getContractsFor, getProposal, ['frxAUDUSD'], [900, 3600], ['CALL', 'PUT', 'CALLE'], 1, { pauseMs: 0, now: () => Date.UTC(2026, 10, 12, 15, 0, 0) });
        expect(r.rows).toHaveLength(6);
        const call15 = r.rows.find(x => x.type === 'CALL' && x.durationSec === 900)!, put15 = r.rows.find(x => x.type === 'PUT' && x.durationSec === 900)!;
        expect(call15.ok).toBe(true); expect(call15.payoutPct).toBeCloseTo(91, 6); expect(call15.breakeven).toBeCloseTo(1 / 1.91, 6); expect(call15.hourUtc).toBe(15);
        expect(put15.payoutPct).toBeCloseTo(71, 6); expect(put15.breakeven).toBeCloseTo(1 / 1.71, 6);
        // CALLE não existe nas entradas: nunca vira proposal
        expect(r.rows.filter(x => x.type === 'CALLE').every(x => !x.ok && /nenhuma entrada/.test(x.error!))).toBe(true);
        expect(calls.every(c => ['CALL', 'PUT'].includes(c.contract_type))).toBe(true);
        expect(calls[0]).toMatchObject({ underlying_symbol: 'frxAUDUSD', basis: 'stake', duration: 15, duration_unit: 'm' });
        expect(calls.some(c => 'buy' in c)).toBe(false);
        const txt = buildSweepText(r.rows, r.dumps);
        expect(txt).toContain('NENHUM cenário mediu payout próximo de 94%');
        expect(txt).toContain('frxAUDUSD 15min'); expect(txt).toContain('margem');
    });
    it('contracts_for com erro vira linhas sem preço e dump com erro', async () => {
        const d = await dumpContractsFor(async () => ({ error: { message: 'x' } }), 'frxFOO');
        expect(d.ok).toBe(false); expect(d.text).toContain('erro x');
        const r = await sweepPayouts(async () => ({ error: { message: 'x' } }), async () => ({}), ['frxFOO'], [900], ['CALL'], 1, { pauseMs: 0 });
        expect(r.rows[0].ok).toBe(false);
    });
    it('cenário perto de 94% é listado', async () => {
        const r = await sweepPayouts(async () => ({ contracts_for: { available } }), async () => ({ proposal: { ask_price: 1, payout: 1.94 } }), ['frxEURUSD'], [900], ['CALL'], 1, { pauseMs: 0 });
        expect(buildSweepText(r.rows, r.dumps)).toContain('Cenários com payout >= 93%');
    });
});

describe('EV por lado (sideEv)', () => {
    const ev = (dir: number, retLong: number): Ev => ({ i: 0, day: 0, month: '2026-11', dir, retLong, advLong: 0, advShort: 0 });
    it('CALL usa payout do CALL e PUT o do PUT; empate = perda', () => {
        const evs = [...Array(6).fill(0).map(() => ev(1, 5)), ...Array(4).fill(0).map(() => ev(1, -5)), ...Array(5).fill(0).map(() => ev(-1, -5)), ...Array(5).fill(0).map(() => ev(-1, 0))];
        const x = sideEv(evs, { call: 91, put: 71 });
        expect(x.call.n).toBe(10); expect(x.call.rate).toBeCloseTo(0.6, 9);
        expect(x.put.n).toBe(10); expect(x.put.rate).toBeCloseTo(0.5, 9); // empates (retorno 0) contam como perda
        expect(x.beCall).toBeCloseTo(1 / 1.91, 9); expect(x.bePut).toBeCloseTo(1 / 1.71, 9);
        const evCall = 0.6 * 1.91 - 1, evPut = 0.5 * 1.71 - 1;
        expect(x.ev).toBeCloseTo((evCall + evPut) / 2, 9);
        expect(x.evLow).toBeLessThan(x.ev);
    });
    it('lado sem payout medido => ev indisponível', () => {
        const x = sideEv([ev(1, 1), ev(-1, 1)], { call: 91, put: null });
        expect(x.known).toBe(false); expect(Number.isNaN(x.ev)).toBe(true);
    });
});

describe('biblioteca de regras e relatório', () => {
    const n = 3000, ref = candles(walk(n, 1)), tgt = candles(walk(n, 2));
    const f = computeFeatures(alignBars(ref, tgt));
    it('150 regras base, 190 com as famílias F e G; ids únicos', () => {
        expect(buildRules(f).length).toBe(150);
        const ext = buildRules(f, { ref: 'USDX', target: 'AUDUSD' }, true);
        expect(ext.length).toBe(190);
        expect(new Set(ext.map(r => r.id)).size).toBe(190);
        expect(ext.filter(r => r.family === 'F').length).toBe(24); expect(ext.filter(r => r.family === 'G').length).toBe(16);
    });
    it('rótulo "c/ referência parada" em Forex e "c/ BTC parado" em cripto', () => {
        const fx = buildRules(f, { ref: 'USDX', target: 'AUDUSD' }).find(r => r.id === 'C_SPREAD_z2_QUIETO_h60')!;
        const cr = buildRules(f).find(r => r.id === 'C_SPREAD_z2_QUIETO_h60')!;
        expect(fx.label).toContain('c/ referência parada'); expect(fx.label).not.toContain('BTC');
        expect(cr.label).toContain('c/ BTC parado');
    });
    it('super relatório: permutação de sinais (p válido, reps=0 desliga), famílias F/G e EV por lado no texto', () => {
        const N = 30000, a = candles(walk(N, 11)), b = candles(walk(N, 12));
        const opts = { names: { ref: 'USDX', target: 'AUDUSD' }, title: '[T]', includeWindows: false, extended: true, holdoutFraction: 0.4, sidePayouts: { call: 91, put: 71 }, seed: 5 };
        const r = runSuperReport(a, b, { ...opts, placeboReps: 199 });
        expect(r.ok).toBe(true);
        expect(r.results.length).toBe(190);
        const withP = r.results.filter(x => x.placebo !== undefined);
        expect(withP.length).toBeGreaterThan(0); expect(withP.length).toBeLessThanOrEqual(10);
        withP.forEach(x => { expect(x.placebo!).toBeGreaterThan(0); expect(x.placebo!).toBeLessThanOrEqual(1); });
        expect(r.text).toContain('Família F'); expect(r.text).toContain('Família G'); expect(r.text).toContain('Rise/Fall por LADO'); expect(r.text).toContain('perm.sinais');
        expect(r.text).not.toContain('placebo ');
        const r0 = runSuperReport(a, b, { ...opts, placeboReps: 0 });
        expect(r0.results.every(x => x.placebo === undefined)).toBe(true);
        // dados aleatórios: nenhum sobrevivente ao Holm
        expect(r.survivors).toBe(0);
    }, 120000);
});

describe('simulador de banca', () => {
    it('Kelly e ciclo do martingale batem com os números combinados', () => {
        expect(kellyFraction(0.5, 94)).toBe(0);
        expect(kellyFraction(0.6, 100)).toBeCloseTo(0.2, 9);
        const c = martingaleCycle(0.5, 94, 1, 3);
        expect(c.fullLoss).toBe(7); expect(c.pFullLoss).toBeCloseTo(0.125, 9);
        expect(c.evPerStaked).toBeCloseTo(-0.03, 6); expect(c.evPerCycle).toBeCloseTo(-0.0903, 3);
    });
    it('EV por USD apostado é o mesmo em stake fixo e martingale (p=50%, payout 89% => -5,5%) e o martingale tem mais ruína', () => {
        const cfg = { ...DEFAULT_BANKROLL_CFG, p: 0.5, payoutPct: 89, bankroll: 30, bets: 300, paths: 4000 };
        const fix = simulateScheme(cfg, 'FIXO'), mar = simulateScheme(cfg, 'MARTINGALE');
        expect(fix.theoreticalEvPerStake).toBeCloseTo(-0.055, 9);
        expect(fix.empiricalEvPerStake).toBeGreaterThan(-0.075); expect(fix.empiricalEvPerStake).toBeLessThan(-0.035);
        expect(mar.empiricalEvPerStake).toBeGreaterThan(-0.075); expect(mar.empiricalEvPerStake).toBeLessThan(-0.035);
        expect(mar.ruinProb).toBeGreaterThan(fix.ruinProb);
    });
    it('sem vantagem o Kelly não aposta; com p=55%/94% o EV é +6,7%', () => {
        const k = simulateScheme({ ...DEFAULT_BANKROLL_CFG, p: 0.5, payoutPct: 89, paths: 50, bets: 50 }, 'KELLY');
        expect(k.kellyFull).toBe(0); expect(k.totalStaked).toBe(0);
        const r = runBankrollSimulation({ ...DEFAULT_BANKROLL_CFG, p: 0.55, payoutPct: 94, paths: 50, bets: 50 });
        expect(r.results[0].theoreticalEvPerStake).toBeCloseTo(0.067, 9);
        expect(r.text).toContain('igual para QUALQUER esquema');
    });
});

describe('confirmação pré-registrada (m=1)', () => {
    const N = 60000;
    const series = () => {
        const base = walk(N, 100, 1e-4);
        const mk = (seed: number, beta: number) => { const idio = walk(N, seed, 6e-5, 1); return base.map((b, i) => Math.exp(Math.log(1.1) + beta * (Math.log(b) - Math.log(1.1)) + (Math.log(idio[i])))); };
        return { EURUSD: candles(mk(101, -1)), GBPUSD: candles(mk(102, -0.9)), USDJPY: candles(mk(103, 1)), USDCAD: candles(mk(104, 0.8)), USDCHF: candles(mk(105, 0.9)), AUDUSD: candles(mk(106, -0.7)) } as Record<string, CandleData[]>;
    };
    const cutoff = T0 + 25 * 86400;
    it('constantes pré-registradas', () => {
        expect(PREREG_FX.ruleId).toBe('C_SPREAD_z2_LIVRE_h60'); expect(PREREG_FX.primaryTarget).toBe('AUDUSD');
        expect(new Date(PREREG_FX.cutoffEpoch * 1000).toISOString()).toBe('2026-10-09T00:00:00.000Z'); expect(PREREG_FX.alpha).toBe(0.05);
    });
    it('regra inexistente e dados curtos não rodam', () => {
        const s = series();
        expect(confirmRule(s.EURUSD, s.AUDUSD, 'AUDUSD', { ruleId: 'XYZ', cutoffEpoch: cutoff }).ok).toBe(false);
        expect(confirmRule(s.EURUSD.slice(0, 100), s.AUDUSD.slice(0, 100), 'AUDUSD').ok).toBe(false);
    });
    it('em ruído puro: roda, separa PRÉ/DESCOBERTA e não "confirma"', () => {
        const s = series();
        const { results, text } = runConfirmation(s, { cutoffEpoch: cutoff, sidePayouts: { call: 91, put: 71 }, costBps: 4 });
        expect(results.length).toBe(6);
        const aud = results.find(r => r.target === 'AUDUSD')!;
        expect(aud.ok).toBe(true);
        expect(aud.pre!.n).toBeGreaterThan(20); expect(aud.disc!.n).toBeGreaterThan(20);
        expect(aud.pre!.months.length).toBeGreaterThan(0);
        expect(['NÃO CONFIRMADO', 'INCONCLUSIVO', 'CONFIRMADO']).toContain(aud.verdict);
        expect(text).toContain('PREREG-FX-C1'); expect(text).toContain('VEREDITO'); expect(text).toContain('Bonferroni K=5'); expect(text).toContain('Rise/Fall por lado');
        expect(text).toContain('Nada aqui autoriza execução');
    }, 120000);
    it('com poucos pares da cesta não executa e avisa', () => {
        const s = series();
        const r = runConfirmation({ AUDUSD: s.AUDUSD, EURUSD: s.EURUSD }, { cutoffEpoch: cutoff });
        expect(r.results.length).toBe(0); expect(r.text).toContain('não executado');
    });
});
