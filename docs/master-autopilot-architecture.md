# Claritas Copilot - Arquitetura Técnica: Master Autopilot V5 (Regime-Aware)

Este documento detalha a arquitetura do **Master Autopilot V5**, uma evolução do sistema que o torna um **comandante tático, consciente do regime de mercado**.

---

## 1. Filosofia de Design: O Comandante Tático

O Master Autopilot V5 transcende a simples execução de sinais. Ele agora opera como um gestor de portfólio, selecionando a "arma" (tipo de contrato) correta para a "batalha" (condição de mercado) em questão.

**Princípios Fundamentais:**

1.  **Gatilho por Assertividade ("Certainty Trigger"):** O princípio central permanece. O sistema só opera quando tem alta convicção estatística de que o mercado está "legível". Esta convicção vem da **taxa de acerto** dos especialistas preditivos do `StochasticLab`.

2.  **Análise Tática de Regime:** Antes de considerar qualquer sinal, o piloto primeiro classifica o mercado usando um modelo HMM-lite, similar ao do Deriv Trader V2.5. Os regimes possíveis são:
    *   `trending_bull` (Tendência de Alta)
    *   `trending_bear` (Tendência de Baixa)
    *   `ranging` (Lateralizado / Baixa Volatilidade)
    *   `high_volatility` (Volatilidade Alta)
    *   `breakout` (Rompimento)

3.  **Validação de Compatibilidade Contrato-Regime:** O "pulo do gato" desta versão. Após identificar o regime, o piloto verifica se o tipo de contrato selecionado pelo operador é **taticamente compatível** com o cenário atual.
    *   **Exemplo 1:** Se o operador selecionou `Accumulators` e o mercado entra em `trending_bull`, o piloto **VETA** a execução, pois Accumulators são ideais para mercados laterais.
    *   **Exemplo 2:** Se o operador selecionou `Multipliers` e o mercado está em `trending_bear`, o piloto **VALIDA** a compatibilidade e procede para a análise de assertividade.

4.  **Lógica de Gatilho de Confirmação Tripla (O Funil de Decisão):**
    1.  O **regime de mercado** é detetado.
    2.  O **contrato selecionado** é compatível com o regime.
    3.  A **assertividade** preditiva de dois horizontes de tempo vizinhos (ou o especialista mais forte, dependendo da configuração) ultrapassa o limiar de risco dinâmico.
    4.  Para contratos direcionais, o sinal está **alinhado com a tendência macro** (EMA dinâmica e proporcional ao horizonte de tempo do sinal).

5.  **Gestor de Risco Adaptativo (Auto-Calibração):** Este mecanismo permanece, tornando o piloto mais cauteloso após perdas e mais confiante após vitórias, ao ajustar o limiar de assertividade.

---

## 2. Arquitetura da Página `master-autopilot`

### 2.1. Cérebro Cognitivo: `use-master-autopilot.ts` (Versão 5)

O cérebro foi reequipado para o pensamento tático.

*   **Responsabilidade Principal**: Analisar o contexto do mercado, validar a tática (contrato vs. regime), e só então procurar por sinais de alta probabilidade para executar a ordem.
*   **Ciclo de Decisão (Atualizado)**:
    1.  **Consumir Dados:** Integra as projeções do `StochasticLab` (a fonte de assertividade).
    2.  **Calcular Indicadores de Regime:** Calcula o ADX e o BBW para alimentar a detecção de regime.
    3.  **Deteção de Regime:** A cada ciclo, classifica o mercado num dos 5 regimes.
    4.  **Verificação de Compatibilidade Tática:** Compara o `contractType` selecionado na UI com o regime detetado. Se não for compatível, o processo para aqui e informa o operador.
    5.  **Análise Pós-Trade:** Ajusta o limiar de risco com base no desempenho.
    6.  **Verificar Gatilho de Assertividade:** Procura pela confirmação dupla de alta assertividade.
    7.  **Verificar Confirmação de Tendência:** Para contratos direcionais, verifica o alinhamento com a EMA dinâmica e proporcional.
    8.  **Executar Ordem:** Se todas as condições forem cumpridas, executa a ordem através do hook de API correspondente.

### 2.2. Interface de Comando: `master-autopilot-interface.tsx`

O cockpit foi atualizado com novos instrumentos para o comandante.

*   **Painéis de Status em Tempo Real:**
    *   **Painel de Análise Tática:** Um novo card crucial que mostra:
        *   O **regime de mercado** detetado em tempo real.
        *   Um indicador claro (`Sim` ou `Não`) de se o contrato selecionado é **compatível** com o regime atual.
    *   Painel de Assertividade, Gestor de Risco e Análise de Tendência Macro (mantidos).
*   **Controlo Manual Inteligente:** O botão de execução manual agora também pode levar em conta a compatibilidade do regime.
