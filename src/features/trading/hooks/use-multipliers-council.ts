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
// 1. CONFIGURAÇÕES E TIPOS
// ============================================================================

type BotStatus = 'PAUSED' | 'RANGING' | 'LOW_VOLATILITY' | 'MONITORING' | 'POSITION_OPEN' | 'COOL_DOWN';
type TrendDirection = 'UP' | 'DOWN' | 'NONE';

const ADX_THRESHOLD = 25;
const RSI_UPPER_BOUND = 60;
const RSI_LOWER_BOUND = 40;
const COMMISSION_PERCENT = 0.02; // 0.02%
const SPREAD_ESTIMATE_PERCENT = 0.01; // 0.01%
const MMB_ATR_MULTIPLIER = 2.0;
const BREAKEVEN_PROFIT_PERCENT = 15;
const TRAILING_STOP_PROFIT_PERCENT = 30;
const COOLDOWN_CANDLES = 3;
const LONG_EMA_PERIOD = 100; // Constante para a EMA longa

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
        updateContract, // Importado para gerenciar trades
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

    // --- REFS PARA MANTER ESTADO ENTRE RENDERS ---
    const executionRef = useRef({ isExecuting: false });
    const rsiStateRef = useRef({ prev: 50, crossedDownFromUpper: false, crossedUpFromLower: false });
    const cooldownRef = useRef(0);
    const trailingStateRef = useRef<{ breakevenSet: boolean; trailingActive: boolean }>({ breakevenSet: false, trailingActive: false });
    
    // --- MEMOIZAÇÃO DE DADOS DERIVADOS ---
    const dailyPnL = useMemo(() => {
        const today = new Date().toDateString();
        return operationsLog
            .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today && op.initiator === 'Piloto')
            .reduce((sum, op) => sum + (op.result || 0), 0);
    }, [operationsLog]);
    
    const autopilotPosition = useMemo(() => 
        operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending'),
    [operationsLog]);

    // --- LÓGICA PRINCIPAL (EXECUTADA A CADA NOVA VELA) ---
    useEffect(() => {
        // --- CLÁUSULAS DE GUARDA (CONDIÇÕES PARA NÃO EXECUTAR) ---
        if (!isAutopilotOn || !isConnected || !activeSymbol || !accountBalance || botCandleData.length < LONG_EMA_PERIOD) {
            setBotStatus(isAutopilotOn ? 'MONITORING' : 'PAUSED');
            return;
        }
        if (executionRef.current.isExecuting) return;

        // Proteção de banca
        if (dailyPnL <= -dailyBalance || dailyPnL >= dailyTarget) {
            if (isAutopilotOn) {
                setIsAutopilotOn(false);
                const reason = dailyPnL <= -dailyBalance ? "Limite de Perda Atingido" : "Meta de Lucro Atingida";
                toast({ title: `🤖 Piloto Pausado: ${reason}`, variant: "destructive" });
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

            // --- GESTÃO DE TRADE (TRAILING STOP) ---
            if (autopilotPosition) {
                setBotStatus('POSITION_OPEN');
                const { stake = 0, result = 0, id: contractId, entryPrice } = autopilotPosition;
                const profitPercent = stake > 0 ? (result / stake) * 100 : 0;
                
                // 1. Mover para o Breakeven
                if (!trailingStateRef.current.breakevenSet && profitPercent >= BREAKEVEN_PROFIT_PERCENT) {
                    await updateContract(contractId, undefined, entryPrice);
                    trailingStateRef.current.breakevenSet = true;
                    toast({ title: "🛡️ Stop no Breakeven", description: `Posição #${contractId} protegida.` });
                }
                // 2. Ativar Trailing Stop
                else if (profitPercent >= TRAILING_STOP_PROFIT_PERCENT) {
                    const newStopLoss = botCandleData[botCandleData.length-1].close - indicators.atr;
                    if(newStopLoss > (autopilotPosition.stopLoss || 0)) {
                        await updateContract(contractId, undefined, newStopLoss);
                        trailingStateRef.current.trailingActive = true;
                    }
                }
                executionRef.current.isExecuting = false;
                return;
            } else {
                 // Resetar estado do trailing stop se não há posição
                if(trailingStateRef.current.breakevenSet || trailingStateRef.current.trailingActive) {
                    trailingStateRef.current = { breakevenSet: false, trailingActive: false };
                }
            }

            // --- LÓGICA DE ABERTURA DE POSIÇÃO ---
            if (cooldownRef.current > 0) {
                setBotStatus('COOL_DOWN');
                cooldownRef.current--;
                executionRef.current.isExecuting = false;
                return;
            }

            const { adx, ma: { long: ema100 }, rsi, atr } = indicators;
            const lastPrice = botCandleData[botCandleData.length - 1].close;

            // 1. FILTRO DE QUALIDADE DE TENDÊNCIA
            if (adx < ADX_THRESHOLD) {
                setBotStatus('RANGING');
                executionRef.current.isExecuting = false;
                return;
            }

            // 2. CÁLCULO DE BREAKEVEN DINÂMICO
            const multiplier = form.getValues('multiplier');
            const mmbPercent = (((COMMISSION_PERCENT / 100) * 2) / multiplier) + (SPREAD_ESTIMATE_PERCENT / 100);
            const projectedMove = atr; // ATR já é um movimento projetado
            const projectedMovePercent = projectedMove / lastPrice;

            if (projectedMovePercent < (mmbPercent * MMB_ATR_MULTIPLIER)) {
                setBotStatus('LOW_VOLATILITY');
                executionRef.current.isExecuting = false;
                return;
            }
            
            // 3. LÓGICA DE ENTRADA REFINADA (PULLBACK)
            const currentTrend: TrendDirection = lastPrice > ema100! ? 'UP' : 'DOWN';
            setTrend(currentTrend);
            
            const prevRsi = rsiStateRef.current.prev;
            
            // Detecta se o RSI esteve na zona de pullback
            if (rsi < RSI_LOWER_BOUND) rsiStateRef.current.crossedUpFromLower = true;
            if (rsi > RSI_UPPER_BOUND) rsiStateRef.current.crossedDownFromUpper = true;
            
            rsiStateRef.current.prev = rsi;

            let signal: 'up' | 'down' | null = null;
            if (currentTrend === 'UP' && rsiStateRef.current.crossedUpFromLower && rsi > RSI_LOWER_BOUND && prevRsi <= RSI_LOWER_BOUND) {
                signal = 'up';
                rsiStateRef.current.crossedUpFromLower = false;
            } else if (currentTrend === 'DOWN' && rsiStateRef.current.crossedDownFromUpper && rsi < RSI_UPPER_BOUND && prevRsi >= RSI_UPPER_BOUND) {
                signal = 'down';
                rsiStateRef.current.crossedDownFromUpper = false;
            }
            
            if (signal) {
                setBotStatus('EXECUTING_TRADE');
                const baseStake = Math.max(1.0, dailyBalance * 0.02); // 2% da banca do dia
                const volatilityFactor = Math.max(0.5, 1 - (atr/lastPrice * 100)); // Reduz stake se vol > 1%
                const finalStake = Math.max(1.0, Math.min(baseStake * volatilityFactor, 5.0));

                const stopLoss = finalStake; // Stop Loss inicial igual ao stake
                const takeProfit = finalStake * 1.5; // Alvo de 150%

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
                    toast({ title: `🤖 Pullback de ${signal.toUpperCase()}!`, description: `Posição aberta com stake de $${finalStake.toFixed(2)}.` });
                } else {
                    toast({ title: `❌ Falha na Execução`, description: result.message, variant: "destructive" });
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
        executeTrade, updateContract, operationsLog, autopilotPosition
    ]);

    const toggleAutopilot = useCallback(() => {
        setIsAutopilotOn(prevState => {
            const newState = !prevState;
            // Adiar a chamada do toast para evitar conflitos de renderização do React.
            setTimeout(() => {
                toast({ title: `Piloto ${newState ? 'Ativado' : 'Desativado'}` });
            }, 0);
            
            if (!newState) {
                 setBotStatus('PAUSED');
                 rsiStateRef.current = { prev: 50, crossedDownFromUpper: false, crossedUpFromLower: false };
                 cooldownRef.current = 0;
            } else {
                setBotStatus('MONITORING');
            }
            return newState;
        });
    }, [toast]);
    
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
