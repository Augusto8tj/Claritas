import { computeSignalFeatures, evaluateSignals, type SignalCandle } from './signal-engine';

export interface BacktestOptions {
  minScore?: number;        // score minimo para contar o sinal (padrao 40, para ter amostra)
  optHorizon?: number;      // candles de 1m a frente para Opcoes (padrao 1 = 60s)
  multHorizon?: number;     // candles a frente para Multiplicadores (padrao 5)
  accuHorizon?: number;     // candles a frente para Acumuladores (padrao 5)
  skip?: number;            // candles ignorados apos cada amostra da mesma regra (anti-sobreposicao, padrao 5)
  payoutPct?: number;       // payout assumido de Rise/Fall (padrao 85)
}
export interface Stat { n: number; wins: number; rate: number; lo: number; hi: number; }
export interface RuleReport {
  rule: string; contract: string; horizon: number; stat: Stat;
  baseline: number;         // taxa incondicional (acaso) na mesma metrica
  breakeven: number | null; // so para Opcoes
  buckets: Array<{ label: string; stat: Stat }>;
  verdict: string;
}

const wilson = (w: number, n: number, z = 1.96): Stat => {
  if (n === 0) return { n, wins: w, rate: 0, lo: 0, hi: 1 };
  const p = w / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const a = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { n, wins: w, rate: p, lo: (c - a) / d, hi: (c + a) / d };
};

export function backtestCandles(candles: SignalCandle[], opt: BacktestOptions = {}) {
  const minScore = opt.minScore ?? 40, optH = opt.optHorizon ?? 1, multH = opt.multHorizon ?? 5, accuH = opt.accuHorizon ?? 5, skip = opt.skip ?? 5;
  const n = candles.length;
  const closes = candles.map(c => Number(c.close));
  const maxH = Math.max(optH, multH, accuH);
  type Acc = { w: number; n: number; b: Record<string, { w: number; n: number }> };
  const mk = (): Acc => ({ w: 0, n: 0, b: {} });
  const accs: Record<string, Acc> = { OPT_REV: mk(), OPT_MOM: mk(), MULT_TREND: mk(), ACCU_CALM: mk() };
  const lastTaken: Record<string, number> = {};
  let upBase = { w: 0, n: 0 }, multBase = { w: 0, n: 0 }, calmBase = { w: 0, n: 0 };

  const bucketOf = (s: number) => (s < 55 ? '40-54' : s < 70 ? '55-69' : '70+');
  const add = (a: Acc, win: boolean, score: number) => {
    a.n++; if (win) a.w++;
    const k = bucketOf(score); (a.b[k] ??= { w: 0, n: 0 }); a.b[k].n++; if (win) a.b[k].w++;
  };

  for (let i = 60; i < n - maxH - 1; i++) {
    const f = computeSignalFeatures(candles.slice(Math.max(0, i - 139), i + 1));
    if (!f) continue;
    const atrAbs = ((f.atrPct / 100) * f.price) / (f.atrRatio > 0 ? f.atrRatio : 1); // ATR de referencia (mediana), nao o atual
    // linhas de base incondicionais (acaso) nas mesmas metricas
    upBase.n++; if (closes[i + optH] > closes[i]) upBase.w++;
    const dirMult = closes[i + multH] - closes[i];
    multBase.n++; if (dirMult > 0) multBase.w++;
    let calm = true; for (let j = i + 1; j <= i + accuH; j++) if (Math.abs(closes[j] - closes[j - 1]) > 1.5 * atrAbs) { calm = false; break; }
    calmBase.n++; if (calm) calmBase.w++;

    for (const c of evaluateSignals('BT', f)) {
      if (c.score < minScore) continue;
      const rule = c.rule === 'OPT' ? '' : c.rule;
      if (!accs[rule]) continue;
      if (i - (lastTaken[rule] ?? -999) < skip) continue;   // anti-sobreposicao
      lastTaken[rule] = i;
      if (rule === 'OPT_REV' || rule === 'OPT_MOM') {
        const win = c.direction === 'CALL' ? closes[i + optH] > closes[i] : closes[i + optH] < closes[i];
        add(accs[rule], win, c.score);
      } else if (rule === 'MULT_TREND') {
        const win = c.direction === 'CALL' ? dirMult > 0 : dirMult < 0;
        add(accs[rule], win, c.score);
      } else if (rule === 'ACCU_CALM') {
        add(accs[rule], calm, c.score);
      }
    }
  }

  const payout = (opt.payoutPct ?? 85) / 100, be = 1 / (1 + payout);
  const mkReport = (rule: string, contract: string, h: number, baseline: number, breakeven: number | null): RuleReport => {
    const a = accs[rule]; const stat = wilson(a.w, a.n);
    const buckets = ['40-54', '55-69', '70+'].map(k => ({ label: k, stat: wilson(a.b[k]?.w ?? 0, a.b[k]?.n ?? 0) }));
    let verdict: string;
    if (a.n < 50) verdict = 'amostra insuficiente (n<50)';
    else if (breakeven !== null && stat.hi < breakeven) verdict = 'abaixo do ponto de equilibrio (perda esperada)';
    else if (breakeven !== null && stat.lo > breakeven) verdict = 'ACIMA do ponto de equilibrio (verificar overfitting)';
    else if (baseline >= stat.lo && baseline <= stat.hi) verdict = 'indistinguivel do acaso';
    else if (stat.lo > baseline) verdict = 'acima do acaso (investigar)';
    else verdict = 'abaixo do acaso';
    return { rule, contract, horizon: h, stat, baseline, breakeven, buckets, verdict };
  };
  return [
    mkReport('OPT_REV', 'OPTIONS', optH, upBase.w / Math.max(1, upBase.n), be),
    mkReport('OPT_MOM', 'OPTIONS', optH, upBase.w / Math.max(1, upBase.n), be),
    mkReport('MULT_TREND', 'MULTIPLIERS', multH, 0.5, null),
    mkReport('ACCU_CALM', 'ACCUMULATORS', accuH, calmBase.w / Math.max(1, calmBase.n), null),
  ];
}

export function mergeStats(reports: RuleReport[][], payoutPct = 85): RuleReport[] {
  const be = 1 / (1 + payoutPct / 100);
  const rules = reports[0]?.map(r => r.rule) ?? [];
  return rules.map((rule, idx) => {
    const parts = reports.map(r => r[idx]);
    const w = parts.reduce((s, p) => s + p.stat.wins, 0), n = parts.reduce((s, p) => s + p.stat.n, 0);
    const stat = wilson(w, n);
    const baseline = parts.reduce((s, p) => s + p.baseline, 0) / parts.length;
    const breakeven = parts[0].breakeven === null ? null : be;
    const buckets = ['40-54', '55-69', '70+'].map((label, bi) => {
      const bw = parts.reduce((s, p) => s + p.buckets[bi].stat.wins, 0), bn = parts.reduce((s, p) => s + p.buckets[bi].stat.n, 0);
      return { label, stat: wilson(bw, bn) };
    });
    let verdict: string;
    if (n < 50) verdict = 'amostra insuficiente (n<50)';
    else if (breakeven !== null && stat.hi < breakeven) verdict = 'abaixo do ponto de equilibrio (perda esperada)';
    else if (breakeven !== null && stat.lo > breakeven) verdict = 'ACIMA do ponto de equilibrio (verificar overfitting)';
    else if (baseline >= stat.lo && baseline <= stat.hi) verdict = 'indistinguivel do acaso';
    else if (stat.lo > baseline) verdict = 'acima do acaso (investigar)';
    else verdict = 'abaixo do acaso';
    return { ...parts[0], stat, baseline, breakeven, buckets, verdict };
  });
}
