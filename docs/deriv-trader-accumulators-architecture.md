# Claritas Copilot - Arquitetura Técnica: Deriv Accumulators

Este documento detalha a arquitetura do sistema **Deriv Accumulators**, uma plataforma de trading desenhada para explorar a volatilidade dos mercados sintéticos da Deriv. Este sistema representa uma mudança de paradigma em relação ao trading direcional (Rise/Fall).

---

## 1. Filosofia de Design: O Mestre da Volatilidade

O Deriv Accumulators abandona a necessidade de prever a direção do mercado. O seu único objetivo é apostar na **estabilidade da volatilidade**. O contrato é ganho se o preço do ativo permanecer dentro de uma faixa definida, acumulando ganhos a cada tick.

**Princípios Fundamentais:**

1.  **A Volatilidade é o Alvo:** O sucesso não depende de o preço subir ou descer, mas sim de ele **não se mover de forma explosiva**. O sistema deve ser capaz de identificar períodos de baixa volatilidade para maximizar a probabilidade de sucesso.
2.  **Taxa de Crescimento vs. Risco:** A "Taxa de Crescimento" (Growth Rate) é o parâmetro central. Taxas mais altas oferecem um retorno potencial maior, mas estreitam as barreiras, aumentando o risco. O sistema deve encontrar um equilíbrio ótimo entre ganho e risco.
3.  **Análise de Desvio Padrão:** Indicadores como as Bandas de Bollinger e o ATR (Average True Range) são cruciais. Bandas estreitas e um ATR baixo são os principais indicadores de que o mercado está em um estado de "calmaria", ideal para os Acumuladores.
4.  **O Tempo é Irrelevante (no Contrato):** Ao contrário das opções, os Acumuladores não têm um tempo de expiração fixo. Eles continuam a acumular ganhos enquanto o preço se mantiver dentro das barreiras. A decisão de fechar uma posição é puramente estratégica, baseada no lucro atingido ou numa mudança nas condições de volatilidade.

---

## 2. Arquitetura em Camadas (Baseada no V1)

O sistema foi construído sobre a fundação estável do Deriv Trader V1, adaptando-o para a nova lógica de trading.

### 2.1. Camada de Conexão: `use-deriv-api-accumulators.tsx`

Esta é a ponte de comunicação dedicada para o ambiente de Acumuladores.

*   **Responsabilidade Principal**: Gerir a conexão WebSocket e o estado do ambiente de Acumuladores.
*   **Funções Chave**:
    *   **Execução de Contrato `ACCU`**: A função `executeTrade` foi totalmente reescrita para enviar o tipo de contrato `ACCU`, incluindo os novos parâmetros como `growth_rate`.
    *   **Gestão de Estado**: Mantém o `operationsLog` para Acumuladores e outros estados essenciais, de forma isolada dos outros sistemas.

### 2.2. (Futuro) Cérebro Cognitivo: `use-robot-council-accumulators.ts`

Este hook foi criado, mas a sua lógica ainda é um espelho do V1. A sua evolução será o próximo passo no desenvolvimento.

*   **Visão Futura**:
    1.  **Decisão de "Comprar" ou "Esperar"**: Em vez de votar `RISE`/`FALL`, os robôs votarão `BUY` se as condições de baixa volatilidade forem atendidas, ou `HOLD` caso contrário.
    2.  **Análise de Volatilidade**: O conselho de robôs será composto por especialistas em volatilidade (ex: BBW, ATR, desvio padrão).
    3.  **Seleção da Taxa de Crescimento**: A IA poderá sugerir a taxa de crescimento ideal com base na volatilidade atual do mercado (ex: taxa de 1% em mercados calmos, taxa de 5% em mercados ligeiramente mais ativos, mas ainda contidos).
    4.  **Gestão de Saída**: O sistema decidirá quando fechar uma posição lucrativa, talvez após um número X de ticks ou se a volatilidade começar a aumentar perigosamente.

### 2.3. Camada de Interface: `deriv-trader-accumulators/page.tsx`

A interface do utilizador, totalmente redesenhada para a simplicidade dos Acumuladores.

*   **Responsabilidade Principal**: Fornecer uma interface clara e direta para a compra de contratos Acumuladores.
*   **Componentes Chave**:
    *   `DerivTraderInterfaceAccumulators`: O painel de negociação principal. Remove a complexidade de direção e tempo, focando-se em:
        *   **Valor da Aposta (Stake)**: O capital a ser arriscado.
        *   **Taxa de Crescimento (Growth Rate)**: Um slider que permite ao operador escolher o seu apetite de risco (de 1% a 5%).
        *   **Botão Único de Compra**: Um único botão para iniciar a operação.
    *   `OperationsLogAccumulators`: Um log de operações adaptado para mostrar os detalhes específicos dos contratos `ACCU`, como o lucro acumulado em tempo real.

Este design cria um ambiente focado e especializado, pronto para que possamos construir e testar as nossas novas estratégias de negociação de volatilidade.