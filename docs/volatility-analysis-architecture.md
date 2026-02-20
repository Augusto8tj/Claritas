# Claritas Copilot - Arquitetura Técnica: Laboratório Preditivo (Cérebro Cético V2.1)

Este documento detalha a arquitetura e o funcionamento da página **Análise de Volatilidade**. O sistema evoluiu para um **motor preditivo, auto-calibrável, robustamente validado e computacionalmente eficiente**, projetado para dissecar e prever o comportamento de alta frequência de ativos.

---

## 1. Objetivo: De Preditivo para Adaptativo, Validado e Eficiente

O objetivo é transcender a análise reativa. Construímos e validámos um **motor preditivo adaptativo** que não só antecipa movimentos de preço, mas também:
1.  **Aprende com os seus erros** para se ajustar ao "caráter" do mercado.
2.  **Valida a sua própria viabilidade** contra grandes conjuntos de dados históricos.
3.  **Otimiza o seu foco computacional**, concentrando-se nas estratégias mais promissoras.

---

## 2. Filosofia de Design: O Comitê de Especialistas Dinâmicos

A página opera como um comitê de especialistas em IA que se auto-regula com base nos seguintes princípios:

1.  **Previsão Multi-Horizonte com Sigma Dinâmico (EWMA):** O sistema continua a gerar projeções para múltiplos horizontes de tempo (1t, 3t, 15s, etc.).
    *   **NOVO (Sigma Dinâmico):** O coração de cada especialista, o modelo de **Movimento Browniano Geométrico (GBM)**, agora é `GBM(µ(t), σ(t))`. A volatilidade (`sigma`) não é mais constante; ela é recalculada a cada tick usando uma **Média Móvel Exponencialmente Ponderada (EWMA)** dos retornos logarítmicos, tornando as previsões mais reativas à "nervosismo" do mercado.

2.  **Controlador de Drift Neuro-Adaptativo (em Log-Space):** O "drift" (`mu`, a tendência média) de cada modelo é continuamente ajustado através de um ciclo de feedback de 5 passos:
    *   **1. Previsão:** O especialista GBM para "15s" simula e guarda na memória: "prevejo que o preço será X em 15 segundos".
    *   **2. Maturação:** O sistema aguarda os 15 segundos passarem.
    *   **3. Verificação:** Após o tempo, ele compara o preço previsto com o preço real.
    *   **4. Cálculo de Erro (Log-Space):** O erro é calculado como `log(preço_real / preço_previsto)`. Um resultado positivo significa que o modelo subestimou o movimento; negativo significa que superestimou.
    *   **5. Auto-Correção:** Este erro, suavizado por uma Média Móvel Exponencial, ajusta o `drift` do especialista. Se ele tem subestimado o preço consistentemente, o seu `drift` é aumentado, tornando as suas futuras previsões mais otimistas (e vice-versa).

3.  **Meritocracia Preditiva (Confiança Bayesiana):**
    *   **NOVO (Bayesian Confidence Interval):** Substituímos o *Wilson Score* por um **Intervalo de Confiança Bayesiano**. Este método, baseado numa distribuição Beta, é matematicamente mais robusto para avaliar a performance com poucas amostras.
    *   **Abstenção por Incerteza:** Se o intervalo de confiança de um modelo inclui 50% (ou seja, a sua performance pode ser explicada por sorte), o seu voto é `HOLD`, impedindo-o de influenciar a decisão final.

4.  **Meta-Aprendizagem (Epsilon-Greedy):**
    *   **NOVO (Seleção Dinâmica de Horizontes):** O sistema não analisa cegamente todos os 9 horizontes. Ele mantém um "score" para cada um e, a cada ciclo, seleciona apenas os **top-K** (ex: 5 melhores) para focar o seu "orçamento computacional".
    *   **Exploração (Epsilon):** Com uma pequena probabilidade (`epsilon`), o sistema ativa um horizonte aleatório "do banco" para explorar se as condições de mercado mudaram a seu favor.
    *   **Persistência:** As preferências de horizontes para cada ativo são guardadas no Firestore (`asset_profiles_v1`), permitindo que o sistema se torne mais especialista em cada ativo ao longo do tempo.

5.  **Validação Robusta (Motor de Backtesting Offline):**
    *   **NOVO (Backtest Engine):** Foi implementado um motor de simulação puro e determinístico que pode rodar a lógica do modelo preditivo sobre meses de dados históricos em segundos, validando a viabilidade da estratégia a longo prazo antes de arriscar capital.

---

## 3. O Ciclo de Cálculo Perpétuo

Uma pergunta comum é: "quantos cálculos são feitos antes de uma entrada?". A resposta é que não há um número fixo. O sistema está num **estado de cálculo perpétuo**. A cada nova vela ou tick de preço, ele executa o seguinte ciclo completo:

1.  **Atualização de Volatilidade:** Recalcula a volatilidade (`sigma`) para todos os 9 especialistas.
2.  **Ciclo de Aprendizagem:** Verifica se alguma previsão "amadureceu" e, se sim, executa os 5 passos do **ajuste de drift** para cada especialista maturado.
3.  **Novas Simulações:** Roda **9 novas simulações de Monte Carlo** (uma para cada especialista), gerando 9 novas previsões de preço.
4.  **Análise de Consenso:** Compara as 9 novas previsões, calcula a "Assertividade Bayesiana" de cada especialista e determina se há um gatilho de entrada que passe por todos os filtros de risco.

Uma "entrada" não é o resultado de um cálculo único, mas sim o momento em que este ciclo contínuo finalmente produz um sinal de alta convicção.

---

## 4. Arquitetura e Ficheiros Atuantes

| Ficheiro/Componente                                         | Responsabilidade                                                                                                                                                                                                           |
| :---------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/volatility-analysis/page.tsx`                      | **O Orquestrador.** Une os dados da API, a lógica do piloto, as projeções da IA e renderiza a interface, incluindo o `MarketChart`, o `StochasticLab` (com o novo Painel de Saúde) e a nova aba de `Backtest`. |
| `src/features/trading/hooks/use-stochastic-models.ts`       | **O Cérebro Preditivo.** O núcleo da IA. Executa os modelos GBM com sigma dinâmico, implementa o Controlador de Drift, calcula a Confiança Bayesiana e a lógica de Meta-Aprendizagem (seleção de horizontes). |
| `src/features/trading/hooks/use-master-autopilot.ts`        | **O Comandante Tático.** Consome as projeções e a lista de `activeHorizons` do Cérebro Preditivo, aplica filtros de risco e de tendência macro, e executa as ordens.                                    |
| `src/features/trading/services/volatility-forecast.ts`      | **Serviço Numérico (NOVO).** Fornece funções matemáticas puras e reutilizáveis, como `ewmaVarianceUpdate` e `logReturnsFromPrices`, para o cálculo de volatilidade.                                             |
| `src/features/trading/backtest/backtest-engine.ts`          | **Motor de Backtesting (NOVO).** Uma função pura e determinística que simula o `useStochasticModels` sobre grandes datasets para validação estatística.                                                          |
| `src/services/financial-data-service.ts`                    | **Persistência.** Atualizado com funções `saveBacktestRun` e `getBacktestRuns`, além de usar a entidade `AssetProfileV1` para guardar as preferências de meta-aprendizagem.                                     |

---

## 5. O Funil de Decisão do Piloto Automático

O funil permanece o mesmo, mas a matéria-prima (as projeções) e os filtros são agora muito mais inteligentes:

1.  **Entrada:** O `useStochasticModels` gera projeções e scores de confiança Bayesiana.
2.  **Filtro 1 (Meta-Aprendizagem):** O sistema seleciona apenas os **horizontes ativos** (os "especialistas de elite" para aquele ativo).
3.  **Filtro 2 (Gatilho de Confirmação):** O `useMasterAutopilot` avalia se há um consenso (duplo ou triplo) **apenas entre os especialistas ativos**.
4.  **Filtro 3 (Limiar de Assertividade):** Verifica se todos os especialistas no consenso têm uma confiança Bayesiana acima do limiar dinâmico.
5.  **Filtro 4 (Tendência Macro):** Para sinais de maior duração, verifica se a direção do sinal está alinhada com a EMA de longo prazo.
6.  **Execução:** Se todos os filtros passarem, a ordem é enviada.

---

## 6. Novas Funcionalidades e Como Usá-las

| Novidade                                    | O que é?                                                                                                                                                             | Como Usar?                                                                                                                                                                                           |
| :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Painel de Saúde do Sistema**           | Um novo conjunto de cartões no topo do "Laboratório Preditivo" que mostra as métricas mais importantes: **Win Rate Total, Lucro/Prejuízo (P&L)** e o número de especialistas ativos. | **Apenas observe.** Este painel dá-lhe uma visão instantânea da performance real do piloto. Se a Win Rate estiver abaixo de 51% após muitos trades, é um sinal para intervir.           |
| **2. Motor de Backtesting Offline** | Uma nova aba "Backtest" dentro do Laboratório. Permite simular o desempenho do modelo preditivo em milhares de ticks de dados históricos, validando a sua viabilidade a longo prazo. | Vá para a aba "Backtest", selecione o número de pontos de dados que deseja testar (ex: 20.000) e clique em "Rodar Backtest". Os resultados (win rate por horizonte, etc.) aparecerão abaixo. |
| **3. Persistência de Aprendizagem por Ativo** | O sistema agora guarda no Firestore um "perfil" para cada ativo, lembrando-se de quais horizontes de tempo (especialistas) funcionam melhor para ele.                               | **Deixe o sistema a funcionar.** Quanto mais trades o piloto automático fizer num ativo, mais inteligente ele se tornará na seleção dos especialistas certos para esse ativo específico. |
