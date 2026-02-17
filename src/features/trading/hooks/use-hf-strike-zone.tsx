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
  type StrategyType,
  MeanReversionParams,
  TrendFollowParams,
  SqueezeParams,
  AbsorptionParams,
  ScalpParams,
  strategyMetadata,
  isRandomAsset,
  getRandomAssetParams
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

export interface StrategyParams {
  HF_MEAN_REVERSION: MeanReversionParams;
  STD_TREND_FOLLOW: TrendFollowParams;
  BOLLINGER_SQUEEZE: SqueezeParams;
  VOLUME_ABSORPTION: AbsorptionParams;
  MICROSTRUCTURE_SCALP: ScalpParams;
}

export function useHFStrikeZone(
  activeSymbol: string | null,
  priceTicks: TickData[],
  botCandleData: CandleData[],
  uiChartPeriod: TimePeriod,
  config: HFConfig,
  onConfigChange: (config: Partial<HFConfig>) => void,
  sessionConfig: SessionConfig
) {
  const { user } = useAuth();
  const { executeTrade, durationLimits } = useDerivApiV2();
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
  const [strategyCounts, setStrategyCounts] = useState<Record<StrategyType, number>>({ HF_MEAN_REVERSION: 0, STD_TREND_FOLLOW: 0, BOLLINGER_SQUEEZE: 0, VOLUME_ABSORPTION: 0, MICROSTRUCTURE_SCALP: 0 });
  
  const [strategyParams, setStrategyParams] = useState<StrategyParams>({
    HF_MEAN_REVERSION: { rsiThreshold: 32, tolerance: 0.0015 },
    STD_TREND_FOLLOW: { adxStrength: 22, rsiMomentum: 52 },
    BOLLINGER_SQUEEZE: { bbwThreshold: 1.0, breakoutMargin: 0.02 },
    VOLUME_ABSORPTION: { climaxMultiplier: 1.8, absorptionFactor: 0.8 },
    MICROSTRUCTURE_SCALP: { velocityThreshold: 1.5 }
  });

  const handleUpdateStrategyParams = useCallback((strategy: StrategyType, params: any) => {
    setStrategyParams(prev => ({
        ...prev,
        [strategy]: { ...prev[strategy], ...params }
    }));
  }, []);
  
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
                onConfigChange({ autoExecute: false });
            } else if (cooldownSeconds > 0) {
                setIsCooldownActive(true);
                toast({ title: '❄️ Cooldown Ativado', description: `Pausa de ${cooldownSeconds}s após perda.`, variant: 'default' });
                setTimeout(() => setIsCooldownActive(false), cooldownSeconds * 1000);
            }
        } else if (lastOp.result! > 0) {
            setConsecutiveLosses(0);
        }
    }
  }, [operationsLog, consecutiveLosses, maxConsecutiveLosses, cooldownSeconds, toast, onConfigChange]);


  useEffect(() => {
    if (!enabled || !indicators || priceTicks.length < 2 || !user || isCooldownActive || isExecuting) {
      setActiveStrikeZone(null);
      return;
    }

    const runCycle = async () => {
      const regime = detectMarketRegime(indicators, botCandleData);
      setMarketRegime(regime);
      
      const currentPrice = priceTicks[priceTicks.length - 1].price;
      
      const isRandom = isRandomAsset(botCandleData, indicators);
      const adaptiveParams = isRandom ? getRandomAssetParams() : strategyParams;

      const allSignalsResult: (StrikeZone | null)[] = [
        detectHFMeanReversionZone(indicators, currentPrice, adaptiveParams.meanReversion),
        detectStandardTrendZone(indicators, currentPrice, rsiStateRef.current.prev, adaptiveParams.trendFollow),
        detectBollingerSqueezeZone(indicators, currentPrice, adaptiveParams.squeeze),
        detectVolumeAbsorptionZone(botCandleData, indicators, adaptiveParams.absorption),
        detectMicrostructureScalpZone(priceTicks, botCandleData, indicators, currentPrice, adaptiveParams.scalp),
      ];
      setAllSignals(allSignalsResult);

      const newCounts = { ...strategyCounts };
      let countsChanged = false;
      allSignalsResult.forEach(signal => {
        if (signal && signal.type !== 'NEUTRAL') {
          newCounts[signal.strategy]++;
          countsChanged = true;
        }
      });
      if (countsChanged) {
        setStrategyCounts(newCounts);
      }
      
      const validSignals = allSignalsResult.filter((zone): zone is StrikeZone => 
        zone !== null && zone.type !== 'NEUTRAL' && zone.confidence >= minConfidence
      );
      
      const longSignals = validSignals.filter(s => s.type === 'LONG_ENTRY');
      const shortSignals = validSignals.filter(s => s.type === 'SHORT_ENTRY');

      let consensusSignal: StrikeZone | null = null;
      let ensembleParticipants: StrategyType[] = [];

      if (longSignals.length >= minConsensusSignals) {
          const participants = longSignals;
          const totalConfidence = participants.reduce((sum, s) => sum + s.confidence, 0);
          const opponentConfidence = shortSignals.reduce((sum, s) => sum + s.confidence, 0);
          const netConfidence = totalConfidence - opponentConfidence;
          
          if (netConfidence > 0) {
              const avgConfidence = totalConfidence / participants.length;
              const avgDuration = Math.round(participants.reduce((sum, s) => sum + s.duration, 0) / participants.length);
              const leadSignal = participants.reduce((best, s) => s.confidence > best.confidence ? s : best, participants[0]);
              ensembleParticipants = participants.map(p => p.strategy);

              consensusSignal = {
                  ...leadSignal,
                  type: 'LONG_ENTRY',
                  confidence: avgConfidence,
                  duration: avgDuration,
                  triggers: participants.map(s => strategyMetadata[s.strategy].label),
                  strategy: 'ENSEMBLE' as any,
              };
          }
      } else if (shortSignals.length >= minConsensusSignals) {
          const participants = shortSignals;
          const totalConfidence = participants.reduce((sum, s) => sum + s.confidence, 0);
          const opponentConfidence = longSignals.reduce((sum, s) => sum + s.confidence, 0);
          const netConfidence = totalConfidence - opponentConfidence;
          
          if(netConfidence > 0) {
              const avgConfidence = totalConfidence / participants.length;
              const avgDuration = Math.round(participants.reduce((sum, s) => sum + s.duration, 0) / participants.length);
              const leadSignal = participants.reduce((best, s) => s.confidence > best.confidence ? s : best, participants[0]);
              ensembleParticipants = participants.map(p => p.strategy);

              consensusSignal = {
                  ...leadSignal,
                  type: 'SHORT_ENTRY',
                  confidence: avgConfidence,
                  duration: avgDuration,
                  triggers: participants.map(s => strategyMetadata[s.strategy].label),
                  strategy: 'ENSEMBLE' as any,
              };
          }
      }

      setActiveStrikeZone(consensusSignal);

      if (consensusSignal) {
        const pseudoSignal = {
          expectedWinRate: 0.5 + (consensusSignal.confidence - 50) / 100 * 0.4,
          confidence: consensusSignal.confidence,
        };
        let sizing = riskManager.calculatePositionSize(pseudoSignal, riskManager.currentCapital);
        let finalStake = sizing.recommendedStake;

        if (manualStake && manualStake > 0) {
            finalStake = manualStake;
            sizing = { ...sizing, recommendedStake: finalStake, reasoning: ['Stake definido manualmente pelo operador.'], };
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
              let finalDuration: number;
              let durationUnit: DurationUnit;
              const calculatedDurationInSeconds = consensusSignal.duration;
              const canUseTicks = durationLimits?.t && durationLimits.t.min > 0;
              const canUseSeconds = durationLimits?.s && durationLimits.s.min > 0;

              if (canUseTicks && calculatedDurationInSeconds <= 10) {
                  durationUnit = 't';
                  const durationInTicks = Math.ceil(calculatedDurationInSeconds / 2);
                  finalDuration = Math.max(durationLimits.t.min, Math.min(durationInTicks, durationLimits.t.max));
              } else if (canUseSeconds) {
                  durationUnit = 's';
                  finalDuration = Math.round(calculatedDurationInSeconds);
                  finalDuration = Math.max(durationLimits.s.min, Math.min(finalDuration, durationLimits.s.max));
              } else if (canUseTicks) {
                  durationUnit = 't';
                  const durationInTicks = Math.ceil(calculatedDurationInSeconds / 2);
                  finalDuration = Math.max(durationLimits.t.min, Math.min(durationInTicks, durationLimits.t.max));
              } else {
                  durationUnit = 's';
                  finalDuration = 15;
                  console.warn(`[HF-STRIKE] Nenhum limite de duração válido encontrado para ${activeSymbol}. Usando fallback: 15s.`);
              }
              
              const tradeResult = await executeTrade(
                  consensusSignal.type === 'LONG_ENTRY' ? 'CALL' : 'PUT', 
                  finalStake, 
                  activeSymbol!, 
                  consensusSignal.type === 'LONG_ENTRY' ? 'rise' : 'fall', 
                  finalDuration,
                  durationUnit,
                  'HF_Strike',
                  ensembleParticipants.join(', ')
              );
              if (tradeResult.success && tradeResult.contractId) {
                toast({ title: '⚡ Strike de Consenso Executado!', description: `${ensembleParticipants.length} especialistas concordaram. Stake: $${finalStake.toFixed(2)}` });
                await saveHFTradeLog(user.uid, {
                    symbol: activeSymbol!,
                    strikeZone: consensusSignal,
                    execution: { contractId: String(tradeResult.contractId), entryPrice: tradeResult.entryPrice!, status: 'pending', executedAt: new Date().toISOString() },
                    marketRegime: regime.regime,
                    ensembleParticipants: ensembleParticipants,
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
    
    // Using a simple debounce/throttle
    const timeoutId = setTimeout(runCycle, 250); 
    return () => clearTimeout(timeoutId);

  }, [indicators, priceTicks, enabled, botCandleData, user, riskManager, minConfidence, minConsensusSignals, autoExecute, executeTrade, activeSymbol, toast, martingaleMultiplier, consecutiveLosses, isCooldownActive, isExecuting, manualStake, operationsLog, maxConcurrentTrades, onConfigChange, strategyParams, durationLimits]);
  
  return {
    activeStrikeZone, marketRegime, positionSizing, riskManager, fullIndicators: indicators,
    supplyDemandZones: (indicators as any)?.supplyDemandZones, allSignals, strategyCounts, consecutiveLosses, isCooldownActive, isExecuting,
    strategyParams, updateStrategyParams: handleUpdateStrategyParams,
  };
}
