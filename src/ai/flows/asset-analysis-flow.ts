// src/ai/flows/asset-analysis-flow.ts
'use server';

/**
 * @fileOverview An AI flow for analyzing a trading asset and suggesting a trade.
 * Este arquivo agora contém apenas a lógica do prompt e do fluxo, que é exportada
 * para ser usada pela ferramenta `getAssetAnalysisTool`.
 */

import { ai } from '@/lib/genkit';
import { z } from 'zod';
import { AssetAnalysisInputSchema, AssetAnalysisOutputSchema, type AssetAnalysisInput, type AssetAnalysisOutput } from './asset-analysis.types';

const ANALYSIS_PROMPT = `Você é um copiloto de negociação e gestor de risco. Sua tarefa é analisar os dados do ativo, o contexto do trader e fornecer uma sugestão de negociação inteligente e segura.

Contexto do Trader:
- Saldo da Conta (Total): {{{balance}}} {{{currency}}}
- Banca do Dia (Risco Máximo): {{{dailyBalance}}} {{{currency}}}
- Aposta Sugerida (Stake): {{{stake}}} {{{currency}}}
- Duração da Operação: {{{duration}}} {{{durationUnit}}}
- Trades Recentes: {{{recentTrades}}}

Sua Análise deve seguir estes passos:
1.  **Análise Técnica:** Analise os dados de preço recentes para identificar a tendência principal (alta, baixa ou lateral). Esta é sua principal fonte para a direção. Sua análise deve ser proporcional à duração da operação do trader. Para durações curtas (ticks ou segundos), foque nas tendências de curtíssimo prazo nos dados mais recentes. Para durações mais longas (minutos), analise a tendência geral do conjunto de dados.
2.  **Gestão de Risco:**
    - Compare o valor da aposta (stake) com a BANCA DO DIA (dailyBalance). Se a aposta for superior a 5% da banca do dia, considere-a de alto risco.
    - Analise os trades recentes. Se houver uma sequência de 3 ou mais perdas, o trader pode estar a operar emocionalmente.
3.  **Formular a Sugestão:**
    - **Direção (suggestion):** Baseie-se na tendência dos dados de preço. Se a tendência não for clara, sugira 'HOLD'.
    - **Nível de Confiança (confidenceScore):** Calcule um score de 0 a 100. Uma tendência clara e forte com baixo risco deve ter uma confiança alta (>70). Um mercado lateral, volátil ou uma aposta de alto risco devem resultar numa confiança baixa (<50).
    - **Stake Sugerido (suggestedStake):** Se a aposta atual for de alto risco em relação à banca do dia, sugira um valor mais seguro (ex: 2% da banca do dia). Caso contrário, mantenha a aposta atual.
    - **Duração Sugerida (suggestedDuration):** Mantenha a duração atual, a menos que a análise dos dados sugira uma mudança iminente que justifique uma operação mais curta ou mais longa.
    - **Justificativa (justification):** Forneça uma justificativa clara, concisa (máximo 2 frases) que combine a análise técnica com a gestão de risco. Ex: "A tendência de curto prazo é de alta, mas sua aposta é arriscada em relação à sua banca diária. Sugiro reduzir para manter a gestão de risco." ou "Tendência de queda clara nos últimos minutos. A configuração atual parece boa."

Dados de Preço Recentes para o ativo {{{symbol}}} (JSON):
\'\'\'json
{{{historicalData}}}
\'\'\'
`;

const analysisPrompt = ai.definePrompt(
  {
    name: 'assetAnalysisPrompt',
    input: { schema: AssetAnalysisInputSchema },
    output: { schema: AssetAnalysisOutputSchema },
    prompt: ANALYSIS_PROMPT
  },
);

const getAssetAnalysisFlow = ai.defineFlow(
  {
    name: 'getAssetAnalysisFlow',
    inputSchema: AssetAnalysisInputSchema,
    outputSchema: AssetAnalysisOutputSchema,
  },
  async (input) => {
    const { output } = await analysisPrompt(input);

    if (!output) throw new Error("A IA não conseguiu analisar o ativo.");
    
    output.analysisDataPointsCount = input.historicalData.length;
    
    return output;
  }
);

export async function getAssetAnalysis(input: AssetAnalysisInput): Promise<AssetAnalysisOutput> {
    return getAssetAnalysisFlow(input);
}
