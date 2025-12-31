// /src/services/financial-data-service.ts
'use server';

/**
 * @fileOverview A financial data service that interacts with Firebase Firestore.
 */
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import type { Goal, BudgetCategory, Transaction, RobotPerformance } from '@/lib/types';
import { generateGoalImage } from '@/ai/flows/goal-image-generation';

import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

const PROMOTION_THRESHOLD_WINS = 10;
const PROMOTION_THRESHOLD_PROFIT = 0;

// --- Transactions ---

export async function getTransactions(userId: string): Promise<Transaction[]> {
    const transactionsCol = collection(db, `users/${userId}/transactions`);
    try {
        const snapshot = await getDocs(transactionsCol);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
    } catch (serverError) {
        const permissionError = new FirestorePermissionError({
            path: transactionsCol.path,
            operation: 'list',
        });
        errorEmitter.emit('permission-error', permissionError);
        return [];
    }
}

export async function addTransaction(userId: string, data: Omit<Transaction, 'id'>): Promise<string> {
    const transactionsCol = collection(db, `users/${userId}/transactions`);
    addDoc(transactionsCol, data).catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
            path: transactionsCol.path,
            operation: 'create',
            requestResourceData: data,
        });
        errorEmitter.emit('permission-error', permissionError);
    });
    return `Transação "${data.description}" de R$${data.amount.toFixed(2)} adicionada com sucesso.`;
}

// --- Financial Summary ---

export async function getFinancialSummary(userId: string): Promise<{ income: number; expenses: number; balance: number; }> {
    const transactions = await getTransactions(userId);
    const income = transactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
    const expenses = transactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
    return { income, expenses, balance: income - expenses };
}

// --- Goals ---

export async function getGoals(userId: string): Promise<Goal[]> {
    const goalsCol = collection(db, `users/${userId}/goals`);
    try {
        const snapshot = await getDocs(goalsCol);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Goal));
    } catch (serverError) {
        const permissionError = new FirestorePermissionError({
            path: goalsCol.path,
            operation: 'list',
        });
        errorEmitter.emit('permission-error', permissionError);
        return [];
    }
}

export async function addGoal(userId: string, name: string, targetAmount: number): Promise<Goal> {
    const goalsCol = collection(db, `users/${userId}/goals`);
    
    const newGoalData = {
        name,
        targetAmount,
        currentAmount: 0,
        imageUrl: `https://placehold.co/600x400/334155/ffffff.png?text=${encodeURIComponent(name)}`,
        imageHint: "new goal"
    };

    const docRef = await addDoc(goalsCol, newGoalData).catch((serverError) => {
        const permissionError = new FirestorePermissionError({
            path: goalsCol.path,
            operation: 'create',
            requestResourceData: newGoalData,
        });
        errorEmitter.emit('permission-error', permissionError);
        throw serverError;
    });

    generateGoalImage({ goalName: name })
        .then(imageResult => {
            if (imageResult?.imageUrl) {
                const goalDoc = doc(db, `users/${userId}/goals`, docRef.id);
                updateDoc(goalDoc, { imageUrl: imageResult.imageUrl })
                    .catch(updateError => {
                        console.error("Falha ao atualizar a imagem da meta:", updateError);
                    });
            }
        })
        .catch(imageError => {
            console.error("Falha ao gerar imagem da meta, usando placeholder.", imageError);
        });

    return { id: docRef.id, ...newGoalData };
}

export async function deleteGoal(userId: string, goalId: string): Promise<{ success: boolean }> {
    const goalDoc = doc(db, `users/${userId}/goals`, goalId);
    await deleteDoc(goalDoc).catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
            path: goalDoc.path,
            operation: 'delete',
        });
        errorEmitter.emit('permission-error', permissionError);
        throw serverError;
    });
    return { success: true };
}

// --- Budget ---

async function getBudgetLimits(userId: string): Promise<{ [key: string]: number }> {
    const settingsDoc = doc(db, `users/${userId}/settings`, 'budget');
    try {
        const docSnap = await getDoc(settingsDoc);
        if (docSnap.exists()) {
            return docSnap.data().limits || {};
        }
        return {
            "Moradia": 2000, "Alimentação": 1000, "Transporte": 500,
            "Lazer": 400, "Compras": 600, "Outros": 300, "Contas": 800,
        };
    } catch (serverError) {
         const permissionError = new FirestorePermissionError({
            path: settingsDoc.path,
            operation: 'get',
        });
        errorEmitter.emit('permission-error', permissionError);
        return {};
    }
}

export async function getBudgetData(userId: string): Promise<BudgetCategory[]> {
    const [transactions, budgetLimits] = await Promise.all([
        getTransactions(userId),
        getBudgetLimits(userId)
    ]);
    
    const expensesByCategory = transactions
      .filter(t => t.type === 'expense')
      .reduce((acc, t) => {
        const category = t.category || "Outros";
        if (!acc[category]) acc[category] = 0;
        acc[category] += t.amount;
        return acc;
      }, {} as { [key: string]: number });
  
    return Object.entries(budgetLimits).map(([name, budgeted]) => ({
      name,
      budgeted,
      spent: expensesByCategory[name] || 0,
    }));
}

export async function updateBudgetLimit(userId: string, name: string, newLimit: number): Promise<BudgetCategory | null> {
    const settingsDocRef = doc(db, `users/${userId}/settings`, 'budget');
    const dataToSet = { [`limits.${name}`]: newLimit };

    await setDoc(settingsDocRef, dataToSet, { merge: true })
        .catch(async (serverError) => {
            const permissionError = new FirestorePermissionError({
                path: settingsDocRef.path,
                operation: 'update',
                requestResourceData: dataToSet
            });
            errorEmitter.emit('permission-error', permissionError);
            throw serverError;
        });

    const transactions = await getTransactions(userId);
    const spent = transactions
        .filter(t => t.type === 'expense' && t.category === name)
        .reduce((sum, t) => sum + t.amount, 0);

    return { name, budgeted: newLimit, spent };
}

export async function getExpenseCategories(userId: string): Promise<string[]> {
    const limits = await getBudgetLimits(userId);
    return Object.keys(limits);
}

// --- General Insights (Still Mocked) ---
export async function getInsights(): Promise<string[]> {
    return [
      "Você gastou R$150 em restaurantes. Tente cozinhar em casa para economizar.",
      "Sua maior despesa é o aluguel. Considere procurar opções mais baratas, se possível.",
      "Você está perto de atingir seu fundo de emergência! Continue assim."
    ];
}


// --- Trading Robot Performance ---

export const saveRobotPerformance = async (userId: string, performance: RobotPerformance[]) => {
  try {
    const docRef = doc(db, 'users', userId, 'trading_data', 'robot_council_performance');
    
    const dataToSave = {
      updatedAt: new Date().toISOString(),
      robots: performance.map(p => ({
        id: p.id,
        strategyType: p.strategyType,
        strategy: p.strategy, 
        wins: p.wins,
        losses: p.losses,
        totalProfit: p.totalProfit,
        winRate: p.winRate,
        winRateTrend: p.winRateTrend || 0,
        winRateRange: p.winRateRange || 0
      }))
    };

    await setDoc(docRef, dataToSave, { merge: true }).catch((serverError) => {
       const permissionError = new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
          requestResourceData: dataToSave,
       });
       errorEmitter.emit('permission-error', permissionError);
       throw serverError;
    });

  } catch (error) {
    console.error("Erro ao salvar performance dos robôs:", error);
  }
};

export const loadRobotPerformance = async (userId: string): Promise<RobotPerformance[] | null> => {
  try {
    const docRef = doc(db, 'users', userId, 'trading_data', 'robot_council_performance');
    const docSnap = await getDoc(docRef).catch((serverError) => {
       const permissionError = new FirestorePermissionError({
          path: docRef.path,
          operation: 'get',
       });
       errorEmitter.emit('permission-error', permissionError);
       throw serverError;
    });

    if (docSnap.exists()) {
      const data = docSnap.data();
      return data.robots.map((r: any) => ({
        ...r,
        winRateTrend: r.winRateTrend ?? 0, 
        winRateRange: r.winRateRange ?? 0
      }));
    }
    return null;
  } catch (error) {
    console.error("Erro ao carregar performance:", error);
    return null;
  }
};


export async function getHallOfFame(userId: string): Promise<RobotPerformance[]> {
    try {
        const performanceData = await loadRobotPerformance(userId);
        if (!performanceData) {
            return [];
        }

        const promotedRobots = performanceData.filter(
            (p) => p.wins >= PROMOTION_THRESHOLD_WINS && p.totalProfit > PROMOTION_THRESHOLD_PROFIT
        );

        promotedRobots.sort((a, b) => b.totalProfit - a.totalProfit);
        
        return promotedRobots;
    } catch(e) {
        console.error("Não foi possível carregar o Hall da Fama devido a um erro de acesso aos dados:", e);
        return [];
    }
}
