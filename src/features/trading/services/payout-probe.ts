// src/features/trading/services/payout-probe.ts
/**
 * @fileOverview ETAPA 19 — SONDA DE PAYOUT: pede `contracts_for` e um `proposal` (NUNCA compra) para saber se a
 * duração desejada existe para CALL/PUT e qual o payout real, logo o breakeven exato (= ask/payout).
 */
import { parseDurationToSeconds } from './pilot-guardrails';

export interface ProbeSide { payoutPct: number; breakeven: number; ask: number; payout: number; }
export interface PayoutProbeResult {
    ok: boolean; error?: string; symbol: string; durationSec: number; stake: number;
    minDurationSec: number | null; maxDurationSec: number | null; durationAllowed: boolean;
    put: ProbeSide | null; call: ProbeSide | null; notes: string[];
    categories: { name: string; count: number; types: string[]; minDuration: string; maxDuration: string }[];
}

type Fn = (arg: any) => Promise<any>;

export async function probePayout(getContractsFor: Fn, getProposal: Fn, symbol: string, durationSec: number, stake = 1): Promise<PayoutProbeResult> {
    const res: PayoutProbeResult = { ok: false, symbol, durationSec, stake, minDurationSec: null, maxDurationSec: null, durationAllowed: false, put: null, call: null, notes: [], categories: [] };
    try {
        const cf = await getContractsFor(symbol);
        if (cf?.error) { res.error = `contracts_for: ${cf.error.message}`; return res; }
        const available: any[] = cf?.contracts_for?.available || [];
        const byCat = new Map<string, { count: number; types: Set<string>; mins: string[]; maxs: string[] }>();
        for (const c of available) {
            const k = String(c.contract_category ?? 'desconhecida');
            const g = byCat.get(k) ?? { count: 0, types: new Set<string>(), mins: [], maxs: [] };
            g.count++; if (c.contract_type) g.types.add(String(c.contract_type));
            if (c.min_contract_duration) g.mins.push(String(c.min_contract_duration));
            if (c.max_contract_duration) g.maxs.push(String(c.max_contract_duration));
            byCat.set(k, g);
        }
        res.categories = Array.from(byCat.entries()).map(([name, g]) => ({ name, count: g.count, types: Array.from(g.types), minDuration: g.mins[0] ?? 'n/d', maxDuration: g.maxs[0] ?? 'n/d' }));
        const list = available.filter((c: any) => c.contract_category === 'callput' && c.start_type !== 'forward');
        if (list.length === 0) { res.error = `nenhum contrato Rise/Fall (callput) disponível para o símbolo. Categorias oferecidas: ${res.categories.length ? res.categories.map(c => c.name).join(', ') : 'nenhuma (contracts_for vazio)'}`; return res; }
        let mn = Infinity, mx = 0;
        for (const c of list) {
            const a = parseDurationToSeconds(c.min_contract_duration), b = parseDurationToSeconds(c.max_contract_duration);
            if (a !== null) mn = Math.min(mn, a);
            if (b !== null) mx = Math.max(mx, b);
        }
        res.minDurationSec = Number.isFinite(mn) ? mn : null; res.maxDurationSec = mx > 0 ? mx : null;
        res.durationAllowed = res.minDurationSec !== null && res.maxDurationSec !== null && durationSec >= res.minDurationSec && durationSec <= res.maxDurationSec;
        if (!res.durationAllowed) { res.error = `duração ${durationSec}s fora do intervalo permitido (${res.minDurationSec}s a ${res.maxDurationSec}s)`; return res; }

        const dur = durationSec % 60 === 0 ? { duration: durationSec / 60, duration_unit: 'm' } : { duration: durationSec, duration_unit: 's' };
        for (const side of ['PUT', 'CALL'] as const) {
            const p = await getProposal({ contract_type: side, currency: 'USD', symbol, amount: stake, basis: 'stake', ...dur });
            if (p?.error || !p?.proposal) { res.notes.push(`${side}: ${p?.error?.message ?? 'sem proposal'}`); continue; }
            const ask = Number(p.proposal.ask_price), payout = Number(p.proposal.payout);
            if (!(ask > 0) || !(payout > 0)) { res.notes.push(`${side}: valores inválidos no proposal`); continue; }
            const v: ProbeSide = { payoutPct: ((payout - ask) / ask) * 100, breakeven: ask / payout, ask, payout };
            if (side === 'PUT') res.put = v; else res.call = v;
        }
        res.ok = res.put !== null;
        if (!res.ok) res.error = 'proposal de PUT indisponível';
        return res;
    } catch (e: any) {
        res.error = e?.message || String(e);
        return res;
    }
}

export function buildPayoutProbeText(r: PayoutProbeResult): string {
    const L = [`[SONDA DE PAYOUT] ${r.symbol} | ${r.durationSec}s | stake ${r.stake} USD (nenhuma compra realizada)`];
    L.push(`Duração permitida (Rise/Fall): ${r.minDurationSec ?? 'n/d'}s a ${r.maxDurationSec ?? 'n/d'}s | ${r.durationAllowed ? 'OK' : 'NÃO permitida'}`);
    if (r.put) L.push(`PUT: payout ${r.put.payoutPct.toFixed(1)}% | breakeven ${(r.put.breakeven * 100).toFixed(2)}% | ask ${r.put.ask} -> payout ${r.put.payout}`);
    if (r.call) L.push(`CALL: payout ${r.call.payoutPct.toFixed(1)}% | breakeven ${(r.call.breakeven * 100).toFixed(2)}%`);
    if (r.categories.length) L.push('Categorias de contrato oferecidas: ' + r.categories.map(c => `${c.name} [${c.count}; ${c.types.join('/') || 'n/d'}; min ${c.minDuration}, max ${c.maxDuration}]`).join(' | '));
    if (r.error) L.push(`ERRO: ${r.error}`);
    r.notes.forEach(n => L.push(`nota: ${n}`));
    return L.join('\n');
}
