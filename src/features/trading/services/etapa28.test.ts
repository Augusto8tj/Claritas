import { describe, it, expect } from 'vitest';
import type { CandleData } from '@/lib/types';
import { mulberry32 } from './leadlag-backtest';
import { sweepPayouts, buildSweepText } from './payout-probe';
import { runSuperReport, contractSim } from './super-report';

const dumpEntries = [
    { contract_category: 'callput', contract_type: 'CALL', expiry_type: 'intraday', min_contract_duration: '15m', max_contract_duration: '1d' },
    { contract_category: 'callput', contract_type: 'PUT', expiry_type: 'intraday', min_contract_duration: '15m', max_contract_duration: '1d' },
    { contract_category: 'callputequal', contract_type: 'CALLE', expiry_type: 'intraday', min_contract_duration: '15m', max_contract_duration: '1d' },
    { contract_category: 'callputequal', contract_type: 'PUTE', expiry_type: 'intraday', min_contract_duration: '15m', max_contract_duration: '1d' },
];
describe('varredura: CALLE/PUTE e queda de conexão', () => {
    it('CALLE e PUTE (categoria callputequal) recebem proposal', async () => {
        const seen: string[] = [];
        const r = await sweepPayouts(async () => ({ contracts_for: { available: dumpEntries } }), async (p: any) => { seen.push(p.contract_type); return { proposal: { ask_price: 1, payout: 1.8 } }; }, ['frxEURUSD'], [900], ['CALL', 'PUT', 'CALLE', 'PUTE'], 1, { pauseMs: 0 });
        expect(seen.sort()).toEqual(['CALL', 'CALLE', 'PUT', 'PUTE']);
        expect(r.rows.every(x => x.ok)).toBe(true); expect(r.pending).toEqual([]);
    });
    it('conexão caída: interrompe, não gera dezenas de linhas de erro e lista os símbolos pendentes', async () => {
        let calls = 0;
        const getCf = async (sym: string) => { calls++; if (sym === 'frxAUDUSD') throw new Error('WebSocket não está conectado.'); return { contracts_for: { available: dumpEntries } }; };
        const r = await sweepPayouts(getCf, async () => ({ proposal: { ask_price: 1, payout: 1.8 } }), ['frxEURUSD', 'frxAUDUSD', 'frxUSDCAD', 'frxNZDUSD'], [900, 1800], ['CALL', 'PUT'], 1, { pauseMs: 0 });
        expect(r.pending).toEqual(['frxAUDUSD', 'frxUSDCAD', 'frxNZDUSD']);
        expect(calls).toBe(2); // não tenta contracts_for dos demais
        expect(r.rows.filter(x => x.symbol === 'frxEURUSD' && x.ok).length).toBeGreaterThan(0);
        const t = buildSweepText(r.rows, r.dumps, 0.94, r.pending);
        expect(t).toContain('INTERROMPIDA'); expect(t).toContain('AUDUSD, USDCAD, NZDUSD');
    });
    it('falha no meio da varredura (proposal) também interrompe', async () => {
        let n = 0;
        const r = await sweepPayouts(async () => ({ contracts_for: { available: dumpEntries } }), async () => { if (++n > 2) throw new Error('WS Closed'); return { proposal: { ask_price: 1, payout: 1.8 } }; }, ['frxEURUSD', 'frxGBPUSD'], [900], ['CALL', 'PUT', 'CALLE', 'PUTE'], 1, { pauseMs: 0 });
        expect(r.pending).toContain('frxEURUSD'); expect(r.pending).toContain('frxGBPUSD');
        expect(r.rows.length).toBe(3);
    });
});

describe('Rise/Fall abaixo do mínimo de 15 min', () => {
    const cfg = { sidePayouts: { call: 90, put: 70 }, minRiseFallMin: 15, title: '', names: { ref: 'A', target: 'B' }, payouts: [85], multipliers: [100], costScenarios: [1], frozenId: null, assetNote: '' };
    it('regra de 5 min não recebe EV de Rise/Fall; a de 60 min recebe; sem o parâmetro nada muda', () => {
        const r = mulberry32(3), N = 30000, t0 = Date.UTC(2026, 5, 1) / 1000;
        const mk = (): CandleData[] => { let p = 1; return Array.from({ length: N }, (_, i) => { let u = 0, v = 0; while (u === 0) u = r(); v = r(); p *= Math.exp(1e-4 * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)); return { epoch: t0 + i * 60, open: p, high: p * 1.00001, low: p * 0.99999, close: p, volume: 1 }; }); };
        const rep = runSuperReport(mk(), mk(), { names: { ref: 'USDX', target: 'AUDUSD' }, title: '[T]', includeWindows: false, extended: true, placeboReps: 0 });
        const base = rep.results.find(x => x.events.length > 20)!;
        const h5 = { ...base, rule: { ...base.rule, horizon: 5 } }, h60 = { ...base, rule: { ...base.rule, horizon: 60 } };
        const t5 = contractSim(h5 as any, cfg as any).join('\n'), t60 = contractSim(h60 as any, cfg as any).join('\n'), tOff = contractSim(h5 as any, { ...cfg, minRiseFallMin: undefined } as any).join('\n');
        expect(t5).toContain('Rise/Fall INDISPONÍVEL neste horizonte'); expect(t5).not.toContain('Rise/Fall por LADO'); expect(t5).not.toContain('payout único'); expect(t5).toContain('Multiplier x100');
        expect(t60).toContain('Rise/Fall por LADO'); expect(t60).not.toContain('INDISPONÍVEL');
        expect(tOff).toContain('Rise/Fall por LADO');
    }, 120000);
});
