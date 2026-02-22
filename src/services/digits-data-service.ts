// src/services/digits-data-service.ts
'use client';

/**
 * @fileOverview Serviço de dados para armazenamento e recuperação
 * de ticks históricos para estratégias de dígitos.
 */

import { db } from '@/lib/firebase';
import { collection, addDoc, query, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';
import { sanitizeForFirestore } from './utils/sanitize-for-firestore';

export interface HistoricalTick {
  timestamp: number;
  price: number;
}

/**
 * Salva um tick de preço no Firestore.
 * A função é projetada para ser chamada de forma não bloqueante.
 * @param userId - O ID do usuário.
 * @param symbol - O símbolo do ativo.
 * @param tick - O objeto de tick a ser salvo.
 */
export function saveLiveTickForDigits(userId: string, symbol: string, tick: HistoricalTick): void {
  if (!userId || !symbol) return;
  
  // Usamos o timestamp como ID para ordenação natural e para evitar duplicatas em escritas rápidas.
  const tickWithTimestamp = { ...tick, createdAt: Timestamp.fromDate(new Date(tick.timestamp * 1000)) };
  const docRef = collection(db, 'users', userId, 'digits_ticks', symbol, 'ticks');

  // Adiciona o documento. Em caso de erro de permissão, ele será capturado globalmente.
  // Não bloqueamos a execução principal para esperar a escrita.
  addDoc(docRef, sanitizeForFirestore(tickWithTimestamp)).catch(err => {
    // Erros de escrita (ex: offline) são logados mas não interrompem o fluxo da UI.
    console.warn(`[DigitsDataService] Falha ao salvar tick: ${err.message}`);
  });
}

/**
 * Carrega os ticks históricos do Firestore para um determinado ativo.
 * @param userId - O ID do usuário.
 * @param symbol - O símbolo do ativo.
 * @param options - Opções de consulta como 'limit'.
 * @returns Uma Promise com um array de HistoricalTick.
 */
export async function loadHistoricalTicksForDigits(
  userId: string,
  symbol: string,
  options: { limit?: number } = {}
): Promise<HistoricalTick[]> {
  if (!userId || !symbol) {
    console.error('[DigitsDataService] Faltando userId ou symbol para carregar ticks.');
    return [];
  }

  const { limit: queryLimit = 1000 } = options;
  const ticksColRef = collection(db, 'users', userId, 'digits_ticks', symbol, 'ticks');
  const q = query(ticksColRef, orderBy('createdAt', 'desc'), limit(queryLimit));
  
  try {
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      return [];
    }
    
    // Os documentos são retornados em ordem decrescente, então revertemos para ter a ordem cronológica correta.
    return snapshot.docs.map(doc => doc.data() as HistoricalTick).reverse();
  } catch (error) {
    console.error(`[DigitsDataService] Erro ao carregar ticks para ${symbol}:`, error);
    // Em um app de produção, você poderia emitir um erro aqui para o sistema de logging.
    return [];
  }
}
