// /src/services/DerivFinanceLib.ts
/**
 * BIBLIOTECA FINANCEIRA AVANÇADA PARA DERIV API (2025)
 * Suporta Gráficos de Linha (Ticks) e Velas (OHLC)
 * Convertido para TypeScript para maior robustez.
 */

interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type InputData = number | Partial<OHLCV> | { quote: number };

const normalizeData = (data: InputData[]): OHLCV[] => {
  if (!Array.isArray(data)) return [];
  return data.map(d => {
    const isObj = typeof d === 'object' && d !== null;
    // Prioriza 'close', depois 'quote', depois o próprio valor se for numérico.
    const price = parseFloat(String(isObj ? ((d as any).close ?? (d as any).price ?? (d as any).quote) : d));
    return {
      open: parseFloat(String(isObj ? ((d as OHLCV).open ?? price) : d)),
      high: parseFloat(String(isObj ? ((d as OHLCV).high ?? price) : d)),
      low: parseFloat(String(isObj ? ((d as OHLCV).low ?? price) : d)),
      close: price,
      volume: parseFloat(String(isObj ? ((d as OHLCV).volume ?? 1) : 1)),
    };
  });
};

export const DerivIndicators = {
  // --- VOLATILIDADE E ADAPTATIVIDADE ---
  kama: (data: InputData[], p = 10, f = 2, s = 30): number[] => {
    const d = normalizeData(data);
    if(d.length < p) return Array(d.length).fill(0);
    const kama = [d[0].close];
    const fast = 2 / (f + 1), slow = 2 / (s + 1);
    for (let i = 1; i < d.length; i++) {
      const signal = Math.abs(d[i].close - (d[i - p]?.close || d[0].close));
      let noise = 0;
      for (let j = Math.max(1, i - p + 1); j <= i; j++) {
        if(d[j] && d[j-1]) {
           noise += Math.abs(d[j].close - d[j - 1].close);
        }
      }
      const er = noise === 0 ? 0 : signal / noise;
      const sc = Math.pow(er * (fast - slow) + slow, 2);
      kama.push(kama[i - 1] + sc * (d[i].close - kama[i - 1]));
    }
    return kama;
  },

  bollingerBandwidth: (data: InputData[], p = 20, sd = 2): number[] => {
    const d = normalizeData(data).map(x => x.close);
    if (d.length < p) return Array(d.length).fill(0);
    return d.map((_, i) => {
      if (i < p - 1) return 0;
      const slice = d.slice(i - p + 1, i + 1);
      const avg = slice.reduce((a, b) => a + b, 0) / p;
      const dev = Math.sqrt(slice.map(x => Math.pow(x - avg, 2)).reduce((a, b) => a + b, 0) / p);
      if (avg === 0) return 0;
      return (((avg + dev * sd) - (avg - dev * sd)) / avg) * 100;
    });
  },
  
  atr: (data: InputData[], p = 14): number[] => {
    const d = normalizeData(data);
    if (d.length === 0) return [];
    let atrValues: number[] = [];
    let atr = 0;
    d.forEach((c, i) => {
      const tr = i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - d[i - 1].close), Math.abs(c.low - d[i - 1].close));
      atr = i === 0 ? tr : (atr * (p - 1) + tr) / p;
      atrValues.push(atr);
    });
    return atrValues;
  },

  atrTrailingStop: (data: InputData[], p = 14, m = 3): number[] => {
    const d = normalizeData(data);
    if (d.length === 0) return [];
    const atrValues = DerivIndicators.atr(d, p);
    return d.map((c, i) => c.close - (atrValues[i] * m));
  },

  chandelierExit: (data: InputData[], p = 22, m = 3): (number | null)[] => {
    const d = normalizeData(data);
    if (d.length < p) return d.map(() => null);
    const atrValues = DerivIndicators.atr(d, p);
    return d.map((_, i) => {
        if (i < p -1) return null;
        const maxH = Math.max(...d.slice(i - p + 1, i + 1).map(x => x.high));
        return maxH - (atrValues[i] * m);
    });
  },

  // --- VOLUME E FLUXO ---
  vwap: (data: InputData[]): number[] => {
    const d = normalizeData(data);
    let svp = 0, sv = 0;
    return d.map(c => {
      const tp = (c.high + c.low + c.close) / 3;
      svp += tp * c.volume; sv += c.volume;
      return sv > 0 ? svp / sv : 0;
    });
  },

  cumulativeDelta: (data: InputData[]): number[] => {
    const d = normalizeData(data);
    if (d.length === 0) return [];
    let delta = 0;
    return d.map((c, i) => {
      if (i === 0) return 0;
      delta += c.close > d[i - 1].close ? c.volume : -c.volume;
      return delta;
    });
  },

  obv: (data: InputData[]): number[] => {
    const d = normalizeData(data);
    if (d.length === 0) return [];
    let v = 0;
    return d.map((c, i) => {
      if (i > 0) v += c.close > d[i - 1].close ? c.volume : (c.close < d[i - 1].close ? -c.volume : 0);
      return v;
    });
  },

  mfi: (data: InputData[], p = 14): number[] => {
    const d = normalizeData(data);
    if (d.length < p) return Array(d.length).fill(50);
    return d.map((_, i) => {
      if (i < p) return 50;
      let pmf = 0, nmf = 0;
      for (let j = i - p + 1; j <= i; j++) {
        const tp = (d[j].high + d[j].low + d[j].close) / 3;
        const prevTp = (d[j - 1].high + d[j - 1].low + d[j - 1].close) / 3;
        tp > prevTp ? pmf += tp * d[j].volume : nmf += tp * d[j].volume;
      }
      return 100 - (100 / (1 + (pmf / (nmf || 1))));
    });
  },

  volumeProfile: (data: InputData[], bins = 20) => {
    const d = normalizeData(data);
    if (d.length === 0) return { profile: [], min: 0, step: 0 };
    const prices = d.map(x => x.close);
    const min = Math.min(...prices), max = Math.max(...prices);
    const step = (max - min) / bins;
    const profile = Array(bins).fill(0);
    d.forEach(c => {
      const binIdx = step > 0 ? Math.min(bins - 1, Math.floor((c.close - min) / step)) : 0;
      profile[binIdx] += c.volume;
    });
    return { profile, min, step };
  },

  // --- OSCILADORES ---
  stochRSI: (data: InputData[], p = 14): number[] => {
    const d = normalizeData(data).map(x => x.close);
    if (d.length < p + 1) return Array(d.length).fill(0.5);
    
    let gains: number[] = [], losses: number[] = [];
    for (let i = 1; i < d.length; i++) {
        const diff = d[i] - d[i - 1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
    }
    
    const ema = (arr: number[], period: number): number[] => {
      if (arr.length < period) return [];
      let result: number[] = [];
      let sum = arr.slice(0, period).reduce((acc, val) => acc + val, 0);
      result.push(sum / period);
      const k = 2 / (period + 1);
      for (let i = period; i < arr.length; i++) {
        result.push((arr[i] * k) + (result[result.length - 1] * (1 - k)));
      }
      return result;
    };
    
    if (gains.length < p || losses.length < p) return Array(d.length).fill(0.5);

    const avgGain = ema(gains, p);
    const avgLoss = ema(losses, p);
    
    const rsi = avgGain.map((g, i) => {
        const l = avgLoss[i];
        if (l === undefined) return 50;
        return 100 - (100 / (1 + (g / (l || 1))));
    });

    const fillCount = d.length - rsi.length;
    const rsiPadded = [...Array(fillCount).fill(50), ...rsi];
    
    return rsiPadded.map((v, i) => {
      if (i < p) return 0.5;
      const s = rsiPadded.slice(Math.max(0, i - p + 1), i + 1);
      const minRsi = Math.min(...s);
      const maxRsi = Math.max(...s);
      const denominator = maxRsi - minRsi;
      return denominator === 0 ? 0.5 : (v - minRsi) / denominator;
    });
  },

  fisher: (data: InputData[], p = 9): number[] => {
    const d = normalizeData(data);
    if (d.length === 0) return [];
    let fish = [0], val = [0];
    for (let i = 1; i < d.length; i++) {
      const s = d.slice(Math.max(0, i - p + 1), i + 1);
      const prices = s.map(x => (x.high + x.low) / 2);
      const mn = Math.min(...prices), mx = Math.max(...prices);
      let v = 0.33 * 2 * (((prices[prices.length - 1] - mn) / (mx - mn || 1)) - 0.5) + 0.67 * (val[i - 1] || 0);
      v = Math.max(-0.999, Math.min(0.999, v));
      val.push(v);
      fish.push(0.5 * Math.log((1 + v) / (1 - v || 1e-9)) + 0.5 * (fish[i - 1] || 0));
    }
    return fish;
  },

  roc: (data: InputData[], p = 12): number[] => {
    const d = normalizeData(data).map(x => x.close);
    return d.map((v, i) => {
      if (i < p || d[i - p] === 0) return 0;
      return ((v - d[i - p]) / d[i - p]) * 100;
    });
  },

  trix: (data: InputData[], p = 15): number[] => {
    const ema = (arr: number[], period: number) => {
      let res = [arr[0]];
      const k = 2 / (period + 1);
      for (let i = 1; i < arr.length; i++) res.push(arr[i] * k + (res[i - 1] || 0) * (1 - k));
      return res;
    };
    const d = normalizeData(data).map(x => x.close);
    if (d.length === 0) return [];
    const e1 = ema(d, p), e2 = ema(e1, p), e3 = ema(e2, p);
    return e3.map((v, i) => {
      if (i === 0 || e3[i - 1] === 0) return 0;
      return ((v - e3[i - 1]) / e3[i - 1]) * 100;
    });
  },

  rvi: (data: InputData[], p = 10): number[] => {
    const d = normalizeData(data);
    if (d.length < p + 3) return Array(d.length).fill(50);
    
    const sma = (arr: number[], period: number) => {
        if (arr.length < period) return [];
        let result: number[] = [];
        let sum = arr.slice(0, period).reduce((a,b) => a+b, 0);
        result.push(sum/period);
        for(let i=period; i<arr.length; i++) {
            sum = sum - arr[i-period] + arr[i];
            result.push(sum/period);
        }
        return result;
    }
    
    let numerators: number[] = [];
    let denominators: number[] = [];

    for (let i = 3; i < d.length; i++) {
        const n = (d[i].close - d[i-1].close) + 2*(d[i-1].close-d[i-2].close) + (d[i-2].close-d[i-3].close);
        numerators.push(n / 6);
        const de = (d[i].high - d[i].low) + 2*(d[i-1].high-d[i-1].low) + (d[i-2].high-d[i-2].low);
        denominators.push(de / 6);
    }
    
    const fillCountStart = d.length - numerators.length;
    
    const sumNum = sma(numerators, p);
    const sumDen = sma(denominators, p);

    const fillCountEnd = numerators.length - sumNum.length;

    const rvi = sumNum.map((sn, i) => {
        const sd = sumDen[i];
        if (sd === 0) return 50;
        return (sn / sd) * 100;
    });
    
    return [...Array(fillCountStart + fillCountEnd).fill(50), ...rvi];
  },

  // --- TENDÊNCIA E ESTRUTURA ---
  ichimoku: (data: InputData[]) => {
    const d = normalizeData(data);
    const f = (sz: number, i: number) => {
      const s = d.slice(Math.max(0, i - sz + 1), i + 1);
      if (s.length === 0) return 0;
      return (Math.max(...s.map(x => x.high)) + Math.min(...s.map(x => x.low))) / 2;
    };
    return d.map((_, i) => ({
      tenkan: f(9, i), kijun: f(26, i),
      senkouA: (f(9, i) + f(26, i)) / 2,
      senkouB: f(52, i)
    }));
  },

  donchian: (data: InputData[], p = 20) => {
    const d = normalizeData(data);
    return d.map((_, i) => {
      if (i < p -1) return { upper: 0, lower: 0, middle: 0};
      const s = d.slice(i - p + 1, i + 1);
      const h = Math.max(...s.map(x => x.high)), l = Math.min(...s.map(x => x.low));
      return { upper: h, lower: l, middle: (h + l) / 2 };
    });
  },

  gmma: (data: InputData[]) => {
    const d = normalizeData(data).map(x => x.close);
    if (d.length === 0) return { short: [], long: [] };
    const ema = (p: number) => {
      let r: number[] = [];
      if (d.length > 0) {
        r.push(d[0]);
        const k = 2 / (p + 1);
        for (let i = 1; i < d.length; i++) r.push(d[i] * k + (r[i - 1] || 0) * (1 - k));
      }
      return r;
    };
    return {
      short: [3, 5, 8, 10, 12, 15].map(p => ema(p)),
      long: [30, 35, 40, 45, 50, 60].map(p => ema(p))
    };
  },

  linearRegressionSlope: (data: InputData[], p = 14): number[] => {
    const d = normalizeData(data).map(x => x.close);
    return d.map((_, i) => {
      if (i < p) return 0;
      let sx = 0, sy = 0, sxy = 0, sx2 = 0;
      for (let j = 0; j < p; j++) {
        const x = j;
        const y = d[i - p + 1 + j];
        if (y === undefined) continue;
        sx += x; sy += y; sxy += x * y; sx2 += x * x;
      }
      const denominator = (p * sx2 - sx * sx);
      return denominator === 0 ? 0 : (p * sxy - sx * sy) / denominator;
    });
  },

  // --- CICLO E ESTATÍSTICA ---
  stc: (data: InputData[], f = 23, s = 50, c = 10): number[] => {
    const d = normalizeData(data).map(x => x.close);
    if (d.length < s) return Array(d.length).fill(0);
    
    // Simplified MACD calculation for STC
    const ema = (arr: number[], period: number) => {
      let res = [arr[0]];
      const k = 2 / (period + 1);
      for (let i = 1; i < arr.length; i++) res.push((arr[i] * k) + ((res[i-1] ?? 0) * (1-k)));
      return res;
    }
    const emaFast = ema(d,f);
    const emaSlow = ema(d,s);

    if(!emaFast || !emaSlow) return Array(d.length).fill(0);

    const macd = emaFast.map((v, i) => v - (emaSlow[i] || 0));
    
    return macd.map((v, i) => {
      if (i < c) return 0;
      const sl = macd.slice(Math.max(0, i - c + 1), i + 1);
      const minV = Math.min(...sl), maxV = Math.max(...sl);
      const denominator = maxV - minV;
      return denominator === 0 ? 0 : ((v - minV) / denominator) * 100;
    });
  },

  zScore: (data: InputData[], p = 20): number[] => {
    const d = normalizeData(data).map(x => x.close);
    return d.map((v, i) => {
      if (i < p - 1) return 0;
      const sl = d.slice(i - p + 1, i + 1);
      const m = sl.reduce((a, b) => a + b, 0) / p;
      const sd = Math.sqrt(sl.map(x => Math.pow(x - m, 2)).reduce((a, b) => a + b, 0) / p);
      return (v - m) / (sd || 1);
    });
  },

  coppock: (data: InputData[]): number[] => {
    const d = normalizeData(data).map(x => x.close);
    if (d.length < 15) return Array(d.length).fill(0);
    const roc14 = d.map((v, i) => i < 14 || d[i-14] === 0 ? 0 : ((v - d[i - 14]) / d[i - 14]) * 100);
    const roc11 = d.map((v, i) => i < 11 || d[i-11] === 0 ? 0 : ((v - d[i - 11]) / d[i - 11]) * 100);
    const sum = roc14.map((v, i) => v + roc11[i]);
    let wma: number[] = [];
    if (sum.length > 0) {
      wma.push(0);
      const p = 10;
      for (let i = 1; i < sum.length; i++) {
        let weight = 0, total = 0;
        for (let j = 0; j < p; j++) {
          if (i - j < 0) continue;
          const val = sum[i - j] || 0;
          weight += val * (p - j);
          total += (p - j);
        }
        wma.push(total === 0 ? 0 : weight / total);
      }
    }
    return wma;
  }
};
