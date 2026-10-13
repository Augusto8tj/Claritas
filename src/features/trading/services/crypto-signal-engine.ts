/**
 * @fileOverview Crypto Signal Engine V4
 * Especialização das regras estatísticas para o ecossistema Cripto.
 */
import { computeSignalFeatures, evaluateSignals, type SignalFeatures, type SignalCandidate } from './signal-engine';
import { BitcoinGravity } from './crypto-gravity-engine';

export interface CryptoSignalFeatures extends SignalFeatures {
  gravity: BitcoinGravity | null;
}

export function evaluateCryptoSignals(symbol: string, f: CryptoSignalFeatures): SignalCandidate[] {
  const baseSignals = evaluateSignals(symbol, f);
  const { gravity } = f;

  return baseSignals.map(c => {
    const updated = { ...c, reasons: [...c.reasons] };

    // 1. Otimização ACCU_CALM (Acumuladores)
    if (c.rule === 'ACCU_CALM' && gravity?.btcVector === 'COMPRESSION') {
      updated.score = Math.min(100, updated.score + 15);
      updated.reasons.push('BTC Compression Boost (+15%)');
    }

    // 2. Restrição MULT_TREND (Multiplicadores)
    if (c.rule === 'MULT_TREND' && gravity) {
      const btcDir = gravity.momentum.m5 > 0 ? 'CALL' : 'PUT';
      if (c.direction !== btcDir) {
        updated.score = 0; // Invalida se não estiver alinhado com o líder
        updated.reasons.push('VETO: Desalinhado com BTC Momentum');
      } else {
        updated.score = Math.min(100, updated.score + 5);
        updated.reasons.push('BTC Trend Confirmation');
      }
    }

    // 3. Ajuste de Divergência Gravitacional
    if (gravity?.btcVector === 'DIVERGENT') {
      updated.score *= 0.5;
      updated.reasons.push('AVISO: Divergência Gravitacional');
    }

    return updated;
  });
}
