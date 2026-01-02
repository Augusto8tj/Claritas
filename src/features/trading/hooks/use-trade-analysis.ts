// src/features/trading/hooks/use-trade-analysis.ts
'use client';

import { useCallback } from 'react';
import type { Operation } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useDerivApi } from '@/features/trading/hooks/use-deriv-api';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { getChatbotInsightsResponse } from '@/app/actions';


export function useTradeAnalysis(
    activeSymbol: string | null,
    operationsLog: Operation[],
) {
    const { user } = useAuth();
    const { chartData } = useDerivApi();
    const { toast } = useToast();
    
    const analyzeSessionPerformance = useCallback(async (): Promise<string> => {
        if (!activeSymbol || !user) return "Erro: Nenhum ativo ou usuário selecionado.";
        
        const closedOperations = operationsLog.filter(op => op.status !== 'pending' && op.asset === activeSymbol);
        if(closedOperations.length === 0) {
            return "Não há operações concluídas suficientes para este ativo na sessão atual para fazer uma análise."
        }

        const query = `Analise o seguinte histórico de operações: ${JSON.stringify(closedOperations)}. Inclua taxa de acerto, P&L e uma conclusão.`;
        const response = await getChatbotInsightsResponse({ 
            query,
            history: [],
            userId: user.uid,
        });

        if (response.success) {
          return response.success;
        }
        return `Erro: ${response.error || 'Falha ao obter análise.'}`;
    }, [operationsLog, activeSymbol, user]);

    return {
        analyzeSessionPerformance,
    };
}
