// src/features/trading/services/window-comparison.ts
/**
 * @fileOverview ETAPA 22 — A MESMA REGRA CONGELADA (H3_ALTA @ 15m) EM DUAS JANELAS, na mesma fonte (ex.: Binance):
 *   PRÉ  = do início dos dados até 12/10/2026 00:00 UTC (nunca vista na descoberta);
 *   DESC = janela onde a regra foi descoberta na Deriv (13/10/2026 a ~10/11/2026 02:00 UTC).
 *
 * Pergunta: o resultado de 62,2% (N=225) foi (a) efeito de seleção, (b) peculiaridade do feed da Deriv ou (c) um regime
 * específico do mercado naquelas 4 semanas? Se a fonte importada replica ~62% na janela DESC mas não na PRÉ, o efeito é
 * de regime (instável). Se não replica nem na DESC, foi seleção ou feed da Deriv (a fonte importada não distingue os dois).
 *
 * Regras de interpretação (definidas antes de rodar):
 *   cobertura da DESC < 10 dias ou da PRÉ < 60 dias -> "cobertura insuficiente" (sem conclusão: comparar com poucos dias engana)
 *   DESC não significativamente abaixo de 62,2% (Wilson superior >= 62,2%) e DESC > PRÉ (z bilateral p < 0.05) -> "efeito só na janela de descoberta: instável"
 *   DESC não abaixo de 62,2% e sem diferença para a PRÉ                 -> "compatível com a descoberta, mas a PRÉ também é compatível: ver retorno líquido"
 *   Wilson superior da DESC < 62,2%                                     -> "a fonte não reproduz os 62,2%: seleção ou feed da Deriv"
 */
import type { CandleData } from '@/lib/types';
import { runOosConfirmation, IN_SAMPLE_REF, type OosReport } from './oos-confirmation';

export const PRE_END_EPOCH = Date.UTC(2026, 9, 12, 0, 0, 0) / 1000;           // 12/10/2026 00:00 UTC
export const DESC_START_EPOCH = Date.UTC(2026, 9, 13, 0, 0, 0) / 1000;        // 13/10/2026 00:00 UTC
export const DESC_END_EPOCH = Date.UTC(2026, 10, 10, 2, 0, 0) / 1000;         // ~10/11/2026 02:00 UTC (fim da coleta da descoberta, em BRT 09/11)
export const MIN_DESC_COVERAGE_DAYS = 10;
export const MIN_PRE_COVERAGE_DAYS = 60;

/** CDF normal padrão (Abramowitz-Stegun 7.1.26). */
export function normalCdf(z: number): number {
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Teste z bilateral para diferença de duas proporções (a - b). */
export function twoProportionTest(wa: number, na: number, wb: number, nb: number): { diff: number; z: number; p: number } {
    if (na === 0 || nb === 0) return { diff: 0, z: 0, p: 1 };
    const pa = wa / na, pb = wb / nb, pp = (wa + wb) / (na + nb);
    const se = Math.sqrt(pp * (1 - pp) * (1 / na + 1 / nb));
    if (se === 0) return { diff: pa - pb, z: 0, p: 1 };
    const z = (pa - pb) / se;
    return { diff: pa - pb, z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

export interface WindowComparison {
    ok: boolean; reason?: string; pre: OosReport; desc: OosReport;
    diff: number; z: number; pDiff: number; reproduces: boolean; interpretation: string;
}

export function compareWindows(btc: CandleData[], eth: CandleData[], opts: { payoutPct?: number; placeboReps?: number; source?: string } = {}): WindowComparison {
    const common = { payoutPct: opts.payoutPct ?? 80, placeboReps: opts.placeboReps, source: opts.source };
    const pre = runOosConfirmation(btc, eth, { ...common, cutoffEpoch: PRE_END_EPOCH, eventToEpoch: PRE_END_EPOCH - 1 });
    const desc = runOosConfirmation(btc, eth, { ...common, cutoffEpoch: DESC_END_EPOCH + 1, eventFromEpoch: DESC_START_EPOCH, eventToEpoch: DESC_END_EPOCH });
    const t = twoProportionTest(desc.wins, desc.n, pre.wins, pre.n);
    // "reproduz" = a janela de descoberta NÃO está significativamente abaixo dos 62,2% (limite superior do Wilson >= 62,2%)
    const reproduces = desc.ok && IN_SAMPLE_REF.winRate <= desc.wilson[1];
    let interpretation: string;
    if (!pre.ok || !desc.ok) interpretation = `DADOS INSUFICIENTES: ${!pre.ok ? `PRÉ (${pre.reason})` : ''} ${!desc.ok ? `DESC (${desc.reason})` : ''}`.trim();
    else if (desc.meta.window.days < MIN_DESC_COVERAGE_DAYS) interpretation = `COBERTURA INSUFICIENTE da janela de descoberta: ${desc.meta.window.days.toFixed(1)} dias de ~28 (mínimo ${MIN_DESC_COVERAGE_DAYS}). Baixe os arquivos de outubro e novembro e rode de novo.`;
    else if (pre.meta.window.days < MIN_PRE_COVERAGE_DAYS) interpretation = `COBERTURA INSUFICIENTE da janela PRÉ: ${pre.meta.window.days.toFixed(1)} dias (mínimo ${MIN_PRE_COVERAGE_DAYS}). Selecione também os arquivos de meses anteriores (ex.: junho a setembro) para comparar com o período antes da descoberta.`;
    else if (desc.n < 30) interpretation = `AMOSTRA INSUFICIENTE na janela de descoberta (N=${desc.n} < 30).`;
    else if (reproduces && t.diff > 0 && t.p < 0.05) interpretation = 'EFEITO SÓ NA JANELA DE DESCOBERTA: a fonte replica ~62% naquelas semanas e NÃO antes (diferença significativa). É regime específico ou sorte: o efeito não é estável. Não executar.';
    else if (reproduces) interpretation = 'COMPATÍVEL COM A DESCOBERTA, mas sem diferença significativa para o período anterior: a taxa verdadeira pode estar entre as duas janelas. Decide o retorno líquido (Etapa 21) e mais dados.';
    else interpretation = 'A FONTE NÃO REPRODUZ OS 62,2% na janela de descoberta: o resultado da Deriv foi efeito de seleção OU peculiaridade do feed da Deriv (esta fonte não distingue). Só shadow à frente no tempo na própria Deriv decide.';
    return { ok: pre.ok && desc.ok, reason: pre.ok && desc.ok ? undefined : interpretation, pre, desc, diff: t.diff, z: t.z, pDiff: t.p, reproduces, interpretation };
}

export function buildWindowComparisonReport(c: WindowComparison): string {
    const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
    const d = (e: number) => new Date(e * 1000).toISOString().slice(0, 10);
    const L = ['[RELATÓRIO COMPARAÇÃO DE JANELAS V22]', '='.repeat(50)];
    L.push(`REGRA CONGELADA: H3_ALTA @ 15m (PUT) | referência da descoberta na Deriv: ${pc(IN_SAMPLE_REF.winRate)} em N=${IN_SAMPLE_REF.n} (Wilson inferior ${pc(IN_SAMPLE_REF.wilsonLower)})`);
    L.push(`FONTE: ${c.pre.meta.source}`, '', `>>> INTERPRETAÇÃO: ${c.interpretation}`, '');
    for (const [name, r] of [['PRÉ-DESCOBERTA', c.pre], ['JANELA DE DESCOBERTA', c.desc]] as const) {
        if (!r.ok) { L.push(`[${name}] ${r.reason}`); continue; }
        L.push(`[${name}] ${d(r.meta.window.from)} a ${d(r.meta.window.to)} (${r.meta.window.days.toFixed(1)} dias) | N=${r.n} | acerto ${pc(r.winRate)} | Wilson95 [${pc(r.wilson[0])} - ${pc(r.wilson[1])}] | metades ${r.halves[0] === null ? 'n/d' : pc(r.halves[0])} / ${r.halves[1] === null ? 'n/d' : pc(r.halves[1])}`);
        L.push(`   retorno bruto ${r.grossMeanBps.toFixed(2)} bps${r.grossCiBps ? ` (IC95 por dia [${r.grossCiBps[0].toFixed(2)}, ${r.grossCiBps[1].toFixed(2)}])` : ''} | placebo acerto p=${r.pPlacebo.toFixed(4)} | placebo retorno p=${r.pPlaceboMean.toFixed(4)} | taxa-base PUT 15m ${pc(r.basePutRate)} | descartes: buraco ${r.filters.gapDropped}, liquidez ${r.filters.liquidityDropped}`);
    }
    if (c.pre.ok && c.desc.ok) {
        L.push('', `DIFERENÇA DESC - PRÉ: ${(c.diff * 100).toFixed(1)} pp | z=${c.z.toFixed(2)} | p bilateral=${c.pDiff.toFixed(4)} | reprodução dos ${pc(IN_SAMPLE_REF.winRate)} na janela de descoberta: ${c.reproduces ? 'NÃO rejeitada' : 'REJEITADA (IC da janela abaixo de 62,2%)'}`);
    }
    L.push('', 'NOTAS E LIMITAÇÕES:',
        '* Mesma regra, mesmos parâmetros, mesma fonte nas duas janelas; só muda o período. A janela de descoberta é aproximada (±horas) por usar fuso UTC.',
        '* Não distingue seleção de peculiaridade do feed da Deriv: ambos dão "não reproduz". Regime específico só aparece se a fonte replicar na janela e não antes.',
        '* Velas de 1 min da fonte importada, não os ticks da Deriv. Esta etapa não autoriza execução; REAL continua bloqueado.');
    return L.join('\n');
}
