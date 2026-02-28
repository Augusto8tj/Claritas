# Claritas Copilot - Arquitetura Técnica: Deriv Digits

Este documento detalha a arquitetura da plataforma **Deriv Digits**, um ecossistema de trading focado em **arbitragem estatística** sobre o último dígito de preços de ativos, como o "Volatility 10 (1s) Index".

---

## 1. Filosofia de Design: O Caçador de Probabilidades

Ao contrário das outras plataformas que se focam na direção do preço (subida/queda), a "Digits" opera num paradigma diferente:

1.  **O Alvo é o Dígito, Não a Direção:** O sistema não se importa se o preço sobe ou desce. A sua única preocupação é prever o **último dígito** do preço do ativo (ex: em 123.4**5**, o último dígito é 5).

2.  **Foco em Mercados Puros (Sintéticos):** A estratégia é otimizada para os **Índices Sintéticos de Volatilidade**. Como estes índices são gerados por um algoritmo de números aleatórios criptograficamente seguro, eles estão livres de "ruído" de eventos económicos (notícias, relatórios, etc.). Isto torna a análise estatística da distribuição dos dígitos mais pura e teoricamente mais fiável.

3.  **Aposta na Regressão à Média:** O sistema opera com base em duas hipóteses simples fundamentadas na **Lei dos Grandes Números**:
    *   **"Difere" (Digit Differ):** Se um dígito apareceu com uma frequência estatisticamente *alta* recentemente (está "quente"), a probabilidade de o próximo tick NÃO terminar nesse dígito aumenta.
    *   **"Combina" (Digit Match):** Se um dígito apareceu com uma frequência estatisticamente *baixa* (está "atrasado" ou "frio"), a probabilidade de ele aparecer no próximo tick aumenta, seguindo a tendência de regressão à média.

4.  **NOVO - Análise Preditiva (Sherlock Holmes) com Compensação de Latência:**
    *   **O Desafio do Delay:** Para contratos de 1 tick, um delay de 150-300ms entre a análise e a execução significa que estamos a apostar no resultado de um tick que **já aconteceu**.
    *   **A Solução Preditiva:** O Sherlock Holmes agora mede a latência média do sistema. Se a latência for, por exemplo, de 250ms, ele sabe que precisa prever não o próximo tick, mas o tick que ocorrerá daqui a 2 ou 3 ticks.
    *   **Matriz de Transição Multi-Passo:** Ele usa o poder dos **Modelos de Markov** para calcular a probabilidade dos dígitos N passos no futuro, compensando ativamente o delay do sistema e apostando no futuro que realmente importa.
    *   **Trade de Bloco:** A sua lógica de trade permanece a mesma: ele analisa as propriedades do bloco de dígitos mais prováveis *no futuro previsto* e aposta no contrato de bloco (ex: `DIGITEVEN`) com a maior expectativa de valor.

---

## 2. Como Funciona? A Arquitetura em Camadas

A plataforma é sustentada por um conjunto de ficheiros dedicados que trabalham em conjunto.

### 2.1. Camada de Conexão e Dados: `use-deriv-api-digits.tsx`

Este hook é a espinha dorsal da comunicação, agora com instrumentação para medir a latência.

*   **Responsabilidade Principal:** Gerir a conexão WebSocket e fornecer um fluxo de dados de ticks em tempo real.
*   **Funções Chave:**
    *   **Conexão Focada:** Estabelece e mantém a conexão, autenticando o token do utilizador.
    *   **Stream de Ticks:** Subscreve *apenas* ao stream de `ticks` para o ativo selecionado.
    *   **Instrumentação de Latência:** Agora regista o timestamp exato em que uma ordem é enviada e quando o resultado (`proposal_open_contract`) é recebido, alimentando o `globalLatencyMonitor` com dados do mundo real.

### 2.2. O Cérebro Estatístico: `use-robot-council-digits.tsx`

Este é o motor de análise e decisão do piloto automático, agora unificado para gerir todas as estratégias, incluindo a do Sherlock Holmes.

*   **Responsabilidade Principal:** Gerir os pilotos, analisar a distribuição de frequência, as sequências de dígitos e **aplicar a compensação de latência** para tomar decisões.
*   **Ciclo de Decisão (a cada novo tick):**
    1.  **Análise de Frequência:** Recalcula as `digitStats` (frequência, z-score, etc.) e o consenso multi-janela.
    2.  **Monitorização de Latência:** Consulta o `globalLatencyMonitor` para obter a latência média e calcular o `compensationSteps` (quantos ticks no futuro prever).
    3.  **Análise Preditiva (Sherlock Holmes):**
        *   Chama `buildTransitionMatrix` para obter o modelo de Markov dos últimos 500 ticks.
        *   Chama `predictNTicksAhead`, passando o `compensationSteps`, para obter as probabilidades dos dígitos **N ticks no futuro**.
        *   Agrega as probabilidades futuras em blocos (Par/Ímpar, Acima/Abaixo).
        *   Gera um `sherlockSignal` se a probabilidade de um bloco exceder o `sherlockThreshold`.
    4.  **Decisão e Execução:**
        *   Um `useEffect` principal observa os sinais de **todos** os pilotos ativos.
        *   Se um sinal válido é emitido (seja de frequência ou do Sherlock), ele chama o `decideNextStake`.
        *   O `decideNextStake` analisa o histórico de perdas daquele piloto específico, aplica a lógica de Martingale e retorna o valor final da aposta.
        *   O sistema então chama a função `executeTrade`, agora com o `tickEpoch` para iniciar a medição de latência.

### 2.3. Serviços e Utilitários

*   **`src/features/trading/utils/latency-monitor.ts` (NOVO):** Um monitor singleton que rastreia os tempos de ciclo de cada trade para calcular a latência média, P95 e o número de passos de compensação necessários.
*   **`src/features/trading/services/sherlock-multi-step.ts` (NOVO):** Contém a lógica matemática pura para a predição multi-passo, incluindo `buildTransitionMatrix` e `predictNTicksAhead`.

### 2.4. A Interface do Utilizador (UI)

*   **`src/app/deriv-trader-digits/page.tsx`**: O orquestrador que une todos os hooks e componentes.
*   **`src/features/trading/components/deriv-trader/council-autopilot-interface-digits.tsx`**: O painel de controlo foi unificado. Agora inclui uma nova aba **"Especialistas"**, onde se encontram os controlos tanto para o **Vagalume** quanto para o **Sherlock Holmes**.
*   **`src/features/trading/components/deriv-trader/DigitsDashboard.tsx`**: O dashboard principal agora integra e exibe:
    *   **`LatencyMonitorDashboard` (NOVO):** Um novo painel que mostra as métricas de latência em tempo real.
    *   **`SherlockHolmesDashboard`:** O painel que exibe as probabilidades e recomendações do Sherlock, agora com a indicação dos `compensationSteps` que está a usar.

---

## 3. A Vantagem Preditiva: Antecipando o Futuro

O sistema não prevê o futuro com uma bola de cristal, mas sim **compensa a demora do presente**. Ao medir a sua própria lentidão, ele ajusta a sua mira para o ponto no tempo onde a "bala" (a ordem) realmente irá aterrar, aumentando drasticamente a probabilidade de acerto para operações de curtíssimo prazo. É a diferença entre atirar onde o alvo está e atirar para onde o alvo **estará**.