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

// NOVO: Regimes de ritmo e configuração de tempo
type MarketRhythm = 'volatile' | 'normal' | 'calm';
interface TimingRegime {
  volatile: number;
  normal: number;
  calm: number;
}
const TIMING_REGIMES: TimingRegime = {
  volatile: 25,    // 25s em mercados agitados
  normal: 40,      // 40s em condições normais
  calm: 55,        // 55s em períodos muito calmos
};


interface RiskManagerStatus {
  mode: 'Normal' | 'Cautious';
  lastLossReason: string | null;
  calmnessScoreThreshold: number;
  adaptiveDuration: number;
  marketRhythm: MarketRhythm;
}

// ============================================================================
// VULNERABILIDADE #2: Adicionando Multi-Scale Volatility
// ============================================================================
interface MultiScaleVolatility {
  immediate: number;   // Últimos 5 ticks
  short: number;       // Últimos 10 ticks
  medium: number;      // Últimos 20 ticks
}

interface PilotContractContext {
  id: number;
  dynamicSpikeMultiplier: number;
}


const VOLATILITY_LOOKBACK = 50;
const BASE_CALMNESS_THRESHOLD = 70;
const MAX_LOSS_PERCENT = 0.50; 
const TAKE_PROFIT_PERCENT = 1.25; 

const VOLATILITY_EXIT_MULTIPLIER_BBW = 1.8;
const ADX_EXIT_THRESHOLD = 25;
const ATR_EXIT_MULTIPLIER = 1.6;
const COOLDOWN_PERIOD_MS = 30000;
const DEFAULT_GROWTH_RATE = 0.03;
// A janela para análise de micro-volatilidade agora é definida pelo maior período
const MICRO_VOLATILITY_WINDOW = 20;

// --- NOVAS FUNÇÕES HELPER ---

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

  // Limiares ajustáveis
  const volatileTickRangeThreshold = (recentTicks[0]?.price || 1) * 0.0005; // 0.05% do preço
  
  if (bbwPercentile > 70 || indicators.adx > 22 || recentTickRange > volatileTickRangeThreshold) {
    return 'volatile';
  } else if (bbwPercentile < 30 && indicators.adx < 18) {
    return 'calm';
  }
  return 'normal';
}

// ============================================================================
// VULNERABILIDADE #2: Implementação da função de cálculo multi-escala
// ============================================================================
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


export function useAccumulatorsCouncil() {
  const { 
    activeSymbol, 
    botCandleData,
    priceTicks,
    executeTrade, 
    sellContract, 
    operationsLog, 
    isConnected,
    dataVersion
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
    calmnessScore: false,
    bbwIsLow: false,
    atrIsLow: false,
    zScoreIsStable: false,
  });

  const lastOpIdRef = useRef<number>(0);
  const executionRef = useRef(false);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const openPilotContractContextRef = useRef<PilotContractContext | null>(null);
  const lastSellReasonRef = useRef<string | null>(null);
  
  // VULNERABILIDADE #2: Substitui o ref de volatilidade única por um multi-escala
  const entryVolatilityRef = useRef<MultiScaleVolatility | null>(null);


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
        toast({
          title: `Piloto Automático (Acumuladores) ${isAutopilotOn ? 'Ativado' : 'Desativado'}`,
        });
    }, 0);
  }, [isAutopilotOn, toast, botStatus]); 

  const analyzeAndAdjustStrategy = useCallback((lastOp: Operation, localIndicators: Indicators, localMetrics: { avgBbw: number; avgAtr: number; }) => {
    const sellReason = lastSellReasonRef.current;
    lastSellReasonRef.current = null;

    if (lastOp.status === 'lost') {
      let reason = "Perda por quebra de barreira.";

      if (sellReason) {
        reason = sellReason;
      } else if (localIndicators.adx! > ADX_EXIT_THRESHOLD) {
        reason = `Pico de Tendência (ADX: ${localIndicators.adx!.toFixed(1)})`;
      } else if (localIndicators.bbw! > localMetrics.avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW) {
        reason = `Expansão de Volatilidade (BBW)`;
      } else if (localIndicators.atr! > localMetrics.avgAtr * ATR_EXIT_MULTIPLIER) {
        reason = `Aumento do Range (ATR)`;
      }

      setRiskManager(prev => {
        let newThreshold = prev.calmnessScoreThreshold;

        if (reason.includes('Kill Switch')) {
            newThreshold = Math.min(90, prev.calmnessScoreThreshold + 5); 
            setTimeout(() => toast({ title: '🤖 Gerente de Estratégia: Aprendizado Temporal', description: `O mercado está instável. O sistema será mais seletivo na próxima entrada.`, variant: "default" }), 0);
        } else {
            newThreshold = Math.min(90, prev.calmnessScoreThreshold + 15);
            setTimeout(() => toast({ title: '🤖 Gerente de Estratégia: Modo Cauteloso', description: `Limiar de Calmaria aumentado para ${newThreshold}. O sistema será mais seletivo.`, variant: 'destructive' }), 0);
        }
        
        return { ...prev, mode: 'Cautious', lastLossReason: reason, calmnessScoreThreshold: newThreshold };
      });

      setBotStatus('COOLDOWN');
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => {
        setBotStatus('MONITORING');
      }, COOLDOWN_PERIOD_MS);
    } else if (lastOp.status === 'won') {
       if(riskManager.mode === 'Cautious') {
           setRiskManager(prev => ({
             ...prev,
             mode: 'Normal',
             lastLossReason: null,
             calmnessScoreThreshold: BASE_CALMNESS_THRESHOLD,
           }));
           setTimeout(() => toast({ title: '🤖 Gerente de Estratégia: Modo Normal', description: 'Confiança recuperada. Parâmetros de risco restaurados.' }), 0);
       }
    }
  }, [riskManager.mode, toast]);

  useEffect(() => {
    if (!isAutopilotOn) {
        setBotStatus('PAUSED');
        return;
    }

    if (!isConnected || !activeSymbol || botCandleData.length < VOLATILITY_LOOKBACK) {
      setBotStatus('MONITORING');
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
                setTimeout(() => toast({ title: "🏆 Piloto: Meta de Lucro Atingida!", description: `Parabéns! O sistema foi pausado. Lucro do dia: $${dailyPnL.toFixed(2)}` }), 0);
            }
            return true;
        }
        return false;
      }
      
      if (checkStopConditions()) {
          executionRef.current = false;
          return;
      }

      const realtimeBotCandles = [...botCandleData];
      if (realtimeBotCandles.length > 0 && priceTicks.length > 0) {
          const lastCandle = realtimeBotCandles[realtimeBotCandles.length - 1];
          const latestTick = priceTicks[priceTicks.length - 1];
          
          if (latestTick && lastCandle) {
              if (latestTick.epoch >= lastCandle.epoch && latestTick.epoch < lastCandle.epoch + 60) {
                  const lastCandleMutable = { ...lastCandle };
                  lastCandleMutable.close = latestTick.price;
                  lastCandleMutable.high = Math.max(lastCandle.high, latestTick.price);
                  lastCandleMutable.low = Math.min(lastCandle.low, latestTick.price);
                  realtimeBotCandles[realtimeBotCandles.length - 1] = lastCandleMutable;
              } else if (latestTick.epoch >= lastCandle.epoch + 60) {
                  const newCandle: CandleData = {
                      epoch: Math.floor(latestTick.epoch / 60) * 60,
                      open: latestTick.price,
                      high: latestTick.price,
                      low: latestTick.price,
                      close: latestTick.price,
                      volume: 1,
                  };
                  realtimeBotCandles.push(newCandle);
              }
          }
      }

      const calculatedIndicators = calculateAllIndicators(realtimeBotCandles, initialCouncilStrategies, '1m', {duration: 15, unit: 's'});
      if (!calculatedIndicators || !calculatedIndicators.bbw || !calculatedIndicators.atr || !calculatedIndicators.adx || !calculatedIndicators.adxSeries) {
          executionRef.current = false;
          return;
      }

      const marketRhythm = detectMarketRhythm(calculatedIndicators, priceTicks);
      const baseDuration = TIMING_REGIMES[marketRhythm];
      setRiskManager(prev => ({...prev, marketRhythm, adaptiveDuration: baseDuration }));

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
            const dynamicSpikeMultiplier = 2.5; 
            openPilotContractContextRef.current = { id: pilotOpenPosition.id, dynamicSpikeMultiplier };
        }

        setBotStatus('POSITION_OPEN');
        
        // VULNERABILIDADE #2: Lógica de veto multi-escala
        let microVolatilityVeto = false;
        const baselineVolatility = entryVolatilityRef.current;
        
        if (priceTicks.length > MICRO_VOLATILITY_WINDOW && baselineVolatility) {
            const currentVolatility = calculateMultiScaleVolatility(priceTicks);
            const context = openPilotContractContextRef.current;
            const dynamicMultiplier = (context && context.id === pilotOpenPosition.id) ? context.dynamicSpikeMultiplier : 2.5;

            const immediateVeto = currentVolatility.immediate > baselineVolatility.immediate * 2.0;
            const shortVeto = currentVolatility.short > baselineVolatility.short * dynamicMultiplier;
            const mediumVeto = currentVolatility.medium > baselineVolatility.medium * 3.0;

            if (immediateVeto || shortVeto || mediumVeto) {
                microVolatilityVeto = true;
            }
        }
        
        const isVolatilityExpanding = calculatedIndicators.bbw! > localMetrics.avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW || calculatedIndicators.atr! > localMetrics.avgAtr * ATR_EXIT_MULTIPLIER || calculatedIndicators.adx! > ADX_EXIT_THRESHOLD;
        const hasReachedStopLoss = (pilotOpenPosition.result || 0) <= -pilotOpenPosition.stake * MAX_LOSS_PERCENT;
        const hasReachedTakeProfit = (pilotOpenPosition.result || 0) >= pilotOpenPosition.stake * TAKE_PROFIT_PERCENT;
        const entryTime = new Date(pilotOpenPosition.timestamp).getTime();
        const elapsedTimeInSeconds = (Date.now() - entryTime) / 1000;
        const killSwitchTriggered = elapsedTimeInSeconds >= riskManager.adaptiveDuration;
        
        let shouldSell = false; let reason = '';

        if (hasReachedTakeProfit) { shouldSell = true; reason = `Alvo de ${TAKE_PROFIT_PERCENT*100}% atingido ($${(pilotOpenPosition.result || 0).toFixed(2)}).`;
        } else if (microVolatilityVeto) { shouldSell = true; reason = 'Disjuntor Ativado: Pico de volatilidade instantânea detectado.';
        } else if (killSwitchTriggered) { shouldSell = true; reason = `Kill Switch de Tempo (${riskManager.adaptiveDuration}s) ativado para limitar exposição.`;
        } else if (isVolatilityExpanding) { shouldSell = true; reason = 'Veto de Volatilidade: Risco de mercado aumentou.';
        } else if (hasReachedStopLoss) { shouldSell = true; reason = `Stop Loss de ${MAX_LOSS_PERCENT * 100}% atingido.`; }
        
        if (shouldSell) {
          setTimeout(() => toast({ title: "🤖 Piloto: A fechar posição", description: reason, }), 0);
          lastSellReasonRef.current = reason;
          await sellContract(pilotOpenPosition.id);
          openPilotContractContextRef.current = null;
          entryVolatilityRef.current = null;
        }
      } else {
        if(openPilotContractContextRef.current !== null) { openPilotContractContextRef.current = null; entryVolatilityRef.current = null; }
        if(botStatus === 'COOLDOWN') { executionRef.current = false; return; }
        
        const { adx, bbw, zScore } = calculatedIndicators;
        const adxScore = Math.max(0, 100 - ((Math.max(0, (adx || 35) - 15) / 20) * 100));
        const bbwScore = localMetrics.avgBbw > 0 ? Math.max(0, 100 - ((bbw! / (localMetrics.avgBbw * 1.5)) * 100)) : 50;
        let tickVolatilityScore = 50;
        if (priceTicks.length >= 20) {
            const recentTickPrices = priceTicks.slice(-20).map(t => t.price);
            const avgTickPrice = recentTickPrices.reduce((s, p) => s + p, 0) / 20;
            const tickStdDev = Math.sqrt(recentTickPrices.reduce((s, p) => s + Math.pow(p - avgTickPrice, 2), 0) / 20);
            const normalizedTickVolatility = avgTickPrice > 0 ? (tickStdDev / avgTickPrice) : 0;
            tickVolatilityScore = Math.max(0, 100 - (normalizedTickVolatility * 100000));
        }

        const finalCalmnessScore = (adxScore * 0.25) + (bbwScore * 0.25) + (tickVolatilityScore * 0.50);
        setCalmnessScore(finalCalmnessScore);
        
        const calmnessScoreMet = finalCalmnessScore >= riskManager.calmnessScoreThreshold;
        const bbwIsLow = bbw! < localMetrics.avgBbw;
        const atrIsLow = calculatedIndicators.atr! < localMetrics.avgAtr;
        const zScoreIsStable = Math.abs(zScore || 0) < 1.0;

        setEntryConditions({ calmnessScore: calmnessScoreMet, bbwIsLow, atrIsLow, zScoreIsStable });
        
        const isCalm = calmnessScoreMet && bbwIsLow && atrIsLow && zScoreIsStable;

        let dynamicSpikeMultiplier = 2.5; 
        const bbwRatio = localMetrics.avgBbw > 0 ? bbw! / localMetrics.avgBbw : 1;
        if (bbwRatio < 0.7) { dynamicSpikeMultiplier = 2.0; } else if (bbwRatio > 1.3) { dynamicSpikeMultiplier = 3.5; }

        if (isCalm) {
          setBotStatus('CALM_DETECTED');
          const stake = Math.max(1.0, Math.min(dailyBalance * 0.1, 10));
          
          // VULNERABILIDADE #2: Captura a volatilidade multi-escala no momento da entrada
          entryVolatilityRef.current = calculateMultiScaleVolatility(priceTicks);
          
          setTimeout(() => toast({ title: "🤖 Piloto: Posição Aberta!", description: `Calmaria detectada. Contrato aberto com taxa de ${DEFAULT_GROWTH_RATE * 100}%.` }), 0);

          const result = await executeTrade(stake, DEFAULT_GROWTH_RATE, activeSymbol, 'Piloto');
          if (result.success && result.contractId) {
              openPilotContractContextRef.current = { id: result.contractId, dynamicSpikeMultiplier, };
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

I'll also update the architecture document `docs/deriv-trader-accumulators-architecture.md` to reflect this new multi-scale defense mechanism.Engenheiro, você está correto em procurar uma camada de defesa mais rápida e sofisticada. O mercado de ticks é um ambiente de ruído e picos repentinos. Confiar numa única janela temporal para o nosso "disjuntor" é como usar apenas um sensor sísmico para prever um terramoto — podemos perder as primeiras e mais críticas vibrações.

Implementei a sua proposta de um **Sistema de Detecção de Volatilidade em Múltiplas Escalas**, transformando o nosso "disjuntor" num sistema de defesa em profundidade, muito mais robusto.

**As Suas Melhorias, Agora em Código:**

1.  **Análise Multi-Escala:** O cérebro do piloto (`use-accumulators-council.ts`) agora calcula continuamente o desvio padrão da volatilidade em três janelas de tempo distintas:
    *   **Imediata (5 ticks):** Para detetar picos de altíssima frequência.
    *   **Curta (10 ticks):** A nossa janela padrão.
    *   **Média (20 ticks):** Para identificar o início de uma tendência de volatilidade.

2.  **Linha de Base Multi-Dimensional:** No momento exato em que uma posição é aberta, o sistema tira uma "fotografia" da volatilidade em todas as três escalas, criando uma linha de base precisa da "calmaria" para aquela operação específica.

3.  **Veto por Múltiplos Fatores:** A lógica de venda de emergência foi aprimorada. Uma posição agora é ejetada se **qualquer uma** das seguintes condições for satisfeita, cada uma com uma sensibilidade ajustada:
    *   **`Veto Imediato`:** Volatilidade de 5 ticks > **2.0x** da sua linha de base.
    *   **`Veto de Curto Prazo`:** Volatilidade de 10 ticks > **Multiplicador Dinâmico (2.0x a 3.5x)** da sua linha de base.
    *   **`Veto de Médio Prazo`:** Volatilidade de 20 ticks > **3.0x** da sua linha de base.

4.  **Documentação Atualizada:** A arquitetura do sistema no ficheiro `docs/deriv-trader-accumulators-architecture.md` foi atualizada para refletir este novo e crucial mecanismo de "Disjuntor Dinâmico" multi-escala, detalhando como esta defesa em camadas nos protege contra diferentes tipos de explosões de volatilidade.

Esta melhoria transforma a nossa defesa de um simples alarme para um sistema de alerta precoce. Agora, somos capazes de detetar tanto os tremores subtis que precedem um grande movimento quanto os picos súbitos e violentos, permitindo que o sistema proteja o nosso capital com muito mais eficácia e inteligência.

<changes>
  <description>Refatora o sistema de "disjuntor de volatilidade" do robô Deriv Accumulators para usar uma análise multi-escala (5, 10 e 20 ticks) com sensibilidades diferentes, proporcionando uma defesa mais robusta e rápida contra picos de volatilidade súbitos. Atualiza a documentação da arquitetura para refletir a nova lógica.</description>
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

// NOVO: Regimes de ritmo e configuração de tempo
type MarketRhythm = 'volatile' | 'normal' | 'calm';
interface TimingRegime {
  volatile: number;
  normal: number;
  calm: number;
}
const TIMING_REGIMES: TimingRegime = {
  volatile: 25,    // 25s em mercados agitados
  normal: 40,      // 40s em condições normais
  calm: 55,        // 55s em períodos muito calmos
};


interface RiskManagerStatus {
  mode: 'Normal' | 'Cautious';
  lastLossReason: string | null;
  calmnessScoreThreshold: number;
  adaptiveDuration: number;
  marketRhythm: MarketRhythm;
}

// ============================================================================
// VULNERABILIDADE #2: Adicionando Multi-Scale Volatility
// ============================================================================
interface MultiScaleVolatility {
  immediate: number;   // Últimos 5 ticks
  short: number;       // Últimos 10 ticks
  medium: number;      // Últimos 20 ticks
}

interface PilotContractContext {
  id: number;
  dynamicSpikeMultiplier: number;
}


const VOLATILITY_LOOKBACK = 50;
const BASE_CALMNESS_THRESHOLD = 70;
const MAX_LOSS_PERCENT = 0.50; 
const TAKE_PROFIT_PERCENT = 1.25; 

const VOLATILITY_EXIT_MULTIPLIER_BBW = 1.8;
const ADX_EXIT_THRESHOLD = 25;
const ATR_EXIT_MULTIPLIER = 1.6;
const COOLDOWN_PERIOD_MS = 30000;
const DEFAULT_GROWTH_RATE = 0.03;
// A janela para análise de micro-volatilidade agora é definida pelo maior período
const MICRO_VOLATILITY_WINDOW = 20;

// --- NOVAS FUNÇÕES HELPER ---

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

  // Limiares ajustáveis
  const volatileTickRangeThreshold = (recentTicks[0]?.price || 1) * 0.0005; // 0.05% do preço
  
  if (bbwPercentile > 70 || indicators.adx > 22 || recentTickRange > volatileTickRangeThreshold) {
    return 'volatile';
  } else if (bbwPercentile < 30 && indicators.adx < 18) {
    return 'calm';
  }
  return 'normal';
}

// ============================================================================
// VULNERABILIDADE #2: Implementação da função de cálculo multi-escala
// ============================================================================
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


export function useAccumulatorsCouncil() {
  const { 
    activeSymbol, 
    botCandleData,
    priceTicks,
    executeTrade, 
    sellContract, 
    operationsLog, 
    isConnected,
    dataVersion
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
    calmnessScore: false,
    bbwIsLow: false,
    atrIsLow: false,
    zScoreIsStable: false,
  });

  const lastOpIdRef = useRef<number>(0);
  const executionRef = useRef(false);
  const cooldownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const openPilotContractContextRef = useRef<PilotContractContext | null>(null);
  const lastSellReasonRef = useRef<string | null>(null);
  
  // VULNERABILIDADE #2: Substitui o ref de volatilidade única por um multi-escala
  const entryVolatilityRef = useRef<MultiScaleVolatility | null>(null);


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
        toast({
          title: `Piloto Automático (Acumuladores) ${isAutopilotOn ? 'Ativado' : 'Desativado'}`,
        });
    }, 0);
  }, [isAutopilotOn, toast, botStatus]); 

  const analyzeAndAdjustStrategy = useCallback((lastOp: Operation, localIndicators: Indicators, localMetrics: { avgBbw: number; avgAtr: number; }) => {
    const sellReason = lastSellReasonRef.current;
    lastSellReasonRef.current = null;

    if (lastOp.status === 'lost') {
      let reason = "Perda por quebra de barreira.";

      if (sellReason) {
        reason = sellReason;
      } else if (localIndicators.adx! > ADX_EXIT_THRESHOLD) {
        reason = `Pico de Tendência (ADX: ${localIndicators.adx!.toFixed(1)})`;
      } else if (localIndicators.bbw! > localMetrics.avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW) {
        reason = `Expansão de Volatilidade (BBW)`;
      } else if (localIndicators.atr! > localMetrics.avgAtr * ATR_EXIT_MULTIPLIER) {
        reason = `Aumento do Range (ATR)`;
      }

      setRiskManager(prev => {
        let newThreshold = prev.calmnessScoreThreshold;

        if (reason.includes('Kill Switch')) {
            newThreshold = Math.min(90, prev.calmnessScoreThreshold + 5); 
            setTimeout(() => toast({ title: '🤖 Gerente de Estratégia: Aprendizado Temporal', description: `O mercado está instável. O sistema será mais seletivo na próxima entrada.`, variant: "default" }), 0);
        } else {
            newThreshold = Math.min(90, prev.calmnessScoreThreshold + 15);
            setTimeout(() => toast({ title: '🤖 Gerente de Estratégia: Modo Cauteloso', description: `Limiar de Calmaria aumentado para ${newThreshold}. O sistema será mais seletivo.`, variant: 'destructive' }), 0);
        }
        
        return { ...prev, mode: 'Cautious', lastLossReason: reason, calmnessScoreThreshold: newThreshold };
      });

      setBotStatus('COOLDOWN');
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => {
        setBotStatus('MONITORING');
      }, COOLDOWN_PERIOD_MS);
    } else if (lastOp.status === 'won') {
       if(riskManager.mode === 'Cautious') {
           setRiskManager(prev => ({
             ...prev,
             mode: 'Normal',
             lastLossReason: null,
             calmnessScoreThreshold: BASE_CALMNESS_THRESHOLD,
           }));
           setTimeout(() => toast({ title: '🤖 Gerente de Estratégia: Modo Normal', description: 'Confiança recuperada. Parâmetros de risco restaurados.' }), 0);
       }
    }
  }, [riskManager.mode, toast]);

  useEffect(() => {
    if (!isAutopilotOn) {
        setBotStatus('PAUSED');
        return;
    }

    if (!isConnected || !activeSymbol || botCandleData.length < VOLATILITY_LOOKBACK) {
      setBotStatus('MONITORING');
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
                setTimeout(() => toast({ title: "🏆 Piloto: Meta de Lucro Atingida!", description: `Parabéns! O sistema foi pausado. Lucro do dia: $${dailyPnL.toFixed(2)}` }), 0);
            }
            return true;
        }
        return false;
      }
      
      if (checkStopConditions()) {
          executionRef.current = false;
          return;
      }

      const realtimeBotCandles = [...botCandleData];
      if (realtimeBotCandles.length > 0 && priceTicks.length > 0) {
          const lastCandle = realtimeBotCandles[realtimeBotCandles.length - 1];
          const latestTick = priceTicks[priceTicks.length - 1];
          
          if (latestTick && lastCandle) {
              if (latestTick.epoch >= lastCandle.epoch && latestTick.epoch < lastCandle.epoch + 60) {
                  const lastCandleMutable = { ...lastCandle };
                  lastCandleMutable.close = latestTick.price;
                  lastCandleMutable.high = Math.max(lastCandle.high, latestTick.price);
                  lastCandleMutable.low = Math.min(lastCandle.low, latestTick.price);
                  realtimeBotCandles[realtimeBotCandles.length - 1] = lastCandleMutable;
              } else if (latestTick.epoch >= lastCandle.epoch + 60) {
                  const newCandle: CandleData = {
                      epoch: Math.floor(latestTick.epoch / 60) * 60,
                      open: latestTick.price,
                      high: latestTick.price,
                      low: latestTick.price,
                      close: latestTick.price,
                      volume: 1,
                  };
                  realtimeBotCandles.push(newCandle);
              }
          }
      }

      const calculatedIndicators = calculateAllIndicators(realtimeBotCandles, initialCouncilStrategies, '1m', {duration: 15, unit: 's'});
      if (!calculatedIndicators || !calculatedIndicators.bbw || !calculatedIndicators.atr || !calculatedIndicators.adx || !calculatedIndicators.adxSeries) {
          executionRef.current = false;
          return;
      }

      const marketRhythm = detectMarketRhythm(calculatedIndicators, priceTicks);
      const baseDuration = TIMING_REGIMES[marketRhythm];
      setRiskManager(prev => ({...prev, marketRhythm, adaptiveDuration: baseDuration }));

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
            const dynamicSpikeMultiplier = 2.5; 
            openPilotContractContextRef.current = { id: pilotOpenPosition.id, dynamicSpikeMultiplier };
        }

        setBotStatus('POSITION_OPEN');
        
        // VULNERABILIDADE #2: Lógica de veto multi-escala
        let microVolatilityVeto = false;
        const baselineVolatility = entryVolatilityRef.current;
        
        if (priceTicks.length > MICRO_VOLATILITY_WINDOW && baselineVolatility) {
            const currentVolatility = calculateMultiScaleVolatility(priceTicks);
            const context = openPilotContractContextRef.current;
            const dynamicMultiplier = (context && context.id === pilotOpenPosition.id) ? context.dynamicSpikeMultiplier : 2.5;

            const immediateVeto = currentVolatility.immediate > baselineVolatility.immediate * 2.0;
            const shortVeto = currentVolatility.short > baselineVolatility.short * dynamicMultiplier;
            const mediumVeto = currentVolatility.medium > baselineVolatility.medium * 3.0;

            if (immediateVeto || shortVeto || mediumVeto) {
                microVolatilityVeto = true;
            }
        }
        
        const isVolatilityExpanding = calculatedIndicators.bbw! > localMetrics.avgBbw * VOLATILITY_EXIT_MULTIPLIER_BBW || calculatedIndicators.atr! > localMetrics.avgAtr * ATR_EXIT_MULTIPLIER || calculatedIndicators.adx! > ADX_EXIT_THRESHOLD;
        const hasReachedStopLoss = (pilotOpenPosition.result || 0) <= -pilotOpenPosition.stake * MAX_LOSS_PERCENT;
        const hasReachedTakeProfit = (pilotOpenPosition.result || 0) >= pilotOpenPosition.stake * TAKE_PROFIT_PERCENT;
        const entryTime = new Date(pilotOpenPosition.timestamp).getTime();
        const elapsedTimeInSeconds = (Date.now() - entryTime) / 1000;
        const killSwitchTriggered = elapsedTimeInSeconds >= riskManager.adaptiveDuration;
        
        let shouldSell = false; let reason = '';

        if (hasReachedTakeProfit) { shouldSell = true; reason = `Alvo de ${TAKE_PROFIT_PERCENT*100}% atingido ($${(pilotOpenPosition.result || 0).toFixed(2)}).`;
        } else if (microVolatilityVeto) { shouldSell = true; reason = 'Disjuntor Ativado: Pico de volatilidade instantânea detectado.';
        } else if (killSwitchTriggered) { shouldSell = true; reason = `Kill Switch de Tempo (${riskManager.adaptiveDuration}s) ativado para limitar exposição.`;
        } else if (isVolatilityExpanding) { shouldSell = true; reason = 'Veto de Volatilidade: Risco de mercado aumentou.';
        } else if (hasReachedStopLoss) { shouldSell = true; reason = `Stop Loss de ${MAX_LOSS_PERCENT * 100}% atingido.`; }
        
        if (shouldSell) {
          setTimeout(() => toast({ title: "🤖 Piloto: A fechar posição", description: reason, }), 0);
          lastSellReasonRef.current = reason;
          await sellContract(pilotOpenPosition.id);
          openPilotContractContextRef.current = null;
          entryVolatilityRef.current = null;
        }
      } else {
        if(openPilotContractContextRef.current !== null) { openPilotContractContextRef.current = null; entryVolatilityRef.current = null; }
        if(botStatus === 'COOLDOWN') { executionRef.current = false; return; }
        
        const { adx, bbw, zScore } = calculatedIndicators;
        const adxScore = Math.max(0, 100 - ((Math.max(0, (adx || 35) - 15) / 20) * 100));
        const bbwScore = localMetrics.avgBbw > 0 ? Math.max(0, 100 - ((bbw! / (localMetrics.avgBbw * 1.5)) * 100)) : 50;
        let tickVolatilityScore = 50;
        if (priceTicks.length >= 20) {
            const recentTickPrices = priceTicks.slice(-20).map(t => t.price);
            const avgTickPrice = recentTickPrices.reduce((s, p) => s + p, 0) / 20;
            const tickStdDev = Math.sqrt(recentTickPrices.reduce((s, p) => s + Math.pow(p - avgTickPrice, 2), 0) / 20);
            const normalizedTickVolatility = avgTickPrice > 0 ? (tickStdDev / avgTickPrice) : 0;
            tickVolatilityScore = Math.max(0, 100 - (normalizedTickVolatility * 100000));
        }

        const finalCalmnessScore = (adxScore * 0.25) + (bbwScore * 0.25) + (tickVolatilityScore * 0.50);
        setCalmnessScore(finalCalmnessScore);
        
        const calmnessScoreMet = finalCalmnessScore >= riskManager.calmnessScoreThreshold;
        const bbwIsLow = bbw! < localMetrics.avgBbw;
        const atrIsLow = calculatedIndicators.atr! < localMetrics.avgAtr;
        const zScoreIsStable = Math.abs(zScore || 0) < 1.0;

        setEntryConditions({ calmnessScore: calmnessScoreMet, bbwIsLow, atrIsLow, zScoreIsStable });
        
        const isCalm = calmnessScoreMet && bbwIsLow && atrIsLow && zScoreIsStable;

        let dynamicSpikeMultiplier = 2.5; 
        const bbwRatio = localMetrics.avgBbw > 0 ? bbw! / localMetrics.avgBbw : 1;
        if (bbwRatio < 0.7) { dynamicSpikeMultiplier = 2.0; } else if (bbwRatio > 1.3) { dynamicSpikeMultiplier = 3.5; }

        if (isCalm) {
          setBotStatus('CALM_DETECTED');
          const stake = Math.max(1.0, Math.min(dailyBalance * 0.1, 10));
          
          // VULNERABILIDADE #2: Captura a volatilidade multi-escala no momento da entrada
          entryVolatilityRef.current = calculateMultiScaleVolatility(priceTicks);
          
          setTimeout(() => toast({ title: "🤖 Piloto: Posição Aberta!", description: `Calmaria detectada. Contrato aberto com taxa de ${DEFAULT_GROWTH_RATE * 100}%.` }), 0);

          const result = await executeTrade(stake, DEFAULT_GROWTH_RATE, activeSymbol, 'Piloto');
          if (result.success && result.contractId) {
              openPilotContractContextRef.current = { id: result.contractId, dynamicSpikeMultiplier, };
          }
        } else { setBotStatus('MONITORING'); }
      }
      executionRef.current = false;
    };
    runCycle();
  }, [ isAutopilotOn, isConnected, activeSymbol, dataVersion, botCandleData, priceTicks, dailyPnL, dailyBalance, dailyTarget, executeTrade, sellContract, toast, analyzeAndAdjustStrategy, operationsLog, botStatus, riskManager.adaptiveDuration ]);

  return { isAutopilotOn, toggleAutopilot, botStatus, volatilityMetrics: metrics, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget, dailyPnL, riskManager, calmnessScore, entryConditions };
}
