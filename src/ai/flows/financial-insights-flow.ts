'use server';

import { ai } from '@/lib/genkit';
import { z } from 'zod';
import { FinancialInsightsInputSchema, FinancialInsightsOutputSchema, type FinancialInsightsInput } from '@/ai/flows/financial-insights.types';

const insightsPrompt = ai.definePrompt({
  name: 'financialInsightsPrompt',
  input: { schema: FinancialInsightsInputSchema.pick({ financialData: true }) },
  output: { schema: FinancialInsightsOutputSchema },
  system: `Você é um consultor financeiro de IA. Analise os seguintes dados financeiros e forneça 3 sugestões práticas e perspicazes para melhorar o bem-estar financeiro do usuário. Cada sugestão deve ter no máximo duas frases.

Dados Financeiros: {{{financialData}}}`,
});

const financialInsightsFlow = ai.defineFlow({
    name: 'financialInsightsFlow',
    inputSchema: z.object({ financialData: z.string() }),
    outputSchema: FinancialInsightsOutputSchema,
}, async ({ financialData }) => {
    const { output } = await insightsPrompt({ financialData });
    if (!output) {
        throw new Error("A IA não conseguiu gerar insights.");
    }
    return output;
});

export async function generateFinancialInsights(financialData: string) {
    const result = await financialInsightsFlow({ financialData });
    return result.insights;
}
