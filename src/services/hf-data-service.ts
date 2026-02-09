// src/services/hf-data-service.ts
import { db } from '@/lib/firebase';
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  Timestamp,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import type { StrikeZone } from '@/features/trading/hooks/use-hf-strike-zone';
import type { StrategyType } from '@/features/trading/services/hf-strike-logic';
import type { MarketRegime } from '@/features/trading/ml/market-regime-detector';

export interface HFTradeLog {
  id?: string;
  userId: string;
  symbol: string;
  strikeZone: StrikeZone; // Kept for some legacy data, but new data is in other fields
  execution: {
    contractId?: string;
    entryPrice: number;
    exitPrice?: number;
    result?: number;
    status: 'pending' | 'won' | 'lost';
    executedAt: string;
    closedAt?: string;
  };
  timestamp: string;
  // NEW FIELDS
  marketRegime: MarketRegime;
  ensembleParticipants: StrategyType[];
  positionSize: {
    recommended: number;
    actual: number;
    reasoning: string[];
  };
  riskMetrics: {
    sharpeContribution: number;
    portfolioExposure: number;
  };
}

/**
 * Salvar log de trade HF no Firestore
 */
export async function saveHFTradeLog(userId: string, tradeLog: Omit<HFTradeLog, 'id' | 'userId' | 'timestamp'>): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, `users/${userId}/hf_trades_v1`), {
      ...tradeLog,
      userId,
      timestamp: new Date().toISOString(),
      createdAt: Timestamp.now(),
    });
    return docRef.id;
  } catch (error) {
    console.error('[HF Data Service] Error saving trade log:', error);
    throw error;
  }
}

/**
 * Buscar logs HF do usuário
 */
export async function getHFTradeLogs(userId: string, limitCount: number = 50): Promise<HFTradeLog[]> {
  try {
    const q = query(
      collection(db, `users/${userId}/hf_trades_v1`),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as HFTradeLog[];
  } catch (error) {
    console.error('[HF Data Service] Error fetching trade logs:', error);
    return [];
  }
}

/**
 * Calcular estatísticas HF
 */
export async function calculateHFStats(userId: string) {
  try {
    const logs = await getHFTradeLogs(userId, 200);
    const finishedTrades = logs.filter(log => log.execution.status !== 'pending');

    if (finishedTrades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        totalPnL: 0,
        avgConfidence: 0,
        sharpeRatio: 0,
      };
    }

    const wins = finishedTrades.filter(t => t.execution.status === 'won').length;
    const winRate = (wins / finishedTrades.length) * 100;
    const totalPnL = finishedTrades.reduce((sum, t) => sum + (t.execution.result || 0), 0);
    const avgConfidence = logs.reduce((sum, t) => sum + t.strikeZone.confidence, 0) / logs.length;

    // Sharpe Ratio simplificado
    const returns = finishedTrades.map(t => t.execution.result || 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sq, r) => sq + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

    return {
      totalTrades: finishedTrades.length,
      winRate: parseFloat(winRate.toFixed(2)),
      totalPnL: parseFloat(totalPnL.toFixed(2)),
      avgConfidence: parseFloat(avgConfidence.toFixed(1)),
      sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
    };
  } catch (error) {
    console.error('[HF Data Service] Error calculating stats:', error);
    return {
      totalTrades: 0,
      winRate: 0,
      totalPnL: 0,
      avgConfidence: 0,
      sharpeRatio: 0,
    };
  }
}

/**
 * Deletar log HF
 */
export async function deleteHFTradeLog(userId: string, logId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, `users/${userId}/hf_trades_v1`, logId));
  } catch (error) {
    console.error('[HF Data Service] Error deleting trade log:', error);
    throw error;
  }
}
