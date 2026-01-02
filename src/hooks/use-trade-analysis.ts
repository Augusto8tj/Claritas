// src/hooks/use-trade-analysis.ts
'use client';

import { useCallback } from 'react';
import { analyzeOperationsAction } from '@/app/actions/trading-actions';
import type { Operation } from '@/lib/types';
import { useToast } from './use-toast';
import { useDerivApi } from './use-deriv-api';


export function useTradeAnalysis(
    activeSymbol: string | null,
    operationsLog: Operation[],
) {
    const { chartData } = useDerivApi();
    const { toast } = useToast();
    
    const analyzeSessionPerformance = useCallback(async (): Promise<string> => {
        if (!activeSymbol) return "Erro: Nenhum ativo selecionado.";
        
        const closedOperations = operationsLog.filter(op => op.status !== 'pending' && op.asset === activeSymbol);
        if(closedOperations.length === 0) {
            return "Não há operações concluídas suficientes para este ativo na sessão atual para fazer uma análise."
        }

        const response = await analyzeOperationsAction({ operations: closedOperations });
        if (response.success) {
          return response.success;
        }
        return `Erro: ${response.error || 'Falha ao obter análise.'}`;
    }, [operationsLog, activeSymbol]);

    return {
        analyzeSessionPerformance,
    };
}
