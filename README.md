
# Claritas Copilot - Arquitetura Técnica: Deriv Trader 2.0

Este documento detalha a arquitetura do sistema **Deriv Trader 2.0**, um ambiente de trading de alta frequência impulsionado por um motor cognitivo multicamada. O sistema foi projetado para ser robusto, adaptativo e resiliente, separando a lógica de decisão de alta frequência da camada de apresentação.

---

## 1. Filosofia de Design: O Cérebro Quantitativo

O Deriv Trader 2.0 abandona a abordagem de "estratégia única" e implementa um modelo de **consenso adaptativo e consciente do contexto de mercado (regime-aware)**. Ele opera não como um único robô, mas como uma mesa de operações quantitativa completa, com especialistas, gestores de risco e sistemas de validação.

**Princípios Fundamentais:**

1.  **Context is King (O Contexto é Rei):** Uma estratégia (ex: oscilador) que funciona em um mercado lateral (`ranging`) é desastrosa em um mercado de forte tendência (`trending`). O sistema primeiro identifica o **regime de mercado** e só então ativa os robôs especialistas adequados para esse contexto.
2.  **Consenso Bayesiano > Votação Simples:** Em vez de uma contagem de votos, o sistema utiliza **inferência Bayesiana**. A confiança de cada robô é continuamente calibrada pelo seu desempenho histórico *naquele regime específico*, resultando em uma probabilidade final de sucesso muito mais precisa.
3.  **Gestão de Risco Científica:** O valor da aposta (`stake`) não é fixo. É calculado a cada oportunidade de trade usando o **Critério de Kelly Fracionado (Quarter Kelly)**, que aposta mais agressivamente quando a vantagem probabilística é alta e protege o capital quando a vantagem é baixa.
4.  **Validação Contínua:** O desempenho de cada robô é constantemente validado para garantir que os resultados são fruto de habilidade (`skill`), não de sorte (`luck`), utilizando métricas como o **Sharpe Ratio** e testes de **Monte Carlo**.
5.  **Desacoplamento Cognitivo-UI:** O motor de alta frequência (`useRobotCouncilV2`) é desacoplado da interface (`deriv-trader-interface-v2.tsx`). A UI consome o estado a um ritmo controlado (`throttle`), prevenindo colapsos de renderização e garantindo a estabilidade.

---

## 2. Arquitetura em Camadas

O sistema é dividido em três camadas principais que trabalham em conjunto.

### 2.1. Camada 1: O Motor Cognitivo de Alta Frequência (`useRobotCouncilV2.ts`)

Este é o "cérebro" do sistema. A cada tick de preço, ele executa um ciclo de análise completo e throttled (controlado para rodar no máximo a cada segundo).

**Componentes do Ciclo:**

-   **Cálculo de Indicadores:** Um motor otimizado calcula um vasto leque de indicadores técnicos que alimentam as camadas superiores.
-   **Detecção de Regime (HMM Lite):** Um modelo inspirado em *Hidden Markov Models* analisa a estrutura do mercado (volatilidade, momentum) para classificar o ambiente atual em um de cinco regimes (ex: `TREND_UP`, `RANGING`, `HIGH_VOLATILITY`).
-   **Análise de Microestrutura:** Examina os últimos ticks para detetar anomalias como picos de volume, desequilíbrio de ordens e aceleração de preço, servindo como uma camada de veto final.
-   **Consenso Bayesiano Ponderado:**
    1.  **Filtragem por Regime:** Apenas os robôs eficazes para o regime atual são autorizados a "votar".
    2.  **Cálculo do Voto Técnico:** Cada robô ativo calcula sua decisão (`RISE`/`FALL`) e confiança inicial.
    3.  **Atualização Bayesiana:** A confiança de cada voto é ajustada usando o seu `winRate` histórico *naquele regime*, gerando uma probabilidade posterior.
    4.  **Agregação:** As probabilidades são agregadas para formar uma única **probabilidade de consenso Bayesiano** para a direção do trade.
-   **Cálculo de Risco (Kelly Criterion):** Com a probabilidade final em mãos, o sistema calcula o tamanho ótimo da posição (`stake`) usando o Critério de Kelly Fracionado.
-   **Decisão Final e Execução:** Se a probabilidade de consenso e as condições de risco são favoráveis, a ordem é formatada e enviada para a Camada 2.

### 2.2. Camada 2: Conexão e Gerenciamento de Estado (`useDerivApi.tsx`)

Esta camada é a espinha dorsal de comunicação e estado.

-   **WebSocket Management:** Gerencia a conexão persistente com a API da Deriv, tratando de autenticação, reconexão e subscrições de dados de mercado.
-   **Estado Centralizado:** Mantém o estado global do ambiente de trading: dados do gráfico (`chartData`), ticks brutos (`priceTicks`), log de operações (`operationsLog`), balanço da conta, etc.
-   **Fila de Execução:** Provê a função `executeTrade`, que envia as ordens para a corretora e gere as respostas de forma assíncrona.
-   **Parsing de Mensagens:** Recebe e processa todas as mensagens da API, atualizando o estado correspondente (ex: um `proposal_open_contract` atualiza o `operationsLog`).

### 2.3. Camada 3: Interface de Usuário (UI) Reativa e Desacoplada

Os componentes da UI são projetados para serem "burros" e reativos, consumindo o estado complexo do cérebro V2 de forma segura.

-   **`deriv-trader-v2/page.tsx`:** O orquestrador que une o cérebro (`useRobotCouncilV2`) e a camada de API (`useDerivApi`), passando os dados para os componentes visuais.
-   **`CouncilDashboard.tsx`:** O painel principal que exibe uma visão em tempo real do estado interno do cérebro: o regime de mercado, a probabilidade Bayesiana, o `stake` calculado pelo Kelly e a análise de microestrutura.
-   **`deriv-trader-interface-v2.tsx`:** O painel de negociação manual. Ele utiliza o padrão **HF-Safe (High-Frequency Safe)**:
    -   **Estado Local:** Componentes complexos como o `<Select>` mantêm o seu próprio estado local para evitar re-renderizações diretas a cada tick.
    -   **Sincronização Assíncrona:** O estado local da UI é sincronizado com o estado global do formulário (React Hook Form) de forma assíncrona (`queueMicrotask`), quebrando qualquer possibilidade de loop de renderização.

---

## 3. Fluxo de Decisão de um Trade Automático (Exemplo)

1.  Um novo `tick` chega do `useDerivApi`.
2.  O `useEffect` principal em `useRobotCouncilV2` é acionado (respeitando o `throttle`).
3.  O **HMM Lite** analisa os últimos 50 candles e define o regime como `RANGING`.
4.  O sistema **silencia** os robôs de tendência (ex: ADX) e **ativa** os osciladores (ex: RSI, Estocástico).
5.  O robô de RSI vota `RISE` com 70% de confiança, pois o RSI está em 25.
6.  O sistema consulta a performance histórica do robô de RSI no regime `RANGING` e descobre que ele tem um `winRate` de 68% neste cenário.
7.  A **inferência Bayesiana** combina a confiança do sinal (70%) com o `winRate` histórico (68%), resultando numa probabilidade posterior ajustada de, digamos, 72% de sucesso.
8.  Outros robôs de `ranging` votam, e o consenso final chega a uma probabilidade de `RISE` de 75%.
9.  O **Kelly Criterion** usa essa probabilidade de 75% e o `payoff` médio para calcular um `stake` de $1.25.
10. A **análise de microestrutura** confirma que não há uma pressão de venda súbita nos últimos 10 ticks.
11. A decisão é aprovada. A função `executeTrade` do `useDerivApi` é chamada com os parâmetros `direction: RISE`, `stake: 1.25`, e uma duração ótima calculada.
12. A ordem é executada.

Este ciclo demonstra como o sistema combina análise de contexto, validação histórica e gestão de risco científica para tomar decisões de trading muito além de uma simples leitura de indicador.
