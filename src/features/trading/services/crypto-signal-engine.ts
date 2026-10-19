
// /src/features/trading/services/crypto-signal-engine.ts

/**
 * @fileOverview CRYPTO SIGNAL ENGINE V5.3 (SUPREME)
 * Otimização de regras matemáticas do Sentinel com foco em Assimetria de Risco 
 * e proteção contra exaustão institucional.
 * V5.3: Seletor Polimórfico de Contratos.
 * V11: Soberania LEADLAG_SLINGSHOT e Veto de Contradição.
 */

import { evaluateSignals, type SignalFeatures, type SignalCandidate } from './signal-engine';
import { BitcoinGravityResult } from './crypto-gravity-engine';

export type RecommendedContractMode = 'MULTIPLIER' | 'RISE_FALL_15M' | 'OPTIONS' | 'ACCUMULATORS';

// Limiar institucional exportado para o conselho
export const SENTINEL_MIN_SCORE = 75;

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
  if (f.er > 0.6 && entropy < 0.3 && Math.abs(f.rsi - 50) > 10) {
    return 'RISE_FALL_15M';
  }

  // 3. Fallback: Options padrão
  return 'OPTIONS';
}

export function evaluateCryptoSignals(symbol: string, f: CryptoSignalFeatures): EnhancedSignalCandidate[] {
  const baseSignals = evaluateSignals(symbol, f);
  const { gravity } = f;
  
  const results: EnhancedSignalCandidate[] = [];

  // --- 1. CANDIDATO SOBERANO: LEADLAG_SLINGSHOT (Etapa 11) ---
  if (gravity?.slingshotDetected && !gravity.vetoReason) {
    const direction = (gravity.zBtc ?? 0) > 0 ? 'CALL' : 'PUT';
    
    // Score baseado no arraste (gravity) e na força do diferencial de velocidade
    const zBtcAbs = Math.abs(gravity.zBtc ?? 0);
    const zTargetAbs = Math.abs(gravity.zTarget ?? 0);
    const velocityDiff = Math.max(0, zBtcAbs - zTargetAbs);
    
    const slingScore = Math.round(
      (gravity.gravityScore * 0.4) + 
      (Math.min(100, zBtcAbs * 25) * 0.4) + 
      (Math.min(100, velocityDiff * 50) * 0.2)
    );

    results.push({
      symbol,
      contract: 'MULTIPLIERS',
      direction,
      score: slingScore,
      setupScore: slingScore,
      rule: 'LEADLAG_SLINGSHOT',
      reasons: [
        `BTC_DRAG: ${gravity.btcVector}`,
        `zBtc: ${gravity.zBtc?.toFixed(2)}`,
        `Corr: ${gravity.correlation.toFixed(2)}`
      ],
      stopLoss: 0, takeProfit: 0, payoffRatio: 0, isExhausted: false,
      recommendedContractMode: 'MULTIPLIER'
    } as EnhancedSignalCandidate);
  }

  const isSlingshotActive = results.some(r => r.rule === 'LEADLAG_SLINGSHOT');

  // --- 2. REGRAS TÉCNICAS BASE ---
  baseSignals.forEach(c => {
    let setupScore = 0;
    const reasons: string[] = [...c.reasons];
    
    // FILTRO DE EXAUSTÃO
    const isOverbought = f.rsi > 78 || f.vwapDist > 2.2;
    const isOversold = f.rsi < 22 || f.vwapDist < -2.2;
    const isExhausted = (c.direction === 'CALL' && isOverbought) || (c.direction === 'PUT' && isOversold);

    // CÁLCULO DE SCORE
    if (gravity) {
      const gravityWeight = gravity.gravityScore * 0.4;
      const momentumWeight = c.score * 0.35;
      const volatilityWeight = (f.er * 100) * 0.25; 
      setupScore = gravityWeight + momentumWeight + volatilityWeight;
      
      if (gravity.vetoReason) {
        setupScore = 0;
        reasons.push(`VETO: ${gravity.vetoReason}`);
      }
    } else {
      reasons.push('VETO: NO_GRAVITY');
      setupScore = 0;
    }

    if (isExhausted) {
      setupScore = 0;
      reasons.push('VETO: EXAUSTÃO (Anti-FOMO)');
    }

    // TRAVA DE CONTRADIÇÃO (Etapa 11)
    if (isSlingshotActive && gravity) {
      const btcDirection = (gravity.zBtc ?? 0) > 0 ? 'CALL' : 'PUT';
      if (c.direction !== btcDirection && c.direction !== 'NONE') {
        setupScore = 0;
        reasons.push(`VETO: CONTRADIÇÃO LÍDER (BTC=${btcDirection})`);
      }
    }

    const atrValue = (f.atrPct / 100) * f.price;
    const stopLossDist = atrValue * 1.5;
    const takeProfitDist = atrValue * 2.8;

    results.push({
      ...c,
      setupScore: Math.round(setupScore),
      score: Math.round(setupScore), 
      reasons,
      stopLoss: c.direction === 'CALL' ? f.price - stopLossDist : f.price + stopLossDist,
      takeProfit: c.direction === 'CALL' ? f.price + takeProfitDist : f.price - takeProfitDist,
      payoffRatio: takeProfitDist / stopLossDist,
      isExhausted,
      recommendedContractMode: polymorphicContractSelector(symbol, f, 0.2),
      direction: setupScore >= SENTINEL_MIN_SCORE ? c.direction : 'NONE' 
    } as EnhancedSignalCandidate);
  });

  return results;
}
