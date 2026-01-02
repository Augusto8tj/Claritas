// /src/services/financial-data-service.ts
'use server';

/**
 * @fileOverview A financial data service that interacts with Firebase Firestore.
 * This service now uses non-blocking updates and propagates raw errors.
 */
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, query, where, orderBy, getDoc, addDoc, deleteDoc } from 'firebase/firestore';
import type { Goal, BudgetCategory, Transaction, RobotPerformance, TradeDecisionLog, EnhancedRobotPerformance } from '@/lib/types';
import { generateGoalImage } from '@/ai/flows/goal-image-generation';
import { addDocumentNonBlocking, deleteDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase/non-blocking-updates';


// --- Transactions ---

export async function getTransactions(userId: string): Promise<Transaction[]> {
    if (!userId) return [];
    const transactionsCol = collection(db, `users/${userId}/transactions`);
    try {
        const snapshot = await getDocs(transactionsCol);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
    } catch (serverError) {
        console.error(`[Service Error] getTransactions failed for user ${userId}:`, serverError);
        throw serverError;
    }
}

export async function addTransaction(userId: string, data: Omit<Transaction, 'id'>): Promise<string> {
    if (!userId) throw new Error("User not authenticated.");
    const transactionsCol = collection(db, `users/${userId}/transactions`);
    
    // Use non-blocking update
    addDocumentNonBlocking(transactionsCol, data);

    return `Transação "${data.description}" de R$${data.amount.toFixed(2)} está a ser adicionada.`;
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
        throw serverError;
    }
}

export async function addGoal(userId: string, name: string, targetAmount: number): Promise<Goal> {
    if (!userId) throw new Error("User not authenticated.");
    const goalsCol = collection(db, `users/${userId}/goals`);
    
    const newGoalData: Omit<Goal, 'id'> = {
        name,
        targetAmount,
        currentAmount: 0,
        imageUrl: `https://placehold.co/600x400/334155/ffffff.png?text=${encodeURIComponent(name)}`,
        imageHint: "new goal"
    };

    try {
        // Use non-blocking addDoc and get the promise
        const docRefPromise = addDocumentNonBlocking(goalsCol, newGoalData);

        // Continue with non-blocking tasks
        generateGoalImage({ goalName: name })
            .then(imageResult => {
                if (imageResult?.imageUrl) {
                    docRefPromise.then(docRef => {
                        const goalDoc = doc(db, `users/${userId}/goals`, docRef.id);
                        setDocumentNonBlocking(goalDoc, { imageUrl: imageResult.imageUrl }, { merge: true });
                    })
                }
            })
            .catch(imageError => {
                console.error("Falha ao gerar imagem da meta, usando placeholder.", imageError);
            });

        const docRef = await docRefPromise;
        return { id: docRef.id, ...newGoalData };
    } catch (serverError) {
        console.error(`[Service Error] addGoal failed for user ${userId}:`, serverError);
        throw serverError;
    }
}


export async function deleteGoal(userId: string, goalId: string): Promise<{ success: boolean }> {
    if (!userId) throw new Error("User not authenticated.");
    const goalDoc = doc(db, `users/${userId}/goals`, goalId);
    
    // Use non-blocking delete
    deleteDocumentNonBlocking(goalDoc);

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
         console.error(`[Service Error] getBudgetLimits failed for user ${userId}:`, serverError);
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

    // Use non-blocking update
    setDocumentNonBlocking(settingsDocRef, dataToSet, { merge: true });

    try {
        const transactions = await getTransactions(userId);
        const spent = transactions
            .filter(t => t.type === 'expense' && t.category === name)
            .reduce((sum, t) => sum + t.amount, 0);

        return { name, budgeted: newLimit, spent };
    } catch (error) {
        console.error("Error fetching transactions after budget update:", error);
        return { name, budgeted: newLimit, spent: 0 }; // Return best guess
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
const sanitizePerformanceValue = (value: number | undefined | null): number => (value === undefined || value === null || isNaN(value)) ? 0 : value;

export const saveRobotPerformance = async (userId: string, performance: EnhancedRobotPerformance[]) => {
  if (!userId) throw new Error("User not authenticated.");
  const docRef = doc(db, 'users', userId, 'trading_data', 'robot_council_performance');
  
  const dataToSave = {
    updatedAt: new Date().toISOString(),
    robots: performance.map(p => {
      return {
        id: p.id,
        strategyType: p.strategyType,
        strategy: p.strategy, 
        wins: sanitizePerformanceValue(p.wins),
        losses: sanitizePerformanceValue(p.losses),
        totalProfit: sanitizePerformanceValue(p.totalProfit),
        winRate: sanitizePerformanceValue(p.winRate),
        sharpeRatio: sanitizePerformanceValue(p.sharpeRatio),
        maxDrawdown: sanitizePerformanceValue(p.maxDrawdown),
        avgWin: sanitizePerformanceValue(p.avgWin),
        avgLoss: sanitizePerformanceValue(p.avgLoss),
        profitFactor: sanitizePerformanceValue(p.profitFactor),
        kellyFraction: sanitizePerformanceValue(p.kellyFraction),
        effectiveRegimes: p.effectiveRegimes || [],
        monteCarloScore: sanitizePerformanceValue(p.monteCarloScore),
        lastUpdated: sanitizePerformanceValue(p.lastUpdated),
        tradeHistory: p.tradeHistory || [],
      }
    })
  };
  
  setDocumentNonBlocking(docRef, dataToSave, { merge: true });
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
    setDocumentNonBlocking(logDocRef, log, { merge: false });
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
        throw serverError;
    }
}
