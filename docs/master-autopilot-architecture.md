# Claritas Copilot - Arquitetura Técnica: Master Autopilot

Este documento detalha a arquitetura do **Master Autopilot**, um sistema de comando e controlo que unifica todos os ecossistemas de trading do Claritas sob uma única inteligência preditiva.

---

## 1. Filosofia de Design: O Cérebro Preditivo Unificado

O Master Autopilot abandona a ideia de múltiplos sistemas operando em silos. Em vez disso, ele implementa um **cérebro centralizado** que utiliza a nossa ferramenta mais avançada – o **Laboratório Preditivo (Análise de Volatilidade)** – como o seu principal motor de decisão.

**Princípios Fundamentais:**

1.  **Gatilho por Assertividade ("Certainty Trigger"):** A premissa central é que o sistema só deve operar quando tem uma **convicção estatística extremamente alta** de que o mercado está "legível" e previsível. Ele não opera com base num único indicador, mas sim na *performance comprovada* dos seus próprios modelos de previsão.
2.  **Lógica de Confirmação Dupla:** A regra de ouro para a execução é a **confirmação de assertividade em múltiplos horizontes de tempo**. Uma ordem só é considerada quando dois "especialistas temporais" vizinhos (ex: 6-ticks e 10-segundos) demonstram uma taxa de acerto direcional superior a 80% e concordam na mesma direção (`RISE` ou `FALL`).
3.  **Comando e Controlo Unificado:** Todas as configurações de risco (banca diária, meta de lucro) e de tipo de contrato (`Accumulators`, `Rise/Fall`, `Multipliers`) são geridas a partir de um único painel, a "Central de Comando".
4.  **Adaptação ao Contrato:** Embora o gatilho seja universal, a **ação de execução** é específica para cada tipo de contrato:
    *   **Rise/Fall & Multipliers:** Executa uma ordem direcional (`CALL`/`PUT`, `MULTUP`/`MULTDOWN`).
    *   **Accumulators:** Interpreta o gatilho não como um sinal de direção, mas como um sinal de **alta previsibilidade e estabilidade**, indicando uma excelente oportunidade para abrir um contrato de acumulador.

---

## 2. Arquitetura da Página `master-autopilot`

A página serve como a interface para este sistema central.

### 2.1. Cérebro Cognitivo: `use-master-autopilot.ts`

Este é o hook que contém toda a nova lógica de decisão.

*   **Responsabilidade Principal**: Consumir os dados preditivos, aplicar a lógica do "Gatilho de Assertividade" e determinar se uma oportunidade de trading existe.
*   **Ciclo de Decisão**:
    1.  **Consumir Dados Preditivos:** O hook integra a lógica do `StochasticLab` (originalmente da página de Análise de Volatilidade) para ter acesso em tempo real às projeções futuras e às taxas de assertividade de todos os seis horizontes de tempo.
    2.  **Monitorizar o Gatilho de Assertividade:** A cada ciclo, ele verifica a seguinte condição: "Existem dois horizontes de tempo vizinhos (ex: 10s e 20s) cuja assertividade seja > 80% e cujo 'voto' de direção seja o mesmo?"
    3.  **Determinar o Sinal:**
        *   Se a condição for cumprida, ele define um sinal claro (`RISE` ou `FALL`).
        *   Se a condição não for cumprida, ele permanece em `HOLD`, aguardando um momento de alta certeza preditiva.
    4.  **Expor Estado para a UI:** O hook expõe o estado atual (ex: "Gatilho Detectado: RISE" ou "Aguardando Gatilho") para a interface.

### 2.2. Interface de Comando: `master-autopilot-interface.tsx`

Este componente fornece ao operador o controlo total sobre o sistema.

*   **Seletores de Configuração:**
    *   **Tipo de Contrato:** Permite ao operador escolher qual ecossistema de trading o Master Autopilot irá controlar.
    *   **Gestão de Risco:** Inputs para definir a "Banca do Dia" e o "Alvo de Lucro".
*   **Painéis de Status em Tempo Real:**
    *   **Status do Gatilho:** Um painel de alerta que mostra claramente se o sistema está a aguardar um sinal ou se um gatilho de alta certeza foi detetado, incluindo a direção.
    *   **Painel de Assertividade:** Exibe o desempenho atual de cada um dos seis especialistas preditivos, permitindo ao operador ver "porquê" um gatilho foi (ou não foi) ativado.

Nesta primeira fase, o sistema está em **modo de análise**. Ele identifica e sinaliza as oportunidades de trading com base nesta nova e poderosa lógica, mas ainda não executa as ordens.
