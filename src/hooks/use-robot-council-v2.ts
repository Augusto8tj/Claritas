'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApi } from './use-deriv-api';
import { useToast } from './use-toast';
import type { RobotStrategy, DurationUnit, ChartData, TickData, CandleData, Operation, RobotVote as RobotVoteType, MarketRegime, MicrostructureFeatures, BayesianVote, EnhancedRobotPerformance as EnhancedRobotPerformanceType } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance } from '@/services/financial-data-service';
import { useStrategyEvolution } from './use-strategy-evolution';
import { initialCouncilStrategies } from '@/services/council-strategies';
import { detectMarketRegime, calculateKellyStake, bayesianUpdate, calibrateConfidence, calculatePerformanceMetrics, monteCarloValidation, extractMicrostructureFeatures, analyzeStrategyByRegime } from '@/services/advanced-trading-services';

// --- CONSTANTES ---
const VIRTUAL_STAKE = 1.0;
const KELLY_FRACTION = 0.25;
const MIN_SHARPE_RATIO = 1.5;
const MONTE_CARLO_ITERATIONS = 1000;
const REGIME_LOOKBACK = 50;
const MICROSTRUCTURE_WINDOW = 20;
const MIN_TRADES_FOR_STATS = 30;

const REGIME_THRESHOLDS = {
  ADX_TREND: 25,
  ADX_WEAK: 20,
  BBW_HIGH_VOL: 0.1,
  RANGE_BREAK: 2.0,
};

type VirtualTrade = {
  id: string;
  robotId: string;
  vote: 'RISE' | 'FALL';
  entryPrice: number;
  entryEpoch: number;
  exitEpoch: number;
  regime: MarketRegime;
  microstructure: MicrostructureFeatures;
  stake: number;
};

export type EnhancedRobotPerformance = EnhancedRobotPerformanceType;
export type RobotVote = RobotVoteType;
export type CouncilVotes = { [key: string]: RobotVote };


const durationToSeconds = (duration: number, unit: DurationUnit): number => {
    switch (unit) {
        case 't': return duration * 2;
        case 's': return duration;
        case 'm': return duration * 60;
        case 'h': return duration * 3600;
        case 'd': return duration * 86400;
        default: return duration;
    }
};

const calculateTechnicalVote = (
  robot: RobotStrategy,
  indicators: Indicators,
  tickCandles: CandleData[]
): { vote: 'RISE' | 'FALL' | 'HOLD'; confidence: number; optimalDuration: number; optimalDurationUnit: DurationUnit; suggestedStake: number } => {
  
  let vote: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
  let confidence = 0;
  let suggestedStake = 0;
  const { optimalDuration, optimalDurationUnit, suggestedStake: baseStake } = robot;

  const setVote = (newVote: 'RISE' | 'FALL', newConfidence: number) => {
    vote = newVote;
    confidence = newConfidence;
    suggestedStake = confidence === robot.strongConfidence ? baseStake : baseStake * 0.5;
  };

  const isValid = (value: any): value is number => 
    value !== null && value !== undefined && !isNaN(value);

  if (!indicators) {
    return { vote: 'HOLD', confidence: 0, optimalDuration, optimalDurationUnit, suggestedStake: 0 };
  }

  // --- Lógica de Voto Consolidada ---
  const { rsi, stoch, macd, bb, ma, adx, pdi, ndi, stochRSI, mfi, rvi } = indicators;
  
  if (robot.strategyType === 'RSI' && isValid(rsi)) {
    if (rsi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
    else if (rsi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
    else if (rsi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    else if (rsi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
  } 
  else if (robot.strategyType === 'STOCHASTIC' && isValid(stoch)) {
    if (stoch <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
    else if (stoch <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
    else if (stoch >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    else if (stoch >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
  }
  else if (robot.strategyType === 'MACD_CROSS' && isValid(macd.macd) && isValid(macd.signal)) {
    if (macd.macd > macd.signal) setVote('RISE', robot.weakConfidence);
    else if (macd.signal > macd.macd) setVote('FALL', robot.weakConfidence);
  }
  else if (robot.strategyType === 'BOLLINGER_BANDS' && isValid(bb.lower) && isValid(bb.upper) && tickCandles.length > 0) {
    const lastPrice = tickCandles[tickCandles.length - 1].close;
    if (isValid(lastPrice)) {
      if (lastPrice <= bb.lower) setVote('RISE', robot.weakConfidence);
      if (lastPrice >= bb.upper) setVote('FALL', robot.weakConfidence);
    }
  }
  else if (robot.strategyType === 'MOVING_AVERAGE_CROSS' && isValid(ma.short) && isValid(ma.long)) {
    if (ma.short > ma.long) setVote('RISE', robot.weakConfidence);
    else if (ma.long > ma.short) setVote('FALL', robot.weakConfidence);
  }
  else if (robot.strategyType === 'ADX_TREND' && isValid(adx) && adx > robot.trendStrengthThreshold!) {
      if (isValid(pdi) && isValid(ndi)) {
          if (pdi > ndi) setVote('RISE', robot.weakConfidence);
          else if (ndi > pdi) setVote('FALL', robot.weakConfidence);
      }
  }
  else if (robot.strategyType === 'MFI' && isValid(mfi)) {
    if (mfi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
    else if (mfi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
    else if (mfi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    else if (mfi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
  }
  else if (robot.strategyType === 'STOCH_RSI' && isValid(stochRSI)) {
     if (stochRSI <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
     else if (stochRSI <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
     else if (stochRSI >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
     else if (stochRSI >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
  }
   else if (robot.strategyType === 'RVI' && isValid(rvi)) {
    if (rvi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
    else if (rvi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
    else if (rvi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    else if (rvi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
  }

  return { vote, confidence, optimalDuration, optimalDurationUnit, suggestedStake };
};


// --- HOOK ---
export function useRobotCouncilV2(
  activeSymbol: string | null,
  priceTicks: TickData[]
) {
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits, sellContract } = useDerivApi();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);

  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>(evolvedStrategies as RobotStrategy[]);
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
  
  const [currentRegime, setCurrentRegime] = useState<{
    regime: MarketRegime;
    confidence: number;
    probabilities: Record<MarketRegime, number>;
  }>({
    regime: 'ranging',
    confidence: 0.5,
    probabilities: {
        trending_bull: 0.2,
        trending_bear: 0.2,
        ranging: 0.4,
        high_volatility: 0.1,
        breakout: 0.1
      }
  });
  
  const [microstructure, setMicrostructure] = useState<MicrostructureFeatures | null>(null);
  const [robotPerformance, setRobotPerformance] = useState<EnhancedRobotPerformance[]>([]);
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  const tradeCounterRef = useRef(0);
  const transitionMatrixRef = useRef<number[][] | undefined>(undefined);

  const [dailyBalance, setDailyBalance] = useState(100);
  const [dailyTarget, setDailyTarget] = useState(50);
  const [consensusThreshold, setConsensusThreshold] = useState(300);
  const [isDynamicConsensusOn, setIsDynamicConsensusOn] = useState(true);
  const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true);
  const [isMeritocracyOn, setIsMeritocracyOn] = useState(true);
  
  const [consensusDecision, setConsensusDecision] = useState<{
    direction: 'RISE' | 'FALL' | 'HOLD';
    probability: number;
    stake: number;
  }>({
    direction: 'HOLD',
    probability: 0.5,
    stake: 0
  });

  const [portfolioStats, setPortfolioStats] = useState({
    totalExposure: 0,
    maxExposure: dailyBalance * 0.3,
    currentDrawdown: 0,
    maxDrawdown: 0,
    dailyPnL: 0
  });

  const councilExecutionRef = useRef<{ 
    isExecuting: boolean;
    sellingContracts: Set<number>;
  }>({ 
    isExecuting: false, 
    sellingContracts: new Set() 
  });

  const tickCandles = useMemo(() => {
    if (!priceTicks || priceTicks.length === 0) return [];
    return priceTicks.map((t) => ({ 
      epoch: t.epoch, 
      open: t.price, 
      high: t.price, 
      low: t.price, 
      close: t.price, 
      volume: 1 
    }));
  }, [priceTicks]);

  useEffect(() => {
    setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
  }, [evolvedStrategies]);

  useEffect(() => {
    if (!user || isAuthLoading) return;
    
    loadRobotPerformance(user.uid)
      .then((stored) => {
        if (stored && stored.length > 0) {
          const enhanced: EnhancedRobotPerformance[] = (stored as any[]).map(p => ({
            ...p,
            sharpeRatio: p.sharpeRatio || 0,
            maxDrawdown: p.maxDrawdown || 0,
            avgWin: p.avgWin || 0,
            avgLoss: p.avgLoss || 0,
            profitFactor: p.profitFactor || 0,
            kellyFraction: p.kellyFraction || 0,
            effectiveRegimes: p.effectiveRegimes || ['ranging'],
            monteCarloScore: p.monteCarloScore || 0,
            lastUpdated: p.lastUpdated || Date.now(),
            tradeHistory: []
          }));
          setRobotPerformance(enhanced);
        }
      })
      .catch(err => console.error("Erro ao carregar performance", err));
  }, [user, isAuthLoading]);

  const fetchStrategyCouncil = useCallback(async () => {
    if (!activeSymbol || !user) {
      toast({
        variant: 'destructive',
        title: !user ? 'Não Autenticado' : 'Nenhum Ativo',
        description: 'Necessário login e ativo selecionado.',
      });
      return;
    }

    setIsFetchingCouncil(true);
    virtualTradesRef.current = [];
    tradeCounterRef.current = 0;
    
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    const council = (evolvedStrategies as RobotStrategy[]).map(s => ({...s}));

    setStrategyCouncil(council);

    if (robotPerformance.length === 0) {
      const initialPerformance: EnhancedRobotPerformance[] = council.map((robot) => ({
        id: robot.id,
        strategyType: robot.strategyType,
        strategy: robot,
        wins: 0,
        losses: 0,
        totalProfit: 0,
        winRate: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        kellyFraction: 0,
        effectiveRegimes: ['ranging'],
        monteCarloScore: 0,
        lastUpdated: Date.now(),
        tradeHistory: []
      }));
      setRobotPerformance(initialPerformance);
      saveRobotPerformance(user.uid, initialPerformance);
    }

    toast({
      title: 'Sistema V2.0 Ativado',
      description: `${council.length} robôs com IA avançada iniciados.`,
    });
    
    setIsCouncilAutopilotOn(true);
    setIsFetchingCouncil(false);
  }, [activeSymbol, user, toast, robotPerformance, evolvedStrategies]);


  const dissolveCouncil = () => {
    setStrategyCouncil([]);
    setIsCouncilAutopilotOn(false);
    virtualTradesRef.current = [];
  };

  useEffect(() => {
    if (!isConnected || !user || !isCouncilAutopilotOn || 
        strategyCouncil.length === 0 || !activeSymbol || 
        tickCandles.length < REGIME_LOOKBACK) {
      return;
    }
    
    const currentTick = priceTicks[priceTicks.length - 1];
    if(!currentTick) return;
    
    const currentIndicators = calculateAllIndicators(tickCandles, strategyCouncil, timePeriod);
    if (!currentIndicators) return;

    const regimeResult = detectMarketRegime(
        tickCandles, 
        { adx: currentIndicators.adx, pdi: currentIndicators.pdi, ndi: currentIndicators.ndi, bbw: currentIndicators.bbw, roc: currentIndicators.roc, atr: currentIndicators.atr }, 
        currentRegime.regime, 
        transitionMatrixRef.current
    );
    setCurrentRegime({ regime: regimeResult.regime, confidence: regimeResult.confidence, probabilities: regimeResult.probabilities });
    transitionMatrixRef.current = regimeResult.transitionMatrix;

    const microFeatures = extractMicrostructureFeatures(priceTicks, tickCandles);
    setMicrostructure(microFeatures);

    const activeCouncilContracts = operationsLog.filter(op => op.status === 'pending' && op.initiator === 'Conselho');
    activeCouncilContracts.forEach(contract => {
        if (councilExecutionRef.current.sellingContracts.has(contract.id)) return;
        
        if (currentIndicators.chandelierExit && contract.entryPrice) {
            if (contract.direction === 'rise' && currentTick.price < currentIndicators.chandelierExit) {
                 councilExecutionRef.current.sellingContracts.add(contract.id);
                 sellContract(contract.id);
                 toast({ title: "🛡️ Stop Loss Atingido (Chandelier)", description: `Contrato #${contract.id} fechado para proteger capital.`, variant: "destructive" });
                 return;
            }
        }
    });

    const stillActiveTrades: VirtualTrade[] = [];
    const performanceMap = new Map<string, EnhancedRobotPerformance>(robotPerformance.map(p => [p.id, { ...p }]));
    let performanceChanged = false;

    virtualTradesRef.current.forEach(trade => {
        if (currentTick.epoch >= trade.exitEpoch) {
            const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;
            const isWin = (trade.vote === 'RISE' && exitTick.price > trade.entryPrice) || (trade.vote === 'FALL' && exitTick.price < trade.entryPrice);
            const pnl = isWin ? VIRTUAL_STAKE * 0.95 : -VIRTUAL_STAKE;
            const perf = performanceMap.get(trade.robotId);
            if (perf) {
                perf.totalProfit += pnl;
                if (!perf.tradeHistory) perf.tradeHistory = [];
                perf.tradeHistory.push(pnl);
                if (isWin) perf.wins++; else perf.losses++;
                const totalTrades = perf.wins + perf.losses;
                perf.winRate = totalTrades > 0 ? (perf.wins / totalTrades) * 100 : 0;
                if (perf.tradeHistory.length >= MIN_TRADES_FOR_STATS) {
                    const metrics = calculatePerformanceMetrics(perf.tradeHistory.map((profit, idx) => ({ profit, timestamp: Date.now() - (perf.tradeHistory.length - idx) * 60000 })));
                    perf.sharpeRatio = metrics.sharpeRatio;
                    perf.maxDrawdown = metrics.maxDrawdown;
                    perf.avgWin = metrics.avgWin;
                    perf.avgLoss = metrics.avgLoss;
                    perf.profitFactor = metrics.profitFactor;
                    perf.kellyFraction = metrics.kellyFraction;
                    const mcResult = monteCarloValidation(perf.tradeHistory);
                    perf.monteCarloScore = mcResult.score;
                    const regimeTrades = perf.tradeHistory.map((profit, idx) => ({ regime: trade.regime, profit }));
                    perf.effectiveRegimes = analyzeStrategyByRegime(regimeTrades);
                }
                perf.lastUpdated = Date.now();
                performanceChanged = true;
            }
        } else {
            stillActiveTrades.push(trade);
        }
    });

    virtualTradesRef.current = stillActiveTrades;
    if (performanceChanged) {
        const updatedPerformance = Array.from(performanceMap.values());
        updatedPerformance.sort((a, b) => b.sharpeRatio - a.sharpeRatio);
        setRobotPerformance(updatedPerformance);
        evolveTrigger(updatedPerformance);
        if (user) saveRobotPerformance(user.uid, updatedPerformance).catch(err => console.error('Erro ao salvar performance:', err));
    }

    const newVotes: Record<string, any> = {};
    let riseSum = 0, fallSum = 0, totalWeight = 0, weightedStakeSum = 0, weightedDurationSum = 0;

    strategyCouncil.forEach(robot => {
        const perf = performanceMap.get(robot.id);
        const technicalVote = calculateTechnicalVote(robot, currentIndicators, tickCandles);
        if (perf && perf.effectiveRegimes && perf.effectiveRegimes.length > 0 && !perf.effectiveRegimes.includes(regimeResult.regime)) {
            newVotes[robot.id] = { vote: 'HOLD', rawConfidence: 0, calibratedConfidence: 0, bayesianProbability: 0.5, weight: 0, optimalDuration: robot.optimalDuration, optimalDurationUnit: robot.optimalDurationUnit, suggestedStake: 0, regime: regimeResult.regime };
            return;
        }
        if (technicalVote.vote === 'HOLD') {
            newVotes[robot.id] = { ...technicalVote, rawConfidence: 0, calibratedConfidence: 0, bayesianProbability: 0.5, weight: 1.0, regime: regimeResult.regime };
            return;
        }

        let prior = 0.5;
        if (perf && (perf.wins + perf.losses) >= MIN_TRADES_FOR_STATS) prior = perf.winRate / 100;
        let likelihood = technicalVote.confidence / 100;
        if (microFeatures && microFeatures.yangZhangVolatility > 0.05) likelihood *= 0.8;
        if (microFeatures && Math.abs(microFeatures.meanReversion) > 2) {
            const isContrarian = (technicalVote.vote === 'RISE' && microFeatures.meanReversion > 2) || (technicalVote.vote === 'FALL' && microFeatures.meanReversion < -2);
            if (isContrarian) likelihood *= 0.7;
        }
        const posterior = bayesianUpdate(prior, likelihood);
        const calibratedConf = calibrateConfidence(technicalVote.confidence, perf?.winRate || 50);

        let weight = 1.0;
        if (isMeritocracyOn && perf && (perf.wins + perf.losses) > 10) {
            const sharpeWeight = Math.max(0.2, Math.min(2.0, perf.sharpeRatio / 1.5));
            const mcWeight = perf.monteCarloScore >= 0.95 ? 1.2 : perf.monteCarloScore >= 0.85 ? 1.0 : 0.5;
            weight = sharpeWeight * mcWeight;
        }

        const durationInSeconds = durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit);
        const tradeId = `vt_${Date.now()}_${tradeCounterRef.current++}`;
        const virtualTrade: VirtualTrade = { id: tradeId, robotId: robot.id, vote: technicalVote.vote, entryPrice: currentTick.price, entryEpoch: currentTick.epoch, exitEpoch: currentTick.epoch + durationInSeconds, regime: regimeResult.regime, microstructure: microFeatures, stake: VIRTUAL_STAKE };
        virtualTradesRef.current.push(virtualTrade);

        const finalVote = { vote: technicalVote.vote, rawConfidence: technicalVote.confidence, calibratedConfidence: calibratedConf * 100, bayesianProbability: posterior, weight, optimalDuration: technicalVote.optimalDuration, optimalDurationUnit: technicalVote.optimalDurationUnit, suggestedStake: technicalVote.suggestedStake * posterior, regime: regimeResult.regime };
        newVotes[robot.id] = finalVote;

        const voteWeight = calibratedConf * weight;
        if (technicalVote.vote === 'RISE') riseSum += voteWeight;
        if (technicalVote.vote === 'FALL') fallSum += voteWeight;
        weightedStakeSum += finalVote.suggestedStake * voteWeight;
        weightedDurationSum += durationInSeconds * voteWeight;
        totalWeight += voteWeight;
    });

    let consensusDirection: 'RISE' | 'FALL' | 'HOLD' = 'HOLD', consensusProbability = 0.5;
    if (totalWeight > 0) {
        consensusProbability = Math.max(riseSum, fallSum) / (riseSum + fallSum);
        if (riseSum > fallSum && riseSum > 0) consensusDirection = 'RISE';
        else if (fallSum > riseSum && fallSum > 0) consensusDirection = 'FALL';
    }

    const dailyPnL = operationsLog.filter(op => new Date(op.timestamp).toDateString() === new Date().toDateString() && op.initiator === 'Conselho').reduce((sum, op) => sum + (op.result || 0), 0);
    if (dailyPnL <= -dailyBalance) {
        toast({ title: "🛑 Stop Loss Diário Atingido", description: "Operações suspensas até amanhã.", variant: "destructive" });
        return;
    }
    if (dailyPnL >= dailyTarget) {
        toast({ title: "🎯 Meta Diária Batida", description: `Lucro de $${dailyPnL.toFixed(2)} garantido!` });
        return;
    }

    let effectiveThreshold = consensusThreshold;
    if (isDynamicConsensusOn && microFeatures) {
        const volatilityFactor = (microFeatures.yangZhangVolatility > 0.05) ? 1.3 : 1.0;
        effectiveThreshold = (totalWeight * 0.6) * volatilityFactor;
    }
    const consensusReached = Math.max(riseSum, fallSum) >= effectiveThreshold;
    if (!consensusReached) {
        setConsensusDecision({ direction: 'HOLD', probability: consensusProbability, stake: 0 });
        return;
    }

    const avgWinRate = robotPerformance.reduce((sum, r) => sum + (r.winRate || 0), 0) / (robotPerformance.length || 1) / 100;
    const payoff = 0.95; // Simplified payoff for this logic
    let kellyStake = calculateKellyStake(dailyBalance, consensusProbability, payoff);

    if (isDynamicRiskOn) {
        if (currentIndicators.adx && currentIndicators.adx < 20) kellyStake *= 0.5;
        const currentDrawdown = Math.abs(dailyPnL / dailyBalance * 100);
        if (currentDrawdown > 5) kellyStake *= 0.7;
    }
    kellyStake = Math.max(0.35, Math.min(kellyStake, dailyBalance * 0.05));

    const avgDurationSeconds = totalWeight > 0 ? weightedDurationSum / totalWeight : 300;
    let finalDuration = Math.round(avgDurationSeconds / 60), finalDurationUnit: DurationUnit = 'm';
    if (durationLimits) {
        if (avgDurationSeconds <= durationLimits.t.max * 2) {
            finalDurationUnit = 't';
            finalDuration = Math.round(avgDurationSeconds / 2);
        } else if (avgDurationSeconds < 60) {
            finalDurationUnit = 's';
            finalDuration = Math.round(avgDurationSeconds);
        }
        const { min, max } = durationLimits[finalDurationUnit];
        finalDuration = Math.max(min, Math.min(max, finalDuration));
    } else {
        finalDuration = 5;
        finalDurationUnit = 't';
    }

    setConsensusDecision({ direction: consensusDirection, probability: consensusProbability, stake: kellyStake });
    const activeStakes = activeCouncilContracts.reduce((sum, c) => sum + c.stake, 0);
    setPortfolioStats({ totalExposure: activeStakes, maxExposure: dailyBalance * 0.3, currentDrawdown: Math.abs(dailyPnL / dailyBalance * 100), maxDrawdown: Math.max(portfolioStats.maxDrawdown, Math.abs(dailyPnL / dailyBalance * 100)), dailyPnL });

    if (councilExecutionRef.current.isExecuting) return;
    if (activeStakes + kellyStake > dailyBalance * 0.3) {
        toast({ title: "⚠️ Limite de Exposição", description: "Aguardando fechamento de posições.", variant: "default" });
        return;
    }
    if (consensusProbability < 0.65) return;

    councilExecutionRef.current.isExecuting = true;
    toast({ title: "🚀 Ordem Executada", description: `${consensusDirection} com $${kellyStake.toFixed(2)} (${(consensusProbability * 100).toFixed(1)}% confiança)` });
    executeTrade(consensusDirection === 'RISE' ? 'CALL' : 'PUT', kellyStake, activeSymbol!, consensusDirection.toLowerCase() as 'rise' | 'fall', finalDuration, finalDurationUnit, 'Conselho').finally(() => setTimeout(() => { councilExecutionRef.current.isExecuting = false; }, 5000));
  }, [
    priceTicks, tickCandles, isConnected, isCouncilAutopilotOn, strategyCouncil, robotPerformance, 
    isMeritocracyOn, isDynamicConsensusOn, isDynamicRiskOn, activeSymbol, operationsLog, 
    currentRegime, user, toast, executeTrade, sellContract, timePeriod, durationLimits, 
    consensusThreshold, dailyBalance, dailyTarget, evolveTrigger, portfolioStats.maxDrawdown
  ]);

  return {
    isCouncilAutopilotOn, setIsCouncilAutopilotOn,
    strategyCouncil, isFetchingCouncil,
    robotPerformance, evolutionHistory,
    currentRegime, microstructure,
    consensusDecision, portfolioStats,
    dailyBalance, setDailyBalance,
    dailyTarget, setDailyTarget,
    consensusThreshold, setConsensusThreshold,
    isDynamicConsensusOn, setIsDynamicConsensusOn,
    isDynamicRiskOn, setIsDynamicRiskOn,
    isMeritocracyOn, setIsMeritocracyOn,
    fetchStrategyCouncil, dissolveCouncil
  };
}
