# Claritas Copilot - Arquitetura Técnica: Deriv Multipliers

Este documento detalha a arquitetura do sistema **Deriv Multipliers**, uma plataforma de trading desenhada para seguir tendências de forma robusta, combinando análise de longo prazo com gatilhos de momentum de curto prazo.

---

## 1. Filosofia de Design: O Seguidor de Tendência "Padrão Ouro"

Ao contrário dos Acumuladores (que apostam na estabilidade) ou do Conselho V2.5 (que usa um consenso de especialistas), o sistema de Multiplicadores é um **trader de tendência puro**. A sua estratégia, apelidada de "Padrão Ouro", baseia-se em dois princípios fundamentais:

1.  **Operar a Favor da Maré:** O sistema nunca tenta "adivinhar" topos ou fundos. Ele primeiro identifica a tendência macro (de longo prazo) e só então procura oportunidades para entrar **na direção dessa tendência**.
2.  **Entrada por Confirmação de Momentum:** Uma tendência estabelecida não é suficiente. O sistema aguarda pacientemente por um sinal de **aceleração de momentum** de curto prazo que confirme que a tendência principal está a ganhar força, aumentando a probabilidade de sucesso.
3.  **Deixar os Lucros Correr, Cortar as Perdas Cedo:** A gestão de risco é a chave. As posições são abertas com um stop-loss definido, mas o alvo de lucro é dinâmico. Um **stop-loss móvel (trailing stop)** é ativado para proteger os ganhos e permitir que as operações vencedoras maximizem o seu potencial durante uma tendência forte.

---

## 2. Arquitetura em Camadas

O sistema segue uma estrutura de três camadas, isolada para garantir estabilidade.

### 2.1. Camada de Conexão: `use-deriv-api-multipliers.tsx`

Esta é a ponte de comunicação dedicada para o ambiente de Multiplicadores.

*   **Responsabilidade Principal**: Gerir a conexão WebSocket e a execução de contratos do tipo `MULTUP` e `MULTDOWN`.
*   **Funções Chave**:
    *   **Execução Especializada**: A função `executeTrade` envia os parâmetros específicos dos Multiplicadores, como `multiplier`.
    *   **Gestão de Posições Abertas**: Ouve o stream `proposal_open_contract` para atualizar o lucro/prejuízo de cada posição em tempo real.
    *   **Interface de Risco**: Expõe as funções `updateContract` (para ajustar TP/SL manualmente) e `sellContract` (para fechar posições).

### 2.2. Cérebro Cognitivo: `use-multipliers-council.ts` (O Estratega "Padrão Ouro")

Este hook contém a inteligência de uma única estratégia coesa, executada em ciclos.

*   **Responsabilidade Principal**: Identificar tendências, esperar por sinais de confirmação e **gerir o risco de forma dinâmica durante todo o ciclo de vida da operação**.
*   **Ciclo de Decisão**:
    1.  **Passo 1: Definir a Tendência Macro (A Linha na Areia)**
        *   O sistema utiliza uma **Média Móvel Exponencial (EMA) de 100 períodos** no gráfico de 1 minuto como o seu principal indicador de tendência.
        *   Se o preço atual está **acima** da EMA de 100, o sistema entra em **"Modo Compra"** e só considerará sinais de `UP`.
        *   Se o preço está **abaixo**, entra em **"Modo Venda"** e só considerará sinais de `DOWN`.

    2.  **Passo 2: Aguardar o Gatilho de Momentum (A Confirmação)**
        *   Com a tendência macro definida, o sistema monitoriza o **Índice de Força Relativa (RSI) de 14 períodos**.
        *   **Sinal de Compra:** Ocorre quando o sistema está em "Modo Compra" E o RSI cruza a sua linha central de 50 **de baixo para cima**.
        *   **Sinal de Venda:** Ocorre quando o sistema está em "Modo Venda" E o RSI cruza a linha de 50 **de cima para baixo**.
        *   O sistema só age na **primeira vez** que este cruzamento ocorre após uma mudança de tendência, para evitar múltiplas entradas no mesmo sinal.

    3.  **Passo 3: Cálculo de Risco para a Entrada**
        *   **Stake Ajustado pela Volatilidade:** O valor da aposta não é fixo. É uma percentagem da "Banca do Dia", mas é **reduzido pela volatilidade (ATR)**. Mercados mais voláteis levam a apostas menores.
        *   **Take Profit (Alvo de Segurança):** Um alvo de lucro inicial (ex: 25% do stake) é definido para garantir ganhos mínimos.
        *   **Stop-Loss (Proteção):** Cada operação é aberta com um stop-loss igual ao valor da aposta, limitando a perda máxima.

    4.  **Passo 4: Saída Inteligente (O "Trailing Stop" Automático) - **Lógica Movida para cá***
        *   Crucialmente, a lógica do **stop-loss móvel** agora reside neste hook, pois ele tem acesso tanto à posição aberta quanto ao indicador ATR necessário.
        *   Assim que uma operação atinge um lucro mínimo (ex: 15% do stake), o sistema move o stop-loss para o ponto de entrada (breakeven), chamando `updateContract`.
        *   Ao atingir um lucro maior, ele ativa um **trailing stop dinâmico**, subindo o stop para um nível calculado com base no ATR abaixo do preço máximo alcançado.
        *   Isto permite que o sistema "surfe" a tendência e maximize os ganhos, fechando a posição automaticamente apenas quando o preço reverte e atinge o nível de lucro protegido.

### 2.3. Camada de Interface: `deriv-trader-multipliers/page.tsx`

A interface do utilizador, focada em dar controlo e visibilidade sobre a estratégia.

*   **Responsabilidade Principal**: Fornecer uma interface clara para a negociação manual e para a gestão do piloto automático.
*   **Componentes Chave**:
    *   `DerivTraderInterfaceMultipliers`: Painel de negociação manual, com controlos para `stake`, `multiplier`, `take_profit` e `stop_loss`.
    *   `MultipliersAutopilotInterface`: Painel que permite ao operador ligar/desligar o piloto automático e visualizar em tempo real o **status do bot**, a **tendência macro** detetada e o **risco calculado** para a próxima operação.
    *   `OperationsLogMultipliers`: Um log de operações que exibe o lucro/prejuízo em tempo real para cada contrato e o **nível atual do "Trailing Stop"** quando ativo.

Este design cria um sistema de trading de tendência disciplinado e robusto, que combina análise macro com gatilhos de momentum e uma gestão de risco sofisticada.
