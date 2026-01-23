# Claritas Copilot - Arquitetura Técnica: Deriv Accumulators

Este documento detalha a arquitetura do sistema **Deriv Accumulators**, uma plataforma de trading desenhada para explorar a volatilidade dos mercados sintéticos da Deriv. Este sistema representa uma mudança de paradigma em relação ao trading direcional (Rise/Fall).

---

## 1. Filosofia de Design: O Mestre da Volatilidade e do Tempo

O Deriv Accumulators abandona a necessidade de prever a direção do mercado. O seu único objetivo é apostar na **estabilidade da volatilidade** e sair da posição antes que a aleatoriedade estatística jogue contra nós.

**Princípios Fundamentais:**

1.  **A Volatilidade é o Alvo:** O sucesso não depende de o preço subir ou descer, mas sim de ele **não se mover de forma explosiva**. O sistema deve ser capaz de identificar períodos de baixa volatilidade para maximizar a probabilidade de sucesso.
2.  **Taxa de Crescimento vs. Risco:** A "Taxa de Crescimento" (Growth Rate) é o parâmetro central. Taxas mais altas oferecem um retorno potencial maior, mas estreitam as barreiras, aumentando o risco. O sistema opera com um valor equilibrado de 3%.
3.  **Entrada por Confluência de Calmaria:** Uma posição só é aberta quando há uma **confluência de três sinais** de baixa volatilidade:
    *   **BBW (Largura das Bandas de Bollinger):** Deve estar num percentil baixo, indicando compressão de mercado.
    *   **ATR (Average True Range):** Deve estar abaixo da sua média, confirmando baixa amplitude de movimento.
    *   **Z-Score:** O preço deve estar próximo da sua média estatística, indicando ausência de desvios extremos.
4.  **Gestão de Risco e Saída Multi-Fator (Foco no Tempo):**
    *   **Alvo de Lucro (Take Profit):** Um lucro de **125% sobre o valor da aposta** é o alvo, capturando ganhos significativos em períodos de estabilidade.
    *   **"Kill Switch" Temporal e Adaptativo:** O sistema pré-define um tempo máximo de exposição com base no "ritmo" do mercado (**25s** para volátil, **40s** para normal, **55s** para calmo). Se o alvo de lucro não for atingido nesse tempo, a posição é encerrada.
    *   **Veto de Volatilidade Macro:** A posição é encerrada prematuramente se qualquer indicador (BBW, ATR ou ADX) sinalizar um aumento súbito de risco.
    *   **Veto de Micro-Volatilidade (Disjuntor Dinâmico):** Um "disjuntor" de alta frequência monitoriza o desvio padrão dos últimos 10 ticks. Se a volatilidade instantânea explodir (por um fator que varia de 2.0x a 3.5x com base no "humor" do mercado), a posição é vendida imediatamente para prevenir perdas por picos súbitos.
    *   **Stop-Loss de Capital:** Como uma rede de segurança final, a posição é vendida se a perda atingir 50% do valor da aposta, transformando uma perda potencial de 100% numa perda máxima e controlada.
    *   **Gerente de Risco Estratégico:** Após uma perda, o sistema diagnostica a causa (tempo ou volatilidade) e ajusta a sua estratégia futura, seja tornando os seus critérios de entrada mais rigorosos ou reduzindo o seu tempo de exposição.

---

## 2. Arquitetura em Camadas (Baseada no V1)

O sistema foi construído sobre a fundação estável do Deriv Trader V1, adaptando-o para a nova lógica de trading.

### 2.1. Camada de Conexão: `use-deriv-api-accumulators.tsx`

Esta é a ponte de comunicação dedicada para o ambiente de Acumuladores.

*   **Responsabilidade Principal**: Gerir a conexão WebSocket e o estado do ambiente de Acumuladores.
*   **Funções Chave**:
    *   **Execução de Contrato `ACCU`**: A função `executeTrade` foi totalmente reescrita para enviar o tipo de contrato `ACCU`, incluindo os novos parâmetros como `growth_rate`.
    *   **Gestão de Estado**: Mantém o `operationsLog` para Acumuladores e outros estados essenciais, de forma isolada dos outros sistemas.
    *   **Gestão de Posições Abertas**: Ouve o stream de `proposal_open_contract` para atualizar o lucro em tempo real e o estado de cada posição aberta.
    *   **Função de Venda**: Expõe a função `sellContract` para fechar posições manualmente ou via piloto automático.

### 2.2. Cérebro Cognitivo: `use-accumulators-council.ts` (O "Caçador de Calmaria")

Este hook contém a inteligência do piloto automático, projetado especificamente para Acumuladores.

*   **Responsabilidade Principal**: Identificar períodos de baixa volatilidade para abrir e fechar posições de forma autónoma e gerir o risco de forma adaptativa.
*   **Estratégia "Calm Seeker" V4 (Adaptive Time-Exit & Confluence)**:
    1.  **Deteção de Ritmo de Mercado:** O sistema classifica o mercado como 'calmo', 'normal' ou 'volátil'.
    2.  **Condição de Entrada (Confluência Tripla)**: O piloto só abre uma posição quando o "Nível de Calmaria" (uma métrica composta) ultrapassa um limiar dinâmico E as condições de BBW, ATR e Z-Score são satisfeitas.
    3.  **Gestão de Posição Única**: O sistema garante que apenas **um contrato** é aberto de cada vez, focando toda a sua análise na gestão dessa posição.
    4.  **Condição de Saída (Multi-Fator)**: Uma posição aberta é fechada se **uma** das seguintes condições for atendida (a que ocorrer primeiro):
        *   **Alvo de Lucro (Take Profit):** Atinge um lucro de 125% do valor da aposta.
        *   **"Kill Switch" Temporal:** O alvo de lucro não é atingido no tempo de segurança definido pelo ritmo do mercado.
        *   **Stop-Loss de Capital:** A perda atinge 50% do valor da aposta inicial.
        *   **Veto de Volatilidade (Macro e Micro):** O BBW, o ATR, o ADX ou a volatilidade instantânea dos ticks (via disjuntor dinâmico) aumentam subitamente.
    5.  **Gerente de Risco Estratégico (Auto-Calibração):** Após cada perda, o sistema diagnostica a causa (tempo ou volatilidade). Se a perda foi por tempo, ele se torna mais seletivo na próxima entrada. Se foi por volatilidade, ele aumenta o limiar de "Calmaria". Após uma vitória, ele gradualmente retorna aos parâmetros normais.

### 2.3. Camada de Interface: `deriv-trader-accumulators/page.tsx`

A interface do utilizador, focada na simplicidade e no controlo do novo piloto automático.

*   **Responsabilidade Principal**: Fornecer uma interface clara para a negociação manual e para a gestão do piloto automático.
*   **Componentes Chave**:
    *   `DerivTraderInterfaceAccumulators`: O painel de negociação manual, focado no `stake` e na `growth_rate`.
    *   `AccumulatorsAutopilotInterface`: Um novo painel que permite ao operador ligar/desligar o piloto automático, visualizar o novo **Nível de Calmaria** e o seu limiar, o **Checklist de Entrada** e monitorizar o estado do **Gerente de Risco**, incluindo o **tempo de duração adaptativo**.
    *   `OperationsLogAccumulators`: Um log de operações que exibe o lucro/prejuízo em tempo real para cada contrato e inclui um botão para fechar a posição manualmente.

Este design cria um ambiente focado e especializado, onde podemos testar e refinar as nossas novas estratégias de negociação de volatilidade de forma segura e eficiente.
