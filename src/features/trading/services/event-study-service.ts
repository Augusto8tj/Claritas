// /src/features/trading/services/event-study-service.ts
'use client';

import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { sanitizeForFirestore } from '@/services/utils/sanitize-for-firestore';

/**
 * Event Study Service V5.0
 * Monitora e registra o comportamento de Altcoins após impulsos do líder (BTC).
 */

export interface EventStudyEntry {
    symbol: string;
    btcZScore: number;
    btcDirection: 'UP' | 'DOWN';
    timestamp: number;
    altPriceT0: number;
    horizons: {
        seconds: number;
        altPriceTN?: number;
        returns?: number;
        directionMatch?: boolean;
    }[];
}

export const EventStudyService = {
    /**
     * Registra um evento de impulso para análise posterior de lag e correlação.
     */
    async recordImpulseEvent(userId: string, entry: EventStudyEntry) {
        try {
            await addDoc(collection(db, 'users', userId, 'crypto_event_study'), sanitizeForFirestore({
                ...entry,
                status: 'captured',
                timestamp: new Date().toISOString()
            }));
        } catch (e) {
            console.warn("[EventStudy] Erro ao gravar evento:", e);
        }
    }
};
