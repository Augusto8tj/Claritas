// src/features/trading/services/payout-skew.ts
/**
 * @fileOverview ETAPA 29 — EXPERIMENTO PRÉ-REGISTRADO DA ASSIMETRIA DE PAYOUT (CALL x PUT) do Rise/Fall de 15 min em Forex.
 *
 * Contexto medido: o payout do mesmo par muda de lado ao longo do dia (EURUSD 15 min: CALL 73/PUT 89 às 14:20 UTC; CALL 86/PUT 77 às 20:10),
 * enquanto a soma dos breakevens CALL+PUT fica em ~110% (margem da casa ~10 pp) — não há arbitragem entre os lados. A CAUSA da assimetria é
 * DESCONHECIDA (inventário da corretora, modelo, drift, volatilidade...). Este módulo só COLETA (proposal, NUNCA compra) e ANALISA.
 *
 * PRÉ-REGISTRO ${'PREREG-SKEW-1'} (escrito antes de ver qualquer amostra):
 *   Hipótese única (m=1): apostar sempre no lado de MAIOR payout do Rise/Fall de 15 min, quando |payout CALL − payout PUT| >= 10 pp,
 *   tem EV por stake > 0 (o spot no instante t+15 min decide: vitória só se estritamente na direção apostada; empate = perda).
 *   Retorno por evento: +payout% se vence, −1 se perde. Eventos: coletados a cada ~5 min só em 08:00–16:00 UTC, seg–sex;
 *   cooldown de 15 min por símbolo (eventos não sobrepostos); amostras sem o ponto t+15 min (±90 s) são descartadas.
 *   Critério de CONFIRMAÇÃO: N >= 300 eventos, EV médio > 0, p unilateral < 5% com erro-padrão AGRUPADO POR DIA, e as duas metades
 *   (cronológicas) com EV > 0. Sem ajuste de parâmetros depois de ver o resultado. Análises descritivas abaixo NÃO são testes.
 * LIMITAÇÕES: o spot do proposal não é o preço de entrada do contrato (que sai no próximo tick); o payout muda entre cotação e execução;
 * pares USD são correlacionados (os dias agrupam isso); o painel precisa ficar aberto e conectado; nada aqui autoriza execução.
 */
import { normalCdf } from './window-comparison';
import { wilsonInterval } from './leadlag-backtest';

export interface SkewSample { t: number; symbol: string; spot: number; c15: number | null; p15: number | null; c30: number | null; p30: number | null }

export const SKEW_PREREG = { id: 'PREREG-SKEW-1', horizonMin: 15, minSkewPp: 10, minN: 300, alpha: 0.05, startHourUtc: 8, endHourUtc: 16 } as const;

/** Janela de coleta: seg–sex, 08:00 <= hora UTC < 16:00. */
export function inSkewWindow(ms: number): boolean {
    const d = new Date(ms), dow = d.getUTCDay(), h = d.getUTCHours();
    return dow >= 1 && dow <= 5 && h >= SKEW_PREREG.startHourUtc && h < SKEW_PREREG.endHourUtc;
}

type Fn = (req: any) => Promise<any>;
const num = (x: any) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

/** UMA rodada de coleta: 4 proposals por símbolo (CALL/PUT x 15/30 min). NUNCA compra. Devolve amostras e erros. */
export async function collectSkewOnce(getProposal: Fn, symbols: string[], now: () => number = Date.now, pauseMs = 400): Promise<{ samples: SkewSample[]; errors: string[]; down: boolean }> {
    const samples: SkewSample[] = [], errors: string[] = [];
    let down = false;
    const isDown = (m?: string) => /não está conectado|not connected|closed/i.test(m ?? '');
    for (const symbol of symbols) {
        if (down) break;
        const t = now(), vals: Record<string, number | null> = {}; let spot: number | null = null;
        for (const [type, dur, key] of [['CALL', 15, 'c15'], ['PUT', 15, 'p15'], ['CALL', 30, 'c30'], ['PUT', 30, 'p30']] as const) {
            try {
                const p = await getProposal({ contract_type: type, currency: 'USD', underlying_symbol: symbol, amount: 1, basis: 'stake', duration: dur, duration_unit: 'm' });
                const ask = num(p?.proposal?.ask_price), payout = num(p?.proposal?.payout);
                vals[key] = ask && payout && ask > 0 ? ((payout - ask) / ask) * 100 : null;
                if (spot === null) spot = num(p?.proposal?.spot);
                if (p?.error) errors.push(`${symbol} ${type}${dur}: ${p.error.message}`);
            } catch (e: any) {
                const m = e?.message || String(e); errors.push(`${symbol} ${type}${dur}: ${m}`); vals[key] = null;
                if (isDown(m)) { down = true; break; }
            }
            if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
        }
        if (down) break; // rodada incompleta por queda de conexão: não grava amostra parcial
        if (spot !== null && spot > 0 && (vals.c15 != null || vals.p15 != null)) samples.push({ t, symbol, spot, c15: vals.c15 ?? null, p15: vals.p15 ?? null, c30: vals.c30 ?? null, p30: vals.p30 ?? null });
    }
    return { samples, errors, down };
}

const COLS = 't,symbol,spot,c15,p15,c30,p30';
const fmt = (x: number | null) => (x === null ? '' : String(x));
export function serializeSkewCsv(s: SkewSample[]): string { return [COLS, ...s.map(x => [x.t, x.symbol, x.spot, fmt(x.c15), fmt(x.p15), fmt(x.c30), fmt(x.p30)].join(','))].join('\n'); }
export function parseSkewCsv(text: string): SkewSample[] {
    const out: SkewSample[] = [];
    for (const line of text.split(/\r?\n/)) {
        const c = line.trim().split(','); if (c.length < 7 || c[0] === 't') continue;
        const t = Number(c[0]), spot = Number(c[2]); if (!Number.isFinite(t) || !(spot > 0) || !c[1]) continue;
        const o = (v: string) => (v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
        out.push({ t, symbol: c[1], spot, c15: o(c[3]), p15: o(c[4]), c30: o(c[5]), p30: o(c[6]) });
    }
    return out;
}
/** Junta coleções sem duplicar (chave t+symbol). */
export function mergeSkew(a: SkewSample[], b: SkewSample[]): SkewSample[] {
    const m = new Map<string, SkewSample>(); [...a, ...b].forEach(x => m.set(`${x.t}|${x.symbol}`, x));
    return Array.from(m.values()).sort((x, y) => x.t - y.t || x.symbol.localeCompare(y.symbol));
}

export interface SkewEvent { t: number; symbol: string; side: 'CALL' | 'PUT'; payoutPct: number; win: boolean; ev: number; day: string; skewPp: number }

const H = SKEW_PREREG.horizonMin * 60000, TOL = 90000;
/** Eventos pré-registrados (cooldown de 15 min por símbolo; precisa de amostra em t+15 min ±90 s do MESMO símbolo). */
export function buildSkewEvents(samples: SkewSample[], minSkewPp: number = SKEW_PREREG.minSkewPp): SkewEvent[] {
    const bySym = new Map<string, SkewSample[]>();
    samples.forEach(s => { if (!bySym.has(s.symbol)) bySym.set(s.symbol, []); bySym.get(s.symbol)!.push(s); });
    const out: SkewEvent[] = [];
    for (const arr of Array.from(bySym.values())) {
        arr.sort((a, b) => a.t - b.t);
        let next = -Infinity;
        for (let i = 0; i < arr.length; i++) {
            const s = arr[i];
            if (s.t < next || s.c15 === null || s.p15 === null || !inSkewWindow(s.t)) continue;
            const skew = s.c15 - s.p15;
            if (Math.abs(skew) < minSkewPp) continue;
            let j = -1;
            for (let k = i + 1; k < arr.length; k++) { if (arr[k].t - s.t > H + TOL) break; if (Math.abs(arr[k].t - s.t - H) <= TOL) { j = k; break; } }
            if (j < 0) continue;
            const side = skew > 0 ? 'CALL' : 'PUT', payoutPct = Math.max(s.c15, s.p15);
            const win = side === 'CALL' ? arr[j].spot > s.spot : arr[j].spot < s.spot;
            out.push({ t: s.t, symbol: s.symbol, side, payoutPct, win, ev: win ? payoutPct / 100 : -1, day: new Date(s.t).toISOString().slice(0, 10), skewPp: skew });
            next = s.t + H;
        }
    }
    return out.sort((a, b) => a.t - b.t);
}

export interface SkewTest { n: number; days: number; mean: number; se: number; z: number; pOne: number; winRate: number; wilson: [number, number]; avgBreakeven: number; halves: [number, number]; verdict: 'CONFIRMADO' | 'NÃO CONFIRMADO' | 'INCONCLUSIVO'; why: string; mdeEv: number }

function clusterStats(evs: SkewEvent[]) {
    const n = evs.length, mean = n ? evs.reduce((s, e) => s + e.ev, 0) / n : NaN;
    const byDay = new Map<string, number>();
    evs.forEach(e => byDay.set(e.day, (byDay.get(e.day) ?? 0) + (e.ev - mean)));
    const G = byDay.size; let ss = 0; byDay.forEach(v => { ss += v * v; });
    const se = G >= 10 && n > 1 ? Math.sqrt((G / (G - 1)) * ss) / n : NaN;
    return { n, mean, se, G };
}

export function testSkew(events: SkewEvent[], minN: number = SKEW_PREREG.minN, alpha: number = SKEW_PREREG.alpha): SkewTest {
    const c = clusterStats(events), wins = events.filter(e => e.win).length;
    const mid = Math.floor(events.length / 2), mean = (a: SkewEvent[]) => (a.length ? a.reduce((s, e) => s + e.ev, 0) / a.length : NaN);
    const halves: [number, number] = [mean(events.slice(0, mid)), mean(events.slice(mid))];
    const seOk = Number.isFinite(c.se) && c.se > 0, z = seOk ? c.mean / c.se : NaN, pOne = seOk ? 1 - normalCdf(z) : 1;
    const mdeEv = seOk ? (1.645 + 0.8416) * c.se : NaN;
    let verdict: SkewTest['verdict'], why: string;
    if (c.n < minN || !seOk) { verdict = 'INCONCLUSIVO'; why = `N=${c.n} (< ${minN}) ou menos de 10 dias: coleta ainda insuficiente`; }
    else if (c.mean > 0 && pOne < alpha && halves[0] > 0 && halves[1] > 0) { verdict = 'CONFIRMADO'; why = `EV ${(c.mean * 100).toFixed(2)}%/stake > 0, p unilateral ${pOne.toFixed(4)}, as duas metades positivas`; }
    else { verdict = 'NÃO CONFIRMADO'; why = `EV ${(c.mean * 100).toFixed(2)}%/stake, p unilateral ${pOne.toFixed(4)}, metades ${(halves[0] * 100).toFixed(1)}%/${(halves[1] * 100).toFixed(1)}%`; }
    return { n: c.n, days: c.G, mean: c.mean, se: c.se, z, pOne, winRate: events.length ? wins / events.length : NaN, wilson: events.length ? wilsonInterval(wins, events.length) : [NaN, NaN], avgBreakeven: events.length ? events.reduce((s, e) => s + 1 / (1 + e.payoutPct / 100), 0) / events.length : NaN, halves, verdict, why, mdeEv };
}

function pearson(x: number[], y: number[]): number {
    const n = x.length; if (n < 10) return NaN;
    const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : 'n/d'), f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : 'n/d'), pc = (x: number) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/d');

/** Diagnóstico DESCRITIVO (não é teste): o skew acompanha o movimento recente do spot? Os símbolos andam juntos? */
export function skewDiagnostics(samples: SkewSample[]): { rPast15: number; nPast15: number; rPair: number; nPair: number; fracBig: number; nWithSkew: number } {
    const bySym = new Map<string, SkewSample[]>(); samples.forEach(s => { if (!bySym.has(s.symbol)) bySym.set(s.symbol, []); bySym.get(s.symbol)!.push(s); });
    const xs: number[] = [], ys: number[] = []; let big = 0, tot = 0;
    for (const arr of Array.from(bySym.values())) {
        arr.sort((a, b) => a.t - b.t);
        for (let i = 0; i < arr.length; i++) {
            const s = arr[i]; if (s.c15 === null || s.p15 === null) continue;
            tot++; if (Math.abs(s.c15 - s.p15) >= SKEW_PREREG.minSkewPp) big++;
            const past = arr.find(a => Math.abs(s.t - a.t - H) <= TOL); if (!past) continue;
            xs.push(s.c15 - s.p15); ys.push(Math.log(s.spot / past.spot) * 1e4);
        }
    }
    const syms = Array.from(bySym.keys()).sort(); const px: number[] = [], py: number[] = [];
    if (syms.length >= 2) {
        const a = bySym.get(syms[0])!, b = new Map(bySym.get(syms[1])!.map(s => [s.t, s]));
        for (const s of a) { const o = b.get(s.t); if (o && s.c15 !== null && s.p15 !== null && o.c15 !== null && o.p15 !== null) { px.push(s.c15 - s.p15); py.push(o.c15 - o.p15); } }
    }
    return { rPast15: pearson(xs, ys), nPast15: xs.length, rPair: pearson(px, py), nPair: px.length, fracBig: tot ? big / tot : NaN, nWithSkew: tot };
}

export function buildSkewReport(samples: SkewSample[]): string {
    const L = [`[EXPERIMENTO DE ASSIMETRIA DE PAYOUT ${SKEW_PREREG.id}] (proposal; nenhuma compra realizada)`, '='.repeat(60)];
    L.push('Hipótese única (m=1): apostar no lado de MAIOR payout do Rise/Fall de 15 min quando |payout CALL − PUT| >= 10 pp tem EV > 0. Critério: N>=300 eventos não sobrepostos, EV>0, p unilateral<5% (erro-padrão agrupado por dia), as duas metades>0. Escrito antes de ver dados.');
    if (!samples.length) { L.push('', 'Sem amostras coletadas.'); return L.join('\n'); }
    const syms = Array.from(new Set(samples.map(s => s.symbol))).sort(), days = new Set(samples.map(s => new Date(s.t).toISOString().slice(0, 10))).size;
    L.push('', `AMOSTRAS: ${samples.length} em ${days} dia(s) | símbolos: ${syms.join(', ')} | de ${new Date(samples[0].t).toISOString().slice(0, 16)} a ${new Date(samples[samples.length - 1].t).toISOString().slice(0, 16)} UTC`);
    const d = skewDiagnostics(samples);
    L.push(`DESCRITIVO (não é teste): amostras com |skew| >= 10 pp: ${pc(d.fracBig)} de ${d.nWithSkew} | correlação skew x retorno do spot nos 15 min ANTERIORES: r=${f2(d.rPast15)} (N=${d.nPast15}) | correlação do skew entre ${syms[0] ?? '-'} e ${syms[1] ?? '-'}: r=${f2(d.rPair)} (N=${d.nPair})`);
    L.push('  Leitura: r negativo/positivo e grande entre skew e movimento recente indica que o skew é função do preço recente (não de "inventário"); r perto de 0 deixa a causa em aberto.');
    const ev = buildSkewEvents(samples), t = testSkew(ev);
    L.push('', `EVENTOS PRÉ-REGISTRADOS: N=${t.n} (${t.days} dias)`);
    if (t.n) {
        L.push(`  acerto do lado de maior payout: ${pc(t.winRate)} (Wilson ${pc(t.wilson[0])}–${pc(t.wilson[1])}) | breakeven médio ${pc(t.avgBreakeven)} | EV/stake ${(t.mean * 100).toFixed(2)}% (EP agrupado por dia ${Number.isFinite(t.se) ? (t.se * 100).toFixed(2) + '%' : 'n/d'}) | z=${f2(t.z)} | p unilateral ${t.pOne.toFixed(4)} | metades ${pc(t.halves[0])}/${pc(t.halves[1])}`);
        for (const sy of syms) { const e = ev.filter(x => x.symbol === sy); if (e.length) L.push(`  ${sy}: N=${e.length} acerto ${pc(e.filter(x => x.win).length / e.length)} EV ${(e.reduce((s, x) => s + x.ev, 0) / e.length * 100).toFixed(2)}%`); }
        for (const sd of ['CALL', 'PUT'] as const) { const e = ev.filter(x => x.side === sd); if (e.length) L.push(`  lado ${sd}: N=${e.length} acerto ${pc(e.filter(x => x.win).length / e.length)} EV ${(e.reduce((s, x) => s + x.ev, 0) / e.length * 100).toFixed(2)}%`); }
    }
    L.push(`  VEREDITO: ${t.verdict} — ${t.why}`);
    if (Number.isFinite(t.mdeEv)) L.push(`  Poder: EV mínimo detectável (80% de poder, unilateral 5%) ≈ ${(t.mdeEv * 100).toFixed(1)}% por stake com este N.`);
    L.push('', 'LEITURA: com a margem da casa de ~10 pp, o lado de maior payout precisa ganhar bem mais que 50% para ter EV > 0 (breakeven ~53–54%). INCONCLUSIVO = continue coletando; não conclua nada antes do N mínimo. CONFIRMADO ainda exigiria payout medido na hora da decisão e dados novos à frente. Nada aqui autoriza execução.');
    return L.join('\n');
}
