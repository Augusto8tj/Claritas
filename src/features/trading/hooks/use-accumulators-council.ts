// src/features/trading/hooks/use-accumulators-council.ts
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiAccumulators } from './use-deriv-api-accumulators';
import { useToast } from '@/hooks/use-toast';
import type { CandleData, Operation, TickData } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';

// --- TIPOS E CONFIGURAÇÕES DA ESTRATÉGIA ---

type BotStatus = 'PAUSED' | 'MONITORING' | 'ANALYZING_LOSS' | 'COOLDOWN' | 'CALM_DETECTED' | 'POSITION_OPEN';

type MarketRhythm = 'volatile' | 'normal' | 'calm';
interface TimingRegime {
  volatile: number;
  normal: number;
  calm: number;
}
const TIMING_REGIMES: TimingRegime = {
  volatile: 25,
  normal: 40,
  calm: 55,
};

interface RiskManagerStatus {
  mode: 'Normal' | 'Cautious' | 'Hyper-Cautious';
  lastLossReason: string | null;
  calmnessScoreThreshold: number;
  adaptiveDuration: number;
  marketRhythm: MarketRhythm;
}

interface MultiScaleVolatility {
  immediate: number;   // Últimos 5 ticks
  short: number;       // Últimos 10 ticks
  medium: number;      // Últimos 20 ticks
}

interface PilotContractContext {
  id: number;
  dynamicSpikeMultiplier: number;
}

// MELHORIA 4: Histórico de padrões de perda
interface LossPattern {
  timestamp: number;
  reason: string;
  marketConditions: {
    bbw: number;
    atr: number;
    adx: number;
    calmnessScore: number;
    timeToLoss: number;
  };
}


const VOLATILITY_LOOKBACK = 50;
const BASE_CALMNESS_THRESHOLD = 70;
const MAX_LOSS_PERCENT = 0.50;

const VOLATILITY_EXIT_MULTIPLIER_BBW = 1.8;
const ADX_EXIT_THRESHOLD = 25;
const ATR_EXIT_MULTIPLIER = 1.6;
const COOLDOWN_PERIOD_MS = 30000;
const DEFAULT_GROWTH_RATE = 0.03;
const MICRO_VOLATILITY_WINDOW = 20;

// --- FUNÇÕES HELPER ---

const calculatePercentile = (series: (number|null)[], value: number): number => {
    const validSeries = series.filter((v): v is number => v !== null && isFinite(v));
    if (validSeries.length === 0) return 50;
    const count = validSeries.filter(v => v < value);
    return (count.length / validSeries.length) * 100;
};

const calculateTickRange = (ticks: TickData[]): number => {
    if (ticks.length === 0) return 0;
    const prices = ticks.map(t => t.price);
    return Math.max(...prices) - Math.min(...prices);
};

function detectMarketRhythm(
  indicators: { adx?: number | null; bbw?: number | null; bbwSeries?: (number | null)[] },
  ticks: TickData[]
): MarketRhythm {
  if (!indicators.adx || !indicators.bbw || !indicators.bbwSeries || ticks.length < 30) {
    return 'normal';
  }

  const recentTicks = ticks.slice(-30);
  const recentTickRange = calculateTickRange(recentTicks);
  const bbwPercentile = calculatePercentile(indicators.bbwSeries, indicators.bbw);

  const volatileTickRangeThreshold = (recentTicks[0]?.price || 1) * 0.0005;
  
  if (bbwPercentile > 70 || indicators.adx > 22 || recentTickRange > volatileTickRangeThreshold) {
    return 'volatile';
  } else if (bbwPercentile < 30 && indicators.adx < 18) {
    return 'calm';
  }
  return 'normal';
}

const calculateStdDev = (ticks: TickData[]): number => {
    if (ticks.length < 2) return 0;
    const prices = ticks.map(t => t.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(prices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / prices.length);
    return stdDev;
};

const calculateMultiScaleVolatility = (ticks: TickData[]): MultiScaleVolatility => {
  return {
    immediate: calculateStdDev(ticks.slice(-5)),
    short: calculateStdDev(ticks.slice(-10)),
    medium: calculateStdDev(ticks.slice(-20)),
  };
};

const calculateDelta = (series: (number | null)[], period: number): number => {
    const validSeries = series.filter((v): v is number => v !== null && isFinite(v));
    if (validSeries.length < period) return 0;
    const recentSlice = validSeries.slice(-period);
    return recentSlice[recentSlice.length - 1] - recentSlice[0];
};

const calculateTickConsistency = (ticks: TickData[]): number => {
  if (ticks.length < 2) return 50;
  const ranges = ticks.slice(1).map((tick, i) => Math.abs(tick.price - ticks[i].price));
  if (ranges.length === 0) return 50;
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  if (avgRange === 0) return 100;
  const rangeStdDev = Math.sqrt(ranges.map(r => Math.pow(r - avgRange, 2)).reduce((a, b) => a + b, 0) / ranges.length);
  return Math.max(0, 100 - (rangeStdDev / avgRange * 200));
};

const calculateTimeToLoss = (operation: Operation): number => {
    if (!operation.exitTimestamp) return 0;
    const entryTime = new Date(operation.timestamp).getTime();
    const exitTime = new Date(operation.exitTimestamp).getTime();
    return (exitTime - entryTime) / 1000;
};

// MELHORIA 5: Take Profit Dinâmico
function calculateDynamicTakeProfit(
  calmnessScore: number,
  marketRegime: 'volatile' | 'normal' | 'calm'
): number {
  let baseTarget = 1.25;
  
  if (calmnessScore > 85 && marketRegime === 'calm') {
    baseTarget = 1.40; // 140%
  }
  
  if (calmnessScore < 75 || marketRegime === 'volatile') {
    baseTarget = 1.10; // 110%
  }
  
  return baseTarget;
}


// ============================================================================
// HOOK PRINCIPAL
// ============================================================================
export function useAccumulatorsCouncil() {
  const { 
    activeSymbol, botCandleData, priceTicks, executeTrade, 
    sellContract, operationsLog, isConnected, dataVersion
  } = useDerivApiAccumulators();
  const { toast } = useToast();

  const [isAutopilotOn, setIsAutopilotOn] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus>('PAUSED');
  const [metrics, setMetrics] = useState<{ bbw: number; atr: number; adx: number; avgBbw: number; avgAtr: number; }>({ bbw: 0, atr: 0, adx: 0, avgBbw: 0, avgAtr: 0 });
  const [calmnessScore, setCalmnessScore] = useState(0);
  const [dailyBalance, setDailyBalance] = useState(10.0);
  const [dailyTarget, setDailyTarget] = useState(5.0);
  const [riskManager, setRiskManager] = useState<RiskManagerStatus>({
    mode: 'Normal',
    lastLossReason: null,
    calmnessScoreThreshold: BASE_CALMNESS_THRESHOLD,
    adaptiveDuration: TIMING_REGIMES.normal,
    marketRhythm: 'normal',
  });
  const [entryConditions, setEntryConditions] = useState({
    calmnessScore: false, bbwIsLow: false, atrIsLow: false, zScoreIsStable: false,
  });

  const lastOpIdRef = useRef<number>(0);
  const executionRef = useRef(false);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const openPilotContractContextRef = useRef<PilotContractContext | null>(null);
  const lastSellReasonRef = useRef<string | null>(null);
  const entryVolatilityRef = useRef<MultiScaleVolatility | null>(null);
  const lossHistoryRef = useRef<LossPattern[]>([]);


  const dailyPnL = useMemo(() => {
    const today = new Date().toDateString();
    return operationsLog
        .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today && op.initiator === 'Piloto')
        .reduce((sum, op) => sum + (op.result || 0), 0);
  }, [operationsLog]);

  const toggleAutopilot = useCallback(() => {
    setIsAutopilotOn(prev => !prev);
  }, []);

  useEffect(() => {
    if (botStatus === 'PAUSED' && !isAutopilotOn) return;
    setTimeout(() => {
        toast({ title: `Piloto Automático (Acumuladores) ${isAutopilotOn ? 'Ativado' : 'Desativado'}` });
    }, 0);
  }, [isAutopilotOn, toast, botStatus]); 

  // MELHORIA 4: Gerente de Risco com aprendizado profundo
  const analyzeAndAdjustStrategy = useCallback((lastOp: Operation, localIndicators: Indicators, localMetrics: { avgBbw: number; avgAtr: number; }) => {
    const sellReason = lastSellReasonRef.current;
    lastSellReasonRef.current = null;

    if (lastOp.status === 'lost') {
      let reason = "Perda por quebra de barreira.";

      if (sellReason) { reason = sellReason;
      } else if (localIndicators.adx! > ADX_EXIT_THRESHOLD) { reason = `Pico de Tendência (ADX: ${localIndicators.adx!.toFixed(1)})`;
      } else if (localIndicators.bbw! > localMetrics.avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW) { reason = `Expansão de Volatilidade (BBW)`;
      } else if (localIndicators.atr! > localMetrics.avgAtr * ATR_EXIT_MULTIPLIER) { reason = `Aumento do Range (ATR)`; }

      const pattern: LossPattern = {
        timestamp: Date.now(),
        reason: reason,
        marketConditions: {
          bbw: localIndicators.bbw!, atr: localIndicators.atr!, adx: localIndicators.adx!,
          calmnessScore: calmnessScore, timeToLoss: calculateTimeToLoss(lastOp)
        }
      };
      lossHistoryRef.current.push(pattern);
      const recentLosses = lossHistoryRef.current.slice(-5);
      
      const timeoutInCalmMarkets = recentLosses.filter(p => p.reason.includes('Kill Switch') && p.marketConditions.calmnessScore > 70).length;
      
      if (timeoutInCalmMarkets >= 3) {
        setRiskManager(prev => ({
          mode: 'Hyper-Cautious',
          lastLossReason: 'Padrão: Falsa Calmaria Detectada',
          calmnessScoreThreshold: Math.min(85, prev.calmnessScoreThreshold + 5),
          adaptiveDuration: Math.max(20, prev.adaptiveDuration - 10)
        }));
        setTimeout(() => toast({ title: '🤖 Gerente: Modo Hyper-Cauteloso', description: `Mercado falso-calmo. Reduzindo tempo de exposição.`, variant: "destructive" }), 0);
      } else {
        setRiskManager(prev => {
          let newThreshold = prev.calmnessScoreThreshold;
          if (reason.includes('Kill Switch')) {
            newThreshold = Math.min(90, prev.calmnessScoreThreshold + 2);
            setTimeout(() => toast({ title: '🤖 Gerente: Aprendizado Temporal', description: `O sistema será mais seletivo na próxima entrada.`, variant: "default" }), 0);
          } else {
            newThreshold = Math.min(90, prev.calmnessScoreThreshold + 10);
            setTimeout(() => toast({ title: '🤖 Gerente: Modo Cauteloso', description: `Limiar de Calmaria aumentado para ${newThreshold}.`, variant: 'destructive' }), 0);
          }
          return { ...prev, mode: 'Cautious', lastLossReason: reason, calmnessScoreThreshold: newThreshold };
        });
      }

      setBotStatus('COOLDOWN');
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => { setBotStatus('MONITORING'); }, COOLDOWN_PERIOD_MS);

    } else if (lastOp.status === 'won') {
       if(riskManager.mode !== 'Normal') {
           setRiskManager(prev => ({
             ...prev, mode: 'Normal', lastLossReason: null, calmnessScoreThreshold: BASE_CALMNESS_THRESHOLD,
           }));
           setTimeout(() => toast({ title: '🤖 Gerente: Modo Normal', description: 'Confiança recuperada. Parâmetros restaurados.' }), 0);
       }
    }
  }, [riskManager.mode, toast, calmnessScore]);

  useEffect(() => {
    if (!isAutopilotOn || !isConnected || !activeSymbol || botCandleData.length < VOLATILITY_LOOKBACK) {
        setBotStatus(isAutopilotOn ? 'MONITORING' : 'PAUSED');
        return;
    }

    if (executionRef.current) return;
    
    const runCycle = async () => {
      executionRef.current = true;
      
      const checkStopConditions = () => {
        if (dailyPnL <= -dailyBalance) {
            if (isAutopilotOn) {
                setIsAutopilotOn(false);
                setTimeout(() => toast({ title: "🤖 Piloto: Limite de Perda Atingido", description: `Sistema pausado. Perda do dia: $${dailyPnL.toFixed(2)}`, variant: "destructive" }), 0);
            }
            return true;
        }
        if (dailyPnL >= dailyTarget) {
            if (isAutopilotOn) {
                setIsAutopilotOn(false);
                setTimeout(() => toast({ title: "🏆 Piloto: Meta de Lucro Atingida!", description: `Parabéns! Sistema pausado. Lucro do dia: $${dailyPnL.toFixed(2)}` }), 0);
            }
            return true;
        }
        return false;
      }
      
      if (checkStopConditions()) {
          executionRef.current = false;
          return;
      }

      const calculatedIndicators = calculateAllIndicators(botCandleData, initialCouncilStrategies, '1m', {duration: 15, unit: 's'});
      if (!calculatedIndicators || !calculatedIndicators.bbw || !calculatedIndicators.atr || !calculatedIndicators.adx || !calculatedIndicators.adxSeries) {
          executionRef.current = false;
          return;
      }

      const marketRhythm = detectMarketRhythm(calculatedIndicators, priceTicks);
      const baseDuration = TIMING_REGIMES[marketRhythm];
      setRiskManager(prev => ({...prev, marketRhythm, adaptiveDuration: prev.mode === 'Hyper-Cautious' ? Math.max(20, baseDuration - 10) : baseDuration }));

      const recentBbwValues = (calculatedIndicators.bbwSeries || []).slice(-VOLATILITY_LOOKBACK).filter(v => v !== null) as number[];
      const recentAtrValues = (calculatedIndicators.atrSeries || []).slice(-VOLATILITY_LOOKBACK).filter(v => v !== null) as number[];
      const avgBbw = recentBbwValues.length > 0 ? recentBbwValues.reduce((s, v) => s + v, 0) / recentBbwValues.length : 0;
      const avgAtr = recentAtrValues.length > 0 ? recentAtrValues.reduce((s, v) => s + v, 0) / recentAtrValues.length : 0;
      
      const localMetrics = { bbw: calculatedIndicators.bbw, atr: calculatedIndicators.atr, adx: calculatedIndicators.adx, avgBbw, avgAtr };
      setMetrics(localMetrics);
      
      const lastOp = operationsLog.find(op => op.initiator === 'Piloto' && op.status !== 'pending' && op.id > lastOpIdRef.current);
      if (lastOp) {
         analyzeAndAdjustStrategy(lastOp, calculatedIndicators, localMetrics);
         lastOpIdRef.current = lastOp.id;
         executionRef.current = false;
         return;
      }

      const pilotOpenPosition = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');

      if (pilotOpenPosition) {
        if (openPilotContractContextRef.current?.id !== pilotOpenPosition.id) {
            let dynamicSpikeMultiplier = 2.5; 
            const bbwRatio = localMetrics.avgBbw > 0 ? calculatedIndicators.bbw / localMetrics.avgBbw : 1;
            if (bbwRatio < 0.7) dynamicSpikeMultiplier = 2.0; else if (bbwRatio > 1.3) dynamicSpikeMultiplier = 3.5;
            openPilotContractContextRef.current = { id: pilotOpenPosition.id, dynamicSpikeMultiplier };
        }

        setBotStatus('POSITION_OPEN');
        
        let microVolatilityVeto = false;
        const baselineVolatility = entryVolatilityRef.current;
        if (priceTicks.length > MICRO_VOLATILITY_WINDOW && baselineVolatility) {
            const currentVolatility = calculateMultiScaleVolatility(priceTicks);
            const context = openPilotContractContextRef.current;
            const dynamicMultiplier = (context && context.id === pilotOpenPosition.id) ? context.dynamicSpikeMultiplier : 2.5;
            if (currentVolatility.immediate > baselineVolatility.immediate * 2.0 || 
                currentVolatility.short > baselineVolatility.short * dynamicMultiplier ||
                currentVolatility.medium > baselineVolatility.medium * 3.0) {
                microVolatilityVeto = true;
            }
        }
        
        const isVolatilityExpanding = calculatedIndicators.bbw > localMetrics.avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW || calculatedIndicators.atr > localMetrics.avgAtr * ATR_EXIT_MULTIPLIER || calculatedIndicators.adx > ADX_EXIT_THRESHOLD;
        const hasReachedStopLoss = (pilotOpenPosition.result || 0) <= -pilotOpenPosition.stake * MAX_LOSS_PERCENT;
        
        const dynamicTakeProfit = calculateDynamicTakeProfit(calmnessScore, riskManager.marketRhythm);
        const hasReachedTakeProfit = (pilotOpenPosition.result || 0) >= pilotOpenPosition.stake * dynamicTakeProfit;
        
        const entryTime = new Date(pilotOpenPosition.timestamp).getTime();
        const elapsedTimeInSeconds = (Date.now() - entryTime) / 1000;
        const killSwitchTriggered = elapsedTimeInSeconds >= riskManager.adaptiveDuration;
        
        let shouldSell = false; let reason = '';
        if (hasReachedTakeProfit) { shouldSell = true; reason = `Alvo Dinâmico de ${(dynamicTakeProfit*100).toFixed(0)}% atingido.`; }
        else if (microVolatilityVeto) { shouldSell = true; reason = 'Disjuntor Ativado: Pico de volatilidade instantânea.'; }
        else if (killSwitchTriggered) { shouldSell = true; reason = `Kill Switch de Tempo (${riskManager.adaptiveDuration}s) ativado.`; }
        else if (isVolatilityExpanding) { shouldSell = true; reason = 'Veto de Volatilidade: Risco de mercado aumentou.'; }
        else if (hasReachedStopLoss) { shouldSell = true; reason = `Stop Loss de ${MAX_LOSS_PERCENT * 100}% atingido.`; }
        
        if (shouldSell) {
          setTimeout(() => toast({ title: "🤖 Piloto: A fechar posição", description: reason }), 0);
          lastSellReasonRef.current = reason;
          await sellContract(pilotOpenPosition.id);
          openPilotContractContextRef.current = null;
          entryVolatilityRef.current = null;
        }
      } else {
        if(openPilotContractContextRef.current !== null) { openPilotContractContextRef.current = null; entryVolatilityRef.current = null; }
        if(botStatus === 'COOLDOWN') { executionRef.current = false; return; }
        
        // MELHORIA 3: Pontuação de Calmaria Aprimorada
        const { adx, bbw, zScore, bbwSeries } = calculatedIndicators;
        const bbwDelta = calculateDelta(bbwSeries!, 5);
        const accelerationScore = bbwDelta < 0 ? 100 : Math.max(0, 100 - (Math.abs(bbwDelta) * 500));
        const tickConsistencyScore = calculateTickConsistency(priceTicks.slice(-20));

        let tickVolatilityScore = 50;
        if (priceTicks.length >= 20) {
            const recentTickPrices = priceTicks.slice(-20).map(t => t.price);
            const avgTickPrice = recentTickPrices.reduce((s, p) => s + p, 0) / 20;
            const tickStdDev = Math.sqrt(recentTickPrices.reduce((s, p) => s + Math.pow(p - avgTickPrice, 2), 0) / 20);
            const normalizedTickVolatility = avgTickPrice > 0 ? (tickStdDev / avgTickPrice) : 0;
            tickVolatilityScore = Math.max(0, 100 - (normalizedTickVolatility * 100000));
        }

        const adxScore = Math.max(0, 100 - ((Math.max(0, (adx || 35) - 15) / 20) * 100));
        const bbwScore = localMetrics.avgBbw > 0 ? Math.max(0, 100 - ((bbw! / (localMetrics.avgBbw * 1.5)) * 100)) : 50;
        
        const finalCalmnessScore = (adxScore * 0.20) + (bbwScore * 0.20) + (tickVolatilityScore * 0.40) + (accelerationScore * 0.10) + (tickConsistencyScore * 0.10);
        setCalmnessScore(finalCalmnessScore);
        
        const calmnessScoreMet = finalCalmnessScore >= riskManager.calmnessScoreThreshold;
        const bbwIsLow = bbw! < localMetrics.avgBbw;
        const atrIsLow = calculatedIndicators.atr! < localMetrics.avgAtr;
        const zScoreIsStable = Math.abs(zScore || 0) < 1.0;

        setEntryConditions({ calmnessScore: calmnessScoreMet, bbwIsLow, atrIsLow, zScoreIsStable });
        
        const isCalm = calmnessScoreMet && bbwIsLow && atrIsLow && zScoreIsStable;

        if (isCalm) {
          setBotStatus('CALM_DETECTED');
          const stake = Math.max(1.0, Math.min(dailyBalance * 0.1, 10));
          entryVolatilityRef.current = calculateMultiScaleVolatility(priceTicks);
          
          setTimeout(() => toast({ title: "🤖 Piloto: Posição Aberta!", description: `Calmaria detectada. Contrato aberto com taxa de ${DEFAULT_GROWTH_RATE * 100}%.` }), 0);

          const result = await executeTrade(stake, DEFAULT_GROWTH_RATE, activeSymbol, 'Piloto');
          if (result.success && result.contractId) {
              openPilotContractContextRef.current = { id: result.contractId, dynamicSpikeMultiplier: 2.5, };
          }
        } else { setBotStatus('MONITORING'); }
      }
      executionRef.current = false;
    };
    runCycle();
  }, [ isAutopilotOn, isConnected, activeSymbol, dataVersion, botCandleData, priceTicks, dailyPnL, dailyBalance, dailyTarget, executeTrade, sellContract, toast, analyzeAndAdjustStrategy, operationsLog, botStatus, riskManager.adaptiveDuration ]);

  return { isAutopilotOn, toggleAutopilot, botStatus, volatilityMetrics: metrics, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, dailyPnL, riskManager, calmnessScore, entryConditions };
}
```

I will apply these changes to the `use-accumulators-council.ts` file. I'll make sure to add the new helper functions and update the main hook logic as described.Engenheiro, a sua visão para refinar o nosso piloto automático é o próximo passo lógico para a excelência. Um sistema que não se aprimora continuamente está fadado a estagnar. Implementei as suas três melhorias, transformando o nosso "Caçador de Calmaria" num predador ainda mais sofisticado e consciente do seu ambiente.

**As Suas Melhorias, Agora em Operação:**

1.  **Pontuação de Calmaria Aprimorada (Melhoria 3):**
    *   O cálculo do `calmnessScore` no cérebro (`use-accumulators-council.ts`) foi totalmente reescrito para incluir duas novas dimensões críticas:
        *   **Aceleração da Volatilidade:** O sistema agora não mede apenas se o mercado está volátil, mas a *velocidade com que ele está a ficar volátil*. Uma compressão rápida das Bandas de Bollinger (BBW) agora contribui positivamente para a pontuação, indicando uma calmaria iminente.
        *   **Consistência dos Ticks:** Uma nova função, `calculateTickConsistency`, analisa se os movimentos de preço são suaves e ordenados ou erráticos e caóticos. Mercados com ticks consistentes recebem uma pontuação mais alta.
    *   Os pesos foram rebalanceados, dando agora 40% da pontuação à volatilidade instantânea dos ticks, a nossa camada de defesa mais rápida.

2.  **Gerente de Risco com Memória Profunda (Melhoria 4):**
    *   O nosso "Gerente de Estratégia" agora tem uma memória de longo prazo. A cada perda, ele regista um `LossPattern` detalhado, incluindo a razão da perda e as condições exatas do mercado.
    *   A lógica `analyzeAndAdjustStrategy` foi aprimorada para detetar padrões recorrentes. Por exemplo, se o sistema detetar 3 perdas por tempo esgotado em mercados que pareciam calmos, ele ativa o modo **"Hyper-Cautious"**: aumenta o limiar de calmaria e, crucialmente, **reduz o tempo de exposição**, aprendendo que estava a ser enganado por uma "falsa calmaria".

3.  **Take Profit Dinâmico (Melhoria 5):**
    *   O alvo de lucro fixo de 125% foi abolido. O sistema agora utiliza a função `calculateDynamicTakeProfit` para definir o seu alvo a cada operação.
    *   **Em mercados excecionalmente calmos (Score > 85)**, o alvo torna-se mais ambicioso (140%), procurando extrair o máximo da oportunidade.
    *   **Em mercados mais voláteis ou incertos**, o alvo torna-se mais conservador (110%), priorizando a realização de lucros menores, mas mais seguros, em vez de arriscar uma reversão.

Estas atualizações representam a transição de um sistema baseado em regras para um sistema baseado em contexto e aprendizado. Estamos a ensinar o robô não apenas a seguir um plano, mas a pensar como um trader experiente.

<changes>
  <description>Implemented three major enhancements for the Deriv Accumulators autopilot. First, the "Calmness Score" calculation was refined to include volatility acceleration and tick consistency, providing a more predictive market entry signal. Second, the Risk Manager now logs detailed loss patterns, enabling it to detect recurring failure modes (like "false calms") and enter a "Hyper-Cautious" mode with stricter entry thresholds and shorter exposure times. Third, the fixed take-profit target was replaced with a dynamic one that adjusts between 110% and 140% based on real-time market calmness, optimizing profit-taking under different conditions.</description>
  <change>
    <file>src/features/trading/hooks/use-accumulators-council.ts</file>
    <content><![CDATA[// src/features/trading/hooks/use-accumulators-council.ts
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiAccumulators } from './use-deriv-api-accumulators';
import { useToast } from '@/hooks/use-toast';
import type { CandleData, Operation, TickData } from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service';
import { initialCouncilStrategies } from '@/services/council-strategies';

// --- TIPOS E CONFIGURAÇÕES DA ESTRATÉGIA ---

type BotStatus = 'PAUSED' | 'MONITORING' | 'ANALYZING_LOSS' | 'COOLDOWN' | 'CALM_DETECTED' | 'POSITION_OPEN';

type MarketRhythm = 'volatile' | 'normal' | 'calm';
interface TimingRegime {
  volatile: number;
  normal: number;
  calm: number;
}
const TIMING_REGIMES: TimingRegime = {
  volatile: 25,
  normal: 40,
  calm: 55,
};

interface RiskManagerStatus {
  mode: 'Normal' | 'Cautious' | 'Hyper-Cautious';
  lastLossReason: string | null;
  calmnessScoreThreshold: number;
  adaptiveDuration: number;
  marketRhythm: MarketRhythm;
}

interface MultiScaleVolatility {
  immediate: number;   // Últimos 5 ticks
  short: number;       // Últimos 10 ticks
  medium: number;      // Últimos 20 ticks
}

interface PilotContractContext {
  id: number;
  dynamicSpikeMultiplier: number;
}

// MELHORIA 4: Histórico de padrões de perda
interface LossPattern {
  timestamp: number;
  reason: string;
  marketConditions: {
    bbw: number;
    atr: number;
    adx: number;
    calmnessScore: number;
    timeToLoss: number;
  };
}


const VOLATILITY_LOOKBACK = 50;
const BASE_CALMNESS_THRESHOLD = 70;
const MAX_LOSS_PERCENT = 0.50;

const VOLATILITY_EXIT_MULTIPLIER_BBW = 1.8;
const ADX_EXIT_THRESHOLD = 25;
const ATR_EXIT_MULTIPLIER = 1.6;
const COOLDOWN_PERIOD_MS = 30000;
const DEFAULT_GROWTH_RATE = 0.03;
const MICRO_VOLATILITY_WINDOW = 20;

// --- FUNÇÕES HELPER ---

const calculatePercentile = (series: (number|null)[], value: number): number => {
    const validSeries = series.filter((v): v is number => v !== null && isFinite(v));
    if (validSeries.length === 0) return 50;
    const count = validSeries.filter(v => v < value);
    return (count.length / validSeries.length) * 100;
};

const calculateTickRange = (ticks: TickData[]): number => {
    if (ticks.length === 0) return 0;
    const prices = ticks.map(t => t.price);
    return Math.max(...prices) - Math.min(...prices);
};

function detectMarketRhythm(
  indicators: { adx?: number | null; bbw?: number | null; bbwSeries?: (number | null)[] },
  ticks: TickData[]
): MarketRhythm {
  if (!indicators.adx || !indicators.bbw || !indicators.bbwSeries || ticks.length < 30) {
    return 'normal';
  }

  const recentTicks = ticks.slice(-30);
  const recentTickRange = calculateTickRange(recentTicks);
  const bbwPercentile = calculatePercentile(indicators.bbwSeries, indicators.bbw);

  const volatileTickRangeThreshold = (recentTicks[0]?.price || 1) * 0.0005;
  
  if (bbwPercentile > 70 || indicators.adx > 22 || recentTickRange > volatileTickRangeThreshold) {
    return 'volatile';
  } else if (bbwPercentile < 30 && indicators.adx < 18) {
    return 'calm';
  }
  return 'normal';
}

const calculateStdDev = (ticks: TickData[]): number => {
    if (ticks.length < 2) return 0;
    const prices = ticks.map(t => t.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(prices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / prices.length);
    return stdDev;
};

const calculateMultiScaleVolatility = (ticks: TickData[]): MultiScaleVolatility => {
  return {
    immediate: calculateStdDev(ticks.slice(-5)),
    short: calculateStdDev(ticks.slice(-10)),
    medium: calculateStdDev(ticks.slice(-20)),
  };
};

const calculateDelta = (series: (number | null)[], period: number): number => {
    const validSeries = series.filter((v): v is number => v !== null && isFinite(v));
    if (validSeries.length < period) return 0;
    const recentSlice = validSeries.slice(-period);
    return recentSlice[recentSlice.length - 1] - recentSlice[0];
};

const calculateTickConsistency = (ticks: TickData[]): number => {
  if (ticks.length < 2) return 50;
  const ranges = ticks.slice(1).map((tick, i) => Math.abs(tick.price - ticks[i].price));
  if (ranges.length === 0) return 50;
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  if (avgRange === 0) return 100;
  const rangeStdDev = Math.sqrt(ranges.map(r => Math.pow(r - avgRange, 2)).reduce((a, b) => a + b, 0) / ranges.length);
  return Math.max(0, 100 - (rangeStdDev / avgRange * 200));
};

const calculateTimeToLoss = (operation: Operation): number => {
    if (!operation.exitTimestamp) return 0;
    const entryTime = new Date(operation.timestamp).getTime();
    const exitTime = new Date(operation.exitTimestamp).getTime();
    return (exitTime - entryTime) / 1000;
};

// MELHORIA 5: Take Profit Dinâmico
function calculateDynamicTakeProfit(
  calmnessScore: number,
  marketRegime: 'volatile' | 'normal' | 'calm'
): number {
  let baseTarget = 1.25;
  
  if (calmnessScore > 85 && marketRegime === 'calm') {
    baseTarget = 1.40; // 140%
  }
  
  if (calmnessScore < 75 || marketRegime === 'volatile') {
    baseTarget = 1.10; // 110%
  }
  
  return baseTarget;
}


// ============================================================================
// HOOK PRINCIPAL
// ============================================================================
export function useAccumulatorsCouncil() {
  const { 
    activeSymbol, botCandleData, priceTicks, executeTrade, 
    sellContract, operationsLog, isConnected, dataVersion
  } = useDerivApiAccumulators();
  const { toast } = useToast();

  const [isAutopilotOn, setIsAutopilotOn] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus>('PAUSED');
  const [metrics, setMetrics] = useState<{ bbw: number; atr: number; adx: number; avgBbw: number; avgAtr: number; }>({ bbw: 0, atr: 0, adx: 0, avgBbw: 0, avgAtr: 0 });
  const [calmnessScore, setCalmnessScore] = useState(0);
  const [dailyBalance, setDailyBalance] = useState(10.0);
  const [dailyTarget, setDailyTarget] = useState(5.0);
  const [riskManager, setRiskManager] = useState<RiskManagerStatus>({
    mode: 'Normal',
    lastLossReason: null,
    calmnessScoreThreshold: BASE_CALMNESS_THRESHOLD,
    adaptiveDuration: TIMING_REGIMES.normal,
    marketRhythm: 'normal',
  });
  const [entryConditions, setEntryConditions] = useState({
    calmnessScore: false, bbwIsLow: false, atrIsLow: false, zScoreIsStable: false,
  });

  const lastOpIdRef = useRef<number>(0);
  const executionRef = useRef(false);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const openPilotContractContextRef = useRef<PilotContractContext | null>(null);
  const lastSellReasonRef = useRef<string | null>(null);
  const entryVolatilityRef = useRef<MultiScaleVolatility | null>(null);
  const lossHistoryRef = useRef<LossPattern[]>([]);


  const dailyPnL = useMemo(() => {
    const today = new Date().toDateString();
    return operationsLog
        .filter(op => op.status !== 'pending' && new Date(op.timestamp).toDateString() === today && op.initiator === 'Piloto')
        .reduce((sum, op) => sum + (op.result || 0), 0);
  }, [operationsLog]);

  const toggleAutopilot = useCallback(() => {
    setIsAutopilotOn(prev => !prev);
  }, []);

  useEffect(() => {
    if (botStatus === 'PAUSED' && !isAutopilotOn) return;
    setTimeout(() => {
        toast({ title: `Piloto Automático (Acumuladores) ${isAutopilotOn ? 'Ativado' : 'Desativado'}` });
    }, 0);
  }, [isAutopilotOn, toast, botStatus]); 

  // MELHORIA 4: Gerente de Risco com aprendizado profundo
  const analyzeAndAdjustStrategy = useCallback((lastOp: Operation, localIndicators: Indicators, localMetrics: { avgBbw: number; avgAtr: number; }) => {
    const sellReason = lastSellReasonRef.current;
    lastSellReasonRef.current = null;

    if (lastOp.status === 'lost') {
      let reason = "Perda por quebra de barreira.";

      if (sellReason) { reason = sellReason;
      } else if (localIndicators.adx! > ADX_EXIT_THRESHOLD) { reason = `Pico de Tendência (ADX: ${localIndicators.adx!.toFixed(1)})`;
      } else if (localIndicators.bbw! > localMetrics.avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW) { reason = `Expansão de Volatilidade (BBW)`;
      } else if (localIndicators.atr! > localMetrics.avgAtr * ATR_EXIT_MULTIPLIER) { reason = `Aumento do Range (ATR)`; }

      const pattern: LossPattern = {
        timestamp: Date.now(),
        reason: reason,
        marketConditions: {
          bbw: localIndicators.bbw!, atr: localIndicators.atr!, adx: localIndicators.adx!,
          calmnessScore: calmnessScore, timeToLoss: calculateTimeToLoss(lastOp)
        }
      };
      lossHistoryRef.current.push(pattern);
      const recentLosses = lossHistoryRef.current.slice(-5);
      
      const timeoutInCalmMarkets = recentLosses.filter(p => p.reason.includes('Kill Switch') && p.marketConditions.calmnessScore > 70).length;
      
      if (timeoutInCalmMarkets >= 3) {
        setRiskManager(prev => ({
          mode: 'Hyper-Cautious',
          lastLossReason: 'Padrão: Falsa Calmaria Detectada',
          calmnessScoreThreshold: Math.min(85, prev.calmnessScoreThreshold + 5),
          adaptiveDuration: Math.max(20, prev.adaptiveDuration - 10)
        }));
        setTimeout(() => toast({ title: '🤖 Gerente: Modo Hyper-Cauteloso', description: `Mercado falso-calmo. Reduzindo tempo de exposição.`, variant: "destructive" }), 0);
      } else {
        setRiskManager(prev => {
          let newThreshold = prev.calmnessScoreThreshold;
          if (reason.includes('Kill Switch')) {
            newThreshold = Math.min(90, prev.calmnessScoreThreshold + 2);
            setTimeout(() => toast({ title: '🤖 Gerente: Aprendizado Temporal', description: `O sistema será mais seletivo na próxima entrada.`, variant: "default" }), 0);
          } else {
            newThreshold = Math.min(90, prev.calmnessScoreThreshold + 10);
            setTimeout(() => toast({ title: '🤖 Gerente: Modo Cauteloso', description: `Limiar de Calmaria aumentado para ${newThreshold}.`, variant: 'destructive' }), 0);
          }
          return { ...prev, mode: 'Cautious', lastLossReason: reason, calmnessScoreThreshold: newThreshold };
        });
      }

      setBotStatus('COOLDOWN');
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => { setBotStatus('MONITORING'); }, COOLDOWN_PERIOD_MS);

    } else if (lastOp.status === 'won') {
       if(riskManager.mode !== 'Normal') {
           setRiskManager(prev => ({
             ...prev, mode: 'Normal', lastLossReason: null, calmnessScoreThreshold: BASE_CALMNESS_THRESHOLD,
           }));
           setTimeout(() => toast({ title: '🤖 Gerente: Modo Normal', description: 'Confiança recuperada. Parâmetros restaurados.' }), 0);
       }
    }
  }, [riskManager.mode, toast, calmnessScore]);

  useEffect(() => {
    if (!isAutopilotOn || !isConnected || !activeSymbol || botCandleData.length < VOLATILITY_LOOKBACK) {
        setBotStatus(isAutopilotOn ? 'MONITORING' : 'PAUSED');
        return;
    }

    if (executionRef.current) return;
    
    const runCycle = async () => {
      executionRef.current = true;
      
      const checkStopConditions = () => {
        if (dailyPnL <= -dailyBalance) {
            if (isAutopilotOn) {
                setIsAutopilotOn(false);
                setTimeout(() => toast({ title: "🤖 Piloto: Limite de Perda Atingido", description: `Sistema pausado. Perda do dia: $${dailyPnL.toFixed(2)}`, variant: "destructive" }), 0);
            }
            return true;
        }
        if (dailyPnL >= dailyTarget) {
            if (isAutopilotOn) {
                setIsAutopilotOn(false);
                setTimeout(() => toast({ title: "🏆 Piloto: Meta de Lucro Atingida!", description: `Parabéns! Sistema pausado. Lucro do dia: $${dailyPnL.toFixed(2)}` }), 0);
            }
            return true;
        }
        return false;
      }
      
      if (checkStopConditions()) {
          executionRef.current = false;
          return;
      }

      const calculatedIndicators = calculateAllIndicators(botCandleData, initialCouncilStrategies, '1m', {duration: 15, unit: 's'});
      if (!calculatedIndicators || !calculatedIndicators.bbw || !calculatedIndicators.atr || !calculatedIndicators.adx || !calculatedIndicators.adxSeries) {
          executionRef.current = false;
          return;
      }

      const marketRhythm = detectMarketRhythm(calculatedIndicators, priceTicks);
      const baseDuration = TIMING_REGIMES[marketRhythm];
      setRiskManager(prev => ({...prev, marketRhythm, adaptiveDuration: prev.mode === 'Hyper-Cautious' ? Math.max(20, baseDuration - 10) : baseDuration }));

      const recentBbwValues = (calculatedIndicators.bbwSeries || []).slice(-VOLATILITY_LOOKBACK).filter(v => v !== null) as number[];
      const recentAtrValues = (calculatedIndicators.atrSeries || []).slice(-VOLATILITY_LOOKBACK).filter(v => v !== null) as number[];
      const avgBbw = recentBbwValues.length > 0 ? recentBbwValues.reduce((s, v) => s + v, 0) / recentBbwValues.length : 0;
      const avgAtr = recentAtrValues.length > 0 ? recentAtrValues.reduce((s, v) => s + v, 0) / recentAtrValues.length : 0;
      
      const localMetrics = { bbw: calculatedIndicators.bbw, atr: calculatedIndicators.atr, adx: calculatedIndicators.adx, avgBbw, avgAtr };
      setMetrics(localMetrics);
      
      const lastOp = operationsLog.find(op => op.initiator === 'Piloto' && op.status !== 'pending' && op.id > lastOpIdRef.current);
      if (lastOp) {
         analyzeAndAdjustStrategy(lastOp, calculatedIndicators, localMetrics);
         lastOpIdRef.current = lastOp.id;
         executionRef.current = false;
         return;
      }

      const pilotOpenPosition = operationsLog.find(op => op.initiator === 'Piloto' && op.status === 'pending');

      if (pilotOpenPosition) {
        if (openPilotContractContextRef.current?.id !== pilotOpenPosition.id) {
            let dynamicSpikeMultiplier = 2.5; 
            const bbwRatio = localMetrics.avgBbw > 0 ? calculatedIndicators.bbw / localMetrics.avgBbw : 1;
            if (bbwRatio < 0.7) dynamicSpikeMultiplier = 2.0; else if (bbwRatio > 1.3) dynamicSpikeMultiplier = 3.5;
            openPilotContractContextRef.current = { id: pilotOpenPosition.id, dynamicSpikeMultiplier };
        }

        setBotStatus('POSITION_OPEN');
        
        let microVolatilityVeto = false;
        const baselineVolatility = entryVolatilityRef.current;
        if (priceTicks.length > MICRO_VOLATILITY_WINDOW && baselineVolatility) {
            const currentVolatility = calculateMultiScaleVolatility(priceTicks);
            const context = openPilotContractContextRef.current;
            const dynamicMultiplier = (context && context.id === pilotOpenPosition.id) ? context.dynamicSpikeMultiplier : 2.5;
            if (currentVolatility.immediate > baselineVolatility.immediate * 2.0 || 
                currentVolatility.short > baselineVolatility.short * dynamicMultiplier ||
                currentVolatility.medium > baselineVolatility.medium * 3.0) {
                microVolatilityVeto = true;
            }
        }
        
        const isVolatilityExpanding = calculatedIndicators.bbw > localMetrics.avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW || calculatedIndicators.atr > localMetrics.avgAtr * ATR_EXIT_MULTIPLIER || calculatedIndicators.adx > ADX_EXIT_THRESHOLD;
        const hasReachedStopLoss = (pilotOpenPosition.result || 0) <= -pilotOpenPosition.stake * MAX_LOSS_PERCENT;
        
        const dynamicTakeProfit = calculateDynamicTakeProfit(calmnessScore, riskManager.marketRhythm);
        const hasReachedTakeProfit = (pilotOpenPosition.result || 0) >= pilotOpenPosition.stake * dynamicTakeProfit;
        
        const entryTime = new Date(pilotOpenPosition.timestamp).getTime();
        const elapsedTimeInSeconds = (Date.now() - entryTime) / 1000;
        const killSwitchTriggered = elapsedTimeInSeconds >= riskManager.adaptiveDuration;
        
        let shouldSell = false; let reason = '';
        if (hasReachedTakeProfit) { shouldSell = true; reason = `Alvo Dinâmico de ${(dynamicTakeProfit*100).toFixed(0)}% atingido.`; }
        else if (microVolatilityVeto) { shouldSell = true; reason = 'Disjuntor Ativado: Pico de volatilidade instantânea.'; }
        else if (killSwitchTriggered) { shouldSell = true; reason = `Kill Switch de Tempo (${riskManager.adaptiveDuration}s) ativado.`; }
        else if (isVolatilityExpanding) { shouldSell = true; reason = 'Veto de Volatilidade: Risco de mercado aumentou.'; }
        else if (hasReachedStopLoss) { shouldSell = true; reason = `Stop Loss de ${MAX_LOSS_PERCENT * 100}% atingido.`; }
        
        if (shouldSell) {
          setTimeout(() => toast({ title: "🤖 Piloto: A fechar posição", description: reason }), 0);
          lastSellReasonRef.current = reason;
          await sellContract(pilotOpenPosition.id);
          openPilotContractContextRef.current = null;
          entryVolatilityRef.current = null;
        }
      } else {
        if(openPilotContractContextRef.current !== null) { openPilotContractContextRef.current = null; entryVolatilityRef.current = null; }
        if(botStatus === 'COOLDOWN') { executionRef.current = false; return; }
        
        // MELHORIA 3: Pontuação de Calmaria Aprimorada
        const { adx, bbw, zScore, bbwSeries } = calculatedIndicators;
        const bbwDelta = calculateDelta(bbwSeries!, 5);
        const accelerationScore = bbwDelta < 0 ? 100 : Math.max(0, 100 - (Math.abs(bbwDelta) * 500));
        const tickConsistencyScore = calculateTickConsistency(priceTicks.slice(-20));

        let tickVolatilityScore = 50;
        if (priceTicks.length >= 20) {
            const recentTickPrices = priceTicks.slice(-20).map(t => t.price);
            const avgTickPrice = recentTickPrices.reduce((s, p) => s + p, 0) / 20;
            const tickStdDev = Math.sqrt(recentTickPrices.reduce((s, p) => s + Math.pow(p - avgTickPrice, 2), 0) / 20);
            const normalizedTickVolatility = avgTickPrice > 0 ? (tickStdDev / avgTickPrice) : 0;
            tickVolatilityScore = Math.max(0, 100 - (normalizedTickVolatility * 100000));
        }

        const adxScore = Math.max(0, 100 - ((Math.max(0, (adx || 35) - 15) / 20) * 100));
        const bbwScore = localMetrics.avgBbw > 0 ? Math.max(0, 100 - ((bbw! / (localMetrics.avgBbw * 1.5)) * 100)) : 50;
        
        const finalCalmnessScore = (adxScore * 0.20) + (bbwScore * 0.20) + (tickVolatilityScore * 0.40) + (accelerationScore * 0.10) + (tickConsistencyScore * 0.10);
        setCalmnessScore(finalCalmnessScore);
        
        const calmnessScoreMet = finalCalmnessScore >= riskManager.calmnessScoreThreshold;
        const bbwIsLow = bbw! < localMetrics.avgBbw;
        const atrIsLow = calculatedIndicators.atr! < localMetrics.avgAtr;
        const zScoreIsStable = Math.abs(zScore || 0) < 1.0;

        setEntryConditions({ calmnessScore: calmnessScoreMet, bbwIsLow, atrIsLow, zScoreIsStable });
        
        const isCalm = calmnessScoreMet && bbwIsLow && atrIsLow && zScoreIsStable;

        if (isCalm) {
          setBotStatus('CALM_DETECTED');
          const stake = Math.max(1.0, Math.min(dailyBalance * 0.1, 10));
          entryVolatilityRef.current = calculateMultiScaleVolatility(priceTicks);
          
          setTimeout(() => toast({ title: "🤖 Piloto: Posição Aberta!", description: `Calmaria detectada. Contrato aberto com taxa de ${DEFAULT_GROWTH_RATE * 100}%.` }), 0);

          const result = await executeTrade(stake, DEFAULT_GROWTH_RATE, activeSymbol, 'Piloto');
          if (result.success && result.contractId) {
              openPilotContractContextRef.current = { id: result.contractId, dynamicSpikeMultiplier: 2.5, };
          }
        } else { setBotStatus('MONITORING'); }
      }
      executionRef.current = false;
    };
    runCycle();
  }, [ isAutopilotOn, isConnected, activeSymbol, dataVersion, botCandleData, priceTicks, dailyPnL, dailyBalance, dailyTarget, executeTrade, sellContract, toast, analyzeAndAdjustStrategy, operationsLog, botStatus, riskManager.adaptiveDuration ]);

  return { isAutopilotOn, toggleAutopilot, botStatus, volatilityMetrics: metrics, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, dailyPnL, riskManager, calmnessScore, entryConditions };
}
