// src/ai/flows/financial-chatbot-insights.ts
'use server';

/**
 * @fileOverview O Cérebro Central do Claritas Copilot.
 * Este fluxo de IA age como um orquestrador, utilizando um conjunto de ferramentas
 * para analisar dados financeiros, de trading e responder a perguntas do utilizador.
 */

import { ai } from '@/lib/genkit';
import { z } from 'zod';
import {
  financialChatbotInsightsInputSchema,
  financialChatbotInsightsOutputSchema,
  type FinancialChatbotInsightsInput,
} from '@/lib/types';

// Importa todas as ferramentas disponíveis para a IA.
import {
  getFinancialSummaryTool,
  getFinancialInsightsTool,
  addTransactionTool,
  addGoalTool,
  getBudgetStatusTool,
  getAssetAnalysisTool,
  analyzeMqlCodeTool,
  analyzeOperationsTool,
  getMarketDataTool,
} from '@/ai/tools';


const prompt = ai.definePrompt({
  name: 'financialChatbotInsightsPrompt',
  input: { schema: financialChatbotInsightsInputSchema },
  output: { schema: financialChatbotInsightsOutputSchema },
  // A IA decide qual ferramenta usar com base na pergunta do usuário.
  tools: [
    // Ferramentas Financeiras
    getFinancialSummaryTool,
    getFinancialInsightsTool,
    addTransactionTool,
    addGoalTool,
    getBudgetStatusTool,
    // Ferramentas de Trading
    getAssetAnalysisTool,
    analyzeMqlCodeTool,
    analyzeOperationsTool,
    getMarketDataTool,
  ],
  system: `Você é a Claritas, uma assistente de IA especialista em finanças e trading para o app Claritas Copilot.
- Você SEMPRE receberá um 'userId' em cada chamada de ferramenta. Você DEVE passar este 'userId' para qualquer ferramenta que o exija.
- Use as ferramentas disponíveis para responder a perguntas sobre os dados financeiros do usuário (orçamento, metas, transações), análises de trading (desempenho de operações, análise de ativos, código MQL) ou sobre o mercado financeiro.
- Se nenhuma ferramenta se aplicar, responda usando seu conhecimento geral.
- Seja sempre prestativa, clara e use o português do Brasil. Ao fornecer dados, formate-os de maneira legível.`,
  prompt: `Histórico da Conversa:
{{#each history}}
- {{role}}: {{content}}
{{/each}}

Nova Pergunta do Usuário: {{{query}}}
`,
});

const financialChatbotInsightsFlow = ai.defineFlow(
  {
    name: 'financialChatbotInsightsFlow',
    inputSchema: financialChatbotInsightsInputSchema.extend({
      userId: z.string().describe("The user's unique ID."),
    }),
    outputSchema: financialChatbotInsightsOutputSchema,
  },
  async (input) => {
    const { userId, ...promptData } = input;

    const { output } = await prompt(promptData, { data: { userId } });

    if (!output) {
      throw new Error("A IA não conseguiu gerar uma resposta.");
    }

    return output;
  }
);

export async function financialChatbotInsights(input: FinancialChatbotInsightsInput & { userId: string }) {
  return financialChatbotInsightsFlow(input);
}
