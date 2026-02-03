// src/features/trading/services/volatility-forecast.ts
'use client';
/**
 * @fileOverview Serviço Numérico para Previsão de Volatilidade.
 * Contém funções matemáticas puras para serem usadas em hooks e engines de backtesting.
 */

/**
 * Limita um número a um intervalo [min, max].
 */
export const clamp = (x: number, min: number, max: number): number => Math.max(min, Math.min(x, max));

/**
 * Calcula os retornos logarítmicos a partir de uma série de preços.
 * Retornos logarítmicos são preferíveis em modelos financeiros por suas propriedades estatísticas.
 * r_t = ln(P_t / P_{t-1})
 */
export const logReturnsFromPrices = (prices: number[]): number[] => {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
        if (prices[i - 1] > 0 && prices[i] > 0) {
            returns.push(Math.log(prices[i] / prices[i - 1]));
        } else {
            returns.push(0);
        }
    }
    return returns;
};

/**
 * Atualiza a variância usando o modelo EWMA (Exponentially Weighted Moving Average).
 * Dá mais peso aos dados mais recentes.
 * var_t = λ * var_{t-1} + (1-λ) * r_{t-1}^2
 * @param prevVar A variância do passo anterior.
 * @param r O último retorno logarítmico.
 * @param lambda O fator de decaimento (ex: 0.94).
 */
export const ewmaVarianceUpdate = (prevVar: number, r: number, lambda: number): number => {
    return lambda * prevVar + (1 - lambda) * (r * r);
};

/**
 * Atualiza a variância usando o modelo GARCH(1,1).
 * Modelo mais complexo que considera a variância e o retorno do passo anterior.
 * var_t = ω + α * r_{t-1}^2 + β * var_{t-1}
 */
export const garch11Update = (
    prevVar: number,
    prevR2: number, // r_{t-1}^2
    params: { omega: number; alpha: number; beta: number }
): number => {
    return params.omega + params.alpha * prevR2 + params.beta * prevVar;
};

/**
 * Estima o delta de tempo (dt) em segundos a partir de uma série de timestamps epoch.
 * Usa a mediana para ser robusto a outliers (ex: pausas de mercado).
 * @param realData Array de objetos com a propriedade `epoch`.
 * @param window O número de pontos de dados recentes para analisar.
 */
export const estimateDtSecondsFromEpochs = (
    realData: { epoch: number }[],
    window: number = 50
): number => {
    if (realData.length < 2) return 1.0; // Default de 1 segundo

    const recentData = realData.slice(-window);
    if (recentData.length < 2) return 1.0;

    const deltas: number[] = [];
    for (let i = 1; i < recentData.length; i++) {
        const delta = recentData[i].epoch - recentData[i - 1].epoch;
        // Ignora pausas muito longas (provavelmente fim de semana)
        if (delta > 0 && delta < 60) { 
            deltas.push(delta);
        }
    }

    if (deltas.length === 0) return 1.0;

    // Usa a mediana para robustez
    deltas.sort((a, b) => a - b);
    const mid = Math.floor(deltas.length / 2);
    const medianDt = deltas.length % 2 !== 0 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2;
    
    // Limita o dt a um intervalo razoável [0.5s, 5s]
    return clamp(medianDt, 0.5, 5.0);
};

