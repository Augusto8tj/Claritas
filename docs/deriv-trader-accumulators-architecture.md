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
    *   **"Take Profit" Proporcional à Volatilidade:** O lucro alvo não é fixo. Ele é calculado dinamicamente, sendo diretamente proporcional à volatilidade instantânea calculada pelo "Aprendiz". Mercados mais voláteis sugerem alvos de lucro maiores (estratégia de maior risco/recompensa), enquanto mercados calmos sugerem alvos mais conservadores.
    *   **"Kill Switch" Temporal e Adaptativo:** O sistema pré-define um tempo máximo de exposição com base no "ritmo" do mercado (**25s** para volátil, **40s** para normal, **55s** para calmo). Se o alvo de lucro não for atingido nesse tempo, a posição é encerrada.
    *   **Veto de Volatilidade Macro:** A posição é encerrada prematuramente se qualquer indicador (BBW, ATR ou ADX) sinalizar um aumento súbito de risco.
    *   **Veto de Micro-Volatilidade (Disjuntor Dinâmico Multi-Escala):** Um "disjuntor" de alta frequência monitoriza o desvio padrão dos ticks. A sua sensibilidade (o fator de multiplicação que dispara o veto) é **calibrada dinamicamente**: para um ativo historicamente "nervoso", ele torna-se mais tolerante a picos, enquanto para um ativo "calmo", torna-se ultra-sensível.
    *   **Stop-Loss de Capital:** Como uma rede de segurança final, a posição é vendida se a perda atingir 50% do valor da aposta, transformando uma perda potencial de 100% numa perda máxima e controlada.
    *   **Gerente de Risco Estratégico:** Após uma perda, o sistema diagnostica a causa (tempo ou volatilidade) e ajusta a sua estratégia futura, seja tornando os seus critérios de entrada mais rigorosos ou reduzindo o seu tempo de exposição.
5.  **Arena Virtual e Calibração Automática:** O sistema executa "paper trades" em paralelo, simulando uma barreira de perda baseada no **índice de ATR correto para a taxa de crescimento**, como `ATR * 0.348` para 3%. Se a taxa de acerto da Arena Virtual cai abaixo de 75%, o Gerente de Risco entra proativamente em **Modo Cauteloso**, aumentando os critérios de entrada antes mesmo que uma perda real ocorra.
6.  **Aprendiz do Tempo (Copiloto Manual):** Para auxiliar o operador, um "Aprendiz" do Mestre do Tempo analisa a volatilidade instantânea em múltiplas janelas de tempo curtas (5-30s). Ele fornece uma bandeira de "mercado calmo" e um alvo de **take profit conservador e dinâmico**. Crucialmente, ele **executa autonomamente o fecho da posição manual** assim que este alvo de lucro é atingido, agindo como um copiloto de gestão de risco para o operador.


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

### 2.2. Cérebro Cognitivo: `use-accumulators-council.ts` e `use-time-master.ts`

Estes hooks contêm a inteligência do sistema, agora separados por responsabilidade.

*   **`use-time-master.ts` (O Sentinela Perene):**
    *   **Responsabilidade:** Analisar o comportamento intrínseco do ativo a cada segundo, de forma independente.
    *   **Lógica:** Projeta continuamente o "tempo até a quebra" com base na volatilidade (ATR e desvio padrão dos ticks) e calcula o "Tempo de Saída Seguro" (25º percentil das projeções).

*   **`use-accumulators-council.ts` (O "Caçador de Calmaria"):**
    *   **Responsabilidade Principal**: Identificar períodos de baixa volatilidade para abrir e fechar posições de forma autónoma e gerir o risco de forma adaptativa.
    *   **Estratégia "Calm Seeker" V5 (Time-Aware)**:
        1.  **Consulta ao Mestre do Tempo:** O piloto consulta o `useTimeMaster` para obter o `safeExitTime` e o `averageBreakTime`.
        2.  **Calibração pela Arena Virtual:** A taxa de acerto das simulações da Arena (que agora usam o índice de barreira correto) é usada para ajustar o modo do "Gerente de Risco".
        3.  **Condição de Entrada (Confluência Tripla)**: O piloto só abre uma posição quando o "Nível de Calmaria" ultrapassa um limiar dinâmico E as condições de BBW, ATR e Z-Score são satisfeitas.
        4.  **Gestão de Posição Única**: O sistema garante que apenas **um contrato** é aberto de cada vez.
        5.  **Condição de Saída (Multi-Fator e Guiada pelo Tempo)**: Uma posição aberta é fechada se **uma** das seguintes condições for atendida (a que ocorrer primeiro):
            *   **Alvo de Lucro (Take Profit) Dinâmico:** Atinge um lucro alvo que é **ajustado pelo `averageBreakTime`**.
            *   **"Kill Switch" Temporal:** O alvo de lucro não é atingido no **`safeExitTime`** definido pelo Mestre do Tempo.
            *   **Stop-Loss de Capital:** A perda atinge 50% do valor da aposta inicial.
            *   **Veto de Volatilidade (Macro e Micro):** O BBW, o ATR, o ADX ou a volatilidade instantânea dos ticks (via disjuntor com sensibilidade dinâmica) aumentam subitamente.
        6.  **Gerente de Risco Estratégico (Auto-Calibração):** Após cada perda real, o sistema diagnostica a causa (tempo ou volatilidade) e ajusta a sua estratégia futura.

### 2.3. Camada de Interface: `deriv-trader-accumulators/page.tsx`

A interface do utilizador, focada na simplicidade e no controlo do novo piloto automático.

*   **Responsabilidade Principal**: Fornecer uma interface clara para a negociação manual e para a gestão do piloto automático.
*   **Componentes Chave**:
    *   `DerivTraderInterfaceAccumulators`: O painel de negociação manual, que agora inclui o painel do **"Aprendiz do Mestre do Tempo"** com a bandeira de "Mercado Calmo" e a sugestão de take profit.
    *   `AccumulatorsAutopilotInterface`: Um novo painel que permite ao operador ligar/desligar o piloto automático e visualizar o **Nível de Calmaria**, o **Checklist de Entrada** e o estado do **Gerente de Risco**. Inclui também o novo painel **"Mestre do Tempo"**.
    *   `OperationsLogAccumulators`: Um log de operações que exibe o lucro/prejuízo em tempo real para cada contrato.
    *   `VirtualArenaAccumulators`: Um painel que exibe os resultados da Arena Virtual, agora com a lógica de barreira corrigida.

Este design cria um ambiente focado e especializado, onde podemos testar e refinar as nossas novas estratégias de negociação de volatilidade de forma segura e eficiente.
