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

### v2.0.0 (Atual) - O Cérebro Quantitativo: Arquitetura Adaptativa e Gestão de Risco Científica

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
        .replace(/#### (.*)/g, '<h4 class="text-lg font-semibold mt-3 mb-1">$1</h4>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code class="bg-muted text-muted-foreground px-1 py-0.5 rounded text-sm font-mono">$1</code>')
        .replace(/---/g, '<hr class="my-4 border-border" />')
        .replace(/^- (.*)/gm, '<li class="ml-4 list-disc">$1</li>');

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
                <p>Use a ferramenta de <strong>Projeção de IA</strong> em cada meta para simular cenários e descobrir quanto tempo levará para atingir cada objetivo com base em suas contribuições e no retorno esperado dos seus investimentos.</p>
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

            <AccordionItem value="item-15">
                <AccordionTrigger className="text-lg font-semibold">O Cérebro V2.0: Como Funciona o Deriv Trader 2.0</AccordionTrigger>
                <AccordionContent className="text-base leading-relaxed space-y-4">
                    <p>O Deriv Trader 2.0 representa uma evolução fundamental, saindo de um sistema de "consenso simples" para um verdadeiro <strong>"Cérebro Quantitativo"</strong>, que opera de forma semelhante a uma mesa de operações de um fundo de investimento de alta frequência.</p>
                    
                    <h3 className="text-md font-bold mt-3">1. Contexto é Rei: A Arquitetura "Regime-Aware"</h3>
                    <p>A cada momento, um modelo inspirado em <strong>Hidden Markov Models (HMM)</strong> classifica o mercado num de cinco "regimes" (\`TREND_UP\`, \`RANGING\`, etc.). O sistema sabe que usar um robô oscilador (como o RSI) numa tendência forte é desastroso. Portanto, o Cérebro V2.0 <strong>ativa apenas os robôs especialistas que são adequados para o regime atual</strong>, silenciando os outros.</p>

                    <h3 className="text-md font-bold mt-3">2. Consenso Bayesiano: A Sabedoria Ponderada</h3>
                    <p>Em vez de uma simples contagem de votos, o sistema usa <strong>Inferência Bayesiana</strong>. Quando um robô vota, o sistema combina a confiança do sinal atual com a <strong>taxa de acerto histórica daquele robô, naquele regime específico</strong>. O resultado é uma Probabilidade de Consenso Bayesiano muito mais precisa e ajustada à realidade.</p>

                    <h3 className="text-md font-bold mt-3">3. Gestão de Risco Científica: O Critério de Kelly</h3>
                    <p>O valor da aposta (\`stake\`) é calculado cientificamente usando o <strong>Critério de Kelly Fracionado</strong>. Se a Probabilidade Bayesiana de sucesso é alta, o sistema aposta de forma mais agressiva. Se a vantagem é pequena, ele aposta o mínimo para proteger o capital. O risco é ajustado dinamicamente a cada segundo.</p>

                    <h3 className="text-md font-bold mt-3">4. Veto de Microestrutura: O "Guarda-Costas" Final</h3>
                    <p>Mesmo com um consenso forte, uma camada final de proteção analisa os últimos 10-20 ticks. Se detetar uma pressão de mercado súbita e contrária (ex: um pico de volume de venda), o "guarda-costas" <strong>vetará a operação</strong>, prevenindo entradas em movimentos anormais ou "flash crashes".</p>
                </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-16">
                <AccordionTrigger className="text-lg font-semibold">Conheça a Mesa: A Estratégia de Cada Robô</AccordionTrigger>
                <AccordionContent className="text-base leading-relaxed space-y-4">
                    <p>A nossa "Mesa Operacional" é um ecossistema de especialistas, cada um com uma visão única do mercado, agrupados em "comités".</p>

                    <h3 className="text-md font-bold mt-3">1. Comité de Momentum: Os "Velocistas"</h3>
                    <p>Obcecados com a velocidade e aceleração do preço. São os primeiros a detetar quando o mercado ganha ou perde força.</p>
                    <ul className="list-disc pl-6 space-y-2 text-sm">
                        <li><strong>RSI & STOCHASTIC:</strong> Especialistas em reversão à média. Apostam contra a tendência de curtíssimo prazo quando o mercado está "esticado" (sobrecomprado ou sobrevendido).</li>
                        <li><strong>MACD:</strong> Um confirmador de momentum. Vota apenas *depois* de um cruzamento, validando a força da nova direção.</li>
                        <li><strong>Awesome Oscillator, TRIX, ROC, RVI:</strong> Detetam a aceleração e a "convicção" por trás de um movimento, confirmando que a tendência tem força para continuar.</li>
                    </ul>

                    <h3 className="text-md font-bold mt-3">2. Comité de Tendência: Os "Navegadores"</h3>
                    <p>Focam-se na direção principal e sustentada do mercado.</p>
                    <ul className="list-disc pl-6 space-y-2 text-sm">
                        <li><strong>Moving Average Cross:</strong> Estratégia clássica que sinaliza uma mudança de tendência quando a média móvel curta cruza a longa.</li>
                        <li><strong>ADX:</strong> O "rei" da força da tendência. Atua como um filtro, impedindo operações em mercados laterais e sem direção.</li>
                        <li><strong>Parabolic SAR:</strong> Um seguidor de tendência agressivo, que mantém o voto na direção do movimento até que uma reversão seja sinalizada.</li>
                    </ul>

                    <h3 className="text-md font-bold mt-3">3. Comité de Volatilidade e Estrutura: Os "Arquitetos"</h3>
                    <p>Analisam a "arquitetura" do mercado, como a sua largura e canais.</p>
                    <ul className="list-disc pl-6 space-y-2 text-sm">
                        <li><strong>Bollinger Bands:</strong> Especialista em reversão à média, votando quando o preço toca as bandas externas.</li>
                        <li><strong>Ichimoku Cloud:</strong> Um "estratega geopolítico" que fornece uma visão completa de suporte, resistência e equilíbrio do mercado.</li>
                        <li><strong>KAMA & Donchian Channels:</strong> Identificam rompimentos (breakouts) e adaptam-se à volatilidade do mercado.</li>
                    </ul>

                    <h3 className="text-md font-bold mt-3">4. Comité de Volume e Fluxo de Ordens: Os "Detetives"</h3>
                    <p>Analisam o combustível por trás do movimento: o volume.</p>
                    <ul className="list-disc pl-6 space-y-2 text-sm">
                        <li><strong>VWAP:</strong> Usa o preço médio ponderado pelo volume como referência de "preço justo". Preço acima do VWAP é um sinal de alta.</li>
                        <li><strong>MFI & OBV:</strong> Medem se o "dinheiro inteligente" está a entrar ou a sair de um ativo, confirmando tendências com base no fluxo de volume.</li>
                    </ul>

                     <h3 className="text-md font-bold mt-3">5. Comité Estatístico e de Padrões: Os "Académicos"</h3>
                    <p>Usam modelos matemáticos e reconhecimento de padrões.</p>
                    <ul className="list-disc pl-6 space-y-2 text-sm">
                        <li><strong>Z-SCORE:</strong> Deteta desvios estatísticos extremos, apostando num regresso à média.</li>
                        <li><strong>STOCHASTIC RSI:</strong> Um "sismógrafo" ultra-sensível para micro-sinais em mercados muito rápidos.</li>
                        <li><strong>PRICE ACTION PATTERN:</strong> Reconhece padrões de velas, como o "Martelo" (Hammer), que são fortes sinais de reversão.</li>
                    </ul>
                </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-10">
              <AccordionTrigger className="text-lg font-semibold">
                Deriv Trader: A Interface de Trading
              </AccordionTrigger>
              <AccordionContent className="text-base leading-relaxed space-y-2">
                 <p>A página <strong>Deriv Trader</strong> é um ambiente de negociação integrado que transforma o Claritas num copiloto financeiro avançado, operando com uma arquitetura de alta performance.</p>
                 <ol className="list-decimal pl-6 space-y-3">
                    <li>
                      <strong>Motor de Indicadores Centralizado:</strong> O coração do nosso sistema de trading é um motor que calcula, em tempo real, um conjunto completo de <strong>22 categorias de indicadores técnicos</strong> (RSI, Estocástico, MACD, etc.). Este motor alimenta tanto o gráfico que você vê quanto a lógica de decisão do Conselho de Robôs, garantindo consistência total dos dados.
                    </li>
                    <li>
                      <strong>Gráfico de Trading Avançado (SVG):</strong>
                      <ul className="list-disc pl-6 mt-2 space-y-2">
                          <li><strong>Estabilidade e Responsividade:</strong> O gráfico é renderizado com tecnologia SVG, eliminando problemas de "quebra" de velas. É 100% estável e responsivo.</li>
                          <li><strong>Indicadores Controláveis:</strong> Através do botão "Indicadores", você pode ligar ou desligar individualmente a Média Móvel Simples (SMA), Exponencial (EMA), VWAP e as Bandas de Bollinger.</li>
                          <li><strong>Ferramentas de Análise:</strong> Use o "brush" na base para dar zoom e o "crosshair" para uma leitura precisa de preços e tempo.</li>
                      </ul>
                    </li>
                    <li>
                      <strong>Análise de Sessão com IA:</strong>
                      <ul className="list-disc pl-6 mt-2">
                          <li>Ao clicar em <strong>"Analisar Desempenho"</strong>, uma IA avalia o seu histórico de operações da sessão e fornece um resumo da sua performance com métricas chave.</li>
                      </ul>
                    </li>
                 </ol>
              </AccordionContent>
            </AccordionItem>

             <AccordionItem value="item-11">
                <AccordionTrigger className="text-lg font-semibold">
                    A Mesa Operacional: O Cérebro do Claritas Trader
                </AccordionTrigger>
                <AccordionContent className="text-base leading-relaxed space-y-4">
                    <p>
                        A "Mesa Operacional" é o sistema autónomo do Claritas. Em vez de depender de uma única estratégia, ela simula uma equipa de 22 robôs-analistas para tomar decisões de trading mais seguras e inteligentes, com base no poderoso motor de indicadores interno.
                    </p>
                    <div>
                        <h4 className="font-semibold text-md mb-2">Camada 1: Os 22 Analistas Táticos (A Equipa)</h4>
                        <p className="text-sm">
                           São os especialistas da linha da frente. Cada um domina uma estratégia de indicador (RSI, MACD, etc.), definida no ficheiro \`src/services/council-strategies.ts\`. A cada tick, eles analisam os dados do motor de indicadores e emitem um "voto" (\`RISE\`, \`FALL\`, \`HOLD\`) com um nível de confiança.
                        </p>
                    </div>
                    <div>
                        <h4 className="font-semibold text-md mb-2">Camada 2: O Comité de Supervisão e Risco (A Direção)</h4>
                        <p className="text-sm">
                          Esta é a camada final e mais poderosa. Este comité recebe a recomendação do consenso, mas tem **poder de veto e de ajuste dinâmico**. Ele responde a perguntas cruciais:
                        </p>
                         <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
                            <li>"Já atingimos o nosso limite de perda ou a nossa meta de lucro do dia?" (se sim, **VETO** e para as operações).</li>
                            <li>"O mercado está demasiado caótico ou volátil?" (Com base no ADX e BBW, ele **reduz o valor da aposta (\`stake\`)** e **aumenta a duração do contrato** para se proteger).</li>
                            <li>"O consenso dos analistas é forte o suficiente para esta condição de mercado?" (se não, aguarda).</li>
                        </ul>
                        <p className="text-sm mt-2">É a direção de risco que dá a aprovação final e ajusta os parâmetros de cada trade de forma autónoma, usando os valores de "Aposta Base" e "Duração Base" como ponto de partida.</p>
                    </div>
                </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="item-13">
              <AccordionTrigger className="text-lg font-semibold">
                A Arena Virtual e o Laboratório de Evolução
              </AccordionTrigger>
              <AccordionContent className="text-base leading-relaxed space-y-4">
                <p>Para elevar a inteligência do sistema, implementámos uma "Arena Virtual" e um "Laboratório de Evolução".</p>
                <div>
                    <h4 className="font-semibold text-md mb-2">Arena Virtual: Meritocracia em Tempo Real</h4>
                    <p className="text-sm">
                      O painel <strong>Arena Virtual</strong> funciona como um *leaderboard* da sua equipa de robôs. Quando o modo <strong>Meritocracia</strong> está ativo, os robôs com melhor desempenho ganham mais peso na votação, tornando o sistema auto-otimizável.
                    </p>
                </div>
                 <div>
                    <h4 className="font-semibold text-md mb-2">Laboratório de Evolução Genética</h4>
                    <p className="text-sm">
                      Este é o próximo nível. A cada 50 trades virtuais, o sistema identifica os robôs de pior desempenho e os **substitui por mutações genéticas dos robôs de elite**. Isto garante que o sistema não só promove os melhores, mas também se adapta e melhora autonomamente ao longo do tempo. Pode acompanhar este processo na aba <strong>Evolução</strong>.
                    </p>
                </div>
                 <div>
                    <h4 className="font-semibold text-md mb-2">Hall da Fama</h4>
                    <p className="text-sm">
                      Os robôs que atingem um desempenho excecional são promovidos para o <strong>Hall da Fama</strong>, uma aba dedicada no Deriv Trader que mostra um registo persistente dos seus analistas de IA mais lendários, com dados carregados diretamente do Firebase.
                    </p>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="item-12">
                <AccordionTrigger className="text-lg font-semibold">
                    Ficheiros da Mesa Operacional
                </AccordionTrigger>
                <AccordionContent className="text-base leading-relaxed space-y-4">
                  <p>A "Mesa Operacional" é um sistema composto por vários ficheiros chave que trabalham em conjunto. Aqui está um resumo das suas responsabilidades:</p>
                  <ul className="list-disc pl-6 space-y-3">
                    <li>
                      <strong className="font-mono">src/hooks/use-deriv-api.tsx</strong><br/>
                      A camada de comunicação. Estabelece a conexão WebSocket com a corretora, recebe os dados de mercado (\`chartData\`) e envia as ordens de negociação (\`executeTrade\`). É os "ouvidos" e as "mãos" do sistema.
                    </li>
                    <li>
                      <strong className="font-mono">src/hooks/use-robot-council.ts</strong><br/>
                      O cérebro da operação. Contém o motor de cálculo de todos os indicadores técnicos, a lógica de votação dos robôs, a formação do conselho e o "Comité de Supervisão" para gestão de risco final.
                    </li>
                    <li>
                      <strong className="font-mono">src/services/council-strategies.ts</strong><br/>
                      O Manual de Estratégias. Este ficheiro define localmente as regras, parâmetros e justificações para cada um dos 22 robôs analistas, tornando o processo mais rápido e fiável.
                    </li>
                     <li>
                      <strong className="font-mono">src/services/financial-data-service.ts</strong><br/>
                      O serviço de persistência. Contém as funções para guardar e carregar o desempenho dos robôs no banco de dados Firebase Firestore, garantindo que o progresso da Arena e do Hall da Fama não se perca.
                    </li>
                     <li>
                      <strong className="font-mono">src/hooks/use-strategy-evolution.ts</strong><br/>
                      O Laboratório de Evolução. Este novo hook contém a lógica para substituir os robôs de baixo desempenho por mutações dos robôs de elite, garantindo a adaptação do sistema.
                    </li>
                    <li>
                      <strong className="font-mono">src/app/deriv-trader/page.tsx</strong><br/>
                      A interface e o orquestrador. Esta página integra todos os hooks e componentes visuais, como o gráfico e o painel da Arena Virtual, permitindo a interação do utilizador com o sistema.
                    </li>
                  </ul>
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
