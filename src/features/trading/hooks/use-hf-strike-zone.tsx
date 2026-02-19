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
import { runAllStrategiesBacktest } from '../backtest/hf-backtest-engine';
import { getOptimalDuration, analyzeOptimalDuration, resetGBMCache } from '../services/gbm-calibrator';
import { TRADER_CONFIG } from '@/features/trading/config/trader-config';
import { runAutoCalibration, type AutoCalibrationResults } from '../optimization/auto-calibrator';


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

const RANDOM_ASSET_PARAMS = getRandomAssetParams();

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
  
  const lastBacktestRun = useRef<number>(0);
  const [lastCalibrationTime, setLastCalibrationTime] = useState(0);
  
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
    VOLUME_ABSORPTION: { climaxMultiplier: 1.8, absorptionFactor: 0.8, atrMultiplier: 1.2 },
    MICROSTRUCTURE_SCALP: { velocityThreshold: 1.2 }
  });

  const [gbmConfidenceThreshold, setGbmConfidenceThreshold] = useState(15);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState<Record<StrategyType, { progress: number, details: string }>>({} as any);

  const handleUpdateStrategyParams = useCallback((strategy: StrategyType | 'GBM', params: any) => {
    if (strategy === 'GBM') {
        if (params.confidenceThreshold !== undefined) {
            setGbmConfidenceThreshold(params.confidenceThreshold);
        }
    } else {
        setStrategyParams(prev => ({
            ...prev,
            [strategy]: { ...prev[strategy], ...params }
        }));
    }
  }, []);
  
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const [isCooldownActive, setIsCooldownActive] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const lastProcessedOpIdRef = useRef<number | null>(null);
  const executionLockRef = useRef(false);
  const lastGBMRunRef = useRef<number>(0);
  const gbmSignalsRef = useRef<{ gbm20: StrikeZone | null; gbm40: StrikeZone | null }>({ gbm20: null, gbm40: null });
  const lastVolatilityIndexRef = useRef<number>(0);
  const lastRecalibrationTimestampRef = useRef<number>(0);

  const indicators = useMemo((): Indicators | null => {
    if (!enabled || botCandleData.length < 100) return null;
    return calculateAllIndicators(botCandleData, initialStrategies, '1m', { duration: 1, unit: 't' });
  }, [botCandleData, enabled, initialStrategies]);
  
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
  
  const triggerAutoCalibration = useCallback(async (targetTradeFrequency: number) => {
      if (!activeSymbol) {
          toast({ title: "Selecione um ativo", variant: "destructive" });
          return;
      }
      setIsCalibrating(true);
      setCalibrationProgress({} as any);
      toast({ title: "🔬 Calibração Automática Iniciada", description: "Otimizando parâmetros..." });

      try {
          const historicalData = await getHistoricalData(activeSymbol, 'candles', 1500, '1m') as CandleData[];
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
          
          let updatedCount = 0;
          const newParams = { ...strategyParams };
          for (const key in results) {
              if (key === 'finalGbmThreshold') continue;
              const result = results[key as StrategyType];
              if (result && result.success) {
                  newParams[key as StrategyType] = result.finalParams;
                  updatedCount++;
              }
          }
          
          setStrategyParams(newParams);
          if (results.finalGbmThreshold && results.finalGbmThreshold !== gbmConfidenceThreshold) {
              setGbmConfidenceThreshold(results.finalGbmThreshold);
              // We count this as one "strategy type" updated.
              if (!Object.values(results).some(r => r?.strategy === 'GBM_20S' || r?.strategy === 'GBM_40S')) {
                  updatedCount++;
              }
          }
          
          toast({ title: "✅ Calibração Concluída!", description: `${updatedCount} tipos de estratégia foram otimizados.` });

      } catch (error: any) {
          toast({ title: "❌ Erro na Calibração", description: error.message, variant: "destructive" });
      } finally {
          setIsCalibrating(false);
      }
  }, [activeSymbol, getHistoricalData, strategyParams, config, toast, gbmConfidenceThreshold]);

  useEffect(() => {
    const candles = botCandleData;
    if (!config || !activeSymbol || candles.length < 200) return;
    
    const now = Date.now();
    if (now - lastBacktestRun.current < 5 * 60_000) return;
    
    lastBacktestRun.current = now;
    
    setTimeout(() => {
      console.log('[AUTO_CALIBRATE] Iniciando backtest em background para atualizar tempos ótimos...');
      const last500 = candles.slice(-500);
      const results = runAllStrategiesBacktest(last500, config, activeSymbol, strategyParams);
      
      if (results._optimalDurations) {
        console.log('[AUTO_CALIBRATE] Tempos ótimos atualizados:', results._optimalDurations);
        setLastCalibrationTime(Date.now());
      }
    }, 0);
  }, [botCandleData, config, activeSymbol, strategyParams]);
  
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
          if (!indicators || priceTicks.length < 2 || !user || !isConnected || !activeSymbol) {
            return;
          }

          const candles = botCandleData;
          const ticks = priceTicks;
          const regime = detectMarketRegime(indicators, candles);
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

          const currentPrice = ticks[ticks.length - 1].price;
          
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
    
          const now = Date.now();
          const GBM_THROTTLE_MS = 3000;
          
          if (now - lastGBMRunRef.current >= GBM_THROTTLE_MS) {
            lastGBMRunRef.current = now;
            const validTechnicals = technicalSignals.filter((z): z is StrikeZone => z !== null);
            gbmSignalsRef.current = {
              gbm20: detectGBM20sZone(candles, indicators, currentPrice, validTechnicals, { gbmConfidenceThreshold }),
              gbm40: detectGBM40sZone(candles, indicators, currentPrice, validTechnicals, { gbmConfidenceThreshold }),
            };
          }
          
          const gbm20sSignal = gbmSignalsRef.current.gbm20;
          const gbm40sSignal = gbmSignalsRef.current.gbm40;
    
          const allSignalsResult = [...technicalSignals, gbm20sSignal, gbm40sSignal];
          
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
          
          const validSignals = allSignalsResult
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
            
              console.log(`[CONSENSUS_DURATION] Duração final: ${optimalDuration.toFixed(1)}s | Fonte: ${durationSource}`);
              
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
                const preferredUnit: DurationUnit = calculatedDurationInSeconds <= 10 && canUseTicks ? 't' : 's';
                
                if (preferredUnit === 't' && canUseTicks) {
                    durationUnit = 't';
                    const durationInTicks = Math.max(5, Math.ceil(calculatedDurationInSeconds / 2));
                    finalDuration = Math.max(durationLimits.t.min, Math.min(durationInTicks, durationLimits.t.max));
                } 
                else if (canUseSeconds) {
                    durationUnit = 's';
                    finalDuration = Math.round(calculatedDurationInSeconds);
                    finalDuration = Math.max(durationLimits.s.min, Math.min(finalDuration, durationLimits.s.max));
                } 
                else if (canUseTicks) {
                    durationUnit = 't';
                    const durationInTicks = Math.max(5, Math.ceil(calculatedDurationInSeconds / 2));
                    finalDuration = Math.max(durationLimits.t.min, Math.min(durationInTicks, durationLimits.t.max));
                } 
                else {
                    durationUnit = 's';
                    finalDuration = 32;
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

  }, [
      dataVersion, enabled, isCooldownActive, isExecuting,
      indicators, priceTicks, user, isConnected, botCandleData, config, 
      activeSymbol, strategyParams, getIsRandom, applyOptimalDuration, 
      minConfidence, minConsensusSignals, operationsLog, autoExecute, 
      toast, saveHFTradeLog, riskManager, manualStake, consecutiveLosses, 
      martingaleMultiplier, maxConcurrentTrades, durationLimits, gbmConfidenceThreshold, executeTrade
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
  };
}
