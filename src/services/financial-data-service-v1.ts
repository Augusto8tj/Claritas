// src/services/financial-data-service-v1.ts
'use server';

/**
 * @fileOverview Serviço de dados V1, isolado para o Deriv Trader V1.
 * Interage com coleções específicas do Firestore com o sufixo '_v1'.
 */
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, setDoc } from 'firebase/firestore';
import type { RobotPerformance, TradeDecisionLog } from '@/lib/types';
import type { EvolutionEvent } from '@/features/trading/hooks/use-strategy-evolution-v1';
import { sanitizeForFirestore } from './utils/sanitize-for-firestore';
import { errorEmitter, FirestorePermissionError } from '@/firebase';

const DATA_COLLECTION = 'performance_v1';
const EVOLUTION_COLLECTION = 'evolution_v1';
const PERFORMANCE_DOC = 'robot_council';
const EVOLUTION_DOC = 'history';
const DECISION_LOG_COLLECTION = 'decision_logs_v1';

// --- Robot Performance V1 ---

export async function saveRobotPerformanceV1(userId: string, performance: RobotPerformance[]): Promise<void> {
    if (!userId) return;
    const docRef = doc(db, 'users', userId, DATA_COLLECTION, PERFORMANCE_DOC);
    const sanitizedData = sanitizeForFirestore({
        updatedAt: new Date().toISOString(),
        performance: performance,
    });
    
    setDoc(docRef, sanitizedData, { merge: true })
        .catch(async (serverError) => {
            const permissionError = new FirestorePermissionError({
                path: docRef.path,
                operation: 'write',
                requestResourceData: sanitizedData,
            });
            errorEmitter.emit('permission-error', permissionError);
        });
};


export async function loadRobotPerformanceV1(userId: string): Promise<RobotPerformance[] | null> {
  if (!userId) return null;
  const docRef = doc(db, 'users', userId, DATA_COLLECTION, PERFORMANCE_DOC);
  try {
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return data.performance || [];
    }
    return null;
  } catch (error) {
    console.error(`[Service Error V1] loadRobotPerformance for user ${userId} failed:`, error);
    throw error;
  }
};

// --- Trading Decision Log V1 ---

export async function saveTradeDecisionV1(userId: string, log: TradeDecisionLog) {
    if (!userId) return;
    const logCollectionRef = collection(db, 'users', userId, DECISION_LOG_COLLECTION);
    const logDocRef = doc(logCollectionRef, log.id);
    const sanitizedLog = sanitizeForFirestore(log);
    setDoc(logDocRef, sanitizedLog, { merge: true }).catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
            path: logDocRef.path,
            operation: 'write',
            requestResourceData: sanitizedLog,
        });
        errorEmitter.emit('permission-error', permissionError);
    });
}

// --- Evolution History V1 ---

export async function saveEvolutionHistoryV1(userId: string, history: EvolutionEvent[]): Promise<void> {
    if (!userId || !history) return;
    const docRef = doc(db, 'users', userId, EVOLUTION_COLLECTION, EVOLUTION_DOC);
    try {
        const historyForFirestore = history.map(event => ({
            ...event,
            timestamp: event.timestamp.toISOString(),
        }));
        const sanitizedHistory = sanitizeForFirestore({ history: historyForFirestore });
        await setDoc(docRef, sanitizedHistory, { merge: true });
    } catch (error) {
        console.error("❌ [saveEvolutionHistoryV1] Erro ao gravar no Firestore:", error);
        throw new Error("Falha ao salvar o histórico de evolução V1.");
    }
}

export async function loadEvolutionHistoryV1(userId: string): Promise<EvolutionEvent[]> {
    if (!userId) return [];
    const docRef = doc(db, 'users', userId, EVOLUTION_COLLECTION, EVOLUTION_DOC);
    try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            const history = (data.history || []).map((event: any) => ({
                ...event,
                timestamp: new Date(event.timestamp)
            }));
            return history.sort((a: EvolutionEvent, b: EvolutionEvent) => b.timestamp.getTime() - a.timestamp.getTime());
        }
        return [];
    } catch (error) {
        console.error(`[Service Error V1] loadEvolutionHistory for user ${userId} failed:`, error);
        return [];
    }
}
