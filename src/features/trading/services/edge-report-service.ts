// /src/features/trading/services/edge-report-service.ts
'use client';

import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { RuleEdgeStats } from '../types/council';

/**
 * Serviço Edge Report V4.2
 * Recupera e processa as métricas de vantagem estatística acumuladas por Shadow Trades.
 */
export const EdgeReportService = {
  
  /**
   * Obtém as métricas agregadas para um cenário específico.
   * Chave composta: `${rule}_${gravityState}_${symbol}`
   */
  getStats: async (userId: string, rule: string, gravity: string, symbol: string): Promise<RuleEdgeStats> => {
    const key = `${rule}_${gravity}_${symbol}`.replace(/\//g, '_');
    const docRef = doc(db, 'users', userId, 'crypto_edge_stats', key);
    
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data() as RuleEdgeStats;
      }
    } catch (e) {
      console.warn(`[EdgeReport] Falha ao ler stats para ${key}`);
    }

    // Default neutro: p-hat 50%
    return {
      rule,
      gravityState: gravity,
      symbol,
      n: 0,
      wins: 0,
      pnl: 0,
      posteriorMean: 0.5,
      lowerBound: 0,
      avgProfit: 0,
      avgLoss: 0,
      profitFactor: 0,
      maxDrawdown: 0
    };
  }
};
