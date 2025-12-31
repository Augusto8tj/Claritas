// /src/services/indicator-service.ts

/**
 * @fileOverview This service provides a centralized engine for calculating various financial technical indicators.
 * It is designed to be used on the client-side for real-time analysis.
 */

import type { CandleData, ChartData, TimePeriod, RobotStrategy } from '@/lib/types';
import { DerivIndicators } from './DerivFinanceLib';

export interface Indicators {
    rsi: number | null;
    stoch: number | null;
    atr: number | null;
    adx: number | null;
    pdi: number | null;
    ndi: number | null;
    macd: { macd: number | null; signal: number | null; histogram: number | null };
    ma: { short: number | null; long: number | null; };
    sma: (number | null)[];
    ema: (number | null)[]; // Changed to ema20
    ema20?: number | null;
    ema50?: number | null;
    vwap: (number | null)[];
    
    bb: { upper: number | null; middle: number | null; lower: number | null };
    bollingerBands: ({ upper: number; middle: number; lower: number } | null)[];
    
    donchianChannels: ({ upper: number; middle: number; lower: number } | null)[];
    // New Advanced Indicators
    kama: number | null;
    bbw: number | null; // Bollinger Bandwidth
    stochRSI: number | null;
    zScore: number | null;
    // Newly added for full coverage
    awesomeOscillator: number | null;
    trix: number | null;
    roc: number | null;
    parabolicSAR: number | null;
    ichimoku: { tenkan: number | null; kijun: number | null; senkouA: number | null; senkouB: number | null } | null;
    mfi: number | null;
    obv: number | null;
    chandelierExit: number | null;
    rvi: number | null;
}

const isCandle = (d: ChartData): d is CandleData => 'close' in d;

const calculateSMA = (data: CandleData[], period: number): (number | null)[] => {
    if (data.length < period) return Array(data.length).fill(null);
    const smaValues: (number | null)[] = Array(period - 1).fill(null);
    let sum = 0;
    for(let i=0; i<period; i++) sum += data[i].close;
    smaValues.push(sum / period);
    for(let i=period; i<data.length; i++){
        sum = sum - data[i-period].close + data[i].close;
        smaValues.push(sum / period);
    }
    return smaValues;
}

const calculateEMA = (data: CandleData[], period: number): (number | null)[] => {
  if (data.length < period) return Array(data.length).fill(null);
  const k = 2 / (period + 1)
  const emaValues: (number | null)[] = [];
  
  if(data.length >= period) {
    let sum = data.slice(0, period).reduce((acc, d) => acc + d.close, 0);
    let firstEma = sum/period;
    
    const filled = Array(period-1).fill(null);
    emaValues.push(...filled, firstEma);

    for (let i = period; i < data.length; i++) {
        const prevEma = emaValues[i-1];
        if(prevEma !== null) {
          emaValues.push(data[i].close * k + prevEma * (1 - k));
        } else {
          emaValues.push(null);
        }
    }
  }
  return emaValues;
}

const calculateRSI = (data: CandleData[], period = 14): (number | null)[] => {
    if (data.length < period + 1) return Array(data.length).fill(null);

    const rsiValues: (number | null)[] = Array(period).fill(null);
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= period; i++) {
        const change = data[i].close - data[i - 1].close;
        if (change > 0) {
            avgGain += change;
        } else {
            avgLoss -= change;
        }
    }
    avgGain /= period;
    avgLoss /= period;
    
    let rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rs)));

    for (let i = period + 1; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        let gain = change > 0 ? change : 0;
        let loss = change < 0 ? -change : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        
        rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
        rsiValues.push(100 - (100 / (1 + rs)));
    }
    return rsiValues;
};

const calculateStochastic = (data: CandleData[], period = 14) => {
    if (data.length < period) return Array(data.length).fill(null);

    const kValues: (number | null)[] = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            kValues.push(null);
            continue;
        }
        const slice = data.slice(i - period + 1, i + 1);
        const lowestLow = Math.min(...slice.map(d => d.low));
        const highestHigh = Math.max(...slice.map(d => d.high));
        const currentClose = slice[slice.length - 1].close;
        if (highestHigh === lowestLow) {
            kValues.push(i > 0 && kValues[i-1] ? kValues[i-1] : 50);
        } else {
            kValues.push(100 * ((currentClose - lowestLow) / (highestHigh - lowestLow)));
        }
    }
    return kValues;
};

const calculateMACD = (data: CandleData[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) => {
    if (data.length < slowPeriod) return { macd: [], signal: [], histogram: [] };

    const emaFast = calculateEMA(data, fastPeriod);
    const emaSlow = calculateEMA(data, slowPeriod);
    
    const macdLine = data.map((_, i) => (emaFast[i] && emaSlow[i]) ? emaFast[i]! - emaSlow[i]! : null);
    
    const signalData = macdLine.map(v => v !== null ? { close: v, high:v, low:v, epoch:0, open:v, volume: 1 } as CandleData : null).filter((v): v is CandleData => v !== null);

    const signalLineRaw = calculateEMA(signalData, signalPeriod);
    
    const fillLength = data.length - signalData.length;
    const signalLine = [...Array(fillLength).fill(null), ...signalLineRaw];

    const histogram = macdLine.map((m, i) => (m && signalLine[i]) ? m - signalLine[i]! : null);

    return { macd: macdLine, signal: signalLine, histogram };
};

const calculateADX = (data: CandleData[], period = 14) => {
    if (data.length < period * 2) return { adx: Array(data.length).fill(null), pdi: [], ndi: [] };

    let pdi: (number | null)[] = [], ndi: (number | null)[] = [], trs: (number | null)[] = [];
    
    for (let i = 1; i < data.length; i++) {
        const upMove = data[i].high - data[i - 1].high;
        const downMove = data[i-1].low - data[i].low;
        
        const pdm = (upMove > downMove && upMove > 0) ? upMove : 0;
        const ndm = (downMove > upMove && downMove > 0) ? downMove : 0;
        
        pdi.push(pdm);
        ndi.push(ndm);
        
        const tr = Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i-1].close), Math.abs(data[i].low - data[i-1].close));
        trs.push(tr);
    }

    const smooth = (values: (number | null)[], smoothingPeriod: number) => {
        if(values.length < smoothingPeriod) return Array(values.length).fill(null);
        let smoothed: (number | null)[] = Array(smoothingPeriod-1).fill(null);
        const initialSum = values.slice(0, smoothingPeriod).reduce((acc, v) => acc + (v||0), 0);
        smoothed.push(initialSum);

        for (let i = smoothingPeriod; i < values.length; i++) {
             const prevSmoothed = smoothed[i-1];
             if(prevSmoothed !== null && values[i] !== null){
                smoothed.push(prevSmoothed - (prevSmoothed / smoothingPeriod) + (values[i] || 0));
             } else {
                smoothed.push(null);
             }
        }
        return smoothed;
    };

    const smoothedPDI = smooth(pdi, period);
    const smoothedNDI = smooth(ndi, period);
    const smoothedTR = smooth(trs, period);
    
    let pdiFinal: (number | null)[] = [], ndiFinal: (number | null)[] = [], dx: (number | null)[] = [];

    for(let i=0; i< smoothedTR.length; i++){
        if(!smoothedTR[i] || smoothedTR[i] === 0 || smoothedPDI[i] === null || smoothedNDI[i] === null) {
             pdiFinal.push(null);
             ndiFinal.push(null);
             continue;
        };
        pdiFinal.push(100 * (smoothedPDI[i]! / smoothedTR[i]!));
        ndiFinal.push(100 * (smoothedNDI[i]! / smoothedTR[i]!));
    }
    
    for (let i = 0; i < pdiFinal.length; i++) {
        const p = pdiFinal[i];
        const n = ndiFinal[i];
        if (p === null || n === null || (p+n) === 0) { dx.push(null); continue; }
        const den = p + n;
        dx.push(den === 0 ? 0 : 100 * Math.abs(p - n) / den);
    }
    
    const adxRaw = smooth(dx.filter((v): v is number => v !== null), period);
    
    const fillCount = data.length - adxRaw.length;
    const adx = Array(fillCount).fill(null).concat(adxRaw);
    
    return { adx, pdi: pdiFinal, ndi: ndiFinal };
};

const calculateAwesomeOscillator = (data: CandleData[]): (number | null)[] => {
    if (data.length < 34) return Array(data.length).fill(null);
    const midpoints = data.map(d => ({ ...d, close: (d.high + d.low) / 2 }));
    const sma5 = calculateSMA(midpoints, 5);
    const sma34 = calculateSMA(midpoints, 34);
    return sma5.map((s, i) => (s && sma34[i]) ? s - sma34[i]! : null);
};

const calculateParabolicSAR = (data: CandleData[], af = 0.02, maxAf = 0.2): (number | null)[] => {
    if (data.length < 2) return Array(data.length).fill(null);
    let sar: (number|null)[] = [null];
    let isRising = data[1].close > data[0].close;
    let ep = isRising ? data[1].high : data[1].low;
    let currentAf = af;
    let currentSar = isRising ? data[0].low : data[0].high;

    for (let i = 1; i < data.length; i++) {
        currentSar = currentSar + currentAf * (ep - currentSar);
        
        if (isRising) {
            currentSar = Math.min(currentSar, data[i-1].low, i > 1 ? data[i-2].low : data[i-1].low);
            if (data[i].low < currentSar) {
                isRising = false;
                currentSar = ep;
                ep = data[i].low;
                currentAf = af;
            } else {
                if (data[i].high > ep) {
                    ep = data[i].high;
                    currentAf = Math.min(maxAf, currentAf + af);
                }
            }
        } else { // is falling
            currentSar = Math.max(currentSar, data[i-1].high, i > 1 ? data[i-2].high : data[i-1].high);
            if (data[i].high > currentSar) {
                isRising = true;
                currentSar = ep;
                ep = data[i].high;
                currentAf = af;
            } else {
                if (data[i].low < ep) {
                    ep = data[i].low;
                    currentAf = Math.min(maxAf, currentAf + af);
                }
            }
        }
        sar.push(currentSar);
    }
    return sar;
};

const calculateBollingerBands = (
    data: CandleData[], 
    period = 20, 
    stdDev = 2
): ({ upper: number; middle: number; lower: number } | null)[] => {
    if (data.length < period) return Array(data.length).fill(null);
    
    const sma = calculateSMA(data, period);
    const bands: ({ upper: number; middle: number; lower: number } | null)[] = [];
    
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1 || sma[i] === null) {
            bands.push(null);
            continue;
        }
        
        const slice = data.slice(i - period + 1, i + 1);
        const mean = sma[i]!;
        const variance = slice.reduce((acc, d) => acc + Math.pow(d.close - mean, 2), 0) / period;
        const std = Math.sqrt(variance);
        
        bands.push({
            middle: mean,
            upper: mean + (stdDev * std),
            lower: mean - (stdDev * std),
        });
    }
    
    return bands;
};

export function calculateAllIndicators(chartData: ChartData[], strategyCouncil: RobotStrategy[], timePeriod: TimePeriod): Indicators {
    
    const emptyIndicators: Indicators = {
        rsi: null, stoch: null, atr: null, adx: null, pdi: null, ndi: null,
        macd: { macd: null, signal: null, histogram: null }, 
        ma: { short: null, long: null },
        sma: [], ema: [], vwap: [], 
        bb: { upper: null, middle: null, lower: null },
        bollingerBands: [], 
        donchianChannels: [],
        kama: null, bbw: null, stochRSI: null, zScore: null,
        awesomeOscillator: null, trix: null, roc: null, parabolicSAR: null,
        ichimoku: { tenkan: null, kijun: null, senkouA: null, senkouB: null },
        mfi: null, obv: null, chandelierExit: null, rvi: null
    };
    
    if (chartData.length < 2) {
        return emptyIndicators;
    }

    let candles: CandleData[];
    if (chartData.length > 0 && !isCandle(chartData[0])) {
        candles = chartData.map(d => {
            const price = (d as { price: number }).price;
            return { epoch: d.epoch, open: price, high: price, low: price, close: price, volume: (d as any).volume || 1 };
        });
    } else {
        candles = chartData.filter(isCandle);
    }

    if (candles.length < 2) {
        return emptyIndicators;
    }

    const getParam = (type: RobotStrategy['strategyType'], key: keyof RobotStrategy, defaultValue: any) => {
        const robot = strategyCouncil.find(r => r.strategyType === type);
        return robot && robot[key] !== undefined ? robot[key] : defaultValue;
    };

    const indicators: Partial<Indicators> = {};

    const rsiValues = calculateRSI(candles, getParam('RSI', 'period', 14));
    indicators.rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;

    const stochValues = calculateStochastic(candles, getParam('STOCHASTIC', 'period', 14));
    indicators.stoch = stochValues.length > 0 ? stochValues[stochValues.length - 1] : null;
    
    const macdValues = calculateMACD(candles, getParam('MACD_CROSS', 'fastPeriod', 12), getParam('MACD_CROSS', 'slowPeriod', 26), getParam('MACD_CROSS', 'signalPeriod', 9));
    indicators.macd = { 
        macd: macdValues.macd.length > 0 ? macdValues.macd[macdValues.macd.length - 1] : null,
        signal: macdValues.signal.length > 0 ? macdValues.signal[macdValues.signal.length - 1] : null,
        histogram: macdValues.histogram.length > 0 ? macdValues.histogram[macdValues.histogram.length - 1] : null,
    };

    const adxValues = calculateADX(candles, getParam('ADX_TREND', 'period', 14));
    indicators.adx = adxValues.adx.length > 0 ? adxValues.adx[adxValues.adx.length - 1] : null;
    indicators.pdi = adxValues.pdi.length > 0 ? adxValues.pdi[adxValues.pdi.length - 1] : null;
    indicators.ndi = adxValues.ndi.length > 0 ? adxValues.ndi[adxValues.ndi.length - 1] : null;

    const shortPeriod = getParam('MOVING_AVERAGE_CROSS', 'shortPeriod', 20);
    const longPeriod = getParam('MOVING_AVERAGE_CROSS', 'longPeriod', 50);
    indicators.ema = calculateEMA(candles, shortPeriod);
    indicators.sma = calculateSMA(candles, longPeriod);
    indicators.ma = {
        short: indicators.ema.length > 0 ? indicators.ema[indicators.ema.length - 1] : null,
        long: indicators.sma.length > 0 ? indicators.sma[indicators.sma.length - 1] : null,
    };
    
    const ema20Values = calculateEMA(candles, 20);
    indicators.ema20 = ema20Values.length > 0 ? ema20Values[ema20Values.length - 1] : null;
    const ema50Values = calculateEMA(candles, 50);
    indicators.ema50 = ema50Values.length > 0 ? ema50Values[ema50Values.length - 1] : null;
    
    const bbPeriod = getParam('BOLLINGER_BANDS', 'period', 20);
    const bbStdDev = getParam('BOLLINGER_BANDS', 'stdDev', 2);
    indicators.bollingerBands = calculateBollingerBands(candles, bbPeriod, bbStdDev);
    const lastBB = indicators.bollingerBands.length > 0 ? indicators.bollingerBands[indicators.bollingerBands.length - 1] : null;
    indicators.bb = lastBB || { upper: null, middle: null, lower: null };

    const bbwValues = DerivIndicators.bollingerBandwidth(candles, bbPeriod, bbStdDev);
    indicators.bbw = bbwValues.length > 0 ? bbwValues[bbwValues.length-1] : null;

    indicators.donchianChannels = DerivIndicators.donchian(candles, getParam('DONCHIAN_CHANNELS', 'period', 20));

    const chandelierValues = DerivIndicators.chandelierExit(candles, getParam('CHANDELIER_EXIT', 'period', 22), getParam('CHANDELIER_EXIT', 'multiplier', 3));
    indicators.chandelierExit = chandelierValues.length > 0 ? chandelierValues[chandelierValues.length - 1] : null;
    
    const atrValues = DerivIndicators.atr(candles);
    indicators.atr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : null;

    const vwapValues = DerivIndicators.vwap(candles);
    indicators.vwap = vwapValues;

    const kamaValues = DerivIndicators.kama(candles, getParam('KAMA', 'period', 10));
    indicators.kama = kamaValues.length > 0 ? kamaValues[kamaValues.length - 1] : null;
    
    const stochRSIValues = DerivIndicators.stochRSI(candles, getParam('STOCH_RSI', 'period', 14));
    indicators.stochRSI = stochRSIValues.length > 0 ? stochRSIValues[stochRSIValues.length - 1] : null;

    const zScoreValues = DerivIndicators.zScore(candles, getParam('Z_SCORE', 'period', 20));
    indicators.zScore = zScoreValues.length > 0 ? zScoreValues[zScoreValues.length - 1] : null;

    const aoValues = calculateAwesomeOscillator(candles);
    indicators.awesomeOscillator = aoValues.length > 0 ? aoValues[aoValues.length - 1] : null;
    
    const trixValues = DerivIndicators.trix(candles, getParam('TRIX', 'period', 15));
    indicators.trix = trixValues.length > 0 ? trixValues[trixValues.length - 1] : null;

    const rocValues = DerivIndicators.roc(candles, getParam('ROC', 'period', 12));
    indicators.roc = rocValues.length > 0 ? rocValues[rocValues.length - 1] : null;

    const sarValues = calculateParabolicSAR(candles, getParam('PARABOLIC_SAR', 'acceleration', 0.02), getParam('PARABOLIC_SAR', 'maxAcceleration', 0.2));
    indicators.parabolicSAR = sarValues.length > 0 ? sarValues[sarValues.length - 1] : null;

    const ichimokuValues = DerivIndicators.ichimoku(candles);
    indicators.ichimoku = ichimokuValues.length > 0 ? ichimokuValues[ichimokuValues.length - 1] : { tenkan: null, kijun: null, senkouA: null, senkouB: null };

    const mfiValues = DerivIndicators.mfi(candles, getParam('MFI', 'period', 14));
    indicators.mfi = mfiValues.length > 0 ? mfiValues[mfiValues.length - 1] : null;

    const obvValues = DerivIndicators.obv(candles);
    indicators.obv = obvValues.length > 0 ? obvValues[obvValues.length - 1] : null;

    const rviValues = DerivIndicators.rvi(candles, getParam('RVI', 'period', 10));
    indicators.rvi = rviValues.length > 0 ? rviValues[rviValues.length-1] : null;


    return { ...emptyIndicators, ...indicators };
}
