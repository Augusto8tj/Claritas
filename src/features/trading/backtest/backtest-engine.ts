// src/features/trading/backtest/backtest-engine.ts
/**
 * @fileOverview Motor de Backtesting Offline para o Modelo Preditivo Estocástico.
 * Simula a performance do hook `useStochasticModels` sobre um grande conjunto de dados históricos.
 * É uma função pura e determinística, sem dependências de React ou UI.
 */
import type { ChartData, CandleData } from '@/lib/types';
import { 
    ewmaVarianceUpdate, 
    logReturnsFromPrices,
    clamp
} from '@/features/trading/services/volatility-forecast';

// --- CONFIGURAÇÕES ---
const DEFAULT_SEED = 12345;
const ASSERTIVENESS_HISTORY_LIMIT = 1000;
const INITIAL_SIGMA = 0.10;
const DRIFT_LIMIT = 0.01; // Limite mais conservador para log-space
const ADAPTIVE_DRIFT_LEARNING_RATE = 0.1;
const DRIFT_EMA_ALPHA = 0.3;

// --- TIPOS DE DADOS ---

interface HorizonConfig {
    name: string;
    ticks: number; // Duração em número de pontos de dados (sejam ticks ou velas)
}

export interface BacktestConfig {
    horizons: HorizonConfig[];
    seed?: number;
    volatilityModel?: 'EWMA';
    ewmaLambda?: number;
}

export interface BacktestHorizonMetrics {
    wins: number;
    total: number;
    winRate: number;
    finalSigma: number;
    finalDrift: number;
}

export interface BacktestResult {
    config: BacktestConfig;
    totalSteps: number;
    metricsByHorizon: Record<string, BacktestHorizonMetrics>;
    stability: {
        block: number;
        winRate: number;
    }[];
}

// --- LÓGICA DO MOTOR ---

/**
 * Gerador de Números Pseudo-Aleatórios (PRNG) - Linear Congruential Generator (LCG)
 * Garante que as simulações sejam reprodutíveis com a mesma seed.
 */
class SeededRandom {
    private seed: number;
    private readonly m = 2**32;
    private readonly a = 1664525;
    private readonly c = 1013904223;

    constructor(seed: number) {
        this.seed = seed % this.m;
    }

    next(): number {
        this.seed = (this.a * this.seed + this.c) % this.m;
        return this.seed / this.m;
    }

    /**
     * Gera um número aleatório normal usando o método Box-Muller.
     */
    normal(): number {
        let u1 = 0, u2 = 0;
        while (u1 === 0) u1 = this.next();
        u2 = this.next();
        return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    }
}

/**
 * Executa um backtest do modelo preditivo estocástico em dados históricos.
 */
export function runStochasticBacktest(
    data: ChartData[],
    config: BacktestConfig
): BacktestResult {

    const prices = data.map(d => 'close' in d ? d.close : d.price);
    const logReturns = logReturnsFromPrices(prices);
    const prng = new SeededRandom(config.seed || DEFAULT_SEED);

    // Estruturas de dados para o estado da simulação
    const pendingPredictions: Record<string, { startPrice: number; predictedEndPrice: number; endIndex: number }[]> = {};
    const assertiveness: Record<string, { wins: number; total: number }> = {};
    const sigmas: Record<string, number> = {};
    const drifts: Record<string, number> = {};
    const errorEmas: Record<string, number> = {};

    config.horizons.forEach(h => {
        pendingPredictions[h.name] = [];
        assertiveness[h.name] = { wins: 0, total: 0 };
        sigmas[h.name] = INITIAL_SIGMA;
        drifts[h.name] = 0;
        errorEmas[h.name] = 0;
    });

    const stabilityResults: { block: number; wins: number; total: number }[] = [];
    const BLOCK_SIZE = 1000;
    let currentBlock = 0;

    // --- LOOP PRINCIPAL DO BACKTEST ---
    for (let i = 1; i < prices.length; i++) {
        const lastLogReturn = logReturns[i - 1] || 0;

        // Atualizar estado do bloco de estabilidade
        if (i % BLOCK_SIZE === 0) {
            const blockWins = Object.values(assertiveness).reduce((sum, h) => sum + h.wins, 0) - (stabilityResults[currentBlock-1]?.wins || 0);
            const blockTotal = Object.values(assertiveness).reduce((sum, h) => sum + h.total, 0) - (stabilityResults[currentBlock-1]?.total || 0);
            stabilityResults.push({ block: currentBlock, wins: blockWins, total: blockTotal });
            currentBlock++;
        }

        config.horizons.forEach(h => {
            // 1. Maturação de previsões pendentes
            pendingPredictions[h.name] = pendingPredictions[h.name].filter(pred => {
                if (i >= pred.endIndex) {
                    const actualEndPrice = prices[pred.endIndex];
                    
                    const predictedDirection = pred.predictedEndPrice > pred.startPrice;
                    const actualDirection = actualEndPrice > pred.startPrice;
                    const isWin = predictedDirection === actualDirection;

                    assertiveness[h.name].wins += isWin ? 1 : 0;
                    assertiveness[h.name].total++;

                    // 2. Atualizar Drift (em log-space)
                    if(pred.predictedEndPrice > 0 && actualEndPrice > 0) {
                        const error = Math.log(actualEndPrice / pred.predictedEndPrice);
                        errorEmas[h.name] = (error * DRIFT_EMA_ALPHA) + (errorEmas[h.name] * (1 - DRIFT_EMA_ALPHA));
                        const driftAdjustment = ADAPTIVE_DRIFT_LEARNING_RATE * errorEmas[h.name];
                        drifts[h.name] = clamp((drifts[h.name] * 0.95) + driftAdjustment, -DRIFT_LIMIT, DRIFT_LIMIT);
                    }
                    return false; // Remover predição
                }
                return true; // Manter predição
            });

            // 3. Atualizar Sigma (Volatilidade)
            const lambda = h.name.endsWith('t') ? 0.90 : 0.94;
            const prevVariance = (sigmas[h.name] ** 2);
            const newVariance = ewmaVarianceUpdate(prevVariance, lastLogReturn, lambda);
            sigmas[h.name] = Math.sqrt(Math.max(1e-9, newVariance));

            // 4. Gerar nova predição
            let simPrice = prices[i];
            const driftTerm = drifts[h.name] - 0.5 * (sigmas[h.name] ** 2);
            for (let j = 0; j < h.ticks; j++) {
                const Z = prng.normal();
                simPrice *= Math.exp(driftTerm + sigmas[h.name] * Z);
            }
            
            pendingPredictions[h.name].push({
                startPrice: prices[i],
                predictedEndPrice: simPrice,
                endIndex: i + h.ticks
            });
        });
    }

    // --- COMPILAR RESULTADOS FINAIS ---
    const metricsByHorizon: Record<string, BacktestHorizonMetrics> = {};
    config.horizons.forEach(h => {
        const stats = assertiveness[h.name];
        metricsByHorizon[h.name] = {
            wins: stats.wins,
            total: stats.total,
            winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
            finalSigma: sigmas[h.name],
            finalDrift: drifts[h.name]
        };
    });

    const finalStability = stabilityResults.map(s => ({
        block: s.block,
        winRate: s.total > 0 ? (s.wins / s.total) * 100 : 0,
    }));

    return {
        config,
        totalSteps: prices.length,
        metricsByHorizon,
        stability: finalStability,
    };
}
      
    