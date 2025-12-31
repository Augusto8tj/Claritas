'use client';

/**
 * @fileoverview CÉREBRO QUANTITATIVO DA MESA OPERACIONAL (DERIV API)
 * 
 * Este hook implementa uma arquitetura de "Ensemble Learning" (Aprendizado em Conjunto)
 * e é "Regime-Aware" (Consciente do Contexto de Mercado).
 * 
 * PILARES DA ESTRATÉGIA:
 * 1. HMM (Hidden Markov Model Lite): Identifica se o mercado está em TENDÊNCIA, LATERAL, etc.
 * 2. Filtro de Estratégia: Ativa/desativa robôs com base no regime de mercado.
 * 3. Análise de Microestrutura: Analisa a "física" do movimento dos ticks (velocidade, pressão).
 * 4. Consenso Bayesiano: Pondera votos pelo histórico de acerto de cada robô no regime atual.
 * 5. Critério de Kelly: Define o tamanho da aposta (stake) com base na probabilidade de sucesso.
 * 6. Evolução Genética: Melhora o conselho ao longo do tempo, substituindo robôs fracos.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApi } from './use-deriv-api';
import { useToast } from './use-toast';
import type { RobotStrategy, DurationUnit, ChartData, TickData, CandleData, Operation, RobotPerformance as RobotPerformanceType, RobotVote as RobotVoteType } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance } from '@/services/financial-data-service';
import { useStrategyEvolution } from './use-strategy-evolution';
import { initialCouncilStrategies } from '@/services/council-strategies';


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

export type RobotPerformance = RobotPerformanceType;
export type RobotVote = RobotVoteType;
export type CouncilVotes = { [key: string]: RobotVote };

type VirtualTrade = {
    id: string;
    robotId: string;
    vote: 'RISE' | 'FALL';
    entryPrice: number;
    entryEpoch: number;
    exitEpoch: number;
    regime: MarketRegime;
};

// --- CONSTANTES DE CONFIGURAÇÃO ---
const CALIBRATION_TICKS = 200; // Ticks necessários antes de operar de verdade
const isValid = (value: any): value is number => value !== null && value !== undefined && !isNaN(value);

const durationToSeconds = (duration: number, unit: DurationUnit): number => {
    switch (unit) {
        case 't': return duration * 2; // Aproximação para vol-indices
        case 's': return duration;
        case 'm': return duration * 60;
        case 'h': return duration * 3600;
        case 'd': return duration * 86400;
        default: return duration;
    }
};

// --- FUNÇÕES MATEMÁTICAS PURAS (QUANT CORE) ---

const detectMarketRegime = (indicators: Indicators, symbol: string): MarketRegime => {
    if (!indicators.adx || !indicators.bbw || !indicators.ma.short || !indicators.ma.long) return 'RANGING';
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

const calculateKellyStake = (balance: number, prob: number, payoff: number = 0.95, maxRisk: number = 0.05): number => {
    if (prob <= 0.52) return 0;
    const q = 1 - prob;
    const kellyFraction = (prob * payoff - q) / payoff;
    const safeFraction = kellyFraction * 0.25; // Quarter Kelly
    const finalFraction = Math.min(safeFraction, maxRisk);
    return Math.max(0.35, Math.floor(balance * Math.max(0, finalFraction) * 100) / 100);
};

const calculateRobotVote = (robot: RobotStrategy, indicators: Indicators, tickCandles: CandleData[]): Omit<RobotVote, 'weight'> => {
    let vote: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
    let confidence = 0;
    const { strongConfidence, weakConfidence, optimalDuration, optimalDurationUnit, suggestedStake } = robot;

    if (!indicators) return { vote, confidence: 0, optimalDuration, optimalDurationUnit, suggestedStake };

    if (robot.strategyType === 'RSI' && isValid(indicators.rsi)) {
        if (indicators.rsi <= robot.strongBuyThreshold!) { vote = 'RISE'; confidence = strongConfidence; }
        else if (indicators.rsi <= robot.weakBuyThreshold!) { vote = 'RISE'; confidence = weakConfidence; }
        else if (indicators.rsi >= robot.strongSellThreshold!) { vote = 'FALL'; confidence = strongConfidence; }
        else if (indicators.rsi >= robot.weakSellThreshold!) { vote = 'FALL'; confidence = weakConfidence; }
    } else if (robot.strategyType === 'STOCHASTIC' && isValid(indicators.stoch)) {
        if (indicators.stoch <= robot.strongBuyThreshold!) { vote = 'RISE'; confidence = strongConfidence; }
        else if (indicators.stoch <= robot.weakBuyThreshold!) { vote = 'RISE'; confidence = weakConfidence; }
        else if (indicators.stoch >= robot.strongSellThreshold!) { vote = 'FALL'; confidence = strongConfidence; }
        else if (indicators.stoch >= robot.weakSellThreshold!) { vote = 'FALL'; confidence = weakConfidence; }
    } else if (robot.strategyType === 'MACD_CROSS' && isValid(indicators.macd.macd) && isValid(indicators.macd.signal)) {
        if (indicators.macd.macd! > indicators.macd.signal!) { vote = 'RISE'; confidence = weakConfidence; }
        if (indicators.macd.signal! > indicators.macd.macd!) { vote = 'FALL'; confidence = weakConfidence; }
    } else if (robot.strategyType === 'BOLLINGER_BANDS' && isValid(indicators.bb.lower) && indicators.bb.upper && tickCandles.length > 0) {
        const lastPrice = tickCandles[tickCandles.length-1].close;
        if(isValid(lastPrice)) {
            if(lastPrice <= indicators.bb.lower) { vote = 'RISE'; confidence = weakConfidence; }
            if(lastPrice >= indicators.bb.upper) { vote = 'FALL'; confidence = weakConfidence; }
        }
    } else if (robot.strategyType === 'MOVING_AVERAGE_CROSS' && isValid(indicators.ma.short) && isValid(indicators.ma.long)) {
        if (indicators.ma.short > indicators.ma.long) { vote = 'RISE'; confidence = weakConfidence; }
        if (indicators.ma.long > indicators.ma.short) { vote = 'FALL'; confidence = weakConfidence; }
    }
    // ... Lógica para as outras 18 estratégias

    return { vote, confidence, optimalDuration, optimalDurationUnit, suggestedStake };
};

const getVoteForRegime = (robot: RobotStrategy, indicators: Indicators, regime: MarketRegime, tickCandles: CandleData[]): Omit<RobotVote, 'weight'> => {
    const isOscillator = ['RSI', 'STOCHASTIC', 'STOCH_RSI', 'MFI', 'Z_SCORE', 'BOLLINGER_BANDS'].includes(robot.strategyType);
    const isTrendFollower = ['MOVING_AVERAGE_CROSS', 'MACD_CROSS', 'ADX_TREND', 'PARABOLIC_SAR', 'ICHIMOKU_CLOUD', 'KAMA'].includes(robot.strategyType);
    
    if ((regime.includes('TREND') && isOscillator) || (regime === 'RANGING' && isTrendFollower)) {
        return { vote: 'HOLD', confidence: 0, optimalDuration: robot.optimalDuration, optimalDurationUnit: robot.optimalDurationUnit, suggestedStake: robot.suggestedStake };
    }

    return calculateRobotVote(robot, indicators, tickCandles);
};

// --- HOOK PRINCIPAL ---
export function useRobotCouncil(activeSymbol: string | null, priceTicks: TickData[]) {
    const { executeTrade, isConnected, timePeriod } = useDerivApi();
    const { user, loading: isAuthLoading } = useAuth();
    const { toast } = useToast();
    const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);
    
    const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
    const [dailyBalance, setDailyBalance] = useState(1000);
    const [dailyTarget, setDailyTarget] = useState(50);
    const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>([]);
    const [robotPerformance, setRobotPerformance] = useState<RobotPerformance[]>([]);
    const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
    const [isCalibrated, setIsCalibrated] = useState(false);
    const [isMeritocracyOn, setIsMeritocracyOn] = useState(true);
    const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true);
    const [isDynamicConsensusOn, setIsDynamicConsensusOn] = useState(true);
    const [consensusThreshold, setConsensusThreshold] = useState(300);
    const [baseStake, setBaseStake] = useState(1);
    const [baseDuration, setBaseDuration] = useState(5);
    const [councilVotes, setCouncilVotes] = useState<CouncilVotes>({});
    const [consensusSum, setConsensusSum] = useState({ rise: 0, fall: 0 });
    const [consensusDecision, setConsensusDecision] = useState<'RISE' | 'FALL' | 'HOLD'>('HOLD');
    const [activeCommittee, setActiveCommittee] = useState<string | null>(null);
    const [supervisionStatus, setSupervisionStatus] = useState({ status: 'inactive' as 'inactive' | 'approved' | 'veto', message: 'Aguardando consenso.', analysis: '' });
    const [indicators, setIndicators] = useState<Indicators | null>(null);

    const [dashboardData, setDashboardData] = useState<DashboardData>({
        regime: 'RANGING', bayesianProbability: 0.5, kellyStake: 0.35,
        microstructure: { velocity: 0, pressure: 0.5, acceleration: 0, isSpike: false },
        activeRobotsCount: 0, consensusDirection: 'HOLD'
    });
    
    const executionRef = useRef({ lastTradeEpoch: 0, isProcessing: false });
    const virtualTradesRef = useRef<VirtualTrade[]>([]);
    
    const tickCandles = useMemo(() => {
        if (!priceTicks || priceTicks.length === 0) return [];
        return priceTicks.map(t => ({ epoch: t.epoch, open: t.price, high: t.price, low: t.price, close: t.price, volume: 1 }));
    }, [priceTicks]);

    useEffect(() => {
        const councilWithIds = evolvedStrategies.map((strat, index) => ({
            ...strat,
            id: `${strat.strategyType}_BOT_${index + 1}`,
            justification: `Especialista em ${strat.strategyType} para ${timePeriod}.`
        })) as RobotStrategy[];
        setStrategyCouncil(councilWithIds);
    }, [evolvedStrategies, timePeriod]);
    
    useEffect(() => {
        if (!user || isAuthLoading) return;
        loadRobotPerformance(user.uid).then((stored) => {
            if (stored && stored.length > 0) setRobotPerformance(stored);
        }).catch(err => console.error("Erro ao carregar performance do Firebase", err));
    }, [user, isAuthLoading]);

    const fetchStrategyCouncil = useCallback(async () => {
        if (!activeSymbol || !user) {
            toast({ variant: 'destructive', title: !user ? 'Não Autenticado' : 'Nenhum Ativo', description: 'Necessário login e ativo selecionado.' });
            return;
        }
        setIsFetchingCouncil(true);
        virtualTradesRef.current = [];
        setIsCalibrated(false);
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        const council = evolvedStrategies.map((strat, index) => ({
            ...strat,
            id: `${strat.strategyType}_BOT_${index + 1}`,
            justification: `Especialista em ${strat.strategyType} para o horizonte de tempo ${timePeriod}.`
        })) as RobotStrategy[];

        setStrategyCouncil(council);

        if (robotPerformance.length === 0) {
            const initialPerformance: RobotPerformance[] = council.map(robot => ({
                id: robot.id, strategyType: robot.strategyType, wins: 0, losses: 0, totalProfit: 0, winRate: 0, winRateTrend: 0, winRateRange: 0, strategy: robot
            }));
            setRobotPerformance(initialPerformance);
            await saveRobotPerformance(user.uid, initialPerformance);
        }

        toast({ title: 'Mesa Operacional Quant Ativada', description: `Cérebro com ${council.length} analistas online. Período de calibração iniciado.` });
        setIsCouncilAutopilotOn(true);
        setIsFetchingCouncil(false);
    }, [activeSymbol, user, toast, robotPerformance.length, evolvedStrategies, timePeriod]);
    
    const dissolveCouncil = useCallback(() => {
        setIsCouncilAutopilotOn(false);
        setIsCalibrated(false);
        toast({ title: 'Piloto Automático Desativado' });
    }, [toast]);

    useEffect(() => {
        if (!isCouncilAutopilotOn || !activeSymbol || tickCandles.length < 35 || !isConnected || !user) return;
        
        if (!isCalibrated && tickCandles.length >= CALIBRATION_TICKS) {
            setIsCalibrated(true);
            toast({ title: "Sistema Calibrado", description: "A execução de trades reais está agora habilitada." });
        }

        const currentTick = tickCandles[tickCandles.length - 1];
        const indicators = calculateAllIndicators(tickCandles, strategyCouncil, timePeriod);
        if (!indicators) return;
        setIndicators(indicators);

        const performanceMap = new Map<string, RobotPerformance>(robotPerformance.map(p => [p.id, { ...p }]));
        let performanceChanged = false;

        const stillActiveTrades = virtualTradesRef.current.filter((trade) => {
            if (currentTick.epoch >= trade.exitEpoch) {
                const exitTick = priceTicks.reduce((prev, curr) => Math.abs(curr.epoch - trade.exitEpoch) < Math.abs(prev.epoch - trade.exitEpoch) ? curr : prev);
                const isWin = (trade.vote === 'RISE' && exitTick.price > trade.entryPrice) || (trade.vote === 'FALL' && exitTick.price < trade.entryPrice);
                const perf = performanceMap.get(trade.robotId);
                
                if (perf) {
                    performanceChanged = true;
                    perf.totalProfit = (perf.totalProfit || 0) + (isWin ? 0.95 : -1.0);
                    if(isWin) perf.wins = (perf.wins || 0) + 1; else perf.losses = (perf.losses || 0) + 1;
                    const totalTrades = perf.wins + perf.losses;
                    perf.winRate = totalTrades > 0 ? (perf.wins / totalTrades) * 100 : 0;
                    
                    if(trade.regime.includes('TREND')) {
                         const trendTradesCount = ((perf.winRateTrend || 0) / 100 * (totalTrades-1)) || 0;
                         perf.winRateTrend = ((trendTradesCount + (isWin ? 1 : 0)) / totalTrades) * 100;
                    } else {
                         const rangeTradesCount = ((perf.winRateRange || 0) / 100 * (totalTrades-1)) || 0;
                         perf.winRateRange = ((rangeTradesCount + (isWin ? 1 : 0)) / totalTrades) * 100;
                    }
                }
                return false;
            }
            return true;
        });

        if (performanceChanged) {
            const updatedPerformance = Array.from(performanceMap.values());
            setRobotPerformance(updatedPerformance);
            evolveTrigger(updatedPerformance); 
            if (user) saveRobotPerformance(user.uid, updatedPerformance);
        }
        virtualTradesRef.current = stillActiveTrades;
        
        const regime = detectMarketRegime(indicators, activeSymbol);
        const microstructure = analyzeMicrostructure(priceTicks);
        
        let riseLikelihoodSum = 0, fallLikelihoodSum = 0, activeRobots = 0;
        const newVotes: CouncilVotes = {};
        const riseVotesData: Omit<RobotVote, 'weight'>[] = [];
        const fallVotesData: Omit<RobotVote, 'weight'>[] = [];
        

        strategyCouncil.forEach(robot => {
            const voteData = getVoteForRegime(robot, indicators, regime, tickCandles);
            const perf = robotPerformance.find(p => p.id === robot.id);
            const historicalWinRate = perf ? (regime.includes('TREND') ? (perf.winRateTrend || 50) : (perf.winRateRange || 50)) / 100 : 0.5;
            
            if (historicalWinRate < 0.45) {
                newVotes[robot.id] = { ...voteData, weight: 0 };
                return;
            }; 

            if (voteData.vote !== 'HOLD') {
                activeRobots++;
                const weight = (voteData.confidence / 100) * historicalWinRate;
                newVotes[robot.id] = { ...voteData, weight };
                
                if (voteData.vote === 'RISE') { 
                    riseLikelihoodSum += weight;
                    riseVotesData.push(voteData);
                }
                if (voteData.vote === 'FALL') { 
                    fallLikelihoodSum += weight;
                    fallVotesData.push(voteData);
                }
                
                const durationInSeconds = durationToSeconds(voteData.optimalDuration, voteData.optimalDurationUnit);
                virtualTradesRef.current.push({
                    id: `vt_${robot.id}_${currentTick.epoch}`, robotId: robot.id, vote: voteData.vote,
                    entryPrice: currentTick.close, entryEpoch: currentTick.epoch,
                    exitEpoch: currentTick.epoch + durationInSeconds, regime: regime
                });
            } else {
                 newVotes[robot.id] = { ...voteData, weight: 0 };
            }
        });
        
        setCouncilVotes(newVotes);
        setConsensusSum({ rise: riseLikelihoodSum, fall: fallLikelihoodSum });
        
        const totalWeight = riseLikelihoodSum + fallLikelihoodSum;
        const riseProb = totalWeight > 0 ? riseLikelihoodSum / totalWeight : 0.5;
        
        let decision: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
        let finalProbability = 0.5;

        if (riseProb > fallLikelihoodSum / totalWeight && riseProb > 0.65) { decision = 'RISE'; finalProbability = riseProb; }
        else if (fallLikelihoodSum / totalWeight > riseProb && fallLikelihoodSum / totalWeight > 0.65) { decision = 'FALL'; finalProbability = 1 - riseProb; }
        setConsensusDecision(decision);
        
        if ((decision === 'RISE' && microstructure.pressure < 0.2) || (decision === 'FALL' && microstructure.pressure > 0.8) || microstructure.isSpike) {
            decision = 'HOLD';
        }

        const suggestedStake = calculateKellyStake(dailyBalance, finalProbability);
        
        setDashboardData({
            regime, bayesianProbability: finalProbability, kellyStake: suggestedStake,
            microstructure, activeRobotsCount: activeRobots, consensusDirection: decision
        });

        const now = Math.floor(Date.now() / 1000);
        if (isCalibrated && decision !== 'HOLD' && suggestedStake > 0 && !executionRef.current.isProcessing && (now - executionRef.current.lastTradeEpoch > 5)) {
            executionRef.current.isProcessing = true;
            
            const winningVotes = decision === 'RISE' ? riseVotesData : fallVotesData;
            const totalConfidence = winningVotes.reduce((sum, v) => sum + v.confidence, 0);

            const finalStake = totalConfidence > 0 ? winningVotes.reduce((sum, v) => sum + v.suggestedStake * (v.confidence / totalConfidence), 0) : suggestedStake;
            const finalDurationInSeconds = totalConfidence > 0 ? winningVotes.reduce((sum, v) => sum + durationToSeconds(v.optimalDuration, v.optimalDurationUnit) * (v.confidence / totalConfidence), 0) : durationToSeconds(5, 't');
            
            let finalDuration = Math.max(1, Math.round(finalDurationInSeconds / 2));
            const finalDurationUnit: DurationUnit = 't';
            if (finalDuration > 10) finalDuration = 10; // Clamp duration for ticks

            toast({ title: "🤖 Ordem do Conselho Quant", description: `${decision} | Stake: $${finalStake.toFixed(2)} | Dur: ${finalDuration}t | Prob: ${(finalProbability*100).toFixed(1)}%` });
            
            executeTrade(
                decision === 'RISE' ? 'CALL' : 'PUT', finalStake, activeSymbol, decision.toLowerCase() as 'rise' | 'fall', 
                finalDuration, finalDurationUnit, 'Conselho'
            ).finally(() => {
                executionRef.current.lastTradeEpoch = now;
                setTimeout(() => { executionRef.current.isProcessing = false }, 3000);
            });
        }

    }, [priceTicks, activeSymbol, isCouncilAutopilotOn, strategyCouncil, robotPerformance, dailyBalance, executeTrade, toast, isConnected, user, evolveTrigger, timePeriod, isCalibrated, dailyTarget]);

    return {
        dashboardData,
        isCouncilAutopilotOn, setIsCouncilAutopilotOn,
        dailyBalance, setDailyBalance,
        dailyTarget, setDailyTarget,
        fetchStrategyCouncil,
        dissolveCouncil,
        strategyCouncil, isFetchingCouncil, robotPerformance, evolutionHistory,
        isMeritocracyOn, setIsMeritocracyOn,
        isDynamicRiskOn, setIsDynamicRiskOn,
        isDynamicConsensusOn, setIsDynamicConsensusOn,
        consensusThreshold, setConsensusThreshold,
        baseStake, setBaseStake,
        baseDuration, setBaseDuration,
        councilVotes,
        indicators,
        activeCommittee,
        supervisionStatus,
        consensusSum,
        consensusDecision
    };
}
