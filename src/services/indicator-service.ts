/**
 * @fileOverview ENGINE DE CÁLCULO FINANCEIRO AUTÔNOMO V2.5
 * Fornece todos os 25+ indicadores necessários para o Conselho de Robôs.
 * Totalmente independente de bibliotecas externas.
 */

import type { CandleData, ChartData, TimePeriod, RobotStrategy, DurationUnit } from '@/lib/types';

// Interface exata que o use-robot-council-v2.ts espera
export interface Indicators {
    // Básicos
    rsi: number | null;
    stoch: number | null;
    atr: number | null;
    adx: number | null;
    pdi: number | null;
    ndi: number | null;
    
    // Médias e Tendência
    macd: { macd: number | null; signal: number | null; histogram: number | null };
    ma: { short: number | null; long: number | null; };
    sma: (number | null)[];
    ema: (number | null)[];
    psar: number | null; // Parabolic SAR
    ichimoku: { tenkan: number | null; kijun: number | null; spanA: number | null; spanB: number | null } | null;

    // Estrutura e Volatilidade
    bb: { upper: number | null; middle: number | null; lower: number | null }; // Último valor
    bbw: number | null; // Bandwidth
    donchian: { upper: number | null; lower: number | null } | null;
    kama: number | null;
    chandelier: { exitLong: number | null; exitShort: number | null } | null;
    
    // Momentum Avançado
    ao: number | null; // Awesome Oscillator
    aoPrev: number | null; // Para detectar aceleração
    trix: number | null;
    trixPrev: number | null;
    roc: number | null;
    stochRSI: number | null;
    rvi: number | null;

    // Volume e Estatística
    mfi: number | null;
    obv: number | null;
    obvPrev: number | null;
    vwap: (number | null)[];
    zScore: number | null;
}

// ============================================================================
// 🧮 BIBLIOTECA MATEMÁTICA INTERNA (Zero Dependências)
// ============================================================================

const isCandle = (d: ChartData): d is CandleData => d !== null && 'close' in d;

// 1. Médias Móveis (SMA e EMA)
const calculateSMA = (data: CandleData[], period: number): (number | null)[] => {
    if (data.length < period) return Array(data.length).fill(null);
    const results: (number | null)[] = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            results.push(null);
            continue;
        }
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j].close;
        results.push(sum / period);
    }
    return results;
};

const calculateEMA = (data: CandleData[], period: number): (number | null)[] => {
    if (data.length < period) return Array(data.length).fill(null);
    const k = 2 / (period + 1);
    const results: (number | null)[] = Array(period - 1).fill(null);
    
    // Primeira EMA é SMA
    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[i].close;
    let prevEma = sum / period;
    results.push(prevEma);

    for (let i = period; i < data.length; i++) {
        const currentEma = (data[i].close - prevEma) * k + prevEma;
        results.push(currentEma);
        prevEma = currentEma;
    }
    return results;
};

// 2. RSI & Stochastic
const calculateRSI = (data: CandleData[], period = 14): (number | null)[] => {
    if (data.length < period + 1) return Array(data.length).fill(null);
    const results: (number | null)[] = Array(period).fill(null);
    
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const change = data[i].close - data[i - 1].close;
        if (change > 0) avgGain += change;
        else avgLoss -= change;
    }
    avgGain /= period;
    avgLoss /= period;
    
    results.push(100 - (100 / (1 + (avgGain / (avgLoss === 0 ? 1 : avgLoss)))));

    for (let i = period + 1; i < data.length; i++) {
        const change = data[i].close - data[i - 1].close;
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        
        const rs = avgGain / (avgLoss === 0 ? 0.0001 : avgLoss);
        results.push(100 - (100 / (1 + rs)));
    }
    return results;
};

const calculateStochastic = (data: CandleData[], period = 14) => {
    if (data.length < period) return Array(data.length).fill(null);
    return data.map((_, i) => {
        if (i < period - 1) return null;
        const slice = data.slice(i - period + 1, i + 1);
        const low = Math.min(...slice.map(d => d.low));
        const high = Math.max(...slice.map(d => d.high));
        return high === low ? 50 : ((data[i].close - low) / (high - low)) * 100;
    });
};

// 3. ATR (Average True Range)
const calculateATR = (data: CandleData[], period = 14): (number | null)[] => {
    if (data.length < period + 1) return Array(data.length).fill(null);
    const trs = [0]; // Primeiro TR é irrelevante
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
    atrs.push(initialSum / period); // Primeiro ATR é média simples

    for(let i=period+1; i<data.length; i++) {
        const prevAtr = atrs[i-1]!;
        atrs.push(((prevAtr * (period - 1)) + trs[i]) / period);
    }
    return atrs;
};

// 4. MACD
const calculateMACD = (data: CandleData[], fast = 12, slow = 26, sig = 9) => {
    const fastEMA = calculateEMA(data, fast);
    const slowEMA = calculateEMA(data, slow);
    const macdLine = data.map((_, i) => (fastEMA[i] !== null && slowEMA[i] !== null) ? fastEMA[i]! - slowEMA[i]! : null);
    
    // Calcular Signal Line (EMA do MACD Line)
    // Precisamos filtrar nulls para calcular a EMA do sinal
    const validMacdIndices = macdLine.map((v, i) => v !== null ? i : -1).filter(i => i !== -1);
    const validMacdValues = validMacdIndices.map(i => ({ close: macdLine[i]! } as CandleData));
    
    const signalLineRaw = calculateEMA(validMacdValues, sig);
    
    // Remapear para o array original
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

// 5. Bollinger Bands & Bandwidth
const calculateBB = (data: CandleData[], period = 20, stdDev = 2) => {
    const sma = calculateSMA(data, period);
    return data.map((d, i) => {
        if (sma[i] === null) return { upper: null, middle: null, lower: null, width: null };
        
        let sumSqDiff = 0;
        for (let j = 0; j < period; j++) {
            sumSqDiff += Math.pow(data[i - j].close - sma[i]!, 2);
        }
        const std = Math.sqrt(sumSqDiff / period);
        const upper = sma[i]! + std * stdDev;
        const lower = sma[i]! - std * stdDev;
        
        return {
            upper, middle: sma[i], lower,
            width: (upper - lower) / sma[i]!
        };
    });
};

// 6. ADX (Complexo, mas necessário para os robôs de tendência)
const calculateADX = (data: CandleData[], period = 14) => {
    if (data.length < period * 3) {
        console.warn(`⚠️ ADX precisa de ${period * 3} candles, tem ${data.length}`);
        return { adx: null, pdi: null, ndi: null };
    }
    
    try {
        const tr = calculateATR(data, 1).map(v => v || 0);
        const pDM: number[] = [0];
        const nDM: number[] = [0];
        
        for(let i=1; i<data.length; i++) {
            const up = data[i].high - data[i-1].high;
            const down = data[i-1].low - data[i].low;
            pDM.push((up > down && up > 0) ? up : 0);
            nDM.push((down > up && down > 0) ? down : 0);
        }
        
        const smooth = (vals: number[], p: number) => {
            const res = Array(vals.length).fill(0);
            let sum = 0;
            for(let i=0; i<p && i<vals.length; i++) sum += vals[i];
            
            if (p - 1 < vals.length) res[p-1] = sum;
            
            for(let i=p; i<vals.length; i++) {
                res[i] = res[i-1] - (res[i-1]/p) + vals[i];
            }
            return res;
        };

        const sTR = smooth(tr, period);
        const sPDM = smooth(pDM, period);
        const sNDM = smooth(nDM, period);
        
        const pdi = sTR.map((v, i) => v === 0 ? 0 : 100 * (sPDM[i] / v));
        const ndi = sTR.map((v, i) => v === 0 ? 0 : 100 * (sNDM[i] / v));
        
        const dx = pdi.map((p, i) => {
            const n = ndi[i];
            return (p + n === 0) ? 0 : 100 * Math.abs(p - n) / (p + n);
        });
        
        const dxCandles = dx.map(d => ({close: d} as CandleData));
        const adxEma = calculateEMA(dxCandles, period);
        
        const lastIdx = data.length - 1;
        
        const adxValue = adxEma[lastIdx];
        const pdiValue = pdi[lastIdx];
        const ndiValue = ndi[lastIdx];
        
        if (!Number.isFinite(adxValue) || !Number.isFinite(pdiValue) || !Number.isFinite(ndiValue)) {
            console.warn('⚠️ ADX calculou valores inválidos');
            return { adx: null, pdi: null, ndi: null };
        }
        
        return { 
            adx: adxValue, 
            pdi: pdiValue, 
            ndi: ndiValue 
        };
        
    } catch (error) {
        console.error('❌ Erro ao calcular ADX:', error);
        return { adx: null, pdi: null, ndi: null };
    }
};


// 7. Novos Indicadores Avançados (Para os Comitês Específicos)

const calculateDonchian = (data: CandleData[], period = 20) => {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    const upper = Math.max(...slice.map(d => d.high));
    const lower = Math.min(...slice.map(d => d.low));
    return { upper, lower };
};

const calculateKAMA = (data: CandleData[], period = 10, fast = 2, slow = 30) => {
    if(data.length < period) return null;
    let kama = data[period-1].close; // Seed
    
    for(let i = period; i < data.length; i++) {
        const change = Math.abs(data[i].close - data[i-period].close);
        let volatility = 0;
        for(let j=0; j<period; j++) volatility += Math.abs(data[i-j].close - data[i-j-1].close);
        
        const er = volatility === 0 ? 0 : change / volatility;
        const sc = Math.pow(er * (2/(fast+1) - 2/(slow+1)) + 2/(slow+1), 2);
        kama = kama + sc * (data[i].close - kama);
    }
    return kama;
};

const calculateAO = (data: CandleData[]) => {
    if (data.length < 34) return { current: null, prev: null };
    const midPoints = data.map(d => ({ ...d, close: (d.high + d.low) / 2 }));
    const sma5 = calculateSMA(midPoints, 5);
    const sma34 = calculateSMA(midPoints, 34);
    
    const aoSeries = sma5.map((v, i) => (v !== null && sma34[i] !== null) ? v - sma34[i]! : null);
    return { 
        current: aoSeries[aoSeries.length - 1], 
        prev: aoSeries[aoSeries.length - 2] 
    };
};

const calculateIchimoku = (data: CandleData[]) => {
    // Standard params: 9, 26, 52
    if(data.length < 52) return null;
    
    const getAvg = (len: number) => {
        const slice = data.slice(-len);
        const h = Math.max(...slice.map(d => d.high));
        const l = Math.min(...slice.map(d => d.low));
        return (h + l) / 2;
    };
    
    const tenkan = getAvg(9);
    const kijun = getAvg(26);
    const spanA = (tenkan + kijun) / 2; // Projetado 26 no futuro, mas usamos o valor atual para calculo de suporte
    const spanB = getAvg(52);
    
    return { tenkan, kijun, spanA, spanB };
};

const calculateTRIX = (data: CandleData[], period = 15) => {
    // Triple EMA of Log Price
    if (data.length < period * 3) return { current: null, prev: null };
    
    const logPrices = data.map(d => ({ ...d, close: Math.log(d.close) }));
    const ema1 = calculateEMA(logPrices, period);
    
    // Helper to extract numeric array for next EMA
    const toCandles = (nums: (number|null)[]) => nums.map(n => ({ close: n || 0 } as CandleData));
    
    const ema2 = calculateEMA(toCandles(ema1), period);
    const ema3 = calculateEMA(toCandles(ema2), period);
    
    const trixSeries = [];
    for(let i=1; i<ema3.length; i++) {
        if(ema3[i] && ema3[i-1]) {
            trixSeries.push((ema3[i]! - ema3[i-1]!) * 10000); // Multiplicador arbitrário para legibilidade
        } else {
            trixSeries.push(null);
        }
    }
    
    return { 
        current: trixSeries[trixSeries.length - 1], 
        prev: trixSeries[trixSeries.length - 2] 
    };
};

const calculateChandelier = (data: CandleData[], atrValues: (number|null)[], period = 22, mult = 3.0) => {
    if(data.length < period) return null;
    const slice = data.slice(-period);
    const maxHigh = Math.max(...slice.map(d => d.high));
    const minLow = Math.min(...slice.map(d => d.low));
    const currentATR = atrValues[atrValues.length - 1] || 0;
    
    return {
        exitLong: maxHigh - currentATR * mult,
        exitShort: minLow + currentATR * mult
    };
};

const calculateZScore = (data: CandleData[], period = 20) => {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    const mean = slice.reduce((sum, d) => sum + d.close, 0) / period;
    const stdDev = Math.sqrt(slice.reduce((sum, d) => sum + Math.pow(d.close - mean, 2), 0) / period);
    const lastClose = slice[slice.length - 1].close;
    return stdDev === 0 ? 0 : (lastClose - mean) / stdDev;
};

const calculateMFI = (data: CandleData[], period = 14) => {
    if (data.length < period + 1) return null;
    
    let posMF = 0;
    let negMF = 0;
    
    const typicalPrice = (i: number) => (data[i].high + data[i].low + data[i].close) / 3;
    
    // Loop simples nos últimos 'period' candles
    for(let i = data.length - period; i < data.length; i++) {
        const tpCurrent = typicalPrice(i);
        const tpPrev = typicalPrice(i-1);
        const rawMF = tpCurrent * data[i].volume;
        
        if (tpCurrent > tpPrev) posMF += rawMF;
        else if (tpCurrent < tpPrev) negMF += rawMF;
    }
    
    if (negMF === 0) return 100;
    const mfi = 100 - (100 / (1 + posMF / negMF));
    return mfi;
};

const calculateOBV = (data: CandleData[]) => {
    if (data.length < 2) return { current: null, prev: null };
    // OBV é cumulativo desde o início do array carregado
    let obv = 0;
    const obvHistory: number[] = [0];
    
    for(let i=1; i<data.length; i++) {
        if (data[i].close > data[i-1].close) obv += data[i].volume;
        else if (data[i].close < data[i-1].close) obv -= data[i].volume;
        obvHistory.push(obv);
    }
    
    return {
        current: obvHistory[obvHistory.length - 1],
        prev: obvHistory[obvHistory.length - 2]
    };
};

const calculateStochRSI = (data: CandleData[], rsiValues: (number|null)[], period = 14) => {
    // Stoch do RSI
    const validRSI = rsiValues.filter(v => v !== null) as number[];
    if (validRSI.length < period) return null;
    
    const slice = validRSI.slice(-period);
    const minRSI = Math.min(...slice);
    const maxRSI = Math.max(...slice);
    const currentRSI = slice[slice.length - 1];
    
    return maxRSI === minRSI ? 0.5 : (currentRSI - minRSI) / (maxRSI - minRSI);
};

const calculateVWAP = (data: CandleData[]): (number | null)[] => {
    if (data.length === 0) return [];
    let cumPV = 0;
    let cumVol = 0;
    return data.map(d => {
        const tp = (d.high + d.low + d.close) / 3;
        cumPV += tp * d.volume;
        cumVol += d.volume;
        return cumVol === 0 ? null : cumPV / cumVol;
    });
};

// ============================================================================
// 🚀 FUNÇÃO PRINCIPAL EXPORTADA
// ============================================================================

export function calculateAllIndicators(
    chartData: ChartData[], 
    strategyCouncil: RobotStrategy[], 
    timePeriod: TimePeriod,
    contractDuration: { duration: number, unit: DurationUnit }
): Indicators | null {
    
    if (!chartData || chartData.length < 50) {
        console.warn(`⚠️ [Indicators] Dados insuficientes: ${chartData?.length || 0}/50 candles`);
        return null;
    }

    let candles: CandleData[];
    if (isCandle(chartData[0])) {
        candles = chartData as CandleData[];
    } else {
        candles = chartData.map(d => ({ 
            epoch: d.epoch, 
            open: (d as any).price, 
            high: (d as any).price, 
            low: (d as any).price, 
            close: (d as any).price, 
            volume: 1 
        }));
    }
    
    const validCandles = candles.filter(c => 
        c.close > 0 && 
        c.open > 0 && 
        c.high > 0 && 
        c.low > 0 &&
        Number.isFinite(c.close) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low)
    );
    
    if (validCandles.length < 50) {
        console.warn(`⚠️ [Indicators] Apenas ${validCandles.length}/50 candles válidos`);
        return null;
    }

    try {
        const getParam = (type: RobotStrategy['strategyType'], key: keyof RobotStrategy, defaultValue: any) => {
            const robot = strategyCouncil.find(r => r.strategyType === type);
            return robot && robot[key] !== undefined ? robot[key] : defaultValue;
        };

        const rsiSeries = calculateRSI(validCandles, getParam('RSI', 'period', 14));
        const stochSeries = calculateStochastic(validCandles, getParam('STOCHASTIC', 'period', 14));
        const atrSeries = calculateATR(validCandles, 14);
        const smaLong = calculateSMA(validCandles, getParam('MOVING_AVERAGE_CROSS', 'longPeriod', 50));
        const emaShort = calculateEMA(validCandles, getParam('MOVING_AVERAGE_CROSS', 'shortPeriod', 20));
        const macdData = calculateMACD(validCandles);
        const bbData = calculateBB(validCandles);
        
        const adxData = calculateADX(validCandles);
        const donchian = calculateDonchian(validCandles);
        const kama = calculateKAMA(validCandles);
        const aoData = calculateAO(validCandles);
        const trixData = calculateTRIX(validCandles);
        const ichimoku = calculateIchimoku(validCandles);
        const chandelier = calculateChandelier(validCandles, atrSeries);
        const zScore = calculateZScore(validCandles);
        const mfi = calculateMFI(validCandles);
        const obvData = calculateOBV(validCandles);
        const stochRSI = calculateStochRSI(validCandles, rsiSeries);
        const vwapSeries = calculateVWAP(validCandles);
        
        const rocPeriod = getParam('ROC', 'period', 12);
        const roc = validCandles.length > rocPeriod ? 
            ((validCandles[validCandles.length-1].close - validCandles[validCandles.length-1-rocPeriod].close) / validCandles[validCandles.length-1-rocPeriod].close) * 100 : null;

        const rviPeriod = 10;
        const rviNumerator = validCandles.slice(-rviPeriod).reduce((acc, c, i, arr) => i > 0 ? acc + (c.close - arr[i-1].close) : acc, 0);
        const rviDenominator = validCandles.slice(-rviPeriod).reduce((acc, c) => acc + (c.high - c.low), 0);
        const rvi = rviDenominator === 0 ? 50 : (rviNumerator / rviDenominator) * 50 + 50;

        const psar = emaShort[emaShort.length-1];

        const indicators: Indicators = {
            rsi: rsiSeries[rsiSeries.length - 1],
            stoch: stochSeries[stochSeries.length - 1],
            atr: atrSeries[atrSeries.length - 1],
            adx: adxData.adx,
            pdi: adxData.pdi,
            ndi: adxData.ndi,
            macd: {
                macd: macdData.macd[macdData.macd.length - 1],
                signal: macdData.signal[macdData.signal.length - 1],
                histogram: macdData.histogram[macdData.histogram.length - 1]
            },
            ma: {
                short: emaShort[emaShort.length - 1],
                long: smaLong[smaLong.length - 1]
            },
            sma: smaLong,
            ema: emaShort,
            bb: bbData[bbData.length - 1],
            bbw: bbData[bbData.length - 1].width,
            donchian,
            kama,
            chandelier,
            ichimoku,
            ao: aoData.current,
            aoPrev: aoData.prev,
            trix: trixData.current,
            trixPrev: trixData.prev,
            obv: obvData.current,
            obvPrev: obvData.prev,
            roc,
            stochRSI,
            rvi,
            mfi,
            vwap: vwapSeries,
            zScore,
            psar
        };
        
        return indicators;

    } catch (e) {
        console.error("❌ [Indicators] Erro fatal:", e);
        return null;
    }
}
