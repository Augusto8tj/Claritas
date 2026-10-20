'use client';

/**
 * @fileOverview LIVE TRADE LOG V5.3
 * Serviço de auditoria para execuções em conta Demo/Real.
 */

import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { sanitizeForFirestore } from '@/services/utils/sanitize-for-firestore';

export interface LiveTradeEntry {
    symbol: string;
    direction: 'CALL' | 'PUT';
    contract: string;
    stake: number;
    payout: number;
    duration: number;
    durationUnit: string;
    
    // Telemetria de Preço
    spotAtDecision: number;
    spotAtPurchase: number;
    slippagePips: number;
    
    // Latências
    decisionLatencyMs: number;
    executionLatencyMs: number;
    totalLatencyMs: number;
    
    // Contexto
    rule: string;
    gravityState: string;
    confidence: number;
    sentinelScore: number;
    entropy: number;
    
    // Timestamps
    signalTs: number;
    decisionTs: number;
    purchaseTs: number;
    
    status: 'pending' | 'won' | 'lost';
    accountType: string;
}

export async function logLiveTrade(userId: string, trade: LiveTradeEntry) {
    if (!userId) return;
    
    try {
        const docRef = await addDoc(collection(db, 'users', userId, 'crypto_live_trades'), sanitizeForFirestore({
            ...trade,
            timestamp: new Date().toISOString(),
            createdAt: serverTimestamp()
        }));
        return docRef.id;
    } catch (e) {
        console.error("[LiveLog] Falha ao registrar trade institucional:", e);
        return null;
    }
}
