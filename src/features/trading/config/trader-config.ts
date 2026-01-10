// /src/features/trading/config/trader-config.ts
/**
 * ⚙️ ARQUIVO DE CONFIGURAÇÃO CENTRALIZADO - DERIV TRADER V2.5
 * 
 * Este arquivo centraliza todas as constantes e parâmetros ajustáveis
 * para o sistema de trading algorítmico.
 * 
 * OBJETIVO:
 * 1. FACILITAR A MANUTENÇÃO: Ajustes finos podem ser feitos aqui sem tocar na lógica principal.
 * 2. FLEXIBILIDADE DE AMBIENTE: Permite, no futuro, ter configurações diferentes
 *    para desenvolvimento (ex: logs detalhados) e produção (ex: performance otimizada).
 * 3. CONSISTÊNCIA: Garante que todos os módulos do sistema usem os mesmos parâmetros.
 */

// ============================================================================
// 1. PARÂMETROS GERAIS DO MOTOR COGNITIVO
// ============================================================================

export const TRADER_CONFIG = {
  // Frequência de execução do ciclo de decisão principal (em milissegundos)
  // Menor valor = mais reativo, maior consumo de CPU.
  // Valor recomendado para produção: 1000-2000ms
  THROTTLE_MS: 1000,
  
  // Número de candles usados para a análise de regime de mercado e indicadores.
  // Deve ser um valor que capture tendências de curto a médio prazo.
  REGIME_LOOKBACK: 30,

  // Período máximo (em segundos) que um trade virtual pode ficar "órfão"
  // antes de ser removido para evitar memory leaks.
  TRADE_TIMEOUT_SECONDS: 3600, // 1 hora
};

// ============================================================================
// 2. PARÂMETROS DA ARENA VIRTUAL E EVOLUÇÃO GENÉTICA
// ============================================================================

export const ARENA_CONFIG = {
  // Valor da aposta (em USD) para cada trade virtual na arena.
  // Usado para calcular P&L e Sharpe Ratio.
  VIRTUAL_STAKE: 1.0,

  // Limiar de confiança MÍNIMO para que um voto de robô se torne
  // um trade virtual na arena. Ajuda a treinar com sinais de maior qualidade.
  MIN_PAPER_CONFIDENCE: 60,
};


export const EVOLUTION_CONFIG = {
  // Número de trades totais (reais + virtuais) para acionar um ciclo de evolução
  TRIGGER_THRESHOLD: 2,
  
  // Quantos dos melhores robôs são considerados "elite" para reprodução
  ELITE_COUNT: 3,
  
  // Quantos dos piores robôs são substituídos
  WORST_COUNT: 3,
  
  // Número mínimo de trades para que um robô seja elegível para análise de evolução
  MIN_TRADES_FOR_DEEP_ANALYSIS: 1,
  
  // Força da mutação direcionada (ex: 0.1 = 10% de ajuste)
  DIRECTED_MUTATION_STRENGTH: 0.15,
};


// ============================================================================
// 3. PARÂMETROS DE GESTÃO DE RISCO E EXECUÇÃO
// ============================================================================

export const RISK_CONFIG = {
  // Limiar de confiança MÍNIMO para que um consenso seja considerado
  // para um trade com capital real.
  MIN_REAL_CONFIDENCE: 70,

  // Limiar de probabilidade de consenso acima do qual a aposta de Kelly
  // recebe um bônus por "alta convicção".
  AGGRESSIVE_THRESHOLD: 85,
  
  // Fator de multiplicação para o "boost" de alta convicção. (1.3 = +30%)
  AGGRESSIVE_BOOST_FACTOR: 1.3,

  // Multiplicador para o ajuste de stake baseado na volatilidade.
  // Valor maior = maior redução de stake em mercados voláteis.
  VOLATILITY_ADJUSTMENT_FACTOR: 3,
  
  // Fração do Critério de Kelly a ser usada (0.25 = Quarter Kelly).
  // Previne o "risco da ruína" ao ser mais conservador que o Kelly completo.
  KELLY_FRACTION: 0.25,
  
  // Stake mínimo absoluto (em USD) para qualquer operação.
  MIN_STAKE: 0.35,
};
