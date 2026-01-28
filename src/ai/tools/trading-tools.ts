// src/features/trading/ai/tools/trading-tools.ts
'use server';

/**
 * @fileOverview Ferramentas de IA relacionadas a Trading.
 * Converte os fluxos de análise de trading em ferramentas que o chatbot pode usar.
 */
import { ai } from '@/lib/genkit';
import { z } from 'zod';
import { getAssetAnalysis } from '@/ai/flows/asset-analysis-flow';
import { analyzeMqlCode } from '@/ai/flows/mql-analyzer-flow';
import { analyzeOperations } from '@/ai/flows/operation-analysis-flow';
import { AssetAnalysisOutputSchema } from '@/ai/flows/asset-analysis.types';
import {
  MqlAnalyzerInputSchema,
  MqlAnalyzerOutputSchema,
  OperationAnalysisOutputSchema,
  OperationAnalysisInputSchema,
} from '@/lib/types';
import { getDerivApiDataForAnalysis } from '@/services/deriv-data-service';

// Ferramenta para resumo geral do mercado (mantida como estava)
const marketDataPrompt = ai.definePrompt({
  name: 'marketDataPrompt',
  input: { schema: z.object({ query: z.string() }) },
  output: { schema: z.object({ summary: z.string() }) },
  prompt: `Você é um analista financeiro. Com base na pergunta do usuário, forneça um resumo conciso do estado atual do mercado financeiro ou do ativo específico mencionado. Inclua índices importantes como IBOVESPA, se relevante.

Pergunta: {{{query}}}
`,
});

export const getMarketDataTool = ai.defineTool(
  {
    name: 'getMarketDataTool',
    description: 'Obtém um resumo do mercado financeiro ou dados de um ativo específico (ex: preço). Use para perguntas como "como está o mercado hoje?" ou "qual a cotação de PETR4?".',
    inputSchema: z.object({
      query: z.string().describe('A pergunta do usuário sobre o mercado financeiro ou um ativo.'),
    }),
    outputSchema: z.object({
      summary: z.string(),
    }),
  },
  async ({ query }) => {
    console.log(`[getMarketDataTool] Gerando resumo para a consulta: "${query}"`);
    const { output } = await marketDataPrompt({ query });
    if (!output) throw new Error("Não foi possível gerar um resumo do mercado.");
    return output;
  }
);


// Ferramenta para análise de ativos (substitui o fluxo antigo)
export const getAssetAnalysisTool = ai.defineTool(
  {
    name: 'getAssetAnalysisTool',
    description: 'Executa uma análise técnica e de risco sobre um ativo de negociação específico. Use para perguntas como "analise o Volatility 100 Index" ou "qual sua sugestão para o EUR/USD?".',
    inputSchema: z.object({
      symbol: z.string().describe("O símbolo do ativo a ser analisado, ex: '1HZ10V' ou 'EUR/USD'. Se não for fornecido, deve usar o ativo atualmente ativo."),
    }),
    outputSchema: AssetAnalysisOutputSchema,
  },
  async ({ symbol }, options) => {
    const userId = options?.context?.userId;
    if (!userId) throw new Error("ID do usuário é necessário para obter dados da API Deriv.");
    
    const analysisData = await getDerivApiDataForAnalysis(userId, symbol);

    if (!analysisData) {
      throw new Error(`Não foi possível obter os dados de negociação para o ativo ${symbol}.`);
    }
    
    return getAssetAnalysis(analysisData);
  }
);

// Ferramenta para analisar código MQL5
export const analyzeMqlCodeTool = ai.defineTool(
  {
    name: 'analyzeMqlCodeTool',
    description: 'Analisa um bloco de código MQL5 e extrai a descrição da estratégia de negociação. Use quando o usuário colar um código e pedir para analisá-lo.',
    inputSchema: MqlAnalyzerInputSchema,
    outputSchema: MqlAnalyzerOutputSchema,
  },
  async (input) => {
    return analyzeMqlCode(input);
  }
);

// Ferramenta para analisar o desempenho de operações de trading
export const analyzeOperationsTool = ai.defineTool(
  {
    name: 'analyzeOperationsTool',
    description: 'Analisa o histórico de operações de trading de uma sessão para um determinado ativo e fornece um resumo de desempenho.',
    inputSchema: z.object({
        symbol: z.string().optional().describe("O símbolo do ativo para analisar. Se omitido, analisa todos os ativos da sessão."),
    }),
    outputSchema: OperationAnalysisOutputSchema,
  },
  async ({ symbol }, options) => {
    const userId = options?.context?.userId;
    if (!userId) throw new Error("ID do usuário é necessário para obter o histórico de operações.");

    const apiData = await getDerivApiDataForAnalysis(userId, symbol || '');
    if (!apiData) throw new Error("Não foi possível obter o histórico de operações.");

    const operationsToAnalyze = symbol
        ? apiData.recentTrades.filter(op => op.asset === symbol)
        : apiData.recentTrades;

    if (operationsToAnalyze.length === 0) {
        return { analysis: "Não há operações concluídas para analisar na sessão atual para o filtro especificado." };
    }

    return analyzeOperations({ operations: operationsToAnalyze });
  }
);
