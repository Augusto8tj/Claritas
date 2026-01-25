// src/features/trading/hooks/use-multipliers-council.ts
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiMultipliers } from './use-deriv-api-multipliers';
import { useToast } from '@/hooks/use-toast';
import type { CandleData } from '@/lib/types';
import { useFormContext } from 'react-hook-form';
import type { MultipliersFormValues } from '../components/deriv-trader/deriv-trader-interface-multipliers.types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';

// ============================================================================
// 1. CONFIGURAÇÕES E CONSTANTES
// ============================================================================

type BotStatus = 'PAUSED' | 'RANGING' | 'LOW_VOLATILITY' | 'MONITORING' | 'POSITION_OPEN' | 'COOL_DOWN' | 'EXECUTING_TRADE';
type TrendDirection = 'UP' | 'DOWN' | 'NONE';

const ADX_THRESHOLD = 25;
const RSI_UPPER_BOUND = 60;
const RSI_LOWER_BOUND = 40;
const COMMISSION_PERCENT = 0.02; // 0.02%
const SPREAD_ESTIMATE_PERCENT = 0.01; // 0.01%
const MMB_ATR_MULTIPLIER = 2.0; // Volatilidade deve ser 2x o custo
const BREAKEVEN_PROFIT_PERCENT = 15;
const TRAILING_STOP_PROFIT_PERCENT = 30;
const COOLDOWN_CANDLES = 3;
const LONG_EMA_PERIOD = 100;

// ============================================================================
// 2. HOOK PRINCIPAL
// ============================================================================

export function useMultipliersCouncil(
    activeSymbol: string | null,
    botCandleData: CandleData[],
    accountBalance: number | null
) {
    const {
        executeTrade,
        isConnected,
        operationsLog,
        updateContract,
    } = useDerivApiMultipliers();

    const { toast } = useToast();
    const form = useFormContext<MultipliersFormValues>();

    // --- ESTADOS INTERNOS ---
    const [isAutopilotOn, setIsAutopilotOn] = useState(false);
    const [botStatus, setBotStatus] = useState<BotStatus>('PAUSED');
    const [trend, setTrend] = useState<TrendDirection>('NONE');
    const [dailyBalance, setDailyBalance] = useState(10.0);
    const [dailyTarget, setDailyTarget] = useState(5.0);
    const [calculatedRisk, setCalculatedRisk] = useState({ stake: 1.0, stopLoss: 1.0, takeProfit: 2.0 });

    // --- REFS PARA CONTROLE DE ESTADO ---
    const executionRef = useRef({ isExecuting: false });
    const rsiStateRef = useRef({ prev: 50, crossedDownFromUpper: false, crossedUpFromLower: false });
    const cooldownRef = useRef(0);
    const trailingStateRef = useRef<{ [key: number]: { breakevenSet: boolean; trailingActive: boolean } }>({});
    
    // --- CÁLCULOS DERIVADOS (PnL) ---
    const dailyPnL = useMemo(() => {
        const today = new Date().toDateString();
        return operationsLog
            .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today && op.initiator === 'Piloto')
            .reduce((sum, op) => sum + (op.result || 0), 0);
    }, [operationsLog]);
    
    const autopilotPosition = useMemo(() => 
        operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending'),
    [operationsLog]);

    // --- CONTROLE LIGA/DESLIGA ---
    const toggleAutopilot = useCallback(() => {
        setIsAutopilotOn(prevState => {
            const newState = !prevState;
            setTimeout(() => {
                toast({ title: `Piloto ${newState ? 'Ativado' : 'Desativado'}` });
            }, 0);
            
            if (!newState) {
                 setBotStatus('PAUSED');
                 // Reset total ao desligar
                 rsiStateRef.current = { prev: 50, crossedDownFromUpper: false, crossedUpFromLower: false };
                 cooldownRef.current = 0;
            } else {
                setBotStatus('MONITORING');
            }
            return newState;
        });
    }, [toast]);

    // --- LÓGICA DE EXECUÇÃO (LOOP PRINCIPAL) ---
    useEffect(() => {
        // 1. Cláusulas de Guarda
        if (!isAutopilotOn || !isConnected || !activeSymbol || !accountBalance || botCandleData.length < LONG_EMA_PERIOD) {
            setBotStatus(isAutopilotOn ? 'MONITORING' : 'PAUSED');
            return;
        }
        if (executionRef.current.isExecuting) return;

        // 2. Proteção de Banca Diária
        if (dailyPnL <= -dailyBalance || dailyPnL >= dailyTarget) {
            if (isAutopilotOn) {
                setIsAutopilotOn(false);
                const reason = dailyPnL <= -dailyBalance ? "Stop Loss Diário Atingido" : "Meta de Lucro Atingida";
                toast({ title: `🤖 Piloto Pausado: ${reason}`, variant: dailyPnL <= -dailyBalance ? "destructive" : "default" });
            }
            return;
        }

        const executeLogic = async () => {
            executionRef.current.isExecuting = true;

            const indicators = calculateAllIndicators(botCandleData, initialCouncilStrategies, '1m', { duration: 15, unit: 's' });
            if (!indicators || !indicators.adx || !indicators.ma.long || !indicators.rsi || !indicators.atr) {
                executionRef.current.isExecuting = false;
                return;
            }

            // =================================================================
            // 3. GESTÃO DE POSIÇÃO (TRAILING STOP)
            // =================================================================
            if (autopilotPosition) {
                setBotStatus('POSITION_OPEN');
                const { stake = 0, result = 0, id: contractId, entryPrice, contractType, multiplier = 1 } = autopilotPosition;
                
                const currentPrice = botCandleData[botCandleData.length-1].close;
                const profitPercent = stake > 0 ? (result / stake) * 100 : 0;
                
                const trailingState = trailingStateRef.current[contractId] || { breakevenSet: false, trailingActive: false };

                // A. Mover para Breakeven
                if (!trailingState.breakevenSet && profitPercent >= BREAKEVEN_PROFIT_PERCENT && entryPrice) {
                    // Para garantir que não haja perda, definimos o stop loss para o valor total da aposta menos um centavo.
                    // Isso significa que se o lucro cair para quase zero, a posição fecha com uma perda mínima.
                    const breakevenStopLoss = stake - 0.01;
                    await updateContract(contractId, undefined, breakevenStopLoss);
                    trailingStateRef.current[contractId] = { ...trailingState, breakevenSet: true };
                    toast({ title: "🛡️ Stop no Breakeven", description: `Risco na posição #${contractId} minimizado.` });
                }
                // B. Trailing Stop Dinâmico (ATR)
                else if (profitPercent >= TRAILING_STOP_PROFIT_PERCENT) {
                    
                    const currentStopLossAmount = autopilotPosition.stopLoss || stake;
                    let newStopLossAmount;

                    if (contractType === 'MULTUP') {
                        const stopPrice = currentPrice - indicators.atr;
                        const stopProfit = multiplier * stake * ((stopPrice / entryPrice!) - 1);
                        newStopLossAmount = stake - stopProfit; // A perda é o stake menos o lucro no ponto de stop
                    } else { // MULTDOWN
                        const stopPrice = currentPrice + indicators.atr;
                        const stopProfit = multiplier * stake * (1 - (stopPrice / entryPrice!));
                        newStopLossAmount = stake - stopProfit;
                    }
                    
                    // Garante que o novo stop loss é válido e melhora a posição atual
                    if (newStopLossAmount > 0 && newStopLossAmount < currentStopLossAmount) {
                         await updateContract(contractId, undefined, newStopLossAmount);
                         trailingStateRef.current[contractId] = { ...trailingState, trailingActive: true };
                    }
                }
                executionRef.current.isExecuting = false;
                return;
            } else {
                // Reset do estado de trailing se não houver posição aberta
                 if (Object.keys(trailingStateRef.current).length > 0) {
                     trailingStateRef.current = {};
                 }
            }

            // =================================================================
            // 4. PREPARAÇÃO PARA ANÁLISE DE ENTRADA
            // =================================================================
            if (cooldownRef.current > 0) {
                setBotStatus('COOL_DOWN');
                cooldownRef.current--;
                executionRef.current.isExecuting = false;
                return;
            }

            const { adx, ma: { long: ema100 }, rsi, atr } = indicators;
            const lastPrice = botCandleData[botCandleData.length - 1].close;
            
            const currentTrend: TrendDirection = lastPrice > ema100! ? 'UP' : 'DOWN';
            
            // Reset de estado se a tendência mudou
            if (currentTrend !== trend) {
                rsiStateRef.current = { prev: rsi, crossedDownFromUpper: false, crossedUpFromLower: false };
                setTrend(currentTrend);
            }

            const multiplier = form.getValues('multiplier');
            const mmbPercent = (((COMMISSION_PERCENT / 100) * 2) / multiplier) + (SPREAD_ESTIMATE_PERCENT / 100);
            const projectedMovePercent = atr / lastPrice;

            // =================================================================
            // 5. FILTROS DE SEGURANÇA (BLOQUEANTES)
            // =================================================================
            
            if (adx < ADX_THRESHOLD) {
                setBotStatus('RANGING');
                executionRef.current.isExecuting = false;
                return;
            }

            if (projectedMovePercent < (mmbPercent * MMB_ATR_MULTIPLIER)) {
                setBotStatus('LOW_VOLATILITY');
                executionRef.current.isExecuting = false;
                return;
            }

            // =================================================================
            // 6. LÓGICA DE SINAL (PULLBACK)
            // =================================================================
            
            if (rsi < RSI_LOWER_BOUND) rsiStateRef.current.crossedUpFromLower = true;
            if (rsi > RSI_UPPER_BOUND) rsiStateRef.current.crossedDownFromUpper = true;
            
            if (currentTrend === 'UP') rsiStateRef.current.crossedDownFromUpper = false;
            if (currentTrend === 'DOWN') rsiStateRef.current.crossedUpFromLower = false;

            let signal: 'up' | 'down' | null = null;
            const prevRsi = rsiStateRef.current.prev;
            rsiStateRef.current.prev = rsi;

            if (currentTrend === 'UP' && rsiStateRef.current.crossedUpFromLower && rsi > RSI_LOWER_BOUND && prevRsi <= RSI_LOWER_BOUND) {
                signal = 'up';
            } 
            else if (currentTrend === 'DOWN' && rsiStateRef.current.crossedDownFromUpper && rsi < RSI_UPPER_BOUND && prevRsi >= RSI_UPPER_BOUND) {
                signal = 'down';
            }

            // =================================================================
            // 7. EXECUÇÃO
            // =================================================================
            if (signal) {
                setBotStatus('EXECUTING_TRADE');
                
                const baseStake = Math.max(1.0, dailyBalance * 0.02);
                const volatilityFactor = Math.max(0.5, 1 - (atr/lastPrice * 100));
                const finalStake = Math.max(1.0, Math.min(baseStake * volatilityFactor, 5.0));

                const stopLoss = finalStake;
                const takeProfit = finalStake * 1.5;

                setCalculatedRisk({ stake: finalStake, stopLoss, takeProfit });

                const result = await executeTrade(
                    signal === 'up' ? 'MULTUP' : 'MULTDOWN',
                    finalStake,
                    activeSymbol!,
                    multiplier,
                    takeProfit,
                    stopLoss,
                    undefined,
                    'Piloto'
                );

                if (result.success) {
                    rsiStateRef.current = { prev: rsi, crossedDownFromUpper: false, crossedUpFromLower: false };
                    cooldownRef.current = COOLDOWN_CANDLES;
                    toast({ title: `🤖 Entrada Sniper: ${signal.toUpperCase()}`, description: `Pullback confirmado. Stake: $${finalStake.toFixed(2)}` });
                } else {
                    toast({ title: `❌ Erro na Execução`, description: result.message, variant: "destructive" });
                }
            } else {
                setBotStatus('MONITORING');
            }
            
            executionRef.current.isExecuting = false;
        };

        executeLogic();

    }, [
        botCandleData, isAutopilotOn, isConnected, activeSymbol, form, toast,
        accountBalance, dailyBalance, dailyTarget, dailyPnL,
        executeTrade, updateContract, operationsLog, autopilotPosition, trend
    ]);
    
    return {
        isAutopilotOn,
        toggleAutopilot,
        botStatus,
        trend,
        calculatedRisk,
        dailyBalance,
        setDailyBalance,
        dailyTarget,
        setDailyTarget,
        dailyPnL,
    };
}
