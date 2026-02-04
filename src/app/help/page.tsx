// /src/app/help/page.tsx
'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const changelogContentString = `# Claritas Copilot - Registo de Alterações

Este documento regista a jornada de desenvolvimento e as principais funcionalidades implementadas no Claritas Copilot.

---

### v5.5.0 - Robustez Arquitetural e Documentação Definitiva

**Melhorias Estratégicas e Arquiteturais:**
- **Portal de Arquitetura Centralizado:** O \`README.md\` principal foi transformado num guia completo, detalhando a filosofia de design e os ficheiros-chave para cada uma das nossas 7 plataformas de trading, servindo como um ponto de entrada único para entender o ecossistema.
- **Documentação Dedicada por Sistema:** Foram criados e atualizados documentos de arquitetura específicos para as plataformas V1, V2.5 e Multipliers (\`docs/\`), garantindo que a lógica complexa de cada sistema esteja claramente documentada.
- **Profissionalização da Plataforma "Deriv Digits":** A página de "Digits" foi completamente reconstruída. Foi integrado o gráfico de mercado avançado (\`MarketChart\`) e o seu hook de API (\`use-deriv-api-digits.tsx\`) foi refatorado para ter a mesma robustez dos outros sistemas, resolvendo falhas críticas no fluxo de dados em tempo real.
- **Resiliência da API Aprimorada:** Todos os 6 hooks de conexão com a API da Deriv foram refatorados para tratar erros de rede e timeouts de forma controlada, eliminando "unhandled promise rejections" e tornando a aplicação mais estável.

**Correções Críticas:**
- **Ativação do "Trailing Stop" nos Multiplicadores:** Corrigida uma falha crítica na plataforma "Deriv Multipliers". A lógica do **stop-loss móvel (trailing stop)**, que é o coração da estratégia, foi movida para o hook correto (\`use-multipliers-council.ts\`) e agora funciona como projetado, permitindo "deixar os lucros correr" de forma segura.
- **Resolução de Erros de Build:** Corrigidos múltiplos erros de importação que surgiram após a reorganização dos ficheiros de serviços, garantindo que a compilação do projeto seja estável.
- **Correção de Erro de Runtime:** Corrigido um \`ReferenceError\` na função \`extractMicrostructureFeatures\` que impedia o funcionamento de análises avançadas.

**Ferramentas de Desenvolvimento:**
- **Script de Recuperação Git:** Adicionado o script \`abort_rebase.sh\` para ajudar a resolver estados de \`rebase\` pendentes no Git, restaurando a estabilidade do repositório local com um único comando.

---

### v5.1.0 - Otimização e Foco: Descontinuação da Central de Comando

**Mudanças Estratégicas:**
- **Descontinuação da Página "Master Autopilot":** A página \`/master-autopilot\` e sua interface complexa foram removidas. O sistema estava a consumir recursos excessivos e a sua funcionalidade foi consolidada.
- **Foco na "Análise de Volatilidade":** Toda a lógica do piloto automático preditivo, anteriormente partilhada, está agora concentrada e otimizada exclusivamente para a página \`/volatility-analysis\`.
- **Navegação Simplificada:** O link para a "Central de Comando" foi removido do menu principal, simplificando a navegação e focando nos ecossistemas de trading mais estáveis e performáticos.

---

### v5.0.0 - O Comandante Tático: Master Autopilot V5 (Regime-Aware)

**Funcionalidades Principais:**
- **Implementação do Master Autopilot V5:** O sistema de comando foi promovido para se tornar um **comandante tático, consciente do regime de mercado**.
- **Análise Tática de Regime:** O piloto agora classifica o mercado em 5 regimes (\`trending_bull\`, \`ranging\`, etc.) e valida se o contrato selecionado pelo operador é compatível com o cenário atual antes de operar.
- **Laboratório Preditivo (\`/volatility-analysis\`):** Criação de um ambiente de análise quantitativa avançado para dissecar e prever o comportamento de ativos.
- **Comitê de Especialistas Temporais:** O laboratório utiliza um comitê de especialistas de IA, cada um focado num horizonte de tempo (1t, 3t, 10s, etc.), que usam o modelo **Movimento Browniano Geométrico (GBM)** para gerar projeções.
- **Meritocracia Preditiva:** O sistema mede constantemente a **Assertividade** (taxa de acerto) de cada especialista e usa essa métrica para ponderar as suas decisões, criando um ciclo de aprendizagem e auto-avaliação.
- **Gestão de Risco Granular e Adaptativa:** A penalidade ou recompensa após um trade é agora aplicada **individualmente** aos especialistas que participaram na decisão, tornando o sistema mais justo e rápido a adaptar-se.
- **Confirmação Tripla:** Foi adicionada uma configuração experimental que exige o consenso de três especialistas vizinhos (anterior, atual e próximo) para aumentar a robustez dos sinais de entrada.

---

### v4.5.0 - O Mestre dos Multiplicadores e a Centralização da Arquitetura

**Melhorias Estratégicas:**
- **Ativação do "Trailing Stop" nos Multiplicadores:** Corrigida uma falha crítica na arquitetura da plataforma "Deriv Multipliers". A lógica do **stop-loss móvel (trailing stop)**, que é o coração da estratégia, foi movida para o hook \`use-multipliers-council.ts\`, que tem acesso aos indicadores (ATR) necessários para o seu cálculo. A estratégia agora funciona conforme o seu design original, permitindo "deixar os lucros correr" de forma automática e segura.
- **Profissionalização da Plataforma "Deriv Digits":** A página de "Digits" foi completamente reconstruída. Foi integrado o **gráfico de mercado avançado (\`MarketChart\`)**, e o seu hook de API (\`use-deriv-api-digits.tsx\`) foi atualizado para ter a mesma robustez dos outros sistemas, resolvendo falhas no fluxo de dados em tempo real.
- **Reorganização e Centralização da Arquitetura:** Executada uma refatoração completa da estrutura do projeto. Todos os serviços específicos de trading (\`indicator-service\`, \`council-strategies\`, \`advanced-trading-services\`) foram movidos da pasta genérica \`src/services\` para a sua localização correta em \`src/features/trading/services\`. Esta mudança eliminou múltiplos erros de build e tornou a arquitetura mais limpa e manutenível.
- **Resiliência da API Aprimorada:** A lógica de comunicação com a API em todos os hooks de trading foi refatorada. Erros de rede e timeouts agora são tratados de forma controlada, eliminando "unhandled promise rejections" e tornando a aplicação mais estável. A mensagem de "token inválido" foi reclassificada para um aviso (\`warn\`) para reduzir o ruído na consola do programador.

**Correções Críticas:**
- **Resolução de Erros de Build:** Corrigidos múltiplos erros de importação que surgiram após a reorganização dos ficheiros.
- **Correção de Conflito de Merge:** Removidos marcadores de conflito de merge (\`=======\`, \`>>>>>>>\`) que estavam a impedir a compilação da página \`deriv-trader-v2\`.
- **Correção de Erro de Runtime:** Corrigido um \`ReferenceError\` na função \`extractMicrostructureFeatures\` (\`advanced-trading-services.ts\`) onde uma variável (\`mean\`) foi usada incorretamente em vez de \`avgPrice\`.

**Ferramentas de Desenvolvimento:**
- Adicionado o script \`abort_rebase.sh\` para ajudar a resolver estados de \`rebase\` pendentes no Git, restaurando a estabilidade do repositório local.

---

### v4.0.0 (IA Lab) - O Mestre da Volatilidade: Deriv Accumulators

**Funcionalidades Principais:**
- **Criação da Plataforma "Deriv Accumulators":** Um novo ambiente de trading foi construído do zero, inspirado na estabilidade do Deriv Trader V1, mas focado exclusivamente no novo tipo de contrato "Accumulator".
- **Mudança de Paradigma:** O sistema abandona a negociação direcional (subida/queda) e foca-se em apostar na **estabilidade da volatilidade**. O objetivo é lucrar enquanto o preço se mantém dentro de barreiras dinâmicas.
- **Nova Interface de Trading:** Foi criada uma interface de utilizador simplificada e especializada (\`deriv-trader-interface-accumulators.tsx\`) que remove os botões de "Rise/Fall" e introduz controlos para os parâmetros chave dos Acumuladores:
    - **Taxa de Crescimento (Growth Rate):** Um slider permite ao operador escolher o seu apetite de risco (de 1% a 5%).
    - **Valor da Aposta (Stake):** Controlo de risco para cada operação.
- **Motor de API Dedicado:** O hook \`use-deriv-api-accumulators.tsx\` foi desenvolvido para lidar com a lógica de compra de contratos do tipo \`ACCU\`, garantindo que os pedidos corretos são enviados à API da Deriv.
- **Arquitetura Isolada:** Toda a plataforma de Acumuladores (página, hooks, componentes) opera de forma independente, garantindo que a experimentação com este novo tipo de contrato não afete a estabilidade dos sistemas V1, V2.5 e Multiplicadores.

---

### v3.5.0 - A Fundação Cognitiva: Promoção do Cérebro Quântico V1

**Funcionalidades Principais:**
- **Promoção da Arquitetura V1:** O motor do Deriv Trader V1 foi solidificado e promovido como a fundação cognitiva estável do sistema. A sua arquitetura, agora documentada em \`docs/deriv-trader-v1-architecture.md\`, serve como a base comprovada para os nossos princípios de trading.
- **Memória Estratégica & Aprendizagem Colaborativa:** Implementação da camada de persistência \`AssetProfileV1\` no Firestore. O sistema agora aprende o "regime preferencial" e o "limiar de consenso ótimo" de cada ativo.
- **Interface de Colaboração Homem-Máquina:** A adição do painel \`AssetIntelligenceCard\` permite que **você, o operador**, insira os seus próprios *insights* sobre um ativo, que são fundidos com a análise da IA para criar um cérebro híbrido e colaborativo.
- **Auditoria Forense Completa:** A "caixa-preta" do sistema V1 foi finalizada. O \`TradingDecisionLogViewer\` agora captura e exibe não apenas as decisões de execução, mas também todas as operações da **Arena Virtual** iniciadas em cada ciclo de decisão, garantindo transparência total.
- **Controlo Granular:** Adicionado um interruptor na interface do V1 para ligar ou desligar a "Auditoria Cognitiva", permitindo otimizar a performance ao desativar o logging detalhado quando não for necessário.

---

### v3.1.0 - O Laboratório de IA e a Visão Hierárquica

**Funcionalidades Principais:**
- **Criação do Deriv Trader 3.0 (IA Lab):** Um ambiente de desenvolvimento totalmente independente e isolado foi criado para permitir a experimentação e implementação de arquiteturas de IA radicais sem afetar a estabilidade da versão 2.5. Isto inclui a duplicação de todos os hooks e componentes essenciais (\`use-deriv-api-v3\`, \`use-robot-council-v3\`, \`use-strategy-evolution-v3\`, etc.).
- **Implementação da Detecção de Regime Hierárquica:** Como o primeiro avanço no laboratório 3.0, o sistema agora classifica o mercado em três níveis:
    - **Macro:** Tendência de longo prazo (bull/bear/sideways market).
    - **Meso:** O regime de curto prazo (trending, ranging, etc.).
    - **Micro:** Padrões de curtíssimo prazo (consolidação, exaustão, etc.).
- **Consenso Contextualizado:** O Cérebro V3 agora tem acesso a este contexto hierárquico completo, permitindo decisões de trading muito mais sofisticadas (ex: ser mais agressivo numa compra se o micro-padrão for de reversão dentro de um macro-mercado de alta).

---

### v2.5.0 - O Despertar Cognitivo: A Mesa Operacional Completa

**Funcionalidades Principais:**
- **Ativação Total do Conselho:** A lógica de votação (\`calculateTechnicalVote\`) foi expandida para incluir todos os 22 robôs-analistas. Estratégias como \`ICHIMOKU\`, \`VWAP\`, \`Z_SCORE\` e \`TRIX\` agora participam ativamente do consenso, trazendo uma diversidade de perspetivas sem precedentes.
- **Motor de Cálculo Soberano:** O \`indicator-service.ts\` foi reescrito do zero. Ele agora é 100% autónomo, sem dependências externas, e calcula o arsenal completo de mais de 25 indicadores necessários para alimentar cada especialista da mesa, eliminando "pontos cegos".
- **Desbloqueio da Arena Virtual:** Com a lógica de votação e o motor de indicadores completos, a Arena Virtual agora opera em plena capacidade. Todos os robôs fazem "paper trades" a cada sinal, gerando os dados de desempenho necessários para o sistema de meritocracia e evolução genética.

---

### v2.0.0 - O Cérebro Quantitativo: Arquitetura Adaptativa e Gestão de Risco Científica

**Funcionalidades Principais:**
- **Arquitetura "Regime-Aware" (Consciente do Contexto):** O sistema agora utiliza um modelo (HMM Lite) para identificar o regime de mercado em tempo real (ex: \`TREND_UP\`, \`RANGING\`). Robôs que são inadequados para um certo regime (ex: osciladores em forte tendência) são automaticamente silenciados, eliminando um dos maiores erros de robôs amadores.
- **Consenso Bayesiano Ponderado por Desempenho de Regime:** A votação deixou de ser uma simples contagem. O sistema agora calcula a probabilidade de sucesso de uma operação usando um consenso que dá mais peso aos robôs que historicamente têm melhor desempenho *naquele regime de mercado específico* (\`winRateTrend\` vs \`winRateRange\`).
- **Gestão de Risco Dinâmica com "Quarter Kelly":** O valor da aposta (\`stake\`) já não é fixo. É calculado cientificamente a cada oportunidade usando o Critério de Kelly Fracionado, que aposta mais agressivamente quando a probabilidade Bayesiana é alta e protege o capital quando a vantagem é baixa.
- **Veto de Microestrutura ("O Guarda-Costas"):** Uma camada final de proteção foi implementada. Mesmo com um consenso forte, o sistema vetará uma operação se a análise dos últimos 10 ticks revelar uma pressão de mercado contrária perigosa (ex: vetar uma compra durante um "crash" súbito).
- **Sistema Totalmente Adaptativo ao Timeframe:** A aplicação inteira, da interface ao núcleo da IA, agora consulta os limites de duração do contrato diretamente da API da corretora. Se o utilizador muda de "ticks" para "segundos", todo o sistema se recalibra para operar dentro das novas regras de tempo (ex: de \`5 ticks\` para \`15 segundos\`), garantindo que todas as operações são sempre válidas.

---

### v1.5.0 - A Evolução da Inteligência: Aprendizado Contínuo e Gestão de Risco Multidimensional

**Funcionalidades Principais:**
- **Laboratório de Evolução Genética:** Implementação do \`useStrategyEvolution\`, um cérebro de aprendizado contínuo. A cada 50 trades virtuais, o sistema identifica os robôs de pior desempenho e os substitui por "mutações" genéticas dos robôs de elite, garantindo que o conselho se adapte e melhore autonomamente.
- **Consenso de Capital:** Os robôs agora não só opinam sobre a direção e o tempo, mas também sugerem um valor de aposta (\`stake\`) proporcional à sua convicção. A aposta final é uma média ponderada destas sugestões, ajustada pelo risco.
- **Gestão de Risco Temporal Aprimorada:** A duração do contrato não é mais uma média simples. As sugestões de tempo de cada robô são convertidas para uma unidade comum (segundos), ponderadas pela confiança, e o resultado final é ajustado dinamicamente pela volatilidade do mercado (ATR, BBW).
- **Painel "Evolução":** Uma nova aba foi adicionada ao Deriv Trader para visualizar o histórico do Laboratório de Evolução, mostrando quais estratégias estão a ser promovidas e quais estão a ser substituídas.

---

### v1.0.0 - A Ascensão da IA: Autonomia e Persistência

**Funcionalidades Principais:**
- **Autonomia Total da Mesa:** A Mesa Operacional agora ajusta dinamicamente não só o **limiar de consenso**, but também o **valor da aposta (\`stake\`)** e a **duração do contrato** a cada tick. A IA analisa a volatilidade (ATR, Z-Score) e a força da tendência (ADX) para tomar decisões de risco em tempo real.
- **Memória Persistente com Firebase:** A Arena Virtual agora é "imortal". O desempenho de cada um dos 22 robôs (vitórias, derrotas, P&L) é guardado de forma segura no **Firestore**, associado à sua conta de utilizador. O progresso já não se perde ao fechar o navegador.
- **Hall da Fama Integrado:** O Hall da Fama foi movido da sua página isolada para um separador dedicado diretamente dentro da página **Deriv Trader**, centralizando todo o ecossistema de trading num único local. Ele busca os dados do Firebase, mostrando um placar de líderes persistente.
- **Consenso Relativo e Inteligente:** O limiar de consenso deixou de ser um número absoluto. Agora é calculado como uma **percentagem do potencial de voto máximo** disponível a cada momento, tornando-o verdadeiramente adaptativo à quantidade de robôs que têm uma opinião formada (\`RISE\` ou \`FALL\`).
- **Estratégias Locais e Fim da Dependência da IA:** O conselho de 22 robôs analistas já não é gerado por uma chamada de IA. As suas estratégias estão agora definidas localmente no ficheiro \`src/services/council-strategies.ts\`, tornando a inicialização da Mesa Operacional instantânea, fiável e consistente.

**Correções Críticas:**
- Resolvido um erro crucial (\`TypeError: Cannot read properties of null\`) que impedia a execução de trades automáticas devido à falta de verificação dos indicadores.
- Corrigida a lógica de votação do robô de Bandas de Bollinger, que estava inoperante e impedia a atividade na Arena.
- Garantido que os ajustes dinâmicos de \`stake\` e \`duration\` respeitam os limites mínimos da corretora ($0.35 e 1-10 ticks) e que os valores corretos são usados na execução da ordem.
- Corrigido um erro que tentava executar trades antes de a conexão com a API da corretora estar totalmente estabelecida.

---

### v0.5.0 - A Arena Virtual e Meritocracia

**Funcionalidades Principais:**
- **Criação da "Arena Virtual":** Implementação de um sistema de "paper trading" competitivo em segundo plano. O sistema rastreia o desempenho individual de cada um dos 22 robôs analistas.
- **Memória de Desempenho:** Utilização do \`localStorage\` para guardar as vitórias, derrotas e o P&L (Lucro/Prejuízo) de cada robô durante a sessão de trading.
- **Página "Mesa de Operações" (\`/trading-desk\`):** Criação de um novo ecrã que funciona como um *leaderboard*, exibindo o ranking de desempenho de todos os analistas, incluindo taxa de acerto e resultado financeiro.
- **Implementação da "Meritocracia":** Adição de um modo de operação onde os robôs com melhor desempenho histórico têm os seus votos ponderados com mais força, tornando o sistema auto-otimizável e adaptativo.
- **Navegação Atualizada:** Adicionado um link no menu lateral para a nova página "Mesa de Operações".

---

### v0.4.0 - Inteligência de Gestão e Análise de Elite

**Funcionalidades Principais:**
- **Gestão de Risco e Tempo Dinâmicos:** A "Direção de Risco" (\`supervisionCommitteeCheck\`) foi potenciada para não só aprovar ou vetar, mas também para **ajustar dinamicamente o valor da aposta (\`stake\`) e a duração do contrato**, com base na confiança do consenso e em fatores de mercado como volatilidade (ATR) e força da tendência (ADX).
- **"Gestor de Turno" Inteligente:** A persona \`committeeOfSpecialists\` foi evoluída para analisar a condição de mercado em tempo real (ex: "Tendência de Baixa com Exaustão") e exibir essa leitura na interface.
- **Lógica de Voto de Alta Frequência:** Implementação dos "Gatilhos de Disparo" para cada um dos 22 analistas, permitindo reações instantâneas a micro-movimentos em horizontes de tempo curtos (5 ticks).
- **Transparência Total da Mesa:** A interface foi atualizada para exibir em tempo real a atuação de todas as personas: o comité tático ativo, a decisão da supervisão de risco e a soma atual do consenso de votos.

**Correções:**
- **Reparação do Motor de Cálculo:** Corrigido o cálculo do indicador \`RVI\` e do \`BBW\` (Largura das Bandas de Bollinger), completando o arsenal de 22 indicadores no painel.

---

### v0.3.0 - O Conselho de 22 Analistas de IA

**Funcionalidades Principais:**
- **Criação do \`strategy-council-flow\`:** Desenvolvimento do fluxo de IA mestre, responsável por gerar um conselho de 22 robôs analistas, cada um com uma estratégia e parâmetros específicos.
- **Calibração Dinâmica:** O conselho passou a ser "consciente do tempo". A IA ajusta os parâmetros de todos os analistas com base no horizonte de tempo selecionado (de Ticks a Diário).
- **Motor de Cálculo Abrangente:** Criação do \`DerivFinanceLib.ts\` e \`indicator-service.ts\`, um motor robusto para calcular todos os 22 indicadores técnicos necessários para alimentar o conselho.
- **Lógica de Votação:** Implementação da lógica base para que cada analista possa emitir um voto de \`RISE\`, \`FALL\`, ou \`HOLD\`.

**Correções Críticas:**
- Resolvido um bug onde os robôs perdiam o acesso aos dados do motor de cálculo ("perda de visão").
- Corrigido um erro de \`module not found\` que impedia a construção do conselho.

---

### v0.2.0 - Introdução à Mesa Operacional (Deriv Trader)

**Funcionalidades Principais:**
- **Integração com a API da Deriv:** Estabelecimento da conexão WebSocket para receber dados de mercado em tempo real e executar operações.
- **Gráfico de Trading Avançado:** Implementação de um gráfico renderizado em SVG, estável, responsivo, com suporte para múltiplos tipos (Linha/Velas), indicadores sobrepostos e ferramentas de zoom.
- **Copiloto de Trade:** Primeira versão do assistente de IA para negociação, capaz de analisar o desempenho e sugerir operações.
- **Estrutura de Hooks:** Criação do \`useDerivApi\` para centralizar a comunicação com a API e do \`useRobotCouncil\` como o "cérebro" da operação.

---

### v0.1.0 - Fundação e Finanças Pessoais

**Funcionalidades Iniciais:**
- **Setup do Projeto:** Estruturação inicial do projeto em Next.js com TypeScript e ShadCN UI.
- **Módulos de Finanças Pessoais:** Implementação do Painel Principal, Análise de Despesas, Orçamento Mensal e Metas Financeiras.
- **Autenticação:** Sistema de login e registo de utilizadores com Firebase.
- **Chatbot com IA (Claritas):** Integração de um chatbot Genkit para insights e interações financeiras.
- **Página de Ajuda e Configurações:** Criação das páginas de suporte e personalização da aplicação.
`;

const ChangelogContent = () => {
    // Processar o conteúdo do changelog para HTML ou usar um parser de markdown
    // Por simplicidade, vamos usar uma regex para substituir os marcadores por elementos HTML
    const formattedContent = changelogContentString
        .replace(/### (.*)/g, '<h3 class="text-xl font-bold mt-4 mb-2 font-headline">$1</h3>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code class="bg-muted text-muted-foreground px-1 py-0.5 rounded text-sm font-mono">$1</code>')
        .replace(/---/g, '<hr class="my-4 border-border" />')
        .replace(/^- (.*)/gm, '<li class="ml-4 list-disc">$1</li>')
        .replace(/\*\*\s(.*?):\*\*/g, '<strong>$1:</strong>'); // Make bolded colons consistent


    return (
        <div 
            className="prose prose-sm dark:prose-invert max-w-none text-base leading-relaxed space-y-2"
            dangerouslySetInnerHTML={{ __html: formattedContent }}
        />
    );
};


export default function HelpPage() {
  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-3xl font-bold tracking-tight font-headline">
          Central de Ajuda
        </h1>
      </div>
      <p className="text-muted-foreground">
        Encontre respostas para suas perguntas sobre o Claritas Copilot.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="font-headline">Guia Completo do Aplicativo</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1">
              <AccordionTrigger className="text-lg font-semibold">
                Visão Geral e Autenticação
              </AccordionTrigger>
              <AccordionContent className="text-base leading-relaxed space-y-2">
                <p>O Claritas Copilot é seu assistente financeiro pessoal, projetado para ajudá-lo a ter uma visão clara de suas finanças. O acesso é protegido por <strong>autenticação via Firebase</strong>: crie uma conta ou faça login para acessar seus dados de forma segura em qualquer dispositivo. Você também pode gerenciar seu nome e foto na página de <strong>Perfil</strong>.</p>
                 <p className="pt-2"><strong>Nota sobre os Dados:</strong> O módulo de finanças pessoais funciona com os seus dados reais, guardados de forma segura no Firebase. O módulo de trading (Deriv Trader) conecta-se a dados reais ou de demonstração da corretora Deriv.</p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-2">
              <AccordionTrigger className="text-lg font-semibold">
                Painel Principal (Dashboard)
              </AccordionTrigger>
              <AccordionContent className="text-base leading-relaxed space-y-2">
                <p>O <strong>Painel</strong> é a sua central de comando financeira. Aqui você encontra:</p>
                <ul className="list-disc pl-6 space-y-1">
                  <li><strong>Insight do Copiloto de IA:</strong> Sugestões personalizadas geradas por IA para melhorar sua saúde financeira.</li>
                  <li><strong>Patrimônio Líquido:</strong> Um gráfico que mostra a evolução do seu patrimônio ao longo do tempo.</li>
                  <li><strong>Balanço Mensal:</strong> Uma visão rápida de suas receitas versus despesas para o mês atual.</li>
                  <li><strong>Acompanhamento de Metas:</strong> Um carrossel interativo para visualizar o progresso de todas as suas metas financeiras.</li>
                  <li><strong>Contas a Vencer:</strong> Uma lista de suas próximas contas para que você nunca perca um pagamento.</li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-3">
              <AccordionTrigger className="text-lg font-semibold">
                Análise de Despesas
              </AccordionTrigger>
              <AccordionContent className="text-base leading-relaxed">
                A página de <strong>Análise</strong> oferece um detalhamento dos seus gastos. O gráfico de pizza mostra a distribuição de suas despesas por categoria, enquanto a tabela exibe suas transações recentes. Para adicionar transações, use o <strong>Chat IA Claritas</strong> e peça, por exemplo, "Adicione um gasto de R$50 com Uber".
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-4">
              <AccordionTrigger className="text-lg font-semibold">
                Orçamento Mensal (Interativo!)
              </AccordionTrigger>
              <AccordionContent className="text-base leading-relaxed">
                A página de <strong>Orçamento</strong> ajuda você a manter seus gastos sob controle. Para cada categoria, você pode ver quanto já gastou em relação ao limite definido. Clique no ícone de lápis para <strong>editar os limites</strong> de cada categoria e personalizar seu planejamento financeiro. Os gastos são atualizados automaticamente conforme você adiciona novas transações.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-5">
              <AccordionTrigger className="text-lg font-semibold">
                Metas Financeiras
              </AccordionTrigger>
              <AccordionContent className="text-base leading-relaxed space-y-2">
                <p>Na seção de <strong>Metas</strong>, você pode criar, visualizar e deletar suas metas financeiras. Ao adicionar uma nova meta, a IA gera uma imagem inspiradora para representá-la!</p>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-6">
              <AccordionTrigger className="text-lg font-semibold">
                Chatbots com Inteligência Artificial
              </AccordionTrigger>
              <AccordionContent className="text-base leading-relaxed space-y-2">
                <p>O Claritas Copilot oferece dois assistentes de IA:</p>
                <ul className="list-disc pl-6 space-y-1">
                  <li><strong>Chat com IA:</strong> Um chatbot para responder a perguntas gerais sobre finanças, conceitos de investimento, dicas de economia, etc.</li>
                  <li><strong>Chat IA Claritas:</strong> Uma versão avançada da IA que pode <strong>acessar os dados do seu aplicativo</strong>. Use-a para perguntar sobre seu orçamento ("como estão meus gastos com lazer?"), obter insights, adicionar transações, criar metas ou até mesmo consultar a cotação de uma ação ("qual o preço de PETR4?").</li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-20">
                <AccordionTrigger className="text-lg font-semibold">Ecossistema de Trading: As Plataformas</AccordionTrigger>
                <AccordionContent className="text-base leading-relaxed space-y-2">
                    <p>O Claritas Copilot não é um único robô, mas um conjunto de ecossistemas de trading, cada um otimizado para uma estratégia diferente. Aqui está um resumo de cada um:</p>
                    <Accordion type="single" collapsible className="w-full mt-4 space-y-2">
                        
                        <AccordionItem value="platform-1">
                            <AccordionTrigger>Deriv Trader V2.5: O Cérebro Quantitativo</AccordionTrigger>
                            <AccordionContent className="text-sm space-y-2">
                                <p>A nossa implementação mais sofisticada de trading por consenso. Opera como uma mesa de operações completa.</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong>Deteção de Regime:</strong> Classifica o mercado (ex: tendência, lateral) e ativa apenas os robôs especialistas adequados para o contexto.</li>
                                    <li><strong>Consenso Bayesiano:</strong> A confiança de cada robô é calibrada pelo seu desempenho histórico naquele regime específico.</li>
                                    <li><strong>Gestão de Risco com Critério de Kelly:</strong> O valor da aposta é calculado cientificamente com base na probabilidade de sucesso.</li>
                                    <li><strong>Evolução Genética Acelerada:</strong> Os piores robôs são substituídos por "mutações" dos robôs de elite.</li>
                                </ul>
                            </AccordionContent>
                        </AccordionItem>

                        <AccordionItem value="platform-2">
                            <AccordionTrigger>Deriv Multipliers: O Seguidor de Tendência</AccordionTrigger>
                            <AccordionContent className="text-sm space-y-2">
                               <p>Uma plataforma "padrão ouro" especializada em seguir tendências de forma disciplinada.</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong>Operar a Favor da Maré:</strong> Usa uma EMA de 100 períodos para identificar a tendência principal e só opera nessa direção.</li>
                                    <li><strong>Entrada em Pullback:</strong> Aguarda uma confirmação de retomada do momentum (usando o RSI) para entrar na operação.</li>
                                    <li><strong>Trailing Stop Dinâmico (Corrigido):</strong> A funcionalidade crucial que gere ativamente as posições abertas, subindo o stop-loss com base na volatilidade (ATR) para maximizar ganhos, agora está fully-functional.</li>
                                </ul>
                            </AccordionContent>
                        </AccordionItem>
                        
                        <AccordionItem value="platform-3">
                            <AccordionTrigger>Deriv Trader V1: A Fundação Cognitiva</AccordionTrigger>
                            <AccordionContent className="text-sm space-y-2">
                               <p>O nosso sistema de produção mais estável e a base de muitos dos nossos princípios quantitativos.</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong>Meritocracia por Desempenho:</strong> Os votos dos robôs são ponderados pelo seu `Sharpe Ratio`, dando mais poder aos mais consistentes.</li>
                                    <li><strong>Memória Estratégica:</strong> Aprende e guarda no Firestore o "perfil" de cada ativo (regime preferencial, limiar de consenso), permitindo colaboração Homem-Máquina.</li>
                                </ul>
                            </AccordionContent>
                        </AccordionItem>

                        <AccordionItem value="platform-4">
                            <AccordionTrigger>Deriv Accumulators: O Preditor Auto-Adaptativo</AccordionTrigger>
                            <AccordionContent className="text-sm space-y-2">
                               <p>Um sistema que aposta na estabilidade da volatilidade, em vez da direção do preço.</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong>Entrada Probabilística:</strong> Usa um modelo de "Primeira Passagem de Movimento Browniano" para calcular a probabilidade de a posição não quebrar a barreira.</li>
                                    <li><strong>Otimização Dinâmica:</strong> Calcula o `stake` (Critério de Kelly) e a `growth_rate` ótimos antes de cada trade.</li>
                                    <li><strong>Aprendizagem Contínua:</strong> Analisa o resultado de cada operação e auto-calibra os seus parâmetros de risco, tornando-se mais cauteloso após perdas.</li>
                                </ul>
                            </AccordionContent>
                        </AccordionItem>

                        <AccordionItem value="platform-5">
                            <AccordionTrigger>Deriv Digits: O Caçador de Probabilidades</AccordionTrigger>
                            <AccordionContent className="text-sm space-y-2">
                               <p>Focada em arbitragem estatística do último dígito do preço em Índices Sintéticos.</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong>Análise de Frequência:</strong> Analisa a distribuição dos últimos 1000 dígitos.</li>
                                    <li><strong>Regressão à Média:</strong> Opera "Difere" no dígito mais frequente e "Combina" no dígito menos frequente (mais "atrasado").</li>
                                    <li><strong>Contexto Visual (Melhorado):**</strong> Integra o gráfico de mercado para correlacionar a ação do preço com os padrões estatísticos.</li>
                                </ul>
                            </AccordionContent>
                        </AccordionItem>

                        <AccordionItem value="platform-6">
                            <AccordionTrigger>Análise de Volatilidade: O Laboratório Preditivo</AccordionTrigger>
                            <AccordionContent className="text-sm space-y-2">
                               <p>Um ambiente de análise quantitativa avançado que usa um comitê de especialistas de IA para prever movimentos de preço.</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong>Previsão Multi-Horizonte:</strong> Usa o modelo **Movimento Browniano Geométrico (GBM)** com volatilidade dinâmica (EWMA) para gerar projeções.</li>
                                    <li><strong>Meritocracia Preditiva:</strong> Usa um **Intervalo de Confiança Bayesiano** para avaliar a performance de cada especialista, dando peso apenas aos que demonstram habilidade estatística.</li>
                                    <li><strong>Meta-Aprendizagem (Epsilon-Greedy):**</strong> Foca o "orçamento computacional" nos especialistas de melhor desempenho, mas explora aleatoriamente outros para se adaptar a novas condições.</li>
                                </ul>
                            </AccordionContent>
                        </AccordionItem>

                         <AccordionItem value="platform-7">
                            <AccordionTrigger>Deriv Trader V3.0: O Laboratório de IA</AccordionTrigger>
                            <AccordionContent className="text-sm space-y-2">
                               <p>Um ambiente de testes isolado para experimentar com arquiteturas de IA radicais sem comprometer a estabilidade dos sistemas de produção.</p>
                                <ul className="list-disc pl-5 space-y-1">
                                    <li><strong>Deteção de Regime Hierárquica:</strong> Classifica o mercado em três níveis (Macro, Meso, Micro) para permitir decisões mais contextuais.</li>
                                </ul>
                            </AccordionContent>
                        </AccordionItem>
                    </Accordion>
                </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-9">
              <AccordionTrigger className="text-lg font-semibold">
                Teste de Estratégias (Backtesting)
              </AccordionTrigger>
              <AccordionContent className="text-base leading-relaxed space-y-2">
                <p>A página de <strong>Backtesting</strong> permite que você use a IA para simular estratégias de investimento antes de arriscar capital real.</p>
                <ul className="list-disc pl-6 space-y-2">
                    <li><strong>Descreva sua Estratégia:</strong> Você pode descrever uma estratégia em linguagem natural (ex: "Comprar PETR4 se a média móvel de 10 dias cruzar acima da de 30 dias"). A IA irá interpretar, buscar os dados históricos e simular o resultado.</li>
                    <li><strong>Analisar Robô MQL5:</strong> Se você já tem um robô de negociação (Expert Advisor) para a plataforma MetaTrader 5, pode colar o código-fonte (MQL5). A IA irá analisar o código, extrair a lógica da estratégia e preencher a descrição para que você possa simulá-la.</li>
                </ul>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-7">
              <AccordionTrigger className="text-lg font-semibold">
                Configurações
              </AccordionTrigger>
              <AccordionContent className="text-base leading-relaxed space-y-2">
                <p>Na página de <strong>Configurações</strong>, você pode personalizar sua experiência:</p>
                 <ul className="list-disc pl-6 space-y-1">
                  <li><strong>Conexão com Corretora:</strong> Insira seu token de API para habilitar funcionalidades de trading.</li>
                  <li><strong>Notificações:</strong> Gerencie suas preferências e envie um email de teste (registrado no console).</li>
                  <li><strong>Aparência:</strong> Altere o tema de cores e a fonte do aplicativo.</li>
                </ul>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-8">
              <AccordionTrigger className="text-lg font-semibold">
                Configuração da Chave de API (Importante!)
              </AccordionTrigger>
              <AccordionContent className="text-base leading-relaxed space-y-2">
                <p>Para que os recursos de Inteligência Artificial do Claritas Copilot funcionem (como o Chat e a análise de texto), é crucial configurar sua chave de API do Google AI.</p>
                <p>Siga estes passos:</p>
                <ol className="list-decimal pl-6 space-y-1">
                  <li>Obtenha uma chave de API no <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google AI Studio</a>.</li>
                  <li>No seu projeto, localize o arquivo chamado \`.env\`.</li>
                  <li>Dentro deste arquivo, adicione a seguinte linha, substituindo \`"SUA_CHAVE_DE_API"\` pela chave que você copiou: <br/>\`GEMINI_API_KEY="SUA_CHAVE_DE_API"\`</li>
                  <li>Salve o arquivo e reinicie o aplicativo para que as alterações tenham efeito.</li>
                </ol>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-14">
              <AccordionTrigger className="text-lg font-semibold">
                Histórico de Versões (Changelog)
              </AccordionTrigger>
              <AccordionContent>
                 <ChangelogContent />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
