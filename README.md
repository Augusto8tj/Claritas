# Claritas Copilot - Arquitetura Técnica e Ecossistema de Trading

Bem-vindo à documentação técnica do **Claritas Copilot**, um ambiente de trading de alta frequência impulsionado por múltiplos motores cognitivos e plataformas de negociação especializadas.

## Relatório de Auditoria das Estratégias (V5.5)

O sistema opera com 9 camadas independentes, cada uma com uma finalidade específica no mercado:

### 1. Deriv Trader V1 (`/deriv-trader`)
- **Status:** Produção Estável.
- **Lógica:** Consenso Merocrático. Um conselho de 22 robôs vota. O peso do voto é o **Sharpe Ratio** (consistência).
- **Risco:** Critério de Kelly Fracionado.

### 2. Deriv Trader V2.5 (`/deriv-trader-v2`)
- **Status:** Alta Performance.
- **Lógica:** Regime-Aware. Usa **HMM** para identificar se o mercado está lateral ou em tendência e ativa apenas os especialistas certos.
- **Diferencial:** **Veto de Microestrutura**. Analisa a velocidade dos ticks e desequilíbrio de volume para evitar armadilhas de volatilidade.

### 3. Deriv Trader V3.0 (`/deriv-trader-v3`)
- **Status:** IA Lab (Experimental).
- **Lógica:** Visão Hierárquica. Separa a análise em níveis Macro, Meso e Micro para decisões contextuais profundas.

### 4. Deriv Multipliers (`/deriv-trader-multipliers`)
- **Status:** Operacional (Tendência).
- **Lógica:** "Padrão Ouro". Identifica a maré (EMA 100) e entra no pullback (RSI).
- **Risco:** **Trailing Stop automático** via ATR para proteger lucros em tendências fortes.

### 5. Deriv Accumulators (`/deriv-trader-accumulators`)
- **Status:** Preditivo V4.
- **Lógica:** Estabilidade de Volatilidade. Calcula a probabilidade matemática de não tocar a barreira (Primeira Passagem de Movimento Browniano).
- **Diferencial:** **Mestre do Tempo**. Usa o Estimador de Parkinson para projetar o tempo de saída seguro.

### 6. Deriv Digits (`/deriv-trader-digits`)
- **Status:** Preditivo V2 (Estatístico).
- **Lógica:** Arbitragem de Último Dígito.
- **Diferencial:** **Sherlock Holmes**. Usa Modelos de Markov para prever N-ticks no futuro, compensando a latência da rede.

### 7. Deriv Reset Call/Put (`/deriv-trader-reset`)
- **Status:** Operacional (Tático).
- **Lógica:** Segunda chance em tendências. Usa contratos de Reset para mitigar o risco de recuos temporários.

### 8. Análise de Volatilidade (`/volatility-analysis`)
- **Status:** Laboratório Estocástico.
- **Lógica:** Modelos **GBM** (Geometric Brownian Motion).
- **Diferencial:** **Controlador de Drift Neuro-Adaptativo**. A IA aprende com seus erros de previsão passados e ajusta seu viés em tempo real.

### 9. HF Strike Zone (`/hf-strike-zone`)
- **Status:** Alta Frequência (HFT).
- **Lógica:** Esquadra de 7 Especialistas. Só opera quando há consenso majoritário.
- **Diferencial:** **Auto-Calibrador**. Executa buscas de "Hill Climbing" em dados históricos para encontrar os parâmetros ótimos a cada 15 minutos.

---

## Estrutura de Arquivos

Cada plataforma possui seu próprio conjunto de hooks e componentes, garantindo que falhas em um sistema experimental não afetem os sistemas de produção estáveis (V1 e Multiplicadores).
