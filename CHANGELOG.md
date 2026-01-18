# Claritas Copilot - Registo de Alterações

Este documento regista a jornada de desenvolvimento e as principais funcionalidades implementadas no Claritas Copilot.

---

### v3.5.0 (Atual) - A Fundação Cognitiva: Promoção do Cérebro Quântico V1

**Funcionalidades Principais:**
- **Promoção da Arquitetura V1:** O motor do Deriv Trader V1 foi solidificado e promovido como a fundação cognitiva estável do sistema. A sua arquitetura, agora documentada em `docs/deriv-trader-v1-architecture.md`, serve como a base comprovada para os nossos princípios de trading.
- **Memória Estratégica & Aprendizagem Colaborativa:** Implementação da camada de persistência `AssetProfileV1` no Firestore. O sistema agora aprende o "regime preferencial" e o "limiar de consenso ótimo" de cada ativo.
- **Interface de Colaboração Homem-Máquina:** A adição do painel `AssetIntelligenceCard` permite que **você, o operador**, insira os seus próprios *insights* sobre um ativo, que são fundidos com a análise da IA para criar um cérebro híbrido e colaborativo.
- **Auditoria Forense Completa:** A "caixa-preta" do sistema V1 foi finalizada. O `TradingDecisionLogViewer` agora captura e exibe não apenas as decisões de execução, mas também todas as operações da **Arena Virtual** iniciadas em cada ciclo de decisão, garantindo transparência total.
- **Controlo Granular:** Adicionado um interruptor na interface do V1 para ligar ou desligar a "Auditoria Cognitiva", permitindo otimizar a performance ao desativar o logging detalhado quando não for necessário.

---

### v3.1.0 - O Laboratório de IA e a Visão Hierárquica

**Funcionalidades Principais:**
- **Criação do Deriv Trader 3.0 (IA Lab):** Um ambiente de desenvolvimento totalmente independente e isolado foi criado para permitir a experimentação e implementação de arquiteturas de IA radicais sem afetar a estabilidade da versão 2.5. Isto inclui a duplicação de todos os hooks e componentes essenciais (`use-deriv-api-v3`, `use-robot-council-v3`, `use-strategy-evolution-v3`, etc.).
- **Implementação da Detecção de Regime Hierárquica:** Como o primeiro avanço no laboratório 3.0, o sistema agora classifica o mercado em três níveis:
    - **Macro:** Tendência de longo prazo (bull/bear/sideways market).
    - **Meso:** O regime de curto prazo (trending, ranging, etc.).
    - **Micro:** Padrões de curtíssimo prazo (consolidação, exaustão, etc.).
- **Consenso Contextualizado:** O Cérebro V3 agora tem acesso a este contexto hierárquico completo, permitindo decisões de trading muito mais sofisticadas (ex: ser mais agressivo numa compra se o micro-padrão for de reversão dentro de um macro-mercado de alta).

---

### v2.5.0 - O Despertar Cognitivo: A Mesa Operacional Completa

**Funcionalidades Principais:**
- **Ativação Total do Conselho:** A lógica de votação (`calculateTechnicalVote`) foi expandida para incluir todos os 22 robôs-analistas. Estratégias como `ICHIMOKU`, `VWAP`, `Z_SCORE` e `TRIX` agora participam ativamente do consenso, trazendo uma diversidade de perspetivas sem precedentes.
- **Motor de Cálculo Soberano:** O `indicator-service.ts` foi reescrito do zero. Ele agora é 100% autónomo, sem dependências externas, e calcula o arsenal completo de mais de 25 indicadores necessários para alimentar cada especialista da mesa, eliminando "pontos cegos".
- **Desbloqueio da Arena Virtual:** Com a lógica de votação e o motor de indicadores completos, a Arena Virtual agora opera em plena capacidade. Todos os robôs fazem "paper trades" a cada sinal, gerando os dados de desempenho necessários para o sistema de meritocracia e evolução genética.

---

### v2.0.0 - O Cérebro Quantitativo: Arquitetura Adaptativa e Gestão de Risco Científica

**Funcionalidades Principais:**
- **Arquitetura "Regime-Aware" (Consciente do Contexto):** O sistema agora utiliza um modelo (HMM Lite) para identificar o regime de mercado em tempo real (ex: `TREND_UP`, `RANGING`). Robôs que são inadequados para um certo regime (ex: osciladores em forte tendência) são automaticamente silenciados, eliminando um dos maiores erros de robôs amadores.
- **Consenso Bayesiano Ponderado por Desempenho de Regime:** A votação deixou de ser uma simples contagem. O sistema agora calcula a probabilidade de sucesso de uma operação usando um consenso que dá mais peso aos robôs que historicamente têm melhor desempenho *naquele regime de mercado específico* (`winRateTrend` vs `winRateRange`).
- **Gestão de Risco Dinâmica com "Quarter Kelly":** O valor da aposta (`stake`) já não é fixo. É calculado cientificamente a cada oportunidade usando o Critério de Kelly Fracionado, que aposta mais agressivamente quando a probabilidade Bayesiana é alta e protege o capital quando a vantagem é baixa.
- **Veto de Microestrutura ("O Guarda-Costas"):** Uma camada final de proteção foi implementada. Mesmo com um consenso forte, o sistema vetará uma operação se a análise dos últimos 10 ticks revelar uma pressão de mercado contrária perigosa (ex: vetar uma compra durante um "crash" súbito).
- **Sistema Totalmente Adaptativo ao Timeframe:** A aplicação inteira, da interface ao núcleo da IA, agora consulta os limites de duração do contrato diretamente da API da corretora. Se o utilizador muda de "ticks" para "segundos", todo o sistema se recalibra para operar dentro das novas regras de tempo (ex: de `5 ticks` para `15 segundos`), garantindo que todas as operações são sempre válidas.

---

### v1.5.0 - A Evolução da Inteligência: Aprendizado Contínuo e Gestão de Risco Multidimensional

**Funcionalidades Principais:**
- **Laboratório de Evolução Genética:** Implementação do `useStrategyEvolution`, um cérebro de aprendizado contínuo. A cada 50 trades virtuais, o sistema identifica os robôs de pior desempenho e os substitui por "mutações" genéticas dos robôs de elite, garantindo que o conselho se adapte e melhore autonomamente.
- **Consenso de Capital:** Os robôs agora não só opinam sobre a direção e o tempo, mas também sugerem um valor de aposta (`stake`) proporcional à sua convicção. A aposta final é uma média ponderada destas sugestões, ajustada pelo risco.
- **Gestão de Risco Temporal Aprimorada:** A duração do contrato não é mais uma média simples. As sugestões de tempo de cada robô são convertidas para uma unidade comum (segundos), ponderadas pela confiança, e o resultado final é ajustado dinamicamente pela volatilidade do mercado (ATR, BBW).
- **Painel "Evolução":** Uma nova aba foi adicionada ao Deriv Trader para visualizar o histórico do Laboratório de Evolução, mostrando quais estratégias estão a ser promovidas e quais estão a ser substituídas.

---

### v1.0.0 - A Ascensão da IA: Autonomia e Persistência

**Funcionalidades Principais:**
- **Autonomia Total da Mesa:** A Mesa Operacional agora ajusta dinamicamente não só o **limiar de consenso**, but também o **valor da aposta (`stake`)** e a **duração do contrato** a cada tick. A IA analisa a volatilidade (ATR, Z-Score) e a força da tendência (ADX) para tomar decisões de risco em tempo real.
- **Memória Persistente com Firebase:** A Arena Virtual agora é "imortal". O desempenho de cada um dos 22 robôs (vitórias, derrotas, P&L) é guardado de forma segura no **Firestore**, associado à sua conta de utilizador. O progresso já não se perde ao fechar o navegador.
- **Hall da Fama Integrado:** O Hall da Fama foi movido da sua página isolada para um separador dedicado diretamente dentro da página **Deriv Trader**, centralizando todo o ecossistema de trading num único local. Ele busca os dados do Firebase, mostrando um placar de líderes persistente.
- **Consenso Relativo e Inteligente:** O limiar de consenso deixou de ser um número absoluto. Agora é calculado como uma **percentagem do potencial de voto máximo** disponível a cada momento, tornando-o verdadeiramente adaptativo à quantidade de robôs que têm uma opinião formada (`RISE` ou `FALL`).
- **Estratégias Locais e Fim da Dependência da IA:** O conselho de 22 robôs analistas já não é gerado por uma chamada de IA. As suas estratégias estão agora definidas localmente no ficheiro `src/services/council-strategies.ts`, tornando a inicialização da Mesa Operacional instantânea, fiável e consistente.

**Correções Críticas:**
- Resolvido um erro crucial (`TypeError: Cannot read properties of null`) que impedia a execução de trades automáticas devido à falta de verificação dos indicadores.
- Corrigida a lógica de votação do robô de Bandas de Bollinger, que estava inoperante e impedia a atividade na Arena.
- Garantido que os ajustes dinâmicos de `stake` e `duration` respeitam os limites mínimos da corretora ($0.35 e 1-10 ticks) e que os valores corretos são usados na execução da ordem.
- Corrigido um erro que tentava executar trades antes de a conexão com a API da corretora estar totalmente estabelecida.

---

### v0.5.0 - A Arena Virtual e Meritocracia

**Funcionalidades Principais:**
- **Criação da "Arena Virtual":** Implementação de um sistema de "paper trading" competitivo em segundo plano. O sistema rastreia o desempenho individual de cada um dos 22 robôs analistas.
- **Memória de Desempenho:** Utilização do `localStorage` para guardar as vitórias, derrotas e o P&L (Lucro/Prejuízo) de cada robô durante a sessão de trading.
- **Página "Mesa de Operações" (`/trading-desk`):** Criação de um novo ecrã que funciona como um *leaderboard*, exibindo o ranking de desempenho de todos os analistas, incluindo taxa de acerto e resultado financeiro.
- **Implementação da "Meritocracia":** Adição de um modo de operação onde os robôs com melhor desempenho histórico têm os seus votos ponderados com mais força, tornando o sistema auto-otimizável e adaptativo.
- **Navegação Atualizada:** Adicionado um link no menu lateral para a nova página "Mesa de Operações".

---

### v0.4.0 - Inteligência de Gestão e Análise de Elite

**Funcionalidades Principais:**
- **Gestão de Risco e Tempo Dinâmicos:** A "Direção de Risco" (`supervisionCommitteeCheck`) foi potenciada para não só aprovar ou vetar, mas também para **ajustar dinamicamente o valor da aposta (`stake`) e a duração do contrato**, com base na confiança do consenso e em fatores de mercado como volatilidade (ATR) e força da tendência (ADX).
- **"Gestor de Turno" Inteligente:** A persona `committeeOfSpecialists` foi evoluída para analisar a condição de mercado em tempo real (ex: "Tendência de Baixa com Exaustão") e exibir essa leitura na interface.
- **Lógica de Voto de Alta Frequência:** Implementação dos "Gatilhos de Disparo" para cada um dos 22 analistas, permitindo reações instantâneas a micro-movimentos em horizontes de tempo curtos (5 ticks).
- **Transparência Total da Mesa:** A interface foi atualizada para exibir em tempo real a atuação de todas as personas: o comité tático ativo, a decisão da supervisão de risco e a soma atual do consenso de votos.

**Correções:**
- **Reparação do Motor de Cálculo:** Corrigido o cálculo do indicador `RVI` e do `BBW` (Largura das Bandas de Bollinger), completando o arsenal de 22 indicadores no painel.

---

### v0.3.0 - O Conselho de 22 Analistas de IA

**Funcionalidades Principais:**
- **Criação do `strategy-council-flow`:** Desenvolvimento do fluxo de IA mestre, responsável por gerar um conselho de 22 robôs analistas, cada um com uma estratégia e parâmetros específicos.
- **Calibração Dinâmica:** O conselho passou a ser "consciente do tempo". A IA ajusta os parâmetros de todos os analistas com base no horizonte de tempo selecionado (de Ticks a Diário).
- **Motor de Cálculo Abrangente:** Criação do `DerivFinanceLib.ts` e `indicator-service.ts`, um motor robusto para calcular todos os 22 indicadores técnicos necessários para alimentar o conselho.
- **Lógica de Votação:** Implementação da lógica base para que cada analista possa emitir um voto de `RISE`, `FALL`, ou `HOLD`.

**Correções Críticas:**
- Resolvido um bug onde os robôs perdiam o acesso aos dados do motor de cálculo ("perda de visão").
- Corrigido um erro de `module not found` que impedia a construção do conselho.

---

### v0.2.0 - Introdução à Mesa Operacional (Deriv Trader)

**Funcionalidades Principais:**
- **Integração com a API da Deriv:** Estabelecimento da conexão WebSocket para receber dados de mercado em tempo real e executar operações.
- **Gráfico de Trading Avançado:** Implementação de um gráfico renderizado em SVG, estável, responsivo, com suporte para múltiplos tipos (Linha/Velas), indicadores sobrepostos e ferramentas de zoom.
- **Copiloto de Trade:** Primeira versão do assistente de IA para negociação, capaz de analisar o desempenho e sugerir operações.
- **Estrutura de Hooks:** Criação do `useDerivApi` para centralizar a comunicação com a API e do `useRobotCouncil` como o "cérebro" da operação.

---

### v0.1.0 - Fundação e Finanças Pessoais

**Funcionalidades Iniciais:**
- **Setup do Projeto:** Estruturação inicial do projeto em Next.js com TypeScript e ShadCN UI.
- **Módulos de Finanças Pessoais:** Implementação do Painel Principal, Análise de Despesas, Orçamento Mensal e Metas Financeiras.
- **Autenticação:** Sistema de login e registo de utilizadores com Firebase.
- **Chatbot com IA (Claritas):** Integração de um chatbot Genkit para insights e interações financeiras.
- **Página de Ajuda e Configurações:** Criação das páginas de suporte e personalização da aplicação.
