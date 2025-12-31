/**
 * 🔬 SERVIÇOS AVANÇADOS DE TRADING ALGORÍTMICO
 * 
 * Este arquivo contém implementações matemáticas e estatísticas
 * para suporte ao sistema de trading evolutivo.
 * 
 * MÓDULOS:
 * ═══════════════════════════════════════════════════════════════════
 * 
 * 1. REGIME DETECTION
 *    - Hidden Markov Model simplificado
 *    - Detecção de 5 estados de mercado
 *    - Matriz de transição adaptativa
 * 
 * 2. STATISTICAL VALIDATION
 *    - Monte Carlo Permutation Test
 *    - Walk-Forward Analysis
 *    - Sharpe Ratio calculation
 *    - Drawdown tracking
 * 
 * 3. POSITION SIZING
 *    - Kelly Criterion
 *    - Fractional Kelly
 *    - Volatility-adjusted sizing
 * 
 * 4. MICROSTRUCTURE ANALYSIS
 *    - Parkinson Volatility
 *    - Yang-Zhang Volatility
 *    - Volume Flow Analysis
 *    - Mean Reversion metrics
 * 
 * 5. BAYESIAN INFERENCE
 *    - Prior/Posterior calculation
 *    - Confidence calibration (Platt Scaling)
 *    - Ensemble voting
 */

import type { CandleData, TickData } from '@/lib/types';

// ════════════════════════════════════════════════════════════════════
// 📊 TIPOS E INTERFACES
// ════════════════════════════════════════════════════════════════════

export type MarketRegime = 
  | 'trending_bull'
  | 'trending_bear'
  | 'ranging'
  | 'high_volatility'
  | 'breakout';

export interface RegimeDetectionResult {
  regime: MarketRegime;
  confidence: number;
  probabilities: Record<MarketRegime, number>;
  transitionMatrix: number[][];
}

export interface MonteCarloResult {
  score: number;              // 0-1, higher = more skill
  pValue: number;             // Statistical significance
  isSignificant: boolean;     // p < 0.05
  randomPnLDistribution: number[];
}

export interface VolatilityMetrics {
  closeToClose: number;       // Tradicional
  parkinson: number;          // High-Low based
  yangZhang: number;          // Open-High-Low-Close
  garmanKlass: number;        // Alternativa robusta
}

export interface PerformanceMetrics {
  sharpeRatio: number;
  sortinoRatio: number;       // Sharpe usando apenas downside deviation
  calmarRatio: number;        // Return / Max Drawdown
  maxDrawdown: number;
  maxDrawdownDuration: number; // Em número de trades
  profitFactor: number;       // Total wins / Total losses
  kellyFraction: number;
  avgWin: number;
  avgLoss: number;
  winRate: number;
}

export interface MicrostructureFeatures {
  spreadPercentage: number;
  volumeImbalance: number;
  tickVelocity: number;
  priceAcceleration: number;
  parkinsonVolatility: number;
  yangZhangVolatility: number;
  gapRatio: number;
  meanReversion: number;
}

// ════════════════════════════════════════════════════════════════════
// 🎯 REGIME DETECTION (Hidden Markov Model)
// ════════════════════════════════════════════════════════════════════

/**
 * Detecta o regime atual do mercado usando análise multi-indicador
 * 
 * ALGORITMO:
 * 1. Calcula scores para cada regime possível (0-1)
 * 2. Aplica inércia (regimes persistem)
 * 3. Usa matriz de transição para suavizar mudanças
 * 4. Retorna regime com maior probabilidade
 * 
 * @param candles Histórico de candles (mínimo 50)
 * @param indicators Indicadores técnicos calculados
 * @param prevRegime Regime anterior (para inércia)
 * @param transitionMatrix Matriz de transição de estados (opcional)
 */
export const detectMarketRegime = (
  candles: CandleData[],
  indicators: {
    adx?: number;
    pdi?: number;
    ndi?: number;
    bbw?: number;
    roc?: number;
    atr?: number;
  },
  prevRegime: MarketRegime = 'ranging',
  transitionMatrix?: number[][]
): RegimeDetectionResult => {
  
  const REGIME_LOOKBACK = 50;
  const ADX_TREND_THRESHOLD = 25;
  const ADX_WEAK_THRESHOLD = 20;
  
  if (candles.length < REGIME_LOOKBACK) {
    return {
      regime: 'ranging',
      confidence: 0.5,
      probabilities: {
        trending_bull: 0.2,
        trending_bear: 0.2,
        ranging: 0.4,
        high_volatility: 0.1,
        breakout: 0.1
      },
      transitionMatrix: initializeTransitionMatrix()
    };
  }

  // Inicializa scores para cada regime
  const scores: Record<MarketRegime, number> = {
    trending_bull: 0,
    trending_bear: 0,
    ranging: 0,
    high_volatility: 0,
    breakout: 0
  };

  const recentCandles = candles.slice(-REGIME_LOOKBACK);
  
  // ────────────────────────────────────────────────────────────────
  // 1. ANÁLISE DE TENDÊNCIA (ADX + Directional Indicators)
  // ────────────────────────────────────────────────────────────────
  if (indicators.adx !== undefined && indicators.pdi !== undefined && indicators.ndi !== undefined) {
    const { adx, pdi, ndi } = indicators;
    
    if (adx > ADX_TREND_THRESHOLD) {
      // Tendência forte detectada
      const trendStrength = Math.min((adx - ADX_TREND_THRESHOLD) / 25, 1);
      
      if (pdi > ndi) {
        scores.trending_bull = 0.7 + (trendStrength * 0.3);
      } else {
        scores.trending_bear = 0.7 + (trendStrength * 0.3);
      }
    } else if (adx < ADX_WEAK_THRESHOLD) {
      // Sem tendência clara
      scores.ranging = 0.7;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // 2. ANÁLISE DE VOLATILIDADE (Bollinger Width + ATR)
  // ────────────────────────────────────────────────────────────────
  if (indicators.bbw !== undefined && indicators.atr !== undefined) {
    // Calcula média da Bollinger Width
    const avgBBW = recentCandles.reduce((sum, candle, idx) => {
      // Estimativa simples da BBW histórica
      const range = (candle.high - candle.low) / candle.close;
      return sum + range;
    }, 0) / recentCandles.length;

    const currentBBW = indicators.bbw;
    
    // Se BBW atual está 50% acima da média, alta volatilidade
    if (currentBBW > avgBBW * 1.5) {
      scores.high_volatility = 0.8;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // 3. DETECÇÃO DE BREAKOUT (Price Action)
  // ────────────────────────────────────────────────────────────────
  if (recentCandles.length >= 20) {
    const last20 = recentCandles.slice(-20);
    const high = Math.max(...last20.map(c => c.high));
    const low = Math.min(...last20.map(c => c.low));
    const range = high - low;
    const currentPrice = recentCandles[recentCandles.length - 1].close;
    
    // Se preço está dentro de 5% das extremidades, provável breakout
    const distanceFromHigh = Math.abs(currentPrice - high) / range;
    const distanceFromLow = Math.abs(currentPrice - low) / range;
    
    if (distanceFromHigh < 0.05 || distanceFromLow < 0.05) {
      scores.breakout = 0.7;
      
      // Adiciona viés direcional baseado no momentum
      if (indicators.roc !== undefined) {
        if (indicators.roc > 0 && distanceFromHigh < 0.05) {
          scores.trending_bull += 0.2;
        } else if (indicators.roc < 0 && distanceFromLow < 0.05) {
          scores.trending_bear += 0.2;
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────
  // 4. CONFIRMAÇÃO POR MOMENTUM (ROC)
  // ────────────────────────────────────────────────────────────────
  if (indicators.roc !== undefined) {
    const absROC = Math.abs(indicators.roc);
    
    if (absROC > 1.0) {
      // Momentum forte
      if (indicators.roc > 0) {
        scores.trending_bull += 0.15;
      } else {
        scores.trending_bear += 0.15;
      }
    } else if (absROC < 0.3) {
      // Momentum fraco = ranging
      scores.ranging += 0.1;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // 5. INÉRCIA DE REGIME (Regimes tendem a persistir)
  // ────────────────────────────────────────────────────────────────
  scores[prevRegime] += 0.25;

  // ────────────────────────────────────────────────────────────────
  // 6. NORMALIZAÇÃO E SELEÇÃO
  // ────────────────────────────────────────────────────────────────
  
  // Normaliza scores para somarem 1 (probabilities)
  const totalScore = Object.values(scores).reduce((sum, s) => sum + s, 0);
  const probabilities = Object.entries(scores).reduce((acc, [regime, score]) => {
    acc[regime as MarketRegime] = totalScore > 0 ? score / totalScore : 0.2;
    return acc;
  }, {} as Record<MarketRegime, number>);

  // Seleciona regime com maior probabilidade
  const detectedRegime = (Object.keys(probabilities) as MarketRegime[]).reduce((a, b) =>
    probabilities[a] > probabilities[b] ? a : b
  );

  const confidence = probabilities[detectedRegime];

  // Atualiza matriz de transição
  const updatedTransitionMatrix = updateTransitionMatrix(
    transitionMatrix || initializeTransitionMatrix(),
    prevRegime,
    detectedRegime
  );

  return {
    regime: detectedRegime,
    confidence,
    probabilities,
    transitionMatrix: updatedTransitionMatrix
  };
};

/**
 * Inicializa matriz de transição com probabilidades uniformes
 */
const initializeTransitionMatrix = (): number[][] => {
  const regimes = 5; // Número de regimes
  const uniform = 1 / regimes;
  return Array(regimes).fill(null).map(() => Array(regimes).fill(uniform));
};

/**
 * Atualiza matriz de transição com nova observação
 * Usa moving average para suavizar
 */
const updateTransitionMatrix = (
  matrix: number[][],
  fromRegime: MarketRegime,
  toRegime: MarketRegime
): number[][] => {
  const regimeIndex: Record<MarketRegime, number> = {
    trending_bull: 0,
    trending_bear: 1,
    ranging: 2,
    high_volatility: 3,
    breakout: 4
  };

  const from = regimeIndex[fromRegime];
  const to = regimeIndex[toRegime];

  // Copia matriz
  const newMatrix = matrix.map(row => [...row]);

  // Incrementa contagem da transição observada
  const alpha = 0.1; // Taxa de aprendizado
  newMatrix[from][to] += alpha;

  // Re-normaliza a linha para somar 1
  const rowSum = newMatrix[from].reduce((sum, val) => sum + val, 0);
  newMatrix[from] = newMatrix[from].map(val => val / rowSum);

  return newMatrix;
};

// ════════════════════════════════════════════════════════════════════
// 📊 MONTE CARLO PERMUTATION TEST
// ════════════════════════════════════════════════════════════════════

/**
 * Testa se os resultados são devido a skill ou sorte
 * 
 * HIPÓTESE NULA: O timing dos trades não importa (sorte)
 * HIPÓTESE ALTERNATIVA: O timing dos trades é significativo (skill)
 * 
 * MÉTODO:
 * 1. Calcula P&L real
 * 2. Embaralha os resultados N vezes
 * 3. Calcula P&L de cada permutação
 * 4. Se P&L real > 95% das permutações, rejeitamos H0 (p < 0.05)
 * 
 * @param results Array de P&Ls individuais de cada trade
 * @param iterations Número de permutações (padrão: 1000)
 */
export const monteCarloValidation = (
  results: number[],
  iterations: number = 1000
): MonteCarloResult => {
  
  if (results.length < 30) {
    return {
      score: 0,
      pValue: 1,
      isSignificant: false,
      randomPnLDistribution: []
    };
  }

  // Calcula P&L real (soma acumulada considerando ordem)
  const realPnL = results.reduce((sum, r) => sum + r, 0);
  
  // Gera distribuição de P&Ls aleatórios
  const randomPnLs: number[] = [];
  let betterThanReal = 0;

  for (let i = 0; i < iterations; i++) {
    // Embaralha resultados (Fisher-Yates shuffle)
    const shuffled = [...results];
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }

    const randomPnL = shuffled.reduce((sum, r) => sum + r, 0);
    randomPnLs.push(randomPnL);

    if (randomPnL >= realPnL) {
      betterThanReal++;
    }
  }

  // Calcula p-value
  const pValue = betterThanReal / iterations;
  
  // Score: 1 - p_value (maior = melhor)
  const score = 1 - pValue;
  
  // Significância estatística: p < 0.05
  const isSignificant = pValue < 0.05;

  return {
    score,
    pValue,
    isSignificant,
    randomPnLDistribution: randomPnLs.sort((a, b) => a - b)
  };
};

// ════════════════════════════════════════════════════════════════════
// 📈 PERFORMANCE METRICS
// ════════════════════════════════════════════════════════════════════

/**
 * Calcula métricas completas de performance
 * 
 * SHARPE RATIO: (Retorno Médio - Risk Free) / Desvio Padrão
 * SORTINO RATIO: Como Sharpe, mas usa apenas downside deviation
 * CALMAR RATIO: Retorno Anual / Max Drawdown
 * PROFIT FACTOR: Total Wins / Total Losses
 * KELLY FRACTION: (p * b - q) / b
 */
export const calculatePerformanceMetrics = (
  trades: Array<{ profit: number; timestamp: number }>
): PerformanceMetrics => {
  
  if (trades.length === 0) {
    return {
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      maxDrawdown: 0,
      maxDrawdownDuration: 0,
      profitFactor: 0,
      kellyFraction: 0,
      avgWin: 0,
      avgLoss: 0,
      winRate: 0
    };
  }

  const profits = trades.map(t => t.profit);
  
  // ────────────────────────────────────────────────────────────────
  // 1. SHARPE RATIO
  // ────────────────────────────────────────────────────────────────
  const meanReturn = profits.reduce((sum, p) => sum + p, 0) / profits.length;
  const variance = profits.reduce((sum, p) => sum + Math.pow(p - meanReturn, 2), 0) / profits.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

  // ────────────────────────────────────────────────────────────────
  // 2. SORTINO RATIO (usa apenas desvio negativo)
  // ────────────────────────────────────────────────────────────────
  const negativeReturns = profits.filter(p => p < 0);
  const downsideVariance = negativeReturns.length > 0
    ? negativeReturns.reduce((sum, p) => sum + Math.pow(p, 2), 0) / negativeReturns.length
    : 0;
  const downsideStdDev = Math.sqrt(downsideVariance);
  const sortinoRatio = downsideStdDev > 0 ? meanReturn / downsideStdDev : 0;

  // ────────────────────────────────────────────────────────────────
  // 3. MAX DRAWDOWN
  // ────────────────────────────────────────────────────────────────
  let peak = 0;
  let maxDrawdown = 0;
  let currentDrawdownDuration = 0;
  let maxDrawdownDuration = 0;
  let equity = 0;

  for (const profit of profits) {
    equity += profit;
    
    if (equity > peak) {
      peak = equity;
      currentDrawdownDuration = 0;
    } else {
      currentDrawdownDuration++;
      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownDuration = currentDrawdownDuration;
      }
    }
  }

  // ────────────────────────────────────────────────────────────────
  // 4. CALMAR RATIO
  // ────────────────────────────────────────────────────────────────
  const totalReturn = profits.reduce((sum, p) => sum + p, 0);
  const calmarRatio = maxDrawdown > 0 ? totalReturn / maxDrawdown : 0;

  // ────────────────────────────────────────────────────────────────
  // 5. PROFIT FACTOR & WIN RATE
  // ────────────────────────────────────────────────────────────────
  const wins = profits.filter(p => p > 0);
  const losses = profits.filter(p => p < 0);
  
  const totalWins = wins.reduce((sum, p) => sum + p, 0);
  const totalLosses = Math.abs(losses.reduce((sum, p) => sum + p, 0));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;
  
  const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;
  const winRate = (wins.length / profits.length) * 100;

  // ────────────────────────────────────────────────────────────────
  // 6. KELLY CRITERION
  // ────────────────────────────────────────────────────────────────
  const p = wins.length / profits.length;
  const q = 1 - p;
  const b = avgLoss > 0 ? avgWin / avgLoss : 0;
  
  const kelly = b > 0 ? (p * b - q) / b : 0;
  const kellyFraction = Math.max(0, Math.min(kelly * 0.25, 0.2)); // Fractional Kelly (1/4)

  return {
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxDrawdown,
    maxDrawdownDuration,
    profitFactor,
    kellyFraction,
    avgWin,
    avgLoss,
    winRate
  };
};

// ════════════════════════════════════════════════════════════════════
// 📉 ADVANCED VOLATILITY ESTIMATORS
// ════════════════════════════════════════════════════════════════════

/**
 * Calcula múltiplos estimadores de volatilidade
 * 
 * PARKINSON: Usa High-Low, mais eficiente que close-to-close
 * YANG-ZHANG: Mais robusto, considera Open-High-Low-Close
 * GARMAN-KLASS: Alternativa ao Yang-Zhang
 */
export const calculateVolatilityMetrics = (
  candles: CandleData[]
): VolatilityMetrics => {
  
  if (candles.length < 2) {
    return {
      closeToClose: 0,
      parkinson: 0,
      yangZhang: 0,
      garmanKlass: 0
    };
  }

  // ────────────────────────────────────────────────────────────────
  // 1. CLOSE-TO-CLOSE (Tradicional)
  // ────────────────────────────────────────────────────────────────
  const returns = [];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i - 1].close > 0 && candles[i].close > 0) {
      returns.push(Math.log(candles[i].close / candles[i - 1].close));
    }
  }
  
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const closeToClose = Math.sqrt(variance);

  // ────────────────────────────────────────────────────────────────
  // 2. PARKINSON VOLATILITY
  // ────────────────────────────────────────────────────────────────
  const parkinsonVals = candles.map(c => {
    if (c.high <= 0 || c.low <= 0) return 0;
    return Math.pow(Math.log(c.high / c.low), 2);
  });
  const parkinson = Math.sqrt(
    parkinsonVals.reduce((sum, v) => sum + v, 0) / (parkinsonVals.length * 4 * Math.log(2))
  );

  // ────────────────────────────────────────────────────────────────
  // 3. YANG-ZHANG VOLATILITY
  // ────────────────────────────────────────────────────────────────
  let sumOvernight = 0;
  let sumOpen = 0;
  let sumClose = 0;

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];

    if (prev.close <= 0 || curr.open <= 0 || curr.high <= 0 || curr.low <= 0 || curr.close <= 0) continue;

    // Overnight component
    const overnight = Math.log(curr.open / prev.close);
    sumOvernight += overnight * overnight;

    // Open-to-close component
    const openToClose = Math.log(curr.close / curr.open);
    sumOpen += openToClose * openToClose;

    // High-low component (Rogers-Satchell)
    const hl = Math.log(curr.high / curr.close) * Math.log(curr.high / curr.open);
    const lh = Math.log(curr.low / curr.close) * Math.log(curr.low / curr.open);
    sumClose += hl + lh;
  }

  const n = candles.length - 1;
  const k = 0.34 / (1.34 + (n + 1) / (n - 1));

  const yangZhang = Math.sqrt(
    sumOvernight / n + k * sumOpen / n + (1 - k) * sumClose / n
  );

  // ────────────────────────────────────────────────────────────────
  // 4. GARMAN-KLASS VOLATILITY
  // ────────────────────────────────────────────────────────────────
  const garmanKlassVals = candles.map(c => {
    if (c.high <= 0 || c.low <= 0 || c.close <= 0 || c.open <= 0) return 0;
    
    const hl = Math.pow(Math.log(c.high / c.low), 2);
    const co = Math.pow(Math.log(c.close / c.open), 2);
    
    return 0.5 * hl - (2 * Math.log(2) - 1) * co;
  });

  const garmanKlass = Math.sqrt(
    garmanKlassVals.reduce((sum, v) => sum + v, 0) / garmanKlassVals.length
  );

  return {
    closeToClose,
    parkinson,
    yangZhang,
    garmanKlass
  };
};

// ════════════════════════════════════════════════════════════════════
// 🎲 BAYESIAN INFERENCE
// ════════════════════════════════════════════════════════════════════

/**
 * Calcula probabilidade posterior usando Teorema de Bayes
 * 
 * P(H|E) = P(E|H) * P(H) / P(E)
 * 
 * onde:
 * - H = Hipótese (trade será vencedor)
 * - E = Evidência (sinal do indicador)
 * - P(H) = Prior (win rate histórico)
 * - P(E|H) = Likelihood (confiança do sinal)
 * 
 * @param prior Probabilidade a priori (win rate histórico, 0-1)
 * @param likelihood Probabilidade da evidência dado hipótese verdadeira (confiança do sinal, 0-1)
 * @returns Probabilidade posterior (0-1)
 */
export const bayesianUpdate = (
  prior: number,
  likelihood: number
): number => {
  // Garante valores válidos
  prior = Math.max(0.01, Math.min(0.99, prior));
  likelihood = Math.max(0.01, Math.min(0.99, likelihood));

  // P(E) = P(E|H)*P(H) + P(E|¬H)*P(¬H)
  const probEvidence = 
    likelihood * prior + 
    (1 - likelihood) * (1 - prior);

  // P(H|E) = P(E|H) * P(H) / P(E)
  const posterior = (likelihood * prior) / probEvidence;

  return posterior;
};

/**
 * Calibra confiança usando Platt Scaling simplificado
 * 
 * Mapeia scores não calibrados para probabilidades calibradas
 * usando função sigmoide ajustada
 * 
 * @param rawScore Score não calibrado (tipicamente 0-100)
 * @param historicalWinRate Win rate histórico para calibração
 * @returns Score calibrado (0-1)
 */
export const calibrateConfidence = (
  rawScore: number,
  historicalWinRate: number
): number => {
  // Normaliza rawScore para 0-1
  const normalized = rawScore / 100;

  // Ajusta pela win rate histórica
  // Se win rate é 50%, não há viés
  // Se win rate > 50%, aumenta calibração
  // Se win rate < 50%, diminui calibração
  const bias = (historicalWinRate - 0.5) * 0.5;

  // Aplica sigmoid com ajuste
  const calibrated = 1 / (1 + Math.exp(-(normalized - 0.5 + bias) * 4));

  return calibrated;
};

// ════════════════════════════════════════════════════════════════════
// 🎯 WALK-FORWARD ANALYSIS
// ════════════════════════════════════════════════════════════════════

/**
 * Executa walk-forward analysis para validação
 * 
 * MÉTODO:
 * 1. Divide dados em janelas móveis
 * 2. Treina em janela N
 * 3. Testa em janela N+1
 * 4. Move janela e repete
 * 
 * @param data Dados históricos completos
 * @param trainSize Tamanho da janela de treino
 * @param testSize Tamanho da janela de teste
 * @param step Passo da janela móvel
 * @returns Array de resultados de cada fold
 */
export interface WalkForwardResult {
  fold: number;
  trainPeriod: { start: number; end: number };
  testPeriod: { start: number; end: number };
  testPerformance: PerformanceMetrics;
}

export const walkForwardAnalysis = (
  data: Array<{ timestamp: number; price: number; result?: number }>,
  trainSize: number = 1000,
  testSize: number = 200,
  step: number = 200
): WalkForwardResult[] => {
  
  const results: WalkForwardResult[] = [];
  let foldNumber = 0;

  for (let i = 0; i + trainSize + testSize <= data.length; i += step) {
    const trainEnd = i + trainSize;
    const testEnd = trainEnd + testSize;
    
    // Simulação: em um cenário real, você retreinaria seu modelo aqui
    const trainData = data.slice(i, trainEnd);
    
    // Testa na janela seguinte
    const testData = data.slice(trainEnd, testEnd);
    const testTrades = testData.map(d => ({ profit: d.result || 0, timestamp: d.timestamp }));
    
    const testPerformance = calculatePerformanceMetrics(testTrades);

    results.push({
      fold: foldNumber++,
      trainPeriod: { start: data[i].timestamp, end: data[trainEnd - 1].timestamp },
      testPeriod: { start: data[trainEnd].timestamp, end: data[testEnd - 1].timestamp },
      testPerformance
    });
  }
  
  return results;
};


// ════════════════════════════════════════════════════════════════════
// 🧠 MICROSTRUCTURE ANALYSIS
// ════════════════════════════════════════════════════════════════════
export const extractMicrostructureFeatures = (
  ticks: TickData[],
  candles: CandleData[]
): MicrostructureFeatures => {
  const MICROSTRUCTURE_WINDOW = 20;
  if (ticks.length < MICROSTRUCTURE_WINDOW) {
    return {
      spreadPercentage: 0,
      volumeImbalance: 0,
      tickVelocity: 0,
      priceAcceleration: 0,
      parkinsonVolatility: 0,
      yangZhangVolatility: 0,
      gapRatio: 0,
      meanReversion: 0,
    };
  }

  const recentTicks = ticks.slice(-MICROSTRUCTURE_WINDOW);
  const recentCandles = candles.slice(-MICROSTRUCTURE_WINDOW);

  const prices = recentTicks.map(t => t.price);
  const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const spreadEstimate = (Math.max(...prices) - Math.min(...prices)) / avgPrice;

  let upTicks = 0, downTicks = 0;
  for (let i = 1; i < recentTicks.length; i++) {
    if (recentTicks[i].price > recentTicks[i - 1].price) upTicks++;
    else if (recentTicks[i].price < recentTicks[i - 1].price) downTicks++;
  }
  const volumeImbalance = (upTicks - downTicks) / recentTicks.length;

  const timeSpan = recentTicks[recentTicks.length - 1].epoch - recentTicks[0].epoch;
  const tickVelocity = timeSpan > 0 ? recentTicks.length / timeSpan : 0;

  const returns = [];
  for (let i = 1; i < recentTicks.length; i++) {
    returns.push(recentTicks[i].price - recentTicks[i - 1].price);
  }
  let acceleration = 0;
  if (returns.length >= 2) {
    const velocityChanges = [];
    for (let i = 1; i < returns.length; i++) {
      velocityChanges.push(returns[i] - returns[i - 1]);
    }
    acceleration = velocityChanges.reduce((sum, v) => sum + v, 0) / velocityChanges.length;
  }
  
  const vol = calculateVolatilityMetrics(recentCandles);
  
  let gapCount = 0;
  const avgTickSize = prices.reduce((sum, p, i, arr) => {
    if (i === 0) return sum;
    return sum + Math.abs(p - arr[i - 1]);
  }, 0) / (prices.length - 1);

  for (let i = 1; i < recentTicks.length; i++) {
    const gap = Math.abs(recentTicks[i].price - recentTicks[i - 1].price);
    if (gap > avgTickSize * 2) gapCount++;
  }
  const gapRatio = gapCount / recentTicks.length;

  const stdDev = Math.sqrt(
    prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length
  );
  const currentPrice = recentTicks[recentTicks.length - 1].price;
  const meanReversion = stdDev > 0 ? (currentPrice - avgPrice) / stdDev : 0;

  return {
    spreadPercentage: spreadEstimate,
    volumeImbalance,
    tickVelocity,
    priceAcceleration: acceleration,
    parkinsonVolatility: vol.parkinson,
    yangZhangVolatility: vol.yangZhang,
    gapRatio,
    meanReversion,
  };
};

// ════════════════════════════════════════════════════════════════════
// 💡 POSITION SIZING (KELLY CRITERION)
// ════════════════════════════════════════════════════════════════════

export const calculateKellyStake = (
  balance: number,
  winRate: number,
  payoff: number,
  maxRisk: number = 0.05
): number => {
  if (winRate <= 0.52 || payoff <= 1) return 0.35;
  const p = winRate;
  const q = 1 - p;
  const b = payoff - 1;

  const kellyFraction = (p * b - q) / b;
  const safeFraction = kellyFraction * 0.25;
  const finalFraction = Math.min(safeFraction, maxRisk);

  return Math.max(0.35, Math.floor(balance * Math.max(0, finalFraction) * 100) / 100);
};


// ════════════════════════════════════════════════════════════════════
// 🤖 STRATEGY ANALYSIS BY REGIME
// ════════════════════════════════════════════════════════════════════

/**
 * Analisa a performance de uma estratégia em diferentes regimes
 * @returns Lista de regimes onde a estratégia é efetiva
 */
export const analyzeStrategyByRegime = (
  trades: Array<{ regime: MarketRegime; profit: number }>
): MarketRegime[] => {
  const regimeStats: Record<
    MarketRegime,
    { wins: number; losses: number; totalProfit: number }
  > = {
    trending_bull: { wins: 0, losses: 0, totalProfit: 0 },
    trending_bear: { wins: 0, losses: 0, totalProfit: 0 },
    ranging: { wins: 0, losses: 0, totalProfit: 0 },
    high_volatility: { wins: 0, losses: 0, totalProfit: 0 },
    breakout: { wins: 0, losses: 0, totalProfit: 0 },
  };

  for (const trade of trades) {
    const stat = regimeStats[trade.regime];
    if (trade.profit > 0) {
      stat.wins++;
    } else {
      stat.losses++;
    }
    stat.totalProfit += trade.profit;
  }

  const effectiveRegimes: MarketRegime[] = [];

  for (const regime in regimeStats) {
    const stats = regimeStats[regime as MarketRegime];
    const totalTrades = stats.wins + stats.losses;
    
    if (totalTrades < 10) continue; // Amostra pequena

    const winRate = (stats.wins / totalTrades) * 100;
    
    // Critério: win rate > 55% E lucro positivo
    if (winRate > 55 && stats.totalProfit > 0) {
      effectiveRegimes.push(regime as MarketRegime);
    }
  }

  return effectiveRegimes;
};
