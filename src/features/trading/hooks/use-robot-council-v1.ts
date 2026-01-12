// src/features/trading/hooks/use-robot-council-v1.ts
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiV1 } from './use-deriv-api-v1';
import { useToast } from '@/hooks/use-toast';
import type { RobotStrategy, ChartData, TickData, CandleData, RiseFallFormValues, DurationUnit } from '@/lib/types';
import { useFormContext } from 'react-hook-form';
import type { Indicators } from '@/services/indicator-service-v1';
import { calculateAllIndicators } from '@/services/indicator-service-v1';
import { initialCouncilStrategies } from '@/services/council-strategies';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance } from '@/services/trading-data-service-v1';
import { useStrategyEvolutionV1 } from './use-strategy-evolution-v1';

// --- TIPAGEM E TIPOS DE DADOS ---
// Representa o voto de um único robô, incluindo sua confiança e sugestões.
export type RobotVote = {
    vote: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    weight: number;
    optimalDuration: number;
    optimalDurationUnit: DurationUnit;
    suggestedStake: number;
};
// Um mapa que armazena os votos de todos os robôs pelo seu ID.
export type CouncilVotes = { [key:string]: RobotVote };

// Armazena as métricas de desempenho de um robô na Arena Virtual.
export type RobotPerformance = {
    id: string;
    strategyType: RobotStrategy['strategyType'];
    strategy: RobotStrategy;
    wins: number;
    losses: number;
    totalProfit: number;
    winRate: number; // Adicionado para facilitar o ranking na UI
};

// Representa uma operação simulada (paper trade) na Arena Virtual.
type VirtualTrade = {
    id: string;
    robotId: string;
    vote: 'RISE' | 'FALL';
    entryPrice: number;
    entryEpoch: number;
    exitEpoch: number; // NOVO: Tempo exato de expiração, para precisão máxima.
};

// --- CONSTANTES ---
const VIRTUAL_STAKE = 1.0; // Valor fixo para cada operação virtual, para cálculo de P&L.

// --- FUNÇÕES AUXILIARES (HELPERS) ---
const isCandle = (d: ChartData): d is CandleData => d !== null && 'close' in d;
const getPrice = (d: ChartData | null): number | undefined => {
    if (!d) return undefined;
    return isCandle(d) ? d.close : d.price;
};
const isValid = (value: any): value is number => value !== null && value !== undefined && !isNaN(value);

// Converte durações de diferentes unidades para segundos, para padronizar cálculos.
const durationToSeconds = (duration: number, unit: DurationUnit): number => {
    switch (unit) {
        case 't': return duration * 2; // Estimativa: 1 tick a cada 2 segundos em média nos índices sintéticos.
        case 's': return duration;
        case 'm': return duration * 60;
        case 'h': return duration * 3600;
        case 'd': return duration * 86400;
        default: return duration;
    }
};

/**
 * Função pura que calcula o voto de um único robô com base nos indicadores.
 * Não tem estado e apenas retorna uma decisão baseada nos dados fornecidos.
 * @param robot A estratégia do robô.
 * @param indicators Os valores atuais dos indicadores técnicos.
 * @param tickCandles Os dados de preço mais recentes.
 * @returns O voto do robô, confiança e sugestões.
 */
const calculateRobotVote = (
    robot: RobotStrategy,
    indicators: Indicators,
    tickCandles: CandleData[]
): Omit<RobotVote, 'weight'> => {
    // Objetivo: Calcular o voto, a confiança, e o stake sugerido.
    // O 'suggestedStake' agora é dinâmico com base na força do sinal.
    let vote: RobotVote['vote'] = 'HOLD';
    let confidence = 0;
    let suggestedStake = 0;
    const { optimalDuration, optimalDurationUnit, suggestedStake: baseStake } = robot;

    // Função auxiliar para definir o voto e o stake proporcional à confiança.
    const setVote = (newVote: 'RISE' | 'FALL', newConfidence: number) => {
        vote = newVote;
        confidence = newConfidence;
        // Stake sugerido é proporcional à confiança do sinal.
        if (confidence === robot.strongConfidence) {
            suggestedStake = baseStake; // Confiança alta = stake completo
        } else if (confidence === robot.weakConfidence) {
            suggestedStake = baseStake * 0.5; // Confiança baixa = meio stake
        }
    };

    if (!indicators) return { vote: 'HOLD', confidence: 0, optimalDuration, optimalDurationUnit, suggestedStake: 0 };
    
    // --- LÓGICA DE VOTAÇÃO PARA CADA TIPO DE ESTRATÉGIA ---
    // Cada bloco verifica o indicador relevante e usa `setVote` para registar a decisão.
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
         // Lógica do OBV: Compara o valor atual com uma média móvel do próprio OBV.
         // Esta parte é um pouco mais complexa e depende de como você armazena a série histórica do OBV.
         // Por simplicidade, vamos usar uma lógica de inclinação. Se o OBV está a subir, é um sinal de compra.
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
  const [isStopLossOn, setIsStopLossOn] = useState(true);
  const [isInversionModeOn, setIsInversionModeOn] = useState(false);
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
  const contractsInAlertRef = useRef<Map<number, 'breached' | 'confirmed'>>(new Map());

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
    
    if (dailyPnl <= -dailyBalance) return { status: 'veto', message: 'Stop Loss Diário Atingido', finalStake, finalDuration, finalDurationUnit: formValues.duration_unit, analysis: `Prejuízo de $${Math.abs(dailyPnl).toFixed(2)} atingiu o limite de $${dailyBalance}.` };
    if (dailyPnl >= dailyTarget) return { status: 'veto', message: 'Meta Diária Batida', finalStake, finalDuration, finalDurationUnit: formValues.duration_unit, analysis: `Lucro de $${dailyPnl.toFixed(2)} atingiu a meta de $${dailyTarget}.` };
    if (Math.max(riseSum, fallSum) < effectiveThreshold) return { status: 'inactive', message: 'Aguardando consenso.', finalStake, finalDuration, finalDurationUnit: formValues.duration_unit };

    return { status: 'approved', message: 'Aprovado pelo Conselho', finalStake, finalDuration, finalDurationUnit: formValues.duration_unit, analysis: isDynamicRiskOn ? `Risco ajustado: ${finalStake.toFixed(2)}` : 'Risco padrão.' };
  }, [form, dailyBalance, dailyTarget, isDynamicConsensusOn, isDynamicRiskOn, consensusThreshold]);
  
  const tickCandles = useMemo(() => {
    if (!priceTicks || priceTicks.length === 0) return [];
    return priceTicks.map(t => ({ epoch: t.epoch, open: t.price, high: t.price, low: t.price, close: t.price, volume: 1 }));
  }, [priceTicks]);

  useEffect(() => {
    if (!isConnected || !user || !isCouncilAutopilotOn || strategyCouncil.length === 0 || !activeSymbol || tickCandles.length < 2) return;

    const currentIndicators = calculateAllIndicators(tickCandles, strategyCouncil, timePeriod);
    setIndicators(currentIndicators);
    if (!currentIndicators) return;

    const activeCouncilContracts = operationsLog.filter(op => op.status === 'pending' && op.initiator === 'Conselho');
    if (activeCouncilContracts.length > 0) {
      // positionManagementCommittee(activeCouncilContracts, currentIndicators);
    }

    const performanceMap = new Map(robotPerformance.map(p => [p.id, { ...p }]));
    let performanceChanged = false;
    
    virtualTradesRef.current = virtualTradesRef.current.filter(trade => {
        if (tickCandles.length - 1 >= trade.exitTickIndex) {
            const exitPrice = tickCandles[trade.exitTickIndex]?.close;
            if (exitPrice) {
                const isWin = (trade.vote === 'RISE' && exitPrice > trade.entryPrice) || (trade.vote === 'FALL' && exitPrice < trade.entryPrice);
                const perf = performanceMap.get(trade.robotId);
                if (perf) {
                    const pnl = isWin ? VIRTUAL_STAKE * 0.95 : -VIRTUAL_STAKE;
                    perf.totalProfit += pnl;
                    if (isWin) perf.wins++; else perf.losses++;
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
        saveRobotPerformance(user.uid, updatedPerformance);
    }

    const newVotes: CouncilVotes = {};
    strategyCouncil.forEach(robot => {
        const voteResult = calculateRobotVote(robot, currentIndicators, tickCandles);
        let weight = 1.0;
        if (isMeritocracyOn) {
            const perf = performanceMap.get(robot.id);
            if (perf && (perf.wins + perf.losses) > 5) {
                const winRate = perf.wins / (perf.wins + perf.losses);
                weight = 1 + (winRate - 0.5) * 2;
                weight = Math.max(0.2, Math.min(2.0, weight));
            }
        }
        newVotes[robot.id] = { ...voteResult, weight };
        if (voteResult.vote !== 'HOLD') {
            const tradeId = `vt_${Date.now()}_${tradeCounterRef.current++}`;
            virtualTradesRef.current.push({
                id: tradeId,
                robotId: robot.id,
                vote: voteResult.vote,
                entryPrice: tickCandles[tickCandles.length - 1].close,
                entryEpoch: tickCandles[tickCandles.length - 1].epoch,
                exitEpoch: tickCandles[tickCandles.length - 1].epoch + durationToSeconds(voteResult.optimalDuration, voteResult.optimalDurationUnit),
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
    if(riseSum > consensusThreshold || fallSum > consensusThreshold){
      decision = riseSum > fallSum ? 'RISE' : 'FALL';
    }
    setConsensusDecision(decision);

    if (councilExecutionRef.current.isExecuting) return;

    const dailyPnl = operationsLog.filter(op => new Date(op.timestamp).toDateString() === new Date().toDateString() && op.initiator === 'Conselho').reduce((sum, op) => sum + (op.result || 0), 0);
    const supervisionDecision = supervisionCommitteeCheck(newVotes, currentIndicators, dailyPnl);
    setSupervisionStatus(supervisionDecision);

    if (supervisionDecision.status === 'approved') {
        councilExecutionRef.current.isExecuting = true;
        const { finalStake, finalDuration, finalDurationUnit } = supervisionDecision;
        const dir = riseSum > fallSum ? 'RISE' : 'FALL';
        
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
    
  }, [priceTicks, isConnected, isCouncilAutopilotOn, strategyCouncil, robotPerformance, isMeritocracyOn, activeSymbol, operationsLog, supervisionCommitteeCheck, toast, executeTrade, timePeriod, committeeOfSpecialists, user, evolveTrigger]);

  return {
    isCouncilAutopilotOn, setIsCouncilAutopilotOn, strategyCouncil, fetchStrategyCouncil, dissolveCouncil, isFetchingCouncil, councilVotes, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, consensusThreshold, setConsensusThreshold, isDynamicConsensusOn, setIsDynamicConsensusOn, isDynamicRiskOn, setIsDynamicRiskOn, isMeritocracyOn, setIsMeritocracyOn, indicators, activeCommittee, supervisionStatus, consensusSum, consensusDecision, robotPerformance, evolutionHistory
  };
}
