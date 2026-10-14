# Arquitetura Técnica: Crypto Lab V4.2 (Supreme Edition)

Este documento descreve a finalidade de cada arquivo que compõe o ecossistema de trading de criptomoedas do Claritas Copilot.

---

## 1. Camada de Interface (View)
- **`src/app/ai-quant-terminal-v4/page.tsx`**
  - **Objetivo**: Dashboard mestre do laboratório. 
  - **Funções**: Exibe o Radar de Gravidade, Gráfico de Mercado, Telemetria do Hardware Node (Ollama), Chat Tático com o Conselho e o Painel de Backtest Institucional.

---

## 2. Camada de Orquestração (Hooks)
- **`src/features/trading/hooks/use-crypto-radar-v4.tsx`**
  - **Objetivo**: Gestor central de estado e lógica de execução.
  - **Funções**: Orquestra os ciclos de análise, gerencia a fila de prioridade de inferência, controla os limites de risco diário (Stop Loss/Profit Target) e integra a execução polimórfica (Multiplicadores/Options).
- **`src/features/trading/hooks/use-backtest-runner.ts`**
  - **Objetivo**: Coordenador de simulações históricas.
  - **Funções**: Realiza o download paginado de candles e executa o motor de backtest paged em segundo plano.

---

## 3. Motores de Inteligência (Services)
- **`src/features/trading/services/crypto-gravity-engine.ts`**
  - **Objetivo**: Análise de correlação líder.
  - **Funções**: Monitora o Bitcoin (cryBTCUSD) para detectar explosões ou compressões, calculando como o movimento deve se propagar para as Altcoins.
- **`src/features/trading/services/crypto-signal-engine.ts`**
  - **Objetivo**: Especialização estatística (Sentinel).
  - **Funções**: Define regras matemáticas otimizadas para o setor cripto, priorizando contratos de Multiplicadores e aplicando vetos de divergência gravitacional.
- **`src/features/trading/services/quant-council-engine.ts`**
  - **Objetivo**: Síntese multi-agente.
  - **Funções**: Dispara inferências paralelas ao Ollama para 3 agentes especialistas, calcula a entropia do conselho e aplica o Failover Matemático em caso de instabilidade.

---

## 4. Memória e Governança
- **`src/features/trading/services/trade-memory-service.ts`**
  - **Objetivo**: Persistência de aprendizado tático.
  - **Funções**: Salva "Post-Mortems" de trades (Wins/Losses) no Firestore para serem injetados como contexto vivo no próximo prompt da IA.
- **`src/hooks/useAdaptiveResilience.ts`**
  - **Objetivo**: Proteção e ajuste de rigor.
  - **Funções**: Ajusta o limiar de confiança exigido com base no desempenho recente e monitora gaps de liquidez (estresse de rede).

---

## 5. Camada de Comunicação e Relatórios
- **`src/app/api/ollama/agent/route.ts`**
  - **Objetivo**: Gateway de inferência local.
  - **Funções**: Proxy seguro para comunicação com o Ollama Studio, tratando timeouts e formatação estrita de JSON.
- **`src/features/trading/services/report-builders.ts`**
  - **Objetivo**: Síntese qualitativa de dados.
  - **Funções**: Gera relatórios técnicos em linguagem natural para o Chat Tático e auditoria de ativos.
