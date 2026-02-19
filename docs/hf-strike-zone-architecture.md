# Claritas Copilot - Arquitetura Técnica: HF Strike Zone

Este documento detalha a arquitetura do **HF Strike Zone**, um sistema de trading de alta frequência projetado para operar em mercados caóticos e de baixa previsibilidade, como o `1HZ10V`. O sistema utiliza um **consenso de especialistas (ensemble)**, gestão de risco dinâmica e **auto-calibração** para identificar e executar oportunidades de trade estatisticamente vantajosas.

---

## 1. Filosofia de Design: A Esquadra Quantitativa

O HF Strike Zone abandona a ideia de uma "estratégia única" e opera como uma **esquadra de especialistas**, onde cada um tem uma visão diferente do mercado. A decisão de operar não é tomada por um único robô, mas por um **consenso qualificado** entre eles.

**Princípios Fundamentais:**

1.  **Diversidade de Especialistas:** O sistema é composto por 7 especialistas distintos, cada um focado numa ineficiência de mercado específica (reversão à média, tendência, rompimento de volatilidade, fluxo de ordens, predição estocástica).
2.  **Consenso para Confiança:** Uma operação só é considerada ("Strike Zone") quando um número mínimo de especialistas **concorda simultaneamente** na mesma direção. Isto filtra o ruído e aumenta a probabilidade de acerto.
3.  **Gestão de Risco Dinâmica (Kelly Criterion):** O tamanho da aposta (`stake`) não é fixo. É calculado cientificamente usando o Critério de Kelly Fracionado, que aposta mais em sinais de alta convicção e protege o capital em sinais de baixa convicção.
4.  **Adaptação Através da Auto-Calibração:** O sistema não usa parâmetros fixos. O **Calibrador Automático** executa milhares de simulações em dados históricos recentes para encontrar os "pontos de gatilho" ideais para cada especialista, garantindo que eles se mantenham relevantes e operacionais mesmo quando o comportamento do mercado muda.
5.  **Transparência Total:** A interface foi projetada para dar ao operador controle e visibilidade total sobre cada camada do sistema, desde o sinal individual de cada robô até a decisão final do consenso e a gestão de risco.

---

## 2. Arquitetura em Camadas e Fluxo de Decisão

O coração do sistema é o "Funil de Decisão" que ocorre a cada tick de preço dentro do hook `use-hf-strike-zone.tsx`.

### 2.1. Componentes Chave

| Ficheiro/Hook                                         | Responsabilidade                                                                                                                                                                                                               |
| :---------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/hf-strike-zone/page.tsx`                     | **O Orquestrador da Interface.** Monta todos os componentes visuais, conecta-os com os dados do hook `useHFStrikeZone` e fornece a interatividade para o usuário.                                                           |
| `src/features/trading/hooks/use-hf-strike-zone.tsx`   | **O Cérebro Central.** Onde toda a mágica acontece. Ele consome os dados brutos, executa o "Funil de Decisão", gerencia o estado dos especialistas, calcula o risco e dispara as ordens de execução.                                |
| `src/features/trading/services/hf-strike-logic.ts`    | **A Biblioteca de Estratégias.** Contém as funções matemáticas puras para cada um dos 7 especialistas. Cada função recebe os indicadores de mercado e retorna um `StrikeZone` (sinal) ou `null`.                               |
| `src/features/trading/services/indicator-service.ts`  | **O Motor de Cálculo.** Uma biblioteca otimizada que calcula mais de 25 indicadores técnicos (RSI, MACD, Bandas de Bollinger, etc.) a partir dos dados de velas.                                                                |
| `src/features/trading/backtest/hf-backtest-engine.ts` | **O Simulador.** Um motor de backtesting avançado que pode rodar as estratégias sobre dados históricos para validar performance, realizar análise "Walk-Forward" e simulações de "Monte Carlo".                                    |
| `src/features/trading/optimization/auto-calibrator.ts`| **O Otimizador Genético.** O componente mais avançado. Usa o backtester para ajustar automaticamente os parâmetros de cada especialista, garantindo que eles se adaptem a novas condições de mercado para atingir metas de frequência. |

### 2.2. O Funil de Decisão (A Mecânica Interna)

A cada atualização de dados (tick ou vela), o `use-hf-strike-zone.tsx` executa o seguinte ciclo:

1.  **Cálculo de Indicadores:** O `indicator-service` processa os dados de velas (`botCandleData`) para gerar um objeto `Indicators` completo.
2.  **Análise de Microestrutura:** A função `extractMicrostructureFeatures` analisa os últimos ticks de preço para medir o fluxo de ordens, a velocidade e a pressão de compra/venda.
3.  **Votação dos Especialistas:** O sistema chama cada uma das 7 funções de detecção em `hf-strike-logic.ts` (ex: `detectHFMeanReversionZone`, `detectGBM20sZone`). Cada especialista retorna um "voto" (`StrikeZone`) se as suas condições forem atendidas, ou `null` se não houver sinal.
4.  **Motor de Consenso:**
    *   O sistema agrupa os votos por direção (`LONG` vs. `SHORT`).
    *   Ele verifica se o número de votos em uma direção atinge o limiar `minConsensusSignals` definido pelo usuário na UI.
    *   Se o limiar é atingido, um **Consenso** é formado.
5.  **Cálculo da Confiança do Consenso:** A confiança final do sinal de consenso é a **média da confiança** de todos os especialistas participantes.
6.  **Cálculo do Risco (Position Sizing):**
    *   Com a probabilidade de acerto (derivada da confiança do consenso), a função `calculateKellyStake` determina o tamanho ideal da aposta.
    *   **Ajustes Dinâmicos:** O stake de Kelly é então ajustado por múltiplos fatores:
        *   **Volatilidade (ATR, BBW):** Reduzido em mercados voláteis.
        *   **Incerteza do Consenso (Entropia):** Reduzido se os especialistas estão divididos.
        *   **Pressão da Microestrutura:** Reduzido drasticamente se o fluxo de ordens for contrário à direção do sinal (ex: sinal de `RISE` com forte pressão vendedora nos últimos ticks).
        *   **Drawdown:** Reduzido se o sistema está numa sequência de perdas.
7.  **Execução (ou Veto Final):**
    *   Se o `stake` final calculado for maior que o mínimo ($0.35) e o modo "Auto-Executar" estiver ligado, o sistema determina a duração ótima (baseada no especialista mais confiante) e envia a ordem para a API da corretora.
    *   Se qualquer verificação falhar, a operação é vetada, e o sistema informa o motivo na UI.

---

## 3. Guia dos Componentes da Interface

A página `hf-strike-zone` é composta por painéis modulares, cada um com uma função específica.

| Componente                                | Responsabilidade                                                                                                                                                                                            |
| :---------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HFStatsOverview`                         | **O Placar da Sessão.** Exibe as métricas de performance consolidadas de todas as operações executadas pelo sistema na sessão atual (P&L total, Win Rate, trades por estratégia).                          |
| `MarketChart`                             | **Os Olhos do Sistema.** Gráfico em tempo real com overlays de indicadores (Bandas de Bollinger, EMAs) e zonas de suporte/resistência, permitindo visualizar a lógica dos especialistas.                     |
| `StrategySignalMonitor`                   | **A Sala de Controle dos Especialistas.** Mostra, em tempo real, o sinal e a confiança de cada um dos 7 especialistas individualmente. Essencial para entender "quem" está a votar e porquê.                    |
| `HFSignalCard`                            | **A Ponta da Lança.** Exibe o resultado final do "Funil de Decisão". Se um consenso for formado, este card "acende", mostrando a direção, a confiança, os especialistas participantes e o botão de execução. |
| `HFConfigPanel`                           | **O Painel do Comandante.** Permite ligar/desligar a automação, definir o limiar de confiança, o número mínimo de especialistas para consenso e outras regras gerais de risco.                                   |
| `HFStrategyTuningPanel`                   | **A Oficina Mecânica.** Um painel de acordeão que permite o **ajuste fino e manual** dos parâmetros internos de cada especialista (ex: quão sensível o RSI deve ser, qual a força do ADX para definir tendência). |
| `BacktestPanel`                           | **O Simulador / Máquina do Tempo.** Uma ferramenta de análise institucional que permite rodar as estratégias em milhares de dados históricos, com análises avançadas como "Walk-Forward" e "Monte Carlo".     |
| `HFAutoCalibrator`                        | **O Engenheiro-Chefe Autônomo.** A funcionalidade mais avançada. Usa o Backtester para **ajustar automaticamente** os parâmetros do "Ajuste Fino" para que cada estratégia atinja uma meta de frequência de trades definida pelo usuário. |
| `HFExecutionLog`                          | **O Diário de Bordo.** Um log detalhado de cada operação executada pelo sistema HF Strike Zone, permitindo análise pós-trade e exportação para CSV.                                                        |

Essa combinação de componentes cria um ciclo de feedback completo: **Observar** (`MarketChart`, `StrategySignalMonitor`) -> **Decidir** (`HFSignalCard`) -> **Executar** -> **Analisar** (`HFStatsOverview`, `BacktestPanel`) -> **Otimizar** (`HFStrategyTuningPanel`, `HFAutoCalibrator`).
