// src/features/trading/services/bankroll-sim.ts
/**
 * @fileOverview ETAPA 26 — SIMULADOR DE BANCA (Monte Carlo). Mostra o que um esquema de stakes faz com o RISCO, não com o valor esperado:
 * stake fixo, Kelly fracionado e martingale 1-2-4 (ciclo de até 3 perdas), com a taxa de acerto p e o payout (lucro por 1 de stake) informados.
 * Empate = perda. Nenhum esquema altera o EV por dólar apostado: o simulador mede isso (ev empírico) e compara com o teórico.
 * SOMENTE PESQUISA: não executa nada.
 */
import { mulberry32 } from './leadlag-backtest';

export type StakeScheme = 'FIXO' | 'KELLY' | 'MARTINGALE';
export interface BankrollCfg {
    p: number;                 // taxa de acerto (0..1)
    payoutPct: number;         // lucro por 100 de stake quando acerta (ex.: 89)
    bankroll: number;          // banca inicial (USD)
    baseStake: number;         // stake fixo / stake inicial do martingale (USD)
    bets: number;              // nº de apostas por trajetória
    paths: number;             // nº de trajetórias
    kellyFraction: number;     // fração do Kelly (ex.: 0.25)
    martingaleMaxSteps: number;// passos do ciclo (3 => 1-2-4)
    seed?: number;
}
export const DEFAULT_BANKROLL_CFG: BankrollCfg = { p: 0.5, payoutPct: 89, bankroll: 100, baseStake: 1, bets: 500, paths: 5000, kellyFraction: 0.25, martingaleMaxSteps: 3, seed: 26 };

export interface SchemeResult {
    scheme: StakeScheme; label: string;
    theoreticalEvPerStake: number;   // p*b - (1-p)
    empiricalEvPerStake: number;     // soma(P&L) / soma(stakes), todas as trajetórias
    kellyFull: number;               // f* (0 se EV <= 0)
    meanFinal: number; medianFinal: number; p5Final: number; p95Final: number;
    ruinProb: number;                // fração de trajetórias que ficam sem banca para a próxima aposta
    meanBetsPlaced: number; totalStaked: number;
    worstDrawdownMedian: number; worstDrawdownP95: number; // em USD
    probFinalAboveStart: number;
}

const q = (a: number[], f: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(f * (s.length - 1))))]; };

export function kellyFraction(p: number, payoutPct: number): number {
    const b = payoutPct / 100; if (!(b > 0)) return 0;
    const f = (p * b - (1 - p)) / b;
    return f > 0 ? f : 0;
}

export function simulateScheme(cfg: BankrollCfg, scheme: StakeScheme): SchemeResult {
    const b = cfg.payoutPct / 100, rng = mulberry32((cfg.seed ?? 26) + (scheme === 'FIXO' ? 0 : scheme === 'KELLY' ? 1 : 2));
    const fStar = kellyFraction(cfg.p, cfg.payoutPct);
    const finals: number[] = [], dds: number[] = [];
    let ruined = 0, totalStaked = 0, totalPnl = 0, betsPlacedSum = 0, above = 0;
    for (let k = 0; k < cfg.paths; k++) {
        let bank = cfg.bankroll, peak = bank, dd = 0, step = 0, placed = 0, ruin = false;
        for (let t = 0; t < cfg.bets; t++) {
            let stake: number;
            if (scheme === 'FIXO') stake = cfg.baseStake;
            else if (scheme === 'KELLY') stake = bank * fStar * cfg.kellyFraction;
            else stake = cfg.baseStake * Math.pow(2, step);
            if (!(stake > 0)) break;                       // Kelly com EV <= 0: não aposta
            if (stake > bank + 1e-9) { ruin = true; break; } // sem banca para a próxima aposta
            const win = rng() < cfg.p;
            const pnl = win ? stake * b : -stake;
            bank += pnl; totalStaked += stake; totalPnl += pnl; placed++;
            if (scheme === 'MARTINGALE') step = win ? 0 : (step + 1 >= cfg.martingaleMaxSteps ? 0 : step + 1);
            if (bank > peak) peak = bank; if (peak - bank > dd) dd = peak - bank;
        }
        if (ruin) ruined++;
        finals.push(bank); dds.push(dd); betsPlacedSum += placed; if (bank > cfg.bankroll) above++;
    }
    const label = scheme === 'FIXO' ? `stake fixo ${cfg.baseStake} USD` : scheme === 'KELLY' ? `Kelly ${(cfg.kellyFraction * 100).toFixed(0)}% (f*=${(fStar * 100).toFixed(2)}%)` : `martingale ${Array.from({ length: cfg.martingaleMaxSteps }, (_, i) => cfg.baseStake * 2 ** i).join('-')} (ciclo)`;
    const mean = finals.reduce((s, x) => s + x, 0) / finals.length;
    return {
        scheme, label, theoreticalEvPerStake: cfg.p * b - (1 - cfg.p), empiricalEvPerStake: totalStaked > 0 ? totalPnl / totalStaked : 0, kellyFull: fStar,
        meanFinal: mean, medianFinal: q(finals, 0.5), p5Final: q(finals, 0.05), p95Final: q(finals, 0.95), ruinProb: ruined / cfg.paths,
        meanBetsPlaced: betsPlacedSum / cfg.paths, totalStaked, worstDrawdownMedian: q(dds, 0.5), worstDrawdownP95: q(dds, 0.95), probFinalAboveStart: above / cfg.paths,
    };
}

/** Probabilidade analítica de perder o ciclo inteiro do martingale (todas as `steps` apostas perdem) e a perda cheia em USD. */
export function martingaleCycle(p: number, payoutPct: number, baseStake: number, steps: number) {
    const b = payoutPct / 100, stakes = Array.from({ length: steps }, (_, i) => baseStake * 2 ** i), fullLoss = stakes.reduce((s, x) => s + x, 0);
    // EV do ciclo: ganha na aposta j (após j perdas) com prob (1-p)^j * p e lucro = stake_j*b - soma das anteriores; perde tudo com prob (1-p)^steps
    let ev = 0, expectedStaked = 0;
    for (let j = 0; j < steps; j++) {
        const prior = stakes.slice(0, j).reduce((s, x) => s + x, 0), pj = Math.pow(1 - p, j) * p;
        ev += pj * (stakes[j] * b - prior); expectedStaked += pj * (prior + stakes[j]);
    }
    const pAll = Math.pow(1 - p, steps);
    ev += pAll * -fullLoss; expectedStaked += pAll * fullLoss;
    return { fullLoss, pFullLoss: pAll, evPerCycle: ev, evPerStaked: expectedStaked > 0 ? ev / expectedStaked : 0 };
}

export function runBankrollSimulation(cfg: BankrollCfg = DEFAULT_BANKROLL_CFG) {
    const results = (['FIXO', 'KELLY', 'MARTINGALE'] as StakeScheme[]).map(s => simulateScheme(cfg, s));
    const cycle = martingaleCycle(cfg.p, cfg.payoutPct, cfg.baseStake, cfg.martingaleMaxSteps);
    return { cfg, results, cycle, text: buildBankrollText(cfg, results, cycle) };
}

export function buildBankrollText(cfg: BankrollCfg, rs: SchemeResult[], cycle: ReturnType<typeof martingaleCycle>): string {
    const be = 1 / (1 + cfg.payoutPct / 100), f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/d');
    const L = ['[SIMULADOR DE BANCA V26] (Monte Carlo; empate = perda; nenhuma ordem é enviada)', '='.repeat(60)];
    L.push(`Premissas: acerto p=${f(cfg.p * 100, 1)}% | payout ${f(cfg.payoutPct, 1)}% | breakeven ${f(be * 100, 2)}% | banca ${cfg.bankroll} USD | ${cfg.bets} apostas x ${cfg.paths} trajetórias | semente ${cfg.seed ?? 26}`);
    L.push(`EV teórico por USD apostado: ${(rs[0].theoreticalEvPerStake * 100 >= 0 ? '+' : '')}${f(rs[0].theoreticalEvPerStake * 100)}% (igual para QUALQUER esquema de stakes). ${cfg.p > be ? 'Há vantagem sobre o breakeven.' : 'p não supera o breakeven: o EV é NEGATIVO e a lei dos grandes números o confirma com o tempo.'}`);
    for (const r of rs) {
        L.push(`- ${r.label}: EV empírico ${f(r.empiricalEvPerStake * 100)}%/USD apostado | final médio ${f(r.meanFinal)} (mediana ${f(r.medianFinal)}; p5 ${f(r.p5Final)}; p95 ${f(r.p95Final)}) | risco de ruína ${f(r.ruinProb * 100, 1)}% | P(final > inicial) ${f(r.probFinalAboveStart * 100, 1)}% | pior drawdown mediano ${f(r.worstDrawdownMedian)} / p95 ${f(r.worstDrawdownP95)} USD | apostas feitas/trajetória ${f(r.meanBetsPlaced, 0)}`);
        if (r.scheme === 'KELLY' && r.kellyFull === 0) L.push('   (Kelly = 0: sem vantagem não há aposta recomendada; o esquema fica parado.)');
    }
    L.push(`Ciclo do martingale (${cfg.martingaleMaxSteps} passos, stake inicial ${cfg.baseStake}): perda cheia ${f(cycle.fullLoss)} USD com probabilidade ${f(cycle.pFullLoss * 100, 1)}% por ciclo | EV por ciclo ${f(cycle.evPerCycle, 3)} USD | EV por USD apostado ${f(cycle.evPerStaked * 100)}%.`);
    L.push('LEITURA: o martingale troca muitas vitórias pequenas por uma perda grande ocasional e AUMENTA a exposição (stakes crescentes, risco de ruína maior com banca finita e limite de stake da corretora). O EV por USD apostado é o mesmo do stake fixo. Com vantagem real, o ótimo é stake fixo ou Kelly fracionado.');
    L.push('Limitações: p e payout são premissas (use os MEDIDOS: acerto de regra confirmada em dados novos e payout da sonda do lado correto); apostas independentes; sem limite de stake, sem custo extra.');
    return L.join('\n');
}
