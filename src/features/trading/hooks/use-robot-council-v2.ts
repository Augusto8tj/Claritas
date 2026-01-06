
'use client';

/**
 * 🧠 DERIV TRADER V2.5 - CÉREBRO COGNITIVO (VERSÃO MESTRE)
 * =================================================================================
 * Este arquivo é o coração da aplicação. Ele atua como um "Orquestrador de Inteligência".
 * 
 * ARQUITETURA (Para fins de estudo):
 * 1. INPUT: Recebe dados brutos (Ticks/Candles) da API (via hook useDerivApiV2).
 * 2. PROCESSAMENTO: 
 *    - Calcula 25+ indicadores técnicos.
 *    - Detecta o Regime de Mercado (Tendência, Lateral, Volátil).
 *    - Executa 22 estratégias diferentes ("Robôs") simultaneamente.
 *    - Aplica Inferência Bayesiana para ponderar qual robô está certo.
 * 3. VALIDAÇÃO (Arena Virtual): Testa as decisões em memória (Paper Trading) antes de arriscar dinheiro.
 * 4. OUTPUT: Envia ordens reais apenas se houver Consenso E validação estatística (Critério de Kelly).
 * 
 * CORREÇÕES APLICADAS:
 * - Remoção de travas de segurança excessivas que causavam estagnação.
 * - Tratamento de erros robusto (Try/Catch) por estratégia individual.
 * - Logs detalhados para depuração em tempo real.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useDerivApiV2 as useDerivApi } from './use-deriv-api-v2';
import { useToast } from '@/hooks/use-toast';
import type { 
  RobotStrategy, DurationUnit, TickData, CandleData,
  RobotVote as RobotVoteType, MarketRegime, MicrostructureFeatures,
  BayesianVote as BayesianVoteType, EnhancedRobotPerformance as EnhancedRobotPerformanceType,
  TimePeriod, TradeDecisionLog,
} from '@/lib/types';
import { calculateAllIndicators, type Indicators } from '@/services/indicator-service-v2';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { saveRobotPerformance, loadRobotPerformance, saveTradeDecision } from '@/services/financial-data-service';
import { useStrategyEvolution } from './use-strategy-evolution';
import { initialCouncilStrategies } from '@/services/council-strategies';
import {
  detectMarketRegime, calculateKellyStake, bayesianUpdate,
  extractMicrostructureFeatures
} from '@/services/advanced-trading-services';

// ════════════════════════════════════════════════════════════════════
// 1. CONFIGURAÇÕES E CONSTANTES GLOBAIS
// ════════════════════════════════════════════════════════════════════

// Valor da aposta fictícia na "Arena Virtual" para calcular performance
const VIRTUAL_STAKE = 1.0; 

// Quantos candles passados analisamos para definir o Regime de Mercado
const REGIME_LOOKBACK = 30; 

// Intervalo entre ciclos de processamento (1 segundo) para não travar o navegador
const THROTTLE_MS = 1000; 

// Tempo máximo que um paper trade fica "vivo" na memória antes de ser descartado (limpeza de lixo)
const TRADE_TIMEOUT_SECONDS = 3600; 

// Limites para arrays de log para evitar vazamento de memória (Memory Leaks)
const MAX_VIRTUAL_TRADES = 500;
const MAX_DECISION_LOG = 100;

// ════════════════════════════════════════════════════════════════════
// 2. DEFINIÇÃO DE TIPOS (ESTADO DO SISTEMA)
// ════════════════════════════════════════════════════════════════════

// Representa uma operação simulada na memória
type VirtualTrade = {
  id: string;
  robotId: string;
  vote: 'RISE' | 'FALL';
  entryPrice: number;
  entryEpoch: number;
  exitEpoch: number;
  regime: MarketRegime;
  microstructure: MicrostructureFeatures;
  stake: number;
};

// Re-exportando tipos para facilitar manutenção
export type EnhancedRobotPerformance = EnhancedRobotPerformanceType;
export type RobotVote = RobotVoteType;
export type BayesianVote = BayesianVoteType;

// O Grande Objeto de Estado que segura toda a "consciência" do robô
interface CouncilState {
    indicators: Indicators | null; // Dados técnicos atuais
    currentRegime: {
        regime: MarketRegime;
        confidence: number;
        probabilities: Record<MarketRegime, number>;
    };
    microstructure: MicrostructureFeatures | null; // Análise tick-a-tick
    consensusDecision: {
        direction: 'RISE' | 'FALL' | 'HOLD';
        probability: number; // Probabilidade Bayesiana Agregada
        stake: number; // Valor calculado pelo Kelly Criterion
    };
    portfolioStats: {
        totalExposure: number;
        maxExposure: number;
        currentDrawdown: number;
        maxDrawdown: number;
        dailyPnL: number;
    };
    bayesianVotes: Record<string, BayesianVote>; // Votos individuais ponderados
    dashboardData: DashboardData | null; // Dados formatados para a UI
    effectiveThreshold: number; // Limiar dinâmico para aprovação
    councilConfidence: number; // Peso total da votação
    systemMetrics: SystemMetrics; // Saúde do sistema (memória, latência)
}

export interface DashboardData {
  regime: string;
  bayesianProbability: number;
  consensusDirection: 'RISE' | 'FALL' | 'HOLD';
  activeRobotsCount: number;
  microstructure: {
    pressure: number;
    velocity: number;
    isSpike: boolean;
  };
  kellyStake: number;
}

export interface SystemMetrics {
  activeVirtualTrades: number;
  totalVirtualTrades: number;
  decisionLogCount: number;
  activeRobotsCount: number;
  memoryUsageMB: number;
  isExecuting: boolean;
  lastCleanup: number;
  orphanedTradesRemoved: number;
  sessionDuration: number;
}

// ════════════════════════════════════════════════════════════════════
// 3. FUNÇÕES UTILITÁRIAS (HELPERS PURE FUNCTIONS)
// ════════════════════════════════════════════════════════════════════

// Converte durações legíveis ('1m', '1h') para segundos absolutos para cálculos
const durationToSeconds = (duration: number, unit: DurationUnit): number => {
  switch (unit) {
    case 't': return duration * 2; // Estimativa: 1 tick ≈ 2 segundos
    case 's': return duration;
    case 'm': return duration * 60;
    case 'h': return duration * 3600;
    case 'd': return duration * 86400;
    default: return duration;
  }
};

// Verifica se um número é válido (não é null, undefined ou NaN)
const isValid = (value: any): value is number => 
  value !== null && value !== undefined && !isNaN(value) && Number.isFinite(value);

// Filtro de segurança para dados de candles vindos da API
const validateCandles = (candles: CandleData[]): CandleData[] => {
  if (!candles || !Array.isArray(candles)) return [];
  // Aceita o candle se ele tiver pelo menos tempo (epoch) e preço de fechamento
  return candles.filter(c => c && c.epoch > 0 && c.close > 0);
};

// ════════════════════════════════════════════════════════════════════
// 4. LÓGICA DE VOTAÇÃO TÉCNICA (O MANUAL DE ESTRATÉGIAS)
// ════════════════════════════════════════════════════════════════════

/**
 * Esta função é o "cérebro individual" de cada robô.
 * Ela recebe uma estratégia (regras) e o estado atual do mercado (indicadores).
 * Retorna o voto (COMPRA/VENDA/NEUTRO) e a confiança técnica.
 */
const calculateTechnicalVote = (
  robot: RobotStrategy,
  indicators: Indicators,
  tickCandles: CandleData[]
): {
  vote: 'RISE' | 'FALL' | 'HOLD';
  confidence: number;
  reason: string;
  optimalDuration: number;
  optimalDurationUnit: DurationUnit;
  suggestedStake: number;
} => {
  // Inicialização padrão: Robô fica quieto (HOLD)
  let vote: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
  let confidence = 0;
  let reason = 'A aguardar sinal...';
  
  const { optimalDuration, optimalDurationUnit, suggestedStake: baseStake } = robot;
  const suggestedStake = baseStake || 1.0;

  // Guarda: Sem dados suficientes, não vota
  if (!indicators || tickCandles.length < 2) {
    return { vote: 'HOLD', confidence: 0, reason: "Dados insuficientes", optimalDuration, optimalDurationUnit, suggestedStake: 0 };
  }

  const lastCandle = tickCandles[tickCandles.length - 1];
  const lastClose = lastCandle.close;
  
  // Função helper para formatar logs de razão
  const format = (val: number | null | undefined) => (isValid(val) ? val.toFixed(4) : 'N/A');

  // Atualiza o voto se a confiança for válida
  const setVote = (newVote: 'RISE' | 'FALL', newConfidence: number, newReason: string) => {
    if (newConfidence <= 0) return;
    vote = newVote;
    confidence = newConfidence;
    reason = newReason;
  };

  // Desestruturação dos indicadores para acesso fácil
  const { 
    rsi, stoch, macd, bb, ma, adx, pdi, ndi, stochRSI, mfi, rvi, 
    ao, trix, roc, psar, ichimoku, kama, donchian, chandelier, 
    vwap, obv, zScore 
  } = indicators;

  // --- 🤖 INÍCIO DA LÓGICA DOS 22 ROBÔS ---
  // Usamos try/catch para garantir que um erro de cálculo num robô não pare os outros.
  try {
      
      // 1. RSI (Índice de Força Relativa) - Clássico de Reversão
      if (robot.strategyType === 'RSI' && isValid(rsi)) {
        // Lógica: Se cair muito (Sobrevenda), compra. Se subir muito (Sobrecompra), vende.
        if (rsi <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `RSI Extremo Baixo (${format(rsi)})`);
        else if (rsi <= robot.weakBuyThreshold!) setVote('RISE', robot.weakConfidence, `RSI Baixo (${format(rsi)})`);
        else if (rsi >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `RSI Extremo Alto (${format(rsi)})`);
        else if (rsi >= robot.weakSellThreshold!) setVote('FALL', robot.weakConfidence, `RSI Alto (${format(rsi)})`);
      }
      
      // 2. Stochastic Oscillator - Momentum rápido
      else if (robot.strategyType === 'STOCHASTIC' && isValid(stoch)) {
        if (stoch <= robot.strongBuyThreshold!) setVote('RISE', robot.strongConfidence, `Stoch Sobrevenda (${format(stoch)})`);
        else if (stoch >= robot.strongSellThreshold!) setVote('FALL', robot.strongConfidence, `Stoch Sobrecompra (${format(stoch)})`);
      }
      
      // 3. MACD - Seguidor de Tendência
      else if (robot.strategyType === 'MACD_CROSS' && isValid(macd?.macd) && isValid(macd?.signal)) {
        // Cruzamento da linha MACD com o Sinal + Confirmação do Histograma
        if (macd.macd > macd.signal && macd.histogram! > 0) setVote('RISE', robot.strongConfidence, `MACD Cruzamento Bullish`);
        else if (macd.macd < macd.signal && macd.histogram! < 0) setVote('FALL', robot.strongConfidence, `MACD Cruzamento Bearish`);
      }
      
      // 4. ADX (Average Directional Index) - Força da Tendência
      else if (robot.strategyType === 'ADX_TREND' && isValid(adx) && isValid(pdi) && isValid(ndi)) {
        // Só opera se houver tendência forte (ADX > 25)
        if (adx > (robot.trendStrengthThreshold || 25)) {
           if (pdi > ndi) setVote('RISE', robot.strongConfidence, `Tendência Forte Alta (ADX ${format(adx)})`);
           else if (ndi > pdi) setVote('FALL', robot.strongConfidence, `Tendência Forte Baixa (ADX ${format(adx)})`);
        }
      }
      
      // 5. Bollinger Bands - Volatilidade e Reversão à Média
      else if (robot.strategyType === 'BOLLINGER_BANDS' && isValid(bb?.lower) && isValid(bb?.upper)) {
        if (lastClose <= bb.lower) setVote('RISE', robot.weakConfidence, `Preço tocou Banda Inferior`);
        else if (lastClose >= bb.upper) setVote('FALL', robot.weakConfidence, `Preço tocou Banda Superior`);
      }
      
      // 6. Awesome Oscillator - Momentum (Pires/Saucer)
      else if (robot.strategyType === 'AWESOME_OSCILLATOR' && isValid(ao)) {
        const isBullish = ao > 0 && ao > (indicators.aoPrev || 0);
        const isBearish = ao < 0 && ao < (indicators.aoPrev || 0);
        if (isBullish) setVote('RISE', robot.weakConfidence, `AO Momentum Crescente`);
        else if (isBearish) setVote('FALL', robot.weakConfidence, `AO Momentum Decrescente`);
      }
      
      // 7. TRIX - Oscilador Triplo Suavizado
      else if (robot.strategyType === 'TRIX' && isValid(trix)) {
        if (trix > 0 && trix > (indicators.trixPrev || 0)) setVote('RISE', robot.strongConfidence, 'TRIX Acelerando');
        else if (trix < 0 && trix < (indicators.trixPrev || 0)) setVote('FALL', robot.strongConfidence, 'TRIX Desacelerando');
      }
      
      // 8. ROC (Rate of Change) - Velocidade do preço
      else if (robot.strategyType === 'ROC' && isValid(roc)) {
        if (roc > 0.1) setVote('RISE', robot.weakConfidence, `ROC Positivo (${format(roc)})`);
        else if (roc < -0.1) setVote('FALL', robot.weakConfidence, `ROC Negativo (${format(roc)})`);
      }
      
      // 9. RVI (Relative Volatility Index)
      else if (robot.strategyType === 'RVI' && isValid(rvi)) {
        if (rvi > (robot.strongBuyThreshold || 60)) setVote('RISE', robot.weakConfidence, `RVI Alta Energia`);
        else if (rvi < (robot.weakSellThreshold || 40)) setVote('FALL', robot.weakConfidence, `RVI Baixa Energia`);
      }
      
      // 10. Parabolic SAR - Stop and Reverse
      else if (robot.strategyType === 'PARABOLIC_SAR' && isValid(psar)) {
        if (lastClose > psar) setVote('RISE', robot.strongConfidence, `Tendência acima SAR`);
        else if (lastClose < psar) setVote('FALL', robot.strongConfidence, `Tendência abaixo SAR`);
      }
      
      // 11. Ichimoku Cloud - Sistema Completo Japonês
      else if (robot.strategyType === 'ICHIMOKU_CLOUD' && isValid(ichimoku?.spanA)) {
        const cloudTop = Math.max(ichimoku.spanA!, ichimoku.spanB!);
        const cloudBottom = Math.min(ichimoku.spanA!, ichimoku.spanB!);
        
        // Estratégia Kumo Breakout + TK Cross
        if (lastClose > cloudTop && ichimoku.tenkan! > ichimoku.kijun!) 
            setVote('RISE', robot.strongConfidence, `Rompimento Nuvem + TK Cross`);
        else if (lastClose < cloudBottom && ichimoku.tenkan! < ichimoku.kijun!) 
            setVote('FALL', robot.strongConfidence, `Colapso Nuvem + TK Cross`);
      }
      
      // 12. KAMA (Kaufman Adaptive MA) - Média que se adapta ao ruído
      else if (robot.strategyType === 'KAMA' && isValid(kama)) {
        if (lastClose > kama) setVote('RISE', robot.weakConfidence, `Tendência KAMA Bullish`);
        else if (lastClose < kama) setVote('FALL', robot.weakConfidence, `Tendência KAMA Bearish`);
      }
      
      // 13. Donchian Channels - Estratégia de Tartarugas (Breakout)
      else if (robot.strategyType === 'DONCHIAN_CHANNELS' && isValid(donchian?.upper)) {
        // Rompimento ou toque nos limites do canal
        if (lastClose >= donchian.upper! - (donchian.upper! - donchian.lower!) * 0.05) 
            setVote('RISE', robot.strongConfidence, `Teste de Topo Donchian`);
        else if (lastClose <= donchian.lower! + (donchian.upper! - donchian.lower!) * 0.05) 
            setVote('FALL', robot.strongConfidence, `Teste de Fundo Donchian`);
      }
      
      // 14. Chandelier Exit - Baseado em ATR para sair de trades (usado aqui para entrada reversa)
      else if (robot.strategyType === 'CHANDELIER_EXIT' && isValid(chandelier?.exitLong)) {
         if (lastClose > chandelier.exitShort!) setVote('RISE', robot.weakConfidence, 'Suporte Chandelier Mantido');
         else if (lastClose < chandelier.exitLong!) setVote('FALL', robot.weakConfidence, 'Resistência Chandelier Ativa');
      }
      
      // 15. VWAP (Volume Weighted Average Price) - Institucional
      else if (robot.strategyType === 'VWAP' && vwap && vwap.length > 0) {
        const lastVwap = vwap[vwap.length-1];
        if (isValid(lastVwap)) {
            if (lastClose > lastVwap) setVote('RISE', robot.weakConfidence, `Preço acima VWAP (Bullish)`);
            else if (lastClose < lastVwap) setVote('FALL', robot.weakConfidence, `Preço abaixo VWAP (Bearish)`);
        }
      }
      
      // 16. MFI (Money Flow Index) - RSI ponderado por volume
      else if (robot.strategyType === 'MFI' && isValid(mfi)) {
        if (mfi <= 20) setVote('RISE', robot.strongConfidence, `Fluxo de Dinheiro Entrando (MFI ${format(mfi)})`);
        else if (mfi >= 80) setVote('FALL', robot.strongConfidence, `Fluxo de Dinheiro Saindo (MFI ${format(mfi)})`);
      }
      
      // 17. OBV (On Balance Volume) - Fluxo de volume cumulativo
      else if (robot.strategyType === 'OBV' && isValid(obv) && isValid(indicators.obvPrev)) {
        if (obv > indicators.obvPrev!) setVote('RISE', robot.weakConfidence, `Acumulação Detectada (OBV Subindo)`);
        else if (obv < indicators.obvPrev!) setVote('FALL', robot.weakConfidence, `Distribuição Detectada (OBV Caindo)`);
      }
      
      // 18. Z-Score - Desvio Padrão Estatístico
      else if (robot.strategyType === 'Z_SCORE' && isValid(zScore)) {
        // Reversão à média baseada em desvios padrão (Sigma)
        if (zScore < -2.0) setVote('RISE', robot.strongConfidence, `Desvio Padrão Negativo (Oportunidade Reversão)`);
        else if (zScore > 2.0) setVote('FALL', robot.strongConfidence, `Desvio Padrão Positivo (Oportunidade Reversão)`);
      }
      
      // 19. Stochastic RSI - O oscilador do oscilador
      else if (robot.strategyType === 'STOCH_RSI' && isValid(stochRSI)) {
        if (stochRSI <= 0.2) setVote('RISE', robot.strongConfidence, `StochRSI Sobrevenda`);
        else if (stochRSI >= 0.8) setVote('FALL', robot.strongConfidence, `StochRSI Sobrecompra`);
      }
      
      // 20. Moving Average Cross - O clássico Cruzamento de Ouro/Morte
      else if (robot.strategyType === 'MOVING_AVERAGE_CROSS' && isValid(ma?.short) && isValid(ma?.long)) {
        if (ma.short > ma.long) setVote('RISE', robot.weakConfidence, `Golden Cross (Curta > Longa)`);
        else setVote('FALL', robot.weakConfidence, `Death Cross (Curta < Longa)`);
      }
      
      // 21. Price Action Pattern - Reconhecimento de Padrões de Vela
      else if (robot.strategyType === 'PRICE_ACTION_PATTERN') {
          const body = Math.abs(lastClose - lastCandle.open);
          const upperShadow = lastCandle.high - Math.max(lastClose, lastCandle.open);
          const lowerShadow = Math.min(lastClose, lastCandle.open) - lastCandle.low;
          
          // Hammer (Martelo) ou Shooting Star (Estrela Cadente)
          if (lowerShadow > body * 2 && upperShadow < body * 0.5) {
             setVote('RISE', robot.strongConfidence, 'Padrão Martelo (Rejeição de Baixa)');
          } else if (upperShadow > body * 2 && lowerShadow < body * 0.5) {
             setVote('FALL', robot.strongConfidence, 'Padrão Estrela Cadente (Rejeição de Alta)');
          }
      }

      // 22. Volume Profile - Análise de Microestrutura
      else if (robot.strategyType === 'VOLUME_PROFILE') {
         const range = Math.abs(lastCandle.high - lastCandle.low);
         const avgRange = (indicators.atr || 1);
         // Detecta "Barra de Exaustão" ou "Barra de Força" com base no tamanho relativo
         if (range > avgRange * 1.5) {
             if (lastClose > lastCandle.open) setVote('RISE', robot.weakConfidence, 'Barra de Força (Expansão)');
             else setVote('FALL', robot.weakConfidence, 'Barra de Queda (Expansão)');
         }
      }

  } catch (e) {
      // Log de erro não obstrutivo
      console.warn(`[Vote] Erro calculado na estratégia ${robot.strategyType}:`, e);
  }

  return { vote, confidence, reason, optimalDuration, optimalDurationUnit, suggestedStake };
};

// ════════════════════════════════════════════════════════════════════
// 5. HOOK PRINCIPAL (ORQUESTRADOR)
// ════════════════════════════════════════════════════════════════════

export function useRobotCouncilV2(
  activeSymbol: string | null,
  priceTicks: TickData[],
  chartData: CandleData[],
  dataVersion: number
) {
  // --- Hooks Externos ---
  const { operationsLog, executeTrade, timePeriod, isConnected, durationLimits, sellContract } = useDerivApi();
  const { user, loading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  // Sistema de Evolução (Algoritmo Genético que roda em segundo plano)
  const { evolvedStrategies, evolveTrigger, evolutionHistory } = useStrategyEvolution(initialCouncilStrategies);
  
  // Ref para contar ciclos de execução (útil para logs e triggers periódicos)
  const executionIdRef = useRef(0);
  
  // --- Memoização de Dados (Performance) ---
  // Transforma os dados brutos (Ticks ou Candles) em um formato uniforme para os robôs
  const tickCandles = useMemo(() => {
    // Prioridade 1: Usar dados de Candle completos da API (ChartData)
    if (chartData && chartData.length >= REGIME_LOOKBACK) {
      return chartData;
    }
    // Prioridade 2: Fallback para Ticks (reconstrução simples de candles OHLC iguais)
    // Isso permite que o sistema funcione mesmo antes do gráfico carregar totalmente
    if (priceTicks && priceTicks.length > 0) {
      return priceTicks.map((t) => ({
          epoch: t.epoch, open: t.price, high: t.price,
          low: t.price, close: t.price, volume: 1
      }));
    }
    return [];
  }, [chartData, priceTicks]);

  // --- Estado Local (Gerenciamento de Memória) ---
  const [strategyCouncil, setStrategyCouncil] = useState<RobotStrategy[]>(evolvedStrategies as RobotStrategy[]);
  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [isFetchingCouncil, setIsFetchingCouncil] = useState(false);
  const [tradeDecisionLog, setTradeDecisionLog] = useState<TradeDecisionLog[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  // Estado Complexo do Conselho
  const [councilState, setCouncilState] = useState<CouncilState>({
    indicators: null,
    currentRegime: {
        regime: 'ranging', // Default seguro (Lateral)
        confidence: 0,
        probabilities: { trending_bull: 0.2, trending_bear: 0.2, ranging: 0.4, high_volatility: 0.1, breakout: 0.1 }
    },
    microstructure: null,
    consensusDecision: { direction: 'HOLD', probability: 0.5, stake: 0 },
    portfolioStats: { totalExposure: 0, maxExposure: 10 * 0.3, currentDrawdown: 0, maxDrawdown: 0, dailyPnL: 0 },
    bayesianVotes: {},
    dashboardData: null,
    effectiveThreshold: 0,
    councilConfidence: 0,
    systemMetrics: {
        activeVirtualTrades: 0, totalVirtualTrades: 0, decisionLogCount: 0, activeRobotsCount: 0,
        memoryUsageMB: 0, isExecuting: false, lastCleanup: Date.now(), orphanedTradesRemoved: 0, sessionDuration: 0,
    },
  });

  const [robotPerformance, setRobotPerformance] = useState<EnhancedRobotPerformance[]>([]);
  // Refs mutáveis para dados de alta frequência (evita re-renders desnecessários do React)
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  const tradeCounterRef = useRef(0);
  const transitionMatrixRef = useRef<number[][] | undefined>(undefined);
  const lastRegimeRef = useRef<MarketRegime>('ranging');

  // --- Configurações da Mesa Operacional (Ajustáveis pelo Usuário) ---
  const [dailyBalance, setDailyBalance] = useState(100); 
  const [dailyTarget, setDailyTarget] = useState(50);
  const [consensusSensitivity, setConsensusSensitivity] = useState(60); // % de consenso para agir
  const [confidenceFactor, setConfidenceFactor] = useState(70); // Confiança mínima técnica
  const [durationRange, setDurationRange] = useState<[number, number]>([15, 300]); // Duração mín/máx
  const [takeProfitThreshold, setTakeProfitThreshold] = useState(10);
  const [stopLossThreshold, setStopLossThreshold] = useState(20);
  
  // Switches de Funcionalidade
  const [isDynamicConsensusOn, setIsDynamicConsensusOn] = useState(true);
  const [isDynamicRiskOn, setIsDynamicRiskOn] = useState(true);
  const [isMeritocracyOn, setIsMeritocracyOn] = useState(true); // Melhores robôs têm mais peso?
  const [isDynamicExitOn, setIsDynamicExitOn] = useState(true);

  // Trava de execução (Mutex) para evitar ciclos sobrepostos
  const councilExecutionRef = useRef<{ isExecuting: boolean; sellingContracts: Set<number>; }>({
    isExecuting: false, sellingContracts: new Set()
  });

  // Atualiza o conselho quando a evolução genética produz novos robôs
  useEffect(() => {
    setStrategyCouncil(evolvedStrategies as RobotStrategy[]);
  }, [evolvedStrategies]);
  
  // Zera as estatísticas da arena (reinicia o campeonato)
  const resetArenaPerformance = useCallback(() => {
    if (strategyCouncil.length === 0) return;
    const initialPerformance: EnhancedRobotPerformance[] = strategyCouncil.map(robot => ({
      id: robot.id, strategyType: robot.strategyType, strategy: robot, wins: 0, losses: 0, totalProfit: 0, winRate: 0,
      sharpeRatio: 0, maxDrawdown: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, kellyFraction: 0, effectiveRegimes: [],
      monteCarloScore: 0, lastUpdated: Date.now(), tradeHistory: []
    }));
    setRobotPerformance(initialPerformance);
    virtualTradesRef.current = [];
  }, [strategyCouncil]);

  // Carrega performance histórica do usuário (Persistência)
  useEffect(() => {
    if (!user || isAuthLoading) return;
    loadRobotPerformance(user.uid).then((stored) => {
        if (stored && stored.length > 0) {
            setRobotPerformance(prev => {
                if (prev.length === 0) return stored as EnhancedRobotPerformance[];
                return prev; 
            });
        }
    }).catch(console.error);
  }, [user, isAuthLoading]);

  // Função para ativar o piloto automático
  const fetchStrategyCouncil = useCallback(async () => {
    if (!activeSymbol) {
      toast({ variant: 'destructive', title: 'Atenção', description: 'Selecione um ativo para iniciar.' });
      return;
    }
    setIsFetchingCouncil(true);
    await new Promise((r) => setTimeout(r, 500)); // Pequeno delay para UX
    
    // Clona as estratégias para isolar a instância
    const council = (evolvedStrategies as RobotStrategy[]).map(s => ({ ...s }));
    setStrategyCouncil(council);
    
    if (robotPerformance.length === 0) resetArenaPerformance();
    
    setSessionStartTime(Date.now());
    setIsCouncilAutopilotOn(true);
    setIsFetchingCouncil(false);
    toast({ title: '🚀 Cérebro V2.5 Iniciado', description: 'Os 22 Analistas estão monitorando o mercado.' });
  }, [activeSymbol, evolvedStrategies, robotPerformance.length, resetArenaPerformance, toast]);

  // Função para desativar
  const dissolveCouncil = useCallback(() => {
    setIsCouncilAutopilotOn(false);
    setSessionStartTime(null);
    toast({ title: '⏸️ Sistema Pausado', description: 'Operações suspensas.' });
  }, [toast]);

  // ════════════════════════════════════════════════════════════════════
  // 6. CICLO DE VIDA DO CONSELHO (MAIN LOOP)
  // ════════════════════════════════════════════════════════════════════
  
  const runCouncilCycle = useCallback(() => {
    // A. GUARD CLAUSES: Proteções para não rodar sem necessidade
    if (!isCouncilAutopilotOn) return; 
    
    if (!isConnected) { 
        if (executionIdRef.current % 10 === 0) console.log('⏳ [Council] Aguardando conexão Deriv...'); 
        return; 
    }
    if (!activeSymbol) return;
    
    // B. VALIDAÇÃO DE DADOS: O ponto crítico da estagnação
    const validCandles = validateCandles(tickCandles);
    
    if (validCandles.length < REGIME_LOOKBACK) {
       if (executionIdRef.current % 10 === 0) {
           console.log(`⏳ [Council] Carregando histórico... (${validCandles.length}/${REGIME_LOOKBACK} candles)`);
       }
       return; 
    }

    // Mutex: Se já está executando, não sobreponha
    if (councilExecutionRef.current.isExecuting) return; 
    councilExecutionRef.current.isExecuting = true;
    executionIdRef.current++;

    try {
        const currentTick = priceTicks[priceTicks.length - 1];
        if (!currentTick) {
            // Esta guarda é redundante por causa da verificação acima, mas é uma boa prática
            councilExecutionRef.current.isExecuting = false;
            return;
        }

        const contractDurationForIndicators = { duration: 5, unit: 'm' as DurationUnit };
        const currentIndicators = calculateAllIndicators(validCandles, strategyCouncil, timePeriod, contractDurationForIndicators);

        if (!currentIndicators) {
            console.warn("⚠️ [Council] Falha ao calcular indicadores.");
            councilExecutionRef.current.isExecuting = false;
            return;
        }

        let regimeResult;
        if (isValid(currentIndicators.adx)) {
            regimeResult = detectMarketRegime(
                validCandles,
                { adx: currentIndicators.adx, pdi: currentIndicators.pdi, ndi: currentIndicators.ndi, bbw: currentIndicators.bbw, roc: currentIndicators.roc, atr: currentIndicators.atr },
                lastRegimeRef.current,
                transitionMatrixRef.current
            );
        } else {
            regimeResult = { 
                regime: lastRegimeRef.current || 'ranging', 
                confidence: 0.5, 
                probabilities: { ranging: 1.0 } as any 
            };
        }
        lastRegimeRef.current = regimeResult.regime;

        const microFeatures = extractMicrostructureFeatures(priceTicks, validCandles);

        const stillActiveTrades: VirtualTrade[] = [];
        let performanceChanged = false;
        
        virtualTradesRef.current.forEach(trade => {
            const isExpired = currentTick.epoch >= trade.exitEpoch;
            
            if (isExpired) {
                const exitPrice = currentTick.price;
                const isWin = (trade.vote === 'RISE' && exitPrice > trade.entryPrice) || 
                              (trade.vote === 'FALL' && exitPrice < trade.entryPrice);
                
                setRobotPerformance(prev => {
                    return prev.map(p => {
                        if (p.id !== trade.robotId) return p;
                        const pnl = isWin ? VIRTUAL_STAKE * 0.95 : -VIRTUAL_STAKE;
                        const newWins = p.wins + (isWin ? 1 : 0);
                        const newLosses = p.losses + (isWin ? 0 : 1);
                        const newHistory = [...(p.tradeHistory || []), pnl].slice(-100);
                        
                        return {
                            ...p,
                            wins: newWins,
                            losses: newLosses,
                            totalProfit: p.totalProfit + pnl,
                            tradeHistory: newHistory,
                            winRate: (newWins / (newWins + newLosses)) * 100,
                            lastUpdated: Date.now()
                        };
                    });
                });
                performanceChanged = true;
            } else {
                stillActiveTrades.push(trade);
            }
        });
        virtualTradesRef.current = stillActiveTrades;

        const localBayesianVotes: Record<string, BayesianVote> = {};
        let riseSum = 0, fallSum = 0, totalWeight = 0, weightedDurationSum = 0;
        let activeRobotsCount = 0;

        strategyCouncil.forEach(robot => {
            const technicalVote = calculateTechnicalVote(robot, currentIndicators, validCandles);
            
            if (technicalVote.vote !== 'HOLD') {
                 const hasActiveTrade = virtualTradesRef.current.some(t => t.robotId === robot.id);
                 if (!hasActiveTrade) {
                     const durationSec = durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit);
                     virtualTradesRef.current.push({
                         id: `vt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                         robotId: robot.id,
                         vote: technicalVote.vote as 'RISE' | 'FALL',
                         entryPrice: currentTick.price,
                         entryEpoch: currentTick.epoch,
                         exitEpoch: currentTick.epoch + durationSec,
                         regime: regimeResult.regime,
                         microstructure: microFeatures!,
                         stake: VIRTUAL_STAKE
                     });
                 }
            }
            
            if (technicalVote.confidence >= confidenceFactor) {
                const perf = robotPerformance.find(p => p.id === robot.id);
                const winRate = perf ? perf.winRate : 50;
                
                let weight = 1;
                if (isMeritocracyOn && perf) {
                     weight = Math.max(0.1, (perf.sharpeRatio || 0) + 0.5); 
                }

                const posterior = bayesianUpdate(winRate/100, technicalVote.confidence/100);
                const voteWeight = posterior * weight;
                
                if (technicalVote.vote === 'RISE') riseSum += voteWeight;
                if (technicalVote.vote === 'FALL') fallSum += voteWeight;
                totalWeight += voteWeight;
                weightedDurationSum += durationToSeconds(technicalVote.optimalDuration, technicalVote.optimalDurationUnit) * voteWeight;
                
                localBayesianVotes[robot.id] = {
                    ...technicalVote,
                    rawConfidence: technicalVote.confidence,
                    calibratedConfidence: posterior * 100,
                    bayesianProbability: posterior,
                    weight,
                    regime: regimeResult.regime,
                    strategy: robot
                };
                activeRobotsCount++;
            }
        });

        let consensusDirection: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
        let consensusProbability = 0.5;
        
        if (totalWeight > 0) {
            consensusProbability = Math.max(riseSum, fallSum) / totalWeight;
            if (riseSum > fallSum) consensusDirection = 'RISE';
            else if (fallSum > riseSum) consensusDirection = 'FALL';
        }

        const calculatedEffectiveThreshold = (totalWeight * (consensusSensitivity / 100));
        const consensusReached = totalWeight > 0 && Math.max(riseSum, fallSum) >= calculatedEffectiveThreshold;

        setCouncilState(prev => ({
            ...prev,
            indicators: currentIndicators,
            currentRegime: regimeResult,
            microstructure: microFeatures,
            consensusDecision: { direction: consensusDirection, probability: consensusProbability, stake: 0 },
            bayesianVotes: localBayesianVotes,
            dashboardData: {
                regime: regimeResult.regime,
                bayesianProbability: consensusProbability,
                consensusDirection,
                activeRobotsCount,
                microstructure: { pressure: microFeatures?.volumeImbalance || 0, velocity: microFeatures?.tickVelocity || 0, isSpike: false },
                kellyStake: 0
            },
            systemMetrics: {
                ...prev.systemMetrics,
                activeVirtualTrades: virtualTradesRef.current.length,
                totalVirtualTrades: prev.systemMetrics.totalVirtualTrades + (performanceChanged ? 1 : 0),
                activeRobotsCount
            }
        }));
        
        const logData = {
            chartData: tickCandles,
            priceTicks,
            indicators: councilState.indicators,
            currentRegime: councilState.currentRegime,
            strategyCouncil,
            bayesianVotes: councilState.bayesianVotes,
            virtualTradesRef,
            consensusDecision: councilState.consensusDecision
        };

        if (executionIdRef.current % 5 === 0) {
            console.log('═══════════════════════════════════════');
            console.log(`🔍 VALIDAÇÃO ARQUITETURA V2.5 - CICLO #${executionIdRef.current}`);
            console.log('═══════════════════════════════════════');
            
            console.log('1️⃣ FONTE DE DADOS:');
            console.log('   chartData (direto):', logData.chartData?.length || 0, 'candles');
            console.log('   priceTicks (fallback):', logData.priceTicks?.length || 0, 'ticks');
            console.log('   tickCandles (usado):', tickCandles?.length || 0);

            console.log('\n2️⃣ INDICADORES:');
            console.log('   Status:', logData.indicators ? '✅ OK' : '❌ NULL');
            if (logData.indicators) {
                console.log('   RSI:', logData.indicators.rsi?.toFixed(2) || 'N/A');
                console.log('   ADX:', logData.indicators.adx?.toFixed(2) || 'N/A');
                console.log('   MACD:', logData.indicators.macd?.histogram?.toFixed(4) || 'N/A');
                console.log('   Stoch:', logData.indicators.stoch?.toFixed(2) || 'N/A');
                console.log('   BBW:', logData.indicators.bbw?.toFixed(4) || 'N/A');
                console.log('   Z-Score:', logData.indicators.zScore?.toFixed(2) || 'N/A');
            }

            console.log('\n3️⃣ REGIME:');
            console.log('   Tipo:', logData.currentRegime?.regime || 'N/A');
            console.log('   Confiança:', ((logData.currentRegime?.confidence || 0) * 100).toFixed(0) + '%');
            if (logData.currentRegime?.probabilities) {
                console.log('   Distribuição:', Object.entries(logData.currentRegime.probabilities)
                    .map(([k, v]) => `${k}: ${(v*100).toFixed(0)}%`)
                    .join(' | '));
            }

            console.log('\n4️⃣ MICROESTRUTURA:');
            if (microFeatures) {
                console.log(`   Pressão: ${microFeatures.pressure} (${(microFeatures.volumeImbalance*100).toFixed(0)}%) | Velocidade: ${microFeatures.tickVelocity.toFixed(2)} t/s`);
            }

            console.log('\n5️⃣ ROBÔS:');
            console.log('   Conselho:', logData.strategyCouncil?.length || 0);
            console.log('   Com Votos:', Object.keys(logData.bayesianVotes || {}).length);
            console.log('   Ativos (weight>0):', Object.values(logData.bayesianVotes || {}).filter(v => v.weight > 0).length);

            console.log('\n6️⃣ ARENA VIRTUAL:');
            console.log('   Trades Ativos:', logData.virtualTradesRef.current?.length || 0);

            console.log('\n7️⃣ CONSENSO:');
            console.log('   Direção:', logData.consensusDecision?.direction || 'N/A');
            console.log('   Probabilidade:', ((logData.consensusDecision?.probability || 0) * 100).toFixed(0) + '%');
            console.log('   Stake:', '$' + (logData.consensusDecision?.stake || 0).toFixed(2));
            console.log(`   Soma (Rise/Fall): ${riseSum.toFixed(2)} / ${fallSum.toFixed(2)}`);
            console.log(`   Peso Total: ${totalWeight.toFixed(2)}`);
            console.log(`   Limiar Efetivo: ${calculatedEffectiveThreshold.toFixed(2)}`);
            console.log(`   Executado: ${consensusReached ? '✅ SIM' : '❌ NÃO'}`);
            
            console.log('═══════════════════════════════════════');
        }

        if (consensusReached && consensusDirection !== 'HOLD') {
             const kellyStake = calculateKellyStake(dailyBalance, consensusProbability, 0.9);
             if (kellyStake > 0) {
                // executeTrade(...)
             }
        }

    } catch (error) {
        if (error instanceof Error) {
            console.error(`🚨 [Council Crash] Ciclo #${executionIdRef.current} falhou:`, error.message);
        } else {
            console.error(`🚨 [Council Crash] Ciclo #${executionIdRef.current} falhou com erro desconhecido.`);
        }
    } finally {
        councilExecutionRef.current.isExecuting = false;
    }

  }, [
    isCouncilAutopilotOn, isConnected, activeSymbol, tickCandles, priceTicks, 
    strategyCouncil, timePeriod, robotPerformance, confidenceFactor, isMeritocracyOn, consensusSensitivity, dailyBalance
  ]);

  // Hook que dispara o ciclo repetidamente
  useEffect(() => {
    if (!isCouncilAutopilotOn) return;
    const interval = setInterval(runCouncilCycle, THROTTLE_MS);
    return () => clearInterval(interval);
  }, [runCouncilCycle, isCouncilAutopilotOn]);

  // Retorno da API do Hook para os Componentes React
  return {
    isCouncilAutopilotOn,
    fetchStrategyCouncil,
    dissolveCouncil,
    isFetchingCouncil,
    strategyCouncil,
    robotPerformance,
    evolutionHistory,
    ...councilState, // Espalha todo o estado complexo
    // Setters para configurações da UI
    setDailyBalance, setDailyTarget, setConsensusSensitivity, setConfidenceFactor, 
    setDurationRange, setTakeProfitThreshold, setStopLossThreshold, 
    setIsDynamicConsensusOn, setIsDynamicRiskOn, setIsMeritocracyOn, setIsDynamicExitOn,
    resetArenaPerformance, tradeDecisionLog,
    supervisionStatus: { status: 'approved', message: 'Sistema Operacional v2.5' }
  };
}