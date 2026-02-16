// src/features/trading/hooks/use-hf-strike-zone.tsx
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { TickData, CandleData, TimePeriod, Operation, DurationUnit } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/features/trading/services/indicator-service';
import { getCouncilStrategies } from '../services/council-strategies';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { detectMarketRegime, type RegimeCharacteristics } from '../ml/market-regime-detector';
import { AdvancedRiskManager, type PositionSizeRecommendation } from '../risk/advanced-risk-manager';
import { useToast } from '@/hooks/use-toast';
import { useDerivApiV2 } from '@/features/trading/hooks/use-deriv-api-v2';
import {
  detectHFMeanReversionZone,
  detectStandardTrendZone,
  detectBollingerSqueezeZone,
  detectVolumeAbsorptionZone,
  detectMicrostructureScalpZone,
  type StrikeZone,
  type StrategyType
} from '../services/hf-strike-logic';
import type { HFConfig } from '@/features/trading/components/hf-trader/hf-config-panel';
import { saveHFTradeLog } from '@/services/hf-data-service';

export type { StrikeZone } from '../services/hf-strike-logic';

interface SessionConfig {
    dailyBalance: number;
    dailyTarget: number;
    operationsLog: Operation[];
    manualStake?: number;
}

export function useHFStrikeZone(
  activeSymbol: string | null,
  priceTicks: TickData[],
  botCandleData: CandleData[],
  uiChartPeriod: TimePeriod,
  config: HFConfig,
  sessionConfig: SessionConfig
) {
  const { user } = useAuth();
  const { executeTrade } = useDerivApiV2();
  const { toast } = useToast();
  const { enabled, minConfidence, autoExecute, maxConcurrentTrades, martingaleMultiplier, maxConsecutiveLosses, cooldownSeconds, preferredDuration, minConsensusSignals } = config;
  const { dailyBalance, dailyTarget, operationsLog, manualStake } = sessionConfig;
  
  const rsiStateRef = useRef({ prev: 50 });
  const initialStrategies = useMemo(() => getCouncilStrategies('standard'), []);
  
  const [marketRegime, setMarketRegime] = useState<RegimeCharacteristics | null>(null);
  const [activeStrikeZone, setActiveStrikeZone] = useState<StrikeZone | null>(null);
  const [riskManager] = useState(() => new AdvancedRiskManager({ maxDailyLoss: dailyBalance, maxDrawdown: 30, maxConcurrentTrades: 3, maxExposurePerAsset: 25, kellyFraction: 0.25 }, 1000));
  const [positionSizing, setPositionSizing] = useState<PositionSizeRecommendation | null>(null);
  const [allSignals, setAllSignals] = useState<(StrikeZone | null)[]>([]);
  
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const [isCooldownActive, setIsCooldownActive] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const lastProcessedOpIdRef = useRef<number | null>(null);
  
  const indicators = useMemo((): Indicators | null => {
    if (!enabled || botCandleData.length < 100) return null;
    return calculateAllIndicators(botCandleData, initialStrategies, '1m', { duration: 1, unit: 't' });
  }, [botCandleData, enabled, initialStrategies]);
  
  useEffect(() => {
    const lastOp = operationsLog.length > 0 ? operationsLog[0] : null;
    if (lastOp && lastOp.status !== 'pending' && lastOp.id !== lastProcessedOpIdRef.current) {
        lastProcessedOpIdRef.current = lastOp.id;
        if (lastOp.result! < 0) {
            const newLossCount = consecutiveLosses + 1;
            setConsecutiveLosses(newLossCount);
            if (newLossCount >= maxConsecutiveLosses) {
                toast({ title: '🛑 Stop de Perdas Consecutivas', description: `Limite de ${maxConsecutiveLosses} perdas atingido. Autopilot pausado.`, variant: 'destructive' });
                config.onConfigChange({ autoExecute: false });
            } else if (cooldownSeconds > 0) {
                setIsCooldownActive(true);
                toast({ title: '❄️ Cooldown Ativado', description: `Pausa de ${cooldownSeconds}s após perda.`, variant: 'default' });
                setTimeout(() => setIsCooldownActive(false), cooldownSeconds * 1000);
            }
        } else if (lastOp.result! > 0) {
            setConsecutiveLosses(0);
        }
    }
  }, [operationsLog, consecutiveLosses, maxConsecutiveLosses, cooldownSeconds, toast, config]);


  useEffect(() => {
    if (!enabled || !indicators || priceTicks.length < 2 || !user || isCooldownActive || isExecuting) {
      setActiveStrikeZone(null);
      return;
    }

    const runCycle = async () => {
      const regime = detectMarketRegime(indicators, botCandleData);
      setMarketRegime(regime);
      
      const currentPrice = priceTicks[priceTicks.length - 1].price;
      
      const allSignalsResult: (StrikeZone | null)[] = [
        detectHFMeanReversionZone(indicators, currentPrice),
        detectStandardTrendZone(indicators, currentPrice, rsiStateRef.current.prev),
        detectBollingerSqueezeZone(indicators, currentPrice),
        detectVolumeAbsorptionZone(botCandleData, indicators),
        detectMicrostructureScalpZone(priceTicks, botCandleData, indicators, currentPrice),
      ];
      setAllSignals(allSignalsResult);
      
      const validSignals = allSignalsResult.filter((zone): zone is StrikeZone => zone !== null && zone.type !== 'NEUTRAL' && zone.confidence >= minConfidence);
      
      let finalStrikeZone: StrikeZone | null = null;
      
      if (validSignals.length >= minConsensusSignals) {
        finalStrikeZone = validSignals.reduce((best, current) => 
          current.confidence > best.confidence ? current : best
        );
      }

      setActiveStrikeZone(finalStrikeZone);

      if (finalStrikeZone) {
        const pseudoSignal = {
          expectedWinRate: 0.5 + (finalStrikeZone.confidence - 50) / 100 * 0.4,
          confidence: finalStrikeZone.confidence,
        };
        let sizing = riskManager.calculatePositionSize(pseudoSignal, riskManager.currentCapital);
        let finalStake = manualStake || sizing.recommendedStake;

        if (manualStake) {
            sizing = {
                ...sizing,
                recommendedStake: manualStake,
                reasoning: ['Stake definido manualmente pelo operador.'],
            };
        }
        
        if (consecutiveLosses > 0 && martingaleMultiplier > 1) {
            finalStake = finalStake * Math.pow(martingaleMultiplier, consecutiveLosses);
            sizing.reasoning.push(`🔥 Martingale x${Math.pow(martingaleMultiplier, consecutiveLosses).toFixed(1)} aplicado.`);
        }
        
        setPositionSizing({...sizing, recommendedStake: finalStake});

        const openCouncilTrades = operationsLog.filter(op => op.status === 'pending' && op.initiator === 'HF_Strike').length;

        if (openCouncilTrades >= maxConcurrentTrades) {
            setActiveStrikeZone(prev => prev ? { ...prev, triggers: [...prev.triggers, `VETO: Limite de ${maxConcurrentTrades} ordens ativas atingido.`] } : null);
            return;
        }

        if (autoExecute) {
            setIsExecuting(true);
            try {
              const durationUnit: DurationUnit = finalStrikeZone.strategy === 'MICROSTRUCTURE_SCALP' ? 't' : 's';
              const tradeResult = await executeTrade(
                  finalStrikeZone.type === 'LONG_ENTRY' ? 'CALL' : 'PUT', finalStake, activeSymbol!, 
                  finalStrikeZone.type === 'LONG_ENTRY' ? 'rise' : 'fall', 
                  finalStrikeZone.duration,
                  durationUnit,
                  'HF_Strike',
                  finalStrikeZone.strategy
              );
              if (tradeResult.success && tradeResult.contractId) {
                toast({ title: '⚡ Strike Executado (Maior Confiança)!', description: `Estratégia: ${finalStrikeZone.strategy} | Stake: $${finalStake.toFixed(2)}` });
                await saveHFTradeLog(user.uid, {
                    symbol: activeSymbol!,
                    strikeZone: finalStrikeZone,
                    execution: { contractId: String(tradeResult.contractId), entryPrice: tradeResult.entryPrice!, status: 'pending', executedAt: new Date().toISOString() },
                    marketRegime: regime.regime,
                    ensembleParticipants: validSignals.map(s => s.strategy),
                    positionSize: sizing,
                    riskMetrics: { sharpeContribution: sizing.sharpeContribution, portfolioExposure: 0 }
                });
              } else {
                throw new Error(tradeResult.message);
              }
            } catch (error: any) {
              toast({ title: 'Erro na Auto-Execução', description: error.message, variant: 'destructive' });
            } finally {
              setIsExecuting(false);
            }
        }
      } else {
        setPositionSizing(null);
      }

      if (indicators.rsi) rsiStateRef.current.prev = indicators.rsi;
    };
    
    const timeoutId = setTimeout(runCycle, 200); 
    return () => clearTimeout(timeoutId);

  }, [indicators, priceTicks, enabled, botCandleData, user, riskManager, minConfidence, minConsensusSignals, autoExecute, executeTrade, activeSymbol, toast, martingaleMultiplier, consecutiveLosses, isCooldownActive, isExecuting, manualStake, operationsLog, maxConcurrentTrades]);
  
  return {
    activeStrikeZone, marketRegime, positionSizing, riskManager, fullIndicators: indicators,
    supplyDemandZones: (indicators as any)?.supplyDemandZones, allSignals, consecutiveLosses, isCooldownActive, isExecuting,
  };
}
