// /src/services/deriv-data-service.ts
'use server';

/**
 * @fileOverview Um serviço de dados do lado do servidor para obter informações
 * consolidadas que são necessárias para as ferramentas de IA de trading.
 * Este serviço NÃO mantém uma conexão WebSocket. Ele atua como um
 * ponto de coleta de dados de outras fontes. Em um aplicativo real e complexo,
 * isso poderia se conectar a um cache (como Redis) ou a um banco de dados
 * que é atualizado pelo hook `useDerivApi`.
 *
 * Para este protótipo, simularemos a obtenção desses dados.
 */

import { AssetAnalysisInput, Operation } from '@/lib/types';
import { getFinancialSummary } from './financial-data-service';

// Mock/simulação de uma fonte de dados de trading.
// Em um app real, isso viria do estado mantido pelo `useDerivApi`.
const MOCK_TRADING_DATA: { [key: string]: { recentTrades: Operation[], chartData: any[] } } = {
  'default': {
    recentTrades: [],
    chartData: Array.from({ length: 100 }, (_, i) => ({
      date: new Date(Date.now() - (100 - i) * 60000).toISOString(),
      price: 100 + Math.sin(i / 10) * 5 + (Math.random() - 0.5) * 2,
    })),
  },
};

/**
 * Obtém todos os dados necessários para a ferramenta de análise de ativos.
 *
 * @param userId O ID do usuário para buscar dados financeiros.
 * @param symbol O símbolo do ativo de negociação.
 * @returns Um objeto `AssetAnalysisInput` ou `null` se os dados não puderem ser encontrados.
 */
export async function getDerivApiDataForAnalysis(
  userId: string,
  symbol: string
): Promise<AssetAnalysisInput | null> {
  try {
    // 1. Obter dados financeiros (como saldo)
    // Em um app real, o saldo da conta de trading viria da API Deriv,
    // mas aqui vamos simular usando o saldo financeiro geral.
    const financialSummary = await getFinancialSummary(userId);

    // 2. Obter dados de trading (simulados por enquanto)
    const tradingData = MOCK_TRADING_DATA['default'];

    return {
      symbol: symbol || 'Volatility 100 Index',
      historicalData: tradingData.chartData,
      balance: financialSummary.balance,
      dailyBalance: 1000, // Valor fixo para a simulação
      currency: 'USD',
      stake: 10, // Valor fixo para a simulação
      duration: 5, // Valor fixo para a simulação
      durationUnit: 't', // Valor fixo para a simulação
      recentTrades: tradingData.recentTrades,
    };
  } catch (error) {
    console.error('[DerivDataService] Erro ao consolidar dados de análise:', error);
    return null;
  }
}
