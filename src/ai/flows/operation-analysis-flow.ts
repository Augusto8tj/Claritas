// src/ai/flows/operation-analysis-flow.ts
'use server';

/**
 * @fileOverview An AI flow for analyzing a user's trading operations history.
 * Este arquivo agora contém apenas a lógica do prompt e do fluxo, que é exportada
 * para ser usada pela ferramenta `analyzeOperationsTool`.
 */

import { ai } from '@/lib/genkit';
import { z } from 'zod';
import { OperationAnalysisInputSchema, OperationAnalysisOutputSchema, type OperationAnalysisInput } from '@/lib/types';

const analyzerPrompt = ai.definePrompt({
  name: 'operationAnalyzerPrompt',
  input: { schema: z.object({ operationsJson: z.string() }) },
  output: { schema: OperationAnalysisOutputSchema },
  system: `Você é um analista de performance e risco, especialista em mercado financeiro. Sua tarefa é analisar um histórico de operações de trading e fornecer um resumo estatístico e insights valiosos em português.
Seja conciso e direto.

Calcule e apresente os seguintes pontos:
1.  **Resumo Geral:** Total de operações, total de ganhos (won), total de perdas (lost).
2.  **Taxa de Acerto (Win Rate):** A porcentagem de operações vencedoras.
3.  **Resultado Financeiro:** O lucro ou prejuízo líquido total.
4.  **Payoff Ratio:** A razão entre o lucro médio das operações vencedoras e o prejuízo médio das operações perdedoras.
5.  **Conclusão:** Uma ou duas frases com um insight ou conselho prático com base nos dados (ex: "Sua taxa de acerto é boa, mas suas perdas são maiores que seus ganhos, sugerindo que você pode precisar gerenciar melhor seus stops." ou "Seu desempenho é positivo, continue assim!").

Se não houver operações concluídas, informe que não há dados suficientes para a análise.`,
  prompt: `
Por favor, analise o seguinte histórico de operações de trading da sessão atual:

\'\'\'json
{{{operationsJson}}}
\'\'\'
`
});

const analyzeOperationsFlow = ai.defineFlow(
  {
    name: 'analyzeOperationsFlow',
    inputSchema: OperationAnalysisInputSchema,
    outputSchema: OperationAnalysisOutputSchema,
  },
  async ({ operations }) => {
    // Converte o array de operações para uma string JSON antes de passar para o prompt.
    const operationsJson = JSON.stringify(operations, null, 2);

    const { output } = await analyzerPrompt({ operationsJson });
    if (!output) throw new Error("A IA não conseguiu analisar o histórico de operações.");
    return output;
  }
);

export async function analyzeOperations(input: OperationAnalysisInput) {
    return analyzeOperationsFlow(input);
}
