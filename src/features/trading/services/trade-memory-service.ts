import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { TradeMemoryBuffer, TradePostMortem } from '../types/council';

export class TradeMemoryManager {
  private static MAX_BUFFER_SIZE = 20;

  /**
   * Obtém o buffer de memória isolado para a V3.
   */
  public static async getBuffer(userId: string): Promise<TradeMemoryBuffer> {
    const docRef = doc(db, 'users', userId, 'quant_memory_v3', 'buffer');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as TradeMemoryBuffer;
    }
    return { wins: [], losses: [] };
  }

  /**
   * Adiciona um trade ao buffer deslizante (FIFO).
   */
  public static async addTrade(userId: string, trade: TradePostMortem): Promise<void> {
    const buffer = await this.getBuffer(userId);
    const isWin = trade.result === 'WIN';
    const targetArray = isWin ? [...buffer.wins] : [...buffer.losses];

    // Evita duplicatas se o ID já existir
    if (targetArray.some(t => t.id === trade.id)) return;

    targetArray.push(trade);

    if (targetArray.length > this.MAX_BUFFER_SIZE) {
      targetArray.shift();
    }

    const newBuffer = {
      wins: isWin ? targetArray : buffer.wins,
      losses: isWin ? buffer.losses : targetArray,
    };

    const docRef = doc(db, 'users', userId, 'quant_memory_v3', 'buffer');
    await setDoc(docRef, newBuffer);
  }

  /**
   * Apaga a memória de curto prazo do laboratório.
   */
  public static async clearBuffer(userId: string): Promise<void> {
    const docRef = doc(db, 'users', userId, 'quant_memory_v3', 'buffer');
    await deleteDoc(docRef);
  }

  public static formatBufferForPrompt(buffer: TradeMemoryBuffer): string {
    const recentLosses = buffer.losses.slice(-5).map(l => 
      `- [LOSS] ${l.contract} | Vol: ${l.volatilityYangZhang.toFixed(2)} | Causa: ${l.failureDiagnosis || 'Anomalia detectada'}`
    ).join('\n');

    const recentWins = buffer.wins.slice(-5).map(w => 
      `- [WIN] ${w.contract} | RSI: ${w.rsi.toFixed(1)} | Padrão: ${w.candlePattern}`
    ).join('\n');

    return `
### HISTÓRICO DE APRENDIZADO RECENTE (CONTEXTO)
PADRÕES DE ERRO A EVITAR (Últimos Losses):
${recentLosses || 'Nenhum erro registrado ainda.'}

PADRÕES DE SUCESSO A REPETIR (Últimos Wins):
${recentWins || 'Nenhuma vitória registrada ainda.'}
`;
  }
}
