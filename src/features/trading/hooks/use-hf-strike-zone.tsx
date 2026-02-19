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
import { runAutoCalibration, type CalibrationResult } from '../optimization/auto-calibrator';


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
          });
          
          let updatedCount = 0;
          const newParams = { ...strategyParams };
          for (const key in results) {
              const result = results[key as StrategyType];
              if (result.success) {
                  newParams[key as StrategyType] = result.finalParams;
                  updatedCount++;
              }
          }
          
          setStrategyParams(newParams);
          toast({ title: "✅ Calibração Concluída!", description: `${updatedCount} estratégias foram otimizadas.` });

      } catch (error: any) {
          toast({ title: "❌ Erro na Calibração", description: error.message, variant: "destructive" });
      } finally {
          setIsCalibrating(false);
      }
  }, [activeSymbol, getHistoricalData, strategyParams, config, toast]);

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
                if (indicators.bbw > 2.5) { optimalDuration *= 0.8; durationSource += ' (Alta Volatilidade)'; }
                else if (indicators.bbw < 0.8) { optimalDuration *= 1.2; durationSource += ' (Baixa Volatilidade)'; }
              }
              const predictiveParticipants = participants.filter(p => p.strategy === 'GBM_20S' || p.strategy === 'GBM_40S');
              if (predictiveParticipants.length > 0) {
                const mostConfidentPredictor = predictiveParticipants.reduce((best, current) => current.confidence > best.confidence ? current : best);
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
                const preferredUnit: DurationUnit = calculatedDurationInSeconds <= 10 ? 't' : 's';
                
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
      martingaleMultiplier, maxConcurrentTrades, durationLimits, gbmConfidenceThreshold
  ]);
  
  return {
    activeStrikeZone, marketRegime, positionSizing, riskManager, fullIndicators: indicators,
    supplyDemandZones: (indicators as any)?.supplyDemandZones, allSignals, strategyCounts, consecutiveLosses, isCooldownActive, isExecuting,
    strategyParams, updateStrategyParams: handleUpdateStrategyParams,
    lastCalibrationTime,
    gbmConfidenceThreshold,
    isCalibrating,
    calibrationProgress,
    triggerAutoCalibration,
  };
}

```
- src/app/hf-strike-zone/page.tsx
<content><![CDATA[
// /src/app/hf-strike-zone/page.tsx
'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { DerivApiProviderV2 as DerivApiProvider, useDerivApiV2 as useDerivApi } from '@/features/trading/hooks/use-deriv-api-v2';
import { AssetSelectorV2 as AssetSelector } from '@/features/trading/components/deriv-trader/asset-selector-v2';
import { ApiStatusIndicatorV2 as ApiStatusIndicator } from '@/features/trading/components/deriv-trader/ApiStatusIndicatorV2';
import { MarketChart } from '@/features/trading/components/deriv-trader/market-chart';
import { useHFStrikeZone } from '@/features/trading/hooks/use-hf-strike-zone';
import { HFExecutionLog } from '@/features/trading/components/hf-trader/hf-execution-log';
import { HFConfigPanel, type HFConfig } from '@/features/trading/components/hf-trader/hf-config-panel';
import { HFStrategyTuningPanel } from '@/features/trading/components/hf-trader/hf-strategy-tuning-panel';
import { Target, TrendingUp, BarChart, Brain, Activity, Zap, ShieldAlert, Bot, TestTube, GitCompareArrows, Dice5, Wallet, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Operation, CandleData, TimePeriod, InstitutionalBacktestResult, WalkForwardResult, MonteCarloResult, DurationUnit } from '@/lib/types';
import { HFStatsOverview } from '@/features/trading/components/hf-trader/hf-stats-overview';
import { HFSignalCard } from '@/features/trading/components/hf-trader/hf-signal-card';
import { Skeleton } from '@/components/ui/skeleton';
import { runAllStrategiesBacktest, runWalkForwardAnalysis, runMonteCarloSimulation } from '@/features/trading/backtest/hf-backtest-engine';
import { StrategyType, strategyMetadata } from '@/features/trading/services/hf-strike-logic';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { BacktestPanel } from '@/features/trading/components/hf-trader/BacktestPanel';
import { StrategySignalMonitor } from '@/features/trading/components/hf-trader/StrategySignalMonitor';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import '@/lib/debug-helpers';
import { HFAutoCalibrator } from '@/features/trading/components/hf-trader/HFAutoCalibrator';


function PageContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading, accountType, setAccountType,
    accountBalance, isConnecting, chartData: rawChartData, botCandleData, priceTicks,
    isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod,
    operationsLog, tradeAnnotations, executeTrade, clearActiveContracts, getHistoricalData,
  } = useDerivApi();

  const [hfConfig, setHFConfig] = useState<HFConfig>({
    enabled: true, minConfidence: 70, autoExecute: false, maxConcurrentTrades: 1, preferredDuration: 20,
    minConsensusSignals: 1, martingaleMultiplier: 1.0, maxConsecutiveLosses: 5, cooldownSeconds: 30,
  });

  const [dailyBalance, setDailyBalance] = useState(100.0);
  const [dailyTarget, setDailyTarget] = useState(50.0);
  const [stakeValue, setStakeValue] = useState(1.0);

  const hfOperations = useMemo(() => operationsLog.filter(op => op.initiator === 'HF_Strike'), [operationsLog]);

  const {
    activeStrikeZone,
    marketRegime,
    positionSizing,
    fullIndicators,
    supplyDemandZones,
    allSignals,
    strategyCounts,
    consecutiveLosses,
    isCooldownActive,
    isExecuting,
    strategyParams,
    updateStrategyParams,
    gbmConfidenceThreshold,
    lastCalibrationTime,
    isCalibrating,
    calibrationProgress,
    triggerAutoCalibration,
  } = useHFStrikeZone(
      activeSymbol, 
      priceTicks, 
      botCandleData, 
      timePeriod, 
      hfConfig, 
      (newConfig: Partial<HFConfig>) => setHFConfig(prev => ({...prev, ...newConfig})),
      { 
        dailyBalance, 
        dailyTarget, 
        operationsLog: hfOperations,
        manualStake: stakeValue,
      }
  ); 

  const handleExecuteStrike = useCallback(async () => {
    if (!activeStrikeZone || !positionSizing || positionSizing.recommendedStake === 0 || !user || !activeSymbol) {
      toast({ title: 'Sinal Inválido', description: 'Não há sinal válido para executar.', variant: 'destructive' });
      return;
    }
  }, [activeStrikeZone, positionSizing, user, activeSymbol, toast]);
  
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [backtestData, setBacktestData] = useState<CandleData[]>([]);
  const [backtestResults, setBacktestResults] = useState<Record<string, InstitutionalBacktestResult> | null>(null);
  const [walkForwardResults, setWalkForwardResults] = useState<WalkForwardResult[] | null>(null);
  const [monteCarloResult, setMonteCarloResult] = useState<MonteCarloResult | null>(null);

  const handleRunBacktest = useCallback(async () => {
    if (!activeSymbol) { toast({ title: "Selecione um ativo", variant: 'destructive' }); return; }
    setIsBacktesting(true); setBacktestResults(null); setWalkForwardResults(null); setMonteCarloResult(null); setBacktestData([]); 
    try {
      toast({ title: "Iniciando Backtest...", description: "Buscando 1500 velas históricas..." });
      const historicalData = await getHistoricalData(activeSymbol, 'candles', 1500, '1m') as CandleData[];
      setBacktestData(historicalData);
      if (historicalData.length < 100) throw new Error("Dados históricos insuficientes para o backtest.");
      toast({ title: "Dados recebidos", description: `Analisando ${historicalData.length} velas...` });
      await new Promise(resolve => setTimeout(resolve, 50)); 
      const results = runAllStrategiesBacktest(historicalData, hfConfig, activeSymbol, strategyParams);
      setBacktestResults(results);
      toast({ title: "Backtest Concluído!", description: "Resultados da simulação estão disponíveis." });
    } catch (e: any) { toast({ title: "Erro no Backtest", description: e.message, variant: 'destructive' });
    } finally { setIsBacktesting(false); }
  }, [activeSymbol, getHistoricalData, toast, hfConfig, strategyParams]);
  
  const handleRunWalkForward = useCallback(async () => {
    if (!activeSymbol || !backtestData || backtestData.length < 1500) { toast({ title: "Dados insuficientes", description: "Execute o Backtest Simples primeiro.", variant: 'destructive' }); return; }
    setIsBacktesting(true); setBacktestResults(null); setWalkForwardResults(null); setMonteCarloResult(null);
    try {
      toast({ title: "Iniciando Walk-Forward...", description: "Rodando 3 folds..." });
      await new Promise(resolve => setTimeout(resolve, 50));
      const strategyToTest = 'STD_TREND_FOLLOW'; 
      const results = runWalkForwardAnalysis(backtestData, hfConfig, strategyToTest, activeSymbol, strategyParams);
      setWalkForwardResults(results);
      toast({ title: "Análise Walk-Forward Concluída!" });
    } catch (e: any) { toast({ title: "Erro na Análise Walk-Forward", description: e.message, variant: 'destructive' });
    } finally { setIsBacktesting(false); }
  }, [activeSymbol, backtestData, toast, hfConfig, strategyParams]);
  
  const handleRunMonteCarlo = useCallback(async () => {
      if (!backtestResults || backtestData.length === 0) { toast({ title: "Execute o Backtest Simples Primeiro", variant: 'destructive' }); return; }
      const bestStrategyKey = Object.entries(backtestResults).sort(([, a], [, b]) => (b.metrics?.sharpeRatio || 0) - (a.metrics?.sharpeRatio || 0))[0][0];
      if (!bestStrategyKey) { toast({ title: "Nenhuma estratégia para analisar", variant: 'destructive' }); return; }
      setIsBacktesting(true); setMonteCarloResult(null);
      toast({ title: "Iniciando Simulação de Monte Carlo...", description: `Rodando 1000 iterações...` });
      await new Promise(resolve => setTimeout(resolve, 50));
      try {
          const result = runMonteCarloSimulation(backtestResults[bestStrategyKey as StrategyType], backtestData, 1000);
          setMonteCarloResult(result);
          toast({ title: "Simulação de Monte Carlo Concluída!" });
      } catch(e: any) { toast({ title: "Erro na Simulação", description: e.message, variant: 'destructive' });
      } finally { setIsBacktesting(false); }
  }, [backtestResults, backtestData, toast]);


  return (
    <div className="flex-1 space-y-6 p-4 sm:p-8 pt-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-headline">⚡ HF Strike Zone</h1>
          <p className="text-sm text-muted-foreground mt-1">Trading de Alta Frequência com Consenso de IA.</p>
        </div>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div className="flex justify-center"><AssetSelector selectedAsset={activeSymbol || ''} onAssetChange={asset => setActiveSymbol(asset)} assetGroups={assetGroups} isAssetsLoading={isAssetsLoading}/></div>
            <div className="flex justify-center"><ApiStatusIndicator /></div>
            <div className="flex items-center justify-center md:justify-end gap-4">
                <ToggleGroup type="single" value={accountType} onValueChange={(value: any) => value && setAccountType(value)}><ToggleGroupItem value="demo">Demo</ToggleGroupItem><ToggleGroupItem value="real">Real</ToggleGroupItem></ToggleGroup>
                <div className="text-right">
                    {accountBalance.loading || isConnecting ? <div className="space-y-1"><Skeleton className="h-4 w-16" /><Skeleton className="h-5 w-24" /></div> : 
                    accountBalance.balance !== null ? <div><p className="text-xs text-muted-foreground capitalize">Saldo ({accountType})</p><p className="text-lg font-bold">{new Intl.NumberFormat('en-US',{style:'currency',currency:accountBalance.currency || 'USD'}).format(accountBalance.balance)}</p></div> : null}
                </div>
            </div>
        </div>
      </div>
      
      <HFStatsOverview operations={hfOperations} strategyCounts={strategyCounts} />
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-yellow-500" />Gráfico de Mercado ({activeSymbol})</CardTitle>
                    <CardDescription>Análise em tempo real com overlays.</CardDescription>
                </CardHeader>
                <CardContent><MarketChart activeSymbol={activeSymbol || ''} chartData={rawChartData} isChartLoading={isChartLoading} chartError={chartError} chartType={chartType} setChartType={setChartType} timePeriod={timePeriod} setTimePeriod={setTimePeriod} operations={operationsLog} indicators={fullIndicators} tradeAnnotations={tradeAnnotations} supplyDemandZones={supplyDemandZones}/></CardContent>
            </Card>

            <HFExecutionLog operations={hfOperations} clearActiveContracts={clearActiveContracts} />
            
             <Collapsible>
                <CollapsibleTrigger asChild>
                   <Button variant="outline" className="w-full" type="button">
                        <TestTube className="mr-2 h-4 w-4" />
                        Painel de Backtesting Avançado
                   </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                    <BacktestPanel 
                        results={backtestResults} 
                        walkForwardResults={walkForwardResults}
                        monteCarloResult={monteCarloResult}
                        onRunBacktest={handleRunBacktest} 
                        isBacktesting={isBacktesting}
                        onRunWalkForward={handleRunWalkForward}
                        onRunMonteCarlo={handleRunMonteCarlo}
                    />
                </CollapsibleContent>
              </Collapsible>
               <Collapsible>
                <CollapsibleTrigger asChild>
                   <Button variant="outline" className="w-full" type="button">
                        <SlidersHorizontal className="mr-2 h-4 w-4" />
                        Ajuste Fino & Calibração
                   </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4 space-y-4">
                     <HFStrategyTuningPanel 
                        params={strategyParams}
                        onParamChange={updateStrategyParams}
                        gbmConfidenceThreshold={gbmConfidenceThreshold}
                      />
                      <HFAutoCalibrator
                        triggerAutoCalibration={triggerAutoCalibration}
                        isCalibrating={isCalibrating}
                        calibrationProgress={calibrationProgress}
                      />
                </CollapsibleContent>
              </Collapsible>
               <HFSignalCard signal={activeStrikeZone} onExecute={handleExecuteStrike} isExecuting={isExecuting} consecutiveLosses={consecutiveLosses} isCooldown={isCooldownActive}/>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5"/>Gestão da Sessão</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div className="space-y-2">
                    <Label htmlFor="stake-value">Valor do Contrato (USD)</Label>
                    <Input id="stake-value" type="number" value={stakeValue} onChange={e => setStakeValue(Number(e.target.value))} step="0.01" min="0.35" />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="daily-balance">Banca Diária (USD)</Label>
                      <Input id="daily-balance" type="number" value={dailyBalance} onChange={e => setDailyBalance(Number(e.target.value))} />
                  </div>
              </div>
              <div className="space-y-2">
                  <Label htmlFor="daily-target">Alvo de Lucro Diário (USD)</Label>
                  <Input id="daily-target" type="number" value={dailyTarget} onChange={e => setDailyTarget(Number(e.target.value))} />
              </div>
            </CardContent>
          </Card>
          <StrategySignalMonitor 
            signals={allSignals} 
            counts={strategyCounts}
            lastCalibrationTime={lastCalibrationTime}
          />
          <HFConfigPanel
            config={hfConfig}
            onConfigChange={updates => setHFConfig((prev: any) => ({ ...prev, ...updates }))}
          />
        </div>
      </div>
    </div>
  );
}

export default function HFStrikeZonePage() {
  return (
    <DerivApiProvider>
      <PageContent />
    </DerivApiProvider>
  );
}
