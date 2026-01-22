# Claritas Copilot - Arquitetura Técnica: Deriv Accumulators

Este documento detalha a arquitetura do sistema **Deriv Accumulators**, uma plataforma de trading desenhada para explorar a volatilidade dos mercados sintéticos da Deriv. Este sistema representa uma mudança de paradigma em relação ao trading direcional (Rise/Fall).

---

## 1. Filosofia de Design: O Mestre da Volatilidade

O Deriv Accumulators abandona a necessidade de prever a direção do mercado. O seu único objetivo é apostar na **estabilidade da volatilidade**. O contrato é ganho se o preço do ativo permanecer dentro de uma faixa definida, acumulando ganhos a cada tick.

**Princípios Fundamentais:**

1.  **A Volatilidade é o Alvo:** O sucesso não depende de o preço subir ou descer, mas sim de ele **não se mover de forma explosiva**. O sistema deve ser capaz de identificar períodos de baixa volatilidade para maximizar a probabilidade de sucesso.
2.  **Taxa de Crescimento vs. Risco:** A "Taxa de Crescimento" (Growth Rate) é o parâmetro central. Taxas mais altas oferecem um retorno potencial maior, mas estreitam as barreiras, aumentando o risco. O sistema deve encontrar um equilíbrio ótimo entre ganho e risco.
3.  **Análise de Volatilidade (Multi-Fator):** Indicadores como a Largura das Bandas de Bollinger (BBW), o ATR e o ADX (Average Directional Index) são cruciais. Uma confluência de sinais (bandas estreitas, ATR baixo e ADX baixo) indica um mercado "calmo", ideal para os Acumuladores.
4.  **Gestão de Risco e Saída Inteligente:**
    *   **Take Profit Automático:** As posições são fechadas automaticamente ao atingir 10% de lucro para garantir ganhos consistentes.
    *   **Veto de Volatilidade:** A posição é encerrada prematuramente se qualquer indicador (BBW, ATR ou ADX) sinalizar um aumento súbito de risco.
    *   **Gerente de Risco Estratégico:** Após uma perda, o sistema entra em "Modo Cauteloso", tornando os seus critérios de entrada mais rigorosos e impondo um período de "cooldown" para evitar decisões precipitadas.

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
*   **Estratégia "Calm Seeker" V2**:
    1.  **Condição de Entrada**: O piloto só abre uma posição quando há uma **confluência** de sinais de baixa volatilidade:
        *   **Bollinger Bands Width (BBW):** A largura das bandas deve estar significativamente abaixo da sua média recente.
        *   **Average Directional Index (ADX):** O ADX deve estar abaixo de um limiar (ex: 20), indicando um mercado sem tendência definida.
    2.  **Condição de Saída (Multi-Fator)**: Uma posição aberta é fechada se uma das seguintes condições for atendida:
        *   **Alvo de Lucro:** Atinge um lucro pré-definido (10% do valor da aposta).
        *   **Expansão da Volatilidade:** O BBW, o ATR ou o ADX aumentam subitamente, indicando que o período de "calmaria" terminou e o risco aumentou.
    3.  **Gerente de Risco Estratégico:**
        *   **Análise Pós-Perda:** Após cada perda, o sistema diagnostica a causa (ex: pico de ADX, expansão de BBW).
        *   **Ajuste Adaptativo:** Entra em "Modo Cauteloso", tornando os limiares de entrada para ADX e BBW mais rigorosos.
        *   **Cooldown:** Aguarda um período de tempo antes de procurar uma nova entrada.
        *   **Retorno à Normalidade:** Volta ao "Modo Normal" após uma operação bem-sucedida.

### 2.3. Camada de Interface: `deriv-trader-accumulators/page.tsx`

A interface do utilizador, focada na simplicidade e no controlo do novo piloto automático.

*   **Responsabilidade Principal**: Fornecer uma interface clara para a negociação manual e para a gestão do piloto automático.
*   **Componentes Chave**:
    *   `DerivTraderInterfaceAccumulators`: O painel de negociação manual, focado no `stake` e na `growth_rate`.
    *   `AccumulatorsAutopilotInterface`: Um novo painel que permite ao operador ligar/desligar o piloto automático e visualizar as métricas de volatilidade (BBW, ADX) e o estado do novo **Gerente de Risco**.
    *   `OperationsLogAccumulators`: Um log de operações que exibe o lucro/prejuízo em tempo real para cada contrato e inclui um botão para fechar a posição manualmente.

Este design cria um ambiente focado e especializado, onde podemos testar e refinar as nossas novas estratégias de negociação de volatilidade de forma segura e eficiente.
