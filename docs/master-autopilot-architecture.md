# Claritas Copilot - Arquitetura Técnica: Master Autopilot V3 (Trend-Confirmed)

Este documento detalha a arquitetura do **Master Autopilot V3**, um sistema de comando e controlo que evoluiu para um **cérebro preditivo unificado, com confirmação de tendência e auto-calibrável**.

---

## 1. Filosofia de Design: O Cérebro Preditivo e Tático

O Master Autopilot V3 abandona a ideia de "sinais cegos" e abraça uma filosofia de **confluência de fatores**: uma operação só é executada quando a previsibilidade de curto prazo se alinha com a tendência de longo prazo.

**Princípios Fundamentais:**

1.  **Gatilho por Assertividade ("Certainty Trigger"):** A premissa central é que o sistema só deve operar quando tem uma **convicção estatística extremamente alta** de que o mercado está "legível" e previsível. A confiança é medida pela taxa de acerto das projeções do Laboratório Preditivo.

2.  **Confirmação de Tendência Macro (NOVO):** Um sinal de alta assertividade não é suficiente para trades direcionais. O sistema agora calcula a **Média Móvel Exponencial de 100 períodos** para definir a "maré" do mercado. O gatilho só é válido se a direção do sinal estiver alinhada com esta tendência macro.

3.  **Lógica de Gatilho Dupla e Tática:** A regra de ouro para a execução é a **confirmação de assertividade em múltiplos horizontes de tempo, alinhada com a tendência**:
    *   **Passo 1 (Assertividade):** Dois "especialistas temporais" vizinhos (ex: 6-ticks e 10-segundos) devem demonstrar uma taxa de acerto direcional superior ao limiar atual.
    *   **Passo 2 (Confirmação de Tendência):** Para contratos direcionais (`Rise/Fall`, `Multipliers`), a direção do sinal deve corresponder à tendência macro. Um sinal `RISE` só é válido se o preço estiver acima da EMA 100.
    *   **Passo 3 (Lógica de Contrato):**
        *   **Direcional (`Multipliers`, `Rise/Fall`):** Executa uma ordem na direção confirmada. Para `Rise/Fall`, usa a duração do horizonte de tempo mais longo que ativou o gatilho. Para `Multipliers`, calcula o risco com base na volatilidade.
        *   **Não-Direcional (`Accumulators`):** Ignora a tendência e interpreta o gatilho de assertividade como um sinal puro de **estabilidade e previsibilidade**, ideal para abrir um contrato de acumulador.

4.  **Gestor de Risco Adaptativo (O Cérebro que Aprende):**
    *   **Análise Pós-Trade:** Após cada operação, o sistema analisa o resultado.
    *   **Modo Cauteloso:** Se ocorre uma perda, entra em **"Modo Cauteloso"**, concluindo que o seu limiar não foi rigoroso o suficiente e **aumentando automaticamente o limiar de assertividade**.
    *   **Modo Normal:** Após uma vitória, gradualmente **reduz o limiar de volta ao normal**.

5.  **Mecanismos de Segurança:** Para evitar operações excessivas, o sistema possui salvaguardas, como um período de **cooldown** após cada trade.

---

## 2. Arquitetura da Página `master-autopilot`

### 2.1. Cérebro Cognitivo: `use-master-autopilot.ts`

Este hook contém toda a lógica de decisão e aprendizagem.

*   **Responsabilidade Principal**: Consumir dados preditivos e de tendência, aplicar a lógica do "Gatilho Duplo", executar a ordem e **ajustar os seus próprios parâmetros de risco**.
*   **Ciclo de Decisão**:
    1.  **Consumir Dados:** Integra a lógica do `StochasticLab` para obter as projeções e taxas de assertividade, e agora também calcula a **EMA de 100 períodos** para definir a tendência macro.
    2.  **Análise Pós-Trade (Feedback Loop):** Verifica se a última operação foi concluída e ajusta o `assertivenessThreshold` do `RiskManager`.
    3.  **Verificar Salvaguardas:** Verifica se está em *cooldown* ou se já existe uma posição aberta.
    4.  **Monitorizar o Gatilho Duplo:**
        *   Verifica se a condição de assertividade é cumprida.
        *   Se o contrato for direcional, verifica se o sinal está alinhado com a `macroTrend`.
    5.  **Executar Ordem:** Se todas as condições forem cumpridas, chama o hook de API apropriado (`useDerivApiV2` para Rise/Fall, `useDerivApiMultipliers` para Multipliers, etc.) para executar a ordem com os parâmetros calculados (stake, duração, etc.) e entra em *cooldown*.
    6.  **Expor Estado para a UI:** O hook expõe o estado atual (ex: "Gatilho Detectado: EXECUTANDO" ou "Aguardando alinhamento de tendência"), as taxas de assertividade, o **estado atual do Gestor de Risco** e a **tendência macro detetada**.

### 2.2. Interface de Comando: `master-autopilot-interface.tsx`

Este componente fornece ao operador o controlo e a visibilidade total sobre o sistema.

*   **Seletores de Configuração:** Para tipo de contrato e gestão de risco.
*   **Painéis de Status em Tempo Real:**
    *   **Status do Gatilho:** Mostra o estado atual da lógica de decisão, incluindo o motivo de espera.
    *   **NOVO: Análise de Tendência Macro:** Um novo painel que exibe a tendência de longo prazo detetada (`UP`/`DOWN`), permitindo ao operador entender o "viés" direcional do piloto.
    *   **Painel de Assertividade:** Exibe o desempenho de cada especialista preditivo.
    *   **Gestor de Risco Adaptativo:** Mostra o **modo atual do piloto** (`Normal` ou `Cauteloso`) e o **limiar de assertividade dinâmico**.
*   **Gráfico Integrado:** A página agora inclui um gráfico completo para visualização do ativo selecionado.

    