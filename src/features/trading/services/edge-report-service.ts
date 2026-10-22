// /src/features/trading/services/edge-report-service.ts
'use client';

import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { RuleEdgeStats } from '../types/council';

/**
 * Serviço Edge Report V4.2
 * Recupera e processa as métricas de vantagem estatística acumuladas por Shadow Trades.
 */
export const getRuleEdgeStats = async (userId: string, rule: string, gravity: string, symbol: string): Promise<RuleEdgeStats> => {
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
};

/**
 * Atualiza as estatísticas de vantagem de uma regra após liquidação. (Etapa 14)
 * Utiliza Intervalo de Wilson para calcular o Lower Bound de acerto.
 */
export const updateRuleEdgeStats = async (userId: string, symbol: string, rule: string, gravity: string, win: boolean, pnl: number) => {
    if (!userId) return;
    
    const stats = await getRuleEdgeStats(userId, rule, gravity, symbol);
    
    const newN = stats.n + 1;
    const newWins = stats.wins + (win ? 1 : 0);
    const newPnL = stats.pnl + pnl;
    
    // Cálculo do Wilson Lower Bound (95% confiança)
    const p = newWins / newN;
    const z = 1.96;
    const denominator = 1 + (z * z) / newN;
    const centerProbability = p + (z * z) / (2 * newN);
    const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * newN)) / newN);
    
    const lowerBound = (centerProbability - spread) / denominator;

    const updated: RuleEdgeStats = {
        ...stats,
        n: newN,
        wins: newWins,
        pnl: newPnL,
        posteriorMean: p,
        lowerBound: Math.max(0, lowerBound),
    };

    const key = `${rule}_${gravity}_${symbol}`.replace(/\//g, '_');
    const docRef = doc(db, 'users', userId, 'crypto_edge_stats', key);
    
    try {
        await setDoc(docRef, {
            ...updated,
            lastUpdate: serverTimestamp()
        }, { merge: true });
    } catch (e) {
        console.error("[EdgeReport] Falha ao atualizar stats:", e);
    }
};
