// src/features/trading/services/council-strategies.ts
import type { RobotStrategy } from '@/lib/types';

// This file contains the pre-defined, local configuration for the 22 robot analysts.
// Each robot now has its own optimal duration in SECONDS.
// The execution logic will convert this to the best possible API unit ('t', 's', 'm').

export const initialCouncilStrategies: Omit<RobotStrategy, 'id'>[] = [
  // --- Momentum & Trend (Short-Term Specialists) ---
  {
    strategyType: "RSI",
    justification: "Usa RSI curto (10) para scalp em {{timePeriod}}.",
    strongConfidence: 90,
    weakConfidence: 60,
    period: 10,
    strongBuyThreshold: 25,
    weakBuyThreshold: 35,
    strongSellThreshold: 75,
    weakSellThreshold: 65,
    optimalDuration: 45, // 45 segundos
    optimalDurationUnit: 's',
    suggestedStake: 1.5,
  },
  {
    strategyType: "STOCHASTIC",
    justification: "Identifica sobrecompra/ sobrevenda em {{timePeriod}}.",
    strongConfidence: 90,
    weakConfidence: 70,
    period: 14,
    strongBuyThreshold: 20,
    weakBuyThreshold: 30,
    strongSellThreshold: 80,
    weakSellThreshold: 70,
    optimalDuration: 45, // 45 segundos
    optimalDurationUnit: 's',
    suggestedStake: 1.5,
  },
  {
    strategyType: "MACD_CROSS",
    justification: "Confirma momentum de tendência em {{timePeriod}}.",
    strongConfidence: 80,
    weakConfidence: 50,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    optimalDuration: 120, // 2 minutos
    optimalDurationUnit: 's',
    suggestedStake: 1.0,
  },
  {
    strategyType: "ADX_TREND",
    justification: "Mede a força da tendência, ignorando mercados laterais em {{timePeriod}}.",
    strongConfidence: 85,
    weakConfidence: 60,
    period: 14,
    trendStrengthThreshold: 25,
    optimalDuration: 120, // 2 minutos
    optimalDurationUnit: 's',
    suggestedStake: 1.2,
  },
  {
    strategyType: "AWESOME_OSCILLATOR",
    justification: "Mede o momentum do mercado em {{timePeriod}}.",
    strongConfidence: 75,
    weakConfidence: 50,
    optimalDuration: 60, // 1 minuto
    optimalDurationUnit: 's',
    suggestedStake: 0.8,
  },
  {
    strategyType: "TRIX",
    justification: "Média móvel triplamente suavizada para filtrar ruído em {{timePeriod}}.",
    strongConfidence: 70,
    weakConfidence: 45,
    period: 15,
    optimalDuration: 120, // 2 minutos
    optimalDurationUnit: 's',
    suggestedStake: 0.7,
  },
  {
    strategyType: "ROC",
    justification: "Mede a taxa de variação do preço em {{timePeriod}}.",
    strongConfidence: 70,
    weakConfidence: 45,
    period: 12,
    optimalDuration: 45, // 45 segundos
    optimalDurationUnit: 's',
    suggestedStake: 0.9,
  },
  {
    strategyType: "RVI",
    justification: "Índice de Vigor Relativo para medir a convicção do movimento em {{timePeriod}}.",
    strongConfidence: 80,
    weakConfidence: 55,
    period: 10,
    strongBuyThreshold: 40,
    weakBuyThreshold: 50,
    strongSellThreshold: 60,
    weakSellThreshold: 50,
    optimalDuration: 60, // 1 minuto
    optimalDurationUnit: 's',
    suggestedStake: 1.0,
  },
  {
    strategyType: "PARABOLIC_SAR",
    justification: "Segue a tendência do preço e indica reversões em {{timePeriod}}.",
    strongConfidence: 85,
    weakConfidence: 60,
    acceleration: 0.02,
    maxAcceleration: 0.2,
    optimalDuration: 90, // 90 segundos
    optimalDurationUnit: 's',
    suggestedStake: 1.3,
  },
  // --- Volatility & Structure ---
  {
    strategyType: "BOLLINGER_BANDS",
    justification: "Opera em reversões à média ou rompimentos de volatilidade em {{timePeriod}}.",
    strongConfidence: 85,
    weakConfidence: 65,
    period: 20,
    stdDev: 2.0,
    optimalDuration: 60, // 1 minuto
    optimalDurationUnit: 's',
    suggestedStake: 1.4,
  },
  {
    strategyType: "ICHIMOKU_CLOUD",
    justification: "Análise completa de tendência, suporte e resistência em {{timePeriod}}.",
    strongConfidence: 88,
    weakConfidence: 60,
    optimalDuration: 120, // 2 minutos
    optimalDurationUnit: 's',
    suggestedStake: 1.5,
  },
  {
    strategyType: "KAMA",
    justification: "Média móvel adaptativa que se ajusta à volatilidade em {{timePeriod}}.",
    strongConfidence: 80,
    weakConfidence: 55,
    period: 10,
    fastEnd: 2,
    slowEnd: 30,
    optimalDuration: 120, // 2 minutos
    optimalDurationUnit: 's',
    suggestedStake: 1.1,
  },
  {
    strategyType: "DONCHIAN_CHANNELS",
    justification: "Identifica rompimentos de máximas e mínimas em {{timePeriod}}.",
    strongConfidence: 80,
    weakConfidence: 55,
    period: 20,
    optimalDuration: 60, // 1 minuto
    optimalDurationUnit: 's',
    suggestedStake: 1.0,
  },
  {
    strategyType: "CHANDELIER_EXIT",
    justification: "Usa o próprio Chandelier como sinal de entrada, além de stop.",
    strongConfidence: 85,
    weakConfidence: 60,
    chandelierPeriod: 22,
    chandelierMultiplier: 3,
    optimalDuration: 120, // 2 minutos
    optimalDurationUnit: 's',
    suggestedStake: 1.2,
  },
  // --- Volume & Order Flow ---
  {
    strategyType: "VOLUME_PROFILE",
    justification: "Identifica zonas de alta liquidez (POC) como suporte/resistência em {{timePeriod}}.",
    strongConfidence: 75,
    weakConfidence: 50,
    profileBars: 100,
    optimalDuration: 120, // 2 minutos
    optimalDurationUnit: 's',
    suggestedStake: 0.9,
  },
  {
    strategyType: "VWAP",
    justification: "Usa o preço médio ponderado por volume como referência de valor em {{timePeriod}}.",
    strongConfidence: 85,
    weakConfidence: 60,
    optimalDuration: 60, // 1 minuto
    optimalDurationUnit: 's',
    suggestedStake: 1.3,
  },
  {
    strategyType: "MFI",
    justification: "RSI ponderado pelo volume para medir o fluxo de dinheiro em {{timePeriod}}.",
    strongConfidence: 80,
    weakConfidence: 60,
    period: 14,
    strongBuyThreshold: 20,
    weakBuyThreshold: 30,
    strongSellThreshold: 80,
    weakSellThreshold: 70,
    optimalDuration: 45, // 45 segundos
    optimalDurationUnit: 's',
    suggestedStake: 1.2,
  },
  {
    strategyType: "OBV",
    justification: "Segue o fluxo de volume acumulado para confirmar tendências em {{timePeriod}}.",
    strongConfidence: 75,
    weakConfidence: 50,
    optimalDuration: 120, // 2 minutos
    optimalDurationUnit: 's',
    suggestedStake: 0.8,
  },
  // --- Statistical & Mean Reversion ---
  {
    strategyType: "Z_SCORE",
    justification: "Identifica desvios estatísticos extremos do preço em {{timePeriod}}.",
    strongConfidence: 80,
    weakConfidence: 55,
    period: 20,
    zScoreThreshold: 2.0,
    optimalDuration: 30, // 30 segundos
    optimalDurationUnit: 's',
    suggestedStake: 1.1,
  },
  {
    strategyType: "STOCH_RSI",
    justification: "Combina Estocástico e RSI para sinais de sobrecompra/venda mais sensíveis em {{timePeriod}}.",
    strongConfidence: 90,
    weakConfidence: 70,
    period: 14,
    strongBuyThreshold: 0.20,
    weakBuyThreshold: 0.30,
    strongSellThreshold: 0.80,
    weakSellThreshold: 0.70,
    optimalDuration: 30, // 30 segundos
    optimalDurationUnit: 's',
    suggestedStake: 1.4,
  },
  // --- Patterns ---
  {
    strategyType: "PRICE_ACTION_PATTERN",
    justification: "Busca por padrões de vela de reversão como 'hammer' em {{timePeriod}}.",
    strongConfidence: 95,
    weakConfidence: 75,
    pattern: "hammer",
    optimalDuration: 15, // 15 segundos
    optimalDurationUnit: 's',
    suggestedStake: 1.8,
  },
  // --- Moving Average ---
  {
    strategyType: "MOVING_AVERAGE_CROSS",
    justification: "Cruzamento clássico de médias para identificar mudanças de tendência em {{timePeriod}}.",
    strongConfidence: 78,
    weakConfidence: 52,
    shortPeriod: 10,
    longPeriod: 20,
    optimalDuration: 60, // 1 minute
    optimalDurationUnit: 's',
    suggestedStake: 1.0,
  }
].map((strat) => ({
    // Adicionando valores padrão para campos opcionais para garantir que o objeto seja completo
    period: strat.period || 14,
    strongBuyThreshold: strat.strongBuyThreshold,
    weakBuyThreshold: strat.weakBuyThreshold,
    strongSellThreshold: strat.strongSellThreshold,
    weakSellThreshold: strat.weakSellThreshold,
    shortPeriod: strat.shortPeriod,
    longPeriod: strat.longPeriod,
    fastPeriod: strat.fastPeriod,
    slowPeriod: strat.slowPeriod,
    signalPeriod: strat.signalPeriod,
    stdDev: strat.stdDev,
    pattern: strat.pattern,
    trendStrengthThreshold: strat.trendStrengthThreshold,
    profileBars: strat.profileBars,
    zScoreThreshold: strat.zScoreThreshold,
    fastEnd: strat.fastEnd,
    slowEnd: strat.slowEnd,
    acceleration: strat.acceleration,
    maxAcceleration: strat.maxAcceleration,
    chandelierPeriod: strat.chandelierPeriod,
    chandelierMultiplier: strat.chandelierMultiplier,
    ...strat,
}));
