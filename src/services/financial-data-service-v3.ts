// src/services/financial-data-service-v3.ts
'use server';

/**
 * @fileOverview Serviço de dados V3, isolado para o IA Lab.
 * Interage com coleções específicas do Firestore com o sufixo '_v3'.
 */
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, setDoc, deleteDoc, query, orderBy, getDocs } from 'firebase/firestore';
import type { EnhancedRobotPerformance, TradeDecisionLog } from '@/lib/types';
import type { EvolutionEvent } from '@/features/trading/hooks/use-strategy-evolution-v3';
import { sanitizeForFirestore } from './utils/sanitize-for-firestore';


// --- Trading Robot Performance V3 ---

export async function saveRobotPerformanceV3(userId: string, performance: EnhancedRobotPerformance[]): Promise<void> {
    if (!userId) return;
    const docRef = doc(db, 'users', userId, 'performance_v3', 'robot_council');
    const sanitizedData = sanitizeForFirestore({
        updatedAt: new Date().toISOString(),
        robots: performance,
    });
    // No servidor, podemos usar setDoc diretamente e de forma assíncrona
    try {
        await setDoc(docRef, sanitizedData, { merge: true });
    } catch (error) {
        console.error("Falha ao salvar desempenho V3:", error);
        // Em um ambiente de produção, você poderia logar isso em um serviço externo.
    }
};


export async function loadRobotPerformanceV3(userId: string): Promise<EnhancedRobotPerformance[] | null> {
    if (!userId) return null;
    const docRef = doc(db, 'users', userId, 'performance_v3', 'robot_council');
    try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            return (data.robots || []).map((robot: any) => ({
                ...robot,
                // Garante que tradeHistory é sempre um array
                tradeHistory: robot.tradeHistory || [],
            }));
        }
        return null;
    } catch (error) {
        console.error(`[Service Error V3] loadRobotPerformance for user ${userId} failed:`, error);
        throw error;
    }
};

// --- Trading Decision Log V3 ---

export async function saveTradeDecisionV3(userId: string, log: TradeDecisionLog) {
    if (!userId) return;
    const logCollectionRef = collection(db, 'users', userId, 'decision_logs_v3');
    const logDocRef = doc(logCollectionRef, log.id);
    const sanitizedLog = sanitizeForFirestore(log);
    // Correção: Usar setDoc diretamente do SDK do Firebase no servidor.
    try {
        await setDoc(logDocRef, sanitizedLog, { merge: true });
    } catch (error) {
        console.error("Falha ao salvar log de decisão V3:", error);
    }
}

export async function getTradeDecisionLogsV3(userId: string): Promise<TradeDecisionLog[]> {
    if (!userId) {
        return [];
    }
    const logCollectionRef = collection(db, `users/${userId}/decision_logs_v3`);
    const q = query(logCollectionRef, orderBy('timestamp', 'desc'));
    try {
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => d.data() as TradeDecisionLog);
    } catch (error) {
        console.error(`[Service Error V3] getTradeDecisionLogsV3 for user ${userId} failed:`, error);
        return [];
    }
}

// --- Evolution History V3 ---

export async function saveEvolutionHistoryV3(userId: string, history: EvolutionEvent[]): Promise<void> {
    if (!userId || !history) return;
    const docRef = doc(db, 'users', userId, 'evolution_v3', 'history');
    try {
        const historyForFirestore = history.map(event => ({
            ...event,
            timestamp: event.timestamp.toISOString(),
        }));
        const sanitizedHistory = sanitizeForFirestore({ history: historyForFirestore });
        await setDoc(docRef, sanitizedHistory, { merge: true });
    } catch (error) {
        console.error("❌ [saveEvolutionHistoryV3] Erro ao gravar no Firestore:", error);
        throw new Error("Falha ao salvar o histórico de evolução V3.");
    }
}

export async function loadEvolutionHistoryV3(userId: string): Promise<EvolutionEvent[]> {
    if (!userId) return [];
    const docRef = doc(db, 'users', userId, 'evolution_v3', 'history');
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
        console.error(`[Service Error V3] loadEvolutionHistory for user ${userId} failed:`, error);
        return [];
    }
}

export async function clearEvolutionHistoryV3(userId: string): Promise<void> {
    if (!userId) return;
    const docRef = doc(db, 'users', userId, 'evolution_v3', 'history');
    await deleteDoc(docRef);
}

export async function deleteEvolutionEventV3(userId: string, eventTimestamp: string): Promise<void> {
    if (!userId) return;
    const currentHistory = await loadEvolutionHistoryV3(userId);
    const newHistory = currentHistory.filter(event => event.timestamp.toISOString() !== eventTimestamp);
    if (newHistory.length < currentHistory.length) {
        await saveEvolutionHistoryV3(userId, newHistory);
    }
}
