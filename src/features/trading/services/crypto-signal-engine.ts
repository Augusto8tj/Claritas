
// /src/features/trading/services/crypto-signal-engine.ts

/**
 * @fileOverview CRYPTO SIGNAL ENGINE V5.0 (SUPREME)
 * Otimização de regras matemáticas do Sentinel com foco em Assimetria de Risco 
 * e proteção contra exaustão institucional.
 */

import { evaluateSignals, type SignalFeatures, type SignalCandidate } from './signal-engine';
import { BitcoinGravityResult } from './crypto-gravity-engine';

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
    // SL = 1.5x ATR, TP = 2.8x ATR -> Payoff ~1:1.8
    const atrValue = (f.atrPct / 100) * f.price;
    const stopLossDist = atrValue * 1.5;
    const takeProfitDist = atrValue * 2.8;

    const stopLoss = c.direction === 'CALL' ? f.price - stopLossDist : f.price + stopLossDist;
    const takeProfit = c.direction === 'CALL' ? f.price + takeProfitDist : f.price - takeProfitDist;
    const payoffRatio = takeProfitDist / stopLossDist;

    return {
      ...c,
      setupScore: Math.round(setupScore),
      score: Math.round(setupScore), // Mantém compatibilidade com interface base
      reasons,
      stopLoss,
      takeProfit,
      payoffRatio,
      isExhausted,
      direction: setupScore > 75 ? c.direction : 'NONE' // Gatilho de Precisão > 75
    } as EnhancedSignalCandidate;
  });
}
