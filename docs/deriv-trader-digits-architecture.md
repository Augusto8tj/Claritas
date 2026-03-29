# Claritas Copilot - Arquitetura Técnica: Deriv Digits (Preditivo V2)

Este documento detalha a arquitetura da plataforma **Deriv Digits V2**, um ecossistema de trading que evoluiu de um simples analisador de frequência para um **motor preditivo com compensação de latência**, focado em arbitragem estatística do último dígito de preços.

---

## 1. Filosofia de Design: O Caçador Preditivo de Probabilidades

A V2 abandona a análise reativa e adota uma abordagem preditiva, reconhecendo que, em operações de alta frequência (1-5 ticks), a latência da rede é o principal adversário.

**Princípios Fundamentais:**

1.  **O Alvo é o Dígito, Não a Direção:** O sistema continua a focar-se exclusivamente em prever o **último dígito** do preço, ignorando a direção do mercado.

2.  **Foco em Mercados Puros (Sintéticos):** A estratégia permanece otimizada para os **Índices Sintéticos de Volatilidade**, onde a análise estatística é mais pura.

3.  **Aposta na Regressão à Média:** O sistema ainda usa a **Lei dos Grandes Números** como base, operando em desvios estatísticos da distribuição esperada de 10% para cada dígito.

4.  **NOVO: A Vantagem Sherlock Holmes - Negociar o Futuro, Não o Passado:**
    *   **O Problema Crítico da Latência:** Para contratos de 1 tick, um delay de 250ms significa que estamos a apostar num resultado de um tick que **já aconteceu**. É como atirar num alvo em movimento mirando onde ele *estava*.
    *   **A Solução Preditiva:** O sistema agora mede ativamente a sua própria latência e a usa para prever o futuro.
        1.  **Medição Contínua:** O hook `use-deriv-api-digits.tsx` mede o tempo de ciclo de cada trade.
        2.  **Cálculo de Compensação:** Se a latência média for de 250ms e cada tick dura 100ms, o sistema calcula que precisa prever **3 ticks no futuro**.
        3.  **Predição Multi-Passo (Modelos de Markov):** O cérebro (`use-robot-council-digits.tsx`) constrói uma **matriz de transição de Markov** e a multiplica por si mesma N vezes (`compensationSteps`) para obter as probabilidades dos dígitos **exatamente no momento em que a ordem será executada**.
    *   **A Analogia:** É a diferença entre atirar onde o alvo está e atirar para **onde o alvo estará**.

---

## 2. Como Funciona? A Arquitetura em Camadas (V2)

### 2.1. Camada de Conexão e Dados: `use-deriv-api-digits.tsx`

Este hook foi promovido para um componente crítico de medição.

*   **Responsabilidade Principal:** Gerir a conexão, fornecer o fluxo de ticks e **medir a latência do ciclo completo de cada trade**.
*   **Funções Chave:**
    *   **Conexão Robusta:** Mantém a conexão com a API da Deriv.
    *   **Stream de Ticks:** Fornece a "matéria-prima" para a análise.
    *   **Instrumentação de Latência:** Usa o `globalLatencyMonitor` para registar o tempo entre o envio da ordem e a receção do resultado, alimentando o cérebro preditivo.

### 2.2. O Cérebro Preditivo: `use-robot-council-digits.tsx`

Este é o motor unificado de análise e decisão.

*   **Responsabilidade Principal:** Gerir todos os pilotos, aplicar a compensação de latência e tomar decisões de trading.
*   **Ciclo de Decisão (a cada novo tick):**
    1.  **Análise de Frequência:** Recalcula as estatísticas de base (Z-Score, etc.).
    2.  **Monitorização de Latência:** Consulta o `globalLatencyMonitor` para obter a latência média e calcular o `compensationSteps`.
    3.  **Análise Preditiva (Sherlock Holmes):**
        *   Usa uma janela configurável (ex: últimos 500 ticks) para construir a matriz de transição de Markov.
        *   Chama a função `predictNTicksAhead`, passando os `compensationSteps`, para obter as probabilidades dos dígitos **N ticks no futuro**.
        *   Agrega estas probabilidades futuras em blocos (Par/Ímpar, Acima/Abaixo).
        *   Gera um `sherlockSignal` se a probabilidade de um bloco futuro exceder o limiar de confiança.
    4.  **Decisão e Execução:**
        *   Um `useEffect` principal observa os sinais de **todos** os pilotos (frequência e preditivos).
        *   Se um sinal válido é emitido, ele calcula o valor da aposta com base no histórico de perdas daquele piloto específico (lógica de Martingale).
        *   Envia a ordem de execução para a camada de API.

### 2.3. Serviços e Utilitários Dedicados

*   **`src/features/trading/utils/latency-monitor.ts`:** Um monitor singleton que calcula a latência média, P95 e os passos de compensação necessários.
*   **`src/features/trading/services/sherlock-multi-step.ts`:** A biblioteca matemática para a predição multi-passo, incluindo a construção da matriz de transição e a multiplicação de matrizes.

### 2.4. A Interface do Utilizador (UI)

A UI foi redesenhada para dar controlo total sobre as novas capacidades.

*   **`council-autopilot-interface-digits.tsx`**: Painel de controlo centralizado que agora inclui:
    *   Uma aba **"Especialistas"** onde se encontram os controlos para o **Vagalume** (detetor de sequências) e o **Sherlock Holmes** (preditivo).
    *   **Controlos Avançados do Sherlock:** Sliders para ajustar o **"Limiar de Confiança"** e a **"Janela de Análise"**, e um interruptor para **ativar/desativar a Compensação de Latência**.
*   **`DigitsDashboard.tsx`**: O dashboard principal agora integra e exibe:
    *   **`LatencyMonitorDashboard`:** Um novo painel que mostra as métricas de latência em tempo real.
    *   **`SherlockHolmesDashboard`:** O painel que exibe as probabilidades e recomendações do Sherlock, agora com a indicação dos `compensationSteps` que está a usar.

---

## 3. Conclusão: Uma Vantagem Decisiva

Ao medir e compensar a sua própria lentidão, a plataforma Deriv Digits V2 não está mais a reagir ao passado, mas sim a **antecipar ativamente o futuro mais provável**, transformando a latência de um inimigo numa vantagem estratégica.