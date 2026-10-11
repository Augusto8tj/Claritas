import { computeSignalFeatures, evaluateSignals, type SignalCandle } from './signal-engine';

export interface BacktestOptions {
  minScore?: number;        // score minimo (padrao 40)
  optHorizon?: number;      // candles de 1m a frente para Opcoes (padrao 1)
  multHorizon?: number;     // candles a frente para Multiplicadores (padrao 5)
  accuHorizon?: number;     // candles a frente para Acumuladores (padrao 5)
  skip?: number;            // anti-sobreposicao: candles ignorados apos cada amostra da mesma regra (padrao 5)
  payoutPct?: number;       // payout assumido de Rise/Fall (padrao 85)
}
export interface Stat { n: number; wins: number; rate: number; lo: number; hi: number; }
export interface Move { n: number; sum: number; sumSq: number; mean: number; t: number; } // movimento medio em ATRs
export interface RuleReport {
  rule: string; contract: string; horizon: number; stat: Stat;
  baseline: number;         // taxa do acaso na mesma metrica (media ponderada por n ao agregar)
  breakeven: number | null; // so para Opcoes
  buckets: Array<{ label: string; stat: Stat }>;
  move?: Move;              // so Multiplicadores: expectativa bruta em ATRs (sem custos)
  verdict: string;
}

const wilson = (w: number, n: number, z = 1.96): Stat => {
  if (n === 0) return { n, wins: w, rate: 0, lo: 0, hi: 1 };
  const p = w / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const a = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { n, wins: w, rate: p, lo: (c - a) / d, hi: (c + a) / d };
};
const mkMove = (n: number, sum: number, sumSq: number): Move => {
  if (n < 2) return { n, sum, sumSq, mean: 0, t: 0 };
  const mean = sum / n, varr = Math.max(0, (sumSq - n * mean * mean) / (n - 1));
  return { n, sum, sumSq, mean, t: varr > 0 ? mean / Math.sqrt(varr / n) : 0 };
};
const verdictOf = (stat: Stat, baseline: number, breakeven: number | null): string => {
  if (stat.n < 50) return 'amostra insuficiente (n<50)';
  if (breakeven !== null && stat.hi < breakeven) return 'abaixo do ponto de equilibrio (perda esperada)';
  if (breakeven !== null && stat.lo > breakeven) return 'ACIMA do ponto de equilibrio (verificar overfitting)';
  if (baseline >= stat.lo && baseline <= stat.hi) return 'indistinguivel do acaso';
  return stat.lo > baseline ? 'acima do acaso (investigar)' : 'abaixo do acaso';
};

function* backtestGen(candles: SignalCandle[], opt: BacktestOptions, yieldEvery: number): Generator<void, RuleReport[], void> {
  const minScore = opt.minScore ?? 40, optH = opt.optHorizon ?? 1, multH = opt.multHorizon ?? 5, accuH = opt.accuHorizon ?? 5, skip = opt.skip ?? 5;
  const n = candles.length;
  const closes = candles.map(c => Number(c.close));
  const maxH = Math.max(optH, multH, accuH);
  type Acc = { w: number; n: number; b: Record<string, { w: number; n: number }>; fadeW: number; ms: number; mss: number };
  const mk = (): Acc => ({ w: 0, n: 0, b: {}, fadeW: 0, ms: 0, mss: 0 });
  const accs: Record<string, Acc> = { OPT_REV: mk(), OPT_MOM: mk(), MULT_TREND: mk(), ACCU_CALM: mk() };
  const lastTaken: Record<string, number> = {};
  const base = { opt: 0, mult: 0, calm: 0, n: 0 };

  const bucketOf = (s: number) => (s < 55 ? '40-54' : s < 70 ? '55-69' : '70+');
  const add = (a: Acc, win: boolean, score: number) => {
    a.n++; if (win) a.w++;
    const k = bucketOf(score); (a.b[k] ??= { w: 0, n: 0 }); a.b[k].n++; if (win) a.b[k].w++;
  };

  for (let i = 60; i < n - maxH - 1; i++) {
    if (Number.isFinite(yieldEvery) && yieldEvery > 0 && (i - 60) % yieldEvery === 0) yield;   // cede o controle (modo assincrono)
    const f = computeSignalFeatures(candles.slice(Math.max(0, i - 139), i + 1));
    if (!f) continue;
    const atrRef = ((f.atrPct / 100) * f.price) / (f.atrRatio > 0 ? f.atrRatio : 1);   // ATR de referencia (mediana)
    const atrNow = (f.atrPct / 100) * f.price;
    // taxas do acaso: media de P(sobe) e P(desce) (empates nao ganham em nenhum lado)
    base.n++;
    const dOpt = closes[i + optH] - closes[i]; base.opt += dOpt !== 0 ? 0.5 : 0;
    const dMult = closes[i + multH] - closes[i]; base.mult += dMult !== 0 ? 0.5 : 0;
    let calm = true; for (let j = i + 1; j <= i + accuH; j++) if (Math.abs(closes[j] - closes[j - 1]) > 1.5 * atrRef) { calm = false; break; }
    if (calm) base.calm++;

    for (const c of evaluateSignals('BT', f)) {
      if (c.score < minScore) continue;
      const rule = c.rule === 'OPT' ? '' : c.rule;
      if (!accs[rule]) continue;
      if (i - (lastTaken[rule] ?? -999) < skip) continue;
      lastTaken[rule] = i;
      if (rule === 'OPT_REV' || rule === 'OPT_MOM') {
        add(accs[rule], c.direction === 'CALL' ? dOpt > 0 : dOpt < 0, c.score);
      } else if (rule === 'MULT_TREND') {
        const sign = c.direction === 'CALL' ? 1 : -1;
        add(accs[rule], sign * dMult > 0, c.score);
        if (sign * dMult < 0) accs[rule].fadeW++;
        const mv = (sign * dMult) / (atrNow > 0 ? atrNow : 1);
        accs[rule].ms += mv; accs[rule].mss += mv * mv;
      } else if (rule === 'ACCU_CALM') {
        add(accs[rule], calm, c.score);
      }
    }
  }

  const payout = (opt.payoutPct ?? 85) / 100, be = 1 / (1 + payout);
  const nb = Math.max(1, base.n);
  const mkReport = (rule: string, contract: string, h: number, baseline: number, breakeven: number | null): RuleReport => {
    const a = accs[rule]; const stat = wilson(a.w, a.n);
    const buckets = ['40-54', '55-69', '70+'].map(k => ({ label: k, stat: wilson(a.b[k]?.w ?? 0, a.b[k]?.n ?? 0) }));
    const r: RuleReport = { rule, contract, horizon: h, stat, baseline, breakeven, buckets, verdict: verdictOf(stat, baseline, breakeven) };
    if (rule === 'MULT_TREND') r.move = mkMove(a.n, a.ms, a.mss);
    return r;
  };
  return [
    mkReport('OPT_REV', 'OPTIONS', optH, base.opt / nb, be),
    mkReport('OPT_MOM', 'OPTIONS', optH, base.opt / nb, be),
    mkReport('MULT_TREND', 'MULTIPLIERS', multH, base.mult / nb, null),
    mkReport('ACCU_CALM', 'ACCUMULATORS', accuH, base.calm / nb, null),
  ];
}

// Versao sincrona (testes, Node): resultado identico a assincrona.
export function backtestCandles(candles: SignalCandle[], opt: BacktestOptions = {}): RuleReport[] {
  const g = backtestGen(candles, opt, Infinity);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

// Versao assincrona para o navegador: cede o controle a cada `yieldEvery` candles, sem travar a tela.
export async function backtestCandlesAsync(candles: SignalCandle[], opt: BacktestOptions = {}, yieldEvery = 1500): Promise<RuleReport[]> {
  const g = backtestGen(candles, opt, yieldEvery);
  let r = g.next();
  while (!r.done) { await new Promise<void>(res => setTimeout(res, 0)); r = g.next(); }
  return r.value;
}

// Agrega ativos: acerto agrupado; taxa do acaso = media PONDERADA por n (nao media simples).
export function mergeStats(reports: RuleReport[][], payoutPct = 85): RuleReport[] {
  const be = 1 / (1 + payoutPct / 100);
  const rules = reports[0]?.map(r => r.rule) ?? [];
  return rules.map((rule, idx) => {
    const parts = reports.map(r => r[idx]);
    const w = parts.reduce((s, p) => s + p.stat.wins, 0), n = parts.reduce((s, p) => s + p.stat.n, 0);
    const stat = wilson(w, n);
    const baseline = n > 0 ? parts.reduce((s, p) => s + p.baseline * p.stat.n, 0) / n : 0.5;
    const breakeven = parts[0].breakeven === null ? null : be;
    const buckets = ['40-54', '55-69', '70+'].map((label, bi) => {
      const bw = parts.reduce((s, p) => s + p.buckets[bi].stat.wins, 0), bn = parts.reduce((s, p) => s + p.buckets[bi].stat.n, 0);
      return { label, stat: wilson(bw, bn) };
    });
    const out: RuleReport = { ...parts[0], stat, baseline, breakeven, buckets, verdict: verdictOf(stat, baseline, breakeven) };
    if (parts[0].move) out.move = mkMove(parts.reduce((s, p) => s + (p.move?.n ?? 0), 0), parts.reduce((s, p) => s + (p.move?.sum ?? 0), 0), parts.reduce((s, p) => s + (p.move?.sumSq ?? 0), 0));
    return out;
  });
}
