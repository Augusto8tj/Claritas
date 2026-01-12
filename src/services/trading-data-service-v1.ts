// src/services/trading-data-service-v1.ts
'use server';

/**
 * @fileOverview A financial data service for V1 that interacts with Firebase Firestore.
 * This service is isolated and only handles persistence for the V1 system.
 */
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { RobotPerformance } from '@/lib/types';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

export async function saveRobotPerformance(userId: string, performanceData: RobotPerformance[]): Promise<void> {
    const performanceDocRef = doc(db, 'users', userId, 'trading', 'robotPerformance');
    const dataToSave = { performance: performanceData };

    setDoc(performanceDocRef, dataToSave, { merge: true })
        .catch(async () => {
            const permissionError = new FirestorePermissionError({
                path: performanceDocRef.path,
                operation: 'update',
                requestResourceData: dataToSave,
            });
            errorEmitter.emit('permission-error', permissionError);
            throw new Error("Falha ao salvar desempenho dos robôs (V1).");
        });
}

export async function loadRobotPerformance(userId: string): Promise<RobotPerformance[] | null> {
    const performanceDocRef = doc(db, 'users', userId, 'trading', 'robotPerformance');
    
    try {
        const docSnap = await getDoc(performanceDocRef);
        if (docSnap.exists()) {
            return docSnap.data().performance as RobotPerformance[];
        }
        return null;
    } catch (serverError) {
        const permissionError = new FirestorePermissionError({
            path: performanceDocRef.path,
            operation: 'get',
        });
        errorEmitter.emit('permission-error', permissionError);
        throw serverError; // Re-throw to be caught by the caller
    }
}
