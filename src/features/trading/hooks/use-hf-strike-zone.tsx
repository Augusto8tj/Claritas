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
import { runSingleStrategyBacktest, runAllStrategiesBacktest } from '../backtest/hf-backtest-engine';
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
  
  const triggerAutoCalibration = useCallback(async (targetTradeFrequency: number, numCandles: number) => {
      if (!activeSymbol) {
          toast({ title: "Selecione um ativo", variant: "destructive" });
          return;
      }
      setIsCalibrating(true);
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
                  
                  const result = results[key as StrategyType];
                  if (result && result.success) {
                      newParams[key as StrategyType] = result.finalParams;
                      updatedCount++;
                  }
              });
              
              setStrategyParams(newParams);

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
  const lastGBMRunRef = useRef<number>(0);
  const gbmSignalsRef = useRef<{ gbm20: StrikeZone | null; gbm40: StrikeZone | null }>({ gbm20: null, gbm40: null });
  const lastVolatilityIndexRef = useRef<number>(0);
  const lastRecalibrationTimestampRef = useRef<number>(0);
  
  // Helper: retorna duração aproximada de 1 tick em segundos para o ativo
  const getTickDurationSeconds = useCallback((symbol: string | null): number => {
    if (!symbol) return 2; // padrão seguro
    // Ativos 1HZ: 1 tick por segundo
    if (symbol.startsWith('1HZ')) return 1;
    // Ativos R_ (Volatility Index): ~2s por tick
    if (symbol.startsWith('R_')) return 2;
    // Crash/Boom: tick a cada poucos segundos
    if (symbol.startsWith('CRASH') || symbol.startsWith('BOOM')) return 2;
    // Step Index: 1 tick por segundo
    if (symbol.startsWith('STPIDX')) return 1;
    // Padrão
    return 2;
  }, []);

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
  
  useEffect(() => {
    const candles = botCandleData;
    if (!config || !activeSymbol || candles.length < 200) return;
    
    const now = Date.now();
    if (now - lastBacktestRun.current < 5 * 60_000) return;
    
    lastBacktestRun.current = now;
    
    setTimeout(() => {
      console.log('[AUTO_CALIBRATE] Iniciando backtest em background para atualizar tempos ótimos...');
      const last500 = candles.slice(-500);
      const results = runAllStrategiesBacktest(last500, config, activeSymbol, strategyParams, { gbmConfidenceThreshold });
      
      if (results._optimalDurations) {
        console.log('[AUTO_CALIBRATE] Tempos ótimos atualizados:', results._optimalDurations);
        setLastCalibrationTime(Date.now());
      }
    }, 0);
  }, [botCandleData, config, activeSymbol, strategyParams, gbmConfidenceThreshold]);
  
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
          if (!indicators || priceTicks.length < 2 || !user || !isConnected || !activeSymbol || !durationLimits) {
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
              gbm20: detectGBM20sZone(candles, indicators, currentPrice, validTechnicals),
              gbm40: detectGBM40sZone(candles, indicators, currentPrice, validTechnicals),
            };
          }
          
          const gbm20sSignal = gbmSignalsRef.current.gbm20;
          const gbm40sSignal = gbmSignalsRef.current.gbm40;
    
          const allSignalsResult = [...technicalSignals, gbm20sSignal, gbm40sSignal];
          
          setAllSignals(allSignalsResult);
          
          // Normalizar durações ao máximo executável pelo ativo antes do filtro/consenso
          // Evita que médias ponderadas sejam distorcidas por durações impossíveis
          const tickDurSec = getTickDurationSeconds(activeSymbol);
          const maxExecutableSeconds = durationLimits
            ? (durationLimits.s?.max                              // preferir segundos
              ?? (durationLimits.t?.max ? durationLimits.t.max * tickDurSec : null) // ou ticks
              ?? (durationLimits.m?.max ? durationLimits.m.max * 60 : null)         // ou minutos
              ?? Infinity)
            : Infinity;
          
          const allSignalsNormalized = allSignalsResult.map(zone => {
            if (!zone || maxExecutableSeconds === Infinity) return zone;
            if (zone.duration > maxExecutableSeconds) {
              return { ...zone, duration: maxExecutableSeconds };
            }
            return zone;
          });
    
          const newCounts = { ...strategyCounts };
          let countsChanged = false;
          allSignalsNormalized.forEach(signal => {
            if (signal && signal.type !== 'NEUTRAL') {
              newCounts[signal.strategy]++;
              countsChanged = true;
            }
          });
          if (countsChanged) {
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
              let finalDuration: number;
              let durationUnit: DurationUnit;
              const calculatedDurationInSeconds = consensusSignal.duration;
              
              // ✅ CORRIGIDO: verificar max > 0, não min > 0
              // min pode ser 0 ou 1 (ambos válidos). O que importa é ter um max definido.
              const canUseTicks = !!(durationLimits.t && durationLimits.t.max > 0);
              const canUseSeconds = !!(durationLimits.s && durationLimits.s.max > 0);
              
              // Log diagnóstico para confirmar os limites recebidos
              console.log(`[DURATION_EXEC] Limites: t=${JSON.stringify(durationLimits.t)} s=${JSON.stringify(durationLimits.s)} | canUseTicks=${canUseTicks} canUseSeconds=${canUseSeconds} | calculado=${calculatedDurationInSeconds.toFixed(1)}s`);
              
              if (canUseTicks && calculatedDurationInSeconds <= 10) {
                  durationUnit = 't';
                  const durationInTicks = Math.ceil(calculatedDurationInSeconds / 2);
                  finalDuration = Math.max(durationLimits.t.min, Math.min(durationInTicks, durationLimits.t.max));
              } else if (canUseSeconds) {
                  durationUnit = 's';
                  finalDuration = Math.round(Math.max(calculatedDurationInSeconds, durationLimits.s.min));
                  finalDuration = Math.min(finalDuration, durationLimits.s.max);
              } else if (canUseTicks) {
                  durationUnit = 't';
                  const durationInTicks = Math.ceil(calculatedDurationInSeconds / 2);
                  finalDuration = Math.max(durationLimits.t.min, Math.min(durationInTicks, durationLimits.t.max));
              } else {
                  durationUnit = 't';
                  finalDuration = 5;
                  console.error(
                    `[HF-STRIKE] FALLBACK ABSOLUTO: Nenhuma unidade de duração disponível. ` +
                    `Enviando 5 ticks. durationLimits: ${JSON.stringify(durationLimits)}`
                  );
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
      martingaleMultiplier, maxConcurrentTrades, durationLimits, gbmConfidenceThreshold, executeTrade, getTickDurationSeconds
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

```
- src/features/trading/hooks/use-deriv-api-v2.tsx:
```tsx
// /src/features/trading/hooks/use-deriv-api-v2.tsx
'use client';

// ESTE ARQUIVO É UMA CÓPIA DEDICADA PARA O SISTEMA V2.5

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback, useRef, useMemo } from 'react';
import type { TradeResult } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import type { Operation, OperationInitiator, DurationUnit, ChartType, TimePeriod, ChartData, CandleData, TradeAnnotation, TickData, DurationLimits, Asset } from '@/lib/types';
import { FirebaseErrorListener } from '@/components/firebase-error-listener';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { savePredictiveTradeLog } from '@/services/financial-data-service';


const DERIV_DEMO_TOKEN_KEY = 'derivDemoApiToken';
const DERIV_REAL_TOKEN_KEY = 'derivRealApiToken';
const DERIV_ACCOUNT_TYPE_KEY = 'derivAccountType';
const DERIV_V2_LOG_KEY = 'derivV2OperationsLog_v2.5';
const DERIV_APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID || "1089";

export type AccountType = 'demo' | 'real';

export interface AccountBalance {
  balance: number | null;
  currency: string | null;
  loading: boolean;
}

export type PromiseCallbacks = { 
  resolve: (value: any) => void; 
  reject: (reason?: any) => void 
};

export interface AssetGroup {
  label: string;
  options: Asset[];
}

export type ApiHistoricalData = {
    epoch: number;
    price?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
};

export interface DerivApiContextTypeV2 {
  ws: WebSocket | null;
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  demoToken: string | null;
  realToken: string | null;
  activeToken: string | null;
  accountType: AccountType;
  accountBalance: AccountBalance;
  operationsLog: Operation[];
  assetGroups: AssetGroup[];
  isAssetsLoading: boolean;
  
  // Data for consumers
  activeSymbol: string | null;
  setActiveSymbol: (symbol: string | null) => void;
  chartData: ChartData[];
  botCandleData: CandleData[];
  priceTicks: TickData[]; 
  isChartLoading: boolean;
  chartError: string | null;
  chartType: ChartType;
  setChartType: (type: ChartType) => void;
  timePeriod: TimePeriod;
  setTimePeriod: (period: TimePeriod) => void;
  dataVersion: number;

  setAccountType: (type: AccountType) => void;
  setTokens: (tokens: { demo?: string; real?: string }) => void;
  disconnect: (type: AccountType) => void;
  reconnect: () => Promise<boolean>;
  executeTrade: (
    contractType: string,
    stake: number,
    symbol: string,
    tradeDirection: 'rise' | 'fall',
    duration: number,
    durationUnit: DurationUnit,
    initiator: OperationInitiator,
    strategy?: string
  ) => Promise<TradeResult>;
  sellContract: (contractId: number) => Promise<TradeResult>;
  getHistoricalData: (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod) => Promise<ApiHistoricalData[]>;
  clearActiveContracts: () => void;
  tradeAnnotations: TradeAnnotation[];
  durationLimits: DurationLimits | null;
}

const DerivApiContextV2 = createContext<DerivApiContextTypeV2 | undefined>(undefined);

const marketNameMapping: Record<string, string> = {
    'synthetic_index': 'Índices Sintéticos',
    'forex': 'Forex',
    'commodities': 'Matérias-Primas',
    'stock_index': 'Índices de Ações',
    'cryptocurrency': 'Criptomoedas',
    'basket_index': 'Cestas de Moedas e Matérias-Primas'
};

const getGranularityForTimePeriod = (timePeriod: TimePeriod): number => {
    switch(timePeriod) {
        case '1m': return 60;
        case '2m': return 120;
        case '3m': return 180;
        case '5m': return 300;
        case '10m': return 600;
        case '15m': return 900;
        case '30m': return 1800;
        case '1h': return 3600;
        case '8h': return 28800;
        case '1d': return 86400;
        default: return 60;
    }
}

const MAX_DATA_POINTS = 5000;

const isCandle = (d: ChartData): d is CandleData => d != null && 'close' in d;

const addDataPoint = (prevData: ChartData[], newPoint: ChartData): ChartData[] => {
    let data = [...prevData];
    if (isCandle(newPoint) && data.length > 0 && data[data.length - 1].epoch === newPoint.epoch) {
        data[data.length - 1] = newPoint;
        return data;
    }
    data.push(newPoint);
    if (data.length > MAX_DATA_POINTS) {
        return data.slice(1);
    }
    return data;
};

// Nota: esta função é usada apenas para calcular expirationTime no log,
// não afeta a duração real enviada à API.
// Para 1HZ10V: 1 tick ≈ 1s. Para outros ativos sintéticos: 1 tick ≈ 2s.
// Usamos 1.5s como média segura para ativos 1HZ e 2s para os demais.
const getDurationInSeconds = (duration: number, unit: DurationUnit, symbol?: string): number => {
    switch (unit) {
        case 't':
          const tickSec = (symbol && symbol.startsWith('1HZ')) ? 1 : 2;
          return duration * tickSec;
        case 's': return duration;
        case 'm': return duration * 60;
        case 'h': return duration * 3600;
        case 'd': return duration * 86400;
        default: return duration * 2;
    }
};


export const DerivApiProviderV2 = ({ children }: { children: ReactNode }) => {
  const [demoToken, setDemoToken] = useState<string | null>('ljUGk6wbLSrtEDo');
  const [realToken, setRealToken] = useState<string | null>('GU5MwbX1kwvSoyw');
  const [accountType, setAccountTypeState] = useState<AccountType>('demo');
  const [accountBalance, setAccountBalance] = useState<AccountBalance>({ balance: null, currency: null, loading: true });
  const [isLoading, setIsLoading] = useState(true);
  const [operationsLog, setOperationsLog] = useState<Operation[]>([]);
  const [assetGroups, setAssetGroups] = useState<AssetGroup[]>([]);
  const [isAssetsLoading, setIsAssetsLoading] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [toastQueue, setToastQueue] = useState<any[]>([]);

  const [activeSymbol, setActiveSymbol] = useState<string | null>('1HZ10V');
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [botCandleData, setBotCandleData] = useState<CandleData[]>([]);
  const [priceTicks, setPriceTicks] = useState<TickData[]>([]); 
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>('Area');
  const chartTypeRef = useRef(chartType);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('1m');
  const timePeriodRef = useRef(timePeriod);
  const activeSubscriptionIdRef = useRef<string | null>(null);
  const botSubscriptionIdRef = useRef<string | null>(null);
  const [tradeAnnotations, setTradeAnnotations] = useState<TradeAnnotation[]>([]);
  const [dataVersion, setDataVersion] = useState(0); 
  const [durationLimits, setDurationLimits] = useState<DurationLimits | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const promisesRef = useRef<Map<string, PromiseCallbacks>>(new Map());
  const [triggerReconnect, setTriggerReconnect] = useState(0);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const allowAutoReconnectRef = useRef(true);
  const reconnectInProgressRef = useRef(false);

  // NOVO: Ref para rastrear contratos recém-criados e evitar race conditions
  const recentlyCreatedContractsRef = useRef<Set<number>>(new Set());

    const setAndPersistOperationsLog = useCallback((updater: React.SetStateAction<Operation[]>) => {
        setOperationsLog(prevLog => {
            const newLogWithPotentialDuplicates = typeof updater === 'function' ? updater(prevLog) : updater;
            
            // GARANTIA DE INTEGRIDADE: Evita chaves duplicadas no React.
            const uniqueOpsMap = new Map<number, Operation>();
            for(const op of newLogWithPotentialDuplicates) {
                if(op && op.id) {
                    uniqueOpsMap.set(op.id, op);
                }
            }
            const newLog = Array.from(uniqueOpsMap.values());
            
            try {
                localStorage.setItem(DERIV_V2_LOG_KEY, JSON.stringify(newLog));
            } catch (error) {
                console.error("Failed to save V2 operations log to localStorage:", error);
            }
            return newLog;
        });
    }, []);
  
  useEffect(() => {
    chartTypeRef.current = chartType;
  }, [chartType]);
  
  useEffect(() => {
    timePeriodRef.current = timePeriod;
  }, [timePeriod]);

  useEffect(() => {
    try {
      const storedDemoToken = localStorage.getItem(DERIV_DEMO_TOKEN_KEY);
      const storedRealToken = localStorage.getItem(DERIV_REAL_TOKEN_KEY);
      const storedAccountType = localStorage.getItem(DERIV_ACCOUNT_TYPE_KEY) as AccountType | null;
      const storedLog = localStorage.getItem(DERIV_V2_LOG_KEY);

      if (storedDemoToken) setDemoToken(storedDemoToken);
      if (storedRealToken) setRealToken(storedRealToken);
      if (storedAccountType) setAccountTypeState(storedAccountType);
      if (storedLog) {
        const parsedLog = JSON.parse(storedLog);
        if(Array.isArray(parsedLog)) {
            setOperationsLog(parsedLog.filter(op => op && op.id));
        }
      }
    } catch (error) {
      console.error("Failed to access localStorage:", error);
    }
    setIsLoading(false);
  }, []);

  const addTradeAnnotation = useCallback((annotation: Omit<TradeAnnotation, 'id'>) => {
    const newAnnotation: TradeAnnotation = {
      ...annotation,
      id: `annotation-${annotation.contractId}`,
    };
    setTradeAnnotations(prev => [...prev, newAnnotation]);
  }, []);

  const updateTradeAnnotation = useCallback((contractId: string, updates: Partial<TradeAnnotation>) => {
      setTradeAnnotations(prev => prev.map(ann => 
        ann.contractId === contractId ? { ...ann, ...updates } : ann
      ));
  }, []);

  // Client-side timer to check for expired contracts
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let hasChanges = false;
      const updatedOps = operationsLog.map(op => {
        if (op.status === 'pending' && op.expirationTime && now > op.expirationTime) {
          hasChanges = true;
          updateTradeAnnotation(String(op.id), { status: 'lost', profit: -op.stake });
          // CORREÇÃO: Adicionar o exitTimestamp na expiração por timer
          return { ...op, status: 'lost' as const, result: -op.stake, exitTimestamp: new Date().toISOString() };
        }
        return op;
      });

      if (hasChanges) {
        setAndPersistOperationsLog(updatedOps);
      }
    }, 2000); // Check every 2 seconds

    return () => clearInterval(interval);
  }, [operationsLog, updateTradeAnnotation, setAndPersistOperationsLog]);
  
  const activeToken = accountType === 'demo' ? demoToken : realToken;

  useEffect(() => {
    if (toastQueue.length > 0) {
      toastQueue.forEach(t => toast(t));
      setToastQueue([]);
    }
  }, [toastQueue, toast]);


  const makeRequest = useCallback(<T,>(request: object, noResponse = false): Promise<T> => {
    return new Promise((resolve) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return resolve({ error: { message: "WebSocket não está conectado." } } as any);
        }
        
        const req_id = Date.now() + Math.floor(Math.random() * 1000000);
        const payload = { ...request, req_id };
        
        if (!noResponse) {
            const timeoutId = setTimeout(() => {
                if (promisesRef.current.has(String(req_id))) {
                    const promise = promisesRef.current.get(String(req_id));
                    promise?.resolve({ error: { message: `O pedido à API expirou (60s) para req_id: ${req_id}. O token pode ser inválido ou a rede está lenta.` } } as any);
                    promisesRef.current.delete(String(req_id));
                }
            }, 60000);
            
            promisesRef.current.set(String(req_id), {
                resolve: (value: any) => {
                    clearTimeout(timeoutId);
                    resolve(value);
                },
                reject: (reason: any) => {
                    clearTimeout(timeoutId);
                    resolve({ error: { message: reason?.message || 'Erro interno na Promise.' } } as any);
                }
            });
        }
        
        ws.send(JSON.stringify(payload));
        
        if (noResponse) {
            resolve({} as T);
        }
    });
  }, []); 

    const getHistoricalData = useCallback(async (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod): Promise<ApiHistoricalData[]> => {
        const request: any = {
            ticks_history: symbol,
            end: "latest",
            count,
            adjust_start_time: 1,
            style: style,
        };
        
        if (style === 'candles' && period) {
            request.granularity = getGranularityForTimePeriod(period);
        }
        
        try {
            const response: any = await makeRequest(request);
            if (response.error) throw new Error(response.error.message);

            if (response.history) {
                return response.history.times.map((time: number, index: number) => ({
                    epoch: time,
                    price: response.history.prices[index],
                    volume: 1, 
                }));
            }
        
            if (response.candles) {
                return response.candles.map((candle: any) => ({
                    epoch: candle.epoch,
                    open: parseFloat(candle.open),
                    high: parseFloat(candle.high),
                    low: parseFloat(candle.low),
                    close: parseFloat(candle.close),
                    volume: candle.tick_count || 1 
                }));
            }
            
            return [];
        } catch (error: any) {
            console.error('[getHistoricalData] Error:', error);
            throw error;
        }
    }, [makeRequest]);
    
  const subscribeToStreams = useCallback(async (symbol: string) => {
    try {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;

        if (activeSubscriptionIdRef.current) {
            try { await makeRequest({ forget: activeSubscriptionIdRef.current }, true); } catch (e) { /* silent */ }
        }
        if (botSubscriptionIdRef.current) {
            try { await makeRequest({ forget: botSubscriptionIdRef.current }, true); } catch (e) { /* silent */ }
        }
        
        activeSubscriptionIdRef.current = null;
        botSubscriptionIdRef.current = null;

        setIsChartLoading(true);
        setChartError(null);
        setChartData([]);
        setBotCandleData([]);
        setPriceTicks([]); 

        const contractsRes: any = await makeRequest({ contracts_for: symbol });
        if (contractsRes.error) throw new Error(contractsRes.error.message);

        // ✅ CORRIGIDO: Extrair limites de duração de contracts_for.available[]
        // O campo trading_period.rise_fall NÃO existe para índices sintéticos (1HZ10V, etc.)
        // Os limites reais estão em available[].min_contract_duration / max_contract_duration
        
        const available: any[] = contractsRes.contracts_for?.available || [];
        
        // Inicializar com null (sem dado = unidade não suportada)
        const newLimits: DurationLimits = { t: null, s: null, m: null, h: null, d: null };
        
        // Helper para parsear strings de duração como "1t", "10t", "15s", "1h"
        const parseDuration = (dStr: string): { value: number; unit: DurationUnit } | null => {
          if (!dStr) return null;
          const match = dStr.match(/^(\d+)([tsmhd])$/);
          if (!match) return null;
          return { value: parseInt(match[1], 10), unit: match[2] as DurationUnit };
        };
        
        // Filtrar apenas contratos Rise/Fall (CALL e PUT)
        const riseFallContracts = available.filter(
          (c: any) => c.contract_type === 'CALL' || c.contract_type === 'PUT'
        );
        
        if (riseFallContracts.length > 0) {
          // Para cada contrato Rise/Fall, extrair min e max durations
          for (const contract of riseFallContracts) {
            const minParsed = parseDuration(contract.min_contract_duration);
            const maxParsed = parseDuration(contract.max_contract_duration);
            
            if (minParsed && maxParsed && minParsed.unit === maxParsed.unit) {
              const unit = minParsed.unit;
              const existing = newLimits[unit];
              
              if (!existing) {
                // Primeira vez para esta unidade
                newLimits[unit] = { min: minParsed.value, max: maxParsed.value };
              } else {
                // Se já existe, pegar o range mais amplo (menor min, maior max)
                newLimits[unit] = {
                  min: Math.min(existing.min, minParsed.value),
                  max: Math.max(existing.max, maxParsed.value),
                };
              }
            }
          }
        }
        
        // Fallback de segurança: se nenhum dado foi encontrado (API não retornou available),
        // usar valores conhecidos para 1HZ10V e ativos sintéticos similares.
        // 1HZ10V suporta ticks (1-10) e segundos (15-3600) em Rise/Fall.
        const hasAnyLimit = Object.values(newLimits).some(v => v !== null);
        if (!hasAnyLimit) {
          console.warn(`[DurationLimits] API não retornou limites para ${symbol}. Usando defaults de segurança.`);
          newLimits.t = { min: 1, max: 10 };
          newLimits.s = { min: 15, max: 3600 };
        }
        
        console.log(`[DurationLimits] Limites para ${symbol}:`, JSON.stringify(newLimits));
        setDurationLimits(newLimits);

        const currentChartType = chartTypeRef.current;
        const currentTimePeriod = timePeriodRef.current;
        
        const botHistory = await getHistoricalData(symbol, 'candles', 1000, '1m');
        setBotCandleData(botHistory as CandleData[]);
        
        const botSubRequest = { 
            ticks_history: symbol, 
            style: 'candles', 
            granularity: 60,
            subscribe: 1, 
            end: "latest", 
            count: 1, 
            adjust_start_time: 1 
        };
        const botSubResponse: any = await makeRequest(botSubRequest);
        if (botSubResponse.error) {
            if (botSubResponse.error.code !== 'AlreadySubscribed') {
                throw new Error(`Bot Sub: ${botSubResponse.error.message}`);
            } else {
                console.warn(`[Deriv WS V2] Bot data already subscribed for ${symbol}.`);
            }
        }
        if(botSubResponse.subscription?.id) botSubscriptionIdRef.current = botSubResponse.subscription.id;
        
        const historyStyle = currentChartType === 'Candle' ? 'candles' : 'ticks';
        const uiHistory = await getHistoricalData(symbol, historyStyle, 1000, currentTimePeriod);
        
        const chartHistory = uiHistory.map(h => {
            if(historyStyle === 'candles' && h.open) {
                return { epoch: h.epoch, open: h.open, high: h.high, low: h.low, close: h.close, volume: h.volume } as CandleData;
            }
            return { epoch: h.epoch, price: h.price } as TickData;
        });

        setChartData(chartHistory as ChartData[]);
        if (historyStyle === 'ticks') {
            setPriceTicks(uiHistory as TickData[]);
        }
        setDataVersion(v => v + 1);

        let uiSubRequest: any;
        if (currentChartType === 'Candle') {
            uiSubRequest = { 
                ticks_history: symbol, 
                style: 'candles', 
                granularity: getGranularityForTimePeriod(currentTimePeriod), 
                subscribe: 1,
                end: "latest",
                count: 1,
                adjust_start_time: 1
            };
        } else {
            uiSubRequest = { 
                ticks: symbol, 
                subscribe: 1 
            };
        }
        
        const uiSubResponse: any = await makeRequest(uiSubRequest);
        if (uiSubResponse.error) {
             if (uiSubResponse.error.code !== 'AlreadySubscribed') {
                throw new Error(`UI Sub: ${uiSubResponse.error.message}`);
            } else {
                 console.warn(`[Deriv WS V2] UI data already subscribed for ${symbol}.`);
            }
        }
        if (uiSubResponse.subscription?.id) {
            activeSubscriptionIdRef.current = uiSubResponse.subscription.id;
        }

    } catch (error: any) {
        console.error(`[Market Data] Error for ${symbol}:`, error);
        setChartError(error.message || 'Falha ao carregar dados do mercado.');
    } finally {
        setIsChartLoading(false);
    }
  }, [getHistoricalData, makeRequest]);

    const executeTrade = useCallback(async (
        contractType: string,
        stake: number,
        symbol: string,
        tradeDirection: 'rise' | 'fall',
        duration: number,
        durationUnit: DurationUnit,
        initiator: OperationInitiator,
        strategy?: string,
      ): Promise<TradeResult> => {
        try {
          if (!wsRef.current || !isConnected) {
            throw new Error("A conexão com a API da Deriv não está ativa.");
          }

          const sanitizedStake = parseFloat(stake.toFixed(2));
          const sanitizedDuration = Math.round(duration);

          const proposalResponse: any = await makeRequest({ 
              "proposal": 1,
              "amount": sanitizedStake,
              "basis": "stake",
              "contract_type": contractType,
              "currency": "USD",
              "duration": sanitizedDuration,
              "duration_unit": durationUnit,
              "symbol": symbol,
          });
          if (proposalResponse.error) throw new Error(proposalResponse.error.message);

          const proposal = proposalResponse.proposal;
          if (!proposal || !proposal.id) {
            throw new Error("Falha ao obter uma proposta de negociação da API.");
          }
          
          const buyResponse: any = await makeRequest({ "buy": proposal.id, "price": proposal.ask_price });
          if(buyResponse.error) throw new Error(buyResponse.error.message);
          const buyResult = buyResponse.buy;
          
          const contractId = buyResult.contract_id;
          if (!contractId) {
            throw new Error("Falha na compra do contrato, ID não retornado.");
          }
          
          recentlyCreatedContractsRef.current.add(contractId);
          setTimeout(() => {
              recentlyCreatedContractsRef.current.delete(contractId);
          }, 5000);

          const latestTick = priceTicks.length > 0 ? priceTicks[priceTicks.length - 1].price : 0;
          const entryPrice = buyResult.entry_tick_display_value 
            ? parseFloat(buyResult.entry_tick_display_value) 
            : (buyResult.entry_spot_display_value ? parseFloat(buyResult.entry_spot_display_value) : latestTick);

          const isSellable = durationUnit !== 't';
          
          const durationInSeconds = getDurationInSeconds(sanitizedDuration, durationUnit, symbol);
          const purchaseTimeMs = (buyResult.purchase_time || Math.floor(Date.now() / 1000)) * 1000;
          const expirationTimeMs = purchaseTimeMs + durationInSeconds * 1000;

          const newOperation: Operation = {
              id: buyResult.contract_id,
              asset: symbol,
              direction: tradeDirection,
              stake: sanitizedStake,
              status: 'pending',
              timestamp: new Date(purchaseTimeMs).toISOString(),
              duration: sanitizedDuration,
              durationUnit: durationUnit,
              initiator,
              strategy,
              entryPrice: entryPrice,
              isSellable,
              expirationTime: expirationTimeMs,
          };
          setAndPersistOperationsLog(prevLog => [newOperation, ...prevLog]);

          const entryTime = buyResult.purchase_time;
          
          addTradeAnnotation({
              contractId: String(buyResult.contract_id),
              entryTime: entryTime,
              entryPrice: entryPrice,
              direction: tradeDirection,
              status: 'pending',
              stake: sanitizedStake,
              symbol,
              expirationTime: expirationTimeMs,
              contractType: 'option'
          });

          return {
            success: true,
            message: `Ordem do tipo "${contractType}" para ${symbol} no valor de ${sanitizedStake} USD executada com sucesso.`,
            contractId: contractId,
            entryPrice,
          };
        } catch (error) {
           console.error("[Deriv Hook] Erro durante a negociação:", error);
           const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu.";
           return { success: false, message };
        }
      }, [isConnected, makeRequest, addTradeAnnotation, priceTicks, setAndPersistOperationsLog]);

  const sellContract = useCallback(async (contractId: number): Promise<TradeResult> => {
    try {
        const contract = operationsLog.find(op => op.id === contractId);
        if (contract && contract.expirationTime) {
            const remainingTime = contract.expirationTime - Date.now();
            if (remainingTime < 1000) { 
                throw new Error(`O contrato #${contractId} está no período de bloqueio final.`);
            }
        }
        
        const sellResponse: any = await makeRequest({ 
            "sell": contractId,
            "price": 0, 
        });

        if (sellResponse.error) {
            throw new Error(sellResponse.error.message);
        }

        const sellResult = sellResponse.sell;
        if (sellResult) {
            return { success: true, message: `Ordem de venda para o contrato ${contractId} enviada.` };
        } else {
            throw new Error("A resposta da API não continha os dados de venda esperados.");
        }
    } catch (error) {
        console.error("[Deriv Hook] Erro ao vender o contrato:", error);
        const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu ao vender o contrato.";
        return { success: false, message };
    }
  }, [isConnected, makeRequest, operationsLog]);
  
  const startConnectionMonitor = useCallback(() => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    pingIntervalRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            try {
                wsRef.current.send(JSON.stringify({ ping: 1 }));
            } catch (error) {
                console.warn('[Ping] Failed:', error);
            }
        }
    }, 30000);
  }, []);
  
  useEffect(() => {
    if (!activeToken || isLoading) {
      if (wsRef.current) wsRef.current.close();
      return;
    }
    
    const connect = () => {
        setIsConnecting(true);
        setConnectionError(null);
        setIsAssetsLoading(true);
      
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
    
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
        wsRef.current = ws;
        
        ws.onmessage = (event) => {
    try {
        const response = JSON.parse(event.data);
        
        if (response.msg_type === 'ping' || response.pong) {
            return;
        }
        
        const reqId = response.req_id;
        
        if (reqId && promisesRef.current.has(String(reqId))) {
            const promise = promisesRef.current.get(String(reqId));
            if (promise) {
                if (response.error) {
                    promise.reject(new Error(response.error.message));
                } else {
                    promise.resolve(response);
                }
                promisesRef.current.delete(String(reqId));
            }
            return;
        }

        if (response.error && response.error.message) {
             if (response.error.code !== 'AlreadySubscribed' && 
                 response.error.code !== 'SellNotAvailable' && 
                 response.error.code !== 'ContractSellNotAvailable') {
              console.error(`[Deriv WS] Error:`, response.error.message);
            }
             return;
        }

        switch (response.msg_type) {
            case 'balance':
                setAccountBalance({ 
                    balance: response.balance.balance, 
                    currency: response.balance.currency, 
                    loading: false 
                });
                break;
            case 'proposal_open_contract':
                const contract = response.proposal_open_contract;
                if (!contract) return;

                if ((contract.contract_type || '').startsWith('MULT')) {
                  return;
                }
            
                setAndPersistOperationsLog(prevLog => {
                    const existingOpIndex = prevLog.findIndex(op => op.id === contract.contract_id);
                    const isSold = contract.is_sold === 1;
                    
                    if (existingOpIndex !== -1) {
                        const updatedLog = [...prevLog];
                        const op = updatedLog[existingOpIndex];
                        
                        if (op.status === 'pending') {
                            if (isSold) {
                                const newStatus = contract.profit >= 0 ? 'won' : 'lost';
                                const exitPrice = contract.exit_tick_display_value ? parseFloat(contract.exit_tick_display_value) : contract.sell_spot ? parseFloat(contract.sell_spot) : op.exitPrice;
                                const sellTime = contract.sell_time ? new Date(contract.sell_time * 1000).toISOString() : new Date().toISOString();
                                
                                updatedLog[existingOpIndex] = { ...op, status: newStatus, result: contract.profit, exitPrice: exitPrice, exitTimestamp: sellTime };
                                
                                if (op.initiator === 'Piloto' && user) {
                                    const logId = `pred_log_${contract.contract_id}`;
                                    const predictiveLogUpdate = {
                                        id: logId,
                                        result: newStatus,
                                        pnl: contract.profit,
                                    };
                                    savePredictiveTradeLog(user.uid, predictiveLogUpdate);
                                }

                                updateTradeAnnotation(String(contract.contract_id), { 
                                    status: newStatus, 
                                    profit: contract.profit, 
                                    exitPrice, 
                                    exitTime: contract.sell_time 
                                });
                                
                                const toastMessage = {
                                    title: `Posição Fechada (${op.asset})`,
                                    description: `Resultado: ${contract.currency} ${contract.profit.toFixed(2)}`,
                                    variant: newStatus === 'won' ? 'default' : 'destructive',
                                };
                                
                                setToastQueue(prev => [...prev, toastMessage]);
            
                                if (wsRef.current?.readyState === WebSocket.OPEN) {
                                    wsRef.current.send(JSON.stringify({"balance": 1}));
                                }
                                return updatedLog;
                            } else if (op.contractType?.startsWith('MULT') && contract.profit !== op.result) {
                                updatedLog[existingOpIndex] = { ...op, result: contract.profit };
                                return updatedLog;
                            }
                        }
                        return prevLog;
            
                    } else if (!isSold) {
                        if (recentlyCreatedContractsRef.current.has(contract.contract_id)) {
                            return prevLog;
                        }

                        const direction = (contract.contract_type || '').includes('CALL') ? 'rise' : 'fall';
                        const purchaseTime = contract.purchase_time || Math.floor(Date.now() / 1000);
                        const durationInSeconds = contract.date_expiry ? (contract.date_expiry - purchaseTime) : 0;
                        const durationUnit: DurationUnit = 's';
    
                        const newOperation: Operation = {
                            id: contract.contract_id,
                            asset: contract.symbol,
                            direction: direction,
                            stake: contract.buy_price || 0,
                            status: 'pending',
                            result: contract.profit,
                            timestamp: new Date(purchaseTime * 1000).toISOString(),
                            initiator: 'Manual',
                            entryPrice: parseFloat(contract.entry_spot_display_value || contract.entry_tick_display_value || '0'),
                            isSellable: contract.is_sellable === 1,
                            expirationTime: contract.date_expiry ? contract.date_expiry * 1000 : undefined,
                            duration: durationInSeconds,
                            durationUnit: durationUnit,
                            multiplier: contract.multiplier,
                            contractType: contract.contract_type,
                        };
                        
                        addTradeAnnotation({
                            contractId: String(newOperation.id),
                            entryTime: purchaseTime,
                            entryPrice: newOperation.entryPrice!,
                            direction: newOperation.direction,
                            status: 'pending',
                            stake: newOperation.stake,
                            symbol: newOperation.asset,
                            expirationTime: newOperation.expirationTime,
                            contractType: (contract.contract_type || '').startsWith('MULT') ? 'multiplier' : 'option'
                        });
            
                        return [newOperation, ...prevLog];
                    }
                    
                    return prevLog;
                });
                break;
            case 'tick':
                if (response.tick?.symbol === activeSymbol) {
                    const tick = response.tick;
                    const newTick = { epoch: tick.epoch, price: tick.quote };
                    if (chartTypeRef.current === 'Area') {
                       setChartData(prev => addDataPoint(prev, newTick));
                    }
                    setPriceTicks(prev => {
                        const newTicks = [...prev, newTick];
                         if (newTicks.length > MAX_DATA_POINTS) {
                            return newTicks.slice(1);
                        }
                        return newTicks;
                    });
                    setDataVersion(v => v + 1);
                }
                break;
            
            case 'ohlc':
            case 'candles':
                const candleData = response.ohlc || (response.candles && response.candles[0]);
                
                if (candleData && candleData.symbol === activeSymbol) {
                    const newCandle: CandleData = {
                        epoch: candleData.open_time || candleData.epoch,
                        open: parseFloat(candleData.open),
                        high: parseFloat(candleData.high),
                        low: parseFloat(candleData.low),
                        close: parseFloat(candleData.close),
                        volume: candleData.tick_count || 1,
                    };

                    const isForUI = response.subscription?.id === activeSubscriptionIdRef.current;
                    const isForBot = response.subscription?.id === botSubscriptionIdRef.current;

                    if (isForUI && chartTypeRef.current === 'Candle') {
                        setChartData(prev => addDataPoint(prev, newCandle));
                    }
                    if (isForBot) {
                        setBotCandleData(prev => addDataPoint(prev, newCandle) as CandleData[]);
                    }
                    
                    setPriceTicks(prev => {
                        const newTicks = [...prev, { epoch: newCandle.epoch, price: newCandle.close }];
                        if (newTicks.length > MAX_DATA_POINTS) {
                            return newTicks.slice(newTicks.length - MAX_DATA_POINTS);
                        }
                        return newTicks;
                    });
                    setDataVersion(v => v + 1);
                }
                break;
        }
    } catch (parseError) {
        console.error('[Deriv WS] Parse error:', parseError);
    }
};
    
        ws.onopen = async () => {
    try {
        reconnectInProgressRef.current = false;
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

        const authResponse: any = await makeRequest({ authorize: activeToken });
        if (authResponse.error) throw new Error(authResponse.error.message);

        setIsConnected(true);
        setIsConnecting(false);
        setConnectionError(null);
        
        ws.send(JSON.stringify({ "proposal_open_contract": 1, "subscribe": 1 }));
        ws.send(JSON.stringify({ "balance": 1, "subscribe": 1 }));
        
        startConnectionMonitor();
        
        const assetsRes: any = await makeRequest({ active_symbols: 'full', product_type: 'basic' });
        if (assetsRes.error) throw new Error(assetsRes.error.message);
        
        const groupedAssets: { [key: string]: Asset[] } = {};
        assetsRes.active_symbols.forEach((symbol: any) => {
            const marketKey = (symbol.market === 'synthetic_index' && symbol.submarket === 'basket_index') ? 'basket_index' : symbol.market;
            const groupName = marketNameMapping[marketKey] || 'Outros';
            if (!groupedAssets[groupName]) groupedAssets[groupName] = [];
            groupedAssets[groupName].push({
                value: symbol.symbol,
                label: symbol.display_name,
                marketIsOpen: symbol.exchange_is_open === 1,
                submarket: symbol.submarket,
                market: marketKey,
                minDuration: symbol.min_contract_duration ?? '5t', 
            });
        });
        
        setAssetGroups(Object.keys(groupedAssets)
            .map(label => ({ 
                label, 
                options: groupedAssets[label].sort((a, b) => a.label.localeCompare(b.label)) 
            }))
            .sort((a, b) => a.label.localeCompare(b.label)));
        setIsAssetsLoading(false);

    } catch (error: any) {
        reconnectInProgressRef.current = false;
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        
        let errorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao conectar';
        setConnectionError(`Falha na autorização: ${errorMessage}`);
        setIsConnected(false);
        setIsConnecting(false);
        setIsAssetsLoading(false);
        setAccountBalance({ balance: null, currency: null, loading: false });
        allowAutoReconnectRef.current = false; // PREVENT RECONNECT LOOP
        if (ws.readyState === WebSocket.OPEN) ws.close();
    }
};
      
        ws.onclose = (event) => {
          if (!wsRef.current || reconnectInProgressRef.current) return;
          
          if (pingIntervalRef.current) {
              clearInterval(pingIntervalRef.current);
              pingIntervalRef.current = null;
          }
          
          promisesRef.current.forEach((p) => {
            if (p && typeof p.reject === 'function') {
              p.reject(new Error("WebSocket connection closed."))
            }
          });
          promisesRef.current.clear();

          if (!event.wasClean && allowAutoReconnectRef.current) {
            reconnectInProgressRef.current = true;
            console.warn(`[WS] Fechado inesperadamente. Código: ${event.code}. Tentando reconectar...`);
            setConnectionError(`Conexão perdida. Reconectando...`);
            
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            reconnectTimeoutRef.current = setTimeout(() => {
                reconnectInProgressRef.current = false;
                setTriggerReconnect(c => c + 1);
            }, 3000);
          } else if (!event.wasClean && !allowAutoReconnectRef.current) {
             console.warn(`[WS] Conexão falhou permanentemente (provavelmente token inválido). Auto-reconexão desativada.`);
             setConnectionError(`Authorization failed. Please check your API token.`);
          }
          
          setIsConnected(false);
          setIsConnecting(false);
          setAccountBalance({ balance: null, currency: null, loading: false });
          wsRef.current = null;
        };
      
        ws.onerror = (error) => {
          // O evento onclose é mais fiável para obter o motivo do erro.
        };
    };

    connect();
  
    return () => {
      allowAutoReconnectRef.current = false;
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
      }
      if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectInProgressRef.current = false;
    };
  }, [activeToken, isLoading, triggerReconnect, user]);

  
  useEffect(() => {
    if (isConnected && activeSymbol) {
        subscribeToStreams(activeSymbol);
    }
  }, [isConnected, activeSymbol, subscribeToStreams]);
  
  const setAccountType = useCallback((type: AccountType) => {
    try {
        localStorage.setItem(DERIV_ACCOUNT_TYPE_KEY, type);
        setAccountTypeState(type);
        allowAutoReconnectRef.current = true;
        setTriggerReconnect(c => c + 1); // Trigger a full reconnect
    } catch (error) {
        console.error("Failed to save account type to localStorage:", error);
    }
  }, []);

  const setTokens = useCallback((tokens: { demo?: string; real?: string }) => {
    try {
      if (tokens.demo) {
        localStorage.setItem(DERIV_DEMO_TOKEN_KEY, tokens.demo);
        setDemoToken(tokens.demo);
      }
      if (tokens.real) {
        localStorage.setItem(DERIV_REAL_TOKEN_KEY, tokens.real);
        setRealToken(tokens.real);
      }
      allowAutoReconnectRef.current = true;
      setTriggerReconnect(c => c + 1);
    } catch (error) {
      console.error("Failed to save token to localStorage:", error);
    }
  }, []);

  const disconnect = useCallback((type: AccountType) => {
    try {
      if (type === 'demo') {
        localStorage.removeItem(DERIV_DEMO_TOKEN_KEY);
        setDemoToken(null);
      } else {
        localStorage.removeItem(DERIV_REAL_TOKEN_KEY);
        setRealToken(null);
      }
    } catch (error) {
        console.error("Failed to remove token from localStorage:", error);
    }
  }, []);
  
  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;

  const connectionErrorRef = useRef(connectionError);
  connectionErrorRef.current = connectionError;

  const reconnect = useCallback(async (): Promise<boolean> => {
    allowAutoReconnectRef.current = true;
    setTriggerReconnect(c => c + 1);
    
    return new Promise(resolve => {
        const checkStartTime = Date.now();
        const checkInterval = setInterval(() => {
            const isTimeout = Date.now() - checkStartTime > 10000;
            
            if (isConnectedRef.current) {
                clearInterval(checkInterval);
                resolve(true);
            } else if (connectionErrorRef.current || isTimeout) {
                clearInterval(checkInterval);
                resolve(false);
            }
        }, 200);
    });
  }, []);

  const clearActiveContracts = useCallback(() => {
    setAndPersistOperationsLog([]);
    setTradeAnnotations([]);
  }, [setAndPersistOperationsLog]);

  const contextValue: DerivApiContextTypeV2 = useMemo(() => ({
    ws: wsRef.current,
    isConnected,
    isConnecting,
    connectionError,
    demoToken,
    realToken,
    activeToken,
    accountType,
    setAccountType,
    setTokens,
    disconnect,
    reconnect,
    accountBalance,
    operationsLog,
    assetGroups,
    isAssetsLoading,
    activeSymbol,
    setActiveSymbol,
    chartData,
    botCandleData,
    priceTicks,
    isChartLoading,
    chartError,
    chartType,
    setChartType,
    setTimePeriod,
    dataVersion,
    executeTrade,
    sellContract,
    getHistoricalData,
    clearActiveContracts,
    tradeAnnotations,
    durationLimits,
  }), [
      isConnected, isConnecting, connectionError, demoToken, realToken, activeToken, accountType, 
      setAccountType, setTokens, disconnect, reconnect, accountBalance, operationsLog, assetGroups, 
      isAssetsLoading, activeSymbol, setActiveSymbol, chartData, botCandleData, priceTicks, 
      isChartLoading, chartError, chartType, timePeriod, dataVersion, executeTrade, 
      sellContract, getHistoricalData, clearActiveContracts, tradeAnnotations, durationLimits
  ]);

  return (
    <DerivApiContextV2.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </DerivApiContextV2.Provider>
  );
}

export function useDerivApiV2() {
  const context = useContext(DerivApiContextV2);
  if (context === undefined) {
    throw new Error('useDerivApiV2 must be used within a DerivApiProviderV2');
  }
  return context;
}
