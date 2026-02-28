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

4.  **NOVO - Análise Preditiva (Sherlock Holmes):**
    *   **Lógica de Markov:** Um novo especialista, apelidado de "Sherlock Holmes", analisa a **probabilidade condicional** dos dígitos. Ele responde à pergunta: "Dado que o último dígito foi X, qual a probabilidade de o próximo ser Y?".
    *   **Matriz de Transição:** O Sherlock constrói uma matriz em tempo real que mapeia a frequência com que cada dígito segue outro, com base nos últimos 500 ticks.
    *   **Trade de Bloco:** Para aumentar a robustez, em vez de apostar num único dígito de alta probabilidade (o que tem um payout baixo), ele analisa as propriedades do bloco de dígitos mais prováveis. Se a maioria dos dígitos prováveis for par, ele aposta em `DIGITEVEN`, que tem um payout mais alto, aumentando a expectativa de valor da estratégia.


---

## 2. Como Funciona? A Arquitetura em Camadas

A plataforma é sustentada por um conjunto de ficheiros dedicados que trabalham em conjunto.

### 2.1. Camada de Conexão e Dados: `use-deriv-api-digits.tsx`

Este hook é a espinha dorsal da comunicação, focado apenas no essencial para esta estratégia.

*   **Responsabilidade Principal:** Gerir a conexão WebSocket com a API da Deriv e fornecer um fluxo de dados de ticks em tempo real.
*   **Funções Chave:**
    *   **Conexão Focada:** Estabelece e mantém a conexão, autenticando o token do utilizador.
    *   **Stream de Ticks:** Subscreve *apenas* ao stream de `ticks` para o ativo selecionado. Não precisa de dados de velas (OHLC), o que a torna mais leve.
    *   **Estado `priceTicks`:** Mantém um array com os últimos 1000 ticks de preço recebidos, que é a "matéria-prima" para toda a análise.
    *   **Execução Especializada:** Expõe a função `executeTrade`, construída para enviar os tipos de contrato específicos de dígitos: `DIGITMATCH`, `DIGITDIFF`, entre outros.

### 2.2. O Cérebro Estatístico: `use-robot-council-digits.ts` e `use-sherlock-holmes.ts`

**a) O Cérebro Principal (`use-robot-council-digits.ts`):**

*   **Responsabilidade Principal:** Analisar a distribuição de frequência dos dígitos e tomar decisões de trading com base na regressão à média.
*   **Ciclo de Decisão (a cada novo tick):**
    1.  **Análise de Frequência:** A cada novo tick, o hook recalcula as `digitStats`. Ele analisa os últimos 1000 ticks e conta a ocorrência de cada dígito final (0 a 9).
    2.  **Cálculo de Probabilidade:** Converte estas contagens em probabilidades percentuais.
    3.  **Decisão do Conselho (`councilDecision`):**
        *   Identifica o dígito **mais provável** (maior frequência). Se a sua probabilidade ultrapassar o `consensusThreshold` (limiar de consenso) definido pelo utilizador, o sistema emite um sinal de `differs` para esse dígito.
        *   Identifica o dígito **menos provável** (menor frequência) para uma potencial aposta de `matches`.
    4.  **Execução Automática:** Um `useEffect` observa as decisões dos pilotos. Se um sinal válido (`differs`, `matches`, etc.) é emitido e um piloto está ligado, ele chama a função `executeTrade` com os parâmetros corretos.

**b) O Especialista Preditivo (`use-sherlock-holmes.ts`):**

*   **Responsabilidade Principal:** Analisar as probabilidades condicionais e tomar decisões baseadas em padrões sequenciais.
*   **Ciclo de Decisão:**
    1.  **Construção da Matriz de Transição:** Analisa os últimos 500 ticks para determinar a frequência com que o dígito `Y` aparece após o dígito `X`.
    2.  **Cálculo de Probabilidade Condicional:** Dado o último dígito que acabou de sair, ele calcula a probabilidade de cada um dos 10 dígitos ser o próximo.
    3.  **Análise de Bloco:** Em vez de apostar no dígito individual mais provável, ele agrega as probabilidades em blocos (Par/Ímpar, Acima/Abaixo de 5).
    4.  **Decisão de Trade:** Se a probabilidade de um bloco (ex: "Par") for significativamente alta (acima do limiar de confiança do Sherlock), ele gera um sinal para um contrato de bloco (`DIGITEVEN`), que possui um payout mais favorável.

### 2.3. A Interface do Utilizador (UI): `deriv-trader-digits/page.tsx` e Componentes

Esta camada visualiza a análise estatística e permite a interação manual ou automática.

*   **`deriv-trader-digits/page.tsx`**: O orquestrador principal que une os hooks e componentes.
*   **`deriv-trader-interface-digits.tsx`**: O painel de negociação manual, onde o utilizador seleciona um dígito (0-9) e pode executar trades de "Combina", "Difere", "Acima/Abaixo" e "Par/Ímpar".
*   **`council-autopilot-interface-digits.tsx`**: O painel de controlo para os pilotos baseados em frequência.
*   **`SherlockAutopilot.tsx`**: O novo painel de controlo dedicado ao bot Sherlock.
*   **`SherlockHolmesDashboard.tsx`**: O novo dashboard que exibe as análises e probabilidades condicionais do Sherlock.
*   **`DigitsDashboard.tsx`**: O dashboard que mostra os sinais dos bots baseados em frequência.
*   **`digit-stats-chart.tsx`**: Um gráfico de barras que mostra a frequência visual de cada um dos 10 dígitos nos últimos 1000 ticks.
*   **`operations-log-digits.tsx`**: Exibe o histórico de operações de dígitos da sessão, mostrando o resultado e o P&L.

---

## 3. Como Pode Ser Lucrativo no Caos? A Vantagem Estatística

A chave para a lucratividade não é prever o futuro, mas sim **arbitrar a diferença entre a probabilidade estatística (seja ela geral ou condicional) e o payout (retorno) oferecido pela corretora**.

*   **Estratégia de Frequência ("Difere"):**
    *   **Cenário:** O dígito '7' está "quente", aparecendo 18% das vezes.
    *   **Lógica:** A probabilidade estatística de o próximo dígito **NÃO** ser '7' é de 82%.
    *   **O Trade:** A corretora oferece um payout de ~10%. Embora o retorno seja baixo, a nossa probabilidade de ganhar (82%) é muito maior do que a probabilidade implícita no payout. Operamos com uma vantagem estatística a nosso favor.

*   **Estratégia Preditiva (Sherlock):**
    *   **Cenário:** O último dígito foi `3`. A análise do Sherlock mostra que, historicamente, após um `3`, os dígitos `8, 6, 2, 4` aparecem com uma frequência combinada de 65%.
    *   **Lógica:** Todos esses dígitos são pares. A probabilidade de o próximo dígito ser par é de 65%.
    *   **O Trade:** A corretora oferece um payout de ~95% para um contrato `DIGITEVEN`. Estamos a apostar num evento com 65% de chance de ocorrer para um retorno de quase 1 para 1, o que representa uma expectativa de valor (EV) massivamente positiva.

Em resumo, **o sistema não prevê o preço, ele mede a distorção estatística atual e a compara com os retornos oferecidos, procurando e executando apenas as apostas que têm uma expectativa matemática positiva.**