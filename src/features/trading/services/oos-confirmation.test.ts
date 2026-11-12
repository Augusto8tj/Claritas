import { describe, it, expect } from 'vitest';
import { mulberry32 } from './leadlag-backtest';
import { DEFAULT_HYP_CONFIG } from './horizon-hypotheses';
import { runOosConfirmation, buildOosReport, FROZEN_RULE, DEFAULT_CUTOFF_EPOCH } from './oos-confirmation';
import { probePayout, buildPayoutProbeText } from './payout-probe';

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

describe('regra congelada', () => {
  it('usa exatamente a configuração pré-registrada', () => {
    expect(FROZEN_RULE.id).toBe('H3_ALTA');
    expect(FROZEN_RULE.horizon).toBe(15);
    expect(FROZEN_RULE.config).toBe(DEFAULT_HYP_CONFIG);
    expect(DEFAULT_HYP_CONFIG.zShock).toBe(2.5);
    expect(DEFAULT_HYP_CONFIG.shockWin).toBe(5);
    expect(DEFAULT_HYP_CONFIG.sigmaWin).toBe(120);
  });
  it('o corte padrão é 12/10/2026 00:00 UTC', () => {
    expect(new Date(DEFAULT_CUTOFF_EPOCH * 1000).toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });
});

describe('runOosConfirmation', () => {
  it('poucas velas antes do corte => falha com mensagem', () => {
    const { btc, eth } = synth(2000, true);
    const r = runOosConfirmation(btc, eth, { cutoffEpoch: FAR });
    expect(r.ok).toBe(false);
    expect(buildOosReport(r)).toContain('DADOS INSUFICIENTES');
  });
  it('descarta velas a partir do corte (sem vazamento)', () => {
    const { btc, eth } = synth(20_000, true);
    const cut = START + 10_000 * 60;
    const r = runOosConfirmation(btc, eth, { cutoffEpoch: cut });
    expect(r.ok).toBe(true);
    expect(r.meta.candles).toBe(10_000);
    expect(r.meta.candlesAfterCutoffDiscarded).toBe(10_000);
    expect(r.meta.to).toBeLessThan(cut);
  });
  it('efeito presente => CONFIRMADO', () => {
    const { btc, eth } = synth(40_000, true);
    const r = runOosConfirmation(btc, eth, { cutoffEpoch: FAR });
    expect(r.n).toBeGreaterThanOrEqual(100);
    expect(r.verdict).toBe('CONFIRMADO');
    expect(r.winRateB!).toBeGreaterThan(r.breakeven);
    expect(r.blocks.length).toBeGreaterThan(0);
    expect(buildOosReport(r)).toContain('VEREDITO: CONFIRMADO');
  });
  it('sem efeito => não confirma', () => {
    const { btc, eth } = synth(40_000, false);
    const r = runOosConfirmation(btc, eth, { cutoffEpoch: FAR });
    expect(r.verdict).not.toBe('CONFIRMADO');
    expect(r.conclusion).not.toContain('CONFIRMADO fora');
  });
  it('é determinístico', () => {
    const { btc, eth } = synth(15_000, true, 4);
    const a = runOosConfirmation(btc, eth, { cutoffEpoch: FAR, placeboReps: 99 });
    const b = runOosConfirmation(btc, eth, { cutoffEpoch: FAR, placeboReps: 99 });
    expect(a.pPlacebo).toBe(b.pPlacebo);
    expect(a.winRate).toBe(b.winRate);
  });
});

describe('probePayout', () => {
  const cf = { contracts_for: { available: [
    { contract_category: 'callput', contract_type: 'CALL', min_contract_duration: '15s', max_contract_duration: '1d' },
    { contract_category: 'callput', contract_type: 'PUT', min_contract_duration: '15s', max_contract_duration: '1d' },
    { contract_category: 'multiplier', min_contract_duration: '1m', max_contract_duration: '1d' },
  ] } };
  it('calcula payout e breakeven a partir do proposal', async () => {
    const calls: any[] = [];
    const r = await probePayout(async () => cf, async (p: any) => { calls.push(p); return { proposal: { ask_price: 1, payout: 1.8 } }; }, 'cryETHUSD', 900, 1);
    expect(r.ok).toBe(true);
    expect(r.durationAllowed).toBe(true);
    expect(r.put!.payoutPct).toBeCloseTo(80, 5);
    expect(r.put!.breakeven).toBeCloseTo(1 / 1.8, 6);
    expect(calls[0]).toMatchObject({ contract_type: 'PUT', duration: 15, duration_unit: 'm', basis: 'stake', underlying_symbol: 'cryETHUSD' });
    expect(calls[0].symbol).toBeUndefined(); // a API atual exige underlying_symbol
    expect(buildPayoutProbeText(r)).toContain('nenhuma compra');
  });
  it('duração fora do intervalo não pede proposal', async () => {
    let asked = 0;
    const r = await probePayout(async () => cf, async () => { asked++; return {}; }, 'cryETHUSD', 3 * 86400);
    expect(r.ok).toBe(false);
    expect(asked).toBe(0);
    expect(r.error).toContain('fora do intervalo');
  });
  it('erro do proposal é reportado sem lançar', async () => {
    const r = await probePayout(async () => cf, async () => ({ error: { message: 'Trading is not offered' } }), 'cryETHUSD', 900);
    expect(r.ok).toBe(false);
    expect(r.notes.join(' ')).toContain('Trading is not offered');
  });
  it('captura exceção de rede', async () => {
    const r = await probePayout(async () => { throw new Error('ws fechado'); }, async () => ({}), 'cryETHUSD', 900);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ws fechado');
  });
});

describe('probePayout sem Rise/Fall', () => {
  it('lista as categorias oferecidas quando não há callput', async () => {
    const cf = { contracts_for: { available: [
      { contract_category: 'multiplier', contract_type: 'MULTUP', min_contract_duration: '1m', max_contract_duration: '1d' },
      { contract_category: 'accumulator', contract_type: 'ACCU', min_contract_duration: '1t', max_contract_duration: '1t' },
    ] } };
    const r = await probePayout(async () => cf, async () => ({}), 'cryETHUSD', 900);
    expect(r.ok).toBe(false);
    expect(r.categories.map(c => c.name)).toEqual(['multiplier', 'accumulator']);
    expect(r.error).toContain('multiplier, accumulator');
    expect(buildPayoutProbeText(r)).toContain('Categorias de contrato oferecidas');
  });
});
