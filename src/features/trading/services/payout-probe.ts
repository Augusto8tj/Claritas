// src/features/trading/services/payout-probe.ts
/**
 * @fileOverview ETAPA 19 — SONDA DE PAYOUT: pede `contracts_for` e um `proposal` (NUNCA compra) para saber se a
 * duração desejada existe para CALL/PUT e qual o payout real, logo o breakeven exato (= ask/payout).
 */

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
        const entries = normalizeContractEntries(available);
        const list = entries.filter(e => e.contract_category === 'callput' && e.start_type !== 'forward' && !e.isTick);
        if (list.length === 0) { res.error = `nenhum contrato Rise/Fall (callput) por tempo disponível para o símbolo. Categorias oferecidas: ${res.categories.length ? res.categories.map(c => c.name).join(', ') : 'nenhuma (contracts_for vazio)'}`; return res; }
        // ETAPA 26: a permissão é POR ENTRADA (cada expiry_type tem sua faixa); ticks ("5t") não entram na conta em segundos.
        const mins = list.map(e => e.minSec).filter((x): x is number => x !== null), maxs = list.map(e => e.maxSec).filter((x): x is number => x !== null);
        res.minDurationSec = mins.length ? Math.min(...mins) : null; res.maxDurationSec = maxs.length ? Math.max(...maxs) : null;
        const cover = list.filter(e => e.minSec !== null && e.maxSec !== null && durationSec >= e.minSec && durationSec <= e.maxSec);
        res.durationAllowed = cover.length > 0;
        if (!res.durationAllowed) { res.error = `duração ${durationSec}s não cabe em nenhuma entrada por tempo (${Array.from(new Set(list.map(e => `${e.contract_type}/${e.expiry_type}: ${e.min}..${e.max}`))).join(' | ')})`; return res; }

        const dur = secondsToApiDuration(durationSec);
        for (const side of ['PUT', 'CALL'] as const) {
            const p = await getProposal({ contract_type: side, currency: 'USD', underlying_symbol: symbol, amount: stake, basis: 'stake', ...dur });
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

// ---------------- MULTIPLIER (ETAPA 21) ----------------
export interface MultiplierQuote { multiplier: number; ask: number; commission: number; stake: number; costBps: number; stopOutPct: number; }
export interface MultiplierProbeResult { ok: boolean; error?: string; symbol: string; stake: number; side: 'MULTUP' | 'MULTDOWN'; quotes: MultiplierQuote[]; notes: string[]; }

/** Pede `proposal` (NUNCA compra) para cada multiplicador oferecido e mede a comissão em bps do ativo: comissão / (stake * multiplicador). */
export async function probeMultiplier(getContractsFor: Fn, getProposal: Fn, symbol: string, stake = 10, side: 'MULTUP' | 'MULTDOWN' = 'MULTDOWN'): Promise<MultiplierProbeResult> {
    const res: MultiplierProbeResult = { ok: false, symbol, stake, side, quotes: [], notes: [] };
    try {
        const cf = await getContractsFor(symbol);
        if (cf?.error) { res.error = `contracts_for: ${cf.error.message}`; return res; }
        const mult = (cf?.contracts_for?.available || []).filter((c: any) => c.contract_category === 'multiplier');
        if (mult.length === 0) { res.error = 'nenhum contrato multiplier disponível para o símbolo'; return res; }
        const entry = mult.find((c: any) => c.contract_type === side) ?? mult[0];
        const range: number[] = (Array.isArray(entry.multiplier_range) ? entry.multiplier_range : []).map(Number).filter((x: number) => x > 0).sort((a: number, b: number) => a - b).slice(0, 6);
        if (range.length === 0) { res.error = 'contracts_for não trouxe multiplier_range'; return res; }
        for (const m of range) {
            const p = await getProposal({ contract_type: side, currency: 'USD', underlying_symbol: symbol, amount: stake, basis: 'stake', multiplier: m });
            if (p?.error || !p?.proposal) { res.notes.push(`x${m}: ${p?.error?.message ?? 'sem proposal'}`); continue; }
            const ask = Number(p.proposal.ask_price);
            const commission = Number(p.proposal.commission ?? (ask - stake));
            if (!(ask > 0) || !Number.isFinite(commission) || commission < 0) { res.notes.push(`x${m}: valores inválidos no proposal`); continue; }
            res.quotes.push({ multiplier: m, ask, commission, stake, costBps: (commission / (stake * m)) * 1e4, stopOutPct: 100 / m });
        }
        res.ok = res.quotes.length > 0;
        if (!res.ok) res.error = 'nenhum proposal de multiplier retornou preço';
        return res;
    } catch (e: any) {
        res.error = e?.message || String(e);
        return res;
    }
}

export function buildMultiplierProbeText(r: MultiplierProbeResult): string {
    const L = [`[SONDA DE MULTIPLIER] ${r.symbol} | ${r.side} | stake ${r.stake} USD (nenhuma compra realizada)`];
    r.quotes.forEach(q => L.push(`x${q.multiplier}: ask ${q.ask} | comissão ${q.commission.toFixed(4)} USD | custo ${q.costBps.toFixed(2)} bps do ativo | stop-out em ${q.stopOutPct.toFixed(2)}%`));
    if (r.error) L.push(`ERRO: ${r.error}`);
    r.notes.forEach(n => L.push(`nota: ${n}`));
    return L.join('\n');
}

// ---------------- VARREDURA DE PAYOUT E DUMP DO contracts_for (ETAPA 26) ----------------
export interface RawContractEntry {
    contract_category: string; contract_type: string; start_type: string; expiry_type: string; barrier_category: string;
    min: string; max: string; minSec: number | null; maxSec: number | null; isTick: boolean;
}

const UNIT_SEC: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
/** "15s"/"5m"/"1h"/"1d" -> segundos; ticks ("5t") NÃO viram segundos (retorna null) para não contaminar min/máx de contratos por tempo. */
export function durationStrToSeconds(s: unknown): number | null {
    const m = String(s ?? '').match(/^(\d+)([smhd])$/);
    return m ? Number(m[1]) * UNIT_SEC[m[2]] : null;
}

/** Converte segundos em {duration, duration_unit} da API (d, h, m ou s, o maior que divide exato). */
export function secondsToApiDuration(sec: number): { duration: number; duration_unit: 's' | 'm' | 'h' | 'd' } {
    if (sec >= 86400 && sec % 86400 === 0) return { duration: sec / 86400, duration_unit: 'd' };
    if (sec >= 3600 && sec % 3600 === 0) return { duration: sec / 3600, duration_unit: 'h' };
    if (sec >= 60 && sec % 60 === 0) return { duration: sec / 60, duration_unit: 'm' };
    return { duration: sec, duration_unit: 's' };
}

export function normalizeContractEntries(available: any[]): RawContractEntry[] {
    return (available || []).map((c: any) => {
        const min = String(c.min_contract_duration ?? ''), max = String(c.max_contract_duration ?? '');
        return {
            contract_category: String(c.contract_category ?? ''), contract_type: String(c.contract_type ?? ''), start_type: String(c.start_type ?? ''),
            expiry_type: String(c.expiry_type ?? ''), barrier_category: String(c.barrier_category ?? ''), min, max,
            minSec: durationStrToSeconds(min), maxSec: durationStrToSeconds(max), isTick: /t$/.test(min) || c.expiry_type === 'tick',
        };
    });
}

/** Dump bruto, UMA linha por entrada do contracts_for (resolve a discrepância "min 1d" x "min 900 s": são entradas diferentes, por expiry_type). */
export function buildContractsForDump(symbol: string, entries: RawContractEntry[]): string {
    const L = [`[DUMP contracts_for] ${symbol} | ${entries.length} entradas`];
    entries.forEach((e, k) => L.push(`${String(k + 1).padStart(2)}. ${e.contract_category}/${e.contract_type} | start=${e.start_type} | expiry=${e.expiry_type} | barrier=${e.barrier_category || '-'} | min=${e.min || '-'} (${e.minSec ?? 'tick/n.d.'}s) | max=${e.max || '-'} (${e.maxSec ?? 'tick/n.d.'}s)`));
    const callput = entries.filter(e => e.contract_category === 'callput' && e.start_type !== 'forward' && !e.isTick);
    if (callput.length) L.push('Faixas por tempo do Rise/Fall (sem forward-start, sem ticks): ' + callput.map(e => `${e.contract_type}/${e.expiry_type}: ${e.min}..${e.max}`).join(' | '));
    return L.join('\n');
}

export async function dumpContractsFor(getContractsFor: Fn, symbol: string): Promise<{ ok: boolean; error?: string; entries: RawContractEntry[]; text: string }> {
    try {
        const cf = await getContractsFor(symbol);
        if (cf?.error) return { ok: false, error: `contracts_for: ${cf.error.message}`, entries: [], text: `[DUMP contracts_for] ${symbol}: erro ${cf.error.message}` };
        const entries = normalizeContractEntries(cf?.contracts_for?.available || []);
        return { ok: true, entries, text: buildContractsForDump(symbol, entries) };
    } catch (e: any) {
        const msg = e?.message || String(e);
        return { ok: false, error: msg, entries: [], text: `[DUMP contracts_for] ${symbol}: erro ${msg}` };
    }
}

export interface SweepRow {
    symbol: string; durationSec: number; type: string; ok: boolean; error?: string;
    ask?: number; payout?: number; payoutPct?: number; breakeven?: number; expiryType?: string; atMs: number; hourUtc: number;
}
export const SWEEP_TYPES_DEFAULT = ['CALL', 'PUT', 'CALLE', 'PUTE'];
export const SWEEP_DURATIONS_DEFAULT = [900, 1800, 3600, 7200, 14400];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Para cada símbolo x duração x tipo: acha a entrada do contracts_for que cobre a duração e pede UM proposal (NUNCA compra). */
export async function sweepPayouts(
    getContractsFor: Fn, getProposal: Fn, symbols: string[], durationsSec: number[], types: string[] = SWEEP_TYPES_DEFAULT,
    stake = 1, opts: { pauseMs?: number; onProgress?: (msg: string) => void; now?: () => number } = {},
): Promise<{ rows: SweepRow[]; dumps: string[] }> {
    const rows: SweepRow[] = [], dumps: string[] = [], now = opts.now ?? Date.now, pause = opts.pauseMs ?? 200;
    for (const symbol of symbols) {
        opts.onProgress?.(`contracts_for ${symbol}...`);
        const d = await dumpContractsFor(getContractsFor, symbol);
        dumps.push(d.text);
        for (const durationSec of durationsSec) for (const type of types) {
            const at = now(), base = { symbol, durationSec, type, atMs: at, hourUtc: new Date(at).getUTCHours() };
            if (!d.ok) { rows.push({ ...base, ok: false, error: d.error }); continue; }
            const cover = d.entries.filter(e => e.contract_type === type && e.contract_category === 'callput' && e.start_type !== 'forward' && !e.isTick && e.minSec !== null && e.maxSec !== null && durationSec >= e.minSec && durationSec <= e.maxSec);
            if (cover.length === 0) { rows.push({ ...base, ok: false, error: `nenhuma entrada ${type} cobre ${durationSec}s` }); continue; }
            opts.onProgress?.(`${symbol} ${type} ${durationSec}s...`);
            try {
                const p = await getProposal({ contract_type: type, currency: 'USD', underlying_symbol: symbol, amount: stake, basis: 'stake', ...secondsToApiDuration(durationSec) });
                if (p?.error || !p?.proposal) { rows.push({ ...base, ok: false, error: p?.error?.message ?? 'sem proposal', expiryType: cover[0].expiry_type }); }
                else {
                    const ask = Number(p.proposal.ask_price), payout = Number(p.proposal.payout);
                    if (!(ask > 0) || !(payout > 0)) rows.push({ ...base, ok: false, error: 'valores inválidos no proposal', expiryType: cover[0].expiry_type });
                    else rows.push({ ...base, ok: true, ask, payout, payoutPct: ((payout - ask) / ask) * 100, breakeven: ask / payout, expiryType: cover[0].expiry_type });
                }
            } catch (e: any) { rows.push({ ...base, ok: false, error: e?.message || String(e) }); }
            if (pause > 0) await sleep(pause);
        }
    }
    return { rows, dumps };
}

const durLabel = (s: number) => (s % 86400 === 0 ? `${s / 86400}d` : s % 3600 === 0 ? `${s / 3600}h` : s % 60 === 0 ? `${s / 60}min` : `${s}s`);

export function buildSweepText(rows: SweepRow[], dumps: string[], target = 0.94): string {
    const L = ['[VARREDURA DE PAYOUT V26] (proposal; nenhuma compra realizada)', '='.repeat(60)];
    const okRows = rows.filter(r => r.ok);
    const stamp = rows.length ? new Date(rows[0].atMs).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'n/d';
    L.push(`Início: ${stamp} | linhas: ${rows.length} (com preço: ${okRows.length}, sem preço: ${rows.length - okRows.length}). O payout varia com horário e volatilidade: repita em horários diferentes antes de generalizar.`);
    const symbols = Array.from(new Set(rows.map(r => r.symbol)));
    const durs = Array.from(new Set(rows.map(r => r.durationSec))).sort((a, b) => a - b);
    const types = Array.from(new Set(rows.map(r => r.type)));
    L.push('', 'TABELA payout% / breakeven% (linha: símbolo e duração; coluna: tipo)');
    L.push(['símbolo', 'dur', ...types].join(' | '));
    for (const s of symbols) for (const d of durs) {
        const cells = types.map(t => { const r = rows.find(x => x.symbol === s && x.durationSec === d && x.type === t); return !r ? '-' : r.ok ? `${r.payoutPct!.toFixed(1)}/${(r.breakeven! * 100).toFixed(1)}` : 'n/d'; });
        if (cells.some(c => c !== 'n/d' && c !== '-')) L.push([s, durLabel(d), ...cells].join(' | '));
    }
    const failed = rows.filter(r => !r.ok);
    if (failed.length) {
        const reasons = new Map<string, number>(); failed.forEach(r => reasons.set(r.error ?? '?', (reasons.get(r.error ?? '?') ?? 0) + 1));
        L.push('', 'SEM PREÇO (motivo x ocorrências): ' + Array.from(reasons.entries()).map(([k, v]) => `${k} x${v}`).join(' | '));
    }
    if (okRows.length) {
        const best = [...okRows].sort((a, b) => b.payoutPct! - a.payoutPct!)[0], worst = [...okRows].sort((a, b) => a.payoutPct! - b.payoutPct!)[0];
        const near = okRows.filter(r => r.payoutPct! >= target * 100 - 1);
        L.push('', `MAIOR payout: ${best.symbol} ${best.type} ${durLabel(best.durationSec)} = ${best.payoutPct!.toFixed(1)}% (breakeven ${(best.breakeven! * 100).toFixed(2)}%) | MENOR: ${worst.symbol} ${worst.type} ${durLabel(worst.durationSec)} = ${worst.payoutPct!.toFixed(1)}% (breakeven ${(worst.breakeven! * 100).toFixed(2)}%)`);
        L.push(near.length ? `Cenários com payout >= ${(target * 100 - 1).toFixed(0)}%: ${near.map(r => `${r.symbol} ${r.type} ${durLabel(r.durationSec)} ${r.payoutPct!.toFixed(1)}%`).join('; ')}` : `NENHUM cenário mediu payout próximo de ${(target * 100).toFixed(0)}%: o número de ${(target * 100).toFixed(0)}% NÃO se confirma nesta varredura.`);
        L.push('', 'ASSIMETRIA POR PAR/DURAÇÃO (soma dos breakevens CALL+PUT; 100% = sem margem; o excesso é a margem da casa):');
        for (const s of symbols) for (const d of durs) {
            const c = rows.find(x => x.symbol === s && x.durationSec === d && x.type === 'CALL' && x.ok), p = rows.find(x => x.symbol === s && x.durationSec === d && x.type === 'PUT' && x.ok);
            if (c && p) L.push(`- ${s} ${durLabel(d)}: CALL ${(c.breakeven! * 100).toFixed(1)}% + PUT ${(p.breakeven! * 100).toFixed(1)}% = ${((c.breakeven! + p.breakeven!) * 100).toFixed(1)}% (margem ${(((c.breakeven! + p.breakeven!) - 1) * 100).toFixed(1)} pp) | lado mais barato: ${c.breakeven! < p.breakeven! ? 'CALL' : 'PUT'}`);
        }
    }
    if (dumps.length) { L.push('', 'DUMPS BRUTOS DO contracts_for:'); dumps.forEach(t => L.push(t, '')); }
    L.push('Limitações: payout de proposal é cotação, não execução; stake 1 USD; o payout pode depender do stake, da conta e do horário.');
    return L.join('\n');
}
