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
  detectRandomWalkZone,
  detectGBM20sZone,
  detectGBM40sZone,
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
  const { toast } = useToast();
  const { executeTrade, durationLimits, isConnected, dataVersion } = useDerivApiV2();
  const { enabled, minConfidence, autoExecute, maxConcurrentTrades, martingaleMultiplier, maxConsecutiveLosses, cooldownSeconds, preferredDuration, minConsensusSignals } = config;
  const { dailyBalance, dailyTarget, operationsLog, manualStake } = sessionConfig;
  
  const rsiStateRef = useRef({ prev: 50 });
  const initialStrategies = useMemo(() => getCouncilStrategies('standard'), []);
  
  const [marketRegime, setMarketRegime] = useState<RegimeCharacteristics | null>(null);
  const [activeStrikeZone, setActiveStrikeZone] = useState<StrikeZone | null>(null);
  const [riskManager] = useState(() => new AdvancedRiskManager({ maxDailyLoss: dailyBalance, maxDrawdown: 30, maxConcurrentTrades: 3, maxExposurePerAsset: 25, kellyFraction: 0.25 }, 1000));
  const [positionSizing, setPositionSizing] = useState<PositionSizeRecommendation | null>(null);
  const [allSignals, setAllSignals] = useState<(StrikeZone | null)[]>([]);
  const [strategyCounts, setStrategyCounts] = useState<Record<StrategyType, number>>({ 
      HF_MEAN_REVERSION: 0, 
      STD_TREND_FOLLOW: 0, 
      BOLLINGER_SQUEEZE: 0, 
      VOLUME_ABSORPTION: 0, 
      MICROSTRUCTURE_SCALP: 0,
      GBM_20S: 0,
      GBM_40S: 0
  });
  
  const [strategyParams, setStrategyParams] = useState<StrategyParams>({
    HF_MEAN_REVERSION: { rsiThreshold: 32, tolerance: 0.005 },
    STD_TREND_FOLLOW: { adxStrength: 15, rsiMomentum: 52 },
    BOLLINGER_SQUEEZE: { bbwThreshold: 1.5, breakoutMargin: 0.01 },
    VOLUME_ABSORPTION: { climaxMultiplier: 1.8, absorptionFactor: 0.8 },
    MICROSTRUCTURE_SCALP: { velocityThreshold: 1.2 }
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
  const executionLockRef = useRef(false);
  
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
    if (!enabled || isCooldownActive || isExecuting) {
      setActiveStrikeZone(null);
      return;
    }

    const timeoutId = setTimeout(() => {
      if (executionLockRef.current) return;
      executionLockRef.current = true;
      
      const runCycle = async () => {
        try {
          if (!indicators || priceTicks.length < 2 || !user || !isConnected) {
            return;
          }

          const candles = botCandleData;
          const ticks = priceTicks;
          const regime = detectMarketRegime(indicators, candles);
          setMarketRegime(regime);
          
          const currentPrice = ticks[ticks.length - 1].price;
          
          const isRandom = isRandomAsset(candles, indicators);
          const adaptiveParams = isRandom ? getRandomAssetParams() : strategyParams;
    
          const allSignalsResult: (StrikeZone | null)[] = [
            detectHFMeanReversionZone(indicators, currentPrice, adaptiveParams.HF_MEAN_REVERSION),
            detectStandardTrendZone(indicators, currentPrice, rsiStateRef.current.prev, adaptiveParams.STD_TREND_FOLLOW),
            detectBollingerSqueezeZone(indicators, currentPrice, adaptiveParams.BOLLINGER_SQUEEZE),
            detectVolumeAbsorptionZone(candles, indicators, adaptiveParams.VOLUME_ABSORPTION),
            detectMicrostructureScalpZone(ticks, candles, indicators, currentPrice, adaptiveParams.MICROSTRUCTURE_SCALP),
            detectRandomWalkZone(candles, indicators, currentPrice),
            detectGBM20sZone(indicators, currentPrice),
            detectGBM40sZone(indicators, currentPrice),
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
    
          const determineConsensus = (participants: StrikeZone[], direction: 'LONG_ENTRY' | 'SHORT_ENTRY'): StrikeZone | null => {
              if (participants.length < minConsensusSignals) return null;
              
              const totalConfidence = participants.reduce((sum, s) => sum + s.confidence, 0);
              const opponentSignals = direction === 'LONG_ENTRY' ? shortSignals : longSignals;
              const opponentConfidence = opponentSignals.reduce((sum, s) => sum + s.confidence, 0);
    
              if (totalConfidence <= opponentConfidence) return null;
    
              let optimalDuration = 32; // Fallback
              let durationSource = "Fallback";
    
              const predictiveParticipants = participants.filter(
                p => p.strategy === 'GBM_20S' || p.strategy === 'GBM_40S'
              );
    
              if (predictiveParticipants.length > 0) {
                  const mostConfidentPredictor = predictiveParticipants.reduce(
                      (best, current) => current.confidence > best.confidence ? current : best
                  );
                  optimalDuration = mostConfidentPredictor.duration;
                  durationSource = `Preditor de Elite (${mostConfidentPredictor.strategy})`;
              } 
              else {
                  const nonPredictiveParticipants = participants;
                  if (nonPredictiveParticipants.length > 0) {
                      const totalWeight = nonPredictiveParticipants.reduce((sum, s) => sum + s.confidence, 0);
                      const weightedDuration = nonPredictiveParticipants.reduce((sum, s) => sum + s.duration * s.confidence, 0);
                      if (totalWeight > 0) {
                          optimalDuration = weightedDuration / totalWeight;
                          durationSource = "Média Ponderada Técnica";
                          
                          if (indicators && indicators.bbw) {
                              if (indicators.bbw > 2.5) {
                                  optimalDuration *= 0.8;
                                  durationSource += ' (Ajuste Volatilidade Alta)';
                              } else if (indicators.bbw < 0.8) {
                                  optimalDuration *= 1.2;
                                  durationSource += ' (Ajuste Volatilidade Baixa)';
                              }
                          }
                      }
                  }
              }
              
              const avgConfidence = totalConfidence / participants.length;
              const leadSignal = participants.reduce((best, s) => s.confidence > best.confidence ? s : best, participants[0]);
              ensembleParticipants = participants.map(p => p.strategy);
    
              return {
                  ...leadSignal,
                  type: direction,
                  confidence: avgConfidence,
                  duration: optimalDuration,
                  triggers: [...participants.map(s => strategyMetadata[s.strategy].label), `Tempo: ${durationSource}`],
                  strategy: 'ENSEMBLE' as any,
              };
          };
    
          consensusSignal = determineConsensus(longSignals, 'LONG_ENTRY') ?? determineConsensus(shortSignals, 'SHORT_ENTRY');
          
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
              if (!durationLimits) {
                toast({ title: '⚠️ Aguardando Sincronização...', description: 'Ainda não recebemos os limites de duração do contrato da corretora. A ordem será enviada assim que os dados chegarem.', variant: 'default' });
                return;
              }
              setIsExecuting(true);
              try {
                let finalDuration: number;
                let durationUnit: DurationUnit;
                const calculatedDurationInSeconds = consensusSignal.duration;
                const canUseTicks = durationLimits?.t && durationLimits.t.min > 0;
                const canUseSeconds = durationLimits?.s && durationLimits.s.min > 0;
  
                if (canUseTicks && calculatedDurationInSeconds <= 10) {
                    durationUnit = 't';
                    const durationInTicks = Math.max(5, Math.ceil(calculatedDurationInSeconds / 2));
                    finalDuration = Math.max(durationLimits.t.min, Math.min(durationInTicks, durationLimits.t.max));
                } else if (canUseSeconds) {
                    durationUnit = 's';
                    finalDuration = Math.round(calculatedDurationInSeconds);
                    finalDuration = Math.max(durationLimits.s.min, Math.min(finalDuration, durationLimits.s.max));
                } else if (canUseTicks) { // Fallback para ticks se for a única opção
                    durationUnit = 't';
                    const durationInTicks = Math.max(5, Math.ceil(calculatedDurationInSeconds / 2));
                    finalDuration = Math.max(durationLimits.t.min, Math.min(durationInTicks, durationLimits.t.max));
                } else {
                    durationUnit = 's';
                    finalDuration = 32; // Fallback
                    console.error(`[HF-STRIKE] BUG: Limites de duração NULOS, mas a guarda falhou. Usando fallback de 32s. ActiveSymbol: ${activeSymbol}`);
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
        } finally {
          executionLockRef.current = false;
        }
      };

      runCycle();
      
    }, TRADER_CONFIG.THROTTLE_MS);

    return () => clearTimeout(timeoutId);

  }, [dataVersion, enabled, isCooldownActive, isExecuting]);
  
  return {
    activeStrikeZone, marketRegime, positionSizing, riskManager, fullIndicators: indicators,
    supplyDemandZones: (indicators as any)?.supplyDemandZones, allSignals, strategyCounts, consecutiveLosses, isCooldownActive, isExecuting,
    strategyParams, updateStrategyParams: handleUpdateStrategyParams,
  };
}
