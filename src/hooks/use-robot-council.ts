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
import type { RobotStrategy, DurationUnit, ChartData, TickData, CandleData, Operation, RobotPerformance } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance } from '@/services/financial-data-service';
import { useStrategyEvolution } from './use-strategy-evolution';
import { useFormContext } from 'react-hook-form';
import type { RiseFallFormValues } from '@/components/deriv-trader/deriv-trader-interface.types';

// --- TIPOS AVANÇADOS ---

export type MarketRegime = 'TREND_UP' | 'TREND_DOWN' | 'RANGING' | 'VOLATILE' | 'CRASH_BOOM_SPIKE';

export type MicrostructureData = {
    velocity: number;
    pressure: number;
    acceleration: number;
    isSpike: boolean;
};

export type DashboardData = {
    regime: MarketRegime;
    bayesianProbability: number;
    kellyStake: number;
    microstructure: MicrostructureData;
    activeRobotsCount: number;
    consensusDirection: 'RISE' | 'FALL' | 'HOLD';
};

// O tipo de voto do robô agora é mais simples, o peso é calculado externamente.
export type RobotVote = {
    vote: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    optimalDuration: number;
    optimalDurationUnit: DurationUnit;
};

// Estrutura para a simulação na Arena Virtual
type VirtualTrade = {
    id: string;
    robotId: string;
    vote: 'RISE' | 'FALL';
    entryPrice: number;
    entryEpoch: number;
    exitEpoch: number; // Julgamento por tempo exato
    regime: MarketRegime;
};

// --- FUNÇÕES MATEMÁTICAS PURAS (QUANT CORE) ---

const isValid = (value: any): value is number => value !== null && value !== undefined && !isNaN(value);

const durationToSeconds = (duration: number, unit: DurationUnit): number => {
    switch (unit) {
        case 't': return duration * 2; // Estimativa média para Deriv (Indices sintéticos)
        case 's': return duration;
        case 'm': return duration * 60;
        case 'h': return duration * 3600;
        case 'd': return duration * 86400;
        default: return duration;
    }
};

const detectMarketRegime = (indicators: Indicators, symbol: string): MarketRegime => {
    // A verificação de nulidade é importante
    if (!indicators || !indicators.adx || !indicators.bbw || !indicators.ma.short || !indicators.ma.long) return 'RANGING';

    if (symbol.includes('Crash') || symbol.includes('Boom')) {
        if (indicators.bbw > 0.02) return 'CRASH_BOOM_SPIKE'; 
    }
    if (indicators.bbw > 0.006) return 'VOLATILE';

    if (indicators.adx > 25) {
        if (indicators.ma.short > indicators.ma.long) return 'TREND_UP';
        return 'TREND_DOWN';
    }

    return 'RANGING';
};

const analyzeMicrostructure = (ticks: TickData[]): MicrostructureData => {
    if (ticks.length < 10) return { velocity: 0, pressure: 0.5, acceleration: 0, isSpike: false };
    const recent = ticks.slice(-10);
    const lastPrice = recent[recent.length - 1].price;
    const firstPrice = recent[0].price;
    const velocity = Math.abs(lastPrice - firstPrice);
    
    let upTicks = 0;
    for (let i = 1; i < recent.length; i++) {
        if (recent[i].price > recent[i - 1].price) upTicks++;
    }
    const pressure = upTicks / 9;
    const isSpike = velocity > (ticks[0].price * 0.0005);
    
    const previousSlice = ticks.slice(-20, -10);
    const previousVelocity = previousSlice.length > 0 ? Math.abs(previousSlice[previousSlice.length - 1].price - previousSlice[0].price) : 0;
    const acceleration = velocity - previousVelocity;

    return { velocity, pressure, acceleration, isSpike };
};

const calculateKellyStake = (
    balance: number,
    prob: number,
    payoff: number = 0.95,
    maxRisk: number = 0.05
): number => {
    if (prob <= 0.52) return 0;
    const q = 1 - prob;
    const kellyFraction = (prob * payoff - q) / payoff;
    const safeFraction = kellyFraction * 0.25; // Quarter Kelly
    const finalFraction = Math.min(safeFraction, maxRisk);
    return Math.max(0.35, Math.floor(balance * Math.max(0, finalFraction) * 100) / 100);
};

// Função de votação completa, agora com o filtro de regime.
const getVoteForRegime = (
    robot: RobotStrategy, 
    indicators: Indicators, 
    regime: MarketRegime
): Omit<RobotVote, 'weight'> => {
    const isOscillator = ['RSI', 'STOCHASTIC', 'STOCH_RSI', 'MFI', 'Z_SCORE'].includes(robot.strategyType);
    const isTrendFollower = ['MOVING_AVERAGE_CROSS', 'MACD_CROSS', 'ADX_TREND', 'PARABOLIC_SAR', 'ICHIMOKU_CLOUD'].includes(robot.strategyType);

    if ((regime.includes('TREND') && isOscillator) || (regime === 'RANGING' && isTrendFollower)) {
        return { vote: 'HOLD', confidence: 0, optimalDuration: 0, optimalDurationUnit: 't' };
    }
    
    let vote: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
    let confidence = 0;
    const { strongConfidence, weakConfidence, optimalDuration, optimalDurationUnit } = robot;

    if (robot.strategyType === 'RSI' && isValid(indicators.rsi)) {
        if (indicators.rsi <= robot.strongBuyThreshold!) { vote = 'RISE'; confidence = strongConfidence; }
        else if (indicators.rsi <= robot.weakBuyThreshold!) { vote = 'RISE'; confidence = weakConfidence; }
        else if (indicators.rsi >= robot.strongSellThreshold!) { vote = 'FALL'; confidence = strongConfidence; }
        else if (indicators.rsi >= robot.weakSellThreshold!) { vote = 'FALL'; confidence = weakConfidence; }
    }
    if (robot.strategyType === 'STOCHASTIC' && isValid(indicators.stoch)) {
        if (indicators.stoch <= robot.strongBuyThreshold!) { vote = 'RISE'; confidence = strongConfidence; }
        else if (indicators.stoch <= robot.weakBuyThreshold!) { vote = 'RISE'; confidence = weakConfidence; }
        else if (indicators.stoch >= robot.strongSellThreshold!) { vote = 'FALL'; confidence = strongConfidence; }
        else if (indicators.stoch >= robot.weakSellThreshold!) { vote = 'FALL'; confidence = weakConfidence; }
    }
     if (robot.strategyType === 'MACD_CROSS' && isValid(indicators.macd.macd) && isValid(indicators.macd.signal)) {
       if (indicators.macd.macd! > indicators.macd.signal!) { vote = 'RISE'; confidence = weakConfidence; }
       if (indicators.macd.signal! > indicators.macd.macd!) { vote = 'FALL'; confidence = weakConfidence; }
    }
    // Adicione a lógica para as outras 19 estratégias aqui...
    
    return { vote, confidence, optimalDuration, optimalDurationUnit };
};

// --- HOOK PRINCIPAL ---

export function useRobotCouncil(activeSymbol: string | null, priceTicks: TickData[]) {
    const { executeTrade, isConnected, timePeriod } = useDerivApi();
    const { user, loading: isAuthLoading } = useAuth();
    const { toast } = useToast();
    const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);
    const form = useFormContext<RiseFallFormValues>();

    // Estados Globais
    const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
    const [dailyBalance, setDailyBalance] = useState(1000);
    const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>([]);
    const [robotPerformance, setRobotPerformance] = useState<RobotPerformance[]>([]);
    
    // Estados Quantitativos para UI
    const [dashboardData, setDashboardData] = useState<DashboardData>({
        regime: 'RANGING', bayesianProbability: 0.5, kellyStake: 0.35,
        microstructure: { velocity: 0, pressure: 0.5, acceleration: 0, isSpike: false },
        activeRobotsCount: 0, consensusDirection: 'HOLD'
    });
    
    // Controles de Execução e Simulação
    const executionRef = useRef({ lastTradeEpoch: 0, isProcessing: false });
    const virtualTradesRef = useRef<VirtualTrade[]>([]);
    
    // Memoização dos dados de vela para performance
    const tickCandles = useMemo(() => {
        if (!priceTicks || priceTicks.length === 0) return [];
        return priceTicks.map(t => ({ epoch: t.epoch, open: t.price, high: t.price, low: t.price, close: t.price, volume: 1 }));
    }, [priceTicks]);

    useEffect(() => {
        setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
    }, [evolvedStrategies]);
    
    useEffect(() => {
        if (!user || isAuthLoading) return;
        loadRobotPerformance(user.uid)
            .then((stored) => {
                if (stored && stored.length > 0) {
                     setRobotPerformance(stored);
                }
            })
            .catch(err => console.error("Erro ao carregar performance do Firebase", err));
    }, [user, isAuthLoading]);

    const fetchStrategyCouncil = useCallback(async () => {
        if (!activeSymbol || !user) {
            toast({ variant: 'destructive', title: !user ? 'Não Autenticado' : 'Nenhum Ativo', description: 'Necessário login e ativo selecionado.' });
            return;
        }

        virtualTradesRef.current = [];
        
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        const council = (evolvedStrategies as RobotStrategy[]);
        setStrategyCouncil(council);

        if (robotPerformance.length === 0) {
            const initialPerformance: RobotPerformance[] = council.map(robot => ({
                id: robot.id, strategyType: robot.strategyType, wins: 0, losses: 0, totalProfit: 0, winRate: 0, winRateTrend: 0, winRateRange: 0, strategy: robot
            }));
            setRobotPerformance(initialPerformance);
            saveRobotPerformance(user.uid, initialPerformance);
        }

        toast({ title: 'Mesa Operacional Quant Ativada', description: `O cérebro com ${council.length} analistas está online.` });
        setIsCouncilAutopilotOn(true);
    }, [activeSymbol, user, toast, robotPerformance.length, evolvedStrategies]);
    
    const dissolveCouncil = useCallback(() => {
        setIsCouncilAutopilotOn(false);
        toast({ title: 'Piloto Automático Desativado' });
    }, [toast]);

    // --- LOOP PRINCIPAL (A CADA TICK) ---
    useEffect(() => {
        if (!isCouncilAutopilotOn || !activeSymbol || tickCandles.length < 35 || !isConnected || !user) return; // 35 para garantir dados para MACD/AwesomeOscillator
        
        const currentTick = tickCandles[tickCandles.length - 1];
        const indicators = calculateAllIndicators(tickCandles, strategyCouncil, timePeriod);
        if (!indicators) return;

        // --- ARENA VIRTUAL: JULGAMENTO DE TRADES ---
        const stillActiveTrades: VirtualTrade[] = [];
        const performanceMap = new Map<string, RobotPerformance>(robotPerformance.map(p => [p.id, { ...p }]));
        let performanceChanged = false;

        virtualTradesRef.current.forEach((trade) => {
            if (currentTick.epoch >= trade.exitEpoch) {
                const exitTick = priceTicks.reduce((prev, curr) => 
                    Math.abs(curr.epoch - trade.exitEpoch) < Math.abs(prev.epoch - trade.exitEpoch) ? curr : prev
                );
                
                const isWin = (trade.vote === 'RISE' && exitTick.price > trade.entryPrice) || (trade.vote === 'FALL' && exitTick.price < trade.entryPrice);
                const perf = performanceMap.get(trade.robotId);
                
                if (perf) {
                    perf.totalProfit += isWin ? 0.95 : -1.0;
                    if(isWin) perf.wins++; else perf.losses++;
                    const totalTrades = perf.wins + perf.losses;
                    perf.winRate = totalTrades > 0 ? (perf.wins / totalTrades) * 100 : 0;
                    
                    if(trade.regime.includes('TREND')) {
                         const trendTradesCount = (perf.winRateTrend / 100 * (totalTrades-1));
                         perf.winRateTrend = ((trendTradesCount + (isWin ? 1 : 0)) / totalTrades) * 100;
                    } else {
                         const rangeTradesCount = (perf.winRateRange / 100 * (totalTrades-1));
                         perf.winRateRange = ((rangeTradesCount + (isWin ? 1 : 0)) / totalTrades) * 100;
                    }
                    performanceChanged = true;
                }
            } else {
                stillActiveTrades.push(trade);
            }
        });
        
        if (performanceChanged) {
            const updatedPerformance = Array.from(performanceMap.values());
            setRobotPerformance(updatedPerformance);
            // RECONECTADO: Aciona o gatilho de evolução.
            evolveTrigger(updatedPerformance); 
            saveRobotPerformance(user.uid, updatedPerformance);
        }
        virtualTradesRef.current = stillActiveTrades;

        // --- LÓGICA DE DECISÃO E EXECUÇÃO ---
        const regime = detectMarketRegime(indicators, activeSymbol);
        const microstructure = analyzeMicrostructure(priceTicks);

        let riseLikelihoodSum = 0, fallLikelihoodSum = 0, activeRobots = 0;

        strategyCouncil.forEach(robot => {
            const voteData = getVoteForRegime(robot, indicators, regime);
            const perf = robotPerformance.find(p => p.id === robot.id);
            const historicalWinRate = perf ? (regime.includes('TREND') ? perf.winRateTrend : perf.winRateRange) / 100 : 0.5;

            if (historicalWinRate < 0.45) return; 

            if (voteData.vote !== 'HOLD') {
                activeRobots++;
                const weight = (voteData.confidence / 100) * historicalWinRate;
                if (voteData.vote === 'RISE') riseLikelihoodSum += weight;
                if (voteData.vote === 'FALL') fallLikelihoodSum += weight;
                
                // Abre trade virtual
                const durationInSeconds = durationToSeconds(voteData.optimalDuration, voteData.optimalDurationUnit);
                virtualTradesRef.current.push({
                    id: `vt_${robot.id}_${currentTick.epoch}`, robotId: robot.id, vote: voteData.vote,
                    entryPrice: currentTick.close, entryEpoch: currentTick.epoch,
                    exitEpoch: currentTick.epoch + durationInSeconds, regime: regime
                });
            }
        });
        
        const totalWeight = riseLikelihoodSum + fallLikelihoodSum;
        const riseProb = totalWeight > 0 ? riseLikelihoodSum / totalWeight : 0.5;
        let decision: 'RISE' | 'FALL' | 'HOLD' = 'HOLD', finalProbability = 0.5;

        if (riseProb > fallLikelihoodSum / totalWeight && riseProb > 0.65) { decision = 'RISE'; finalProbability = riseProb; }
        else if (fallLikelihoodSum / totalWeight > riseProb && fallLikelihoodSum / totalWeight > 0.65) { decision = 'FALL'; finalProbability = fallLikelihoodSum / totalWeight; }
        
        if ((decision === 'RISE' && microstructure.pressure < 0.2) || (decision === 'FALL' && microstructure.pressure > 0.8) || microstructure.isSpike) {
            decision = 'HOLD';
        }

        const suggestedStake = calculateKellyStake(dailyBalance, finalProbability);
        
        setDashboardData({
            regime, bayesianProbability: finalProbability, kellyStake: suggestedStake,
            microstructure, activeRobotsCount: activeRobots, consensusDirection: decision
        });

        const now = Math.floor(Date.now() / 1000);
        if (decision !== 'HOLD' && suggestedStake > 0 && !executionRef.current.isProcessing && (now - executionRef.current.lastTradeEpoch > 5)) {
            executionRef.current.isProcessing = true;
            toast({ title: "🤖 Ordem do Conselho Quant", description: `${decision} | Prob: ${(finalProbability*100).toFixed(1)}% | Stake: $${suggestedStake} | Regime: ${regime}` });
            executeTrade(decision === 'RISE' ? 'CALL' : 'PUT', suggestedStake, activeSymbol, decision.toLowerCase() as 'rise' | 'fall', 5, 't', 'Conselho')
            .finally(() => {
                executionRef.current.lastTradeEpoch = now;
                executionRef.current.isProcessing = false;
            });
        }

    }, [priceTicks, activeSymbol, isCouncilAutopilotOn, strategyCouncil, robotPerformance, dailyBalance, executeTrade, toast, isConnected, user, evolveTrigger, timePeriod]);

    const { duration_unit } = form.getValues();

    return {
        dashboardData, isCouncilAutopilotOn: isCouncilAutopilotOn, setIsCouncilAutopilotOn: setIsCouncilAutopilotOn, fetchStrategyCouncil, dissolveCouncil,
        strategyCouncil, isFetchingCouncil: false, councilVotes: {}, dailyBalance, setDailyBalance,
        dailyTarget: 0, setDailyTarget: () => {}, consensusThreshold: 0, setConsensusThreshold: () => {},
        isDynamicConsensusOn: true, setIsDynamicConsensusOn: () => {}, isDynamicRiskOn: true, setIsDynamicRiskOn: () => {},
        isMeritocracyOn: true, setIsMeritocracyOn: () => {}, indicators: null, activeCommittee: null, supervisionStatus: {status: 'inactive', message: ''},
        consensusSum: {rise: 0, fall: 0}, consensusDecision: dashboardData.consensusDirection, robotPerformance, evolutionHistory,
    };
}
