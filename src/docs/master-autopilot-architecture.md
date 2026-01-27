# Claritas Copilot - Arquitetura Técnica: Master Autopilot V4 (Operacional)

Este documento detalha a arquitetura do **Master Autopilot V4**, um sistema de comando e controlo que evoluiu para um **cérebro preditivo unificado, operacional, com confirmação de tendência e auto-calibrável**.

---

## 1. Filosofia de Design: O Cérebro Híbrido (IA + Operador)

O Master Autopilot V4 abandona a ideia de "sinais cegos" e abraça uma filosofia de **confluência de fatores**: uma operação só é executada quando a previsibilidade de curto prazo se alinha com a tendência de longo prazo. Crucialmente, ele agora opera como um sistema híbrido, onde a IA propõe e o operador (ou o piloto automático) pode executar.

**Princípios Fundamentais:**

1.  **Gatilho por Assertividade ("Certainty Trigger"):** O sistema só deve operar quando tem uma **convicção estatística extremamente alta** de que o mercado está "legível". A confiança é medida pela taxa de acerto das projeções do Laboratório Preditivo.

2.  **Confirmação de Tendência Macro:** Um sinal de alta assertividade não é suficiente para trades direcionais. O sistema calcula a **EMA de 100 períodos** para definir a "maré" do mercado.

3.  **Lógica de Gatilho Dupla e Tática:**
    *   **Piloto Automático:** Executa uma ordem apenas se as condições de assertividade forem cumpridas **E** se a direção do sinal estiver alinhada com a tendência macro (para contratos direcionais).
    *   **Gatilho Manual (NOVO):** Um sinal de consenso majoritário (ex: 4 de 6 modelos concordam) ativa o botão de execução manual, permitindo que o operador execute um trade tático mesmo que as condições rigorosas do piloto não sejam cumpridas.

4.  **Gestor de Risco Adaptativo (O Cérebro que Aprende):**
    *   **Análise Pós-Trade:** Após cada operação do piloto, o sistema analisa o resultado.
    *   **Modo Cauteloso:** Se ocorre uma perda, entra em modo "Cauteloso" e **aumenta automaticamente o limiar de assertividade**.
    *   **Modo Normal:** Após uma vitória, gradualmente **reduz o limiar**.
    *   **Controlo do Operador:** O operador pode agora ajustar manualmente o limiar de assertividade base do piloto através de um slider.

5.  **Execução Específica ao Contrato:**
    *   **Direcional (`Multipliers`, `Rise/Fall`):** Executa uma ordem na direção confirmada. Para `Rise/Fall`, usa a duração do horizonte de tempo mais longo. Para `Multipliers`, calcula o risco com base na volatilidade.
    *   **Não-Direcional (`Accumulators`):** Interpreta o gatilho de assertividade como um sinal de **estabilidade**, ideal para abrir um contrato de acumulador.

---

## 2. Arquitetura da Página `master-autopilot`

### 2.1. Cérebro Cognitivo: `use-master-autopilot.ts`

Este hook contém toda a lógica de decisão, aprendizagem e execução.

*   **Responsabilidade Principal**: Consumir dados preditivos e de mercado, aplicar a lógica de gatilho, executar ordens e auto-ajustar os parâmetros de risco.
*   **Ciclo de Decisão**:
    1.  **Consumir Dados:** Integra a lógica do `StochasticLab`, calcula um conjunto completo de indicadores técnicos (RSI, MACD, etc.) e a análise de microestrutura.
    2.  **Análise Pós-Trade:** Verifica o resultado da última operação e ajusta o `assertivenessThreshold` do `RiskManager`.
    3.  **Monitorizar Gatilhos:**
        *   **Gatilho do Piloto (Rigoroso):** Verifica a condição de assertividade dupla alinhada com a tendência.
        *   **Gatilho Manual (Consenso):** Verifica se a maioria dos modelos concorda numa direção.
    4.  **Executar Ordem:**
        *   Se o piloto está ligado e o seu gatilho dispara, chama o hook de API apropriado (`useDerivApiV2` para Rise/Fall, etc.) para executar a ordem.
        *   Se o operador clica no botão manual ativado, executa a ordem correspondente.
    5.  **Expor Estado para a UI:** O hook expõe o estado completo, incluindo indicadores, microestrutura, status dos gatilhos e os parâmetros do gestor de risco.

### 2.2. Interface de Comando: `master-autopilot-interface.tsx`

Este componente foi transformado num "cockpit" completo.

*   **Controlos Principais:** Seletor de contrato, banca diária, alvo de lucro e o interruptor principal do piloto.
*   **Gatilho Manual:** O novo botão `Executar Sinal Manual` que se ativa com base no consenso.
*   **Painel Analítico Expansível (Cockpit):**
    *   **Painel de Assertividade:** Exibe o desempenho de cada especialista preditivo.
    *   **NOVO: Painel de Indicadores:** Exibe os valores em tempo real dos indicadores técnicos chave que o piloto está a usar (RSI, ADX, etc.).
    *   **NOVO: Painel de Microestrutura:** Mostra a pressão de compra/venda, velocidade dos ticks e outras métricas de fluxo de ordens.
    *   **Painel de Risco e Tendência:** Mostra o modo do piloto, o seu limiar e a tendência macro detetada.
*   **Configurações Avançadas:** Um painel colapsável que permite ao operador ajustar manualmente o limiar de assertividade base do piloto.
