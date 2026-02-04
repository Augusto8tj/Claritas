# Claritas Copilot - Arquitetura Técnica: Deriv Trader V1 (Cérebro Quantitativo)

Este documento detalha a arquitetura do sistema **Deriv Trader V1**, um ambiente de trading que foi promovido de uma simples interface de execução para um motor cognitivo que incorpora princípios de sistemas quantitativos avançados.

---

## 1. Filosofia de Design: O Cérebro Quantitativo V1

O Deriv Trader V1 abandonou a abordagem de "estratégia única" e implementou um modelo de **consenso adaptativo, consciente do contexto de mercado (regime-aware) e em constante evolução**. Ele opera não como um único robô, mas como uma mesa de operações quantitativa, com especialistas, gestores de risco e sistemas de validação.

### 1.1. Pontos Fortes e o Que Torna o V1 Superior

-   **Inteligência Contextual (`Context is King`):** O sistema não opera às cegas. Ele classifica o mercado em `TRENDING` (tendência) ou `RANGING` (lateral) e ajusta a "confiança" dos seus especialistas com base nesse contexto. Estratégias de oscilação perdem força numa tendência forte e vice-versa.
-   **Meritocracia Exponencial (`Sharpe Ratio`):** O poder de voto de um robô não é baseado em simples vitórias, mas no seu **Sharpe Ratio**, que mede o retorno ajustado ao risco. Robôs que são lucrativos *e* consistentes têm uma voz exponencialmente mais forte. Robôs com desempenho negativo são severamente penalizados.
-   **Gestão de Risco Científica (`Quarter Kelly`):** O valor da aposta (`stake`) é calculado cientificamente a cada oportunidade usando o **Critério de Kelly Fracionado**. O sistema aposta mais agressivamente quando a probabilidade de sucesso do consenso é alta e protege o capital quando a vantagem é baixa.
-   **Veto de Microestrutura (O "Guarda-Costas"):** Como uma camada final de proteção, o sistema analisa os últimos ticks de preço. Mesmo com um consenso forte de compra, ele pode vetar a operação se detetar uma "micro-queda" súbita e violenta, evitando armadilhas de volatilidade.
-   **Memória Estratégica & Aprendizagem Colaborativa:** O sistema V1 agora possui uma camada de **inteligência persistente**. Ele guarda no Firestore um "perfil estratégico" para cada ativo, aprendendo o seu "regime preferencial" e o "limiar de consenso ótimo". Mais importante, ele permite que **você, o operador**, insira os seus próprios *insights*, que são fundidos com a análise da IA, criando um cérebro híbrido que se torna mais inteligente a cada sessão.

### 1.2. Pontos Fracos

-   **Simplicidade do Regime:** A deteção de regime é binária (`TRENDING` vs `RANGING`), faltando a granularidade de sistemas mais avançados (ex: `alta volatilidade`, `breakout`).
-   **Evolução Rudimentar:** A evolução genética substitui os piores robôs, mas o seu mecanismo de mutação ainda é baseado em pequenas alterações aleatórias, em vez de uma análise de causa-raiz profunda.
-   **Dependência de Indicadores Clássicos:** A base de decisão ainda são indicadores técnicos tradicionais, sem incorporar análise de fluxo de ordens ou sentimento de mercado mais complexa.

### 1.3. Ambição do Deriv Trader V1

O objetivo do V1 é ser um sistema de trading **consistentemente lucrativo e robusto**, que sirva como um ambiente de produção estável e, ao mesmo tempo, como um laboratório para provar a eficácia dos nossos princípios de design (contexto, meritocracia, gestão de risco e **aprendizagem estratégica**) antes de os migrarmos para ecossistemas mais complexos como o V2 e V3.

---

## 2. Arquitetura em Camadas do V1

O sistema é dividido em três camadas principais que trabalham em conjunto.

### 2.1. Camada de Conexão: `use-deriv-api-v1.tsx`

Esta camada é a espinha dorsal de comunicação e estado, exclusiva do ecossistema V1.

-   **Responsabilidade Principal**: Gerir a conexão WebSocket com a API da Deriv e manter o estado global do ambiente de trading.
-   **Funções Chave**:
    -   Autenticação, reconexão e gestão de tokens (`demo` e `real`).
    -   Fonte da verdade para dados de mercado: `chartData`, `priceTicks`, `accountBalance`, `operationsLog`.
    -   Interface de execução de ordens: `executeTrade`, `sellContract`.
    -   Correção do bug de "valor de saída", garantindo que `exitPrice` é capturado tanto em contratos de `ticks` quanto de `tempo`.

### 2.2. Cérebro Cognitivo: `use-robot-council-v1.ts`

Este é o coração e a inteligência do sistema V1, onde a nova arquitetura foi implementada.

-   **Responsabilidade Principal**: Analisar o mercado a cada tick, tomar decisões de trading e gerir o risco.
-   **Ciclo de Decisão**:
    1.  **Calibração Estratégica:** Ao selecionar um ativo, o cérebro consulta a **Memória Estratégica (`AssetProfileV1`)** no Firestore. Se um perfil existe, ele ajusta parâmetros-chave, como o `consensusThreshold`, com base no que foi aprendido em sessões anteriores.
    2.  **Cálculo de Indicadores (`indicator-service.ts`):** Um motor de cálculo autónomo que gera os indicadores técnicos necessários para todos os 22 robôs.
    3.  **Deteção de Regime (`TRENDING` vs `RANGING`):** Usa o ADX para classificar o estado do mercado.
    4.  **Votação Probabilística:** Cada robô ativo calcula o seu voto (`RISE`/`FALL`/`HOLD`) e uma **pontuação de confiança (0-100)**.
    5.  **Consenso Bayesiano Ponderado:** A "magia" acontece aqui. O sistema combina:
        -   A **confiança técnica** do sinal.
        -   O **Sharpe Ratio** do robô (meritocracia).
        -   A **relevância contextual** (o regime de mercado).
    6.  **Cálculo de Risco (Critério de Kelly):** Com a probabilidade final do consenso, calcula o `stake` ideal.
    7.  **Veto de Microestrutura:** Analisa os últimos ticks e pode vetar a operação.
    8.  **Execução ou Arena Virtual:**
        -   Se a decisão for forte, envia a ordem para a camada de conexão.
        -   Simultaneamente, executa "paper trades" na **Arena Virtual** para todos os votos, alimentando os dados de desempenho para o `Sharpe Ratio`.
    9.  **Evolução Genética (`use-strategy-evolution-v1.ts`):** Periodicamente, substitui os robôs de pior desempenho por mutações dos robôs de elite.
    10. **Auditoria Forense:** A cada ciclo, um `TradeDecisionLog` detalhado é gerado e salvo no Firestore, capturando a decisão final (`EXECUTE` ou `HOLD`), o estado de todos os robôs, e **todas as operações iniciadas na Arena Virtual**, criando uma "caixa-preta" completa para análise.

### 2.3. Camada de Interface: `deriv-trader/page.tsx`

Esta camada visualiza o estado do Cérebro V1 e permite a interação do utilizador.

-   **Responsabilidade Principal**: Apresentar a complexidade do Cérebro de forma clara e interativa.
-   **Componentes Chave do V1**:
    -   `DerivTraderInterfaceV1`: Painel de negociação manual.
    -   `CouncilAutopilotInterfaceV1`: Controlo do piloto automático, incluindo o novo interruptor para **ligar/desligar a Auditoria Cognitiva**.
    -   `AITradeSuggestionV1`: Painel que exibe a decisão final do consenso, a probabilidade e o stake.
    -   `TradingDesk`: O *leaderboard* da Arena Virtual, mostrando o ranking de desempenho.
    -   `EvolutionLabV1`: Histórico dos ciclos de evolução genética.
    -   `AssetIntelligenceCard`: Um novo painel que exibe a **Memória Estratégica** aprendida para o ativo atual e permite que o operador **insira os seus próprios insights**, colaborando com a IA.
    -   `TradingDecisionLogViewer`: Agora integrado na aba "Auditoria", exibe o log forense completo, incluindo os dados da Arena Virtual.
    -   `HallOfFame`: Exibe os robôs de melhor desempenho histórico, agora com detalhes de configuração.

---

## 3. Ficheiros Atuais no Ecossistema V1

-   **Orquestrador Principal:** `src/app/deriv-trader/page.tsx`
-   **Comunicação com a API:** `src/features/trading/hooks/use-deriv-api-v1.tsx`
-   **Cérebro de Decisão:** `src/features/trading/hooks/use-robot-council-v1.ts`
-   **Motor de Evolução:** `src/features/trading/hooks/use-strategy-evolution-v1.ts`
-   **Cálculo de Indicadores:** `src/features/trading/services/indicator-service.ts` (partilhado)
-   **Estratégias Base:** `src/features/trading/services/council-strategies.ts` (partilhado)
-   **Persistência de Dados:** `src/services/financial-data-service.ts` (funções como `saveRobotPerformance`, `saveTradeDecision`, `saveAssetProfileV1` e `saveEvolutionHistory` com um parâmetro `version: 'v1'`)
