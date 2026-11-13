// src/features/trading/services/forex-confirmation.ts
/**
 * @fileOverview ETAPA 26 — TESTE CONFIRMATÓRIO PRÉ-REGISTRADO (m = 1) da regra de reversão do spread (família C) em dados ANTERIORES à
 * amostra em que ela foi encontrada.
 *
 * PRÉ-REGISTRO (escrito antes de ver qualquer dado de PRÉ-descoberta):
 *   Hipótese única: no alvo AUDUSD, quando o spread beta-ajustado de 30 min contra o índice do USD (leave-one-out) tem |z| >= 2
 *   (z de 480 min), apostar na REVERSÃO por 60 min (regra C_SPREAD_z2_LIVRE_h60 da biblioteca). Direção pré-fixada: retorno médio > 0.
 *   Origem da regra: maior |z| (2,77) do super relatório V25 sobre a amostra da Deriv de 09/10 a 13/11/2026 (DESCOBERTA). Foi escolhida
 *   entre 150 regras: o resultado de DESCOBERTA é otimista (efeito do vencedor) e NÃO conta como evidência.
 *   Janela de confirmação (PRÉ): tudo antes de 09/10/2026 00:00 UTC (o evento inteiro, entrada + 60 min, termina antes do corte).
 *   Critério de CONFIRMAÇÃO ESTATÍSTICA: N >= 100 eventos, retorno médio > 0, p unilateral < 5% (z com erro-padrão agrupado por dia),
 *   e as duas metades da janela com média > 0. Sem ajuste de parâmetros depois de ver o resultado.
 *   Critério ECONÔMICO (separado): IC95 inferior do retorno bruto > custo do Multiplier medido; para Rise/Fall, EV conservador por lado > 0.
 *   Os demais pares (mesma regra, mesma cesta leave-one-out) são REPLICAÇÃO EXPLORATÓRIA, com Bonferroni sobre os K-1 pares extras.
 *
 * LIMITAÇÃO: a amostra de DESCOBERTA e a de PRÉ vêm do mesmo mercado e do mesmo fornecedor de preços; a janela PRÉ é anterior no tempo
 * (não é "futuro"). Só dados POSTERIORES (shadow à frente) fecham a questão. Resultado nunca autoriza execução.
 */
import type { CandleData } from '@/lib/types';
import { alignBars } from './horizon-hypotheses';
import { computeFeatures, buildRules, collectEvents, summarizeEvents, sideEv, type Ev, type SidePayouts, type RuleStats } from './super-report';
import { buildUsdBasket } from './usd-basket';
import { normalCdf } from './window-comparison';
import { rolloverMask } from './fx-calendar';

export const PREREG_FX = {
    id: 'PREREG-FX-C1',
    ruleId: 'C_SPREAD_z2_LIVRE_h60',
    primaryTarget: 'AUDUSD',
    cutoffEpoch: Date.UTC(2026, 9, 9, 0, 0, 0) / 1000,
    alpha: 0.05,
    minN: 100,
} as const;

export interface WindowStats {
    n: number; days: number; mean: number; se: number; z: number; pOne: number; winRate: number; wilson: [number, number];
    halves: [number, number]; months: { month: string; n: number; mean: number }[]; ci: [number, number] | null;
}
export type ConfirmVerdict = 'CONFIRMADO' | 'NÃO CONFIRMADO' | 'INCONCLUSIVO';
export interface ConfirmResult {
    ok: boolean; reason?: string; target: string; ruleId: string; cutoffEpoch: number;
    pre: WindowStats | null; disc: WindowStats | null; verdict: ConfirmVerdict; why: string; mdeBps: number; economic: string; sideText: string;
}
export interface ConfirmOpts { ruleId?: string; names?: { ref: string; target: string }; cutoffEpoch?: number; minN?: number; alpha?: number; sidePayouts?: SidePayouts; costBps?: number | null; excludeRollover?: boolean; }

const ret = (e: Ev) => e.dir * e.retLong;

function toWindow(evs: Ev[]): WindowStats {
    const s: RuleStats = summarizeEvents(evs);
    const seOk = Number.isFinite(s.se) && s.se > 0;
    return {
        n: s.n, days: new Set(evs.map(e => e.day)).size, mean: s.mean, se: s.se, z: s.z, pOne: seOk ? 1 - normalCdf(s.z) : 1, winRate: s.winRate, wilson: s.wilson,
        halves: s.halves, months: s.months, ci: seOk ? [s.mean - 1.96 * s.se, s.mean + 1.96 * s.se] : null,
    };
}

/** Roda a regra congelada UMA vez em alvo vs. referência e separa PRÉ (evento inteiro antes do corte) de DESCOBERTA (entrada a partir do corte). */
export function confirmRule(refCandles: CandleData[], targetCandles: CandleData[], target: string, opts: ConfirmOpts = {}): ConfirmResult {
    const ruleId = opts.ruleId ?? PREREG_FX.ruleId, cutoff = opts.cutoffEpoch ?? PREREG_FX.cutoffEpoch, minN = opts.minN ?? PREREG_FX.minN, alpha = opts.alpha ?? PREREG_FX.alpha;
    const base = { target, ruleId, cutoffEpoch: cutoff, pre: null, disc: null, verdict: 'INCONCLUSIVO' as ConfirmVerdict, mdeBps: NaN, economic: '', sideText: '' };
    const bars = alignBars(refCandles, targetCandles), n = bars.epochs.length;
    if (n < 5000) return { ok: false, reason: `apenas ${n} velas alinhadas`, why: 'dados insuficientes', ...base };
    const features = computeFeatures(bars);
    const rule = buildRules(features, opts.names ?? { ref: 'USDX', target }, true).find(r => r.id === ruleId);
    if (!rule) return { ok: false, reason: `regra ${ruleId} não existe na biblioteca`, why: 'regra inexistente', ...base };
    const gc = new Int32Array(n);
    for (let i = 1; i < n; i++) gc[i] = gc[i - 1] + (bars.epochs[i] - bars.epochs[i - 1] !== 60 ? 1 : 0);
    const all = collectEvents(bars, rule, gc, 750, opts.excludeRollover === false ? undefined : rolloverMask(bars.epochs)), h = rule.horizon;
    const preEv = all.filter(e => bars.epochs[e.i + h] < cutoff), discEv = all.filter(e => bars.epochs[e.i] >= cutoff);
    const pre = toWindow(preEv), disc = toWindow(discEv);
    const mdeBps = Number.isFinite(pre.se) && pre.se > 0 ? (1.645 + 0.8416) * pre.se : NaN;

    let verdict: ConfirmVerdict, why: string;
    if (pre.n < minN || !(pre.se > 0)) { verdict = 'INCONCLUSIVO'; why = `PRÉ com N=${pre.n} (< ${minN}) ou sem dias suficientes`; }
    else if (pre.mean > 0 && pre.pOne < alpha && pre.halves[0] > 0 && pre.halves[1] > 0) { verdict = 'CONFIRMADO'; why = `retorno médio ${pre.mean.toFixed(2)} bps > 0, p unilateral ${pre.pOne.toFixed(4)} < ${alpha}, as duas metades positivas`; }
    else if (Number.isFinite(mdeBps) && disc.n > 0 && mdeBps > disc.mean) { verdict = 'INCONCLUSIVO'; why = `sem significância, mas o teste só detectaria efeitos >= ${mdeBps.toFixed(2)} bps (a DESCOBERTA mediu ${disc.mean.toFixed(2)} bps): poder insuficiente`; }
    else { verdict = 'NÃO CONFIRMADO'; why = `retorno médio ${pre.mean.toFixed(2)} bps, p unilateral ${pre.pOne.toFixed(4)}, metades ${pre.halves[0].toFixed(2)}/${pre.halves[1].toFixed(2)} bps`; }

    let economic = 'custo do Multiplier não informado';
    if (opts.costBps !== undefined && opts.costBps !== null && pre.ci) {
        economic = pre.ci[0] > opts.costBps ? `IC95 inferior ${pre.ci[0].toFixed(2)} bps > custo ${opts.costBps.toFixed(2)} bps (cobre o custo)`
            : pre.mean > opts.costBps ? `média ${pre.mean.toFixed(2)} bps > custo ${opts.costBps.toFixed(2)} bps, mas o IC95 inferior (${pre.ci[0].toFixed(2)}) NÃO cobre`
                : `média ${pre.mean.toFixed(2)} bps <= custo ${opts.costBps.toFixed(2)} bps: NÃO cobre o custo do Multiplier`;
    }
    let sideText = '';
    if (opts.sidePayouts && (opts.sidePayouts.call !== null || opts.sidePayouts.put !== null) && preEv.length) {
        const x = sideEv(preEv, opts.sidePayouts), sg = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : 'n/d');
        sideText = `Rise/Fall por lado (PRÉ): CALL N=${x.call.n} acerto ${(x.call.rate * 100).toFixed(1)}% | PUT N=${x.put.n} acerto ${(x.put.rate * 100).toFixed(1)}% | EV/stake ${sg(x.ev)} | EV conservador (Wilson inf.) ${sg(x.evLow)}`;
    }
    return { ok: true, target, ruleId, cutoffEpoch: cutoff, pre, disc, verdict, why, mdeBps, economic, sideText };
}

const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : 'n/d');
const d = (e: number) => new Date(e * 1000).toISOString().slice(0, 10);
const win = (w: WindowStats) => `N=${w.n} (${w.days} dias) | acerto ${(w.winRate * 100).toFixed(1)}% (Wilson ${(w.wilson[0] * 100).toFixed(1)}–${(w.wilson[1] * 100).toFixed(1)}%) | retorno ${f2(w.mean)} bps${w.ci ? ` (IC95 ${f2(w.ci[0])}; ${f2(w.ci[1])})` : ''} | z=${f2(w.z)} | p unilateral ${w.pOne.toFixed(4)} | metades ${f2(w.halves[0])}/${f2(w.halves[1])}`;

export interface ConfirmAllOpts { sidePayouts?: SidePayouts; costBps?: number | null; cutoffEpoch?: number; primaryTarget?: string; ruleId?: string; }

/** Roda a regra pré-registrada no alvo primário (m = 1) e, como replicação exploratória, nos demais pares com cesta leave-one-out. */
export function runConfirmation(series: Record<string, CandleData[]>, opts: ConfirmAllOpts = {}): { results: ConfirmResult[]; text: string } {
    const primary = opts.primaryTarget ?? PREREG_FX.primaryTarget, cutoff = opts.cutoffEpoch ?? PREREG_FX.cutoffEpoch, ruleId = opts.ruleId ?? PREREG_FX.ruleId;
    const pairs = Object.keys(series).sort(), results: ConfirmResult[] = [], skipped: string[] = [];
    const alphaOthers = PREREG_FX.alpha / Math.max(1, pairs.length - 1); // Bonferroni nos pares exploratórios
    for (const pair of pairs) {
        const b = buildUsdBasket(series, pair);
        if (!b) { skipped.push(`${pair} (cesta do USD com menos de 3 pares)`); continue; }
        const r = confirmRule(b.candles, series[pair], pair, { names: { ref: 'USDX', target: pair }, cutoffEpoch: cutoff, ruleId, alpha: pair === primary ? PREREG_FX.alpha : alphaOthers, sidePayouts: pair === primary ? opts.sidePayouts : undefined, costBps: opts.costBps });
        results.push(r);
    }
    const L = [`[CONFIRMAÇÃO PRÉ-REGISTRADA ${PREREG_FX.id}] regra ${ruleId} | corte ${d(cutoff)} 00:00 UTC (PRÉ = eventos que terminam antes; DESCOBERTA = entradas a partir do corte)`, '='.repeat(60)];
    L.push('Hipótese única (m=1) no alvo primário ' + primary + ': reversão do spread beta-ajustado (|z|>=2, 60 min) contra o índice do USD leave-one-out. Critério de confirmação: N>=' + PREREG_FX.minN + ', média>0, p unilateral<5% (z agrupado por dia), as duas metades>0. Escrito antes de olhar a janela PRÉ.');
    const pr = results.find(r => r.target === primary);
    L.push('', `ALVO PRIMÁRIO ${primary}:`);
    if (!pr) L.push('  não executado (carregue o par e pelo menos 3 pares do cesta do USD além dele).');
    else if (!pr.ok) L.push(`  não executado: ${pr.reason}`);
    else {
        L.push(`  PRÉ (confirmação, antes de ${d(pr.cutoffEpoch)}): ${win(pr.pre!)}`);
        L.push(`  DESCOBERTA (otimista, NÃO é evidência): ${win(pr.disc!)}`);
        L.push(`  MENSAL PRÉ (bps): ${pr.pre!.months.map(m => `${m.month} ${f2(m.mean)} (N=${m.n})`).join(' | ') || 'n/d'}`);
        L.push(`  VEREDITO: ${pr.verdict} — ${pr.why}`);
        L.push(`  Poder: efeito mínimo detectável (80% de poder, unilateral 5%) ≈ ${f2(pr.mdeBps)} bps nesta janela.`);
        L.push(`  Econômico: ${pr.economic}`);
        if (pr.sideText) L.push(`  ${pr.sideText}`);
    }
    const others = results.filter(r => r.target !== primary && r.ok), K = others.length;
    if (K) {
        L.push('', `REPLICAÇÃO EXPLORATÓRIA nos demais pares (mesma regra; Bonferroni K=${K}: o veredito usa alfa = 5%/${K}; NÃO é confirmação pré-registrada):`);
        others.forEach(r => L.push(`  ${r.target}: PRÉ ${win(r.pre!)} | p ajustado ${Math.min(1, r.pre!.pOne * K).toFixed(4)} | ${r.verdict}`));
    }
    if (skipped.length) L.push('', 'Não executados: ' + skipped.join('; '));
    L.push('', 'LEITURA: um único teste só confirma se o critério acima for atendido; se der INCONCLUSIVO por poder, nenhuma conclusão (a favor ou contra) é permitida. CONFIRMADO em PRÉ ainda exige shadow à frente no tempo, custo medido e payout medido por lado antes de qualquer decisão. Nada aqui autoriza execução.');
    return { results, text: L.join('\n') };
}
