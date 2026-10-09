export interface SignalCandle { epoch: number; open: number; high: number; low: number; close: number; }

export type ContractCategory = 'OPTIONS' | 'ACCUMULATORS' | 'MULTIPLIERS';
export type SignalDirection = 'CALL' | 'PUT' | 'NONE';

export interface SignalFeatures {
  price: number; rsi: number; bbPos: number; bwPct: number;
  atrPct: number; atrRatio: number; er: number;
  mom5: number; mom15: number; streak: number; maxJumpAtr: number;
}

export interface SignalCandidate {
  symbol: string; contract: ContractCategory; direction: SignalDirection;
  score: number; rule: string; reasons: string[];
}

// Constantes ajustaveis (pontos de partida, nao valores validados)
export const SIGNAL_TRIGGER_SCORE = 55;
const HIGH_VOL_RATIO_OPTIONS = 1.6;
const HIGH_VOL_RATIO_MULT = 1.8;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lin = (x: number, a: number, b: number) => (b === a ? 0 : clamp01((x - a) / (b - a)));
const rnd = (v: number, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : 0);
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

export function computeSignalFeatures(all: SignalCandle[]): SignalFeatures | null {
  if (!all || all.length < 60) return null;
  const c = all.slice(-130);
  const n = c.length;
  const closes = c.map(x => Number(x.close));
  const opens = c.map(x => Number(x.open));
  const highs = c.map(x => Number(x.high));
  const lows = c.map(x => Number(x.low));
  if ([...closes, ...opens, ...highs, ...lows].some(v => !Number.isFinite(v))) return null;
  const last = closes[n - 1];

  // RSI de Wilder (14)
  let g = 0, l = 0;
  for (let i = 1; i <= 14; i++) { const d = closes[i] - closes[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); }
  let avgG = g / 14, avgL = l / 14;
  for (let i = 15; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * 13 + Math.max(d, 0)) / 14;
    avgL = (avgL * 13 + Math.max(-d, 0)) / 14;
  }
  const rsi = avgL === 0 ? (avgG === 0 ? 50 : 100) : 100 - 100 / (1 + avgG / avgL);

  // Bollinger (20, 2sd): %B e largura relativa (percentil na janela)
  const widths: number[] = [];
  let bbPos = 0.5;
  for (let end = 20; end <= n; end++) {
    const w = closes.slice(end - 20, end);
    const mean = sum(w) / 20;
    const sd = Math.sqrt(sum(w.map(v => (v - mean) ** 2)) / 20);
    const up = mean + 2 * sd, lo = mean - 2 * sd;
    widths.push(mean !== 0 ? (up - lo) / mean : 0);
    if (end === n) bbPos = up > lo ? (last - lo) / (up - lo) : 0.5;
  }
  const wNow = widths[widths.length - 1];
  const bwPct = (100 * widths.filter(v => v <= wNow).length) / widths.length;

  // ATR (14) e regime de volatilidade (atual / mediana)
  const tr: number[] = [];
  for (let i = 1; i < n; i++) {
    const pc = closes[i - 1];
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - pc), Math.abs(lows[i] - pc)));
  }
  const atrSeries: number[] = [];
  for (let end = 14; end <= tr.length; end++) atrSeries.push(sum(tr.slice(end - 14, end)) / 14);
  const atrNow = atrSeries[atrSeries.length - 1];
  if (!(atrNow > 0)) return null;
  const sorted = [...atrSeries].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] || atrNow;
  const atrRatio = atrNow / med;

  // Eficiencia de Kaufman (20): 0 = lateral, 1 = tendencia limpa
  let path = 0;
  for (let i = n - 20; i < n; i++) path += Math.abs(closes[i] - closes[i - 1]);
  const er = path > 0 ? Math.abs(last - closes[n - 21]) / path : 0;

  const mom5 = (last - closes[n - 6]) / atrNow;
  const mom15 = (last - closes[n - 16]) / atrNow;

  let maxJump = 0;
  for (let i = n - 10; i < n; i++) maxJump = Math.max(maxJump, Math.abs(closes[i] - closes[i - 1]));
  const maxJumpAtr = maxJump / atrNow;

  let streak = 0;
  for (let i = n - 1; i >= 0; i--) {
    const d = closes[i] - opens[i];
    const dir = d > 0 ? 1 : d < 0 ? -1 : 0;
    if (dir === 0) break;
    if (streak === 0) streak = dir;
    else if (Math.sign(streak) === dir) streak += dir;
    else break;
  }

  return {
    price: last, rsi: rnd(rsi, 1), bbPos: rnd(bbPos), bwPct: rnd(bwPct, 0),
    atrPct: rnd((atrNow / last) * 100, 4), atrRatio: rnd(atrRatio), er: rnd(er),
    mom5: rnd(mom5), mom15: rnd(mom15), streak, maxJumpAtr: rnd(maxJumpAtr),
  };
}

export function evaluateSignals(symbol: string, f: SignalFeatures): SignalCandidate[] {
  // OPTIONS: reversao em extremos (OPT_REV) vs continuacao (OPT_MOM); vence a de maior score
  let revDir: SignalDirection = 'NONE', revScore = 0;
  if (f.rsi < 30) { revDir = 'CALL'; revScore = 100 * (0.6 * lin(30 - f.rsi, 0, 15) + 0.4 * lin(0.15 - f.bbPos, 0, 0.25)); }
  else if (f.rsi > 70) { revDir = 'PUT'; revScore = 100 * (0.6 * lin(f.rsi - 70, 0, 15) + 0.4 * lin(f.bbPos - 0.85, 0, 0.25)); }

  let momDir: SignalDirection = 'NONE', momScore = 0;
  const aligned = Math.sign(f.mom5) === Math.sign(f.mom15) && f.mom5 !== 0;
  if (aligned && f.er >= 0.35 && Math.abs(f.streak) >= 2) {
    momDir = f.mom15 > 0 ? 'CALL' : 'PUT';
    momScore = 100 * (0.5 * lin(f.er, 0.3, 0.7) + 0.3 * lin(Math.abs(f.streak), 2, 5) + 0.2 * lin(Math.abs(f.mom5), 1, 3));
  }

  let opt: SignalCandidate = { symbol, contract: 'OPTIONS', direction: 'NONE', score: 0, rule: 'OPT', reasons: [] };
  if (revDir !== 'NONE' && momDir !== 'NONE' && revDir !== momDir && Math.min(revScore, momScore) >= 40) {
    opt.reasons = ['conflito reversao x continuacao'];
  } else if (revScore >= momScore && revScore > 0) {
    opt = { ...opt, direction: revDir, score: revScore, rule: 'OPT_REV', reasons: [`RSI ${f.rsi}`, `%B ${f.bbPos}`] };
  } else if (momScore > 0) {
    opt = { ...opt, direction: momDir, score: momScore, rule: 'OPT_MOM', reasons: [`ER ${f.er}`, `streak ${f.streak}`, `mom5 ${f.mom5}`] };
  }
  if (f.atrRatio > HIGH_VOL_RATIO_OPTIONS) { opt.score *= 0.6; opt.reasons.push(`vol alta x${f.atrRatio}`); }

  // MULTIPLIERS: tendencia alinhada com eficiencia alta
  let mult: SignalCandidate = { symbol, contract: 'MULTIPLIERS', direction: 'NONE', score: 0, rule: 'MULT_TREND', reasons: [] };
  if (aligned && f.er >= 0.35) {
    mult.direction = f.mom15 > 0 ? 'CALL' : 'PUT';
    mult.score = 100 * (0.45 * lin(f.er, 0.3, 0.7) + 0.35 * lin(Math.abs(f.mom15), 1.5, 4) + 0.2 * lin(Math.abs(f.streak), 2, 5));
    mult.reasons = [`ER ${f.er}`, `mom15 ${f.mom15}`, `streak ${f.streak}`];
    if (f.atrRatio > HIGH_VOL_RATIO_MULT) { mult.score *= 0.7; mult.reasons.push(`vol alta x${f.atrRatio}`); }
  }

  // ACCUMULATORS: regime calmo e lateral, sem saltos recentes (sem direcao)
  let accu: SignalCandidate = { symbol, contract: 'ACCUMULATORS', direction: 'NONE', score: 0, rule: 'ACCU_CALM', reasons: [] };
  if (f.bwPct <= 25 && f.atrRatio <= 0.95 && f.maxJumpAtr <= 1.8 && f.er <= 0.35) {
    accu.score = 100 * (0.35 * lin(25 - f.bwPct, 0, 20) + 0.25 * lin(0.95 - f.atrRatio, 0, 0.4) + 0.2 * lin(0.35 - f.er, 0, 0.25) + 0.2 * lin(1.8 - f.maxJumpAtr, 0, 0.8));
    accu.reasons = [`bw p${f.bwPct}`, `atr x${f.atrRatio}`, `ER ${f.er}`, `salto ${f.maxJumpAtr}`];
  }

  return [opt, mult, accu].map(s => ({ ...s, score: rnd(s.score, 0) }));
}