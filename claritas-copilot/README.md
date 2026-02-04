# Claritas Copilot - Arquitetura Técnica: Deriv Trader 2.5

Este documento detalha a arquitetura do sistema **Deriv Trader 2.5**, um ambiente de trading de alta frequência impulsionado por um motor cognitivo multicamada. O sistema foi projetado para ser robusto, adaptativo e resiliente, separando a lógica de decisão de alta frequência da camada de apresentação.

---

## 1. Filosofia de Design: O Cérebro Quantitativo

O Deriv Trader 2.5 abandona a abordagem de "estratégia única" e implementa um modelo de **consenso adaptativo, consciente do contexto de mercado (regime-aware) e em constante evolução**. Ele opera não como um único robô, mas como uma mesa de operações quantitativa completa, com especialistas, gestores de risco e sistemas de validação.

**Princípios Fundamentais:**

1.  **Contexto é Rei (`Context is King`)**: Uma estratégia que funciona num mercado lateral (`ranging`) é desastrosa em um mercado de forte tendência (`trending`). O sistema primeiro identifica o **regime de mercado** e só então ativa os robôs especialistas adequados para esse contexto.
2.  **Meritocracia Exponencial via `Sharpe Ratio`**: O voto de cada robô não tem o mesmo peso. Usamos o **`Sharpe Ratio`** (retorno ajustado ao risco) para dar um poder de voto exponencial aos robôs que demonstram ser não apenas lucrativos, mas consistentes. Robôs com `Sharpe Ratio` negativo são penalizados.
3.  **Gestão de Risco Científica (Critério de Kelly)**: O valor da aposta (`stake`) não é fixo. É calculado a cada oportunidade usando o **Critério de Kelly Fracionado (Quarter Kelly)**, que aposta mais agressivamente quando a vantagem probabilística é alta e protege o capital quando a vantagem é baixa.
4.  **Evolução Genética Acelerada**: O desempenho de cada robô é constantemente validado através da **Arena Virtual** (paper trading). A cada ciclo de trades, os piores robôs podem ser substituídos por "mutações" genéticas dos robôs de elite, garantindo uma melhoria contínua.
5.  **Desacoplamento Cognitivo-UI**: O motor de alta frequência (`useRobotCouncilV2`) é desacoplado da interface (`deriv-trader-v2/page.tsx`). A UI consome o estado a um ritmo controlado, prevenindo colapsos de renderização e garantindo a estabilidade.

---

## 2. Arquitetura em Camadas

O sistema é dividido em três camadas principais que trabalham em conjunto.

### 2.1. Camada de Conexão: `use-deriv-api-v2.tsx` (A Espinha Dorsal)

Esta camada é a única ponte de comunicação com o mundo exterior (a corretora).

*   **Responsabilidade Principal**: Gerir de forma robusta e persistente a conexão WebSocket com a API da Deriv.
*   **Funções Chave**: Autenticação, reconexão automática, gestão de estado central (dados de mercado, saldo, logs) e exposição de funções de execução de trades.

### 2.2. Cérebro Cognitivo: `use-robot-council-v2.ts` (O "C-Suite" Quantitativo)

Este é o coração e a inteligência de todo o sistema. A cada `tick` de preço, ele executa um ciclo de análise completo de forma controlada (`throttled`).

*   **Responsabilidade Principal**: Analisar o mercado, tomar decisões de trading e gerir o risco de forma autónoma.
*   **Componentes Internos**:
    1.  **Cálculo de Indicadores (`indicator-service.ts`)**: Um motor otimizado que gera mais de 25 indicadores técnicos.
    2.  **Deteção de Regime de Mercado (`advanced-trading-services.ts`)**: Classifica o estado do mercado (ex: `TREND_UP`, `RANGING`) e ativa os robôs-especialistas adequados.
    3.  **Consenso Bayesiano Ponderado por Desempenho**: Votação dos robôs ponderada pelo seu `Sharpe Ratio` histórico para gerar uma probabilidade Bayesiana de sucesso.
    4.  **Gestão de Risco com Critério de Kelly**: Calcula o tamanho ideal da aposta (`stake`) com base na probabilidade de sucesso.
    5.  **Veto de Microestrutura**: Camada final de proteção que analisa os últimos ticks para vetar ordens em condições de mercado perigosas.
    6.  **Arena Virtual & Evolução Genética**: Simula todas as decisões como "paper trades" para alimentar os dados de desempenho e aciona o motor de evolução (`use-strategy-evolution.ts`) para melhorar o sistema.

### 2.3. Camada de Interface: `deriv-trader-v2/page.tsx` e Componentes

Esta camada é responsável por apresentar a complexidade do Cérebro de forma clara e interativa.

*   **Responsabilidade Principal**: Visualizar o estado do sistema e permitir a interação do utilizador sem causar problemas de performance.
*   **Componentes Visuais Chave**: `CouncilDashboardV2` (painel principal), `DebugCouncilView` (visão detalhada dos robôs), `TradingDeskV2` (ranking da Arena Virtual), e `EvolutionLab` (histórico de evolução).

Este design em camadas garante que a lógica de alta frequência do Cérebro Cognitivo seja desacoplada da interface, prevenindo falhas de renderização e permitindo que cada parte do sistema evolua de forma independente.
