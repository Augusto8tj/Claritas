// src/features/trading/services/council-strategies.ts
import type { RobotStrategy } from '@/lib/types';

export type TradingMode = 'standard' | 'high_frequency';

// This file contains the pre-defined, local configuration for the 22 robot analysts.
// Each robot now has a stable, unique 'id' to ensure consistent performance tracking.

const baseStrategies: Omit<RobotStrategy, 'id'>[] = [
  // --- Momentum & Trend (Short-Term Specialists) ---
  {
    strategyType: "RSI",
    justification: "Usa RSI para scalp em {{timePeriod}}.",
    strongConfidence: 90,
    weakConfidence: 60,
    period: 14,
    strongBuyThreshold: 25,
    weakBuyThreshold: 35,
    strongSellThreshold: 75,
    weakSellThreshold: 65,
    optimalDuration: 5,
    optimalDurationUnit: 't',
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
    optimalDuration: 5,
    optimalDurationUnit: 't',
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
    optimalDuration: 2,
    optimalDurationUnit: 'm',
    suggestedStake: 1.0,
  },
  {
    strategyType: "ADX_TREND",
    justification: "Mede a força da tendência, ignorando mercados laterais em {{timePeriod}}.",
    strongConfidence: 85,
    weakConfidence: 60,
    period: 14,
    trendStrengthThreshold: 25,
    optimalDuration: 3,
    optimalDurationUnit: 'm',
    suggestedStake: 1.2,
  },
  {
    strategyType: "AWESOME_OSCILLATOR",
    justification: "Mede o momentum do mercado em {{timePeriod}}.",
    strongConfidence: 75,
    weakConfidence: 50,
    optimalDuration: 1,
    optimalDurationUnit: 'm',
    suggestedStake: 0.8,
  },
  {
    strategyType: "TRIX",
    justification: "Média móvel triplamente suavizada para filtrar ruído em {{timePeriod}}.",
    strongConfidence: 70,
    weakConfidence: 45,
    period: 15,
    optimalDuration: 2,
    optimalDurationUnit: 'm',
    suggestedStake: 0.7,
  },
  {
    strategyType: "ROC",
    justification: "Mede a taxa de variação do preço em {{timePeriod}}.",
    strongConfidence: 70,
    weakConfidence: 45,
    period: 12,
    optimalDuration: 45,
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
    optimalDuration: 1,
    optimalDurationUnit: 'm',
    suggestedStake: 1.0,
  },
  {
    strategyType: "PARABOLIC_SAR",
    justification: "Segue a tendência do preço e indica reversões em {{timePeriod}}.",
    strongConfidence: 85,
    weakConfidence: 60,
    acceleration: 0.02,
    maxAcceleration: 0.2,
    optimalDuration: 10,
    optimalDurationUnit: 't',
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
    optimalDuration: 7,
    optimalDurationUnit: 't',
    suggestedStake: 1.4,
  },
  {
    strategyType: "ICHIMOKU_CLOUD",
    justification: "Análise completa de tendência, suporte e resistência em {{timePeriod}}.",
    strongConfidence: 88,
    weakConfidence: 60,
    optimalDuration: 5,
    optimalDurationUnit: 'm',
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
    optimalDuration: 3,
    optimalDurationUnit: 'm',
    suggestedStake: 1.1,
  },
  {
    strategyType: "DONCHIAN_CHANNELS",
    justification: "Identifica rompimentos de máximas e mínimas em {{timePeriod}}.",
    strongConfidence: 80,
    weakConfidence: 55,
    period: 20,
    optimalDuration: 1,
    optimalDurationUnit: 'm',
    suggestedStake: 1.0,
  },
  {
    strategyType: "CHANDELIER_EXIT",
    justification: "Usa o próprio Chandelier como sinal de entrada, além de stop.",
    strongConfidence: 85,
    weakConfidence: 60,
    chandelierPeriod: 22,
    chandelierMultiplier: 3,
    optimalDuration: 2,
    optimalDurationUnit: 'm',
    suggestedStake: 1.2,
  },
  // --- Volume & Order Flow ---
  {
    strategyType: "VOLUME_PROFILE",
    justification: "Identifica zonas de alta liquidez (POC) como suporte/resistência em {{timePeriod}}.",
    strongConfidence: 75,
    weakConfidence: 50,
    profileBars: 100,
    optimalDuration: 5,
    optimalDurationUnit: 'm',
    suggestedStake: 0.9,
  },
  {
    strategyType: "VWAP",
    justification: "Usa o preço médio ponderado por volume como referência de valor em {{timePeriod}}.",
    strongConfidence: 85,
    weakConfidence: 60,
    optimalDuration: 1,
    optimalDurationUnit: 'm',
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
    optimalDuration: 5,
    optimalDurationUnit: 't',
    suggestedStake: 1.2,
  },
  {
    strategyType: "OBV",
    justification: "Segue o fluxo de volume acumulado para confirmar tendências em {{timePeriod}}.",
    strongConfidence: 75,
    weakConfidence: 50,
    optimalDuration: 2,
    optimalDurationUnit: 'm',
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
    optimalDuration: 7,
    optimalDurationUnit: 't',
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
    optimalDuration: 5,
    optimalDurationUnit: 't',
    suggestedStake: 1.4,
  },
  // --- Patterns ---
  {
    strategyType: "PRICE_ACTION_PATTERN",
    justification: "Busca por padrões de vela de reversão como 'hammer' em {{timePeriod}}.",
    strongConfidence: 95,
    weakConfidence: 75,
    pattern: "hammer",
    optimalDuration: 5,
    optimalDurationUnit: 't',
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
    optimalDuration: 1,
    optimalDurationUnit: 'm',
    suggestedStake: 1.0,
  }
];

export const getCouncilStrategies = (mode: TradingMode = 'standard'): Omit<RobotStrategy, 'id'>[] => {
    const strategiesWithDefaults = baseStrategies.map(strat => {
        const fullStrat = {
            period: undefined,
            strongBuyThreshold: undefined,
            weakBuyThreshold: undefined,
            strongSellThreshold: undefined,
            weakSellThreshold: undefined,
            shortPeriod: undefined,
            longPeriod: undefined,
            fastPeriod: undefined,
            slowPeriod: undefined,
            signalPeriod: undefined,
            stdDev: undefined,
            pattern: undefined,
            trendStrengthThreshold: undefined,
            profileBars: undefined,
            zScoreThreshold: undefined,
            fastEnd: undefined,
            slowEnd: undefined,
            acceleration: undefined,
            maxAcceleration: undefined,
            chandelierPeriod: undefined,
            chandelierMultiplier: undefined,
            ...strat,
        };
        return fullStrat;
    });

  if (mode === 'standard') {
    return strategiesWithDefaults.map(strat => ({
      ...strat,
      justification: strat.justification.replace('{{timePeriod}}', 'Padrão'),
    }));
  }

  // High Frequency Mode: Adjust parameters
  return strategiesWithDefaults.map(strat => {
    const newStrat = { ...strat };
    
    const hfMultiplier = 0.5; // Reduz os períodos pela metade

    if (newStrat.period) newStrat.period = Math.max(5, Math.floor(newStrat.period * hfMultiplier));
    if (newStrat.shortPeriod) newStrat.shortPeriod = Math.max(3, Math.floor(newStrat.shortPeriod * hfMultiplier));
    if (newStrat.longPeriod) newStrat.longPeriod = Math.max(7, Math.floor(newStrat.longPeriod * hfMultiplier));
    if (newStrat.fastPeriod) newStrat.fastPeriod = Math.max(5, Math.floor(newStrat.fastPeriod * hfMultiplier));
    if (newStrat.slowPeriod) newStrat.slowPeriod = Math.max(10, Math.floor(newStrat.slowPeriod * hfMultiplier));
    if (newStrat.signalPeriod) newStrat.signalPeriod = Math.max(4, Math.floor(newStrat.signalPeriod * hfMultiplier));
    if (newStrat.chandelierPeriod) newStrat.chandelierPeriod = Math.max(10, Math.floor(newStrat.chandelierPeriod * hfMultiplier));
    
    newStrat.optimalDuration = Math.floor(Math.random() * 6) + 5; // Random integer from 5 to 10
    newStrat.optimalDurationUnit = 't';
    
    newStrat.justification = newStrat.justification.replace('{{timePeriod}}', 'Alta Frequência');
    
    return newStrat;
  });
};

// For compatibility, export the standard version as initialCouncilStrategies
export const initialCouncilStrategies = getCouncilStrategies('standard').map((strat, index) => ({
    ...strat,
    id: (strat as any).id || `${strat.strategyType}_${index}`
}));
