// src/features/trading/hooks/use-robot-council-v2.ts
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDerivApi } from './use-deriv-api';
import { useToast } from '@/hooks/use-toast';
import type { RobotStrategy, ChartData, TickData, CandleData, RiseFallFormValues } from '@/lib/types';
import { useFormContext } from 'react-hook-form';
import type { Indicators } from '@/services/indicator-service';
import { calculateAllIndicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance } from '@/services/financial-data-service';

export type RobotVote = {
    vote: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    weight: number;
};
export type CouncilVotes = { [key: string]: RobotVote };

export type RobotPerformance = {
    id: string;
    strategyType: RobotStrategy['strategyType'];
    strategy: RobotStrategy;
    wins: number;
    losses: number;
    totalProfit: number;
};

// ============================================================================
// ARENA VIRTUAL: Estrutura de uma Trade Virtual (Espelho dos Votos)
// ============================================================================
type VirtualTrade = {
    id: string;
    robotId: string;
    vote: 'RISE' | 'FALL';
    entryPrice: number;
    entryEpoch: number;
    entryTickIndex: number;
    exitTickIndex: number;
};

const VIRTUAL_STAKE = 1.0; // Cada trade virtual usa $1 para calcular PnL
const VIRTUAL_TRADE_RESET_THRESHOLD = 200; // Reset a cada 200 trades

// ============================================================================
// UTILITÁRIOS
// ============================================================================
const isCandle = (d: ChartData): d is CandleData => d !== null && 'close' in d;
const getPrice = (d: ChartData | null): number | undefined => {
    if (!d) return undefined;
    return isCandle(d) ? d.close : d.price;
};

const isValid = (value: any): value is number => value !== null && value !== undefined && !isNaN(value);

// ============================================================================
// LÓGICA DE VOTAÇÃO: Como cada robô decide RISE, FALL ou HOLD
// ============================================================================
const calculateRobotVote = (
    robot: RobotStrategy,
    indicators: Indicators,
    tickCandles: CandleData[]
): Pick<RobotVote, 'vote' | 'confidence'> => {
    let vote: RobotVote['vote'] = 'HOLD';
    let confidence = 0;

    if (!indicators) return { vote: 'HOLD', confidence: 0 };
    
    // RSI
    if (robot.strategyType === 'RSI' && isValid(indicators.rsi)) {
        if (indicators.rsi! <= robot.weakBuyThreshold!) { vote = 'RISE'; confidence = robot.weakConfidence; }
        if (indicators.rsi! <= robot.strongBuyThreshold!) { vote = 'RISE'; confidence = robot.strongConfidence; }
        if (indicators.rsi! >= robot.weakSellThreshold!) { vote = 'FALL'; confidence = robot.weakConfidence; }
        if (indicators.rsi! >= robot.strongSellThreshold!) { vote = 'FALL'; confidence = robot.strongConfidence; }
    }

    // STOCHASTIC
    if (robot.strategyType === 'STOCHASTIC' && isValid(indicators.stoch)) {
        if (indicators.stoch! <= robot.weakBuyThreshold!) { vote = 'RISE'; confidence = robot.weakConfidence; }
        if (indicators.stoch! <= robot.strongBuyThreshold!) { vote = 'RISE'; confidence = robot.strongConfidence; }
        if (indicators.stoch! >= robot.weakSellThreshold!) { vote = 'FALL'; confidence = robot.weakConfidence; }
        if (indicators.stoch! >= robot.strongSellThreshold!) { vote = 'FALL'; confidence = robot.strongConfidence; }
    }

    // MOVING_AVERAGE_CROSS
    if (robot.strategyType === 'MOVING_AVERAGE_CROSS' && isValid(indicators.ma.short) && isValid(indicators.ma.long)) {
        if (indicators.ma.short! > indicators.ma.long!) { vote = 'RISE'; confidence = robot.weakConfidence; }
        if (indicators.ma.long! > indicators.ma.short!) { vote = 'FALL'; confidence = robot.weakConfidence; }
    }

    // MACD_CROSS
    if (robot.strategyType === 'MACD_CROSS' && isValid(indicators.macd.macd) && isValid(indicators.macd.signal)) {
        if (indicators.macd.macd! > indicators.macd.signal!) { vote = 'RISE'; confidence = robot.weakConfidence; }
        if (indicators.macd.signal! > indicators.macd.macd!) { vote = 'FALL'; confidence = robot.weakConfidence; }
    }

    // BOLLINGER_BANDS
    if (
        robot.strategyType === 'BOLLINGER_BANDS' &&
        isValid(indicators.bb.lower) && isValid(indicators.bb.upper) &&
        tickCandles.length > 0
    ) {
        const lastPrice = tickCandles[tickCandles.length - 1].close;

        if (isValid(lastPrice)) {
            if (lastPrice <= indicators.bb.lower!) {
                vote = 'RISE';
                confidence = robot.weakConfidence;
            }
            if (lastPrice >= indicators.bb.upper!) {
                vote = 'FALL';
                confidence = robot.weakConfidence;
            }
        }
    }

    // ADX_TREND
    if (robot.strategyType === 'ADX_TREND' && isValid(indicators.adx)) {
        if (indicators.adx! > (robot.trendStrengthThreshold || 25)) {
            if (isValid(indicators.pdi) && isValid(indicators.ndi)) {
                if (indicators.pdi! > indicators.ndi!) { vote = 'RISE'; confidence = robot.weakConfidence; }
                if (indicators.ndi! > indicators.pdi!) { vote = 'FALL'; confidence = robot.weakConfidence; }
            }
        }
    }
    
    // MFI
    if (robot.strategyType === 'MFI' && isValid(indicators.mfi)) {
        if (indicators.mfi! <= robot.weakBuyThreshold!) { vote = 'RISE'; confidence = robot.weakConfidence; }
        if (indicators.mfi! <= robot.strongBuyThreshold!) { vote = 'RISE'; confidence = robot.strongConfidence; }
        if (indicators.mfi! >= robot.weakSellThreshold!) { vote = 'FALL'; confidence = robot.weakConfidence; }
        if (indicators.mfi! >= robot.strongSellThreshold!) { vote = 'FALL'; confidence = robot.strongConfidence; }
    }
    
    // STOCH_RSI
    if (robot.strategyType === 'STOCH_RSI' && isValid(indicators.stochRSI)) {
        if (indicators.stochRSI! <= robot.weakBuyThreshold!) { vote = 'RISE'; confidence = robot.weakConfidence; }
        if (indicators.stochRSI! <= robot.strongBuyThreshold!) { vote = 'RISE'; confidence = robot.strongConfidence; }
        if (indicators.stochRSI! >= robot.weakSellThreshold!) { vote = 'FALL'; confidence = robot.weakConfidence; }
        if (indicators.stochRSI! >= robot.strongSellThreshold!) { vote = 'FALL'; confidence = robot.strongConfidence; }
    }

    return { vote, confidence };
};


// ============================================================================
// HOOK PRINCIPAL
// ============================================================================
export function useRobotCouncil(
    activeSymbol: string | null,
    priceTicks: TickData[]
) {
    const { operationsLog, executeTrade, timePeriod, isConnected } = useDerivApi();
    const { user, loading: isAuthLoading } = useAuth();
    const { toast } = useToast();
    const form = useFormContext<RiseFallFormValues>();

    // Estados do Conselho
    const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
    const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>([]);
    const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
    const [councilVotes, setCouncilVotes] = useState<CouncilVotes>({});

    // Configurações da Mesa
    const [dailyBalance, setDailyBalance] = useState(100);
    const [dailyTarget, setDailyTarget] = useState(50);
    const [baseStake, setBaseStake] = useState(1);
    const [baseDuration, setBaseDuration] = useState(5);
    const [consensusThreshold, setConsensusThreshold] = useState(300);
    const [isDynamicConsensusOn, setIsDynamicConsensusOn] = useState(true);
    const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true); // NOVO ESTADO
    const [isMeritocracyOn, setIsMeritocracyOn] = useState(true);

    // Estados da Arena Virtual
    const [robotPerformance, setRobotPerformance] = useState<RobotPerformance[]>([]);
    const virtualTradesRef = useRef<VirtualTrade[]>([]);
    const tradeCounterRef = useRef(0);
    const virtualTradeSessionCounterRef = useRef(0);

    // Estados de Análise
    const [indicators, setIndicators] = useState<Indicators | null>(null);
    const [activeCommittee, setActiveCommittee] = useState<string | null>(null);
    const [supervisionStatus, setSupervisionStatus] = useState<{
        status: 'inactive' | 'approved' | 'veto';
        message: string;
        analysis?: string;
    }>({ status: 'inactive', message: 'Aguardando consenso.' });
    const [consensusSum, setConsensusSum] = useState({ rise: 0, fall: 0 });
    const [consensusDecision, setConsensusDecision] = useState<'RISE' | 'FALL' | 'HOLD'>('HOLD');

    // Controle de execução
    const councilExecutionRef = useRef({ isExecuting: false });

    // ========================================================================
    // CARREGAR DESEMPENHO PERSISTIDO DO FIREBASE
    // ========================================================================
    useEffect(() => {
        if (!user || isAuthLoading) return;

        const doLoad = async () => {
            try {
                const storedPerformance = await loadRobotPerformance(user.uid);
                if (storedPerformance && storedPerformance.length > 0) {
                    setRobotPerformance(storedPerformance);
                    console.log("[Performance] Dados de desempenho carregados do Firebase.");
                } else {
                     console.log("[Performance] Nenhum dado de desempenho encontrado no Firebase para este usuário.");
                }
            } catch (error) {
                console.error('Erro ao carregar desempenho do Firebase:', error);
            }
        };
        doLoad();
    }, [user, isAuthLoading]);

    // ========================================================================
    // CONSTRUIR O CONSELHO
    // ========================================================================
    const fetchStrategyCouncil = useCallback(async () => {
        if (!activeSymbol || !user) {
            toast({
                variant: 'destructive',
                title: !user ? 'Não Autenticado' : 'Nenhum Ativo',
                description: !user ? 'Faça login para usar a Mesa Operacional.' : 'Selecione um ativo para construir o conselho.',
            });
            return;
        }

        setIsFetchingCouncil(true);
        
        virtualTradesRef.current = [];
        tradeCounterRef.current = 0;
        virtualTradeSessionCounterRef.current = 0;

        await new Promise((resolve) => setTimeout(resolve, 500));

        const durationUnit = form.getValues('duration_unit');
        const council = initialCouncilStrategies.map((strategy) => ({
            ...strategy,
            id: `${strategy.strategyType}_${Math.random().toString(36).substring(2, 7)}`,
            justification: strategy.justification.replace('{{timePeriod}}', timePeriod),
        })) as RobotStrategy[];

        setStrategyCouncil(council);

        if (robotPerformance.length === 0) {
            const initialPerformance: RobotPerformance[] = council.map((robot) => ({
                id: robot.id,
                strategyType: robot.strategyType,
                strategy: robot,
                wins: 0,
                losses: 0,
                totalProfit: 0,
            }));
            setRobotPerformance(initialPerformance);
            await saveRobotPerformance(user.uid, initialPerformance);
        }

        toast({
            title: 'Conselho de IA Montado!',
            description: `${council.length} analistas foram convocados. Arena Virtual ativa.`,
        });

        setIsCouncilAutopilotOn(true);
        setIsFetchingCouncil(false);
    }, [activeSymbol, form, timePeriod, toast, user, robotPerformance.length]);


    // ========================================================================
    // DISSOLVER O CONSELHO
    // ========================================================================
    const dissolveCouncil = () => {
        setStrategyCouncil([]);
        setCouncilVotes({});
        setIsCouncilAutopilotOn(false);
        virtualTradesRef.current = [];
    };

    // ========================================================================
    // COMITÊ DE ESPECIALISTAS
    // ========================================================================
    const committeeOfSpecialists = useCallback(
        (indicators: Indicators): string => {
            if (!indicators.adx || !indicators.stoch) return 'Comité Indefinido';

            if (indicators.adx > 25) {
                 if (indicators.pdi && indicators.ndi) {
                    if (indicators.pdi > indicators.ndi) return "Tendência de Alta com Força";
                    return "Tendência de Baixa com Força";
                }
                return "Tendência com Força";
            }
            if (indicators.stoch < 20 ) return 'Exaustão de Venda';
            if (indicators.stoch > 80 ) return 'Exaustão de Compra';
            
            return 'Mercado Lateral';
        },
        []
    );

    // ========================================================================
    // SUPERVISÃO E APROVAÇÃO
    // ========================================================================
    const supervisionCommitteeCheck = useCallback(
        (
            riseSum: number,
            fallSum: number,
            currentVotes: CouncilVotes,
            indicators: Indicators | null,
            dailyPnl: number
        ): {
            finalStake: number;
            finalDuration: number;
            status: 'approved' | 'veto' | 'inactive';
            message: string;
            analysis?: string;
        } => {
            const { duration_unit } = form.getValues();
            let finalStake = baseStake;
            let finalDuration = baseDuration;

            if (!indicators) {
                 return { status: 'inactive', message: 'Aguardando indicadores.', finalStake, finalDuration };
            }

            // Limites diários
            if (dailyPnl <= -dailyBalance) {
                setIsCouncilAutopilotOn(false);
                return {
                    status: 'veto',
                    message: 'VETO: Limite de perda diário atingido.',
                    finalStake,
                    finalDuration,
                    analysis: `Prejuízo de $${Math.abs(dailyPnl).toFixed(2)} atingiu o limite de $${dailyBalance}.`
                };
            }
            if (dailyPnl >= dailyTarget) {
                setIsCouncilAutopilotOn(false);
                return {
                    status: 'veto',
                    message: 'VETO: Meta de lucro diária atingida.',
                    finalStake,
                    finalDuration,
                    analysis: `Lucro de $${dailyPnl.toFixed(2)} atingiu a meta de $${dailyTarget}.`
                };
            }
            
            // ================== CONSENSO DINÂMICO (RELATIVO) ==================
            let effectiveThreshold;
            if (isDynamicConsensusOn) {
                const totalPossibleConsensus = Object.values(currentVotes)
                    .filter(v => v.vote !== 'HOLD')
                    .reduce((sum, v) => sum + (v.confidence * v.weight), 0);

                let requiredPercentage = 0.60;
                let analysisParts: string[] = [];

                if (indicators.adx && indicators.adx < 20) {
                     requiredPercentage += 0.15;
                     analysisParts.push("mercado sem tendência");
                }
                if (indicators.bbw && indicators.bbw > 0.08) {
                    requiredPercentage += 0.20;
                    analysisParts.push("alta volatilidade");
                }
                
                requiredPercentage = Math.min(requiredPercentage, 0.85);
                effectiveThreshold = totalPossibleConsensus * requiredPercentage;
                setConsensusThreshold(Math.round(effectiveThreshold));

            } else {
                effectiveThreshold = consensusThreshold;
            }


            // Verifica consenso
            const consensusReached = Math.max(riseSum, fallSum) >= effectiveThreshold;
            if (!consensusReached) {
                return {
                    status: 'inactive',
                    message: 'Aguardando consenso tático.',
                    finalStake,
                    finalDuration,
                };
            }

            // AJUSTE DE RISCO PARA STAKE E DURATION
            let analysis = 'Risco padrão.';
            let riskFactor = 1.0;
            let durationAdjustment = 0;
            let analysisParts: string[] = [];

            if (isDynamicRiskOn) { // NOVO: Só ajusta se a opção estiver ligada
                if (indicators.adx && indicators.adx < 20) {
                    riskFactor *= 0.75;
                    analysisParts.push("sem tendência (ADX baixo)");
                }
                if (indicators.bbw && indicators.bbw > 0.1) {
                    riskFactor *= 0.8;
                    durationAdjustment += 2;
                    analysisParts.push("alta volatilidade (BBW alto)");
                }
                const lastPrice = getPrice(priceTicks[priceTicks.length - 1]);
                if (indicators.atr && lastPrice && (indicators.atr / lastPrice) > 0.00015) {
                    riskFactor *= 0.8;
                    durationAdjustment += 1;
                    analysisParts.push("ATR elevado");
                }
                
                finalStake = baseStake * riskFactor;
                finalDuration = baseDuration + durationAdjustment;

                if(analysisParts.length > 0) {
                    analysis = `Risco e/ou duração ajustados: ${analysisParts.join(', ')}.`;
                }
            } else {
                 analysis = 'Gestão de risco dinâmica desativada.';
            }

            // Aplicar restrições finais
            finalStake = Math.max(0.35, finalStake);
            if (duration_unit === 't') {
                finalDuration = Math.round(Math.max(1, Math.min(10, finalDuration)));
            }

            return {
                status: 'approved',
                message: 'Aprovado. Risco avaliado.',
                analysis,
                finalStake,
                finalDuration,
            };
        },
        [form, dailyBalance, dailyTarget, priceTicks, isDynamicConsensusOn, isDynamicRiskOn, consensusThreshold, baseStake, baseDuration]
    );

    // ========================================================================
    // CICLO ÚNICO: Mesa Operacional (votação + consenso) + Arena Virtual (espelho)
    // ========================================================================
    useEffect(() => {
        // Condições de guarda
        if (
            !isConnected ||
            !user ||
            !isCouncilAutopilotOn ||
            strategyCouncil.length === 0 ||
            !activeSymbol ||
            priceTicks.length < 2
        ) {
            return;
        }

        const currentTickIndex = priceTicks.length - 1;
        const currentTick = priceTicks[currentTickIndex];
        if (!currentTick) return;

        // Converte ticks para velas para cálculo de indicadores
        const tickCandles: CandleData[] = priceTicks.map((t) => ({
            epoch: t.epoch,
            open: t.price,
            high: t.price,
            low: t.price,
            close: t.price,
            volume: 1,
        }));

        const currentIndicators = calculateAllIndicators(
            tickCandles,
            strategyCouncil,
            timePeriod
        );
        setIndicators(currentIndicators);
        if (!currentIndicators) return;

        // ====================================================================
        // ARENA VIRTUAL: FASE 1 - Julgamento de Trades Expirados
        // ====================================================================
        const stillActiveTrades: VirtualTrade[] = [];
        const performanceMap = new Map<string, RobotPerformance>(
            robotPerformance.map((p) => [p.id, { ...p }])
        );
        let performanceChanged = false;

        if (virtualTradeSessionCounterRef.current >= VIRTUAL_TRADE_RESET_THRESHOLD) {
             console.log(`[Arena] Limite de ${VIRTUAL_TRADE_RESET_THRESHOLD} trades atingido. Resetando desempenho da sessão.`);
             performanceMap.forEach(p => {
                 p.wins = 0;
                 p.losses = 0;
                 p.totalProfit = 0;
             });
             virtualTradeSessionCounterRef.current = 0;
             performanceChanged = true;
        }

        virtualTradesRef.current.forEach((trade) => {
            const isExpired = currentTickIndex >= trade.exitTickIndex;

            if (isExpired) {
                const exitTick = priceTicks[trade.exitTickIndex];
                if (exitTick) {
                    const isWin =
                        (trade.vote === 'RISE' && exitTick.price > trade.entryPrice) ||
                        (trade.vote === 'FALL' && exitTick.price < trade.entryPrice);

                    const perf = performanceMap.get(trade.robotId);
                    if (perf) {
                        const pnl = isWin ? VIRTUAL_STAKE * 0.92 : -VIRTUAL_STAKE;
                        perf.totalProfit = (perf.totalProfit || 0) + pnl;
                        if (isWin) {
                            perf.wins = (perf.wins || 0) + 1;
                        } else {
                            perf.losses = (perf.losses || 0) + 1;
                        }
                        performanceChanged = true;
                    }
                }
            } else {
                stillActiveTrades.push(trade);
            }
        });

        virtualTradesRef.current = stillActiveTrades;

        if (performanceChanged) {
            const updatedPerformance = Array.from(performanceMap.values());
            setRobotPerformance(updatedPerformance);
            if (user) {
                saveRobotPerformance(user.uid, updatedPerformance);
            }
        }

        // ====================================================================
        // MESA OPERACIONAL: Votação e Consenso
        // ====================================================================
        let riseConfidenceSum = 0;
        let fallConfidenceSum = 0;
        const newVotes: CouncilVotes = {};
        const { duration: formDuration } = form.getValues();
        const tradeDuration = formDuration > 0 ? formDuration : baseDuration; // Fallback para a duração base

        strategyCouncil.forEach((robot) => {
            const { vote, confidence } = calculateRobotVote(robot, currentIndicators, tickCandles);

            // ====================================================================
            // ARENA VIRTUAL: FASE 2 - Espelhar o Voto como Trade Virtual
            // ====================================================================
            if (vote !== 'HOLD') {
                const tradeId = `vt_${Date.now()}_${tradeCounterRef.current++}`;
                const virtualTrade: VirtualTrade = {
                    id: tradeId,
                    robotId: robot.id,
                    vote: vote,
                    entryPrice: currentTick.price,
                    entryEpoch: currentTick.epoch,
                    entryTickIndex: currentTickIndex,
                    exitTickIndex: currentTickIndex + tradeDuration,
                };
                virtualTradesRef.current.push(virtualTrade);
                virtualTradeSessionCounterRef.current++;
            }

            // Calcular peso (meritocracia)
            let weight = 1.0;
            if (isMeritocracyOn) {
                const perf = performanceMap.get(robot.id);
                if (perf && perf.wins + perf.losses > 3) { // Começa a ponderar após 3 trades
                    const winRate = perf.wins / (perf.wins + perf.losses);
                    const pnlFactor = Math.tanh(perf.totalProfit / 50); // Mapeia o lucro para um intervalo de -1 a 1
                    weight = 0.5 + winRate * 0.75 + pnlFactor * 0.25; // Combina taxa de acerto e lucro
                }
            }

            newVotes[robot.id] = { vote, confidence, weight };
            if (vote === 'RISE') riseConfidenceSum += confidence * weight;
            if (vote === 'FALL') fallConfidenceSum += confidence * weight;
        });

        // ====================================================================
        // Atualização de Estados
        // ====================================================================
        setCouncilVotes(newVotes);
        setConsensusSum({ rise: riseConfidenceSum, fall: fallConfidenceSum });
        setActiveCommittee(committeeOfSpecialists(currentIndicators));
        
        if (riseConfidenceSum > fallConfidenceSum && riseConfidenceSum > 0) {
            setConsensusDecision('RISE');
        } else if (fallConfidenceSum > riseConfidenceSum && fallConfidenceSum > 0) {
            setConsensusDecision('FALL');
        } else {
            setConsensusDecision('HOLD');
        }
        
        if (councilExecutionRef.current.isExecuting) return;

        // ====================================================================
        // Execução de Trade Real (Mesa Operacional)
        // ====================================================================
        const dailyPnl = operationsLog
            .filter(
                (op) =>
                    new Date(op.timestamp).toDateString() === new Date().toDateString() &&
                    op.initiator === 'Conselho'
            )
            .reduce((sum, op) => sum + (op.result || 0), 0);

        const supervisionDecision = supervisionCommitteeCheck(
            riseConfidenceSum,
            fallConfidenceSum,
            newVotes,
            currentIndicators,
            dailyPnl
        );
        setSupervisionStatus(supervisionDecision);

        if (supervisionDecision.status === 'approved') {
            councilExecutionRef.current.isExecuting = true;
            const direction = riseConfidenceSum > fallConfidenceSum ? 'RISE' : 'FALL';
            const { duration_unit } = form.getValues();
            const { finalStake, finalDuration } = supervisionDecision;

            toast({
                title: 'Conselho Executou Ordem!',
                description: `Direção: ${direction}, Stake: $${finalStake.toFixed(
                    2
                )}, Duração: ${finalDuration} ${duration_unit}.`,
            });

            executeTrade(
                direction === 'RISE' ? 'CALL' : 'PUT',
                finalStake,
                activeSymbol,
                direction.toLowerCase() as 'rise' | 'fall',
                finalDuration,
                duration_unit,
                'Conselho'
            ).finally(() =>
                setTimeout(() => (councilExecutionRef.current.isExecuting = false), 10000)
            );
        }
    }, [
        priceTicks,
        isConnected,
        isCouncilAutopilotOn,
        strategyCouncil,
        robotPerformance,
        isMeritocracyOn,
        activeSymbol,
        operationsLog,
        supervisionCommitteeCheck,
        toast,
        executeTrade,
        form,
        timePeriod,
        committeeOfSpecialists,
        user,
        baseDuration
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
        baseStake,
        setBaseStake,
        baseDuration,
        setBaseDuration,
        consensusThreshold,
        setConsensusThreshold,
        isDynamicConsensusOn,
        setIsDynamicConsensusOn,
        isDynamicRiskOn,
        setIsDynamicRiskOn,
        isMeritocracyOn,
        setIsMeritocracyOn,
        indicators,
        activeCommittee,
        supervisionStatus,
        consensusSum,
        consensusDecision,
        robotPerformance,
    };
}

    