# Claritas Copilot - Arquitetura Técnica: Laboratório Preditivo (Análise de Volatilidade)

Este documento detalha a arquitetura e o funcionamento da página **Análise de Volatilidade**, o nosso "Laboratório Preditivo". Esta ferramenta é um ambiente de análise quantitativa avançado, projetado para dissecar e prever o comportamento de alta frequência de um ativo usando modelos estocásticos.

---

## 1. Objetivo: De Reativo para Preditivo

O objetivo desta página é transcender a análise técnica tradicional, que é reativa por natureza (baseada em dados passados). O nosso objetivo é construir e validar um **motor preditivo** que tenta antecipar os movimentos de preço em múltiplos horizontes de tempo, e um piloto automático que opera com base nestas previsões, criando um verdadeiro laboratório de estratégias quantitativas.

---

## 2. Filosofia de Design: O Comitê de Especialistas Temporais

A página não é apenas um gráfico; é um **comitê de seis especialistas em IA**, cada um focado num horizonte de tempo diferente (3-ticks, 6-ticks, 10-segundos, etc.). O sistema opera sob os seguintes princípios:

1.  **Previsão Multi-Horizonte:** Em vez de uma única previsão, o sistema gera seis projeções de preço distintas. Isto permite-nos ver se a previsão de curto prazo concorda ou diverge da de longo prazo.
2.  **Modelo Preditivo (Movimento Browniano Geométrico - GBM):** O coração de cada especialista é o GBM, um modelo padrão em finanças quantitativas. Ele projeta o futuro com base em duas forças:
    *   **Drift (Tendência):** A média dos retornos recentes. Se o ativo tem subido, a tendência da projeção é de alta.
    *   **Difusão (Volatilidade):** A aleatoriedade do movimento, baseada no desvio padrão dos retornos recentes.
3.  **Meritocracia Preditiva (Auto-Avaliação):** O sistema não confia cegamente nas suas próprias previsões. Ele rastreia constantemente o **índice de assertividade** (a taxa de acerto direcional) de cada um dos seus seis especialistas. Projeções que se provam mais confiáveis ganham mais "peso" na decisão final.
4.  **Consenso Ponderado para Decisão:** A decisão final (`RISE` ou `FALL`) não é uma média simples. É o resultado de uma **eleição ponderada**. O voto de cada especialista temporal é ponderado pela sua assertividade histórica. Um especialista com 80% de acerto tem um voto muito mais forte do que um com 55%.
5.  **Auto-Correção de Erro (Drift Adaptativo):** O sistema mede constantemente o seu erro de previsão de curtíssimo prazo (MAE e RMSE) e calcula um "fator de correção" (drift) para ajustar e refinar as suas futuras projeções, num ciclo de aprendizagem contínua.

---

## 3. Arquitetura e Ficheiros Atuantes

A página opera como um ecossistema próprio. Aqui estão os ficheiros-chave:

### 3.1. Camada de Interface e Orquestração

*   **`src/app/volatility-analysis/page.tsx`**: O ficheiro central da página.
    *   **Responsabilidade:** Orquestra todos os componentes, hooks e serviços.
    *   **Contém o `StochasticLab`:** Este componente interno é o **"Cientista de IA"**. Ele executa os modelos GBM para os 6 horizontes de tempo, calcula as projeções, avalia a assertividade de cada um e expõe estes dados para o resto do sistema.

### 3.2. Camada Cognitiva (O Cérebro de Decisão)

*   **`src/features/trading/hooks/use-master-autopilot.ts`**: Este é o **"Comandante Tático"** do piloto automático.
    *   **Responsabilidade:** Consome as previsões geradas pelo `StochasticLab`. É aqui que a magia do "funil de decisão" acontece. Ele aplica todos os filtros de risco e de contexto para decidir se uma ordem deve ser executada.
*   **`src/features/trading/services/predictive-logic.ts`**: A "Constituição" do piloto automático.
    *   **Responsabilidade:** Contém a função pura `evaluateTriggerConditions`. Esta função recebe o estado atual do sistema (assertividade, seus controlos, etc.) e retorna uma decisão (`RISE`, `FALL`, `HOLD`) e a justificação, sem executar nenhuma ação. Isto torna a lógica de decisão testável e isolada.
*   **`src/services/indicator-service.ts`**: O "Laboratório de Análise Técnica".
    *   **Responsabilidade:** Usado pelo `use-master-autopilot.ts` para calcular a **EMA dinâmica**, que é usada para o filtro de tendência macro proporcional.

### 3.3. Camada de Dados e Comunicação

*   **`src/features/trading/hooks/use-deriv-api-v2.tsx`**: A nossa ponte única com a corretora.
    *   **Responsabilidade:** Fornece os dados de mercado em tempo real (`priceTicks`, `botCandleData`) que alimentam tanto o `StochasticLab` quanto o `indicator-service`. É também por aqui que a ordem de `executeTrade` é efetivamente enviada.
*   **`src/services/financial-data-service.ts`**: A camada de persistência.
    *   **Responsabilidade:** Contém as funções `savePredictiveTradeLog` e `getPredictiveTradeLogs`, que guardam e carregam o histórico de decisões do piloto automático de/para o Firestore.

### 3.4. Componentes de UI

*   **`src/components/deriv-trader/PredictiveLogViewer.tsx`**: O componente visual que exibe de forma clara o histórico de auditoria guardado no Firestore.
*   **`src/features/trading/components/deriv-trader/volatility-trader-interface.tsx`**: O painel de negociação manual, que permite que o operador interaja com o sistema.

---

## 4. O Funil de Decisão do Piloto Automático

Para que uma ordem automática seja executada, ela precisa passar por uma série de filtros rigorosos, em sequência:

1.  **Filtro 0: Verificações Operacionais**
    *   Piloto está LIGADO? O sistema está conectado? Não há trades do piloto pendentes?

2.  **Filtro 1: Compatibilidade Tática**
    *   O tipo de contrato selecionado (ex: `Rise/Fall`) é adequado para o regime de mercado atual (ex: `trending_bull`)?

3.  **Filtro 2: Consenso Preditivo**
    *   Este é o seu controlo **"Confirmação de Vizinhos"**. Se estiver LIGADO, o sistema procura por dois especialistas temporais vizinhos que concordem na mesma direção. Se DESLIGADO, procura pelo único especialista mais forte.

4.  **Filtro 3: Limiar de Assertividade**
    *   O(s) especialista(s) que passaram no filtro anterior têm uma **Assertividade Efetiva** maior ou igual (`>=`) ao limiar que você definiu nos sliders?

5.  **Filtro 4: Alinhamento de Tendência Macro (Dinâmico e Proporcional)**
    *   Este é o seu controlo **"Verificação de Tendência Macro"**. Se estiver LIGADO, o sistema executa a lógica mais avançada:
        *   Identifica se o sinal é de **Alta Frequência** (baseado no seu slider "Limiar de HF"). Se for, **ignora o resto deste filtro**.
        *   Se for um sinal padrão, calcula uma **EMA dinâmica** com um período igual ao do especialista mais longo que confirmou o sinal.
        *   Verifica se a direção do sinal (`RISE`/`FALL`) está alinhada com a posição do preço em relação a esta EMA dinâmica.

**Execução:** Apenas se uma oportunidade sobreviver a **todos** estes filtros, a função `executeTradeAction` é chamada e a ordem é enviada para a corretora com uma duração que corresponde ao horizonte de tempo do especialista que a validou.