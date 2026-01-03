// src/app/actions/audit-log-actions.ts
"use server";

import { db } from "@/lib/firebase";
import { collection, getDocs, writeBatch, doc, deleteDoc } from "firebase/firestore";
import { revalidatePath } from "next/cache";

export async function deleteAllDecisionLogs(userId: string): Promise<{ success: boolean, error?: string }> {
    if (!userId) {
        return { success: false, error: "Utilizador não autenticado." };
    }

    const logCollectionRef = collection(db, 'users', userId, 'decision_logs');

    try {
        const snapshot = await getDocs(logCollectionRef);
        if (snapshot.empty) {
            return { success: true }; // Nada a fazer
        }

        const batch = writeBatch(db);
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        
        revalidatePath('/audit-log');
        return { success: true };
    } catch (error: any) {
        console.error("Falha ao apagar logs de auditoria:", error);
        return { success: false, error: error.message || "Ocorreu um erro ao tentar apagar os registos." };
    }
}

export async function deleteDecisionLog(userId: string, logId: string): Promise<{ success: boolean; error?: string }> {
    if (!userId) {
        return { success: false, error: "Utilizador não autenticado." };
    }
    if (!logId) {
        return { success: false, error: "ID do log não fornecido." };
    }

    const logDocRef = doc(db, 'users', userId, 'decision_logs', logId);

    try {
        await deleteDoc(logDocRef);
        revalidatePath('/audit-log');
        return { success: true };
    } catch (error: any) {
        console.error(`Falha ao apagar o log de auditoria ${logId}:`, error);
        return { success: false, error: error.message || "Ocorreu um erro ao tentar apagar o registo." };
    }
}
