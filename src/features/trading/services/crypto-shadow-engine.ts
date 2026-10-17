// /src/features/trading/services/crypto-shadow-engine.ts
'use client';

import { db } from '@/lib/firebase';
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDocs, query, where } from 'firebase/firestore';
import { sanitizeForFirestore } from '@/services/utils/sanitize-for-firestore';
import { CryptoShadowTrade } from '../types/council';

/**
 * Shadow Engine V4.2 - Protocolo Institucional 8A
 * Gerencia a execução teórica (Shadow Trading) e liquidação de contratos com cache em memória.
 */

let pendingCache: CryptoShadowTrade[] = [];
let lastCacheFetch = 0;
const CACHE_TTL = 10000; // 10s

export const CryptoShadowEngine = {

  getPendingFromCache: () => pendingCache,

  /**
   * Registra uma decisão como um trade sombra pendente e atualiza o cache local.
   */
  logTrade: async (userId: string, trade: Omit<CryptoShadowTrade, 'status'>) => {
    const tradeData = sanitizeForFirestore({
      ...trade,
      status: 'pending',
    });
    
    try {
      const docRef = await addDoc(collection(db, 'users', userId, 'crypto_shadow_trades'), tradeData);
      const newTrade = { id: docRef.id, ...tradeData } as CryptoShadowTrade;
      pendingCache.push(newTrade);
      return docRef;
    } catch (e) {
      console.error("[ShadowEngine] Falha ao logar trade:", e);
      return null;
    }
  },

  /**
   * Liquidar trade no vencimento.
   */
  liquidate: async (userId: string, tradeId: string, exitPrice: number, result: 'won' | 'lost' | 'draw', pnl: number, exitTs: number, settleDelayMs: number, lateSettle: boolean) => {
    const docRef = doc(db, 'users', userId, 'crypto_shadow_trades', tradeId);
    
    try {
      await updateDoc(docRef, {
        exitPrice,
        result,
        pnl,
        status: 'completed',
        exitTs,
        settleDelayMs,
        lateSettle,
        closedAt: serverTimestamp()
      });
    } catch (e) {
      console.error("[ShadowEngine] Falha ao liquidar trade:", e);
    }
  },

  /**
   * Busca trades pendentes e liquida os vencidos. 
   * Ciclo independente de 2s que não espera inferência do LLM.
   */
  settlePending: async (
    userId: string, 
    getPrice: (symbol: string) => number | null,
    onResult: (symbol: string, win: boolean, pnl: number, trade: CryptoShadowTrade) => void
  ) => {
    if (!userId) return;
    
    const now = Date.now();

    // Sincroniza cache se expirado ou vazio
    if (pendingCache.length === 0 || now - lastCacheFetch > CACHE_TTL) {
      const tradesRef = collection(db, 'users', userId, 'crypto_shadow_trades');
      const q = query(tradesRef, where('status', '==', 'pending'));
      try {
        const snap = await getDocs(q);
        pendingCache = snap.docs.map(d => ({ id: d.id, ...d.data() } as CryptoShadowTrade));
        lastCacheFetch = now;
      } catch (e) {
        console.warn("[ShadowEngine] Erro ao sincronizar cache de shadow trades.");
      }
    }

    if (pendingCache.length === 0) return;

    const toSettle = pendingCache.filter(t => {
      const entryTime = t.entryTs || new Date(t.timestamp).getTime();
      return now >= entryTime + (t.duration * 1000);
    });

    for (const trade of toSettle) {
      const exitPrice = getPrice(trade.symbol);
      if (exitPrice !== null && exitPrice > 0) {
        const entryPrice = trade.entryPrice;
        let result: 'won' | 'lost' | 'draw';
        let win = false;
        
        if (exitPrice === entryPrice) {
          result = 'draw';
        } else {
          const isCall = trade.direction === 'CALL' || trade.direction === 'RISE';
          win = isCall ? exitPrice > entryPrice : exitPrice < entryPrice;
          result = win ? 'won' : 'lost';
        }

        const stake = trade.stake || 1.0;
        const pnl = result === 'won' ? (stake * (trade.payoutRatio / 100)) : (result === 'lost' ? -stake : 0);
        
        const exitTs = Date.now();
        const entryTs = trade.entryTs || new Date(trade.timestamp).getTime();
        const targetExpiry = entryTs + (trade.duration * 1000);
        const settleDelayMs = exitTs - targetExpiry;
        const lateSettle = settleDelayMs > (trade.duration * 1000 * 0.5);

        // 1. Atualizar registro no Firestore
        await CryptoShadowEngine.liquidate(userId, trade.id!, exitPrice, result, pnl, exitTs, settleDelayMs, lateSettle);
        
        // 2. Limpar Cache local
        pendingCache = pendingCache.filter(t => t.id !== trade.id);
        
        // 3. Notificar sistema de resiliência e memória (ignora draws para estatísticas de win/loss)
        if (result !== 'draw') {
          onResult(trade.symbol, win, pnl, { ...trade, result, pnl, exitPrice, exitTs });
        }
      }
    }
  }
};
