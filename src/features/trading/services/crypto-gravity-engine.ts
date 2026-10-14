// /src/features/trading/services/crypto-gravity-engine.ts

/**
 * @fileOverview CRYPTO GRAVITY ENGINE V4.2
 * Motor matemático isolado para detecção de correlação líder (BTC) e 
 * governança de execução para ativos cryBTCUSD e cryETHUSD na Deriv.
 */

// ============================================================================
// 1. TYPES AND INTERFACES
// ============================================================================

export interface CryptoAssetFeatures {
  symbol: string;
  currentPrice: number;
  rsi: number;
  atrNow: number;
  volatilityRatio: number; // Mediana da volatilidade histórica
  momentum15m: number;     // Retorno normalizado em ATRs
}

export interface BitcoinGravityResult {
  btcVector: 'BULL_DRAG' | 'BEAR_DRAG' | 'COMPRESSION' | 'DIVERGENT';
  isBtcExploding: boolean;
  gravityScore: number; // 0 a 100
}

export interface CryptoV4Decision {
  finalAction: 'MULTUP' | 'MULTDOWN' | 'HOLD';
  recommendedContract: 'MULTIPLIERS';
  confidence: number;
  adjustedStake: number;
  reason: string;
}

// ============================================================================
// 2. CORE FUNCTIONS
// ============================================================================

/**
 * Calcula a "gravidade" do Bitcoin sobre um ativo alvo (Altcoin).
 * @param btc Features atuais do Bitcoin (cryBTCUSD)
 * @param target Features atuais do ativo alvo (ex: cryETHUSD)
 */
export function calculateBitcoinGravity(
  btc: CryptoAssetFeatures,
  target: CryptoAssetFeatures
): BitcoinGravityResult {
  let btcVector: BitcoinGravityResult['btcVector'] = 'DIVERGENT';
  let isBtcExploding = false;
  let gravityScore = 50;

  // A. LÓGICA DE EXPLOSÃO (Volume/Volatilidade)
  // Se o ATR atual for 50% superior à média, temos um estouro de volatilidade
  const volatilitySpike = btc.atrNow > (btc.volatilityRatio * 1.5);
  
  if (volatilitySpike) {
    isBtcExploding = true;
    gravityScore = 85;
    // Define o vetor baseado na direção do momentum
    btcVector = btc.momentum15m > 0 ? 'BULL_DRAG' : 'BEAR_DRAG';
  } 

  // B. FILTRO DE SOBREVIVÊNCIA (Queda Livre)
  // Se o momentum for fortemente negativo, forçamos o vetor de arraste ursino
  if (btc.momentum15m < -2.5) {
    btcVector = 'BEAR_DRAG';
    gravityScore = 95;
  } 
  // Se for fortemente positivo
  else if (btc.momentum15m > 2.5) {
    btcVector = 'BULL_DRAG';
    gravityScore = 95;
  }

  // C. LÓGICA DE COMPRESSÃO (Lateralidade)
  // Bitcoin calmo (ATR baixo) e sem tendência clara (Momentum perto de 0)
  if (!isBtcExploding && Math.abs(btc.momentum15m) < 0.5 && btc.atrNow <= btc.volatilityRatio) {
    btcVector = 'COMPRESSION';
    gravityScore = 40;
  }

  return {
    btcVector,
    isBtcExploding,
    gravityScore
  };
}

/**
 * Avalia se a operação em uma Altcoin é permitida pelo Gate de Segurança V4.2.
 * @param target Features do ativo alvo
 * @param gravity Resultado do motor de gravidade do Bitcoin
 * @param intendedAction Ação proposta pelo sinal ('RISE' | 'FALL' | 'HOLD')
 * @param baseStake Valor base da aposta
 * @param currentOpenPositions Número de trades ativos no cluster
 * @param maxConcurrent Limite de concorrência do portfólio
 */
export function evaluateCryptoV4Gate(
  target: CryptoAssetFeatures,
  gravity: BitcoinGravityResult,
  intendedAction: 'RISE' | 'FALL' | 'HOLD',
  baseStake: number,
  currentOpenPositions: number,
  maxConcurrent: number
): CryptoV4Decision {
  
  // 1. RESTRIÇÃO DE CONTRATO NATIVA
  // Deriv cripto cry* = MULTIPLIERS. Acumuladores proibidos.
  const recommendedContract: 'MULTIPLIERS' = 'MULTIPLIERS';

  // 2. TRAVA DE STAKE (Piso institucional de $1.00 USD)
  const adjustedStake = Math.max(baseStake, 1.0);

  // 3. LIMITE DE PORTFÓLIO
  if (currentOpenPositions >= maxConcurrent) {
    return {
      finalAction: 'HOLD',
      recommendedContract,
      confidence: 0,
      adjustedStake,
      reason: `Limite de portfólio atingido (${currentOpenPositions}/${maxConcurrent}).`
    };
  }

  // 4. VETO AUTOMÁTICO (RISK CRITIC)
  // Divergência Gravitacional: Não operar contra um Bitcoin explodindo
  if (gravity.isBtcExploding) {
    const isContradictory = 
      (gravity.btcVector === 'BULL_DRAG' && intendedAction === 'FALL') ||
      (gravity.btcVector === 'BEAR_DRAG' && intendedAction === 'RISE');

    if (isContradictory) {
      return {
        finalAction: 'HOLD',
        recommendedContract,
        confidence: 0,
        adjustedStake,
        reason: `Divergência Gravitacional: Bitcoin em modo ${gravity.btcVector}. Não pegue a faca caindo em ${target.symbol}.`
      };
    }
  }

  // 5. DECISÃO FINAL
  const finalAction: CryptoV4Decision['finalAction'] = 
    intendedAction === 'RISE' ? 'MULTUP' : 
    intendedAction === 'FALL' ? 'MULTDOWN' : 'HOLD';

  return {
    finalAction,
    recommendedContract,
    confidence: gravity.gravityScore,
    adjustedStake,
    reason: `Sinal validado pelo Crypto V4 Gate. Vetor BTC: ${gravity.btcVector}.`
  };
}
