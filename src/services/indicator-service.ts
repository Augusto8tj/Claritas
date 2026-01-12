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
    ema: (number | null)[];
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

const calculateATR = (data: CandleData[], period = 14): (number | null)[] => {
    if (data.length < period + 1) return Array(data.length).fill(null);
    const trs = [0]; // First TR is irrelevant
    for(let i=1; i<data.length; i++) {
        const hl = data[i].high - data[i].low;
        const hc = Math.abs(data[i].high - data[i-1].close);
        const lc = Math.abs(data[i].low - data[i-1].close);
        trs.push(Math.max(hl, hc, lc));
    }
    
    // Smoothed ATR (RMA)
    const atrs: (number | null)[] = Array(period).fill(null);
    let initialSum = 0;
    for(let i=1; i<=period; i++) initialSum += trs[i];
    atrs.push(initialSum / period); // First ATR is simple average

    for(let i=period+1; i<data.length; i++) {
        const prevAtr = atrs[i-1]!;
        atrs.push(((prevAtr * (period - 1)) + trs[i]) / period);
    }
    return atrs;
};

const calculateMACD = (data: CandleData[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) => {
    if (data.length < slowPeriod) return { macd: [], signal: [], histogram: [] };

    const emaFast = calculateEMA(data, fastPeriod);
    const emaSlow = calculateEMA(data, slowPeriod);
    
    const macdLine = data.map((_, i) => (emaFast[i] && emaSlow[i]) ? emaFast[i]! - emaSlow[i]! : null);
    
    // Calculate Signal Line (EMA of MACD Line)
    // We need to filter out nulls to calculate the EMA for the signal
    const validMacdIndices = macdLine.map((v, i) => v !== null ? i : -1).filter(i => i !== -1);
    const validMacdValues = validMacdIndices.map(i => ({ close: macdLine[i]! } as CandleData));
    
    const signalLineRaw = calculateEMA(signalData, signalPeriod);
    
    // Remap to original array length
    const signalLine: (number | null)[] = Array(data.length).fill(null);
    const histogram: (number | null)[] = Array(data.length).fill(null);
    
    validMacdIndices.forEach((originalIndex, idx) => {
        signalLine[originalIndex] = signalLineRaw[idx];
        if (macdLine[originalIndex] !== null && signalLine[originalIndex] !== null) {
            histogram[originalIndex] = macdLine[originalIndex]! - signalLine[originalIndex]!;
        }
    });

    return { macd: macdLine, signal: signalLine, histogram };
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

const calculateADX = (data: CandleData[], period = 14) => {
    if (data.length < period * 2) {
        return { adx: [], pdi: [], ndi: [] };
    }
    
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
        if(!smoothedTR[i] || smoothedTR[i] === 0 || smoothedPDI[i] === null || smoothedNDI[i] === null) continue;
        pdiFinal.push(100 * (smoothedPDI[i]! / smoothedTR[i]!));
        ndiFinal.push(100 * (smoothedNDI[i]! / smoothedTR[i]!));
    }
    
    for (let i = 0; i < pdiFinal.length; i++) {
        const p = pdiFinal[i];
        const n = ndiFinal[i];
        if (p === null || n === null || (p+n) === 0) continue;
        const den = p + n;
        dx.push(den === 0 ? 0 : 100 * Math.abs(p - n) / den);
    }
    
    const adxRaw = smooth(dx.filter((v): v is number => v !== null), period);
    
    const fillCount = data.length - adxRaw.length;
    const adx = Array(fillCount).fill(null).concat(adxRaw);
    
    return { adx, pdi, ndi };
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

export function calculateAllIndicators(chartData: ChartData[], strategyCouncil: RobotStrategy[], timePeriod: TimePeriod): Indicators {
    
    if (chartData.length < 50) return null as any;

    let candles: CandleData[];
    if (!isCandle(chartData[0])) {
        candles = chartData.map(d => ({ epoch: d.epoch, open: (d as any).price, high: (d as any).price, low: (d as any).price, close: (d as any).price, volume: 1 }));
    } else {
        candles = chartData as CandleData[];
    }
    
    const getParam = (type: RobotStrategy['strategyType'], key: keyof RobotStrategy, defaultValue: any) => {
        const robot = strategyCouncil.find(r => r.strategyType === type);
        return robot && robot[key] !== undefined ? robot[key] : defaultValue;
    };

    const rsiValues = calculateRSI(candles, getParam('RSI', 'period', 14));
    const stochValues = calculateStochastic(candles, getParam('STOCHASTIC', 'period', 14));
    const macdValues = calculateMACD(candles, getParam('MACD_CROSS', 'fastPeriod', 12), getParam('MACD_CROSS', 'slowPeriod', 26), getParam('MACD_CROSS', 'signalPeriod', 9));
    const adxValues = calculateADX(candles, getParam('ADX_TREND', 'period', 14));
    
    const shortPeriod = getParam('MOVING_AVERAGE_CROSS', 'shortPeriod', 20);
    const longPeriod = getParam('MOVING_AVERAGE_CROSS', 'longPeriod', 50);
    const emaShort = calculateEMA(candles, shortPeriod);
    const smaLong = calculateSMA(candles, longPeriod);
    
    const bbPeriod = getParam('BOLLINGER_BANDS', 'period', 20);
    const bbStdDev = getParam('BOLLINGER_BANDS', 'stdDev', 2);
    const bbValues = calculateBollingerBands(candles, bbPeriod, bbStdDev);
    const lastBB = bbValues.length > 0 ? bbValues[bbValues.length - 1] : null;

    const bbwValues = DerivIndicators.bollingerBandwidth(candles, bbPeriod, bbStdDev);
    const donchianValues = DerivIndicators.donchian(candles, getParam('DONCHIAN_CHANNELS', 'period', 20));
    const chandelierValues = DerivIndicators.chandelierExit(candles, getParam('CHANDELIER_EXIT', 'period', 22), getParam('CHANDELIER_EXIT', 'multiplier', 3));
    const atrValues = DerivIndicators.atr(candles);
    const vwapValues = DerivIndicators.vwap(candles);
    const kamaValues = DerivIndicators.kama(candles, getParam('KAMA', 'period', 10));
    const stochRSIValues = DerivIndicators.stochRSI(candles, getParam('STOCH_RSI', 'period', 14));
    const zScoreValues = DerivIndicators.zScore(candles, getParam('Z_SCORE', 'period', 20));

    const aoValues = calculateAwesomeOscillator(candles);
    const trixValues = DerivIndicators.trix(candles, getParam('TRIX', 'period', 15));
    const rocValues = DerivIndicators.roc(candles, getParam('ROC', 'period', 12));
    const sarValues = calculateParabolicSAR(candles, getParam('PARABOLIC_SAR', 'acceleration', 0.02), getParam('PARABOLIC_SAR', 'maxAcceleration', 0.2));
    const ichimokuValues = DerivIndicators.ichimoku(candles);
    const mfiValues = DerivIndicators.mfi(candles, getParam('MFI', 'period', 14));
    const obvValues = DerivIndicators.obv(candles);
    const rviValues = DerivIndicators.rvi(candles, getParam('RVI', 'period', 10));

    return {
        rsi: rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null,
        stoch: stochValues.length > 0 ? stochValues[stochValues.length - 1] : null,
        atr: atrValues.length > 0 ? atrValues[atrValues.length - 1] : null,
        adx: adxValues.adx.length > 0 ? adxValues.adx[adxValues.adx.length - 1] : null,
        pdi: adxValues.pdi.length > 0 ? adxValues.pdi[adxValues.pdi.length - 1] : null,
        ndi: adxValues.ndi.length > 0 ? adxValues.ndi[adxValues.ndi.length - 1] : null,
        macd: {
            macd: macdValues.macd.length > 0 ? macdValues.macd[macdValues.macd.length - 1] : null,
            signal: macdValues.signal.length > 0 ? macdValues.signal[macdValues.signal.length - 1] : null,
            histogram: macdValues.histogram.length > 0 ? macdValues.histogram[macdValues.histogram.length - 1] : null,
        },
        ma: {
            short: emaShort.length > 0 ? emaShort[emaShort.length - 1] : null,
            long: smaLong.length > 0 ? smaLong[smaLong.length - 1] : null,
        },
        sma: smaLong,
        ema: emaShort,
        vwap: vwapValues,
        bb: lastBB || { upper: null, middle: null, lower: null },
        bollingerBands: bbValues,
        donchianChannels: donchianValues,
        kama: kamaValues.length > 0 ? kamaValues[kamaValues.length - 1] : null,
        bbw: bbwValues.length > 0 ? bbwValues[bbwValues.length-1] : null,
        stochRSI: stochRSIValues.length > 0 ? stochRSIValues[stochRSIValues.length - 1] : null,
        zScore: zScoreValues.length > 0 ? zScoreValues[zScoreValues.length - 1] : null,
        awesomeOscillator: aoValues.length > 0 ? aoValues[aoValues.length-1] : null,
        trix: trixValues.length > 0 ? trixValues[trixValues.length - 1] : null,
        roc: rocValues.length > 0 ? rocValues[rocValues.length - 1] : null,
        parabolicSAR: sarValues.length > 0 ? sarValues[sarValues.length - 1] : null,
        ichimoku: ichimokuValues.length > 0 ? ichimokuValues[ichimokuValues.length - 1] : { tenkan: null, kijun: null, senkouA: null, senkouB: null },
        mfi: mfiValues.length > 0 ? mfiValues[mfiValues.length - 1] : null,
        obv: obvValues.length > 0 ? obvValues[obvValues.length - 1] : null,
        chandelierExit: chandelierValues.length > 0 ? chandelierValues[chandelierValues.length - 1] : null,
        rvi: rviValues.length > 0 ? rviValues[rviValues.length-1] : null
    };
}
