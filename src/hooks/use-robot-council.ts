// src/hooks/use-robot-council.ts
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDerivApi } from './use-deriv-api';
import { useToast } from '@/hooks/use-toast';
import type { RobotStrategy, ChartData, TickData, CandleData, RiseFallFormValues, DurationUnit, EnhancedRobotPerformance, RobotPerformance } from '@/lib/types';
import { useFormContext } from 'react-hook-form';
import type { Indicators } from '@/services/indicator-service';
import { calculateAllIndicators } from '@/services/indicator-service';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance } from '@/services/financial-data-service';
import { useStrategyEvolution } from './use-strategy-evolution';
import { initialCouncilStrategies } from '@/services/council-strategies';


export type RobotVote = {
    vote: 'RISE' | 'FALL' | 'HOLD';
    confidence: number;
    weight: number;
    optimalDuration: number;
    optimalDurationUnit: 't' | 's' | 'm' | 'h' | 'd';
    suggestedStake: number;
};
export type CouncilVotes = { [key: string]: RobotVote };


// ============================================================================
// ARENA VIRTUAL: Estrutura de uma Trade Virtual (Espelho dos Votos)
// ============================================================================
type VirtualTrade = {
    id: string;
    robotId: string;
    vote: 'RISE' | 'FALL';
    entryPrice: number;
    entryEpoch: number;
    exitEpoch: number;
};

const VIRTUAL_STAKE = 1.0; // Cada trade virtual usa $1 para calcular PnL

// ============================================================================
// UTILITÁRIOS
// ============================================================================
const isCandle = (d: ChartData): d is CandleData => d !== null && 'close' in d;
const getPrice = (d: ChartData | null): number | undefined => {
    if (!d) return undefined;
    return isCandle(d) ? d.close : d.price;
};

const isValid = (value: any): value is number => value !== null && value !== undefined && !isNaN(value);

const durationToSeconds = (duration: number, unit: 't' | 's' | 'm' | 'h' | 'd'): number => {
    switch (unit) {
        case 't': return duration * 2; // Aproximação para vol-indices
        case 's': return duration;
        case 'm': return duration * 60;
        case 'h': return duration * 3600;
        case 'd': return duration * 86400;
        default: return duration;
    }
};

// ============================================================================
// LÓGICA DE VOTAÇÃO: Como cada robô decide RISE, FALL ou HOLD
// ============================================================================
const calculateRobotVote = (
    robot: RobotStrategy,
    indicators: Indicators,
    tickCandles: CandleData[]
): Omit<RobotVote, 'weight'> => {
    let vote: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
    let confidence = 0;
    const { optimalDuration, optimalDurationUnit, suggestedStake } = robot;

    if (!indicators) {
        return { vote: 'HOLD', confidence: 0, optimalDuration, optimalDurationUnit, suggestedStake };
    }
    
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

    return { vote, confidence, optimalDuration, optimalDurationUnit, suggestedStake };
};


// ============================================================================
// HOOK PRINCIPAL
// ============================================================================
export function useRobotCouncil(
    activeSymbol: string | null,
    priceTicks: TickData[],
    dataVersion: number
) {
    const { operationsLog, executeTrade, timePeriod, isConnected, sellContract } = useDerivApi();
    const { user, loading: isAuthLoading } = useAuth();
    const { toast } = useToast();
    const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);
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
    const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true);
    const [isMeritocracyOn, setIsMeritocracyOn] = useState(true);
    const [isStopLossOn, setIsStopLossOn] = useState(true);
    const [isInversionModeOn, setIsInversionModeOn] = useState(false); // NOVO ESTADO

    // Estados da Arena Virtual
    const [robotPerformance, setRobotPerformance] = useState<RobotPerformance[]>([]);
    const virtualTradesRef = useRef<VirtualTrade[]>([]);
    const tradeCounterRef = useRef(0);

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

    // Controle de execução e gestão de trades
    const councilExecutionRef = useRef<{ 
        isExecuting: boolean;
        sellingContracts: Set<number>;
    }>({ 
        isExecuting: false, 
        sellingContracts: new Set() 
    });
    const contractsInAlertRef = useRef<Map<number, 'breached' | 'confirmed'>>(new Map());


    // Sincroniza as estratégias evoluídas com o estado do conselho
    useEffect(() => {
        const councilWithIds = evolvedStrategies.map((strat, index) => ({
            ...strat,
            id: `${strat.strategyType}_BOT_${index+1}`
        })) as RobotStrategy[];
        setStrategyCouncil(councilWithIds);
    }, [evolvedStrategies]);
    

    // ========================================================================
    // CARREGAR/RESETAR DESEMPENHO
    // ========================================================================
     useEffect(() => {
        if (!user || isAuthLoading) return;

        const doLoad = async () => {
            try {
                const storedPerformance = await loadRobotPerformance(user.uid);
                if (storedPerformance && storedPerformance.length > 0) {
                    setRobotPerformance(storedPerformance as RobotPerformance[]);
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

    const resetArenaPerformance = useCallback(() => {
        if (strategyCouncil.length === 0) return;

        toast({
            title: "Memória da Arena Reiniciada",
            description: `O desempenho para ${activeSymbol} foi zerado para uma nova análise.`
        });
        
        const initialPerformance: RobotPerformance[] = strategyCouncil.map((robot) => ({
            id: robot.id,
            strategyType: robot.strategyType,
            strategy: robot,
            wins: 0,
            losses: 0,
            totalProfit: 0,
        }));
        setRobotPerformance(initialPerformance);
        virtualTradesRef.current = [];
        
        if (user) {
            saveRobotPerformance(user.uid, initialPerformance as EnhancedRobotPerformance[]);
        }
    }, [strategyCouncil, activeSymbol, toast, user]);

    // "Amnésia Seletiva": Reseta a arena quando o ativo muda
    useEffect(() => {
        if (isCouncilAutopilotOn) { // Só reseta se a mesa estiver ativa
            resetArenaPerformance();
        }
    }, [activeSymbol, isCouncilAutopilotOn, resetArenaPerformance]);

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

        await new Promise((resolve) => setTimeout(resolve, 500));
        
        const council = evolvedStrategies.map((strategy, index) => ({
            ...strategy,
            id: `${strategy.strategyType}_BOT_${index+1}`,
            justification: strategy.justification.replace('{{timePeriod}}', timePeriod),
        })) as RobotStrategy[];

        setStrategyCouncil(council);

        // A lógica de resetar agora é centralizada no `resetArenaPerformance`
        resetArenaPerformance();

        toast({
            title: 'Conselho de IA Montado!',
            description: `${council.length} analistas foram convocados. Arena Virtual ativa para ${activeSymbol}.`,
        });

        setIsCouncilAutopilotOn(true);
        setIsFetchingCouncil(false);
    }, [activeSymbol, timePeriod, toast, user, evolvedStrategies, resetArenaPerformance]);

    // ========================================================================
    // DISSOLVER O CONSELHO
    // ========================================================================
    const dissolveCouncil = () => {
        // Não apaga as estratégias, apenas desativa o piloto
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
            dailyPnl: number,
            lastTwoTradesWereLosses: boolean
        ): {
            finalStake: number;
            finalDuration: number;
            finalDurationUnit: DurationUnit;
            status: 'approved' | 'veto' | 'inactive';
            message: string;
            analysis?: string;
        } => {
            let finalStake = baseStake;
            let finalDuration = baseDuration;
            let finalDurationUnit: DurationUnit = 's'; // Padrão para segundos

            const defaultReturn = { finalStake, finalDuration, finalDurationUnit, status: 'inactive' as 'inactive', message: 'Aguardando indicadores.' };
            
            if (!indicators) return defaultReturn;

            // Limites diários
            if (dailyPnl <= -dailyBalance) {
                setIsCouncilAutopilotOn(false);
                return { ...defaultReturn, status: 'veto', message: 'VETO: Limite de perda diário atingido.', analysis: `Prejuízo de $${Math.abs(dailyPnl).toFixed(2)} atingiu o limite de $${dailyBalance}.` };
            }
            if (dailyPnl >= dailyTarget) {
                setIsCouncilAutopilotOn(false);
                return { ...defaultReturn, status: 'veto', message: 'VETO: Meta de lucro diária atingida.', analysis: `Lucro de $${dailyPnl.toFixed(2)} atingiu a meta de $${dailyTarget}.` };
            }
            
            // ================== CONSENSO DINÂMICO (RELATIVO) ==================
            let effectiveThreshold = consensusThreshold;
            if (isDynamicConsensusOn) {
                const totalPossibleConsensus = Object.values(currentVotes).filter(v => v.vote !== 'HOLD').reduce((sum, v) => sum + (v.confidence * v.weight), 0);
                let requiredPercentage = 0.60;
                if (indicators.adx && indicators.adx < 20) requiredPercentage += 0.15;
                if (indicators.bbw && indicators.bbw > 0.08) requiredPercentage += 0.20;
                requiredPercentage = Math.min(requiredPercentage, 0.85);
                effectiveThreshold = totalPossibleConsensus * requiredPercentage;
                setConsensusThreshold(Math.round(effectiveThreshold));
            }
            
            // NOVO: CIRCUIT BREAKER
            if (lastTwoTradesWereLosses) {
                effectiveThreshold *= 1.5; // Exige 50% mais consenso
            }

            // Verifica consenso
            const consensusReached = Math.max(riseSum, fallSum) >= effectiveThreshold;
            if (!consensusReached) {
                return { ...defaultReturn, status: 'inactive', message: 'Aguardando consenso tático.' };
            }

            // AJUSTE DE RISCO PARA STAKE E DURATION
            const direction = riseSum > fallSum ? 'RISE' : 'FALL';
            const votingRobots = Object.values(currentVotes).filter(v => v.vote === direction);
            const totalConfidence = votingRobots.reduce((sum, v) => sum + v.confidence, 0);

            if (isDynamicRiskOn && totalConfidence > 0) {
                 const weightedAvgDuration = votingRobots.reduce((sum, v) => sum + v.optimalDuration * v.confidence, 0) / totalConfidence;
                 const weightedAvgStake = votingRobots.reduce((sum, v) => sum + v.suggestedStake * v.confidence, 0) / totalConfidence;

                 const atr = indicators.atr || 0;
                 const bbw = indicators.bbw || 0;
                 const volatilityFactor = (atr / (getPrice(priceTicks[priceTicks.length - 1]) || 1) + bbw) / 2;

                 finalStake = weightedAvgStake * Math.max(0.5, 1 - volatilityFactor * 5);
                 
                 finalDuration = Math.round(weightedAvgDuration);

            }

            // NOVO: CIRCUIT BREAKER - Ação de redução de risco
            let circuitBreakerAnalysis = '';
            if (lastTwoTradesWereLosses) {
                finalStake = 0.35; // Reduz stake para o mínimo
                circuitBreakerAnalysis = 'Perdas sequenciais detectadas, operando com risco mínimo. ';
            }

            // Aplicar restrições finais de stake
            finalStake = Math.max(0.35, finalStake);
            
            // CONVERSÃO FINAL DA DURAÇÃO PARA UNIDADE VÁLIDA
            if (finalDuration <= 10) {
                finalDurationUnit = 't';
                finalDuration = Math.max(5, Math.min(10, finalDuration));
            } else if (finalDuration < 60) {
                finalDurationUnit = 's';
                finalDuration = Math.max(15, finalDuration);
            } else {
                finalDurationUnit = 'm';
                finalDuration = Math.round(finalDuration / 60);
                finalDuration = Math.max(1, finalDuration);
            }
            
            let finalAnalysis = isDynamicRiskOn ? `Risco ajustado pela volatilidade.` : 'Risco padrão.';

            return {
                status: 'approved',
                message: 'Aprovado. Risco avaliado.',
                analysis: circuitBreakerAnalysis + finalAnalysis,
                finalStake,
                finalDuration,
                finalDurationUnit
            };
        },
        [dailyBalance, dailyTarget, priceTicks, isDynamicConsensusOn, isDynamicRiskOn, consensusThreshold, baseStake, baseDuration]
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

        const currentTick = priceTicks[priceTicks.length - 1];
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
        
        const lastOpenContract = operationsLog.find(op => op.status === 'pending');
        const contractDurationForIndicators = lastOpenContract 
            ? { duration: lastOpenContract.duration, unit: lastOpenContract.durationUnit }
            : { duration: form.getValues('duration'), unit: form.getValues('duration_unit') };

        const currentIndicators = calculateAllIndicators(
            tickCandles,
            strategyCouncil,
            timePeriod,
            contractDurationForIndicators
        );

        setIndicators(currentIndicators);
        if (!currentIndicators) return;
        
        // ========================================================================
        // GESTÃO DE RISCO DE TRADES ABERTOS (STOP-LOSS / TAKE-PROFIT)
        // ========================================================================
        if (isStopLossOn) {
            const activeCouncilContracts = operationsLog.filter(op => 
                op.status === 'pending' && 
                op.initiator === 'Conselho' &&
                op.durationUnit !== 't' // Ignora contratos em ticks, pois são muito rápidos
            );
            
            activeCouncilContracts.forEach(contract => {
                if(councilExecutionRef.current.sellingContracts.has(contract.id)) return;

                const contractId = contract.id;
                
                // --- LÓGICA DE TAKE PROFIT ---
                const potentialProfit = contract.stake * 0.90; // Aproximação de payout
                const currentProfit = contract.result || 0; // O hook da API atualiza este valor
                
                if (currentProfit > 0 && potentialProfit > 0 && (currentProfit / potentialProfit) >= 0.75) {
                     councilExecutionRef.current.sellingContracts.add(contractId);
                     sellContract(contractId).finally(() => setTimeout(() => councilExecutionRef.current.sellingContracts.delete(contractId), 5000));
                     toast({ title: "💰 Take Profit Atingido", description: `Contrato #${contractId} fechado para garantir lucro.`, className: "bg-green-100 dark:bg-green-900" });
                     return; // Sai para não acionar stop loss no mesmo ciclo
                }

                // --- LÓGICA DE STOP LOSS COM CONFIRMAÇÃO ---
                const chandelierExit = currentIndicators.chandelierExit;
                if (chandelierExit && contract.entryPrice) {
                    const isBreached = contract.direction === 'rise' 
                        ? currentTick.price < chandelierExit 
                        : currentTick.price > chandelierExit;

                    if (isBreached) {
                        // Se é a primeira vez que viola, marca como 'breached'
                        if (!contractsInAlertRef.current.has(contractId)) {
                            contractsInAlertRef.current.set(contractId, 'breached');
                        } 
                        // Se já violou no tick anterior, confirma e vende
                        else if (contractsInAlertRef.current.get(contractId) === 'breached') {
                            councilExecutionRef.current.sellingContracts.add(contractId);
                            sellContract(contractId).finally(() => setTimeout(() => councilExecutionRef.current.sellingContracts.delete(contractId), 5000));
                            toast({ title: "🛡️ Stop Loss Confirmado", description: `Contrato #${contractId} fechado para proteger capital. Violação confirmada.`, variant: "destructive" });
                            contractsInAlertRef.current.delete(contractId); // Limpa o alerta
                        }
                    } else {
                        // Se o preço voltou para a zona segura, remove o alerta
                        if (contractsInAlertRef.current.has(contractId)) {
                            contractsInAlertRef.current.delete(contractId);
                        }
                    }
                }
            });
        }

        const stillActiveTrades: VirtualTrade[] = [];
        const performanceMap = new Map<string, RobotPerformance>(
            robotPerformance.map((p) => [p.id, { ...p }])
        );
        let performanceChanged = false;

        virtualTradesRef.current.forEach((trade) => {
            const isExpired = currentTick.epoch >= trade.exitEpoch;

            if (isExpired) {
                const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;
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
                        const totalTrades = (perf.wins || 0) + (perf.losses || 0);
                        if (totalTrades > 0) {
                            perf.winRate = ((perf.wins || 0) / totalTrades) * 100;
                        } else {
                            perf.winRate = 0;
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
            evolveTrigger(updatedPerformance as EnhancedRobotPerformance[]);
            // SALVAR NO FIREBASE
            if (user) {
                saveRobotPerformance(user.uid, updatedPerformance as EnhancedRobotPerformance[]);
            }
        }

        let riseConfidenceSum = 0;
        let fallConfidenceSum = 0;
        const newVotes: CouncilVotes = {};
        
        strategyCouncil.forEach((robot) => {
            const voteData = calculateRobotVote(robot, currentIndicators, tickCandles);
            
            if (voteData.vote !== 'HOLD') {
                const durationInSeconds = durationToSeconds(voteData.optimalDuration, voteData.optimalDurationUnit);
                const tradeId = `vt_${Date.now()}_${tradeCounterRef.current++}`;
                const virtualTrade: VirtualTrade = {
                    id: tradeId,
                    robotId: robot.id,
                    vote: voteData.vote,
                    entryPrice: currentTick.price,
                    entryEpoch: currentTick.epoch,
                    exitEpoch: currentTick.epoch + durationInSeconds,
                };
                virtualTradesRef.current.push(virtualTrade);
            }

            let weight = 1.0;
            if (isMeritocracyOn) {
                const perf = performanceMap.get(robot.id);
                if (perf && (perf.wins || 0) + (perf.losses || 0) > 3) {
                    const winRate = (perf.winRate || 50) / 100;
                    const pnlFactor = Math.tanh((perf.totalProfit || 0) / 50); // Mapeia PnL para -1 a 1
                    weight = 0.5 + (winRate * 0.75) + (pnlFactor * 0.25); // Combinação ponderada
                }
            }
            
            newVotes[robot.id] = { ...voteData, weight };

            if (voteData.vote === 'RISE') riseConfidenceSum += voteData.confidence * weight;
            if (voteData.vote === 'FALL') fallConfidenceSum += voteData.confidence * weight;
        });

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

         const councilTrades = operationsLog.filter(op => op.initiator === 'Conselho');
        const dailyPnl = councilTrades
            .filter((op) => new Date(op.timestamp).toDateString() === new Date().toDateString() && op.status !== 'pending')
            .reduce((sum, op) => sum + (op.result || 0), 0);

        const lastTwoCouncilTrades = councilTrades.filter(op => op.status !== 'pending').slice(0, 2);
        const lastTwoTradesWereLosses = lastTwoCouncilTrades.length === 2 && lastTwoCouncilTrades.every(t => t.status === 'lost');

        const supervisionDecision = supervisionCommitteeCheck(
            riseConfidenceSum,
            fallConfidenceSum,
            newVotes,
            currentIndicators,
            dailyPnl,
            lastTwoTradesWereLosses
        );
        setSupervisionStatus(supervisionDecision);

        if (supervisionDecision.status === 'approved') {
            councilExecutionRef.current.isExecuting = true;
            let direction = riseConfidenceSum > fallConfidenceSum ? 'RISE' : 'FALL';

            // LÓGICA DE INVERSÃO PARA O AUTOPILOTO
            if (isInversionModeOn) {
                direction = direction === 'RISE' ? 'FALL' : 'RISE';
            }

            const { finalStake, finalDuration, finalDurationUnit } = supervisionDecision;
            
            toast({
                title: `Conselho Executou Ordem ${isInversionModeOn ? 'INVERTIDA' : ''}!`,
                description: `Direção: ${direction}, Stake: $${finalStake.toFixed(
                    2
                )}, Duração: ${finalDuration} ${finalDurationUnit}. ${supervisionDecision.analysis || ''}`,
            });

            executeTrade(
                direction === 'RISE' ? 'CALL' : 'PUT',
                finalStake,
                activeSymbol,
                direction.toLowerCase() as 'rise' | 'fall',
                finalDuration,
                finalDurationUnit,
                'Conselho'
            ).finally(() =>
                setTimeout(() => (councilExecutionRef.current.isExecuting = false), 10000)
            );
        }
    }, [
        dataVersion,
        priceTicks,
        isConnected,
        isCouncilAutopilotOn,
        isStopLossOn,
        strategyCouncil,
        robotPerformance,
        isMeritocracyOn,
        activeSymbol,
        operationsLog,
        supervisionCommitteeCheck,
        toast,
        executeTrade,
        sellContract,
        form,
        timePeriod,
        committeeOfSpecialists,
        user,
        evolveTrigger,
        isInversionModeOn // Adiciona ao array de dependências
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
        isStopLossOn,
        setIsStopLossOn,
        isInversionModeOn, // Exporta o estado e o setter
        setIsInversionModeOn,
        indicators,
        activeCommittee,
        supervisionStatus,
        consensusSum,
        consensusDecision,
        robotPerformance,
        evolutionHistory
    };
}
