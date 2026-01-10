// /src/services/financial-data-service.ts
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, query, where, orderBy, getDoc, addDoc, deleteDoc } from 'firebase/firestore';
import type { Goal, BudgetCategory, Transaction, RobotPerformance, TradeDecisionLog, EnhancedRobotPerformance } from '@/lib/types';
import { generateGoalImage } from '@/ai/flows/goal-image-generation';
import { addDocumentNonBlocking, deleteDocumentNonBlocking, setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { getChatbotInsightsResponse } from '@/app/actions';
import { EvolutionEvent } from '@/features/trading/hooks/use-strategy-evolution';


// ============================================================================
// SANITIZATION HELPER
// ============================================================================

/**
 * Recursively sanitizes an object to be Firestore-compatible.
 * - Removes keys with `undefined` values.
 * - Converts `NaN` values to `null`.
 * This is crucial because Firestore does not support these values.
 * @param obj The object to sanitize.
 * @returns A new, sanitized object.
 */
function sanitizeForFirestore(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'number' && isNaN(obj)) {
      return null;
    }
    return obj;
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirestore(item));
  }

  const newObj: { [key: string]: any } = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (value !== undefined) {
        newObj[key] = sanitizeForFirestore(value);
      }
    }
  }

  return newObj;
}


// --- Transactions ---

export async function getTransactions(userId: string): Promise<Transaction[]> {
    if (!userId) {
        throw new Error("User ID is required.");
    }
    const transactionsCol = collection(db, `users/${userId}/transactions`);
    try {
        const snapshot = await getDocs(transactionsCol);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
    } catch (error) {
        console.error(`[Service Error] getTransactions for user ${userId} failed:`, error);
        throw error; // Re-lança o erro para o chamador tratar
    }
}

export async function addTransaction(userId: string, data: Omit<Transaction, 'id' | 'userId'>): Promise<string> {
    if (!userId) {
        throw new Error("User not authenticated.");
    }
    
    // Adiciona o userId ao corpo do documento para cumprir a regra de segurança.
    const dataWithUser = { ...data, userId };

    const transactionsCol = collection(db, `users/${userId}/transactions`);
    // A escrita agora é não-bloqueante e já lida com o erro de permissão internamente.
    addDocumentNonBlocking(transactionsCol, dataWithUser);
    
    // Retorna uma mensagem de sucesso otimista.
    return `Transação "${data.description}" de R$${data.amount.toFixed(2)} está a ser adicionada.`;
}


// --- Financial Summary ---

export async function getFinancialSummary(userId: string): Promise<{ income: number; expenses: number; balance: number; }> {
   try {
        const transactions = await getTransactions(userId);
        const income = transactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
        const expenses = transactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
        return { income, expenses, balance: income - expenses };
    } catch (error) {
        // Se getTransactions falhar, o erro será propagado.
        // O chamador é responsável por tratar o estado de erro.
        console.error(`[Service Error] getFinancialSummary for user ${userId} failed:`, error);
        throw error;
    }
}

// --- Goals ---

export async function getGoals(userId: string): Promise<Goal[]> {
    if (!userId) {
        throw new Error("User ID is required.");
    }
    const goalsCol = collection(db, `users/${userId}/goals`);
    try {
        const snapshot = await getDocs(goalsCol);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Goal));
    } catch (error) {
        console.error(`[Service Error] getGoals for user ${userId} failed:`, error);
        throw error; // Re-lança o erro para o chamador tratar
    }
}

export async function addGoal(userId: string, name: string, targetAmount: number): Promise<Goal> {
    if (!userId) {
        throw new Error("User not authenticated.");
    }
    const goalsCol = collection(db, `users/${userId}/goals`);
    
    const newGoalData: Omit<Goal, 'id' | 'imageUrl'> & {imageUrl?: string, userId: string} = {
        userId,
        name,
        targetAmount,
        currentAmount: 0,
        imageHint: "new goal"
    };

    const docRef = await addDoc(goalsCol, newGoalData);

    return { 
        id: docRef.id, 
        ...newGoalData, 
        imageUrl: `https://placehold.co/600x400/334155/ffffff.png?text=${encodeURIComponent(name)}` 
    };
}


export async function deleteGoal(userId: string, goalId: string): Promise<{ success: boolean }> {
    if (!userId) {
        throw new Error("User not authenticated.");
    }
    if (!goalId) {
        throw new Error("Goal ID is required.");
    }
    const goalDoc = doc(db, `users/${userId}/goals`, goalId);
    deleteDocumentNonBlocking(goalDoc);
    return { success: true };
}


// --- Budget ---

async function getBudgetLimits(userId: string): Promise<{ [key: string]: number }> {
    if (!userId) {
        throw new Error("User ID is required.");
    }
    const settingsDocRef = doc(db, `users/${userId}/settings/budget`);
    try {
        const docSnap = await getDoc(settingsDocRef);
        if (docSnap.exists()) {
            return docSnap.data().limits || {};
        }
        return {
            "Moradia": 2000, "Alimentação": 1000, "Transporte": 500,
            "Lazer": 400, "Compras": 600, "Outros": 300, "Contas": 800,
        };
    } catch (error) {
         console.error(`[Service Error] getBudgetLimits for user ${userId} failed:`, error);
        throw error;
    }
}

export async function getBudgetData(userId: string): Promise<BudgetCategory[]> {
   try {
    const [transactions, budgetLimits] = await Promise.all([
        getTransactions(userId),
        getBudgetLimits(userId)
    ]);
    
    const expensesByCategory = transactions
      .filter(t => t.type === 'expense')
      .reduce((acc, t) => {
        const category = t.category || "Outros";
        if (!acc[category]) {
            acc[category] = 0;
        }
        acc[category] += t.amount;
        return acc;
      }, {} as { [key: string]: number });
  
    return Object.entries(budgetLimits).map(([name, budgeted]) => ({
      name,
      budgeted,
      spent: expensesByCategory[name] || 0,
    }));
   } catch(error) {
     console.error(`[Service Error] getBudgetData for user ${userId} failed:`, error);
     throw error;
   }
}

export async function updateBudgetLimit(userId: string, name: string, newLimit: number): Promise<BudgetCategory | null> {
    if (!userId) {
        throw new Error("User not authenticated.");
    }
    const settingsDocRef = doc(db, `users/${userId}/settings`, 'budget');
    const dataToSet = { [`limits.${name}`]: newLimit };
    
    setDocumentNonBlocking(settingsDocRef, dataToSet, { merge: true });
    
    try {
        const transactions = await getTransactions(userId);
        const spent = transactions
            .filter(t => t.type === 'expense' && t.category === name)
            .reduce((sum, t) => sum + t.amount, 0);

        return { name, budgeted: newLimit, spent };
    } catch(error) {
        // Se a leitura de transações falhar, ainda retornamos o budget atualizado sem o 'spent'
         return { name, budgeted: newLimit, spent: 0 };
    }
}


export async function getExpenseCategories(userId: string): Promise<string[]> {
   try {
    const limits = await getBudgetLimits(userId);
    return Object.keys(limits);
   } catch (error) {
     console.error(`[Service Error] getExpenseCategories for user ${userId} failed:`, error);
     throw error;
   }
}

// --- General Insights (Dynamic) ---
export async function getFinancialInsights(userId: string): Promise<string[]> {
    if (!userId) {
        throw new Error("User ID is required.");
    }

    try {
        const response = await getChatbotInsightsResponse({
            query: "Me dê 3 insights práticos sobre minhas finanças com base em meu resumo financeiro, cada um em uma frase curta.",
            history: [],
            userId: userId,
        });

        if (response.success) {
            const newInsights = response.success.split('\n').filter(line => line.trim() !== '' && !line.startsWith("Erro:"));
            return newInsights;
        }
        
        console.error("AI Insight Error:", response.error);
        throw new Error(response.error || "Não foi possível gerar insights no momento.");

    } catch (error) {
        console.error("[Service Error] getFinancialInsights failed:", error);
        throw new Error("Erro ao conectar com o serviço de IA.");
    }
}


// --- Trading Robot Performance ---

export async function saveRobotPerformance(userId: string, performance: EnhancedRobotPerformance[]) {
    if (!userId) return;
    
    const docRef = doc(db, 'users', userId, 'trading_data', 'robot_council_performance');
  
    const dataToSave = {
        updatedAt: new Date().toISOString(),
        robots: performance,
    };
    
    const sanitizedData = sanitizeForFirestore(dataToSave);
  
    setDocumentNonBlocking(docRef, sanitizedData, { merge: true });
};


export async function loadRobotPerformance(userId: string): Promise<EnhancedRobotPerformance[] | null> {
  if (!userId) {
    return null;
  }
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
    console.error(`[Service Error] loadRobotPerformance for user ${userId} failed:`, error);
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
        
        return promotedRobots as RobotPerformance[];
    } catch(error) {
        console.error(`[Service Error] getHallOfFame for user ${userId} failed:`, error);
        throw error;
    }
}

// --- Trading Decision Log ---

export async function saveTradeDecision(userId: string, log: TradeDecisionLog) {
    if (!userId) {
        return;
    }
    const logCollectionRef = collection(db, 'users', userId, 'decision_logs');
    const logDocRef = doc(logCollectionRef, log.id);
    
    const sanitizedLog = sanitizeForFirestore(log);

    setDocumentNonBlocking(logDocRef, sanitizedLog, { merge: true });
}

export async function getTradeDecisionLogs(userId: string): Promise<TradeDecisionLog[]> {
    if (!userId) {
        return [];
    }
    const logCollectionRef = collection(db, `users/${userId}/decision_logs`);
    const q = query(logCollectionRef, orderBy('timestamp', 'desc')); // Ordena por mais recente
    try {
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => d.data() as TradeDecisionLog);
    } catch (error) {
        console.error(`[Service Error] getTradeDecisionLogs for user ${userId} failed:`, error);
        return []; // Retorna um array vazio em caso de erro para não quebrar a UI
    }
}

// --- Evolution History ---

export async function saveEvolutionHistory(userId: string, history: EvolutionEvent[]) {
    if (!userId || !history) return;
    const docRef = doc(db, 'users', userId, 'trading_data', 'evolution_history');
    
    const sanitizedHistory = sanitizeForFirestore(history);

    setDocumentNonBlocking(docRef, { history: sanitizedHistory }, { merge: true });
}

export async function loadEvolutionHistory(userId: string): Promise<EvolutionEvent[]> {
    if (!userId) return [];
    
    const docRef = doc(db, 'users', userId, 'trading_data', 'evolution_history');
    try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            // Firestore armazena timestamps como objetos, precisamos converter de volta para Date
            const history = (data.history || []).map((event: any) => ({
                ...event,
                timestamp: new Date(event.timestamp)
            }));
            return history;
        }
        return [];
    } catch (error) {
        console.error(`[Service Error] loadEvolutionHistory for user ${userId} failed:`, error);
        return []; // Retorna array vazio em caso de erro
    }
}
