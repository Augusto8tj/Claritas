# Claritas Copilot - Arquitetura Técnica: Laboratório Preditivo (Análise de Volatilidade)

Este documento detalha a arquitetura e o funcionamento da página **Análise de Volatilidade**, o nosso "Laboratório Preditivo". Esta ferramenta é um ambiente de análise quantitativa avançado, projetado para dissecar e prever o comportamento de alta frequência de um ativo usando modelos estocásticos.

---

## 1. Filosofia de Design: O Comitê de Especialistas Temporais

A página não é apenas um gráfico; é um **comitê de seis especialistas em IA**, cada um focado num horizonte de tempo diferente (3-ticks, 6-ticks, 10-segundos, etc.). O sistema opera sob os seguintes princípios:

1.  **Previsão Multi-Horizonte:** Em vez de uma única previsão, o sistema gera seis projeções de preço distintas. Isto permite-nos ver se a previsão de curto prazo concorda ou diverge da de longo prazo.
2.  **Modelo Preditivo (Movimento Browniano Geométrico - GBM):** O coração de cada especialista é o GBM, um modelo padrão em finanças quantitativas. Ele projeta o futuro com base em duas forças:
    *   **Drift (Tendência):** A média dos retornos recentes. Se o ativo tem subido, a tendência da projeção é de alta.
    *   **Difusão (Volatilidade):** A aleatoriedade do movimento, baseada no desvio padrão dos retornos recentes.
3.  **Meritocracia Preditiva (Auto-Avaliação):** O sistema não confia cegamente nas suas próprias previsões. Ele rastreia constantemente o **índice de assertividade** (a taxa de acerto direcional) de cada um dos seus seis especialistas. Projeções que se provam mais confiáveis ganham mais "peso" na decisão final.
4.  **Consenso Ponderado para Decisão:** A decisão final (`RISE` ou `FALL`) não é uma média simples. É o resultado de uma **eleição ponderada**. O voto de cada especialista temporal é ponderado pela sua assertividade histórica. Um especialista com 80% de acerto tem um voto muito mais forte do que um com 55%.
5.  **Auto-Correção de Erro (Drift Adaptativo):** O sistema mede constantemente o seu erro de previsão de curtíssimo prazo (MAE e RMSE) e calcula um "fator de correção" (drift) para ajustar e refinar as suas futuras projeções, num ciclo de aprendizagem contínua.

---

## 2. Componentes da Interface e Suas Funções

A página é dividida em painéis que mostram as diferentes camadas da análise do cientista de IA.

### 2.1. Painel Principal: Consenso das Projeções

Este é o "C-Suite" do comitê, onde a decisão final é tomada.

*   **Decisão Final:** O veredito do consenso ponderado (`RISE`/`FALL`/`HOLD`).
*   **Confiança:** A força da maioria. Uma confiança de 100% indica que todos os especialistas, ponderados pela sua assertividade, concordaram na mesma direção.
*   **Votos Individuais:** Para cada horizonte (3t, 6t, 10s, etc.), exibe a sua taxa de acerto histórica (`Assertividade`) e o seu voto atual. Isto permite uma auditoria rápida de "quem" está a influenciar a decisão.

### 2.2. Gráfico de Projeção

O gráfico principal visualiza o trabalho do comitê:
*   **Linha Azul (Preço Real):** O movimento real do mercado.
*   **Linhas Tracejadas Coloridas:** Cada cor representa o caminho futuro projetado por um dos especialistas temporais. Permite ver visualmente se as projeções estão otimistas, pessimistas ou divergentes.

### 2.3. Painel de Métricas de Erro e Assertividade

Esta é a seção de "Controlo de Qualidade" e "Recursos Humanos" do comitê.

*   **MAE (Erro Médio Absoluto) e RMSE:** Medem o erro médio das previsões de 1-tick. O RMSE penaliza erros grandes, ajudando a detetar picos de imprecisão.
*   **Fator de Correção (Drift):** Mostra o ajuste que o modelo está a aplicar em si mesmo para se tornar mais preciso.
*   **Cards de Assertividade:** Seis placares individuais que mostram a performance de cada especialista temporal. O objetivo é que cada um se mantenha consistentemente acima de 50%. Uma taxa de acerto baixa (ex: 30%) é tão informativa quanto uma alta, pois indica um padrão de erro consistente.

### 2.4. Abas de Análise Estatística

*   **Retornos:** Um gráfico de dispersão que mostra a variação de preço a cada tick. Útil para "sentir" a volatilidade instantânea.
*   **Volatilidade:** Um gráfico de linha que mostra a volatilidade realizada ao longo do tempo.
*   **Q-Q Plot:** Um gráfico técnico que valida se a distribuição dos retornos do ativo se assemelha a uma distribuição Normal, o que é uma premissa fundamental do modelo GBM. Pontos próximos da linha diagonal vermelha confirmam a validade do modelo.

Em suma, a página de Análise de Volatilidade é um sistema preditivo completo que não apenas tenta prever o futuro, mas também mede, exibe e reage à sua própria precisão em tempo real.
