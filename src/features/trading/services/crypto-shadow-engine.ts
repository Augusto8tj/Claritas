// /src/features/trading/services/crypto-shadow-engine.ts
'use client';

import { db } from '@/lib/firebase';
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDocs, query, where } from 'firebase/firestore';
import { sanitizeForFirestore } from '@/services/utils/sanitize-for-firestore';
import { CryptoShadowTrade, TradePostMortem } from '../types/council';
import { TradeMemoryManager } from './trade-memory-service';

/**
 * Shadow Engine V4.2
 * Gerencia a execução teórica (Shadow Trading) e liquidação de contratos para fins estatísticos.
 */
export const CryptoShadowEngine = {

  /**
   * Registra uma decisão como um trade sombra pendente.
   */
  logTrade: async (userId: string, trade: Omit<CryptoShadowTrade, 'status' | 'timestamp'>) => {
    const tradeData = sanitizeForFirestore({
      ...trade,
      status: 'pending',
      timestamp: new Date().toISOString()
    });
    
    try {
      return await addDoc(collection(db, 'users', userId, 'crypto_shadow_trades'), tradeData);
    } catch (e) {
      console.error("[ShadowEngine] Falha ao logar trade:", e);
      return null;
    }
  },

  /**
   * Liquidar trade no vencimento.
   */
  liquidate: async (userId: string, tradeId: string, exitPrice: number, win: boolean, pnl: number) => {
    const docRef = doc(db, 'users', userId, 'crypto_shadow_trades', tradeId);
    
    try {
      await updateDoc(docRef, {
        exitPrice,
        result: win ? 'won' : 'lost',
        pnl,
        status: 'completed',
        closedAt: serverTimestamp()
      });
    } catch (e) {
      console.error("[ShadowEngine] Falha ao liquidar trade:", e);
    }
  },

  /**
   * Busca trades pendentes e liquida os vencidos.
   */
  settlePending: async (
    userId: string, 
    getPrice: (symbol: string) => number | null,
    onResult: (symbol: string, win: boolean, pnl: number, trade: CryptoShadowTrade) => void
  ) => {
    if (!userId) return;
    
    const tradesRef = collection(db, 'users', userId, 'crypto_shadow_trades');
    const q = query(tradesRef, where('status', '==', 'pending'));
    
    try {
      const snap = await getDocs(q);
      const now = Date.now();

      for (const docSnap of snap.docs) {
        const trade = { id: docSnap.id, ...docSnap.data() } as CryptoShadowTrade;
        const entryTime = new Date(trade.timestamp).getTime();
        const durationSec = trade.duration || 15;
        
        // Verifica se o tempo do contrato expirou
        if (now >= entryTime + (durationSec * 1000)) {
          const exitPrice = getPrice(trade.symbol);
          if (exitPrice !== null && exitPrice > 0) {
            const isCall = trade.direction === 'CALL' || trade.direction === 'RISE';
            const win = isCall ? exitPrice > trade.entryPrice : exitPrice < trade.entryPrice;
            const stake = 1.0; // Shadow trades são normalizados para $1
            const pnl = win ? (stake * (trade.payoutRatio / 100)) : -stake;
            
            // 1. Atualizar registro no Firestore
            await CryptoShadowEngine.liquidate(userId, docSnap.id, exitPrice, win, pnl);
            
            // 2. Notificar sistema de resiliência e memória
            onResult(trade.symbol, win, pnl, trade);
          }
        }
      }
    } catch (e) {
      console.error("[ShadowEngine] Erro em settlePending:", e);
    }
  }
};
