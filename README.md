# Claritas Copilot - Arquitetura Técnica e Ecossistema de Trading

Bem-vindo à documentação técnica do **Claritas Copilot**, um ambiente de trading de alta frequência impulsionado por múltiplos motores cognitivos e plataformas de negociação especializadas.

Este documento serve como guia central para a arquitetura do sistema, detalhando a filosofia de design, os componentes de código e os princípios operacionais de cada uma das nossas plataformas de trading.

## Ecossistema de Trading: Arquitetura por Plataforma

O Claritas Copilot não é um único sistema, mas um conjunto de ecossistemas de trading isolados, cada um com uma filosofia e arquitetura distintas, otimizados para diferentes tipos de contratos e condições de mercado.

---

### 1. Deriv Trader V1 (`/deriv-trader`)

**A Fundação Cognitiva.** O nosso sistema de produção mais estável e a base de muitos dos nossos princípios quantitativos.

*   **Princípios de Funcionamento:**
    *   **Consenso Adaptativo:** Um conselho de 22 robôs vota na direção do mercado.
    *   **Meritocracia por Desempenho:** Votos são ponderados pelo `Sharpe Ratio` de cada robô, dando mais poder aos mais consistentes.
    *   **Gestão de Risco Científica:** O valor da aposta (`stake`) é calculado usando o Critério de Kelly Fracionado.
    *   **Memória Estratégica:** Aprende e guarda no Firestore o "perfil" de cada ativo, permitindo colaboração Homem-Máquina.
    *   **Documento de Arquitetura:** `docs/deriv-trader-v1-architecture.md`

*   **Ficheiros Chave:**
    *   **Página:** `src/app/deriv-trader/page.tsx`
    *   **API Hook:** `src/features/trading/hooks/use-deriv-api-v1.tsx`
    *   **Cérebro Cognitivo:** `src/features/trading/hooks/use-robot-council-v1.ts`
    *   **Evolução:** `src/features/trading/hooks/use-strategy-evolution-v1.ts`

---

### 2. Deriv Trader V2.5 (`/deriv-trader-v2`)

**O Cérebro Quantitativo Avançado.** A nossa implementação mais sofisticada de trading por consenso, operando como uma mesa de operações completa.

*   **Princípios de Funcionamento:**
    *   **Deteção de Regime de Mercado:** Classifica o mercado (`trending`, `ranging`, etc.) e ativa apenas os robôs especialistas adequados.
    *   **Consenso Bayesiano:** A confiança de cada robô é calibrada pelo seu desempenho histórico *naquele regime específico*.
    *   **Veto de Microestrutura:** Analisa os últimos ticks para detetar anomalias e vetar operações de risco.
    *   **Evolução Genética Acelerada:** Os piores robôs são substituídos por "mutações" dos robôs de elite.
    *   **Documento de Arquitetura:** `ARQUITETURA.md`

*   **Ficheiros Chave:**
    *   **Página:** `src/app/deriv-trader-v2/page.tsx`
    *   **API Hook:** `src/features/trading/hooks/use-deriv-api-v2.tsx`
    *   **Cérebro Cognitivo:** `src/features/trading/hooks/use-robot-council-v2.ts`
    *   **Evolução:** `src/features/trading/hooks/use-strategy-evolution-v2.ts`
    *   **Serviços Avançados:** `src/features/trading/services/advanced-trading-services.ts`

---

### 3. Deriv Trader V3.0 (`/deriv-trader-v3`)

**O Laboratório de IA (IA Lab).** Um ambiente de testes isolado para experimentar com arquiteturas de IA radicais sem comprometer a estabilidade dos sistemas de produção.

*   **Princípios de Funcionamento:**
    *   **Deteção de Regime Hierárquica:** Classifica o mercado em três níveis (Macro, Meso, Micro) para permitir decisões mais contextuais.
    *   **Isolamento Total:** Duplicação de todos os hooks e componentes para garantir que a experimentação não afete outros sistemas.

*   **Ficheiros Chave:**
    *   **Página:** `src/app/deriv-trader-v3/page.tsx`
    *   **API Hook:** `src/features/trading/hooks/use-deriv-api-v3.tsx`
    *   **Cérebro Cognitivo:** `src/features/trading/hooks/use-robot-council-v3.ts`
    *   **Evolução:** `src/features/trading/hooks/use-strategy-evolution-v3.ts`

---

### 4. Deriv Multipliers (`/deriv-trader-multipliers`)

**O Seguidor de Tendência "Padrão Ouro".** Uma plataforma especializada em seguir tendências de forma disciplinada.

*   **Princípios de Funcionamento:**
    *   **Operar a Favor da Maré:** Identifica a tendência macro com uma EMA de 100 períodos e só opera nessa direção.
    *   **Entrada em Pullback:** Aguarda uma confirmação de retomada do momentum (usando o RSI) para entrar.
    *   **Trailing Stop Dinâmico:** Gere ativamente as posições abertas, subindo o stop-loss com base no ATR para maximizar ganhos e proteger lucros.
    *   **Documento de Arquitetura:** `docs/deriv-trader-multipliers-architecture.md`

*   **Ficheiros Chave:**
    *   **Página:** `src/app/deriv-trader-multipliers/page.tsx`
    *   **API Hook:** `src/features/trading/hooks/use-deriv-api-multipliers.tsx`
    *   **Cérebro Cognitivo:** `src/features/trading/hooks/use-multipliers-council.ts`

---

### 5. Deriv Accumulators (`/deriv-trader-accumulators`)

**O Preditor Quantitativo Auto-Adaptativo.** Um sistema preditivo que aposta na estabilidade da volatilidade.

*   **Princípios de Funcionamento:**
    *   **Entrada Probabilística:** Usa um modelo de **Primeira Passagem de Movimento Browniano** para calcular a probabilidade de a posição não quebrar a barreira.
    *   **Otimização Dinâmica:** Calcula o `stake` (Critério de Kelly) e a `growth_rate` ótimos antes de cada trade.
    *   **Aprendizagem Contínua:** Analisa o resultado de cada operação e auto-calibra os seus parâmetros de risco, tornando-se mais cauteloso após perdas.
    *   **Documento de Arquitetura:** `docs/deriv-trader-accumulators-architecture.md`

*   **Ficheiros Chave:**
    *   **Página:** `src/app/deriv-trader-accumulators/page.tsx`
    *   **API Hook:** `src/features/trading/hooks/use-deriv-api-accumulators.tsx`
    *   **Cérebros Cognitivos:** `src/features/trading/hooks/use-accumulators-council.ts` e `src/features/trading/hooks/use-time-master.ts`

---

### 6. Deriv Digits (`/deriv-trader-digits`)

**O Caçador de Probabilidades.** Uma plataforma focada em arbitragem estatística do último dígito do preço em Índices Sintéticos.

*   **Princípios de Funcionamento:**
    *   **Análise de Frequência:** Analisa a distribuição dos últimos 1000 dígitos.
    *   **Aposta na Regressão à Média:** Opera "Difere" no dígito mais frequente e "Combina" no dígito menos frequente (mais "atrasado").
    *   **Contexto Visual:** Integra o gráfico de mercado para correlacionar a ação do preço com os padrões estatísticos.
    *   **Documento de Arquitetura:** `docs/deriv-trader-digits-architecture.md`

*   **Ficheiros Chave:**
    *   **Página:** `src/app/deriv-trader-digits/page.tsx`
    *   **API Hook:** `src/features/trading/hooks/use-deriv-api-digits.tsx`
    *   **Cérebro Cognitivo:** `src/features/trading/hooks/use-robot-council-digits.ts`

---

### 7. Análise de Volatilidade (`/volatility-analysis`)

**O Laboratório Preditivo.** Um ambiente de análise quantitativa avançado que usa um comitê de especialistas de IA para prever movimentos de preço.

*   **Princípios de Funcionamento:**
    *   **Previsão Multi-Horizonte:** Usa o modelo **Movimento Browniano Geométrico (GBM)** com volatilidade dinâmica (EWMA) para gerar projeções.
    *   **Controlador de Drift Neuro-Adaptativo:** Compara o preço previsto com o real e auto-calibra o "drift" do modelo.
    *   **Meritocracia Preditiva:** Usa um **Intervalo de Confiança Bayesiano** para avaliar a performance de cada especialista, dando peso apenas aos que demonstram habilidade estatística.
    *   **Meta-Aprendizagem (Epsilon-Greedy):** Foca o "orçamento computacional" nos especialistas de melhor desempenho, mas explora aleatoriamente outros para se adaptar a novas condições de mercado.
    *   **Documento de Arquitetura:** `docs/volatility-analysis-architecture.md`

*   **Ficheiros Chave:**
    *   **Página:** `src/app/volatility-analysis/page.tsx`
    *   **API Hook (Reutilizado):** `src/features/trading/hooks/use-deriv-api-v2.tsx`
    *   **Cérebro Preditivo:** `src/features/trading/hooks/use-stochastic-models.ts`
    *   **Comandante Tático:** `src/features/trading/hooks/use-master-autopilot.ts`
