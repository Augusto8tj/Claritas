# Claritas Copilot - Arquitetura Técnica: Deriv Accumulators V3

Este documento detalha a arquitetura do sistema **Deriv Accumulators**, uma plataforma de trading desenhada para explorar a volatilidade dos mercados sintéticos da Deriv, agora aprimorada com modelos de predição estocástica.

---

## 1. Filosofia de Design: O Preditor Quantitativo

O Deriv Accumulators V3 abandona a heurística e abraça a matemática. O seu único objetivo é apostar na **estabilidade da volatilidade**, mas com decisões de entrada e saída fundamentadas em modelos probabilísticos e otimização de risco.

**Princípios Fundamentais:**

1.  **A Volatilidade é o Alvo:** O sucesso não depende de o preço subir ou descer, mas sim de ele **não se mover de forma explosiva**. A volatilidade é agora medida com o **Estimador de Parkinson**, mais preciso para dados de alta frequência.
2.  **Entrada Probabilística (Caçador de Calmaria V6):** Uma posição só é aberta se a **Probabilidade de Sobrevivência** for alta. O sistema calcula a probabilidade matemática de a posição não atingir a barreira durante um tempo-alvo, usando um modelo de **Primeira Passagem de Movimento Browniano**.
3.  **Otimização Dinâmica de Risco-Retorno:**
    *   **`growth_rate` Otimizada:** A taxa de crescimento não é fixa. Antes de cada trade, o sistema calcula a taxa ótima (entre 1% e 5%) que maximiza a fração de Kelly, equilibrando risco e retorno.
    *   **`stake` Calculado (Kelly Fracionário):** O valor da aposta é calculado cientificamente usando o Critério de Kelly Fracionário (1/4 Kelly), com base na performance histórica da Arena Virtual.
4.  **Gestão de Saída Multi-Fator (Guiada pelo Tempo):**
    *   **"Take Profit" Dinâmico (Sua Sugestão):** O alvo de lucro é agora proporcional à volatilidade calculada pelo "Aprendiz", adotando uma estratégia de maior risco/recompensa.
    *   **"Kill Switch" Temporal e Adaptativo:** O sistema usa o "Tempo de Saída Seguro" projetado pelo Mestre do Tempo para fechar operações que não atingem o lucro a tempo.
    *   **Veto de Microestrutura:** Um filtro de segurança analisa os ticks em tempo real para detectar saltos anormais de preço ou anomalias na velocidade, vetando entradas em mercados perigosos.
5.  **Arena Virtual V2 (Simulação Precisa):** O motor de simulação agora usa a fórmula matematicamente correta da barreira (`ATR * 0.348` para 3%), tornando o aprendizado do Gerente de Risco muito mais preciso e confiável.
6.  **Aprendiz do Mestre do Tempo V2 (Seu Copiloto):** O seu assistente para entradas manuais foi aprimorado. Ele agora calcula um `take profit` dinâmico baseado no histórico de lucros e na volatilidade, e **fecha a sua posição automaticamente** quando o alvo é atingido, agindo como um gestor de risco pessoal.

---

## 2. Arquitetura em Camadas (Refatorada)

### 2.1. Camada de Conexão: `use-deriv-api-accumulators.tsx`

Esta camada permanece como a ponte de comunicação com a API da Deriv.

*   **Responsabilidade Principal**: Gerir a conexão WebSocket e a execução de contratos `ACCU`.

### 2.2. Cérebro Cognitivo: `use-accumulators-council.ts` e `use-time-master.ts`

**a) O Mestre do Tempo V3 (`use-time-master.ts`): O Preditor Estocástico**

*   **Responsabilidade:** Analisar a volatilidade do ativo e prever o tempo.
*   **Lógica:**
    *   **Volatilidade de Parkinson:** Usa um estimador avançado em múltiplas janelas de tempo.
    *   **Detector de Regime:** Classifica a volatilidade em 5 regimes (de `ultra-calm` a `volatile`) usando um proxy GARCH baseado em percentis.
    *   **Preditor de Primeira Passagem:** Calcula o tempo médio de quebra da barreira (`averageBreakTime`) e o tempo de saída seguro (`safeExitTime`).

**b) O Caçador de Calmaria V6 (`use-accumulators-council.ts`): O Estratega Probabilístico**

*   **Responsabilidade Principal**: Tomar decisões de trade com base em probabilidades e otimização.
*   **Ciclo de Decisão:**
    1.  **Consulta ao Mestre do Tempo:** Obtém o `safeExitTime` e a volatilidade instantânea.
    2.  **Análise de Microestrutura:** Verifica se o fluxo de ticks é seguro para operar.
    3.  **Cálculo da Probabilidade de Sobrevivência:** Calcula a probabilidade matemática de a posição não quebrar.
    4.  **Otimização de Parâmetros:** Se a probabilidade for alta, calcula o `stake` ótimo (Kelly) e a `growth_rate` ótima.
    5.  **Execução:** Envia a ordem com os parâmetros otimizados.
    6.  **Gestão de Posição:** Monitora a posição aberta e a fecha usando a lógica multi-fator (take profit, kill switch, stop-loss, etc.).

### 2.3. Camada de Interface: `deriv-trader-accumulators/page.tsx`

A interface foi atualizada para refletir a nova profundidade analítica.

*   **`DerivTraderInterfaceAccumulators`:** O painel manual com o "Aprendiz V2" que agora fecha posições automaticamente.
*   **`AccumulatorsAutopilotInterface`:** O painel do piloto agora exibe as métricas quantitativas chave: **Probabilidade de Sobrevivência**, **Stake Calculado (Kelly)**, **Growth Rate Ótima** e a **Win Rate da Arena Virtual**.
*   **`VirtualArenaAccumulators`:** O painel de simulação que alimenta o modelo Kelly com dados precisos.

Este design representa a transição de um sistema reativo para um sistema preditivo, onde cada decisão é fundamentada em modelos matemáticos robustos.
