
'use client';

/**
 * @fileOverview TERMINAL QUANT V3.0 (COUNCIL EDITION) - MONITORAMENTO MULTI-ATIVO
 * V3.2: Protocolo de Ativação Tática via Chat e Execução Polimórfica.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi } from './use-deriv-api-v2';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../services/council-strategies';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { TradeMemoryManager } from '../services/trade-memory-service';
import { runQuantCouncil } from '../services/quant-council-engine';
import { CouncilDecision, TradeMemoryBuffer, AgentOpinion, CouncilTelemetry, AssetExecutionPermission, PortfolioRiskState } from '../types/council';
import { getOllamaResponse } from '@/app/actions';

export interface RadarAssetStatus {
    symbol: string;
    lastAction: 'RISE' | 'FALL' | 'HOLD';
    lastPrice?: number;
    confidence: number;
    timestamp: number;
    isQualified: boolean;
    executedVia: string;
    opinions: AgentOpinion[];
    recommendedContract?: string;
    holdReason?: string;
}

export type AllowedContractsV3 = {
    'CALL': boolean;
    'PUT': boolean;
    'ACCUMULATORS': boolean;
    'MULTIPLIERS': boolean;
};

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    time: string;
    agentName?: string;
}

export function useAIQuantTerminalV3(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { isConnected, executeTrade, operationsLog, accountBalance, watchedSymbols, setWatchedSymbols, multiAssetCandles, clearActiveContracts, setAccountType, accountType } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();

    // ESTADOS DE CONTROLE CANÔNICOS V3
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);
    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [analysisInterval, setAnalysisInterval] = useState(120); 
    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(120);
    
    // GESTÃO FINANCEIRA E CONTRATOS
    const [dailyBalance, setDailyBalance] = useState(10.0);
    const [dailyTarget, setDailyTarget] = useState(5.0);
    const [stakeValue, setStakeValue] = useState(1.0);

    // GESTÃO DE PORTFÓLIO E PERMISSÕES
    const [assetPermissions, setAssetPermissions] = useState<Record<string, AssetExecutionPermission>>({});
    const [portfolioRisk, setPortfolioRisk] = useState<PortfolioRiskState>({
        openPositions: 0,
        maxConcurrentPositions: 5,
        totalExposure: 0,
        maxTotalExposure: 10.0,
        lockedSymbols: new Set()
    });

    const [telemetry, setTelemetry] = useState<CouncilTelemetry>({
        avgTokensPerSec: 0,
        totalTokens: 0,
        consensusEntropy: 0,
        jitterMs: 0,
        inferenceHealth: 100
    });
    
    const [allowedContracts, setAllowedContracts] = useState<AllowedContractsV3>({
        'CALL': true,
        'PUT': true,
        'ACCUMULATORS': true,
        'MULTIPLIERS': true
    });
    const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(5);

    // RADAR E MEMÓRIA
    const [radarStatus, setRadarStatus] = useState<Record<string, RadarAssetStatus>>({});
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [reasoningLog, setReasoningLog] = useState<any[]>([]);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);
    const [availableModels, setAvailableModels] = useState<any[]>([]);
    
    const executionLockRef = useRef(false);
    const scheduleRef = useRef<Record<string, number>>({});
    const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig | null>(null);

    const addLog = useCallback((message: string, type: string = 'info') => {
        setReasoningLog(prev => [{ time: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
    }, []);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('ollamaConfig');
            if (saved) {
                try { setOllamaConfig(JSON.parse(saved) as OllamaConfig); } catch (e) {}
            }
        }
    }, []);

    // Atualiza o estado do portfólio baseado no log de operações e limites diários
    useEffect(() => {
        const open = operationsLog.filter(op => op.status === 'pending');
        setPortfolioRisk(prev => ({
            ...prev,
            openPositions: open.length,
            totalExposure: open.reduce((sum, op) => sum + op.stake, 0),
            maxConcurrentPositions: maxConcurrentTrades,
            maxTotalExposure: dailyBalance
        }));
    }, [operationsLog, maxConcurrentTrades, dailyBalance]);

    // ESTATÍSTICAS DE SESSÃO V3
    const sessionStats = useMemo(() => {
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && (op.initiator === 'Conselho_V3' || op.strategy?.startsWith('V3_'))
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const pnl = finishedTrades.reduce((acc, op) => acc + (Number(op.result) || (op.status === 'lost' ? -op.stake : 0)), 0);
        
        return { 
            pnl: Number(pnl) || 0, 
            winRate: finishedTrades.length > 0 ? (wins / finishedTrades.length) * 100 : null, 
            total: finishedTrades.length 
        };
    }, [operationsLog]);

    // MONITORAMENTO MULTI-ATIVO (Surgical Port from V2.5)
    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManualTrigger: boolean = false) => {
        if (!isConnected || !ollamaConfig || candles.length < 30 || !user) return;
        
        const isFocused = symbol === activeSymbol;
        const currentPrice = isFocused ? priceTicks[priceTicks.length - 1]?.price : candles[candles.length - 1].close;
        
        try {
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            const snapshot = {
                symbol: symbol,
                price: currentPrice,
                rsi: indicators?.rsi,
                bbw: indicators?.bbw,
                trend: indicators?.adx! > 25 ? 'Trending' : 'Ranging'
            };

            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);
            
            // Permissão específica do ativo
            const permissions: AssetExecutionPermission = assetPermissions[symbol] || {
                symbol,
                enabled: true,
                maxStake: stakeValue * 2,
                allowedContracts: ['CALL', 'PUT', 'ACCUMULATORS', 'MULTIPLIERS']
            };

            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, isFocused, permissions, portfolioRisk);
            
            if (isFocused) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
            }

            setRadarStatus(prev => ({
                ...prev,
                [symbol]: {
                    symbol,
                    lastAction: decision.finalAction,
                    lastPrice: currentPrice,
                    confidence: decision.consensusConfidence,
                    timestamp: Date.now(),
                    isQualified: decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65,
                    executedVia: decision.executedVia,
                    opinions: decision.opinions,
                    recommendedContract: decision.recommendedContract,
                    holdReason: decision.holdReason
                }
            }));

            // LÓGICA DE EXECUÇÃO (AUTOPILOT OU TRIGGER MANUAL VIA CHAT)
            const shouldExecute = isManualTrigger || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= 65);

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                const hasOpenTrade = operationsLog.some(op => op.asset === symbol && op.status === 'pending');

                if (!hasOpenTrade) {
                    if (isShadowMode) {
                        addLog(`[SHADOW] V3 simulando ${decision.recommendedContract} em ${symbol}...`, 'radar');
                    } else {
                        let finalContractType = 'CALL';
                        let extraProposalParams: Record<string, any> = {};

                        switch (decision.recommendedContract) {
                            case 'ACCUMULATORS': finalContractType = 'ACCU'; break;
                            case 'MULTIPLIERS': 
                                finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN'; 
                                extraProposalParams = { multiplier: 400 }; 
                                break;
                            default: finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                        }

                        const initiator = isManualTrigger ? 'Manual' : 'Conselho_V3';
                        await executeTrade(
                            finalContractType, stakeValue, symbol, decision.finalAction.toLowerCase() as any,
                            15, 's', initiator as any, `V3_${decision.executedVia}`, extraProposalParams
                        );
                        
                        addLog(`[EXEC] Ordem ${initiator} disparada para ${symbol} via ${decision.executedVia}`, 'execution');
                        
                        if (isManualTrigger) {
                            toast({ title: "🎯 Ordem Tática Executada", description: `${symbol}: ${decision.finalAction} via Chat.` });
                        }
                    }
                }
            }

        } catch (err: any) {
            if (isFocused) addLog(`Erro em ${symbol}: ${err.message}`, 'error');
        }
    }, [isConnected, ollamaConfig, isShadowMode, user, isAutoMode, operationsLog, activeSymbol, priceTicks, executeTrade, addLog, stakeValue, assetPermissions, portfolioRisk, toast]);

    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current) return;
        executionLockRef.current = true;

        const now = Date.now();
        const dueSymbols = watchedSymbols.filter(sym => (scheduleRef.current[sym] || 0) <= now);

        // Limpa bloqueios do ciclo anterior
        setPortfolioRisk(p => ({ ...p, lockedSymbols: new Set() }));

        for (const symbol of dueSymbols) {
            const candles = symbol === activeSymbol ? chartData : (multiAssetCandles[symbol] as CandleData[]);
            if (candles && candles.length >= 30) {
                await runAnalysisForSymbol(symbol, candles);
                // Marca símbolo como processado e define próximo ciclo (Half-Life)
                setPortfolioRisk(p => {
                    const next = new Set(p.lockedSymbols);
                    next.add(symbol);
                    return { ...p, lockedSymbols: next };
                });
                scheduleRef.current[symbol] = now + (analysisInterval * 500); 
            }
        }

        executionLockRef.current = false;
    }, [watchedSymbols, activeSymbol, chartData, multiAssetCandles, analysisInterval, runAnalysisForSymbol]);

    useEffect(() => {
        const timer = setInterval(() => {
            setTimeToNextAnalysis(prev => {
                if (prev <= 1) {
                    runMultiAssetCycle();
                    return analysisInterval;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [analysisInterval, runMultiAssetCycle]);

    const resetSession = async () => {
        setIsAutoMode(false);
        clearActiveContracts();
        setRadarStatus({});
        setReasoningLog([]);
        setChatMessages([]);
        scheduleRef.current = {};
        setLastDecision(null);
        if (user) await TradeMemoryManager.clearBuffer(user.uid);
        setMemoryBuffer({ wins: [], losses: [] });
        toast({ title: "Sessão Resetada", description: "Histórico e memória foram limpos." });
    };

    const sendMessage = async (content: string, targetAgent: string = 'CHAIRMAN') => {
        if (!ollamaConfig || !content.trim() || !user) return;
        const userMsg: ChatMessage = { role: 'user', content, time: new Date().toLocaleTimeString() };
        setChatMessages(prev => [...prev, userMsg]);
        setIsChatLoading(true);

        try {
            const memoryContext = TradeMemoryManager.formatBufferForPrompt(memoryBuffer);
            const radarDetails = watchedSymbols.map(sym => {
                const status = radarStatus[sym];
                return `| ${sym.padEnd(8)} | ${status?.lastAction || 'SCAN'} | ${status?.confidence || 0}% | ${status?.recommendedContract || 'N/A'} |`;
            }).join('\n');

            const systemPrompt = `VOCÊ É UM ANALISTA NO LABORATÓRIO V3.0 (COUNCIL EDITION).
            ESTRUTURA: CHAIRMAN (Líder), MOMENTUM, RISK CRITIC, ARCHIVIST.
            
            RADAR TÁTICO:
            ${radarDetails}

            INSTRUÇÃO DE EXECUÇÃO (CRÍTICA):
            - Se o usuário der uma ordem direta de compra/venda (ex: "faça a compra", "execute no ativo X"), você DEVE obrigatoriamente responder confirmando e incluir exatamente esta tag no final da resposta: [SOLICITAR_EXECUCAO:ATIVO] (substitua ATIVO pelo símbolo correto, ex: 1HZ10V).
            - Nunca diga que realizou a compra se não incluir a tag [SOLICITAR_EXECUCAO:...]. Sem a tag, o robô não executará nada.
            
            ${memoryContext}
            SEU PAPEL: ${targetAgent}. Responda de forma técnica em PT-BR.`;

            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: systemPrompt }, 
                ...chatMessages.map(m => ({ role: m.role, content: m.content }))
            ]);
            
            if (response.success) {
                const assistantContent = response.success;
                setChatMessages(prev => [...prev, { role: 'assistant', content: assistantContent, time: new Date().toLocaleTimeString(), agentName: targetAgent }]);

                // PROTOCÓLO DE ATIVAÇÃO TÁTICA VIA CHAT
                const executionTag = assistantContent.match(/\[SOLICITAR_EXECUCAO:(.*?)\]/);
                if (executionTag && executionTag[1]) {
                    const requestedSymbol = executionTag[1].trim();
                    const targetCandles = requestedSymbol === activeSymbol ? chartData : multiAssetCandles[requestedSymbol];
                    
                    if (targetCandles && targetCandles.length >= 30) {
                        addLog(`Chat autorizou execução tática em ${requestedSymbol}. Disparando motor...`, 'decision');
                        // DISPARA EXECUÇÃO FORÇADA (isManualTrigger = true)
                        await runAnalysisForSymbol(requestedSymbol, targetCandles as CandleData[], true);
                    } else {
                        addLog(`Falha ao armar ordem via Chat: Ativo ${requestedSymbol} sem dados suficientes.`, 'error');
                        toast({ title: "Erro de Dados", description: `Ativo ${requestedSymbol} ainda está sincronizando dados.`, variant: "destructive" });
                    }
                }
            }
        } catch (error: any) {
            toast({ title: "Erro no Chat", description: error.message, variant: "destructive" });
        } finally {
            setIsChatLoading(false);
        }
    };

    return {
        isAutoMode, toggleAutoMode: () => setIsAutoMode(!isAutoMode),
        isShadowMode, toggleShadowMode: () => setIsShadowMode(!isShadowMode),
        lastDecision, timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        allowedContracts, setAllowedContracts,
        maxConcurrentTrades, setMaxConcurrentTrades,
        stakeValue, setStakeValue,
        dailyBalance, setDailyBalance,
        dailyTarget, setDailyTarget,
        sessionStats,
        reasoningLog, addLog, memoryBuffer, accountBalance,
        radarStatus, watchedSymbols, setWatchedSymbols,
        resetSession,
        chatMessages, isChatLoading, sendMessage,
        executeManualDecision: () => lastDecision && runMultiAssetCycle(),
        telemetry,
        ollamaConfig,
        availableModels,
        updateOllamaConfig: (cfg: any) => setOllamaConfig(c => ({...c, ...cfg})),
        fetchAvailableModels: () => {},
        setAccountType,
        accountType
    };
}
