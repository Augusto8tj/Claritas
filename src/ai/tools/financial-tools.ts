// src/ai/tools/financial-tools.ts
'use server';
/**
 * @fileOverview Defines the tools available to the financial AI chatbot.
 */

import { ai } from '@/lib/genkit';
import { addGoal, getFinancialSummary, getBudgetData } from '@/services/financial-data-service';
import { addTransaction as addTransactionAction } from '@/app/actions/transaction-actions';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

const userIdSchema = z.string().describe("The unique identifier of the user.");

export const getFinancialSummaryTool = ai.defineTool(
  {
    name: 'getFinancialSummaryTool',
    description: 'Obtém um resumo em texto dos dados financeiros do usuário, incluindo renda, despesas e saldo.',
    inputSchema: z.object({}), // O input da IA pode ser vazio
    outputSchema: z.string().describe("Uma frase resumindo a renda, despesas e saldo do usuário."),
  },
  // O `userId` agora vem do contexto (`data`) e não do input da IA.
  async (_, { userId }) => {
    console.log(`getFinancialSummaryTool foi chamada para o usuário ${userId}`);
    const summary = await getFinancialSummary(userId);
    return `Seu resumo financeiro é: Renda de R$${summary.income.toFixed(2)}, Despesas de R$${summary.expenses.toFixed(2)}, resultando num saldo de R$${summary.balance.toFixed(2)}.`;
  }
);

const FinancialInsightsOutputSchema = z.object({
  insights: z.array(z.string()).describe('Array of personalized financial insights.'),
});

const insightsPrompt = ai.definePrompt({
  name: 'financialInsightsToolPrompt',
  input: { schema: z.object({ financialData: z.string() }) },
  output: { schema: FinancialInsightsOutputSchema },
  prompt: `Você é um consultor financeiro de IA. Analise os seguintes dados financeiros e forneça 3 sugestões práticas e perspicazes para melhorar o bem-estar financeiro do usuário. Cada sugestão deve ter no máximo duas frases.

Dados Financeiros: {{{financialData}}}
`,
});

export const getFinancialInsightsTool = ai.defineTool(
  {
    name: 'getFinancialInsightsTool',
    description: 'Gera e retorna insights e conselhos financeiros acionáveis com base nos dados do usuário.',
    inputSchema: z.object({}),
    outputSchema: z.string().describe('Uma string contendo os insights financeiros, separados por quebras de linha.'),
  },
  async (_, { userId }) => {
    console.log(`getFinancialInsightsTool foi chamada para o usuário ${userId}`);
    const financialData = await getFinancialSummary(userId);
    const financialDataString = `Renda: ${financialData.income}, Despesas: ${financialData.expenses}, Saldo: ${financialData.balance}`;
    
    const { output } = await insightsPrompt({ financialData: financialDataString });
    if (!output) return 'Não foi possível gerar insights no momento.';
    return output.insights.join('\n');
  }
);

export const addTransactionTool = ai.defineTool(
  {
    name: 'addTransactionTool',
    description: 'Adiciona uma nova transação (receita ou despesa) aos registros financeiros.',
    inputSchema: z.object({
      description: z.string().describe('A descrição da transação.'),
      amount: z.number().describe('O valor da transação.'),
      type: z.enum(['income', 'expense']).describe('O tipo da transação: "income" para receita, "expense" para despesa.'),
      category: z.string().describe('A categoria da transação (ex: "Alimentação", "Transporte").'),
    }),
    outputSchema: z.string(),
  },
  async (input, { userId }) => {
    // Chama a server action, que por sua vez chama o serviço não-bloqueante
    const result = await addTransactionAction({
      userId,
      ...input,
      date: new Date().toISOString(), // A data é gerada no momento da chamada
    });
    
    if (result.error) {
        // Se a server action retornar um erro (ex: validação), informa a IA.
        return `Falha ao adicionar transação: ${JSON.stringify(result.error)}`;
    }
    
    // Confirmação para a IA. A revalidação já acontece na server action.
    return `Transação "${input.description}" de R$${input.amount} adicionada com sucesso.`;
  }
);

export const addGoalTool = ai.defineTool(
  {
    name: 'addGoalTool',
    description: 'Adiciona uma nova meta financeira.',
    inputSchema: z.object({
      name: z.string().describe('O nome da meta.'),
      targetAmount: z.number().describe('O valor alvo da meta.'),
    }),
    outputSchema: z.string(),
  },
  async ({ name, targetAmount }, { userId }) => {
    const newGoal = await addGoal(userId, name, targetAmount);
    revalidatePath('/goals');
    revalidatePath('/');
    return `Meta "${newGoal.name}" adicionada com sucesso.`;
  }
);

const BudgetStatusSchema = z.array(
    z.object({
        name: z.string().describe("O nome da categoria do orçamento."),
        budgeted: z.number().describe("O valor total orçado para a categoria."),
        spent: z.number().describe("O valor gasto até agora na categoria."),
    })
);

export const getBudgetStatusTool = ai.defineTool(
    {
        name: 'getBudgetStatusTool',
        description: 'Obtém o status atual do orçamento, mostrando os valores orçados e gastos para cada categoria.',
        inputSchema: z.object({}),
        outputSchema: BudgetStatusSchema,
    },
    async (_, { userId }) => {
        console.log(`getBudgetStatusTool foi chamada para o usuário ${userId}`);
        return getBudgetData(userId);
    }
);
