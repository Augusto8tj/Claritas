import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { TradeMemoryBuffer, TradePostMortem } from '../types/council';

/**
 * Gerencia a memória tática do laboratório V3, segmentada por ativo.
 */
export class TradeMemoryManager {
  private static MAX_BUFFER_SIZE = 20;

  /**
   * Obtém o buffer de memória para um símbolo específico.
   */
  public static async getBuffer(userId: string, symbol: string = 'default'): Promise<TradeMemoryBuffer> {
    const docRef = doc(db, 'users', userId, 'quant_memory_v3', symbol);
    const snap = await getDoc(docRef);
    
    if (snap.exists()) {
      return snap.data() as TradeMemoryBuffer;
    }

    // Compatibilidade Retroativa: Tenta migrar do buffer global se for o símbolo padrão
    if (symbol === 'default') {
      const globalRef = doc(db, 'users', userId, 'quant_memory_v3', 'buffer');
      const globalSnap = await getDoc(globalRef);
      if (globalSnap.exists()) return globalSnap.data() as TradeMemoryBuffer;
    }

    return { wins: [], losses: [] };
  }

  /**
   * Adiciona um trade ao buffer de um ativo específico.
   */
  public static async addTrade(userId: string, symbol: string, trade: TradePostMortem): Promise<void> {
    const buffer = await this.getBuffer(userId, symbol);
    const isWin = trade.result === 'WIN';
    const targetArray = isWin ? [...buffer.wins] : [...buffer.losses];

    if (targetArray.some(t => t.id === trade.id)) return;

    targetArray.push(trade);

    if (targetArray.length > this.MAX_BUFFER_SIZE) {
      targetArray.shift();
    }

    const newBuffer = {
      wins: isWin ? targetArray : buffer.wins,
      losses: isWin ? buffer.losses : targetArray,
    };

    const docRef = doc(db, 'users', userId, 'quant_memory_v3', symbol);
    await setDoc(docRef, newBuffer);
  }

  /**
   * Limpa a memória de um ativo.
   */
  public static async clearBuffer(userId: string, symbol: string = 'default'): Promise<void> {
    const docRef = doc(db, 'users', userId, 'quant_memory_v3', symbol);
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
