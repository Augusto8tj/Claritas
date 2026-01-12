// src/services/trading-data-service-v1.ts
'use server';

/**
 * @fileOverview A financial data service for V1 that interacts with Firebase Firestore.
 * This service is isolated and only handles persistence for the V1 system.
 */
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { RobotPerformance } from '@/lib/types';

export async function saveRobotPerformance(userId: string, performanceData: RobotPerformance[]): Promise<void> {
    const performanceDocRef = doc(db, 'users', userId, 'trading_data', 'robotPerformance');
    const dataToSave = { performance: performanceData };

    // No servidor, podemos usar o setDoc diretamente. Erros serão propagados.
    await setDoc(performanceDocRef, dataToSave, { merge: true });
}

export async function loadRobotPerformance(userId: string): Promise<RobotPerformance[] | null> {
    const performanceDocRef = doc(db, 'users', userId, 'trading_data', 'robotPerformance');
    
    try {
        const docSnap = await getDoc(performanceDocRef);
        if (docSnap.exists()) {
            return docSnap.data().performance as RobotPerformance[];
        }
        return null;
    } catch (serverError) {
        // Agora, simplesmente re-lançamos o erro para ser tratado pelo cliente.
        console.error(`[Service Error V1] loadRobotPerformance for user ${userId} failed:`, serverError);
        throw serverError;
    }
}
