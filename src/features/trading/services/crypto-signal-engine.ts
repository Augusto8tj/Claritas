
// /src/features/trading/services/crypto-signal-engine.ts

/**
 * @fileOverview CRYPTO SIGNAL ENGINE V5.0 (SUPREME)
 * Otimização de regras matemáticas do Sentinel com foco em Assimetria de Risco 
 * e proteção contra exaustão institucional.
 * V5: Adicionado Seletor Polimórfico de Contratos.
 */

import { evaluateSignals, type SignalFeatures, type SignalCandidate } from './signal-engine';
import { BitcoinGravityResult } from './crypto-gravity-engine';

export type RecommendedContractMode = 'MULTIPLIER' | 'RISE_FALL_15M' | 'OPTIONS' | 'ACCUMULATORS';

export interface CryptoSignalFeatures extends SignalFeatures {
  gravity: BitcoinGravityResult | null;
  vwapDist: number; // Desvios padrão em relação ao VWAP
}

export interface EnhancedSignalCandidate extends SignalCandidate {
  setupScore: number;
  stopLoss: number;
  takeProfit: number;
  payoffRatio: number;
  isExhausted: boolean;
  recommendedContractMode: RecommendedContractMode;
}

/**
 * Seleciona o melhor tipo de contrato baseado na microestrutura e gravidade.
 * ADITIVO: Não altera regras de pontuação existentes.
 */
export function polymorphicContractSelector(
  symbol: string,
  f: CryptoSignalFeatures,
  entropy: number
): RecommendedContractMode {
  const { gravity } = f;

  // 1. Prioridade MULTIPLIER: Impulso Gravitacional ou SlingShot (Explosão do BTC)
  if (gravity?.isBtcExploding || gravity?.slingshotDetected) {
    return 'MULTIPLIER';
  }

  // 2. Prioridade RISE_FALL_15M: Drift estável ou Exaustão com Baixa Entropia
  // Requisito: Tendência limpa (ER > 0.6) e consenso unânime (Entropia < 0.3)
  if (f.er > 0.6 && entropy < 0.3 && Math.abs(f.rsi - 50) > 10) {
    return 'RISE_FALL_15M';
  }

  // 3. Fallback: Options padrão para momentum de curto prazo
  return 'OPTIONS';
}

export function evaluateCryptoSignals(symbol: string, f: CryptoSignalFeatures): EnhancedSignalCandidate[] {
  const baseSignals = evaluateSignals(symbol, f);
  const { gravity } = f;

  return baseSignals.map(c => {
    let setupScore = 0;
    const reasons: string[] = [...c.reasons];
    
    // 1. FILTRO DE EXAUSTÃO (PROTEÇÃO INSTITUCIONAL)
    const isOverbought = f.rsi > 78 || f.vwapDist > 2.2;
    const isOversold = f.rsi < 22 || f.vwapDist < -2.2;
    const isExhausted = (c.direction === 'CALL' && isOverbought) || (c.direction === 'PUT' && isOversold);

    // 2. CÁLCULO DE SCORE DE SETUP (PESOS: Gravity 40%, Momentum 35%, Vol 25%)
    if (gravity) {
      const gravityWeight = gravity.gravityScore * 0.4;
      const momentumWeight = c.score * 0.35;
      const volatilityWeight = (f.er * 100) * 0.25; // Eficiência de Kaufman
      setupScore = gravityWeight + momentumWeight + volatilityWeight;
      
      if (gravity.vetoReason) {
        setupScore = 0;
        reasons.push(`VETO: ${gravity.vetoReason}`);
      }
      
      if (gravity.slingshotDetected) {
        setupScore = Math.min(100, setupScore + 15);
        reasons.push('GRAVITY_SLINGSHOT (+15%)');
      }
    }

    if (isExhausted) {
      setupScore = 0;
      reasons.push('VETO: EXAUSTÃO (Anti-FOMO)');
    }

    // 3. CÁLCULO ASSIMÉTRICO DE ALVOS (ATR BASED)
    const atrValue = (f.atrPct / 100) * f.price;
    const stopLossDist = atrValue * 1.5;
    const takeProfitDist = atrValue * 2.8;

    const stopLoss = c.direction === 'CALL' ? f.price - stopLossDist : f.price + stopLossDist;
    const takeProfit = c.direction === 'CALL' ? f.price + takeProfitDist : f.price - takeProfitDist;
    const payoffRatio = takeProfitDist / stopLossDist;

    // 4. SELEÇÃO POLIMÓRFICA (Entropia simulada em 0.2 para cálculo do Sentinel)
    const recommendedContractMode = polymorphicContractSelector(symbol, f, 0.2);

    return {
      ...c,
      setupScore: Math.round(setupScore),
      score: Math.round(setupScore), // Mantém compatibilidade com interface base
      reasons,
      stopLoss,
      takeProfit,
      payoffRatio,
      isExhausted,
      recommendedContractMode,
      direction: setupScore > 75 ? c.direction : 'NONE' // Gatilho de Precisão > 75
    } as EnhancedSignalCandidate;
  });
}
