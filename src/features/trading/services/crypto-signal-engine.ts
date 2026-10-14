
// /src/features/trading/services/crypto-signal-engine.ts
/**
 * @fileOverview Crypto Signal Engine V4.2
 * Especialização das regras estatísticas para o ecossistema Cripto.
 */
import { evaluateSignals, type SignalFeatures, type SignalCandidate } from './signal-engine';
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
    // Boost de +15% em COMPRESSION real Capitalizando em 83% de winrate histórico
    if (c.rule === 'ACCU_CALM' && gravity?.btcVector === 'COMPRESSION') {
      updated.score = Math.min(100, updated.score + 15);
      updated.reasons.push('BTC Compression Boost (+15%)');
    }

    // 2. Restrição MULT_TREND (Multiplicadores)
    // Só emite sinal se estiver alinhado com o vetor de impulso do Bitcoin
    if (c.rule === 'MULT_TREND' && gravity) {
      if (!gravity.btcImpulseDir || c.direction !== (gravity.btcImpulseDir === 'UP' ? 'CALL' : 'PUT')) {
        updated.score = 0; // Invalida se não estiver alinhado com o líder
        updated.reasons.push('VETO: Desalinhado com BTC Impulse');
      } else {
        updated.score = Math.min(100, updated.score + 5);
        updated.reasons.push('BTC Impulse Confirmation');
      }
    }

    // 3. Sinais de Lead-Lag
    if (gravity?.btcVector === 'ALT_LAGGING_UP' && c.direction === 'CALL') {
        updated.score = Math.min(100, updated.score + 20);
        updated.reasons.push(`Lead-Lag Capture (Exp: ${gravity.expectedCatchUp.toFixed(4)})`);
    }

    return updated;
  });
}
