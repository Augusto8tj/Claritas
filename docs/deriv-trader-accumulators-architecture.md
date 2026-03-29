# Claritas Copilot - Arquitetura Técnica: Deriv Accumulators V4 (IA Preditiva)

Este documento detalha a arquitetura do sistema **Deriv Accumulators V4**, uma plataforma de trading que evoluiu de um modelo reativo para um **motor preditivo e auto-calibrável**, projetado para explorar a volatilidade dos mercados sintéticos da Deriv.

---

## 1. Filosofia de Design: O Preditor Quantitativo Auto-Adaptativo

O Deriv Accumulators V4 abandona a heurística e abraça a matemática estocástica e a aprendizagem contínua. O seu único objetivo é apostar na **estabilidade da volatilidade**, com decisões de entrada e saída fundamentadas em modelos probabilísticos, otimização de risco e, crucialmente, **um ciclo de feedback que ajusta os parâmetros do sistema com base no desempenho real**.

**Princípios Fundamentais:**

1.  **A Volatilidade é o Alvo:** O sucesso não depende de o preço subir ou descer, mas sim de ele **não se mover de forma explosiva**. A volatilidade é agora medida com o **Estimador de Parkinson**, mais preciso para dados de alta frequência.
2.  **Entrada Probabilística (Caçador de Calmaria V7):** Uma posição só é aberta se a **Probabilidade de Sobrevivência** for alta. O sistema calcula a probabilidade matemática de a posição não atingir a barreira durante um tempo-alvo, usando um modelo de **Primeira Passagem de Movimento Browniano**.
3.  **Otimização Dinâmica de Risco-Retorno:**
    *   **`growth_rate` Otimizada:** A taxa de crescimento não é fixa. Antes de cada trade, o sistema calcula a taxa ótima (entre 1% e 5%) que maximiza a fração de Kelly, equilibrando risco e retorno.
    *   **`stake` Calculado (Kelly Fracionário):** O valor da aposta é calculado cientificamente usando o Critério de Kelly Fracionário (1/4 Kelly), com base na performance histórica da Arena Virtual.
4.  **Gestão de Saída Multi-Fator (Guiada pelo Tempo e Risco):**
    *   **"Take Profit" Dinâmico (Sua Sugestão):** O alvo de lucro é agora proporcional à volatilidade calculada pelo "Aprendiz", adotando uma estratégia de maior risco/recompensa.
    *   **"Kill Switch" Temporal e Adaptativo:** O sistema usa o "Tempo de Saída Seguro" projetado pelo Mestre do Tempo para fechar operações que não atingem o lucro a tempo.
    *   **Veto de Microestrutura ("Disjuntor de Ruído"):** Como um "guarda-costas", um filtro de segurança analisa os últimos ticks em tempo real para detectar saltos anormais de preço ou anomalias na velocidade, vetando entradas em mercados perigosos.
5.  **Arena Virtual V3 (Simulação Precisa):** O motor de simulação agora usa a fórmula matematicamente correta da barreira (`ATR * 0.348` para 3%), tornando o aprendizado do Gerente de Risco muito mais preciso e confiável.
6.  **Ciclo de Aprendizagem Contínua (O Cérebro Adaptativo):**
    *   **Memória de Combate:** O sistema mantém um log (`metricsLogRef`) de cada operação, registando as condições de entrada (probabilidade, duração prevista) e o resultado real (duração, lucro/perda).
    *   **Análise de Causa-Raiz:** Após cada perda, o sistema analisa "porquê?". Se a posição quebrou muito mais rápido que o previsto, significa que a estimativa de volatilidade estava errada.
    *   **Auto-Calibração:** Com base na análise, o sistema ajusta os seus próprios parâmetros. Uma perda rápida torna-o "hiper-cauteloso" (aumenta o limiar de probabilidade e diminui o tempo de exposição). Vitórias tornam-no gradualmente mais confiante.
7.  **Aprendiz do Mestre do Tempo V3 (Seu Copiloto Pessoal):** O seu assistente para entradas manuais foi aprimorado. Ele agora calcula um `take profit` dinâmico baseado no histórico de lucros e na volatilidade, e **fecha a sua posição automaticamente** quando o alvo é atingido, agindo como um gestor de risco pessoal.

---

## 2. Arquitetura em Camadas (Refatorada)

### 2.1. Camada de Conexão: `use-deriv-api-accumulators.tsx`

Esta camada permanece como a ponte de comunicação com a API da Deriv.

*   **Responsabilidade Principal**: Gerir a conexão WebSocket e a execução de contratos `ACCU`.

### 2.2. Cérebro Cognitivo: `use-accumulators-council.ts` e `use-time-master.ts`

**a) O Mestre do Tempo V4 (`use-time-master.ts`): O Preditor Estocástico**

*   **Responsabilidade:** Analisar a volatilidade do ativo e prever o tempo.
*   **Lógica:**
    *   **Volatilidade de Parkinson:** Usa um estimador avançado em múltiplas janelas de tempo.
    *   **Detector de Regime:** Classifica a volatilidade em 5 regimes (de `ultra-calm` a `volatile`) usando um proxy GARCH baseado em percentis.
    *   **Preditor de Primeira Passagem:** Calcula o tempo médio de quebra da barreira (`averageBreakTime`) e o tempo de saída seguro (`safeExitTime`).

**b) O Caçador de Calmaria V7 (`use-accumulators-council.ts`): O Estratega Preditivo e Adaptativo**

*   **Responsabilidade Principal**: Tomar decisões de trade com base em probabilidades, otimização de risco e **aprendizagem contínua**.
*   **Ciclo de Decisão:**
    1.  **Consulta ao Mestre do Tempo:** Obtém o `safeExitTime` e a volatilidade instantânea.
    2.  **Disjuntor de Microestrutura:** Analisa os últimos 10-15 ticks. Se detetar ruído excessivo, **VETA a entrada** e aguarda.
    3.  **Cálculo da Probabilidade de Sobrevivência:** Calcula a probabilidade matemática de a posição não quebrar.
    4.  **Decisão de Entrada:** Compara a probabilidade com o `survivalProbabilityThreshold` do **Gerente de Risco**. Se for maior, prossegue.
    5.  **Otimização de Parâmetros:** Se a entrada for aprovada, calcula o `stake` ótimo (Kelly) e a `growth_rate` ótima.
    6.  **Execução:** Envia a ordem com os parâmetros otimizados.
    7.  **Gestão de Posição:** Monitora a posição aberta e a fecha usando a lógica multi-fator (take profit, kill switch, stop-loss, etc.).
    8.  **Pós-Trade: Análise e Aprendizagem:**
        *   Quando a posição fecha, regista as métricas na **Memória de Combate**.
        *   A função `analyzeAndAdjustStrategy` é acionada.
        *   **Se foi uma perda:** Analisa a duração real vs. prevista. Se a quebra foi rápida, o `RiskManager` entra em modo **"Cauteloso"**, aumentando o limiar de probabilidade para a próxima operação.
        *   **Se foi uma vitória:** O `RiskManager` retorna ao modo **"Normal"**, reduzindo gradualmente o limiar de probabilidade.

### 2.3. Camada de Interface: `deriv-trader-accumulators/page.tsx`

A interface foi atualizada para refletir a nova profundidade analítica.

*   **`DerivTraderInterfaceAccumulators`:** O painel manual com o "Aprendiz V3" que agora fecha posições automaticamente e aprende com o histórico de lucros.
*   **`AccumulatorsAutopilotInterface`:** O painel do piloto agora exibe as métricas quantitativas chave: **Probabilidade de Sobrevivência**, **Stake Calculado (Kelly)**, **Growth Rate Ótima** e a **Win Rate da Arena Virtual**.
*   **`VirtualArenaAccumulators`:** O painel de simulação que alimenta o modelo Kelly com dados precisos.

Este design representa a transição de um sistema reativo para um sistema preditivo e auto-calibrável, onde cada decisão é fundamentada em modelos matemáticos robustos e refinada pela experiência.