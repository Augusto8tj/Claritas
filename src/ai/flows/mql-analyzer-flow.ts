// src/ai/flows/mql-analyzer-flow.ts
'use server';

/**
 * @fileOverview An AI flow for analyzing MQL5 trading bot code and extracting its strategy.
 * Este arquivo agora contém apenas a lógica do prompt e do fluxo, que é exportada
 * para ser usada pela ferramenta `analyzeMqlCodeTool`.
 */

import { ai } from '@/lib/genkit';
import { MqlAnalyzerInputSchema, MqlAnalyzerOutputSchema, type MqlAnalyzerInput } from '@/lib/types';
import { z } from 'zod';

const CONTEXT_WINDOW_LIMIT = 10000; // Character limit, a safe guess for the model's context.

// Helper to chunk text
function chunkText(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.substring(i, i + chunkSize));
    }
    return chunks;
}

// 1. New Prompt to summarize a single chunk of MQL5 code.
const chunkSummarizerPrompt = ai.definePrompt({
    name: 'mqlChunkSummarizerPrompt',
    input: { schema: z.object({ codeChunk: z.string() }) },
    output: { schema: z.object({ summary: z.string() }) },
    system: `You are an expert MQL5 code analyst. Your task is to extract ONLY the core trading logic from the provided code chunk. 
Focus on:
- Indicators being used and their parameters.
- Conditions for buy (Long) or sell (Short) entries.
- Conditions for exiting trades (Take Profit, Stop Loss, Trailing Stop).
- Logic inside OnTick(), OnTrade(), or any custom function that defines trading rules.
Ignore all boilerplate code, includes, variable declarations, or utility functions not directly related to the strategy itself. Provide a concise summary of the logic found. If no relevant logic is found in the chunk, respond with "N/A".`,
    prompt: `Analyze this chunk of MQL5 code and summarize its trading strategy logic:
\'\'\'mql5
{{{codeChunk}}}
\'\'\'
`,
});


// 2. Original prompt for final analysis from a description.
const analyzerPrompt = ai.definePrompt({
  name: 'mqlAnalyzerPrompt',
  input: { schema: MqlAnalyzerInputSchema },
  output: { schema: MqlAnalyzerOutputSchema },
  system: `Você é um analista quantitativo sênior, especialista em traduzir código MQL5 ou descrições de estratégias para um formato claro.
Sua tarefa é analisar o texto fornecido (que pode ser um código MQL5 ou um resumo de um) e descrever a lógica de negociação de forma clara e concisa para que possa ser usada em um sistema de backtesting.
Identifique os seguintes componentes:
1.  **Ativo(s) Alvo:** Qual(is) o(s) símbolo(s) o robô opera.
2.  **Capital Inicial:** Se mencionado, qual o capital inicial sugerido.
3.  **Indicadores Utilizados:** Liste todos os indicadores técnicos (ex: Médias Móveis, RSI, Bandas de Bollinger) e seus parâmetros.
4.  **Condições de Entrada (Compra):** Descreva as regras exatas que disparam uma ordem de compra.
5.  **Condições de Saída (Venda):** Descreva as regras exatas que disparam uma ordem de venda (tanto para Take Profit quanto para Stop Loss ou reversão).
Seja detalhado o suficiente para que outro sistema possa simular a estratégia com base na sua descrição.`,
  prompt: `
Analise o seguinte código/descrição de um robô de investimento MQL5 e descreva sua estratégia em linguagem natural.

Código/Descrição:
\'\'\'
{{{mqlCode}}}
\'\'\'
`
});

const analyzeMqlCodeFlow = ai.defineFlow(
  {
    name: 'analyzeMqlCodeFlow',
    inputSchema: MqlAnalyzerInputSchema,
    outputSchema: MqlAnalyzerOutputSchema,
  },
  async ({ mqlCode }) => {

    let analysisInput = mqlCode;

    // Check if the code exceeds the context window limit to apply map-reduce.
    if (mqlCode.length > CONTEXT_WINDOW_LIMIT) {
        console.log(`[MQL Analyzer] Code is large (${mqlCode.length} chars). Applying Map-Reduce strategy.`);
        
        // MAP: Summarize each chunk in parallel.
        const codeChunks = chunkText(mqlCode, CONTEXT_WINDOW_LIMIT - 500); // Leave buffer for prompt text.
        const summaryPromises = codeChunks.map(chunk => chunkSummarizerPrompt({ codeChunk: chunk }));
        const summaryResults = await Promise.all(summaryPromises);

        const summaries = summaryResults
            .map(r => r.output?.summary)
            .filter((s): s is string => !!s && s.trim().toLowerCase() !== 'n/a');
        
        if (summaries.length === 0) {
            throw new Error("A IA não conseguiu extrair nenhuma lógica de negociação relevante do código fornecido.");
        }

        // REDUCE: Combine summaries into a single context for the final analysis.
        analysisInput = "O seguinte é um resumo da lógica de negociação extraída de um grande arquivo de código MQL5, dividido em partes:\n\n" + summaries.join('\n\n---\n\n');
        console.log("[MQL Analyzer] Combined summaries for final analysis.");
    } else {
        console.log(`[MQL Analyzer] Code is small enough (${mqlCode.length} chars). Analyzing directly.`);
    }

    const { output } = await analyzerPrompt({ mqlCode: analysisInput });
    if (!output) throw new Error("A IA não conseguiu analisar a estratégia do código MQL5.");
    return output;
  }
);

export async function analyzeMqlCode(input: MqlAnalyzerInput) {
    return analyzeMqlCodeFlow(input);
}
