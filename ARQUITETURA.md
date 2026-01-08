# Claritas Copilot - Arquitetura Técnica: Deriv Trader 2.5

Este documento detalha a arquitetura do sistema **Deriv Trader 2.5**, um ambiente de trading de alta frequência impulsionado por um motor cognitivo multicamada. O sistema foi projetado para ser robusto, adaptativo e resiliente, separando a lógica de decisão de alta frequência da camada de apresentação.

---

## 1. Filosofia de Design: O Cérebro Quantitativo

O Deriv Trader 2.5 abandona a abordagem de "estratégia única" e implementa um modelo de **consenso adaptativo e consciente do contexto de mercado (regime-aware)**. Ele opera não como um único robô, mas como uma mesa de operações quantitativa completa, com especialistas, gestores de risco e sistemas de validação.

**Princípios Fundamentais:**

1.  **Contexto é Rei (`Context is King`)**: Uma estratégia que funciona em um mercado lateral (`ranging`) é desastrosa em um mercado de forte tendência (`trending`). O sistema primeiro identifica o **regime de mercado** e só então ativa os robôs especialistas adequados para esse contexto.
2.  **Consenso Bayesiano > Votação Simples**: Em vez de uma contagem de votos, o sistema utiliza **inferência Bayesiana**. A confiança de cada robô é continuamente calibrada pelo seu desempenho histórico *naquele regime específico*, resultando em uma probabilidade final de sucesso muito mais precisa.
3.  **Gestão de Risco Científica**: O valor da aposta (`stake`) não é fixo. É calculado a cada oportunidade de trade usando o **Critério de Kelly Fracionado (Quarter Kelly)**, que aposta mais agressivamente quando a vantagem probabilística é alta e protege o capital quando a vantagem é baixa.
4.  **Validação Contínua e Evolução Genética**: O desempenho de cada robô é constantemente validado através da **Arena Virtual** (paper trading). A cada 50 trades, os piores robôs são substituídos por "mutações" genéticas dos robôs de elite, garantindo uma melhoria contínua.
5.  **Desacoplamento Cognitivo-UI**: O motor de alta frequência (`useRobotCouncilV2`) é desacoplado da interface (`deriv-trader-v2/page.tsx`). A UI consome o estado a um ritmo controlado, prevenindo colapsos de renderização e garantindo a estabilidade.

---

## 2. Arquitetura em Camadas

O sistema é dividido em três camadas principais que trabalham em conjunto.

### 2.1. Camada de Conexão: `use-deriv-api-v2.tsx` (A Espinha Dorsal)

Esta camada é a nossa única ponte de comunicação com o mundo exterior (a corretora).

*   **Responsabilidade Principal**: Gerir de forma robusta e persistente a conexão WebSocket com a API da Deriv.
*   **Funções Chave**:
    *   **Autenticação e Reconexão**: Garante que estamos sempre conectados, tratando de autorização de tokens e reconexões automáticas em caso de falha.
    *   **Gestão de Estado Central**: Atua como a "fonte da verdade" para todos os dados de mercado. Mantém o estado de:
        *   `chartData`: Os dados (velas ou ticks) para a renderização do gráfico principal.
        *   `priceTicks`: Um fluxo contínuo dos últimos ticks de preço, essencial para análises de microestrutura.
        *   `accountBalance`: O saldo da conta, atualizado em tempo real.
        *   `operationsLog`: Um registo de todas as operações (trades) executadas.
    *   **Interface de Execução**: Expõe funções críticas para as outras camadas, como `executeTrade`, `sellContract`, e `getHistoricalData`.

### 2.2. Cérebro Cognitivo: `use-robot-council-v2.ts` (O "C-Suite" Quantitativo)

Este é o coração e a inteligência de todo o sistema. A cada `tick` de preço, ele executa um ciclo de análise completo, mas de forma controlada (`throttled`) para não sobrecarregar o sistema.

*   **Responsabilidade Principal**: Analisar o mercado, tomar decisões de trading e gerir o risco de forma autónoma.
*   **Componentes Internos do Ciclo de Decisão**:
    1.  **Cálculo de Indicadores (`indicator-service-v2.ts`)**: Um motor de cálculo autónomo e otimizado que gera mais de 25 indicadores técnicos (RSI, MACD, Bandas de Bollinger, Ichimoku, etc.) a partir dos dados brutos do `useDerivApiV2`. Este motor alimenta todas as análises subsequentes.
    2.  **Deteção de Regime de Mercado (`advanced-trading-services.ts`)**: Utiliza um modelo inspirado em *Hidden Markov Models* (HMM) para classificar o estado atual do mercado (ex: `TREND_UP`, `RANGING`, `HIGH_VOLATILITY`). **Esta é a camada mais estratégica**: o sistema só ativa os robôs-especialistas que são adequados para o regime de mercado atual, silenciando os que não são.
    3.  **Consenso Bayesiano Ponderado**: Aqui a "magia" acontece.
        *   **Votação**: Os robôs ativos votam `RISE`, `FALL` ou `HOLD` com base nos indicadores.
        *   **Ponderação por Meritocracia**: O voto de cada robô é ponderado pelo seu `Sharpe Ratio` histórico, uma medida que relaciona retorno ao risco. Robôs mais consistentes têm mais "poder de voto".
        *   **Inferência Bayesiana**: O sistema combina a "confiança" do sinal técnico com a `winRate` histórica do robô *naquele regime de mercado*. O resultado é uma **Probabilidade Bayesiana** de sucesso muito mais precisa.
    4.  **Gestão de Risco com Critério de Kelly (`advanced-trading-services.ts`)**: Com a probabilidade Bayesiana final, o sistema calcula o tamanho ideal da aposta (`stake`) usando o Critério de Kelly Fracionado.
    5.  **Análise de Microestrutura (`advanced-trading-services.ts`)**: Como uma camada final de proteção ("guarda-costas"), o sistema analisa os últimos 10-20 ticks. Se detetar uma anomalia (ex: um pico súbito de volume de venda), pode vetar uma ordem de compra.
    6.  **Execução ou Arena Virtual**:
        *   **Se a Decisão for Forte**: Envia a ordem final (`direção`, `stake`, `duração`) para a camada de conexão (`executeTrade`).
        *   **Paper Trading Contínuo**: *Independentemente da decisão final*, todos os votos válidos dos robôs são executados como "paper trades" na **Arena Virtual**. Isto gera os dados de desempenho (vitórias, derrotas, P&L) necessários para a meritocracia.
    7.  **Evolução Genética (`use-strategy-evolution.ts`)**: A cada 50 trades virtuais, este módulo é acionado. Ele identifica os 5 robôs de pior desempenho e os substitui por "mutações" genéticas dos 5 robôs de elite.

### 2.3. Camada de Interface: `deriv-trader-v2/page.tsx` e Componentes

Esta camada é responsável por apresentar a complexidade do Cérebro de forma clara e interativa.

*   **Responsabilidade Principal**: Visualizar o estado do sistema e permitir a interação do utilizador sem causar problemas de performance.
*   **Componentes Visuais Chave**:
    *   **`CouncilDashboardV2`**: O painel de controlo principal. Mostra a "ponta do iceberg" da decisão da IA: o regime de mercado, a probabilidade Bayesiana final e o `stake` calculado.
    *   **`DebugCouncilView`**: A "sala de máquinas" do Cérebro. É uma tabela detalhada que mostra, em tempo real, o voto, a confiança, e a razão de cada um dos 22 robôs. Essencial para depuração.
    *   **`TradingDeskV2`**: O *leaderboard* da Arena Virtual. Exibe o ranking de desempenho de todos os robôs, mostrando vitórias, derrotas, P&L e o crucial `Sharpe Ratio`.
    *   **`EvolutionLab`**: O diário do laboratório genético. Mostra o histórico de cada ciclo de evolução, detalhando quais robôs foram substituídos e quais foram os "pais" das novas mutações.
    *   **`DerivTraderInterfaceV2`**: O painel de negociação manual, que coexiste com o sistema autónomo.

Este design em camadas garante que a lógica de alta frequência do Cérebro Cognitivo seja desacoplada da interface, prevenindo falhas de renderização e permitindo que cada parte do sistema evolua de forma independente.
