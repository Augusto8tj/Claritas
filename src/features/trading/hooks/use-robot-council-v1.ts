// /src/features/trading/hooks/use-robot-council-v1.ts
'use client';

/**
 * @fileoverview Cérebro da Mesa Operacional V1.9 (Certificação de Elite)
 * O sistema agora certifica robôs para operar com capital real, baseado em performance.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiV1 } from './use-deriv-api-v1';
import { useToast } from '@/hooks/use-toast';
import type { RobotStrategy, ChartData, TickData, CandleData, DurationUnit, RobotVote as RobotVoteType, CouncilVotes, RobotPerformance as RobotPerformanceType, Operation, TradeDecisionLog, VirtualTradeLog, AssetProfileV1, TradeHistoryEvent } from '@/lib/types';
import type { RiseFallFormValues } from '@/features/trading/components/deriv-trader/deriv-trader-interface-v1.types';
import { useFormContext } from 'react-hook-form';
import type { Indicators } from '@/features/trading/services/indicator-service';
import { calculateAllIndicators } from '@/features/trading/services/indicator-service';
import { initialCouncilStrategies } from '@/features/trading/services/council-strategies';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useStrategyEvolutionV1 } from './use-strategy-evolution-v1';
import { errorEmitter, FirestorePermissionError } from '@/firebase';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { saveRobotPerformance, loadRobotPerformance, saveTradeDecision, loadAssetProfileV1, saveAssetProfileV1, getHallOfFameRobots } from '@/services/financial-data-service';


// --- TIPAGEM E TIPOS DE DADOS ---
export type RobotVote = RobotVoteType;
export type RobotPerformance = RobotPerformanceType;
type MarketRegimeV1 = 'TRENDING' | 'RANGING';


// --- CRITÉRIOS DE PROMOÇÃO (NOVO) ---
const PROMOTION_THRESHOLD_WINS = 3;
const PROMOTION_THRESHOLD_PROFIT = 4; // Em USD
const PROMOTION_THRESHOLD_SHARPE = 0.62;


// Representa uma operação simulada (paper trade) na Arena Virtual.
type VirtualTrade = {
    id: string;
    robotId: string;
    vote: 'RISE' | 'FALL';
    entryPrice: number;
    entryEpoch: number;
    exitEpoch: number; 
    regime: MarketRegimeV1;
};

const VIRTUAL_STAKE = 1.0; 
const FIRESTORE_SAVE_INTERVAL_MS = 10000; // 10 segundos

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

/**
 * Calcula o Sharpe Ratio a partir de um histórico de PnL.
 * Uma medida de retorno ajustado ao risco.
 */
const calculateSharpeRatio = (pnlHistory: { profit: number }[]): number => {
    if (pnlHistory.length < 10) return 0; // Not enough data
    const profits = pnlHistory.map(t => t.profit);
    const mean = profits.reduce((a, b) => a + b, 0) / profits.length;
    const stdDev = Math.sqrt(profits.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / profits.length);
    if (stdDev === 0) return mean > 0 ? 99 : -99; // Infinite return, but capped
    return mean / stdDev;
};


/**
 * Detecta o regime de mercado de forma simplificada usando ADX.
 */
const detectMarketRegime = (indicators: Indicators | null): MarketRegimeV1 => {
    if (indicators && indicators.adx && indicators.adx > 25) {
        return 'TRENDING';
    }
    return 'RANGING';
};

const formatValue = (value: number | null | undefined, precision = 4) => {
    if (value === null || value === undefined || isNaN(value)) return '...';
    return value.toFixed(precision);
};


const calculateRobotVote = (
    robot: RobotStrategy,
    indicators: Indicators,
    tickCandles: CandleData[],
): Omit<RobotVote, 'weight'> => {
    
    let vote: RobotVote['vote'] = 'HOLD';
    let confidence = 0;
    let reason = 'Aguardando sinal...';
    let suggestedStake = 0;
    const { optimalDuration, optimalDurationUnit, suggestedStake: baseStake } = robot;

    const setVote = (newVote: 'RISE' | 'FALL', newConfidence: number, newReason: string) => {
        vote = newVote;
        confidence = newConfidence;
        reason = newReason;
        if (confidence === robot.strongConfidence) {
            suggestedStake = baseStake; 
        } else if (confidence === robot.weakConfidence) {
            suggestedStake = baseStake * 0.5; 
        }
    };

    if (!indicators) return { vote: 'HOLD', confidence: 0, optimalDuration, optimalDurationUnit, suggestedStake: 0, reason: '' };
    
    if (robot.strategyType === 'RSI' && isValid(indicators.rsi)) {
        if (indicators.rsi! <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `RSI(${indicators.rsi!.toFixed(1)}) < ${robot.weakBuyThreshold}`);
        if (indicators.rsi! <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `RSI(${indicators.rsi!.toFixed(1)}) < ${robot.strongBuyThreshold}`);
        if (indicators.rsi! >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `RSI(${indicators.rsi!.toFixed(1)}) > ${robot.weakSellThreshold}`);
        if (indicators.rsi! >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `RSI(${indicators.rsi!.toFixed(1)}) > ${robot.strongSellThreshold}`);
    }
    
    if (robot.strategyType === 'STOCHASTIC' && isValid(indicators.stoch)) {
        if (indicators.stoch! <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `Stoch(${indicators.stoch!.toFixed(1)}) < ${robot.weakBuyThreshold}`);
        if (indicators.stoch! <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `Stoch(${indicators.stoch!.toFixed(1)}) < ${robot.strongBuyThreshold}`);
        if (indicators.stoch! >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `Stoch(${indicators.stoch!.toFixed(1)}) > ${robot.weakSellThreshold}`);
        if (indicators.stoch! >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `Stoch(${indicators.stoch!.toFixed(1)}) > ${robot.strongSellThreshold}`);
    }
    
    if (robot.strategyType === 'STOCH_RSI' && isValid(indicators.stochRSI)) {
        if (indicators.stochRSI! <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `StochRSI(${indicators.stochRSI!.toFixed(2)}) em sobrevenda extrema`);
        else if (indicators.stochRSI! <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `StochRSI(${indicators.stochRSI!.toFixed(2)}) em sobrevenda`);
        if (indicators.stochRSI! >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `StochRSI(${indicators.stochRSI!.toFixed(2)}) em sobrecompra extrema`);
        else if (indicators.stochRSI! >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `StochRSI(${indicators.stochRSI!.toFixed(2)}) em sobrecompra`);
    }

    if (robot.strategyType === 'Z_SCORE' && isValid(indicators.zScore)) {
        if (indicators.zScore! <= -(robot.zScoreThreshold || 2.0)) setVote('RISE', robot.strongConfidence, `Z-Score (${indicators.zScore!.toFixed(2)}) indica reversão à média`);
        if (indicators.zScore! >= (robot.zScoreThreshold || 2.0)) setVote('FALL', robot.strongConfidence, `Z-Score (${indicators.zScore!.toFixed(2)}) indica reversão à média`);
    }

    if (robot.strategyType === 'MOVING_AVERAGE_CROSS' && isValid(indicators.ma.short) && isValid(indicators.ma.long)) {
        if (indicators.ma.short! > indicators.ma.long!) setVote('RISE', robot.weakConfidence, "Cruzamento de Alta");
        if (indicators.ma.long! > indicators.ma.short!) setVote('FALL', robot.weakConfidence, "Cruzamento de Baixa");
    }

    if (robot.strategyType === 'MACD_CROSS' && isValid(indicators.macd.macd) && isValid(indicators.macd.signal)) {
       if (indicators.macd.macd! > indicators.macd.signal!) setVote('RISE', robot.weakConfidence, "MACD > Sinal");
       if (indicators.macd.signal! > indicators.macd.macd!) setVote('FALL', robot.weakConfidence, "Sinal > MACD");
    }
    
    if (robot.strategyType === 'BOLLINGER_BANDS' && indicators.bollingerBands?.length && tickCandles.length) {
        const lastBand = indicators.bollingerBands[indicators.bollingerBands.length - 1];
        const lastPrice = tickCandles[tickCandles.length - 1].close;
        if (lastBand && isValid(lastBand.lower) && isValid(lastBand.upper) && isValid(lastPrice)) {
            if (lastPrice <= lastBand.lower) setVote('RISE', robot.strongConfidence, "Toque na Banda Inferior");
            if (lastPrice >= lastBand.upper) setVote('FALL', robot.strongConfidence, "Toque na Banda Superior");
        }
    }

    if (robot.strategyType === 'ADX_TREND' && isValid(indicators.adx)) {
        if (indicators.adx! > (robot.trendStrengthThreshold || 25)) {
            if (isValid(indicators.pdi) && isValid(indicators.ndi)) {
                if (indicators.pdi! > indicators.ndi!) setVote('RISE', robot.strongConfidence, `ADX(${indicators.adx!.toFixed(0)}) Tendência Alta`);
                if (indicators.ndi! > indicators.pdi!) setVote('FALL', robot.strongConfidence, `ADX(${indicators.adx!.toFixed(0)}) Tendência Baixa`);
            }
        }
    }

    return { vote, confidence, optimalDuration, optimalDurationUnit, suggestedStake, reason };
};


export function useRobotCouncilV1(activeSymbol: string | null, priceTicks: TickData[], chartData: ChartData[]) {
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits, sellContract } = useDerivApiV1();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const form = useFormContext<RiseFallFormValues>();
  const { evolvedStrategies, evolveTrigger, evolutionHistory, resetEvolutionHistoryForAsset } = useStrategyEvolutionV1(activeSymbol);
  
  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>([]);
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isAuditingOn, setIsAuditingOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
  const [councilVotes, setCouncilVotes] = useState<CouncilVotes>({});
  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusThreshold, setConsensusThreshold] = useState(300);
  const [isDynamicConsensusOn, setIsDynamicConsensusOn] = useState(true);
  const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true);
  const [isMeritocracyOn, setIsMeritocracyOn] = useState(true);
  const [isStopLossOn, setIsStopLossOn] = useState(true);
  const [isInversionModeOn, setIsInversionModeOn] = useState(false);
  const [robotPerformance, setRobotPerformance] = useState<RobotPerformance[]>([]);
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  const tradeCounterRef = useRef(0);
  const [indicators, setIndicators] = useState<Indicators | null>(null);
  const [activeCommittee, setActiveCommittee] = useState<string | null>(null);
  const [supervisionStatus, setSupervisionStatus] = useState<{ status: 'inactive' | 'approved' | 'veto'; message: string; analysis?: string }>({ status: 'inactive', message: 'Aguardando consenso.' });
  const [consensusSum, setConsensusSum] = useState({ rise: 0, fall: 0 });
  const [consensusDecision, setConsensusDecision] = useState<'RISE' | 'FALL' | 'HOLD'>('HOLD');
  const councilExecutionRef = useRef({ isExecuting: false, sellingContracts: new Set<number>() });
  const [tradeDecisionLog, setTradeDecisionLog] = useState<TradeDecisionLog[]>([]);
  const hasPendingChangesRef = useRef(false);
  const [hallOfFameStatus, setHallOfFameStatus] = useState<string>('Aguardando...');
  
  const robotPerformanceRef = useRef<RobotPerformance[]>(robotPerformance);
  useEffect(() => {
    robotPerformanceRef.current = robotPerformance;
  }, [robotPerformance]);


  // --- ASSET PROFILE STATES ---
  const [assetProfile, setAssetProfile] = useState<AssetProfileV1 | null>(null);
  const [isAssetProfileLoading, setIsAssetProfileLoading] = useState(false);

  useEffect(() => {
    const councilWithIds = evolvedStrategies.map((strat, index) => ({
      ...strat,
      id: `${strat.strategyType}_BOT_${index + 1}`
    })) as RobotStrategy[];
    setStrategyCouncil(councilWithIds);
  }, [evolvedStrategies]);
  
  // --- LOADERS ---
  useEffect(() => {
    if (!user || isAuthLoading) return;
    
    loadRobotPerformance(user.uid, 'v1')
      .then(storedPerformance => {
        if (storedPerformance) {
            const perfWithHistory = storedPerformance.map(p => ({ ...p, tradeHistory: p.tradeHistory || [], status: p.status || 'Probation' }));
            setRobotPerformance(perfWithHistory as RobotPerformance[]);
        }
      })
      .catch(error => {
        const permissionError = new FirestorePermissionError({
            path: `users/${user.uid}/performance_v1/robot_council`,
            operation: 'get',
        });
        errorEmitter.emit('permission-error', permissionError);
      });
  }, [user, isAuthLoading]);

  useEffect(() => {
      if (!user || !activeSymbol) return;
      setIsAssetProfileLoading(true);
      loadAssetProfileV1(user.uid, activeSymbol).then(profile => {
          setAssetProfile(profile);
          setIsAssetProfileLoading(false);
          if (profile?.optimalConsensusThreshold) {
            setConsensusThreshold(profile.optimalConsensusThreshold);
          }
      });
  }, [user, activeSymbol]);

  const resetArenaPerformance = useCallback(() => {
    if (strategyCouncil.length === 0) return;
    toast({ title: "Arena Reset", description: `Performance para ${activeSymbol} reiniciada.` });
    const initialPerformance: RobotPerformance[] = strategyCouncil.map(robot => ({
      id: robot.id,
      strategyType: robot.strategyType,
      strategy: robot,
      wins: 0,
      losses: 0,
      totalProfit: 0,
      winRate: 0,
      sharpeRatio: 0,
      tradeHistory: [],
      status: 'Probation',
    }));
    setRobotPerformance(initialPerformance);
    virtualTradesRef.current = [];
    if (user) {
        saveRobotPerformance(user.uid, initialPerformance, 'v1');
    }
  }, [strategyCouncil, activeSymbol, toast, user]);

  const dissolveCouncil = useCallback(() => {
    if (hasPendingChangesRef.current && user) {
        saveRobotPerformance(user.uid, robotPerformanceRef.current, 'v1');
        hasPendingChangesRef.current = false;
    }
    setStrategyCouncil([]);
    setCouncilVotes({});
    setIsCouncilAutopilotOn(false);
    virtualTradesRef.current = [];
  }, [user]);

  // Salva periodicamente quaisquer alterações pendentes no desempenho
  useEffect(() => {
    if (!isCouncilAutopilotOn) return;
    
    const saveInterval = setInterval(() => {
        if(hasPendingChangesRef.current && user) {
            saveRobotPerformance(user.uid, robotPerformanceRef.current, 'v1');
            hasPendingChangesRef.current = false;
        }
    }, FIRESTORE_SAVE_INTERVAL_MS);

    return () => clearInterval(saveInterval);
  }, [isCouncilAutopilotOn, user]);

  // Salva quaisquer alterações pendentes ao desmontar o componente
  useEffect(() => {
    return () => {
        if (hasPendingChangesRef.current && user) {
            saveRobotPerformance(user.uid, robotPerformanceRef.current, 'v1');
        }
    };
  }, [user]);
  
  useEffect(() => {
    if (isCouncilAutopilotOn) resetArenaPerformance();
  }, [activeSymbol, isCouncilAutopilotOn, resetArenaPerformance]);

  const fetchStrategyCouncil = useCallback(async () => {
    if (!activeSymbol || !user) {
      toast({ variant: 'destructive', title: !user ? 'Não Autenticado' : 'Nenhum Ativo', description: !user ? 'Faça login.' : 'Selecione um ativo.' });
      return;
    }
    setIsFetchingCouncil(true);
    try {
        virtualTradesRef.current = [];
        tradeCounterRef.current = 0;
        await new Promise(r => setTimeout(r, 500));
        setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
        if (robotPerformance.length === 0) {
          const initialPerformance = (evolvedStrategies as RobotStrategy[]).map(robot => ({ id: robot.id, strategyType: robot.strategyType, strategy: robot, wins: 0, losses: 0, totalProfit: 0, winRate: 0, sharpeRatio: 0, tradeHistory: [], status: 'Probation' }));
          setRobotPerformance(initialPerformance);
          await saveRobotPerformance(user.uid, initialPerformance, 'v1');
        }
        toast({ title: 'Mesa Operacional V1 Ativada', description: `${evolvedStrategies.length} robôs prontos para análise.` });
        setIsCouncilAutopilotOn(true);
    } catch (error) {
        console.error("Error fetching strategy council:", error);
        toast({ title: "Erro ao ativar a mesa", description: "Não foi possível iniciar a mesa operacional.", variant: "destructive"});
    } finally {
        setIsFetchingCouncil(false);
    }
  }, [activeSymbol, user, toast, evolvedStrategies, robotPerformance.length]);


  const analyzeAndSaveLearnings = useCallback(async (userNotes: string) => {
    if (!user || !activeSymbol || robotPerformance.length === 0) {
        toast({ title: 'Dados Insuficientes', description: 'Nenhum dado de desempenho para analisar.', variant: 'destructive' });
        return;
    }

    setIsAssetProfileLoading(true);

    const trendBots = robotPerformance.filter(p => ['ADX_TREND', 'MOVING_AVERAGE_CROSS'].includes(p.strategyType));
    const rangeBots = robotPerformance.filter(p => ['RSI', 'BOLLINGER_BANDS'].includes(p.strategyType));

    const trendProfit = trendBots.reduce((sum, p) => sum + (p.totalProfit || 0), 0);
    const rangeProfit = rangeBots.reduce((sum, p) => sum + (p.totalProfit || 0), 0);

    let preferredRegime: 'TRENDING' | 'RANGING' | 'NEUTRAL' = 'NEUTRAL';
    let aiNotes = "Análise da sessão: ";

    if (trendProfit > rangeProfit * 1.2) {
        preferredRegime = 'TRENDING';
        aiNotes += "Estratégias de tendência superaram as de lateralidade. O ativo mostra comportamento direcional."
    } else if (rangeProfit > trendProfit * 1.2) {
        preferredRegime = 'RANGING';
        aiNotes += "Estratégias de reversão à média foram mais lucrativas. O ativo mostra comportamento lateral."
    } else {
        aiNotes += "Nenhum regime dominante claro foi identificado nesta sessão."
    }

    let combinedNotes = aiNotes;
    if (userNotes && userNotes.trim().length > 0) {
        combinedNotes = `Insight do Operador: "${userNotes.trim()}"\n\n---\n\n${aiNotes}`;
    }
    
    const finalConsensusThreshold = isDynamicConsensusOn ? consensusThreshold : assetProfile?.optimalConsensusThreshold || consensusThreshold;

    const newProfile: AssetProfileV1 = {
        id: activeSymbol,
        assetSymbol: activeSymbol,
        lastAnalyzed: new Date().toISOString(),
        preferredRegime,
        optimalConsensusThreshold: finalConsensusThreshold,
        notes: combinedNotes,
    };
    
    await saveAssetProfileV1(user.uid, newProfile);
    setAssetProfile(newProfile);
    setIsAssetProfileLoading(false);
    toast({ title: 'Aprendizado Salvo!', description: `Perfil estratégico para ${activeSymbol} foi atualizado.` });

  }, [user, activeSymbol, robotPerformance, consensusThreshold, isDynamicConsensusOn, toast, assetProfile]);
  
  const tickCandles = useMemo(() => {
      const source = chartData.length > 0 ? chartData : priceTicks;
      if (source.length === 0) return [];
      return source.map((t) => ({ epoch: t.epoch, open: getPrice(t)!, high: getPrice(t)!, low: getPrice(t)!, close: getPrice(t)!, volume: 1 }));
  }, [chartData, priceTicks]);

  useEffect(() => {
    if (!isConnected || !user || !isCouncilAutopilotOn || !durationLimits || strategyCouncil.length === 0 || !activeSymbol || tickCandles.length < 2) return;

    if (councilExecutionRef.current.isExecuting) return; 
    councilExecutionRef.current.isExecuting = true;

    const currentTick = priceTicks[priceTicks.length - 1];
    if (!currentTick) {
        councilExecutionRef.current.isExecuting = false;
        return;
    };

    const currentIndicators = calculateAllIndicators(tickCandles, strategyCouncil, timePeriod, { duration: 5, unit: 'm' });
    setIndicators(currentIndicators);
    if (!currentIndicators) {
        councilExecutionRef.current.isExecuting = false;
        return;
    };

    const performanceMap = new Map(robotPerformance.map(p => [p.id, { ...p, tradeHistory: p.tradeHistory || [], status: p.status || 'Probation' }]));
    let performanceChanged = false;
    
    const currentRegime = detectMarketRegime(currentIndicators);

    // --- Processamento da Arena Virtual ---
    virtualTradesRef.current = virtualTradesRef.current.filter(trade => {
        if(currentTick.epoch >= trade.exitEpoch) {
            const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;
            const perf = performanceMap.get(trade.robotId);
            if (perf) {
                const isWin = (trade.vote === 'RISE' && exitTick.price > trade.entryPrice) || (trade.vote === 'FALL' && exitTick.price < trade.entryPrice);
                const pnl = isWin ? VIRTUAL_STAKE * 0.95 : -VIRTUAL_STAKE;

                perf.wins = (perf.wins || 0) + (isWin ? 1 : 0);
                perf.losses = (perf.losses || 0) + (isWin ? 0 : 1);
                perf.totalProfit = (perf.totalProfit || 0) + pnl;
                
                const newTradeHistory = [...(perf.tradeHistory || []), { profit: pnl, regime: trade.regime, timestamp: Date.now() }];
                perf.tradeHistory = newTradeHistory;
                perf.winRate = (perf.wins + perf.losses) > 0 ? (perf.wins / (perf.wins + perf.losses)) * 100 : 0;
                perf.sharpeRatio = calculateSharpeRatio(newTradeHistory as { profit: number }[]);
                performanceChanged = true;
            }
            return false;
        }
        return true;
    });

    if (performanceChanged) {
        // --- Lógica de Promoção ---
        performanceMap.forEach(perf => {
            const meetsCriteria =
                (perf.wins || 0) >= PROMOTION_THRESHOLD_WINS &&
                (perf.totalProfit || 0) > PROMOTION_THRESHOLD_PROFIT &&
                (perf.sharpeRatio || 0) > PROMOTION_THRESHOLD_SHARPE;

            const newStatus = meetsCriteria ? 'Certified' : 'Probation';
            if ((perf.status || 'Probation') !== newStatus) {
                perf.status = newStatus;
                toast({ title: 'Status de Robô Alterado!', description: `Robô ${perf.strategyType} agora está: ${newStatus}` });
            }
        });
        
        const updatedPerformance = Array.from(performanceMap.values());
        setRobotPerformance(updatedPerformance);
        hasPendingChangesRef.current = true;
        evolveTrigger(updatedPerformance);
    }
    
    // --- Lógica de Votação e Consenso ---
    const newVirtualTradesForLog: VirtualTradeLog[] = [];
    setActiveCommittee(currentRegime);

    const newVotes: CouncilVotes = {};
    let riseSum = 0, fallSum = 0;
    
    let eliteRiseSum = 0, eliteFallSum = 0;
    const certifiedRobots = robotPerformance.filter(p => p.status === 'Certified');
    
    strategyCouncil.forEach(robot => {
        const voteResult = calculateRobotVote(robot, currentIndicators, tickCandles);
        let confidence = voteResult.confidence;
        let reason = voteResult.reason;
        
        const trendStrategies: RobotStrategy['strategyType'][] = ['MOVING_AVERAGE_CROSS', 'ADX_TREND', 'MACD_CROSS', 'PARABOLIC_SAR', 'ICHIMOKU_CLOUD', 'TRIX'];
        const rangeStrategies: RobotStrategy['strategyType'][] = ['RSI', 'STOCHASTIC', 'BOLLINGER_BANDS', 'Z_SCORE', 'STOCH_RSI', 'MFI'];
        
        const isTrendBot = trendStrategies.includes(robot.strategyType);
        const isRangeBot = rangeStrategies.includes(robot.strategyType);

        if (currentRegime === 'TRENDING' && isRangeBot) {
            confidence *= 0.5; 
            reason += ' (Regime de Tendência Inadequado)';
        } else if (currentRegime === 'RANGING' && isTrendBot) {
            confidence *= 0.5;
            reason += ' (Regime Lateral Inadequado)';
        } else {
            confidence *= 1.2;
            reason += ' (Regime Adequado)';
        }
        confidence = Math.min(100, Math.max(0, confidence));

        let weight = 1.0;
        const perf = performanceMap.get(robot.id);
        if (isMeritocracyOn) {
            if (perf?.sharpeRatio) {
                weight = Math.exp((perf.sharpeRatio || 0) * 0.5); 
                weight = Math.max(0.1, Math.min(3.0, weight));
            } else {
                weight = 0.2;
            }
        }
        newVotes[robot.id] = { ...voteResult, confidence, reason, weight };
        
        if (voteResult.vote === 'RISE') riseSum += confidence * weight;
        if (voteResult.vote === 'FALL') fallSum += confidence * weight;
        
        if (certifiedRobots.some(r => r.id === robot.id)) {
            if (voteResult.vote === 'RISE') eliteRiseSum += confidence * weight;
            if (voteResult.vote === 'FALL') fallSum += confidence * weight;
        }

        if(voteResult.vote !== 'HOLD' && confidence > 50) {
             const exitEpoch = currentTick.epoch + durationToSeconds(voteResult.optimalDuration, voteResult.optimalDurationUnit);
             const newVTrade: VirtualTrade = {
                id: `vt_${Date.now()}_${tradeCounterRef.current++}`, robotId: robot.id, vote: voteResult.vote,
                entryPrice: currentTick.price, entryEpoch: currentTick.epoch, exitEpoch: exitEpoch, regime: currentRegime
            };
             virtualTradesRef.current.push(newVTrade);
             newVirtualTradesForLog.push({
                robotId: robot.id,
                robotType: robot.strategyType,
                vote: voteResult.vote,
                entryPrice: newVTrade.entryPrice,
                entryEpoch: newVTrade.entryEpoch,
                exitEpoch: newVTrade.exitEpoch
            });
        }
    });
    setCouncilVotes(newVotes);
    setConsensusSum({ rise: riseSum, fall: fallSum });

    // --- NOVO: Lógica de Limiar de Consenso Dinâmico ---
    if (isDynamicConsensusOn) {
        const activeVotersCount = Object.values(newVotes).filter(v => v.vote !== 'HOLD').length;

        // Base é proporcional aos bots ativos, visando 30% do potencial máximo.
        const participationBasedThreshold = (activeVotersCount * 100) * 0.3;

        // Ajuste por volatilidade. Mais volátil = mais cautela (limiar maior).
        let volatilityMultiplier = 1.0;
        const bbw = currentIndicators.bbw;
        if (isValid(bbw)) {
            if (bbw > 0.09) { // Alta volatilidade
                volatilityMultiplier = 1.25;
            } else if (bbw < 0.03) { // Baixa volatilidade (squeeze)
                volatilityMultiplier = 0.8;
            }
        }
        
        let newThreshold = participationBasedThreshold * volatilityMultiplier;

        // Limita o valor a um intervalo razoável.
        newThreshold = Math.max(100, Math.min(newThreshold, 800));

        setConsensusThreshold(Math.round(newThreshold));
    }
    
    let decision: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
    let decisionSource = 'Probation';

    if (eliteRiseSum > eliteFallSum && eliteRiseSum > consensusThreshold) {
      decision = 'RISE';
      decisionSource = 'Elite';
    } else if (eliteFallSum > eliteRiseSum && eliteFallSum > consensusThreshold) {
      decision = 'FALL';
      decisionSource = 'Elite';
    } else {
        // NOVO: Consulta ao Hall da Fama se a elite está indecisa
        setHallOfFameStatus('Consultando Lendas...');
        getHallOfFameRobots(user.uid).then(fameRobots => {
            let fameRise = 0, fameFall = 0;
            fameRobots.forEach(fameBot => {
                const vote = calculateRobotVote(fameBot.strategy, currentIndicators, tickCandles);
                if (vote.vote === 'RISE') fameRise += vote.confidence;
                if (vote.vote === 'FALL') fameFall += vote.confidence;
            });
            if (fameRise > fameFall && fameRise > 150) { // Limiar alto para a elite
                setConsensusDecision('RISE');
                setHallOfFameStatus('Confirmação de Alta');
            } else if (fameFall > fameRise && fameFall > 150) {
                setConsensusDecision('FALL');
                setHallOfFameStatus('Confirmação de Baixa');
            } else {
                setHallOfFameStatus('Decisão Dividida');
            }
        });
    }

    setConsensusDecision(decision);

    const dailyPnl = operationsLog.filter(op => new Date(op.timestamp).toDateString() === new Date().toDateString() && op.initiator === 'Conselho').reduce((sum, op) => sum + (op.result || 0), 0);
    
    if (dailyPnl <= -dailyBalance) {
        setSupervisionStatus({ status: 'veto', message: 'Stop Loss Diário Atingido.' });
        dissolveCouncil();
        toast({ title: "🛡️ Stop Loss Atingido", description: `A mesa foi desativada para proteger seu capital de $${dailyBalance}.`, variant: "destructive"});
        councilExecutionRef.current.isExecuting = false;
        return;
    }
    if (dailyPnl >= dailyTarget) {
        setSupervisionStatus({ status: 'veto', message: 'Meta Diária Atingida.' });
        dissolveCouncil();
        toast({ title: "🏆 Meta Diária Atingida!", description: `Parabéns! Você alcançou seu lucro de $${dailyTarget}. A mesa foi desativada por hoje.` });
        councilExecutionRef.current.isExecuting = false;
        return;
    }
    if (decision === 'HOLD') {
      const sum = decisionSource === 'Elite' ? { rise: eliteRiseSum, fall: eliteFallSum } : consensusSum;
      setSupervisionStatus({ status: 'inactive', message: `Aguardando consenso > ${consensusThreshold}.`, analysis: `${decisionSource} RISE: ${sum.rise.toFixed(0)} | FALL: ${sum.fall.toFixed(0)}` });
    }
    
    const last5Ticks = priceTicks.slice(-5);
    if(last5Ticks.length === 5) {
        const microMove = last5Ticks[4].price - last5Ticks[0].price;
        if ((decision === 'RISE' && microMove < 0) || (decision === 'FALL' && microMove > 0)) {
             setSupervisionStatus({ status: 'veto', message: `Veto: Micro-movimento contrário.` });
             councilExecutionRef.current.isExecuting = false;
             return;
        }
    }
    
    const sumForKelly = decisionSource === 'Elite' ? { rise: eliteRiseSum, fall: eliteFallSum } : consensusSum;
    const p = (decision === 'RISE' ? sumForKelly.rise : sumForKelly.fall) / (sumForKelly.rise + sumForKelly.fall || 1);
    const kellyFraction = (p * 0.94 - (1 - p)) / 0.94;
    let stake = Math.max(0.35, Math.min(dailyBalance * 0.05, dailyBalance * kellyFraction * 0.25));

    if (decision !== 'HOLD' && stake < 0.35) {
        setSupervisionStatus({ status: 'inactive', message: 'Stake de Kelly abaixo do mínimo.', analysis: `Stake calculado $${stake.toFixed(2)}.`});
    } else if(decision !== 'HOLD') {
        setSupervisionStatus({ status: 'approved', message: `Aprovado para execução.`, analysis: `Kelly Stake: $${stake.toFixed(2)}.` });
    }
    
    const finalDecision = supervisionStatus.status === 'approved' ? decision : 'HOLD';

    let finalDuration = 0;
    let finalUnit: DurationUnit = 's';
    
    if (finalDecision !== 'HOLD') {
        const votingRobots = Object.values(newVotes).filter(v => v.vote === finalDecision);
        const totalWeight = votingRobots.reduce((sum, v) => sum + v.weight, 0);

        if (totalWeight > 0) {
            const baseDurationInSeconds = votingRobots.reduce((sum, v) => sum + durationToSeconds(v.optimalDuration, v.optimalDurationUnit) * v.weight, 0) / totalWeight;

            let volatilityFactor = 1.0;
            const bbw = currentIndicators.bbw;
            if (isValid(bbw)) {
                if (bbw > 0.08) {
                    volatilityFactor = 0.7; 
                    setSupervisionStatus(prev => ({ ...prev, analysis: (prev.analysis || '') + ' | Duração Reduzida (Alta Volatilidade).' }));
                } else if (bbw < 0.02) {
                    volatilityFactor = 1.5;
                    setSupervisionStatus(prev => ({ ...prev, analysis: (prev.analysis || '') + ' | Duração Aumentada (Baixa Volatilidade).' }));
                }
            }
            
            const adjustedDuration = baseDurationInSeconds * volatilityFactor;

            // --- LÓGICA DE DURAÇÃO ROBUSTA ---
            const defaultDuration = 15;
            const defaultUnit: DurationUnit = 's';

            if (durationLimits) {
                const canUseTicks = durationLimits.t && durationLimits.t.min > 0;
                const canUseSeconds = durationLimits.s && durationLimits.s.min > 0;

                if (canUseTicks && adjustedDuration <= (durationLimits.t.max * 2)) {
                    finalUnit = 't';
                    const durationInTicks = Math.round(adjustedDuration / 2);
                    finalDuration = Math.max(durationLimits.t.min, Math.min(durationInTicks, durationLimits.t.max));
                } 
                else if (canUseSeconds) {
                    finalUnit = 's';
                    finalDuration = Math.round(adjustedDuration);
                    finalDuration = Math.max(durationLimits.s.min, Math.min(finalDuration, durationLimits.s.max));
                }
                else if (canUseTicks) { // Fallback para ticks se for a única opção
                    finalUnit = 't';
                    const durationInTicks = Math.round(adjustedDuration / 2);
                    finalDuration = Math.max(durationLimits.t.min, Math.min(durationInTicks, durationLimits.t.max));
                }
                else {
                    console.warn(`[Council V1] Nenhuma unidade de duração suportada. Usando fallback: ${defaultDuration}${defaultUnit}.`);
                    finalUnit = defaultUnit;
                    finalDuration = defaultDuration;
                }
            } else {
                 console.warn(`[Council V1] Limites de duração não disponíveis. Usando fallback: ${defaultDuration}${defaultUnit}.`);
                finalUnit = defaultUnit;
                finalDuration = defaultDuration;
            }
            // --- FIM DA LÓGICA DE DURAÇÃO ---

        } else {
            finalDuration = durationLimits?.s?.min || 15;
            finalUnit = 's';
        }
    }
    
    const tradeExecution = () => {
        const sanitizedStake = parseFloat(stake.toFixed(2));
        const finalContractType = finalDecision === 'RISE' ? 'CALL' : 'PUT';

        executeTrade(
            finalContractType,
            sanitizedStake,
            activeSymbol!,
            finalDecision.toLowerCase() as 'rise' | 'fall',
            finalDuration,
            finalUnit,
            'Conselho'
        ).then(tradeResult => {
            const logResultStatus = tradeResult.success ? 'pending' : 'hold';
            const logMessage = tradeResult.success ? supervisionStatus.message : `Falha na execução: ${tradeResult.message}`;

            if (isAuditingOn && user) {
                const logId = `log-${Date.now()}`;
                const log: TradeDecisionLog = {
                    id: logId,
                    contractId: tradeResult.contractId,
                    timestamp: new Date().toISOString(),
                    asset: activeSymbol!,
                    timePeriod,
                    tradeParams: { direction: finalDecision, stake: sanitizedStake, duration: finalDuration, durationUnit: finalUnit },
                    context: { 
                        marketRegime: currentRegime, regimeConfidence: 1.0, microstructure: null, indicators: currentIndicators,
                        supervisionReason: logMessage, payout: sanitizedStake * 0.94, entryPrice: tradeResult.entryPrice
                    },
                    consensus: { 
                        consensusSum: { rise: riseSum, fall: fallSum }, consensusThreshold, activeRobots: Object.keys(newVotes).length,
                        votes: newVotes, virtualTrades: newVirtualTradesForLog 
                    },
                    result: logResultStatus, pnl: 0,
                };
                saveTradeDecision(user.uid, log, 'v1');
                setTradeDecisionLog(prev => [log, ...prev]);
            }
        });
    };
    
    if (finalDecision !== 'HOLD' && supervisionStatus.status === 'approved' && (!isNaN(finalDuration) && finalDuration > 0)) {
        tradeExecution();
    } else if (isAuditingOn && user) {
        const shouldLogHold = (decision !== 'HOLD' && finalDecision === 'HOLD');
        if (shouldLogHold) {
            const logId = `log-${Date.now()}`;
            const holdLog: TradeDecisionLog = {
                id: logId,
                timestamp: new Date().toISOString(),
                asset: activeSymbol!,
                timePeriod,
                tradeParams: { direction: 'HOLD', stake: 0, duration: 0, durationUnit: 't' },
                context: {
                    marketRegime: currentRegime, regimeConfidence: 1.0, microstructure: null, indicators: currentIndicators,
                    supervisionReason: supervisionStatus.message, payout: 0,
                },
                consensus: {
                    consensusSum: { rise: riseSum, fall: fallSum }, consensusThreshold, activeRobots: Object.keys(newVotes).length,
                    votes: newVotes, virtualTrades: newVirtualTradesForLog
                },
                result: 'hold', pnl: 0,
            };
            saveTradeDecision(user.uid, holdLog, 'v1');
            setTradeDecisionLog(prev => [holdLog, ...prev]);
        }
    }

    councilExecutionRef.current.isExecuting = false;
  }, [
      isConnected, user, isCouncilAutopilotOn, durationLimits, strategyCouncil, robotPerformance, isMeritocracyOn, activeSymbol, operationsLog, toast, executeTrade, timePeriod, evolveTrigger, tickCandles, form, dailyBalance, dailyTarget, consensusThreshold, isDynamicConsensusOn, isAuditingOn, assetProfile, dissolveCouncil
  ]);

  return {
    isCouncilAutopilotOn,
    setIsCouncilAutopilotOn,
    strategyCouncil,
    fetchStrategyCouncil,
    dissolveCouncil,
    isFetchingCouncil,
    councilVotes,
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
    consensusThreshold,
    setConsensusThreshold,
    isDynamicConsensusOn,
    setIsDynamicConsensusOn,
    isDynamicRiskOn,
    setIsDynamicRiskOn,
    isMeritocracyOn,
    setIsMeritocracyOn,
    isStopLossOn,
    setIsStopLossOn,
    indicators,
    activeCommittee,
    supervisionStatus,
    consensusSum,
    consensusDecision,
    robotPerformance,
    evolutionHistory,
    isInversionModeOn,
    setIsInversionModeOn,
    tradeDecisionLog,
    isAuditingOn,
    setIsAuditingOn,
    resetEvolutionHistoryForAsset,
    assetProfile,
    isAssetProfileLoading,
    analyzeAndSaveLearnings,
    hallOfFameStatus, // Exposto para a UI
  };
}
