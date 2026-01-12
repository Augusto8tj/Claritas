'use client';

/**
 * @fileoverview Este hook é o cérebro central da Mesa Operacional V1.
 * Ele possui duas responsabilidades principais:
 * 1. O CONSELHO DE ROBÔS:
 *    - Convoca e gere um conselho de 22 robôs analistas.
 *    - A cada tick de preço, calcula o voto de cada robô (RISE/FALL/HOLD).
 *    - Agrega os votos para formar uma decisão de consenso.
 *    - Aplica a lógica de supervisão e gestão de risco (Comités).
 *
 * 2. A ARENA VIRTUAL:
 *    - Para cada voto válido, cria uma "operação virtual" (paper trade).
 *    - Rastreia o resultado dessas operações virtuais para medir o desempenho individual de cada robô.
 *    - Calcula vitórias, derrotas e P&L (Lucro/Prejuízo) para cada analista.
 *    - Permite o modo "Meritocracia", onde o peso do voto de um robô é ponderado pelo seu desempenho histórico.
 *    - Persiste os dados de desempenho no Firebase.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiV1 } from './use-deriv-api-v1';
import { useToast } from '@/hooks/use-toast';
import type { RobotStrategy, ChartData, TickData, CandleData, DurationUnit, RobotVote as RobotVoteType, CouncilVotes, RobotPerformance as RobotPerformanceType } from '@/lib/types';
import type { RiseFallFormValues } from '@/features/trading/components/deriv-trader/deriv-trader-interface.types';
import { useFormContext } from 'react-hook-form';
import type { Indicators } from '@/services/indicator-service-v1';
import { calculateAllIndicators } from '@/services/indicator-service-v1';
import { initialCouncilStrategies } from '@/services/council-strategies';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance } from '@/services/trading-data-service-v1';
import { useStrategyEvolutionV1 } from './use-strategy-evolution-v1';

// --- TIPAGEM E TIPOS DE DADOS ---
export type RobotVote = RobotVoteType;
export type RobotPerformance = RobotPerformanceType;

// Representa uma operação simulada (paper trade) na Arena Virtual.
type VirtualTrade = {
    id: string;
    robotId: string;
    vote: 'RISE' | 'FALL';
    entryPrice: number;
    entryEpoch: number;
    exitEpoch: number; 
};

const VIRTUAL_STAKE = 1.0; 

// --- FUNÇÕES AUXILIARES (HELPERS) ---
const isCandle = (d: ChartData): d is CandleData => d !== null && 'close' in d;
const getPrice = (d: ChartData | null): number | undefined => {
    if (!d) return undefined;
    return isCandle(d) ? d.close : d.price;
};
const isValid = (value: any): value is number => value !== null && value !== undefined && !isNaN(value);

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

const calculateRobotVote = (
    robot: RobotStrategy,
    indicators: Indicators,
    tickCandles: CandleData[]
): Omit<RobotVote, 'weight'> => {
    
    let vote: RobotVote['vote'] = 'HOLD';
    let confidence = 0;
    let suggestedStake = 0;
    const { optimalDuration, optimalDurationUnit, suggestedStake: baseStake } = robot;

    const setVote = (newVote: 'RISE' | 'FALL', newConfidence: number) => {
        vote = newVote;
        confidence = newConfidence;
        if (confidence === robot.strongConfidence) {
            suggestedStake = baseStake; 
        } else if (confidence === robot.weakConfidence) {
            suggestedStake = baseStake * 0.5; 
        }
    };

    if (!indicators) return { vote: 'HOLD', confidence: 0, optimalDuration, optimalDurationUnit, suggestedStake: 0 };
    
    if (robot.strategyType === 'RSI' && isValid(indicators.rsi)) {
        if (indicators.rsi! <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
        if (indicators.rsi! <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
        if (indicators.rsi! >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
        if (indicators.rsi! >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    }
    
    if (robot.strategyType === 'STOCHASTIC' && isValid(indicators.stoch)) {
        if (indicators.stoch! <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
        if (indicators.stoch! <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
        if (indicators.stoch! >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
        if (indicators.stoch! >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    }

    if (robot.strategyType === 'MOVING_AVERAGE_CROSS' && isValid(indicators.ma.short) && isValid(indicators.ma.long)) {
        if (indicators.ma.short! > indicators.ma.long!) setVote('RISE', robot.weakConfidence);
        if (indicators.ma.long! > indicators.ma.short!) setVote('FALL', robot.weakConfidence);
    }

    if (robot.strategyType === 'MACD_CROSS' && isValid(indicators.macd.macd) && isValid(indicators.macd.signal)) {
       if (indicators.macd.macd! > indicators.macd.signal!) setVote('RISE', robot.weakConfidence);
       if (indicators.macd.signal! > indicators.macd.macd!) setVote('FALL', robot.weakConfidence);
    }
    
    if (robot.strategyType === 'BOLLINGER_BANDS' && indicators.bollingerBands?.length && tickCandles.length) {
        const lastBand = indicators.bollingerBands[indicators.bollingerBands.length - 1];
        const lastPrice = tickCandles[tickCandles.length - 1].close;
        if (lastBand && isValid(lastBand.lower) && isValid(lastBand.upper) && isValid(lastPrice)) {
            if (lastPrice <= lastBand.lower) setVote('RISE', robot.weakConfidence);
            if (lastPrice >= lastBand.upper) setVote('FALL', robot.weakConfidence);
        }
    }

    if (robot.strategyType === 'ADX_TREND' && isValid(indicators.adx)) {
        if (indicators.adx! > (robot.trendStrengthThreshold || 25)) {
            if (isValid(indicators.pdi) && isValid(indicators.ndi)) {
                if (indicators.pdi! > indicators.ndi!) setVote('RISE', robot.weakConfidence);
                if (indicators.ndi! > indicators.pdi!) setVote('FALL', robot.weakConfidence);
            }
        }
    }
    
    if (robot.strategyType === 'MFI' && isValid(indicators.mfi)) {
        if (indicators.mfi! <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
        if (indicators.mfi! <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
        if (indicators.mfi! >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
        if (indicators.mfi! >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    }
    
    if (robot.strategyType === 'STOCH_RSI' && isValid(indicators.stochRSI)) {
        if (indicators.stochRSI! <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence);
        if (indicators.stochRSI! <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence);
        if (indicators.stochRSI! >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence);
        if (indicators.stochRSI! >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence);
    }
    
    if (robot.strategyType === 'PRICE_ACTION_PATTERN' && tickCandles.length >= 3) {
        const [c3, c2, c1] = tickCandles.slice(-3);
        const body = Math.abs(c1.close - c1.open);
        const upperWick = c1.high - Math.max(c1.open, c1.close);
        const lowerWick = Math.min(c1.open, c1.close) - c1.low;
        const isUpTrend = c3.close > c3.open && c2.close > c2.open;
        const isDownTrend = c3.close < c3.open && c2.close < c2.open;

        if (robot.pattern === 'hammer' && isDownTrend && lowerWick > body * 2 && upperWick < body * 0.5) {
             setVote('RISE', robot.strongConfidence);
        }
        if (robot.pattern === 'shooting_star' && isUpTrend && upperWick > body * 2 && lowerWick < body * 0.5) {
             setVote('FALL', robot.strongConfidence);
        }
    }

    if (robot.strategyType === 'ICHIMOKU_CLOUD' && indicators.ichimoku && isValid(indicators.ichimoku.senkouA) && isValid(indicators.ichimoku.senkouB) && tickCandles.length > 0) {
        const lastPrice = tickCandles[tickCandles.length - 1].close;
        if (lastPrice > indicators.ichimoku.senkouA! && lastPrice > indicators.ichimoku.senkouB!) {
            setVote('RISE', robot.weakConfidence);
        }
        if (lastPrice < indicators.ichimoku.senkouA! && lastPrice < indicators.ichimoku.senkouB!) {
             setVote('FALL', robot.weakConfidence);
        }
    }
    
    if (robot.strategyType === 'AWESOME_OSCILLATOR' && isValid(indicators.awesomeOscillator)) {
        if (indicators.awesomeOscillator! > 0) setVote('RISE', robot.weakConfidence);
        else setVote('FALL', robot.weakConfidence);
    }
    if (robot.strategyType === 'KAMA' && isValid(indicators.kama) && tickCandles.length > 0) {
        if (tickCandles[tickCandles.length - 1].close > indicators.kama!) setVote('RISE', robot.weakConfidence);
        else setVote('FALL', robot.weakConfidence);
    }
    if (robot.strategyType === 'Z_SCORE' && isValid(indicators.zScore)) {
        if (indicators.zScore! <= -robot.zScoreThreshold!) setVote('RISE', robot.strongConfidence);
        if (indicators.zScore! >= robot.zScoreThreshold!) setVote('FALL', robot.strongConfidence);
    }
     if (robot.strategyType === 'OBV' && isValid(indicators.obv) && indicators.sma.length > 1) {
         if(indicators.sma && indicators.obv > indicators.sma[indicators.sma.length-1]!) {
            setVote('RISE', robot.weakConfidence);
         } else {
             setVote('FALL', robot.weakConfidence);
         }
    }
    if (robot.strategyType === 'TRIX' && isValid(indicators.trix)) {
        if (indicators.trix! > 0) setVote('RISE', robot.weakConfidence);
        if (indicators.trix! < 0) setVote('FALL', robot.weakConfidence);
    }
    if (robot.strategyType === 'ROC' && isValid(indicators.roc)) {
        if (indicators.roc! > 0) setVote('RISE', robot.weakConfidence);
        if (indicators.roc! < 0) setVote('FALL', robot.weakConfidence);
    }
    if (robot.strategyType === 'RVI' && isValid(indicators.rvi)) {
        if (indicators.rvi! > 50) setVote('RISE', robot.weakConfidence);
        if (indicators.rvi! < 50) setVote('FALL', robot.weakConfidence);
    }
    if (robot.strategyType === 'PARABOLIC_SAR' && isValid(indicators.parabolicSAR) && tickCandles.length > 0) {
        const lastPrice = tickCandles[tickCandles.length - 1].close;
        if (lastPrice > indicators.parabolicSAR!) setVote('RISE', robot.weakConfidence);
        if (lastPrice < indicators.parabolicSAR!) setVote('FALL', robot.weakConfidence);
    }

    return { vote, confidence, optimalDuration, optimalDurationUnit, suggestedStake };
};


export function useRobotCouncilV1(activeSymbol: string | null, priceTicks: TickData[]) {
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits, sellContract } = useDerivApiV1();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const form = useFormContext<RiseFallFormValues>();
  const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolutionV1(initialCouncilStrategies);
  
  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>([]);
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
  const [councilVotes, setCouncilVotes] = useState<CouncilVotes>({});
  const [dailyBalance, setDailyBalance] = useState(100);
  const [dailyTarget, setDailyTarget] = useState(50);
  const [isDynamicConsensusOn, setIsDynamicConsensusOn] = useState(true);
  const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true);
  const [isMeritocracyOn, setIsMeritocracyOn] = useState(true);
  const [isInversionModeOn, setIsInversionModeOn] = useState(false);
  const [isStopLossOn, setIsStopLossOn] = useState(true);
  const [robotPerformance, setRobotPerformance] = useState<RobotPerformance[]>([]);
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  const tradeCounterRef = useRef(0);
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [activeCommittee, setActiveCommittee] = useState<string | null>(null);
  const [supervisionStatus, setSupervisionStatus] = useState<{ status: 'inactive' | 'approved' | 'veto'; message: string; analysis?: string }>({ status: 'inactive', message: 'Aguardando consenso.' });
  const [consensusSum, setConsensusSum] = useState({ rise: 0, fall: 0 });
  const [consensusThreshold, setConsensusThreshold] = useState(300);
  const [consensusDecision, setConsensusDecision] = useState<'RISE' | 'FALL' | 'HOLD'>('HOLD');
  const councilExecutionRef = useRef({ isExecuting: false, sellingContracts: new Set<number>() });
  const { baseStake, baseDuration } = {baseStake: 1, baseDuration: 5};
  

  useEffect(() => {
    const councilWithIds = evolvedStrategies.map((strat, index) => ({
      ...strat,
      id: `${strat.strategyType}_BOT_${index + 1}`
    })) as RobotStrategy[];
    setStrategyCouncil(councilWithIds);
  }, [evolvedStrategies]);

  useEffect(() => {
    if (!user || isAuthLoading) return;
    loadRobotPerformance(user.uid)
      .then(stored => {
        if (stored) setRobotPerformance(stored);
      })
      .catch(console.error);
  }, [user, isAuthLoading]);

  const resetArenaPerformance = useCallback(() => {
    if (strategyCouncil.length === 0) return;
    toast({ title: "Arena Reset", description: `Performance para ${activeSymbol} reiniciada.` });
    const initialPerformance: RobotPerformance[] = strategyCouncil.map(robot => ({ id: robot.id, strategyType: robot.strategyType, strategy: robot, wins: 0, losses: 0, totalProfit: 0, winRate: 0 }));
    setRobotPerformance(initialPerformance);
    virtualTradesRef.current = [];
    if (user) saveRobotPerformance(user.uid, initialPerformance);
  }, [strategyCouncil, activeSymbol, toast, user]);

  useEffect(() => {
    if (isCouncilAutopilotOn) resetArenaPerformance();
  }, [activeSymbol, isCouncilAutopilotOn, resetArenaPerformance]);

  const fetchStrategyCouncil = useCallback(async () => {
    if (!activeSymbol || !user) {
      toast({ variant: 'destructive', title: !user ? 'Não Autenticado' : 'Nenhum Ativo', description: !user ? 'Faça login.' : 'Selecione um ativo.' });
      return;
    }
    setIsFetchingCouncil(true);
    virtualTradesRef.current = [];
    tradeCounterRef.current = 0;
    await new Promise(r => setTimeout(r, 500));
    setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
    if (robotPerformance.length === 0) {
      const initialPerformance = (evolvedStrategies as RobotStrategy[]).map(robot => ({ id: robot.id, strategyType: robot.strategyType, strategy: robot, wins: 0, losses: 0, totalProfit: 0, winRate: 0 }));
      setRobotPerformance(initialPerformance);
      await saveRobotPerformance(user.uid, initialPerformance);
    }
    toast({ title: 'Arena Virtual Iniciada', description: `${evolvedStrategies.length} robôs analistas ativos.` });
    setIsCouncilAutopilotOn(true);
    setIsFetchingCouncil(false);
  }, [activeSymbol, user, toast, evolvedStrategies, robotPerformance.length]);

  const dissolveCouncil = () => {
    setStrategyCouncil([]);
    setCouncilVotes({});
    setIsCouncilAutopilotOn(false);
    virtualTradesRef.current = [];
  };

  const committeeOfSpecialists = useCallback(indicators => {
    if (!indicators.adx || !indicators.stoch) return 'Análise Pendente';
    if (indicators.adx > 25) return "Tendência Forte Detectada";
    if (indicators.stoch < 20) return 'Zona de Sobre-venda';
    if (indicators.stoch > 80) return 'Zona de Sobre-compra';
    return 'Mercado Lateral';
  }, []);

  const supervisionCommitteeCheck = useCallback((currentVotes: CouncilVotes, indicators: Indicators | null, dailyPnl: number) => {
    const formValues = form.getValues();
    const { rise: riseSum, fall: fallSum } = Object.values(currentVotes).reduce((acc, v) => {
      if (v.vote === 'RISE') acc.rise += v.confidence * v.weight;
      if (v.vote === 'FALL') acc.fall += v.confidence * v.weight;
      return acc;
    }, { rise: 0, fall: 0 });

    let totalWeight = Object.values(currentVotes).filter(v => v.vote !== 'HOLD').reduce((sum, v) => sum + v.confidence * v.weight, 0);
    let effectiveThreshold = isDynamicConsensusOn ? totalWeight * 0.6 : consensusThreshold;
    let finalStake = formValues.stake;
    let finalDuration = formValues.duration;

    if (isDynamicRiskOn && indicators) {
        let riskFactor = 1.0;
        let analysisParts = [];
        if (indicators.adx && indicators.adx < 20) { riskFactor *= 0.75; analysisParts.push("ADX baixo"); }
        if (indicators.bbw && indicators.bbw > 0.1) { riskFactor *= 0.8; analysisParts.push("volatilidade alta"); }
        finalStake = Math.max(0.35, formValues.stake * riskFactor);
    }
    
    if (dailyPnl <= -dailyBalance) return { status: 'veto' as const, message: 'Stop Loss Diário Atingido', finalStake, finalDuration, finalDurationUnit: formValues.duration_unit, analysis: `Prejuízo de $${Math.abs(dailyPnl).toFixed(2)} atingiu o limite de $${dailyBalance}.` };
    if (dailyPnl >= dailyTarget) return { status: 'veto' as const, message: 'Meta Diária Batida', finalStake, finalDuration, finalDurationUnit: formValues.duration_unit, analysis: `Lucro de $${dailyPnl.toFixed(2)} atingiu a meta de $${dailyTarget}.` };
    if (Math.max(riseSum, fallSum) < effectiveThreshold) return { status: 'inactive' as const, message: 'Aguardando consenso.', finalStake, finalDuration, finalDurationUnit: formValues.duration_unit };

    return { status: 'approved' as const, message: 'Aprovado pelo Conselho', finalStake, finalDuration, finalDurationUnit: formValues.duration_unit, analysis: isDynamicRiskOn ? `Risco ajustado: ${finalStake.toFixed(2)}` : 'Risco padrão.' };
  }, [form, dailyBalance, dailyTarget, isDynamicConsensusOn, isDynamicRiskOn, consensusThreshold]);
  
  const tickCandles = useMemo(() => {
    if (!priceTicks || priceTicks.length === 0) return [];
    return priceTicks.map((t) => ({ epoch: t.epoch, open: t.price, high: t.price, low: t.price, close: t.price, volume: 1 }));
  }, [priceTicks]);

  useEffect(() => {
    if (!isConnected || !user || !isCouncilAutopilotOn || strategyCouncil.length === 0 || !activeSymbol || tickCandles.length < 2) return;

    const currentTickIndex = priceTicks.length - 1;
    const currentTick = priceTicks[currentTickIndex];
    if (!currentTick) return;

    const currentIndicators = calculateAllIndicators(tickCandles, strategyCouncil, timePeriod);
    setIndicators(currentIndicators);
    if (!currentIndicators) return;

    const activeCouncilContracts = operationsLog.filter(op => op.status === 'pending' && op.initiator === 'Conselho');
    
    const performanceMap = new Map(robotPerformance.map(p => [p.id, { ...p }]));
    let performanceChanged = false;
    
    virtualTradesRef.current = virtualTradesRef.current.filter(trade => {
        if(currentTick.epoch >= trade.exitEpoch) {
            const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;
            if (exitTick) {
                const isWin = (trade.vote === 'RISE' && exitTick.price > trade.entryPrice) || (trade.vote === 'FALL' && exitTick.price < trade.entryPrice);
                const perf = performanceMap.get(trade.robotId);
                if (perf) {
                    const pnl = isWin ? VIRTUAL_STAKE * 0.95 : -VIRTUAL_STAKE;
                    perf.totalProfit = (perf.totalProfit || 0) + pnl;
                    if (isWin) perf.wins = (perf.wins || 0) + 1; else perf.losses = (perf.losses || 0) + 1;
                    const totalTrades = perf.wins + perf.losses;
                    perf.winRate = totalTrades > 0 ? (perf.wins / totalTrades) * 100 : 0;
                    performanceChanged = true;
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
        if(user) saveRobotPerformance(user.uid, updatedPerformance);
    }

    const newVotes: CouncilVotes = {};
    const { duration: formDuration, duration_unit: formDurationUnit } = form.getValues();
    const tradeDuration = formDuration > 0 ? formDuration : baseDuration; // Fallback para a duração base

    strategyCouncil.forEach(robot => {
        const voteResult = calculateRobotVote(robot, currentIndicators, tickCandles);
        let weight = 1.0;
        if (isMeritocracyOn) {
            const perf = performanceMap.get(robot.id);
            if (perf && (perf.wins + perf.losses) > 5) {
                const winRate = perf.winRate / 100;
                const pnlFactor = Math.tanh((perf.totalProfit || 0) / 50);
                weight = 0.5 + winRate * 0.75 + pnlFactor * 0.25;
                weight = Math.max(0.2, Math.min(2.0, weight));
            }
        }
        newVotes[robot.id] = { ...voteResult, weight };
        if (voteResult.vote !== 'HOLD') {
            const tradeId = `vt_${Date.now()}_${tradeCounterRef.current++}`;
            const exitEpoch = currentTick.epoch + durationToSeconds(voteResult.optimalDuration, voteResult.optimalDurationUnit);
            virtualTradesRef.current.push({
                id: tradeId,
                robotId: robot.id,
                vote: voteResult.vote,
                entryPrice: currentTick.price,
                entryEpoch: currentTick.epoch,
                exitEpoch: exitEpoch,
            });
        }
    });

    setCouncilVotes(newVotes);
    const { rise: riseSum, fall: fallSum } = Object.values(newVotes).reduce((acc, v) => {
      if (v.vote === 'RISE') acc.rise += v.confidence * v.weight;
      if (v.vote === 'FALL') acc.fall += v.confidence * v.weight;
      return acc;
    }, { rise: 0, fall: 0 });
    setConsensusSum({ rise: riseSum, fall: fallSum });
    
    let decision: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
    if(riseSum > fallSum && riseSum > 0) {
      decision = 'RISE';
    } else if (fallSum > riseSum && fallSum > 0) {
      decision = 'FALL';
    }
    setConsensusDecision(decision);

    if (councilExecutionRef.current.isExecuting) return;

    const dailyPnl = operationsLog.filter(op => new Date(op.timestamp).toDateString() === new Date().toDateString() && op.initiator === 'Conselho').reduce((sum, op) => sum + (op.result || 0), 0);
    const supervisionDecision = supervisionCommitteeCheck(newVotes, currentIndicators, dailyPnl);
    setSupervisionStatus(supervisionDecision);

    if (supervisionDecision.status === 'approved') {
        councilExecutionRef.current.isExecuting = true;
        const dir = riseSum > fallSum ? 'RISE' : 'FALL';
        const { finalStake, finalDuration, finalDurationUnit } = supervisionDecision;
        
        toast({ title: 'Ordem do Conselho', description: `Executando ${dir} com stake de $${finalStake}.` });
        
        executeTrade(
            dir === 'RISE' ? 'CALL' : 'PUT', 
            finalStake, 
            activeSymbol!, 
            dir.toLowerCase() as 'rise' | 'fall', 
            finalDuration, 
            finalDurationUnit, 
            'Conselho'
        ).finally(() => setTimeout(() => councilExecutionRef.current.isExecuting = false, 10000));
    }
    setActiveCommittee(committeeOfSpecialists(currentIndicators));
    
  }, [
      priceTicks, isConnected, isCouncilAutopilotOn, strategyCouncil, robotPerformance, 
      isMeritocracyOn, activeSymbol, operationsLog, supervisionCommitteeCheck, toast, executeTrade, 
      timePeriod, committeeOfSpecialists, user, evolveTrigger, tickCandles, baseDuration, form
  ]);

  return {
    isCouncilAutopilotOn, setIsCouncilAutopilotOn, strategyCouncil, fetchStrategyCouncil, dissolveCouncil, isFetchingCouncil, councilVotes, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, consensusThreshold, setConsensusThreshold, isDynamicConsensusOn, setIsDynamicConsensusOn, isDynamicRiskOn, setIsDynamicRiskOn, isMeritocracyOn, setIsMeritocracyOn, isInversionModeOn, setIsInversionModeOn, isStopLossOn, setIsStopLossOn, indicators, activeCommittee, supervisionStatus, consensusSum, consensusDecision, robotPerformance, evolutionHistory
  };
}
