// /src/services/financial-data-service.ts
'use server';

/**
 * @fileOverview A financial data service that interacts with Firebase Firestore.
 * This service now includes non-blocking writes and contextual error handling for security rules.
 */
import { db } from '@/lib/firebase';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, getDoc, setDoc, query, where, orderBy } from 'firebase/firestore';
import type { Goal, BudgetCategory, Transaction, RobotPerformance, TradeDecisionLog, EnhancedRobotPerformance } from '@/lib/types';
import { generateGoalImage } from '@/ai/flows/goal-image-generation';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';

// --- Transactions ---

export async function getTransactions(userId: string): Promise<Transaction[]> {
    if (!userId) return [];
    const transactionsCol = collection(db, `users/${userId}/transactions`);
    try {
        const snapshot = await getDocs(transactionsCol);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
    } catch (serverError) {
        // Propagate the original error for client-side handling
        console.error(`[Service Error] getTransactions failed for user ${userId}:`, serverError);
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `users/${userId}/transactions`,
            operation: 'list',
        }));
        throw serverError;
    }
}

export async function addTransaction(userId: string, data: Omit<Transaction, 'id'>): Promise<string> {
    if (!userId) throw new Error("User not authenticated.");
    const transactionsCol = collection(db, `users/${userId}/transactions`);
    try {
        await addDoc(transactionsCol, data);
        return `Transação "${data.description}" de R$${data.amount.toFixed(2)} adicionada com sucesso.`;
    } catch (serverError) {
        console.error(`[Service Error] addTransaction failed for user ${userId}:`, serverError);
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `users/${userId}/transactions`,
            operation: 'create',
            requestResourceData: data,
        }));
        throw serverError;
    }
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
    if (!userId) return [];
    const goalsCol = collection(db, `users/${userId}/goals`);
    try {
        const snapshot = await getDocs(goalsCol);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Goal));
    } catch (serverError) {
        console.error(`[Service Error] getGoals failed for user ${userId}:`, serverError);
         errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `users/${userId}/goals`,
            operation: 'list',
        }));
        throw serverError;
    }
}

export async function addGoal(userId: string, name: string, targetAmount: number): Promise<Goal> {
    if (!userId) throw new Error("User not authenticated.");
    const goalsCol = collection(db, `users/${userId}/goals`);
    
    const newGoalData = {
        name,
        targetAmount,
        currentAmount: 0,
        imageUrl: `https://placehold.co/600x400/334155/ffffff.png?text=${encodeURIComponent(name)}`,
        imageHint: "new goal"
    };

    try {
        const docRef = await addDoc(goalsCol, newGoalData);

        // Dispara a geração de imagem, mas não bloqueia a resposta principal
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
    } catch (serverError) {
        console.error(`[Service Error] addGoal failed for user ${userId}:`, serverError);
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `users/${userId}/goals`,
            operation: 'create',
            requestResourceData: newGoalData,
        }));
        throw serverError;
    }
}

export async function deleteGoal(userId: string, goalId: string): Promise<{ success: boolean }> {
    if (!userId) throw new Error("User not authenticated.");
    const goalDoc = doc(db, `users/${userId}/goals`, goalId);
    try {
        await deleteDoc(goalDoc);
        return { success: true };
    } catch (serverError) {
        console.error(`[Service Error] deleteGoal failed for user ${userId}, goal ${goalId}:`, serverError);
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `users/${userId}/goals/${goalId}`,
            operation: 'delete',
        }));
        throw serverError;
    }
}

// --- Budget ---

async function getBudgetLimits(userId: string): Promise<{ [key: string]: number }> {
    const settingsDoc = doc(db, `users/${userId}/settings`, 'budget');
    try {
        const docSnap = await getDoc(settingsDoc);
        if (docSnap.exists()) {
            return docSnap.data().limits || {};
        }
        // Default values if document doesn't exist
        return {
            "Moradia": 2000, "Alimentação": 1000, "Transporte": 500,
            "Lazer": 400, "Compras": 600, "Outros": 300, "Contas": 800,
        };
    } catch (serverError) {
         console.error(`[Service Error] getBudgetLimits failed for user ${userId}:`, serverError);
         errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `users/${userId}/settings/budget`,
            operation: 'get',
        }));
         throw serverError;
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
    if (!userId) throw new Error("User not authenticated.");
    const settingsDocRef = doc(db, `users/${userId}/settings`, 'budget');
    const dataToSet = { [`limits.${name}`]: newLimit };

    try {
        await setDoc(settingsDocRef, dataToSet, { merge: true });
        const transactions = await getTransactions(userId);
        const spent = transactions
            .filter(t => t.type === 'expense' && t.category === name)
            .reduce((sum, t) => sum + t.amount, 0);

        return { name, budgeted: newLimit, spent };
    } catch (serverError) {
        console.error(`[Service Error] updateBudgetLimit failed for user ${userId}:`, serverError);
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `users/${userId}/settings/budget`,
            operation: 'update',
            requestResourceData: dataToSet
        }));
        throw serverError;
    }
}

export async function getExpenseCategories(userId: string): Promise<string[]> {
    const limits = await getBudgetLimits(userId);
    return Object.keys(limits);
}

// --- General Insights (Mocked) ---
export async function getInsights(): Promise<string[]> {
    return [
      "Você gastou R$150 em restaurantes. Tente cozinhar em casa para economizar.",
      "Sua maior despesa é o aluguel. Considere procurar opções mais baratas, se possível.",
      "Você está perto de atingir seu fundo de emergência! Continue assim."
    ];
}

// --- Trading Robot Performance ---

export const saveRobotPerformance = async (userId: string, performance: EnhancedRobotPerformance[]) => {
  if (!userId) throw new Error("User not authenticated.");
  const docRef = doc(db, 'users', userId, 'trading_data', 'robot_council_performance');
  
  const dataToSave = {
    updatedAt: new Date().toISOString(),
    robots: performance.map(p => {
       const sanitizedValue = (value: number | undefined) => (value === undefined || isNaN(value)) ? 0 : value;
      return {
        id: p.id,
        strategyType: p.strategyType,
        strategy: p.strategy, 
        wins: sanitizedValue(p.wins),
        losses: sanitizedValue(p.losses),
        totalProfit: sanitizedValue(p.totalProfit),
        winRate: sanitizedValue(p.winRate),
        sharpeRatio: sanitizedValue(p.sharpeRatio),
        maxDrawdown: sanitizedValue(p.maxDrawdown),
        avgWin: sanitizedValue(p.avgWin),
        avgLoss: sanitizedValue(p.avgLoss),
        profitFactor: sanitizedValue(p.profitFactor),
        kellyFraction: sanitizedValue(p.kellyFraction),
        effectiveRegimes: p.effectiveRegimes || [],
        monteCarloScore: sanitizedValue(p.monteCarloScore),
        lastUpdated: sanitizedValue(p.lastUpdated),
        tradeHistory: p.tradeHistory || [],
      }
    })
  };
  
  try {
    await setDoc(docRef, dataToSave, { merge: true });
  } catch(error) {
    console.error(`[Service Error] saveRobotPerformance failed for user ${userId}:`, error);
     errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: `users/${userId}/trading_data/robot_council_performance`,
        operation: 'write',
        requestResourceData: dataToSave
    }));
    throw error;
  }
};

export const loadRobotPerformance = async (userId: string): Promise<EnhancedRobotPerformance[] | null> => {
  if (!userId) return null;
  const docRef = doc(db, 'users', userId, 'trading_data', 'robot_council_performance');
  try {
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return (data.robots || []).map((r: any) => ({
        ...r,
        tradeHistory: r.tradeHistory || [],
      }));
    }
    return null;
  } catch (error) {
    console.error(`[Service Error] loadRobotPerformance failed for user ${userId}:`, error);
    errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: `users/${userId}/trading_data/robot_council_performance`,
        operation: 'get',
    }));
    throw error;
  }
};


export async function getHallOfFame(userId: string): Promise<RobotPerformance[]> {
    try {
        const performanceData = await loadRobotPerformance(userId);
        if (!performanceData) {
            return [];
        }
        
        const PROMOTION_THRESHOLD_WINS = 10;
        const PROMOTION_THRESHOLD_PROFIT = 0;

        const promotedRobots = performanceData.filter(
            (p) => (p.wins || 0) >= PROMOTION_THRESHOLD_WINS && (p.totalProfit || 0) > PROMOTION_THRESHOLD_PROFIT
        );

        promotedRobots.sort((a, b) => (b.totalProfit || 0) - (a.totalProfit || 0));
        
        return promotedRobots;
    } catch(e) {
        console.error("Não foi possível carregar o Hall da Fama devido a um erro de acesso aos dados:", e);
        return [];
    }
}

// --- Trading Decision Log ---

export async function saveTradeDecision(userId: string, log: TradeDecisionLog): Promise<void> {
    if (!userId) throw new Error("User not authenticated.");
    const logCollectionRef = collection(db, 'users', userId, 'decision_logs');
    const logDocRef = doc(logCollectionRef, log.id);
    try {
        await setDoc(logDocRef, log);
    } catch (error) {
        console.error(`[Service Error] saveTradeDecision failed for user ${userId}:`, error);
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `users/${userId}/decision_logs/${log.id}`,
            operation: 'write',
            requestResourceData: log
        }));
        throw error;
    }
}

export async function getTradeDecisionLogs(userId: string): Promise<TradeDecisionLog[]> {
    if (!userId) return [];
    const logCollectionRef = collection(db, `users/${userId}/decision_logs`);
    const q = query(logCollectionRef, orderBy('timestamp', 'desc'));

    try {
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => d.data() as TradeDecisionLog);
    } catch (serverError) {
        console.error(`[Service Error] getTradeDecisionLogs failed for user ${userId}:`, serverError);
        errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: `users/${userId}/decision_logs`,
            operation: 'list',
        }));
        throw serverError;
    }
}
