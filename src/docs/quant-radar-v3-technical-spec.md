# Especificação Técnica: Quant Radar V3 (Laboratório)

Este documento detalha a arquitetura do sistema **Quant Radar V3**, um ambiente de trading quantitativo baseado em um conselho de agentes de IA e monitoramento de ativos em tempo real.

---

## 1. Filosofia e Arquitetura "Council Edition"

Ao contrário das versões anteriores que usavam lógica técnica pura ou um único modelo de previsão, a V3 opera como um **Conselho Tático Multi-Agente**. A decisão não é uma média matemática, mas uma **síntese qualitativa** de diferentes perspectivas de mercado.

### 1.1. O Conselho de Analistas
O sistema dispara inferências paralelas para três agentes especialistas com personas distintas:
*   **MOMENTUM (Analista de Força)**: Foca em RSI, ADX e velocidade de ticks. É agressivo e busca identificar explosões de volatilidade.
*   **RISK CRITIC (O Cético)**: Sua missão única é encontrar motivos para o trade falhar. Ele analisa a compressão de bandas (BBW) e anomalias estatísticas para vetar sinais.
*   **ARCHIVIST (Memória de Padrões)**: Utiliza a `TradeMemoryBuffer` para comparar o cenário atual com sucessos e falhas recentes do laboratório.

---

## 2. Recursos Chave e Inovações

### 2.1. Monitoramento Multi-Ativo (Surgical Port V2.5)
O V3 incorporou a capacidade de monitorar até 5 ativos simultaneamente no background.
*   **Half-Cycle Scheduling**: Para evitar sobrecarga do hardware, o radar analisa os ativos na metade do intervalo (`analysisInterval`) definido pelo usuário.
*   **Identificação Polimórfica**: O conselho recomenda o melhor contrato para cada cenário (Acumuladores, Multiplicadores ou Opções).

### 2.2. Feedback Loop & Memória Tática
Implementa uma memória de curto prazo (últimos 20 trades) persistida no Firestore.
*   **Post-Mortem**: Cada trade perdido é analisado para identificar a causa da falha (ex: "Volatilidade Yang-Zhang alta demais").
*   **Context Injection**: O buffer de memória é injetado no prompt de cada analista, permitindo que a IA aprenda com os erros da própria sessão.

### 2.3. Resiliência de Inferência (Failover)
*   **Matematic Fallback**: Se o hardware local (Ollama) demorar mais de 10s para responder, um motor estocástico de emergência assume a decisão.
*   **Entropy Check**: Mede a desordem do conselho. Se os analistas estiverem muito divididos (Entropia > 0.7), o Chairman força um `HOLD`.

---

## 3. Lista de Arquivos Envolvidos (Mapa de Auditoria)

### 3.1. Orquestração e UI
*   `src/app/ai-quant-terminal-v3/page.tsx`: Componente de visualização principal.
*   `src/features/trading/hooks/use-ai-quant-terminal-v3.tsx`: Gerencia o estado do Radar, o agendamento de ciclos e a integração com o WebSocket.

### 3.2. Motor Cognitivo (O "Cérebro")
*   `src/features/trading/services/quant-council-engine.ts`: O orquestrador de inferência paralela. Contém a lógica do Chairman e o tratamento de falhas.
*   `src/app/api/ollama/agent/route.ts`: Proxy de API para comunicação com o Ollama Studio local.

### 3.3. Memória e Persistência
*   `src/features/trading/services/trade-memory-service.ts`: Gerencia o buffer de memória no Firestore (`quant_memory_v3`).
*   `src/features/trading/types/council.ts`: Define as interfaces de `AgentOpinion`, `CouncilDecision` e `Telemetry`.

### 3.4. Serviços de Apoio
*   `src/features/trading/services/indicator-service.ts`: Fornece os indicadores técnicos calculados (RSI, BBW, ADX) para os agentes.
*   `src/features/trading/hooks/use-deriv-api-v2.tsx`: Utilizado para o fluxo de dados multi-ativo (WebSocket) e execução de ordens.

---

## 4. Fluxo de Dados (Step-by-Step)
1.  **Ingestão**: `use-deriv-api-v2` recebe ticks via WebSocket.
2.  **Processamento**: `indicator-service` gera o snapshot técnico.
3.  **Invocação**: `quant-council-engine` dispara chamadas para os 3 analistas.
4.  **Síntese**: O Chairman avalia as opiniões e a Entropia.
5.  **Execução**: Se houver consenso e o risco permitir, a ordem é enviada.
6.  **Aprendizado**: O resultado do trade é salvo no `trade-memory-service` para as próximas inferências.
