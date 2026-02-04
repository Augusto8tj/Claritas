# Claritas Copilot - Arquitetura Técnica: Deriv Digits

Este documento detalha a arquitetura da plataforma **Deriv Digits**, um ecossistema de trading focado em **arbitragem estatística** sobre o último dígito de preços de ativos.

---

## 1. Filosofia de Design: O Caçador de Probabilidades

Ao contrário das outras plataformas que se focam na direção do preço (subida/queda), a "Digits" opera num paradigma diferente:

1.  **O Alvo é o Dígito, Não a Direção:** O sistema não se importa se o preço sobe ou desce. A sua única preocupação é prever o **último dígito** do preço do ativo (ex: em 123.4**5**, o último dígito é 5).
2.  **Foco em Mercados Puros:** A estratégia é otimizada para os **Índices Sintéticos de Volatilidade**. Como estes índices são gerados por um algoritmo de números aleatórios criptograficamente seguro, eles estão livres de "ruído" de eventos económicos (notícias, relatórios, etc.). Isto torna a análise estatística da distribuição dos dígitos mais pura e teoricamente mais fiável.
3.  **Aposta na Frequência:** O sistema opera com base em duas hipóteses simples:
    *   **"Difere" (Digit Differ):** Se um dígito apareceu com uma frequência estatisticamente *alta* recentemente, a probabilidade de o próximo tick NÃO terminar nesse dígito aumenta.
    *   **"Combina" (Digit Match):** Se um dígito apareceu com uma frequência estatisticamente *baixa* (está "atrasado"), a probabilidade de ele aparecer no próximo tick aumenta, seguindo a lei da regressão à média.

---

## 2. Ecossistema de Ficheiros e Responsabilidades

A plataforma é sustentada por um conjunto de ficheiros dedicados que trabalham em conjunto.

### 2.1. Camada de Conexão e Dados: `use-deriv-api-digits.tsx`

Este hook é a espinha dorsal da comunicação, focado apenas no essencial para esta estratégia.

*   **Responsabilidade Principal:** Gerir a conexão WebSocket com a API da Deriv e fornecer um fluxo de dados de ticks.
*   **Funções Chave:**
    *   **Conexão Focada:** Estabelece e mantém a conexão, autenticando o token do utilizador.
    *   **Stream de Ticks:** Subscreve *apenas* ao stream de `ticks` para o ativo selecionado. Não precisa de dados de velas (OHLC), o que a torna mais leve.
    *   **Estado `priceTicks`:** Mantém um array com os últimos 1000 ticks de preço recebidos, que é a "matéria-prima" para toda a análise.
    *   **Execução Especializada:** Expõe a função `executeTrade`, construída para enviar os tipos de contrato específicos de dígitos: `DIGITMATCH` e `DIGITDIFF`.

### 2.2. O Cérebro Estatístico: `use-robot-council-digits.ts`

Este é o motor de análise e decisão do piloto automático.

*   **Responsabilidade Principal:** Analisar a distribuição de frequência dos dígitos e tomar decisões de trading.
*   **Ciclo de Decisão:**
    1.  **Análise de Frequência:** A cada novo tick, o `useMemo` dentro do hook recalcula as `digitStats`. Ele analisa os últimos 1000 ticks e conta a ocorrência de cada dígito final (0 a 9).
    2.  **Cálculo de Probabilidade:** Converte estas contagens em probabilidades percentuais.
    3.  **Decisão do Conselho (`councilDecision`):**
        *   Identifica o dígito **mais provável** (maior frequência). Se a sua probabilidade ultrapassar o `consensusThreshold` (limiar de consenso) definido pelo utilizador, o sistema emite um sinal de `differs` para esse dígito.
        *   Identifica o dígito **menos provável** (menor frequência) para uma potencial aposta de `matches`.
    4.  **Execução Automática:** Um `useEffect` observa o `councilDecision`. Se um sinal válido (`differs` ou `matches`) é emitido e o piloto está ligado, ele chama a função `executeTrade` com os parâmetros corretos.

### 2.3. A Interface do Utilizador (UI): `deriv-trader-digits/page.tsx` e Componentes

Esta camada visualiza a análise estatística e permite a interação manual ou automática.

*   **`deriv-trader-digits/page.tsx`**: O orquestrador principal que une os hooks e componentes.
*   **`deriv-trader-interface-digits.tsx`**: O painel de negociação manual, onde o utilizador seleciona um dígito (0-9) e pode executar trades de "Combina" ou "Difere".
*   **`council-autopilot-interface-digits.tsx`**: O painel de controlo do piloto automático, onde o utilizador ativa o bot e define o **Limiar de Probabilidade (%)** que o bot usará para decidir se deve operar.
*   **`ai-trade-suggestion-digits.tsx`**: O "rosto" do cérebro. Exibe de forma clara as conclusões do `useRobotCouncilDigits`: qual é o dígito mais provável para uma aposta "Difere" e o mais provável para uma aposta "Combina".
*   **`digit-stats-chart.tsx`**: Um gráfico de barras que mostra a frequência visual de cada um dos 10 dígitos nos últimos 1000 ticks.
*   **`operations-log-digits.tsx`**: Exibe o histórico de operações de dígitos da sessão.
