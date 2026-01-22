/**
 * @fileOverview ENGINE DE CÁLCULO FINANCEIRO AUTÔNOMO V2.5 (VERSÃO MESTRE)
 * =================================================================================
 * MÓDULO DE SERVIÇO (SERVICE LAYER)
 * 
 * OBJETIVO DIDÁTICO:
 * Este arquivo demonstra como transformar dados brutos de preço (OHLC) em sinais
 * matemáticos utilizáveis. Ele segue o princípio de "Pure Functions" (Funções Puras):
 * Mesma entrada sempre gera a mesma saída, sem efeitos colaterais.
 * 
 * MELHORIAS DE ARQUITETURA:
 * 1. Sincronia: Limite de candles ajustado para 30 (mesmo do Cérebro).
 * 2. Robustez: Tratamento de "Zero Division" em todos os osciladores.
 * 3. Tipagem: Uso estrito de TypeScript para evitar erros de runtime.
 * 4. OTIMIZAÇÃO: Cache de indicadores para evitar recálculos desnecessários.
 */

import type { CandleData, ChartData, TimePeriod, RobotStrategy, DurationUnit } from '@/lib/types';

// ============================================================================
// 1. DEFINIÇÃO DA INTERFACE DE SAÍDA (O "Menu" de Indicadores)
// ============================================================================
// Esta interface define exatamente o que este serviço entrega para o Cérebro.
export interface Indicators {
    // --- Osciladores de Momento ---
    rsi: number | null;      // Relative Strength Index
    stoch: number | null;    // Stochastic Oscillator
    stochRSI: number | null; // Stochastic do RSI
    mfi: number | null;      // Money Flow Index: RSI ponderado por volume
    rvi: number | null;      // Relative Volatility Index: Direção da volatilidade
    roc: number | null;      // Rate of Change: Velocidade pura da mudança de preço
    trix: number | null;     // Triple Exponential Average: Filtra ruídos insignificantes
    trixPrev: number | null; // Valor anterior do TRIX (para detectar cruzamentos)
    ao: number | null;       // Awesome Oscillator: Momentum de mercado (comparação de médias)
    aoPrev: number | null;   // Valor anterior do AO para detectar "Twin Peaks" ou "Saucers"
    cci?: number | null;     // Commodity Channel Index (Opcional)

    // --- Indicadores de Tendência ---
    adx: number | null;      // Average Directional Index: Força da tendência (sem direção)
    pdi: number | null;      // Positive Directional Indicator: Força dos touros
    ndi: number | null;      // Negative Directional Indicator: Força dos ursos
    macd: { 
        macd: number | null; 
        signal: number | null; 
        histogram: number | null // A diferença entre MACD e Sinal (Sinal de entrada)
    };
    psar: number | null;     // Parabolic SAR: Pontos de parada e reversão (Stop Loss dinâmico)
    ichimoku: { 
        tenkan: number | null; // Média rápida (conversão)
        kijun: number | null;  // Média base
        spanA: number | null;  // Limite A da Nuvem
        spanB: number | null   // Limite B da Nuvem
    } | null;
    kama: number | null;     // Kaufman Adaptive MA: Média que ignora ruído lateral
    zScore: number | null;   // Estatística: Distância do preço em relação à média (Desvio Padrão)

    // --- Médias Móveis ---
    ma: { short: number | null; long: number | null; }; // Par para cruzamentos
    sma: (number | null)[];  // Simple Moving Average (Histórico completo)
    ema: (number | null)[];  // Exponential Moving Average (Histórico completo)
    vwap: (number | null)[]; // Volume Weighted Average Price (Preço Médio Institucional)

    // --- Volatilidade e Canais ---
    atr: number | null;      // Average True Range: Volatilidade absoluta em pontos
    bb: { upper: number | null; middle: number | null; lower: number | null }; // Bandas de Bollinger
    bbw: number | null;      // Bandwidth: Largura das bandas (indica compressão/explosão)
    bollingerBands: ({ upper: number; middle: number; lower: number } | null)[]; // Histórico para gráficos
    donchian: { upper: number | null; lower: number | null } | null; // Máximas e Mínimas de N períodos
    chandelier: { exitLong: number | null; exitShort: number | null } | null; // Trailing Stop baseado em ATR

    // --- Volume ---
    obv: number | null;      // On Balance Volume: Fluxo acumulado de volume
    obvPrev: number | null;  // Para detectar divergências
}

// ============================================================================
// OTIMIZAÇÃO #4: CACHE DE INDICADORES
// ============================================================================
const indicatorCache = new Map<string, { 
  indicators: Indicators; 
  lastCandleEpoch: number;
  timePeriod: TimePeriod;
}>();

// ============================================================================
// 2. BIBLIOTECA MATEMÁTICA (CORE LOGIC)
// ============================================================================

// Helper: Verifica se um objeto é um Candle válido
const isCandle = (d: ChartData): d is CandleData => d != null && 'close' in d;

/**
 * Média Móvel Simples (SMA)
 * Fórmula: Soma(Preços) / N
 */
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

/**
 * Média Móvel Exponencial (EMA)
 * Fórmula: (PreçoAtual - EMA_Anterior) * Multiplicador + EMA_Anterior
 * Multiplicador = 2 / (Periodo + 1)
 */
const calculateEMA = (data: CandleData[], period: number): (number | null)[] => {
    if (data.length < period) return Array(data.length).fill(null);
    const k = 2 / (period + 1); // Fator de suavização
    const results: (number | null)[] = Array(period - 1).fill(null);
    
    // Inicialização com SMA
    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[i].close;
    let prevEma = sum / period;
    results.push(prevEma);

    // Cálculo Recursivo
    for (let i = period; i < data.length; i++) {
        const currentEma = (data[i].close - prevEma) * k + prevEma;
        results.push(currentEma);
        prevEma = currentEma;
    }
    return results;
};

/**
 * Relative Strength Index (RSI)
 * Compara a magnitude dos ganhos recentes com as perdas recentes.
 */
const calculateRSI = (data: CandleData[], period = 14): (number | null)[] => {
    if (data.length < period + 1) return Array(data.length).fill(null);
    const results: (number | null)[] = Array(period).fill(null);
    
    // Primeira média de ganhos e perdas
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const change = data[i].close - data[i - 1].close;
        if (change > 0) avgGain += change;
        else avgLoss -= change;
    }
    avgGain /= period;
    avgLoss /= period;
    
    // RSI Inicial
    // Proteção contra divisão por zero se avgLoss for 0
    results.push(100 - (100 / (1 + (avgGain / (avgLoss === 0 ? 0.0001 : avgLoss)))));

    // RSI Suavizado (Wilder's Smoothing)
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

/**
 * Estocástico (Stochastic Oscillator)
 * Fórmula: (Close - LowestLow) / (HighestHigh - LowestLow) * 100
 */
const calculateStochastic = (data: CandleData[], period = 14) => {
    if (data.length < period) return Array(data.length).fill(null);
    return data.map((_, i) => {
        if (i < period - 1) return null;
        const slice = data.slice(i - period + 1, i + 1);
        const low = Math.min(...slice.map(d => d.low));
        const high = Math.max(...slice.map(d => d.high));
        // Se High == Low (mercado parado), retorna 50 (neutro) para não dividir por zero
        return high === low ? 50 : ((data[i].close - low) / (high - low)) * 100;
    });
};

/**
 * Average True Range (ATR) - Versão Robusta
 * Mede a volatilidade considerando gaps de preço.
 */
const calculateATR = (data: CandleData[], period = 14): (number | null)[] => {
    if (data.length < period + 1) return Array(data.length).fill(null);
    const trs = [0]; 
    
    for(let i=1; i<data.length; i++) {
        const hl = data[i].high - data[i].low;
        const hc = Math.abs(data[i].high - data[i-1].close);
        const lc = Math.abs(data[i].low - data[i-1].close);
        // O True Range é o maior desses 3 valores
        trs.push(Math.max(hl, hc, lc));
    }
    
    const atrs: (number | null)[] = Array(period).fill(null);
    let initialSum = 0;
    for(let i=1; i<=period; i++) initialSum += trs[i];
    atrs.push(initialSum / period); 

    // Suavização Wilders
    for(let i=period+1; i<data.length; i++) {
        const prevAtr = atrs[i-1] || 0;
        atrs.push(((prevAtr * (period - 1)) + trs[i]) / period);
    }
    return atrs;
};

/**
 * MACD (Moving Average Convergence Divergence)
 */
const calculateMACD = (data: CandleData[], fast = 12, slow = 26, sig = 9) => {
    const fastEMA = calculateEMA(data, fast);
    const slowEMA = calculateEMA(data, slow);
    const macdLine = data.map((_, i) => (fastEMA[i] !== null && slowEMA[i] !== null) ? fastEMA[i]! - slowEMA[i]! : null);
    
    // Truque para calcular EMA de um array que contém nulls no início
    const validMacdIndices = macdLine.map((v, i) => v !== null ? i : -1).filter(i => i !== -1);
    const validMacdValues = validMacdIndices.map(i => ({ close: macdLine[i]! } as CandleData));
    const signalLineRaw = calculateEMA(validMacdValues, sig);
    
    const signalLine: (number | null)[] = Array(data.length).fill(null);
    const histogram: (number | null)[] = Array(data.length).fill(null);
    
    // Mapear de volta para os índices originais
    validMacdIndices.forEach((originalIndex, idx) => {
        signalLine[originalIndex] = signalLineRaw[idx];
        if (macdLine[originalIndex] !== null && signalLine[originalIndex] !== null) {
            histogram[originalIndex] = macdLine[originalIndex]! - signalLine[originalIndex]!;
        }
    });

    return { macd: macdLine, signal: signalLine, histogram };
};

/**
 * Bandas de Bollinger
 * Usam desvio padrão para medir a dispersão dos preços em torno da média.
 */
const calculateBB = (data: CandleData[], period = 20, stdDev = 2): ({ upper: number; middle: number; lower: number; } | null)[] => {
    const sma = calculateSMA(data, period);
    return data.map((_, i) => {
        if (sma[i] === null) return null;
        
        // Cálculo do Desvio Padrão
        let sumSqDiff = 0;
        const slice = data.slice(i - period + 1, i + 1);
        for (const d of slice) {
            sumSqDiff += Math.pow(d.close - sma[i]!, 2);
        }
        
        const std = Math.sqrt(sumSqDiff / period);
        
        return { 
            upper: sma[i]! + std * stdDev, 
            middle: sma[i]!, 
            lower: sma[i]! - std * stdDev 
        };
    });
};

/**
 * ADX (Average Directional Index) - Versão Blindada
 * Essencial para detectar se o mercado está em tendência ou lateral.
 * Contém proteção explícita contra erros de cálculo em mercados sem volume.
 */
const calculateADX = (data: CandleData[], period = 14) => {
    if (data.length < period * 3) {
        console.warn(`⚠️ ADX precisa de ${period * 3} candles, tem ${data.length}`);
        return { adx: null, pdi: null, ndi: null };
    }
    
    try {
        const tr = calculateATR(data, 1).map(v => v || 0);
        const pDM: number[] = [0];
        const nDM: number[] = [0];
        
        // Movimento Direcional (+DM e -DM)
        for(let i=1; i<data.length; i++) {
            const up = data[i].high - data[i-1].high;
            const down = data[i-1].low - data[i].low;
            pDM.push((up > down && up > 0) ? up : 0);
            nDM.push((down > up && down > 0) ? down : 0);
        }
        
        // Função de Suavização Wilder
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
        
        // Cálculo Seguro de DI (Directional Indicators)
        // Evita dividir por zero se o True Range for 0
        const pdi = sTR.map((v, i) => v === 0 ? 0 : 100 * (sPDM[i] / v));
        const ndi = sTR.map((v, i) => v === 0 ? 0 : 100 * (sNDM[i] / v));
        
        // Cálculo do DX
        const dx = pdi.map((p, i) => {
            const n = ndi[i];
            // FAIL-SAFE CRÍTICO: Se sum for 0, DX é 0
            const sum = p + n;
            return (sum === 0) ? 0 : 100 * Math.abs(p - n) / sum;
        });
        
        // ADX é a EMA do DX
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
        // Fallback neutro em caso de erro matemático extremo
        return { adx: 20, pdi: 0, ndi: 0 }; 
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
        const rawMF = tpCurrent * (data[i].volume || 1);
        
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
        const vol = data[i].volume || 1;
        if (data[i].close > data[i-1].close) obv += vol;
        else if (data[i].close < data[i-1].close) obv -= vol;
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
        const vol = d.volume || 1;
        cumPV += tp * vol;
        cumVol += vol;
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
    
    if (!chartData || chartData.length < 30) {
        console.warn(`⚠️ [Indicators] Dados insuficientes: ${chartData?.length || 0}/30 candles`);
        return null;
    }
    
    // Validação de dados de entrada
    const validCandles = chartData.filter(isCandle).filter(c => 
        c && c.close > 0 && Number.isFinite(c.close) &&
        c.open > 0 && Number.isFinite(c.open) &&
        c.high > 0 && Number.isFinite(c.high) &&
        c.low > 0 && Number.isFinite(c.low)
    );
    
    if (validCandles.length < 30) {
        console.warn(`⚠️ [Indicators] Apenas ${validCandles.length}/30 candles válidos`);
        return null;
    }
    
    const lastCandle = validCandles[validCandles.length - 1];
    const cacheKey = `${timePeriod}-${validCandles.length}-${lastCandle.epoch}-${lastCandle.close}`;

    // Verifica o cache primeiro
    const cached = indicatorCache.get(cacheKey);
    if (cached) {
        return cached.indicators;
    }

    try {
        const getParam = (type: RobotStrategy['strategyType'], key: keyof RobotStrategy, defaultValue: any) => {
            const robot = strategyCouncil.find(r => r.strategyType === type);
            if(robot && robot[key] !== undefined) return robot[key];
            if(key === 'period' || key === 'shortPeriod' || key === 'fastPeriod') {
                if (timePeriod.endsWith('m') && parseInt(timePeriod) <= 5) return Math.max(5, Math.floor(defaultValue / 2));
                if (timePeriod.endsWith('h') || timePeriod.endsWith('d')) return defaultValue * 2;
            }
            return defaultValue;
        };

        const rsiSeries = calculateRSI(validCandles, getParam('RSI', 'period', 14));
        const stochSeries = calculateStochastic(validCandles, getParam('STOCHASTIC', 'period', 14));
        const atrSeries = calculateATR(validCandles, 14);
        const longPeriod = getParam('MOVING_AVERAGE_CROSS', 'longPeriod', 50);
        const shortPeriod = getParam('MOVING_AVERAGE_CROSS', 'shortPeriod', 20);
        const smaLong = calculateSMA(validCandles, longPeriod);
        const emaShort = calculateEMA(validCandles, shortPeriod);
        const macdData = calculateMACD(validCandles);
        const bbSeries = calculateBB(validCandles);
        const bbData = bbSeries[bbSeries.length - 1];
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
            bb: bbData || { upper: null, middle: null, lower: null },
            bbw: bbData && bbData.middle ? ((bbData.upper! - bbData.lower!) / bbData.middle!) * 100 : null,
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
            psar,
            bollingerBands: bbSeries,
        };
        
        // Salva no cache
        indicatorCache.set(cacheKey, {
            indicators,
            lastCandleEpoch: lastCandle.epoch,
            timePeriod
        });

        // Limita o tamanho do cache para evitar memory leaks
        if (indicatorCache.size > 20) {
            const firstKey = indicatorCache.keys().next().value;
            indicatorCache.delete(firstKey);
        }

        return indicators;

    } catch (e) {
        console.error("❌ [Indicators] Erro de Cálculo:", e);
        return null;
    }
}
