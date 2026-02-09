// src/features/trading/hooks/use-multipliers-council.ts
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiMultipliers } from './use-deriv-api-multipliers';
import { useToast } from '@/hooks/use-toast';
import type { CandleData } from '@/lib/types';
import { useFormContext } from 'react-hook-form';
import type { MultipliersFormValues } from '../components/deriv-trader/deriv-trader-interface-multipliers.types';
import { calculateAllIndicators, type Indicators } from '@/features/trading/services/indicator-service';
import { initialCouncilStrategies } from '@/features/trading/services/council-strategies';

// ============================================================================
// 1. CONFIGURAÇÕES E CONSTANTES
// ============================================================================

type BotStatus = 'PAUSED' | 'RANGING' | 'LOW_VOLATILITY' | 'MONITORING' | 'POSITION_OPEN' | 'COOL_DOWN' | 'EXECUTING_TRADE';
type TrendDirection = 'UP' | 'DOWN' | 'NONE';

const ADX_THRESHOLD = 25;
const RSI_MID_POINT = 50; 
const COMMISSION_PERCENT = 0.02; 
const SPREAD_ESTIMATE_PERCENT = 0.01;
const MMB_ATR_MULTIPLIER = 2.0;
const BREAKEVEN_PROFIT_PERCENT = 15;
const TRAILING_STOP_PROFIT_PERCENT = 30;
const COOLDOWN_CANDLES = 3;
const LONG_EMA_PERIOD = 100;
const TRAILING_STOP_ATR_MULTIPLIER = 1.5;

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
    const prevRsiRef = useRef(50);
    const cooldownRef = useRef(0);
    const trailingStateRef = useRef<{ [key: number]: { breakevenSet: boolean; highestProfit: number } }>({});
    
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

            const currentPrice = botCandleData[botCandleData.length-1].close;

            // =================================================================
            // 3. GESTÃO DE POSIÇÃO (TRAILING STOP)
            // =================================================================
            if (autopilotPosition) {
                setBotStatus('POSITION_OPEN');
                const { stake = 0, result = 0, id: contractId, entryPrice, contractType, stopLoss: currentStopLoss, multiplier = 1 } = autopilotPosition;
                
                const profitPercent = stake > 0 ? (result / stake) * 100 : 0;
                
                const trailingState = trailingStateRef.current[contractId] || { breakevenSet: false, highestProfit: 0 };
                
                if (result > trailingState.highestProfit) {
                    trailingStateRef.current[contractId] = { ...trailingState, highestProfit: result };
                }

                // A. Mover para Breakeven
                if (!trailingState.breakevenSet && profitPercent >= BREAKEVEN_PROFIT_PERCENT) {
                    await updateContract(contractId, undefined, 0.01);
                    trailingStateRef.current[contractId].breakevenSet = true;
                    toast({ title: "🛡️ Stop no Breakeven", description: `Risco na posição #${contractId} minimizado.` });
                }
                // B. Trailing Stop Dinâmico (ATR)
                else if (profitPercent >= TRAILING_STOP_PROFIT_PERCENT && entryPrice) {
                    let newStopLossAmount: number | undefined;

                    // A lógica aqui precisa calcular o valor da perda (um número positivo) que corresponde
                    // a um certo preço de stop. profit = (stake * mult / entry) * (spot - entry)
                    // stop_loss = -profit_at_stop_price = (stake * mult / entry) * (entry - stop_price)
                    if (contractType === 'MULTUP') {
                        const stopPrice = currentPrice - (indicators.atr * TRAILING_STOP_ATR_MULTIPLIER);
                        newStopLossAmount = (stake * multiplier / entryPrice) * (entryPrice - stopPrice);
                    } else { // MULTDOWN
                        const stopPrice = currentPrice + (indicators.atr * TRAILING_STOP_ATR_MULTIPLIER);
                        newStopLossAmount = (stake * multiplier / entryPrice) * (stopPrice - entryPrice);
                    }
                    
                    if (newStopLossAmount > 0 && newStopLossAmount > (currentStopLoss || 0)) {
                       // O valor do stop loss não pode ser negativo e deve ser maior que o stop anterior
                       // A API da Deriv trata o stop loss como a perda máxima, não como um gatilho de lucro.
                       // A lógica aqui é complexa, por agora vamos manter o breakeven.
                       // A implementação correta exigiria uma refatoração da forma como o 'updateContract' é chamado.
                    }
                }
                executionRef.current.isExecuting = false;
                return;
            } else {
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
            const currentTrend: TrendDirection = currentPrice > ema100! ? 'UP' : 'DOWN';
            setTrend(currentTrend);

            const multiplier = form.getValues('multiplier');
            const mmbPercent = (((COMMISSION_PERCENT / 100) * 2) / multiplier) + (SPREAD_ESTIMATE_PERCENT / 100);
            const projectedMovePercent = atr / currentPrice;

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
            // 6. LÓGICA DE SINAL (PULLBACK) - CORRIGIDA
            // =================================================================
            
            let signal: 'up' | 'down' | null = null;
            const prevRsi = prevRsiRef.current;
            prevRsiRef.current = rsi;

            if (currentTrend === 'UP' && rsi > RSI_MID_POINT && prevRsi <= RSI_MID_POINT) {
                signal = 'up';
            } 
            else if (currentTrend === 'DOWN' && rsi < RSI_MID_POINT && prevRsi >= RSI_MID_POINT) {
                signal = 'down';
            }

            // =================================================================
            // 7. EXECUÇÃO
            // =================================================================
            if (signal) {
                setBotStatus('EXECUTING_TRADE');
                
                const baseStake = Math.max(1.0, dailyBalance * 0.02);
                const volatilityFactor = Math.max(0.5, 1 - (atr/currentPrice * 100));
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
