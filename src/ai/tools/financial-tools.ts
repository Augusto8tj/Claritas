// src/ai/tools/financial-tools.ts
'use server';
/**
 * @fileOverview Defines the tools available to the financial AI chatbot.
 */

import { ai } from '@/lib/genkit';
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
  async (_, options) => { 
    // Em um app real, o cliente buscaria os dados e os passaria para a IA.
    // Como esta é uma ferramenta de servidor, ela não pode acessar o 'financial-data-service' do cliente.
    // Retornamos dados de exemplo para manter a funcionalidade.
    const summary = { income: 5000, expenses: 2500, balance: 2500 };
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
  async (_, options) => {
    // Simulando a obtenção de dados, pois esta ferramenta de servidor não pode chamar serviços do cliente.
    const financialData = { income: 5000, expenses: 2500, balance: 2500 };
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
  async (input, options) => {
    return `[FUNCIONALIDADE DESATIVADA] A adição de transações via chat foi desativada. Por favor, use a interface do aplicativo na página de 'Análise de Despesas' para adicionar transações.`;
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
  async ({ name, targetAmount }, options) => {
    return `[FUNCIONALIDADE DESATIVADA] A adição de metas via chat foi desativada. Por favor, use o botão "Adicionar Nova Meta" na página de 'Metas'.`;
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
    async (_, options) => {
        // Simulando a obtenção de dados, pois esta ferramenta de servidor não pode chamar serviços do cliente.
        return [
            { name: "Alimentação", budgeted: 1000, spent: 300 },
            { name: "Transporte", budgeted: 500, spent: 150 },
            { name: "Lazer", budgeted: 400, spent: 250 },
        ];
    }
);
