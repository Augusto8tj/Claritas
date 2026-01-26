# Claritas Copilot - Arquitetura Técnica: Master Autopilot V2 (Auto-Calibrável)

Este documento detalha a arquitetura do **Master Autopilot V2**, um sistema de comando e controlo que evoluiu de um executor de regras fixas para um **cérebro preditivo unificado e auto-calibrável**.

---

## 1. Filosofia de Design: O Cérebro Preditivo Adaptativo

O Master Autopilot V2 abandona a ideia de parâmetros fixos e abraça a **aprendizagem contínua**. Ele utiliza o Laboratório Preditivo como motor de decisão, mas com uma camada adicional de inteligência que ajusta o seu próprio comportamento com base nos resultados.

**Princípios Fundamentais:**

1.  **Gatilho por Assertividade ("Certainty Trigger"):** A premissa central é que o sistema só deve operar quando tem uma **convicção estatística extremamente alta** de que o mercado está "legível" e previsível.

2.  **Lógica de Confirmação Dupla:** A regra de ouro para a execução é a **confirmação de assertividade em múltiplos horizontes de tempo**. Uma ordem só é considerada quando dois "especialistas temporais" vizinhos (ex: 6-ticks e 10-segundos) demonstram uma taxa de acerto direcional superior ao limiar atual.

3.  **Gestor de Risco Adaptativo (O Cérebro que Aprende):** Esta é a evolução chave da V2. O sistema agora possui um "gestor de risco" interno que o torna auto-calibrável:
    *   **Análise Pós-Trade:** Após cada operação, o sistema analisa o resultado.
    *   **Modo Cauteloso:** Se ocorre uma perda, o sistema entra em **"Modo Cauteloso"**. Ele conclui que o seu limiar de confiança não foi rigoroso o suficiente e **aumenta automaticamente o limiar de assertividade** (ex: de 80% para 85%).
    *   **Modo Normal:** Após uma vitória, ele gradualmente **reduz o limiar de volta ao normal**, tornando-se mais confiante.

4.  **Adaptação ao Contrato:** Embora o gatilho seja universal, a **ação de execução** é específica para cada tipo de contrato:
    *   **Rise/Fall & Multipliers:** Executa uma ordem direcional (`CALL`/`PUT`, `MULTUP`/`MULTDOWN`).
    *   **Accumulators:** Interpreta o gatilho não como um sinal de direção, mas como um sinal de **alta previsibilidade e estabilidade**, indicando uma excelente oportunidade para abrir um contrato de acumulador.

5.  **Mecanismos de Segurança:** Para evitar operações excessivas, o sistema possui salvaguardas, como um período de **cooldown** após cada trade e a verificação para não abrir novas posições enquanto uma já estiver ativa.

---

## 2. Arquitetura da Página `master-autopilot`

### 2.1. Cérebro Cognitivo: `use-master-autopilot.ts`

Este hook contém toda a lógica de decisão e aprendizagem.

*   **Responsabilidade Principal**: Consumir os dados preditivos, aplicar a lógica do "Gatilho de Assertividade", executar a ordem e **ajustar os seus próprios parâmetros de risco**.
*   **Ciclo de Decisão**:
    1.  **Consumir Dados Preditivos:** Integra a lógica do `StochasticLab` para obter as projeções e taxas de assertividade.
    2.  **Análise Pós-Trade (Feedback Loop):** Verifica se a última operação do piloto foi concluída. Com base no lucro/perda, atualiza o estado do `RiskManager`, ajustando o `assertivenessThreshold`.
    3.  **Verificar Salvaguardas:** Verifica se está em *cooldown* ou se já existe uma posição aberta.
    4.  **Monitorizar o Gatilho de Assertividade:** A cada ciclo, verifica se a condição de assertividade dupla é cumprida, usando o **limiar de assertividade dinâmico** do `RiskManager`.
    5.  **Executar Ordem:** Se a condição for cumprida, executa a ordem de acordo com o `contractType` e entra em *cooldown*.
    6.  **Expor Estado para a UI:** O hook expõe o estado atual (ex: "Gatilho Detectado: EXECUTANDO" ou "Aguardando Gatilho"), as taxas de assertividade e o **estado atual do Gestor de Risco** para a interface.

### 2.2. Interface de Comando: `master-autopilot-interface.tsx`

Este componente fornece ao operador o controlo e a visibilidade total sobre o sistema.

*   **Seletores de Configuração:** Para tipo de contrato e gestão de risco.
*   **Painéis de Status em Tempo Real:**
    *   **Status do Gatilho:** Mostra o estado atual da lógica de decisão.
    *   **Painel de Assertividade:** Exibe o desempenho de cada especialista preditivo.
    *   **NOVO: Gestor de Risco Adaptativo:** Um novo painel que mostra o **modo atual do piloto** (`Normal` ou `Cauteloso`), o **limiar de assertividade dinâmico** em uso, e a razão para o último ajuste, tornando o processo de aprendizagem 100% transparente.
