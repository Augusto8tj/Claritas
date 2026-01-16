// Service module for financial data operations.
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, setDoc, query, where, orderBy, getDoc, addDoc, deleteDoc } from 'firebase/firestore';
import type { Goal, BudgetCategory, Transaction, RobotPerformance, TradeDecisionLog, EnhancedRobotPerformance } from '@/lib/types';
import { generateGoalImage } from '@/ai/flows/goal-image-generation';
import { addDocumentNonBlocking, deleteDocumentNonBlocking, setDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { getChatbotInsightsResponse } from '@/app/actions';
import { EvolutionEvent } from '@/features/trading/hooks/use-strategy-evolution-v2';
import { sanitizeForFirestore } from './utils/sanitize-for-firestore';
import { errorEmitter, FirestorePermissionError } from '@/firebase';


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
            // A resposta da IA pode vir com marcadores de lista ou numeração. Limpamos isso.
            const newInsights = response.success
                .split('\n')
                .map(line => line.replace(/^[-\d.\s]*/, '').trim()) // Remove marcadores
                .filter(line => line.length > 10); // Filtra linhas vazias ou muito curtas
            
            return newInsights.length > 0 ? newInsights : [response.success];
        }
        
        console.error("AI Insight Error:", response.error);
        throw new Error(response.error || "Não foi possível gerar insights no momento.");

    } catch (error) {
        console.error("[Service Error] getFinancialInsights failed:", error);
        throw new Error("Erro ao conectar com o serviço de IA.");
    }
}


// --- TRADING SERVICES (Version-Aware) ---

type PerformanceData = RobotPerformance | EnhancedRobotPerformance;
type Version = 'v1' | 'v2' | 'v3';

export async function saveRobotPerformance(
    userId: string, 
    performance: PerformanceData[], 
    version: Version
): Promise<void> {
    if (!userId) return;
    const docRef = doc(db, 'users', userId, `performance_${version}`, 'robot_council');
    const sanitizedData = sanitizeForFirestore({
        updatedAt: new Date().toISOString(),
        data: performance, // Use um nome de campo genérico
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

export async function loadRobotPerformance(userId: string, version: Version): Promise<PerformanceData[] | null> {
  if (!userId) return null;
  const docRef = doc(db, 'users', userId, `performance_${version}`, 'robot_council');
  try {
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      return (data.data || []).map((robot: any) => ({
        ...robot,
        tradeHistory: robot.tradeHistory || [],
      }));
    }
    return null;
  } catch (error) {
    console.error(`[Service Error ${version}] loadRobotPerformance for user ${userId} failed:`, error);
    throw error;
  }
};

export async function saveTradeDecision(userId: string, log: TradeDecisionLog, version: 'v1' | 'v2' = 'v2') {
    if (!userId) return;
    const collectionName = `decision_logs_${version}`;
    const logCollectionRef = collection(db, 'users', userId, collectionName);
    const logDocRef = doc(logCollectionRef, log.id);
    const sanitizedLog = sanitizeForFirestore(log);
    setDocumentNonBlocking(logDocRef, sanitizedLog, { merge: true });
}

export async function getTradeDecisionLogs(userId: string, version: 'v1' | 'v2' = 'v2'): Promise<TradeDecisionLog[]> {
    if (!userId) {
        return [];
    }
    const collectionName = `decision_logs_${version}`;
    const logCollectionRef = collection(db, `users/${userId}/${collectionName}`);
    const q = query(logCollectionRef, orderBy('timestamp', 'desc')); // Ordena por mais recente
    try {
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => d.data() as TradeDecisionLog);
    } catch (error) {
        console.error(`[Service Error] getTradeDecisionLogs for user ${userId} (version ${version}) failed:`, error);
        return []; // Retorna um array vazio em caso de erro para não quebrar a UI
    }
}

// --- Evolution History (Version-Aware) ---

export async function saveEvolutionHistory(userId: string, history: EvolutionEvent[], version: 'v2' | 'v3' = 'v2'): Promise<void> {
    if (!userId || !history) return;

    const collectionName = `evolution_${version}`;
    const docRef = doc(db, 'users', userId, collectionName, 'history');

    try {
        const historyForFirestore = history.map(event => ({
            ...event,
            timestamp: event.timestamp.toISOString(),
        }));

        const sanitizedHistory = sanitizeForFirestore({ history: historyForFirestore });

        await setDoc(docRef, sanitizedHistory, { merge: true });

    } catch (error) {
        console.error(`❌ [saveEvolutionHistory ${version}] Erro ao gravar no Firestore:`, error);
        throw new Error(`Falha ao salvar o histórico de evolução ${version}.`);
    }
}

export async function loadEvolutionHistory(userId: string, version: 'v2' | 'v3' = 'v2'): Promise<EvolutionEvent[]> {
    if (!userId) return [];
    
    const collectionName = `evolution_${version}`;
    const docRef = doc(db, 'users', userId, collectionName, 'history');
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
        console.error(`[Service Error] loadEvolutionHistory ${version} for user ${userId} failed:`, error);
        return [];
    }
}

export async function clearEvolutionHistory(userId: string, version: 'v2' | 'v3' = 'v2'): Promise<void> {
    if (!userId) return;
    const docRef = doc(db, 'users', userId, `evolution_${version}`, 'history');
    await deleteDoc(docRef);
}

export async function deleteEvolutionEvent(userId: string, eventTimestamp: string, version: 'v2' | 'v3' = 'v2'): Promise<void> {
    if (!userId) return;
    
    const currentHistory = await loadEvolutionHistory(userId, version);
    const newHistory = currentHistory.filter(event => event.timestamp.toISOString() !== eventTimestamp);
    
    if (newHistory.length < currentHistory.length) {
        await saveEvolutionHistory(userId, newHistory, version);
    }
}
