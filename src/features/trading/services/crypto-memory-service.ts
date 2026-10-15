
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { TradeMemoryBuffer, TradePostMortem } from '../types/council';

/**
 * SERVIÇO DE MEMÓRIA CRYPTO V5.0
 * Implementa Assinatura de Estado e Pattern Cooldown anti-repetição de erro.
 */

const COOLDOWN_MINUTES = 15;

export class CryptoMemoryManager {
  private static MAX_BUFFER_SIZE = 20;

  public static async getBuffer(userId: string, symbol: string): Promise<TradeMemoryBuffer> {
    const docRef = doc(db, 'users', userId, 'quant_memory_v4', symbol);
    const snap = await getDoc(docRef);
    return snap.exists() ? (snap.data() as TradeMemoryBuffer) : { wins: [], losses: [] };
  }

  /**
   * Verifica se o padrão atual (Ativo + Regime) está em cooldown por falhas recentes.
   */
  public static checkPatternCooldown(buffer: TradeMemoryBuffer, currentRegime: string) {
    const recentLosses = buffer.losses.slice(-2);
    if (recentLosses.length < 2) return { active: false };

    const allFailuresInRegime = recentLosses.every(l => (l as any).btcRegime === currentRegime);
    const lastFailureTime = recentLosses[recentLosses.length - 1].timestamp;
    const minutesSince = (Date.now() - lastFailureTime) / 60000;

    if (allFailuresInRegime && minutesSince < COOLDOWN_MINUTES) {
        return { 
            active: true, 
            reason: `BLOQUEIO_PADRÃO: ${recentLosses.length} falhas em '${currentRegime}' há ${minutesSince.toFixed(0)} min.` 
        };
    }

    if (allFailuresInRegime) {
        return { warning: `CUIDADO: Histórico de falhas frequentes em regime '${currentRegime}'.` };
    }

    return { active: false };
  }

  public static async addTrade(userId: string, symbol: string, trade: any): Promise<void> {
    const buffer = await this.getBuffer(userId, symbol);
    const isWin = trade.result === 'WIN';
    const targetArray = isWin ? [...buffer.wins] : [...buffer.losses];

    targetArray.push(trade);
    if (targetArray.length > this.MAX_BUFFER_SIZE) targetArray.shift();

    const newBuffer = {
      wins: isWin ? targetArray : buffer.wins,
      losses: isWin ? buffer.losses : targetArray,
    };

    await setDoc(doc(db, 'users', userId, 'quant_memory_v4', symbol), newBuffer);
  }

  public static formatBufferForPrompt(buffer: TradeMemoryBuffer): string {
    const recentLosses = buffer.losses.slice(-3).map(l => 
      `- [LOSS] Regime: ${(l as any).btcRegime} | Corr: ${(l as any).gravityCorrelation?.toFixed(2)} | Entropia: ${(l as any).councilEntropy?.toFixed(2)}`
    ).join('\n');

    return `
### MEMÓRIA ANTI-ERRO (POST-MORTEM V5)
ÚLTIMAS FALHAS REGISTRADAS (NÃO REPITA ESTES SETUPS):
${recentLosses || 'Nenhum erro fatal registrado.'}
`;
  }
}
