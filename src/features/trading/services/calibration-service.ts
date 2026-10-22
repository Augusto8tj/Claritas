// src/features/trading/services/calibration-service.ts
'use client';

import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { RuleCalibration } from '../types/council';

/**
 * SERVIÇO DE CALIBRAÇÃO V5.8
 * Persiste e recupera os limiares ótimos encontrados pelo Backtest Lead-Lag.
 */

export const CalibrationService = {
    async save(userId: string, calibration: RuleCalibration) {
        if (!userId) return;
        const docRef = doc(db, 'users', userId, 'crypto_calibration', 'rules');
        await setDoc(docRef, {
            ...calibration,
            lastRun: serverTimestamp()
        });
    },

    async get(userId: string): Promise<RuleCalibration | null> {
        if (!userId) return null;
        const docRef = doc(db, 'users', userId, 'crypto_calibration', 'rules');
        const snap = await getDoc(docRef);
        
        if (snap.exists()) {
            const data = snap.data() as any;
            const ageDays = (Date.now() - new Date(data.timestamp).getTime()) / (1000 * 3600 * 24);
            if (ageDays <= 14) return data as RuleCalibration;
        }
        return null;
    }
};
