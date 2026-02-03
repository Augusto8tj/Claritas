# Claritas Copilot - Arquitetura Técnica: Laboratório Preditivo (Cérebro Adaptativo V2)

Este documento detalha a arquitetura e o funcionamento da página **Análise de Volatilidade**, o nosso "Laboratório Preditivo". Esta ferramenta é um ambiente de análise quantitativa avançado, projetado para dissecar e prever o comportamento de alta frequência de um ativo usando modelos estocásticos **que se auto-calibram em tempo real**.

---

## 1. Objetivo: De Reativo para Preditivo e Adaptativo

O objetivo desta página é transcender a análise técnica tradicional, que é reativa por natureza (baseada em dados passados). O nosso objetivo é construir e validar um **motor preditivo adaptativo** que não só tenta antecipar os movimentos de preço, mas também **aprende com os seus próprios erros** para se ajustar continuamente ao "caráter" do mercado.

---

## 2. Filosofia de Design: O Comitê de Especialistas Temporais Auto-Calibráveis

A página não é apenas um gráfico; é um **comitê de nove especialistas em IA**, cada um focado num horizonte de tempo diferente. O sistema agora opera sob os seguintes princípios de aprendizagem:

1.  **Previsão Multi-Horizonte:** O sistema continua a gerar nove projeções de preço distintas para nos dar uma visão completa, do micro ao macro.

2.  **Modelo Preditivo (GBM):** O coração de cada especialista é o Movimento Browniano Geométrico. Para o ativo `1HZ10V`, ele começa com parâmetros conhecidos, mas agora eles não são mais fixos.
    *   **Drift (μ) & Volatilidade (σ):** O modelo ainda usa estes dois parâmetros, mas o **`drift` é agora dinâmico**.

3.  **NOVO: Controlador de Drift Neuro-Adaptativo (O Cérebro que Aprende):**
    *   **Ciclo de Feedback:** Após cada projeção (ex: uma previsão de 10 ticks), o sistema compara o preço final previsto com o preço que realmente ocorreu. A diferença é o **erro de previsão**.
    *   **Memória de Erros:** Cada especialista mantém um histórico dos seus últimos 20 erros de previsão.
    *   **Cálculo de Viés (Bias):** O especialista calcula a média dos seus erros recentes. Se a média é consistentemente positiva, ele sabe que está a **subestimar** o mercado. Se for negativa, está a **sobrestimar**.
    *   **Auto-Calibração:** Com base neste viés, o sistema calcula um **fator de correção de drift**. Este fator é então somado ao drift base na próxima vez que o especialista faz uma projeção. O modelo está, efetivamente, a aprender a corrigir os seus próprios preconceitos em tempo real.

4.  **Meritocracia Preditiva (Auto-Avaliação Contínua):**
    *   **Assertividade Direcional:** O sistema continua a rastrear a taxa de acerto *direcional* (se acertou a subida ou a descida) de cada especialista nos seus últimos 1000 resultados.
    *   **Certeza Estatística (Wilson Score):** Em vez de usar a taxa de acerto bruta, o sistema calcula um intervalo de confiança estatístico (o *Wilson Score Interval*). Um especialista só é considerado "confiável" se o limite inferior deste intervalo for significativo (ex: > 55%). Isto garante que a consistência foi provada e não é fruto do acaso.
    *   **Abstenção por Incerteza:** Se um modelo tem poucos dados ou uma performance ambígua (~50% de acerto), a sua certeza estatística será baixa e o seu voto será `HOLD` (abstenção), impedindo-o de influenciar a decisão final até que prove o seu valor.

5.  **Consenso Ponderado para Decisão:** A decisão final (`RISE` ou `FALL`) continua a ser uma **eleição ponderada**, onde o voto de cada especialista é ponderado pela sua certeza estatística.

---

## 3. Arquitetura e Ficheiros Atuantes

A arquitetura central permanece a mesma, mas a lógica interna do `StochasticLab` foi profundamente modificada para incorporar a aprendizagem.

### 3.1. Camada de Interface e Orquestração

*   **`src/app/volatility-analysis/page.tsx`**: O ficheiro central da página.
    *   **Responsabilidade:** Orquestra todos os componentes e agora contém a lógica do **Controlador de Drift Neuro-Adaptativo** e do sistema de **Certeza Estatística**.
    *   **`StochasticLab` (Agora um Cérebro Adaptativo):**
        *   Executa os modelos GBM.
        *   **NOVO:** Compara previsões com resultados reais para calcular o erro.
        *   **NOVO:** Atualiza o fator de correção de drift para cada especialista.
        *   **NOVO:** Usa o drift corrigido para gerar novas projeções.
        *   Avalia a certeza estatística (Wilson Score) de cada especialista com base no seu histórico de 1000 operações.
        *   Expõe os dados, a taxa de acerto real, e o **drift adaptativo** para a UI.

### 3.2. Camada Cognitiva (O Cérebro de Decisão)

*   **`src/features/trading/hooks/use-master-autopilot.ts`**: O "Comandante Tático" permanece o mesmo, consumindo as projeções (agora mais inteligentes e com um grau de confiança estatístico) geradas pelo `StochasticLab`.

---

## 4. O Funil de Decisão do Piloto Automático

O funil permanece o mesmo, mas a qualidade da "matéria-prima" (as projeções) que entra no funil é agora muito superior. Uma ordem automática ainda precisa passar por todos os filtros de compatibilidade tática, consenso, limiar de assertividade estatística e alinhamento de tendência macro antes de ser executada.
