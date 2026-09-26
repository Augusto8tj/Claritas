
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { TradeMemoryBuffer, TradePostMortem } from '../types/council';

export class TradeMemoryManager {
  private static MAX_BUFFER_SIZE = 20;

  public static async getBuffer(userId: string): Promise<TradeMemoryBuffer> {
    const docRef = doc(db, 'users', userId, 'quant_memory', 'buffer');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as TradeMemoryBuffer;
    }
    return { wins: [], losses: [] };
  }

  public static async addTrade(userId: string, trade: TradePostMortem): Promise<void> {
    const buffer = await this.getBuffer(userId);
    const isWin = trade.result === 'WIN';
    const targetArray = isWin ? [...buffer.wins] : [...buffer.losses];

    targetArray.push(trade);

    if (targetArray.length > this.MAX_BUFFER_SIZE) {
      targetArray.shift();
    }

    const newBuffer = {
      wins: isWin ? targetArray : buffer.wins,
      losses: isWin ? buffer.losses : targetArray,
    };

    const docRef = doc(db, 'users', userId, 'quant_memory', 'buffer');
    await setDoc(docRef, newBuffer);
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
