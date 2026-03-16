# Claritas Copilot - Arquitetura Técnica: Deriv Reset Call/Put

Este documento detalha a arquitetura do sistema **Deriv Reset Call/Put**, uma plataforma de trading desenhada para capitalizar em tendências com uma rede de segurança, utilizando os contratos de "Reset" da Deriv.

---

## 1. Filosofia de Design: A Segunda Chance na Tendência

A estratégia desta plataforma é uma evolução do seguimento de tendência clássico. Ela opera com base na premissa de que mesmo as tendências mais fortes sofrem *pullbacks* (correções temporárias). O contrato "Reset" é a ferramenta perfeita para mitigar o risco desses pullbacks.

**Princípios Fundamentais:**

1.  **Seguir a Tendência é Prioridade:** O sistema, similarmente aos Multiplicadores, identifica a tendência macro com uma **Média Móvel Exponencial (EMA) de 100 períodos** e só opera a favor dela. Não tenta prever topos ou fundos.

2.  **Entrada por Confirmação de Momentum:** Uma entrada é feita quando um indicador de momentum de curto prazo (o **RSI de 14 períodos**) confirma que a tendência principal está a retomar a força após um pequeno *pullback*.
    *   **Sinal de Compra:** Ocorre quando o preço está acima da EMA de 100 **E** o RSI cruza para cima do nível 50.
    *   **Sinal de Venda:** Ocorre quando o preço está abaixo da EMA de 100 **E** o RSI cruza para baixo do nível 50.

3.  **A Barreira de Reset como Stop-Loss Dinâmico:** O coração da estratégia. A barreira de reset não é colocada aleatoriamente. Ela é posicionada dinamicamente com base na volatilidade do mercado (usando o **ATR - Average True Range**).
    *   **Em mercados de baixa volatilidade:** A barreira pode ser mais apertada, pois os *pullbacks* esperados são menores.
    *   **Em mercados de alta volatilidade:** A barreira é colocada mais longe para dar mais "espaço para respirar" ao preço, evitando que um *pullback* normal acione o reset desnecessariamente.

4.  **O "Reset" como Oportunidade:** Se o mercado reverte temporariamente e atinge a barreira, o preço de entrada do contrato é ajustado para aquele nível. Isto transforma o que seria um stop-loss numa nova e melhorada posição de entrada, dando à operação uma segunda chance de sucesso quando a tendência principal for retomada.

5.  **Gestão de Risco (Martingale):** Para recuperar perdas de forma controlada, o sistema pode ser configurado para usar uma estratégia de Martingale, onde a aposta é aumentada após uma perda. Um "disjuntor" (circuit breaker) pausa o piloto se um número máximo de perdas consecutivas for atingido.

---

## 2. Arquitetura em Camadas

### 2.1. Camada de Conexão: `use-deriv-api-reset.tsx`

Este hook é a ponte de comunicação exclusiva para contratos `RESETCALL` e `RESETPUT`.

*   **Responsabilidade Principal**: Gerir a conexão WebSocket e a execução de ordens com os parâmetros `barrier_offset` e `reset_barrier_offset`.
*   **Funções Chave**:
    *   **Conexão Robusta:** Contém a lógica completa de conexão, autenticação e reconexão.
    *   **Validação de Contratos:** Faz uma chamada à API (`contracts_for`) para determinar as durações de contrato permitidas para o ativo selecionado.
    *   **Execução Especializada**: A função `executeTrade` envia os parâmetros específicos para os contratos de Reset.
    *   **Gestão de Posições**: Ouve os streams `proposal_open_contract` e `transaction` para monitorizar o estado das posições, incluindo se um "reset" ocorreu.

### 2.2. Cérebro Cognitivo: `use-reset-call-put-strategy.ts`

Este hook contém a lógica de decisão para a estratégia de Reset.

*   **Responsabilidade Principal**: Identificar tendências, calcular a posição ótima da barreira de reset, gerir o risco e executar trades.
*   **Ciclo de Decisão**:
    1.  **Análise de Tendência Macro**: Utiliza uma EMA de 100 períodos para determinar se o viés é de alta ou de baixa.
    2.  **Cálculo de Volatilidade (ATR)**: Calcula o Average True Range (ATR) para medir a volatilidade recente do mercado.
    3.  **Cálculo da Barreira de Reset Dinâmica**: O `reset_barrier_offset` é calculado como um múltiplo do ATR (ex: `ATR * 2.5`). Isto garante que a barreira se adapta às condições do mercado.
    4.  **Sinal de Entrada (Momentum)**: Aguarda por um sinal de confirmação, como o RSI a cruzar o nível 50 na direção da tendência macro.
    5.  **Execução**: Se todas as condições são cumpridas, o hook chama a função `executeTrade` do `use-deriv-api-reset` com a direção, o `stake` (ajustado pelo Martingale, se ativo) e o `reset_barrier_offset` calculado.
    6.  **Monitorização de Risco**: Atualiza o contador de perdas consecutivas e ajusta o próximo `stake` se necessário.

### 2.3. Camada de Interface: `deriv-trader-reset/page.tsx`

A interface permite a interação manual e a supervisão do piloto automático.

*   **`DerivTraderInterfaceReset`**: Painel de negociação manual que inclui:
    *   Controlo de `Stake`.
    *   Campo para a `duração` do contrato.
    *   Um slider ou campo para o `reset_barrier_offset`, que também pode ser preenchido automaticamente pela sugestão da IA.
    *   Botões de `Reset Call` e `Reset Put`.
*   **`ResetAutopilotInterface`**: Painel para ligar/desligar o piloto automático, definir o risco diário e visualizar as decisões da IA (tendência detectada, barreira calculada). O painel também inclui controlos para a estratégia de Martingale.
*   **`OperationsLogReset`**: Um log de operações que destaca quando um contrato sofreu um "reset".
*   **`MarketChart`**: O gráfico principal, que pode ser aprimorado para visualizar a barreira de reset da posição aberta.

Este ecossistema combina uma estratégia de tendência comprovada com o mecanismo de segurança único dos contratos de "Reset", criando uma abordagem robusta e adaptativa ao trading.
