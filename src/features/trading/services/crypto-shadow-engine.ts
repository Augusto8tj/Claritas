// /src/features/trading/services/crypto-shadow-engine.ts
'use client';

import { db } from '@/lib/firebase';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { sanitizeForFirestore } from '@/services/utils/sanitize-for-firestore';
import { CryptoShadowTrade } from '../types/council';

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
  }
};
