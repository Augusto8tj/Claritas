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
    *   **Execução Especializada:** Expõe a função `executeTrade`, construída para enviar os tipos de contrato específicos de dígitos: `DIGITMATCH` e `DIGITDIFF`, entre outros.

### 2.2. O Cérebro Estatístico: `use-robot-council-digits.ts`

Este é o motor de análise e decisão do piloto automático.

*   **Responsabilidade Principal:** Analisar a distribuição de frequência dos dígitos e tomar decisões de trading.
*   **Ciclo de Decisão (a cada novo tick):**
    1.  **Análise de Frequência:** A cada novo tick, o hook recalcula as `digitStats`. Ele analisa os últimos 1000 ticks e conta a ocorrência de cada dígito final (0 a 9).
    2.  **Cálculo de Probabilidade:** Converte estas contagens em probabilidades percentuais.
    3.  **Decisão do Conselho (`councilDecision`):**
        *   Identifica o dígito **mais provável** (maior frequência). Se a sua probabilidade ultrapassar o `consensusThreshold` (limiar de consenso) definido pelo utilizador, o sistema emite um sinal de `differs` para esse dígito.
        *   Identifica o dígito **menos provável** (menor frequência) para uma potencial aposta de `matches`.
    4.  **Execução Automática:** Um `useEffect` observa as decisões dos pilotos. Se um sinal válido (`differs`, `matches`, etc.) é emitido e um piloto está ligado, ele chama a função `executeTrade` com os parâmetros corretos.

### 2.3. A Interface do Utilizador (UI): `deriv-trader-digits/page.tsx` e Componentes

Esta camada visualiza a análise estatística e permite a interação manual ou automática.

*   **`deriv-trader-digits/page.tsx`**: O orquestrador principal que une os hooks e componentes.
*   **`deriv-trader-interface-digits.tsx`**: O painel de negociação manual, onde o utilizador seleciona um dígito (0-9) e pode executar trades de "Combina", "Difere", "Acima/Abaixo" e "Par/Ímpar".
*   **`council-autopilot-interface-digits.tsx`**: O painel de controlo do piloto automático, onde o utilizador ativa cada um dos bots especialistas e define seus parâmetros.
*   **`DigitsDashboard.tsx`**: O "rosto" do cérebro. Exibe de forma clara as conclusões dos bots, a qualidade do sinal e o status do Vagalume.
*   **`digit-stats-chart.tsx`**: Um gráfico de barras que mostra a frequência visual de cada um dos 10 dígitos nos últimos 1000 ticks.
*   **`operations-log-digits.tsx`**: Exibe o histórico de operações de dígitos da sessão, mostrando o resultado e o P&L.

---

## 3. Como Pode Ser Lucrativo no Caos? A Vantagem Estatística

A chave para a lucratividade não é prever o futuro, mas sim **arbitrar a diferença entre a probabilidade estatística de curto prazo e o payout (retorno) oferecido pela corretora**.

1.  **A Base Teórica (Lei dos Grandes Números):** Um gerador de números aleatórios perfeito, como o do "Volatility 10 Index", deve, a longo prazo, produzir cada um dos 10 dígitos (0 a 9) com a mesma frequência: **10% para cada um**. O mercado é, por design, estatisticamente "justo" a longo prazo.

2.  **A Realidade (Desvios de Curto Prazo):** No curto prazo, a aleatoriedade cria "clusters" ou "sequências". É perfeitamente normal que, nos últimos 1000 ticks, o dígito '7' tenha aparecido 15% das vezes e o dígito '2' apenas 5%. Estes desvios da média de 10% são a nossa oportunidade.

3.  **A Estratégia de Arbitragem:**
    *   **Contrato "Difere" (Baixo Risco, Baixo Retorno):**
        *   **Cenário:** O dígito '7' está "quente", aparecendo 18% das vezes nos últimos 1000 ticks.
        *   **Lógica:** A probabilidade estatística de o próximo dígito **NÃO** ser '7' é de 82%.
        *   **O Trade:** A corretora oferece um payout de ~10% para um contrato `DIGITDIFF 7`. Embora o retorno seja baixo, a nossa probabilidade de ganhar (82%) é muito maior do que a probabilidade implícita no payout. Operamos com uma vantagem estatística a nosso favor.

    *   **Contrato "Combina" (Alto Risco, Alto Retorno):**
        *   **Cenário:** O dígito '2' está "frio", aparecendo apenas 4% das vezes.
        *   **Lógica:** A Lei da Regressão à Média sugere que o '2' está "atrasado" e precisa aparecer mais vezes para voltar à sua média de 10%.
        *   **O Trade:** A corretora oferece um payout de ~950% para um contrato `DIGITMATCH 2`. A probabilidade é baixa (em torno de 10%), mas o retorno massivo pode compensar as perdas se conseguirmos identificar o momento certo da regressão.

Em resumo, **o sistema não prevê o preço, ele mede a distorção estatística atual e a compara com os retornos oferecidos, procurando e executando apenas as apostas que têm uma expectativa matemática positiva.** É uma forma pura de trading quantitativo.