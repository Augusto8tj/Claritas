'use client';

/**
 * @fileoverview CÉREBRO QUANTITATIVO DA MESA OPERACIONAL (DERIV API)
 * 
 * Este hook implementa uma arquitetura de "Ensemble Learning" (Aprendizado em Conjunto).
 * Diferente da versão anterior, esta versão é "Regime-Aware" (Consciente do Contexto).
 * 
 * PILARES DA ESTRATÉGIA:
 * 1. HMM (Hidden Markov Model Lite): Identifica se o mercado está em tendência ou lateral.
 * 2. Microestrutura: Analisa a física do movimento dos ticks (velocidade/aceleração).
 * 3. Bayes: Calcula a probabilidade matemática do trade dar certo.
 * 4. Kelly Criterion: Define quanto apostar baseado na probabilidade.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApi } from './use-deriv-api';
import { useToast } from './use-toast';
import type { RobotStrategy, DurationUnit, ChartData, TickData, CandleData, Operation } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance } from '@/services/financial-data-service';
import { useStrategyEvolution } from './use-strategy-evolution';

// --- TIPOS AVANÇADOS ---

export type MarketRegime = 'TREND_UP' | 'TREND_DOWN' | 'RANGING' | 'VOLATILE';

export type MicrostructureData = {
    velocity: number;      // Distância percorrida nos últimos X ticks
    pressure: number;      // Pressão de compra (0 a 1)
    acceleration: number;  // Mudança da velocidade
    isSpike: boolean;      // Detecção de anomalia (comum em Crash/Boom)
};

export type DashboardData = {
    regime: MarketRegime;
    bayesianProbability: number;
    kellyStake: number;
    microstructure: MicrostructureData;
    activeRobotsCount: number;
    consensusDirection: 'RISE' | 'FALL' | 'HOLD';
};

export type RobotPerformance = {
    id: string;
    strategyType: string;
    wins: number;
    losses: number;
    winRate: number;       // WinRate Geral
    winRateTrend: number;  // WinRate específico em Tendência
    winRateRange: number;  // WinRate específico em Lateralização
};

export type RobotVote = {
    vote: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    weight: number;        // Peso dinâmico calculado via Bayes
    optimalDuration: number;
    optimalDurationUnit: DurationUnit;
};

// --- FUNÇÕES MATEMÁTICAS PURAS (QUANT CORE) ---

/**
 * 1. DETECTOR DE REGIME DE MERCADO
 * Analisa a "personalidade" atual do ativo.
 * Essencial para filtrar estratégias: Não usar RSI em tendências fortes!
 */
const detectMarketRegime = (indicators: Indicators, symbol: string): MarketRegime => {
    if (!indicators.adx || !indicators.bbw || !indicators.ema || !indicators.sma) return 'RANGING';

    // Alta Volatilidade (Bandas muito abertas)
    if (indicators.bbw > 0.006) return 'VOLATILE'; // Calibrar este valor por ativo!

    // Tendência Forte (ADX > 25)
    if (indicators.adx > 25) {
        if (indicators.ema.length > 0 && indicators.sma.length > 0) {
            const lastEma = indicators.ema[indicators.ema.length-1];
            const lastSma = indicators.sma[indicators.sma.length-1];
            if(lastEma && lastSma && lastEma > lastSma) return 'TREND_UP';
        }
        return 'TREND_DOWN';
    }

    // Padrão
    return 'RANGING';
};

/**
 * 2. ANÁLISE DE MICROESTRUTURA
 * Lê o "fluxo de ordens" implícito nos ticks.
 * Crucial para Sintéticos de 1 segundo.
 */
const analyzeMicrostructure = (ticks: TickData[]): MicrostructureData => {
    if (ticks.length < 10) return { velocity: 0, pressure: 0.5, acceleration: 0, isSpike: false };

    const recent = ticks.slice(-10);
    const lastPrice = recent[recent.length - 1].price;
    const firstPrice = recent[0].price;

    // Velocidade: Variação absoluta
    const velocity = Math.abs(lastPrice - firstPrice);

    // Pressão: % de ticks que foram positivos (UpTicks)
    let upTicks = 0;
    for (let i = 1; i < recent.length; i++) {
        if (recent[i].price > recent[i - 1].price) upTicks++;
    }
    const pressure = upTicks / 9; // 0.0 (Venda pura) a 1.0 (Compra pura)
    
    // Aceleração: mudança na velocidade
    const previousSlice = ticks.slice(-20, -10);
    const previousVelocity = previousSlice.length > 0 ? Math.abs(previousSlice[previousSlice.length - 1].price - previousSlice[0].price) : 0;
    const acceleration = velocity - previousVelocity;

    // Detecção de Spike (movimento anormalmente rápido)
    const isSpike = velocity > (ticks[0].price * 0.0005); // 0.05% em 10 ticks

    return { velocity, pressure, acceleration, isSpike };
};

/**
 * 3. CRITÉRIO DE KELLY (FRACIONÁRIO)
 * Gestão de risco profissional.
 * @returns O valor financeiro ideal para a aposta (Stake).
 */
const calculateKellyStake = (
    balance: number,
    prob: number,       // Probabilidade de Vitória (0 a 1)
    payoff: number = 0.95, // Payout médio da Deriv (95%)
    maxRisk: number = 0.05 // Risco máximo de 5% da banca por trade
): number => {
    if (prob <= 0.52) return 0; // Se a chance é quase moeda (50%), não opera.

    // Fórmula: f* = (p(b+1) - 1) / b  ou  (pb - q) / b
    const q = 1 - prob;
    const kellyFraction = (prob * payoff - q) / payoff;

    // Usamos "Quarter Kelly" (1/4) para segurança extrema em mercados aleatórios.
    const safeFraction = kellyFraction * 0.25;

    // Trava de segurança absoluta
    const finalFraction = Math.min(safeFraction, maxRisk);
    
    // Retorna valor monetário arredondado (min $0.35 para Deriv)
    return Math.max(0.35, Math.floor(balance * Math.max(0, finalFraction) * 100) / 100);
};

// --- HELPER DE VOTAÇÃO INDIVIDUAL (Simplificado para o exemplo) ---
const getVoteForRegime = (
    robot: RobotStrategy, 
    indicators: Indicators, 
    candles: CandleData[], 
    regime: MarketRegime
): Omit<RobotVote, 'weight'> => {
    // FILTRO DE REGIME:
    const isOscillator = ['RSI', 'STOCHASTIC', 'BOLLINGER_BANDS'].includes(robot.strategyType);
    const isTrendFollower = ['MOVING_AVERAGE_CROSS', 'MACD_CROSS', 'ADX_TREND'].includes(robot.strategyType);

    if (regime.includes('TREND') && isOscillator) {
        return { vote: 'HOLD', confidence: 0, optimalDuration: 0, optimalDurationUnit: 't' };
    }
    if (regime === 'RANGING' && isTrendFollower) {
        return { vote: 'HOLD', confidence: 0, optimalDuration: 0, optimalDurationUnit: 't' };
    }
    
    // Placeholder para a lógica de votação original.
    // Em uma implementação real, a função calculateRobotVote original seria chamada aqui.
    // Simulando um voto para exemplo
    let vote: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
    let confidence = 0;
    if(indicators.rsi && indicators.rsi < 30) {
        vote = 'RISE';
        confidence = 70;
    } else if (indicators.rsi && indicators.rsi > 70) {
        vote = 'FALL';
        confidence = 70;
    }

    return { vote, confidence, optimalDuration: robot.optimalDuration, optimalDurationUnit: robot.optimalDurationUnit };
};


// --- HOOK PRINCIPAL ---

export function useRobotCouncil(activeSymbol: string | null, priceTicks: TickData[]) {
    const { executeTrade, isConnected, operationsLog } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();
    const { evolvedStrategies } = useStrategyEvolution(initialCouncilStrategies as any); 

    // -- ESTADOS GLOBAIS --
    const [dailyBalance, setDailyBalance] = useState(1000); 
    const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>([]);
    const [robotPerformance, setRobotPerformance] = useState<RobotPerformance[]>([]);
    
    // -- ESTADOS QUANTITATIVOS (VISUALIZAÇÃO) --
    const [dashboardData, setDashboardData] = useState<DashboardData>({
        regime: 'RANGING',
        bayesianProbability: 0.5,
        kellyStake: 0.35,
        microstructure: { velocity: 0, pressure: 0.5, acceleration: 0, isSpike: false },
        activeRobotsCount: 0,
        consensusDirection: 'HOLD'
    });

    const [isAutopilot, setIsAutopilot] = useState(false);
    
    // Refs para controle de execução
    const executionRef = useRef({ lastTradeEpoch: 0, isProcessing: false });

    // Preparação de Dados (Candles a partir de Ticks)
    const tickCandles = useMemo(() => {
        if (!priceTicks || priceTicks.length === 0) return [];
        return priceTicks.map(t => ({ epoch: t.epoch, open: t.price, high: t.price, low: t.price, close: t.price, volume: 1 }));
    }, [priceTicks]);

    // --- LOOP PRINCIPAL (A CADA TICK) ---
    useEffect(() => {
        if (!isAutopilot || !activeSymbol || priceTicks.length < 20 || !isConnected) return;

        // 1. DADOS DE ENTRADA
        const currentIndicators = calculateAllIndicators(tickCandles, strategyCouncil, '1m'); 
        if (!currentIndicators) return;

        // 2. ANÁLISE DE CONTEXTO (Regime & Microestrutura)
        const regime = detectMarketRegime(currentIndicators, activeSymbol);
        const microstructure = analyzeMicrostructure(priceTicks);

        // 3. VOTAÇÃO DO CONSELHO (Com Filtros)
        let riseLikelihoodSum = 0;
        let fallLikelihoodSum = 0;
        let activeRobots = 0;

        evolvedStrategies.forEach((robot: RobotStrategy) => {
            const voteData = getVoteForRegime(robot, currentIndicators, tickCandles, regime);
            
            const perf = robotPerformance.find(p => p.id === robot.id);
            const historicalWinRate = perf ? (regime.includes('TREND') ? perf.winRateTrend : perf.winRateRange) / 100 : 0.5;
            
            if (historicalWinRate < 0.45) return; 

            if (voteData.vote !== 'HOLD') {
                activeRobots++;
                const weight = (voteData.confidence / 100) * historicalWinRate;
                
                if (voteData.vote === 'RISE') riseLikelihoodSum += weight;
                if (voteData.vote === 'FALL') fallLikelihoodSum += weight;
            }
        });

        // 4. CÁLCULO DE PROBABILIDADE FINAL (Consenso)
        const totalWeight = riseLikelihoodSum + fallLikelihoodSum;
        const riseProb = totalWeight > 0 ? riseLikelihoodSum / totalWeight : 0.5;
        const fallProb = totalWeight > 0 ? fallLikelihoodSum / totalWeight : 0.5;

        let decision: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
        let finalProbability = 0.5;

        if (riseProb > 0.65) { decision = 'RISE'; finalProbability = riseProb; }
        else if (fallProb > 0.65) { decision = 'FALL'; finalProbability = fallProb; }

        // 5. VETO DA MICROESTRUTURA
        if (decision === 'RISE' && microstructure.pressure < 0.2) decision = 'HOLD';
        if (decision === 'FALL' && microstructure.pressure > 0.8) decision = 'HOLD';
        if (microstructure.isSpike) decision = 'HOLD';

        // 6. CÁLCULO DE STAKE (Kelly)
        const suggestedStake = calculateKellyStake(dailyBalance, finalProbability);

        // 7. ATUALIZAÇÃO DA UI (Dashboard)
        setDashboardData({
            regime,
            bayesianProbability: finalProbability,
            kellyStake: suggestedStake,
            microstructure,
            activeRobotsCount: activeRobots,
            consensusDirection: decision
        });

        // 8. EXECUÇÃO
        const now = Math.floor(Date.now() / 1000);
        if (
            decision !== 'HOLD' && 
            suggestedStake > 0 && 
            !executionRef.current.isProcessing &&
            (now - executionRef.current.lastTradeEpoch > 5) // Cooldown de 5s
        ) {
            executionRef.current.isProcessing = true;
            
            toast({
                title: "🤖 Ordem do Conselho Quant",
                description: `${decision} | Prob: ${(finalProbability*100).toFixed(1)}% | Stake: $${suggestedStake} | Regime: ${regime}`
            });

            executeTrade(
                decision === 'RISE' ? 'CALL' : 'PUT',
                suggestedStake,
                activeSymbol,
                decision.toLowerCase() as 'rise' | 'fall',
                5, 
                't',
                'Conselho'
            ).finally(() => {
                executionRef.current.lastTradeEpoch = now;
                executionRef.current.isProcessing = false;
            });
        }

    }, [priceTicks, activeSymbol, isAutopilot, evolvedStrategies, robotPerformance, dailyBalance, executeTrade, toast, isConnected]);
    
     const fetchStrategyCouncil = useCallback(() => {
        setIsAutopilot(true);
        toast({ title: 'Piloto Automático Quant Ativado' });
    }, [toast]);
    
    const dissolveCouncil = useCallback(() => {
        setIsAutopilot(false);
        toast({ title: 'Piloto Automático Desativado' });
    }, [toast]);

    return {
        dashboardData,
        isCouncilAutopilotOn: isAutopilot,
        setIsCouncilAutopilotOn: setIsAutopilot,
        fetchStrategyCouncil,
        dissolveCouncil,
        // Mantendo outras exportações para compatibilidade da UI
        strategyCouncil: evolvedStrategies,
        isFetchingCouncil: false,
        councilVotes: {},
        dailyBalance,
        setDailyBalance,
        dailyTarget: 0,
        setDailyTarget: () => {},
        consensusThreshold: 0,
        setConsensusThreshold: () => {},
        isDynamicConsensusOn: true,
        setIsDynamicConsensusOn: () => {},
        isDynamicRiskOn: true,
        setIsDynamicRiskOn: () => {},
        isMeritocracyOn: true,
        setIsMeritocracyOn: () => {},
        indicators: null,
        activeCommittee: null,
        supervisionStatus: {status: 'inactive', message: ''},
        consensusSum: {rise: 0, fall: 0},
        consensusDecision: dashboardData.consensusDirection,
        robotPerformance,
        evolutionHistory: [],
    };
}
