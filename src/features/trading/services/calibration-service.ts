// src/features/trading/services/calibration-service.ts
'use client';

import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { RuleCalibration } from '../types/council';

/**
 * SERVIÇO DE CALIBRAÇÃO V6.1
 * Persiste e recupera os limiares validados pelo Backtest Lead-Lag.
 * A calibração vale CALIBRATION_MAX_AGE_DAYS dias; vencida ou inválida => null ("NÃO CALIBRADO").
 */
export const CALIBRATION_MAX_AGE_DAYS = 14;

export const CalibrationService = {
    async save(userId: string, calibration: RuleCalibration): Promise<void> {
        if (!userId) return;
        const docRef = doc(db, 'users', userId, 'crypto_calibration', 'rules');
        await setDoc(docRef, {
            ...calibration,
            timestamp: calibration.timestamp || new Date().toISOString(),
            lastRun: serverTimestamp()
        });
    },

    async get(userId: string): Promise<RuleCalibration | null> {
        if (!userId) return null;
        try {
            const snap = await getDoc(doc(db, 'users', userId, 'crypto_calibration', 'rules'));
            if (!snap.exists()) return null;
            const data = snap.data() as any;

            let ts = Date.parse(data?.timestamp);
            if (!Number.isFinite(ts) && typeof data?.lastRun?.toMillis === 'function') ts = data.lastRun.toMillis();
            if (!Number.isFinite(ts)) return null; // sem data válida => não confiável

            const ageDays = (Date.now() - ts) / (1000 * 3600 * 24);
            if (ageDays > CALIBRATION_MAX_AGE_DAYS || ageDays < -1) return null;

            const { lastRun, ...rest } = data;
            return rest as RuleCalibration;
        } catch (e) {
            console.warn('[CalibrationService] Falha ao ler calibração:', e);
            return null;
        }
    }
};
