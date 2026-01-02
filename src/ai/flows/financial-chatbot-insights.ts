// src/ai/flows/financial-chatbot-insights.ts
'use server';

/**
 * @fileOverview An AI-powered chatbot that can use tools to access and modify financial data.
 *
 * - financialChatbotInsights - A function that handles the chatbot interaction.
 */

import {ai} from '@/lib/genkit';
// Ferramentas para acessar dados internos do aplicativo (orçamento, transações, etc.)
import { getFinancialInsightsTool, getFinancialSummaryTool, addTransactionTool, addGoalTool, getBudgetStatusTool } from '@/ai/tools/financial-tools';
// Ferramentas para acessar dados externos do mercado financeiro (cotações de ações, etc.)
import { getMarketDataTool } from '@/ai/tools/trading-tools';
import { FinancialChatbotInsightsInputSchema, FinancialChatbotInsightsOutputSchema, type FinancialChatbotInsightsInput } from '@/lib/types';


const prompt = ai.definePrompt({
  name: 'financialChatbotInsightsPrompt',
  // O input do prompt agora não inclui mais o userId.
  input: {schema: FinancialChatbotInsightsInputSchema.omit({ userId: true })},
  output: {schema: FinancialChatbotInsightsOutputSchema},
  // A IA decide qual ferramenta usar com base na pergunta do usuário.
  tools: [
    // Ferramentas para dados internos:
    getFinancialSummaryTool, 
    getFinancialInsightsTool, 
    addTransactionTool, 
    addGoalTool, 
    getBudgetStatusTool, 
    // Ferramenta para dados externos:
    getMarketDataTool
  ],
  system: `Você é a Claritas, uma assistente de IA prestativa e especialista em finanças.
- Você SEMPRE receberá um 'userId' em cada chamada de ferramenta. Você DEVE passar este 'userId' para qualquer ferramenta que o exija.
- Se a pergunta do usuário for sobre seus dados financeiros, orçamento, metas, transações ou o mercado financeiro, use as ferramentas disponíveis para obter as informações necessárias e fornecer uma resposta completa.
- Se nenhuma ferramenta se aplicar à pergunta, responda usando seu conhecimento geral.
- Você pode adicionar transações ou metas a pedido do usuário.
- Seja sempre prestativa, clara e use o português do Brasil. Ao fornecer dados de mercado, sempre inclua o ticker (se aplicável) e o valor formatado como moeda (R$).`,
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
    inputSchema: FinancialChatbotInsightsInputSchema,
    outputSchema: FinancialChatbotInsightsOutputSchema,
  },
  async (input) => {
    // Separa o userId do resto do input para passá-lo ao contexto das ferramentas
    const { userId, ...promptData } = input;
    
    // Passa o promptData (sem userId) como input principal do prompt
    // e o userId separadamente para o contexto das ferramentas.
    const { output } = await prompt(promptData, { data: { userId }});
    
    if (!output) {
        throw new Error("A IA não conseguiu gerar uma resposta.");
    }
    
    return output;
  }
);

export async function financialChatbotInsights(input: FinancialChatbotInsightsInput) {
  return financialChatbotInsightsFlow(input);
}
