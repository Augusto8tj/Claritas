// /src/features/trading/hooks/use-hf-strike-zone.tsx
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { TickData, CandleData, TimePeriod, Operation, DurationUnit, EnsembleSignal } from '@/lib/types';
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
import { getOptimalDuration, resetGBMCache } from '../services/gbm-calibrator';
import { TRADER_CONFIG } from '@/features/trading/config/trader-config';
import { runAutoCalibration, type AutoCalibrationResults } from '../optimization/auto-calibrator';
import { useStochasticModels } from './use-stochastic-models';


export type { StrikeZone, StrategyType };

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
  GBM_20S?: any;
  GBM_40S?: any;
  RANDOM_WALK?: any;
  ENSEMBLE?: any;
}

const RANDOM_ASSET_PARAMS = getRandomAssetParams();

const getTickDurationSeconds = (symbol: string | null): number => {
  if (!symbol) return 2;
  if (symbol.startsWith('1HZ')) return 1;
  if (symbol.startsWith('R_')) return 2;
  if (symbol.startsWith('CRASH') || symbol.startsWith('BOOM')) return 2;
  if (symbol.startsWith('STPIDX')) return 1;
  return 2;
};

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
  const { executeTrade, durationLimits, isConnected, dataVersion, getHistoricalData } = useDerivApiV2();
  const { enabled, minConfidence, autoExecute, maxConcurrentTrades, martingaleMultiplier, maxConsecutiveLosses, cooldownSeconds, preferredDuration, minConsensusSignals } = config;
  const { dailyBalance, dailyTarget, operationsLog, manualStake } = sessionConfig;
  
  const rsiStateRef = useRef({ prev: 50 });
  const initialStrategies = useMemo(() => getCouncilStrategies('standard'), []);
  
  const [lastCalibrationTime, setLastCalibrationTime] = useState(0);

  const { projectionExperts } = useStochasticModels(
    botCandleData, 
    priceTicks, 
    operationsLog.filter(op => op.initiator === 'Piloto'),
    null
  );
  
  const [marketRegime, setMarketRegime] = useState<RegimeCharacteristics | null>(null);
  const [activeStrikeZone, setActiveStrikeZone] = useState<StrikeZone | null>(null);
  const riskManager = useMemo(() => new AdvancedRiskManager({ maxDailyLoss: dailyBalance, maxDrawdown: 30, maxConcurrentTrades: 3, maxExposurePerAsset: 25, kellyFraction: 0.25 }, 1000), [dailyBalance]);
  
  const [positionSizing, setPositionSizing] = useState<PositionSizeRecommendation | null>(null);
  const [allSignals, setAllSignals] = useState<(StrikeZone | null)[]>([]);
  const strategyCountRef = useRef<Record<StrategyType, number>>({ 
      HF_MEAN_REVERSION: 0, STD_TREND_FOLLOW: 0, BOLLINGER_SQUEEZE: 0, VOLUME_ABSORPTION: 0, MICROSTRUCTURE_SCALP: 0, GBM_20S: 0, GBM_40S: 0, RANDOM_WALK: 0, ENSEMBLE: 0
  });
  const [strategyCounts, setStrategyCounts] = useState<Record<StrategyType, number>>(strategyCountRef.current);
  
  const [strategyParams, setStrategyParams] = useState<StrategyParams>({
    HF_MEAN_REVERSION: { rsiThreshold: 32, tolerance: 0.005 },
    STD_TREND_FOLLOW: { adxStrength: 15, rsiMomentum: 52 },
    BOLLINGER_SQUEEZE: { bbwThreshold: 1.5, breakoutMargin: 0.01 },
    VOLUME_ABSORPTION: { climaxMultiplier: 1.8, absorptionFactor: 0.8, atrMultiplier: 1.2 },
    MICROSTRUCTURE_SCALP: { velocityThreshold: 1.2 }
  });

  const [gbmConfidenceThreshold, setGbmConfidenceThreshold] = useState(15);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState<Record<StrategyType, { progress: number, details: string }>>({} as any);
  const [calibrationResults, setCalibrationResults] = useState<AutoCalibrationResults | null>(null);


  const handleUpdateStrategyParams = useCallback((strategy: StrategyType | 'GBM', params: any) => {
    if (strategy === 'GBM') {
        if (params.confidenceThreshold !== undefined) {
            setGbmConfidenceThreshold(params.confidenceThreshold);
        }
    } else {
        setStrategyParams(prev => ({
            ...prev,
            [strategy]: { ...(prev as any)[strategy], ...params }
        }));
    }
  }, []);
  
  const triggerAutoCalibration = useCallback(async (targetTradeFrequency: number, numCandles: number) => {
      if (!activeSymbol) {
          toast({ title: "Selecione um ativo", variant: "destructive" });
          return;
      }
      setIsCalibrating(true);
      setCalibrationResults(null);
      setCalibrationProgress({} as any);
      toast({ title: "🔬 Calibração Automática Iniciada", description: `Analisando últimas ${numCandles} velas...` });

      try {
          const historicalData = await getHistoricalData(activeSymbol, 'candles', numCandles, '1m') as CandleData[];
          if (historicalData.length < 500) throw new Error("Dados históricos insuficientes.");

          const results = await runAutoCalibration({
              candles: historicalData,
              initialParams: strategyParams,
              hfConfig: config,
              assetSymbol: activeSymbol,
              targetTradeFrequency,
              maxIterations: 20,
              onProgress: (strategy, progress, details) => {
                  setCalibrationProgress(prev => ({ ...prev, [strategy]: { progress, details } }));
              },
              gbmConfidenceThreshold: gbmConfidenceThreshold,
          });
          
          if (results) {
              setCalibrationResults(results);
              const newParams = { ...strategyParams };
              let updatedCount = 0;
              let gbmThresholdUpdated = false;

              Object.keys(results).forEach(key => {
                  if (key === 'finalGbmThreshold') {
                      if (results.finalGbmThreshold && results.finalGbmThreshold !== gbmConfidenceThreshold) {
                          setGbmConfidenceThreshold(results.finalGbmThreshold);
                          gbmThresholdUpdated = true;
                      }
                      return;
                  }
                  
                  const result = (results as any)[key];
                  if (result && result.success) {
                      (newParams as any)[key] = result.finalParams;
                      updatedCount++;
                  }
              });
              
              setStrategyParams(newParams);
              setLastCalibrationTime(Date.now());

              if (gbmThresholdUpdated) updatedCount++;

              toast({
                  title: "✅ Calibração Aplicada!",
                  description: `${updatedCount} especialistas foram otimizados e seus novos parâmetros estão ativos.`,
              });
          }

      } catch (error: any) {
          toast({ title: "❌ Erro na Calibração", description: error.message, variant: "destructive" });
      } finally {
          setIsCalibrating(false);
      }
  }, [activeSymbol, getHistoricalData, strategyParams, config, toast, gbmConfidenceThreshold]);

  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const [isCooldownActive, setIsCooldownActive] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const lastProcessedOpIdRef = useRef<number | null>(null);
  const executionLockRef = useRef(false);
  const lastVolatilityIndexRef = useRef<number>(0);
  const lastRecalibrationTimestampRef = useRef<number>(0);
  
  const indicators = useMemo((): Indicators | null => {
    if (!enabled || botCandleData.length < 100) return null;
    return calculateAllIndicators(botCandleData, initialStrategies, uiChartPeriod, { duration: 1, unit: 't' });
  }, [botCandleData, enabled, initialStrategies, uiChartPeriod]);
  
  const lastIsRandomCheck = useRef<number>(0);
  const isRandomCached = useRef<boolean>(false);
  const getIsRandom = useCallback((candles: CandleData[], indicators: Indicators | null) => {
    if (!indicators) return false;
    const now = Date.now();
    if (now - lastIsRandomCheck.current < 60_000) {
      return isRandomCached.current;
    }
    isRandomCached.current = isRandomAsset(candles, indicators);
    lastIsRandomCheck.current = now;
    return isRandomCached.current;
  }, []);
  
  const lastSignalCountClearTimeRef = useRef<number>(Date.now());
  useEffect(() => {
    const now = Date.now();
    if (now - lastSignalCountClearTimeRef.current > 30 * 60 * 1000) { 
      strategyCountRef.current = { HF_MEAN_REVERSION: 0, STD_TREND_FOLLOW: 0, BOLLINGER_SQUEEZE: 0, VOLUME_ABSORPTION: 0, MICROSTRUCTURE_SCALP: 0, GBM_20S: 0, GBM_40S: 0, RANDOM_WALK: 0, ENSEMBLE: 0 };
      lastSignalCountClearTimeRef.current = now;
    }
  }, [dataVersion]);
  
  const applyOptimalDuration = useCallback((zone: StrikeZone): StrikeZone => {
    const optimal = getOptimalDuration(zone.strategy);
    return { ...zone, duration: optimal };
  }, []);
  
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
    const timeoutId = setTimeout(() => {
      if (executionLockRef.current) return;
      if (!enabled || isCooldownActive || isExecuting) {
        setActiveStrikeZone(null);
        return;
      }
      executionLockRef.current = true;
      
      const runCycle = async () => {
        try {
          if (!indicators || !durationLimits) {
            executionLockRef.current = false;
            return;
          }
          const candles = botCandleData;
          const ticks = priceTicks;
          
          const currentIndicators = indicators;

          const regime = detectMarketRegime(currentIndicators, candles);
          setMarketRegime(regime);
          
          if (indicators.atr && indicators.bbw) {
            const VOLATILITY_CHANGE_THRESHOLD = 0.25; 
            const CALIBRATION_COOLDOWN_MS = 15000; 

            const currentVolatilityIndex = (indicators.atr * 0.7) + (indicators.bbw * 0.3);

            if (lastVolatilityIndexRef.current > 0) {
              const changePercent = Math.abs(currentVolatilityIndex - lastVolatilityIndexRef.current) / lastVolatilityIndexRef.current;
              
              const now = Date.now();
              if (changePercent > VOLATILITY_CHANGE_THRESHOLD && now - lastRecalibrationTimestampRef.current > CALIBRATION_COOLDOWN_MS) {
                console.log(`⚡️ [SENSOR DE VOLATILIDADE] Mudança de ${ (changePercent * 100).toFixed(1) }% detectada! Forçando recalibração dos parâmetros GBM.`);
                resetGBMCache();
                lastRecalibrationTimestampRef.current = now;
              }
            }
            lastVolatilityIndexRef.current = currentVolatilityIndex;
          }

          const currentPrice = ticks.length > 0 ? ticks[ticks.length - 1].price : 0;
          if (currentPrice === 0) return;
          
          const isRandom = getIsRandom(candles, indicators);
          const adaptiveParams = isRandom ? RANDOM_ASSET_PARAMS : strategyParams;
    
          const technicalSignals = [
              detectHFMeanReversionZone(indicators, currentPrice, adaptiveParams.HF_MEAN_REVERSION),
              detectStandardTrendZone(indicators, currentPrice, rsiStateRef.current.prev, adaptiveParams.STD_TREND_FOLLOW),
              detectBollingerSqueezeZone(indicators, currentPrice, adaptiveParams.BOLLINGER_SQUEEZE),
              detectVolumeAbsorptionZone(candles, indicators, adaptiveParams.VOLUME_ABSORPTION),
              detectMicrostructureScalpZone(ticks, candles, indicators, currentPrice, adaptiveParams.MICROSTRUCTURE_SCALP),
              detectRandomWalkZone(candles, indicators, currentPrice),
          ];

          const gbmExpert20s = projectionExperts.find(e => e.name === '20s');
          const gbmExpert40s = projectionExperts.find(e => e.name === '40s');

          const gbm20sSignal = detectGBM20sZone(candles, indicators, currentPrice, [], { gbmConfidenceThreshold, expertProjection: gbmExpert20s });
          const gbm40sSignal = detectGBM40sZone(candles, indicators, currentPrice, [], { gbmConfidenceThreshold, expertProjection: gbmExpert40s });
          
          const tickDurSec = getTickDurationSeconds(activeSymbol);
          const maxExecutableSeconds = durationLimits
            ? (durationLimits.s?.max ?? (durationLimits.t?.max ? durationLimits.t.max * tickDurSec : Infinity))
            : Infinity;
          
          const allSignalsResult = [...technicalSignals, gbm20sSignal, gbm40sSignal];
          
          const allSignalsNormalized = allSignalsResult.map(zone => {
            if (!zone || maxExecutableSeconds === Infinity) return zone;
            if (zone.duration > maxExecutableSeconds) {
              return { ...zone, duration: maxExecutableSeconds };
            }
            return zone;
          });

          setAllSignals(allSignalsResult);

          const newCounts = { ...strategyCountRef.current };
          let countsChanged = false;
          allSignalsNormalized.forEach(signal => {
            if (signal && signal.type !== 'NEUTRAL') {
              newCounts[signal.strategy]++;
              countsChanged = true;
            }
          });
          if (countsChanged) {
            strategyCountRef.current = newCounts;
            setStrategyCounts(newCounts);
          }
          
          const validSignals = allSignalsNormalized
            .filter((zone): zone is StrikeZone => {
              if (zone === null || zone.type === 'NEUTRAL') return false;
              const isGBM = zone.strategy === 'GBM_20S' || zone.strategy === 'GBM_40S';
              if (isGBM) return (zone.gbmRawConfidence ?? zone.confidence) >= gbmConfidenceThreshold;
              return zone.confidence >= minConfidence;
            })
            .map(applyOptimalDuration);
          
          const longSignals = validSignals.filter(s => s.type === 'LONG_ENTRY');
          const shortSignals = validSignals.filter(s => s.type === 'SHORT_ENTRY');
    
          let consensusSignal: StrikeZone | null = null;
          let ensembleParticipants: StrategyType[] = [];
    
          const determineConsensus = (participants: StrikeZone[], direction: 'LONG_ENTRY' | 'SHORT_ENTRY'): StrikeZone | null => {
              if (participants.length < minConsensusSignals) return null;
              
              const opponentSignals = direction === 'LONG_ENTRY' ? shortSignals : longSignals;
              const totalConfidence = participants.reduce((sum, s) => sum + s.confidence, 0);
              const opponentConfidence = opponentSignals.reduce((sum, s) => sum + s.confidence, 0);
    
              if (totalConfidence <= opponentConfidence) return null;
    
              const initialWeightedDuration = participants.length > 0 ? participants.reduce((sum, s) => sum + s.duration * s.confidence, 0) / participants.reduce((sum, s) => sum + s.confidence, 0) : 30;
              
              let optimalDuration = initialWeightedDuration;
              let durationSource = "Média Ponderada Técnica";
            
              if (indicators && indicators.bbw) {
                if (indicators.bbw > 2.5) {
                  optimalDuration *= 0.8;
                  durationSource += ' (Alta Volatilidade)';
                } else if (indicators.bbw < 0.8) {
                  optimalDuration *= 1.2;
                  durationSource += ' (Baixa Volatilidade)';
                }
              }
            
              const predictiveParticipants = participants.filter(
                p => p.strategy === 'GBM_20S' || p.strategy === 'GBM_40S'
              );
            
              if (predictiveParticipants.length > 0) {
                const mostConfidentPredictor = predictiveParticipants.reduce(
                  (best, current) => current.confidence > best.confidence ? current : best
                );
                optimalDuration = mostConfidentPredictor.duration;
                durationSource = `GBM Preditor (${mostConfidentPredictor.strategy}, conf=${mostConfidentPredictor.confidence.toFixed(0)}%)`;
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
            const ensembleSignal: EnsembleSignal = {
              direction: consensusSignal.type === 'LONG_ENTRY' ? 'LONG' : 'SHORT',
              confidence: consensusSignal.confidence,
              participants: ensembleParticipants.map(p => ({ 
                strategy: p, 
                vote: (consensusSignal!.type === 'LONG_ENTRY' ? 'LONG' : 'SHORT') as "LONG" | "SHORT" | "NEUTRAL", 
                weight: 1.0, 
                confidence: consensusSignal!.confidence 
              })),
              reasoning: consensusSignal.triggers.join(', '),
              expectedWinRate: 0.5 + (consensusSignal.confidence - 50) / 100 * 0.4,
              suggestedStake: manualStake || 1.0,
            };

            let sizing = riskManager.calculatePositionSize(ensembleSignal, riskManager.currentCapital);
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
                  console.error("[HF-STRIKE] BUG: Tentativa de execução sem limites de duração definidos.");
                  return;
              }
            
              let finalDuration: number;
              let durationUnit: DurationUnit;
              const calculatedDurationInSeconds = consensusSignal.duration;
              
              const canUseSeconds = !!(durationLimits.s && durationLimits.s.min > 0);
              const canUseTicks = !!(durationLimits.t && durationLimits.t.min > 0);
              const canUseMinutes = !!(durationLimits.m && durationLimits.m.min > 0);
              
              if (canUseSeconds && durationLimits.s && calculatedDurationInSeconds >= durationLimits.s.min) {
                durationUnit = 's';
                finalDuration = Math.round(Math.max(calculatedDurationInSeconds, durationLimits.s.min));
                finalDuration = Math.min(finalDuration, durationLimits.s.max);
              } else if (canUseTicks) {
                durationUnit = 't';
                const durationInTicks = Math.ceil(calculatedDurationInSeconds / tickDurSec);
                const clampedTicks = Math.max(durationLimits.t!.min, Math.min(durationInTicks, durationLimits.t!.max));
                finalDuration = clampedTicks;
              } else if (canUseMinutes) {
                durationUnit = 'm';
                const durationInMinutes = Math.ceil(calculatedDurationInSeconds / 60);
                finalDuration = Math.max(durationLimits.m!.min, Math.min(durationInMinutes, durationLimits.m!.max));
              } else {
                durationUnit = 't';
                finalDuration = 5;
                console.error(`[HF-STRIKE] FALLBACK ABSOLUTO: Nenhuma unidade de duração disponível. Enviando 5 ticks.`);
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
              if (tradeResult.success && tradeResult.contractId && user) {
                toast({ title: '⚡ Strike de Consenso Executado!', description: `${ensembleParticipants.length} especialistas concordaram. Stake: $${finalStake.toFixed(2)}` });
                await saveHFTradeLog(user.uid, {
                    symbol: activeSymbol!,
                    strikeZone: consensusSignal,
                    execution: { contractId: String(tradeResult.contractId), entryPrice: tradeResult.entryPrice!, status: 'pending', executedAt: new Date().toISOString() },
                    marketRegime: regime.regime,
                    ensembleParticipants: ensembleParticipants,
                    positionSize: {
                      recommended: sizing.recommendedStake,
                      actual: finalStake,
                      reasoning: sizing.reasoning
                    },
                    riskMetrics: { sharpeContribution: sizing.sharpeContribution, portfolioExposure: 0 }
                });
              } else {
                throw new Error(tradeResult.message);
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

  }, [
      dataVersion, enabled, isCooldownActive, isExecuting,
      botCandleData, priceTicks, user, isConnected,
      config, activeSymbol, strategyParams, getIsRandom, 
      applyOptimalDuration, toast, 
      getHistoricalData,
      indicators,
      minConfidence, minConsensusSignals, operationsLog, autoExecute, 
      saveHFTradeLog, riskManager, manualStake, consecutiveLosses, 
      martingaleMultiplier, maxConcurrentTrades, durationLimits, gbmConfidenceThreshold, executeTrade, projectionExperts
  ]);
  
  return {
    activeStrikeZone, marketRegime, positionSizing, riskManager, fullIndicators: indicators,
    supplyDemandZones: (indicators as any)?.supplyDemandZones,
    allSignals, strategyCounts, consecutiveLosses, isCooldownActive, isExecuting,
    strategyParams, updateStrategyParams: handleUpdateStrategyParams,
    lastCalibrationTime,
    gbmConfidenceThreshold,
    isCalibrating,
    calibrationProgress,
    triggerAutoCalibration,
    calibrationResults,
    setCalibrationResults
  };
}
