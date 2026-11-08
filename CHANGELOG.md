# Claritas Copilot - Registo de Alterações

Este documento regista a jornada de desenvolvimento e as principais funcionalidades implementadas no Claritas Copilot.

---

### v6.0.0 - Protocolo Supreme (Mesa Quantitativa Institucional)

**Marcos do Crypto Lab V4.2:**
- **Motor Lead-Lag V6**: Implementação final da arbitragem temporal BTC → ETH, validada por testes de permutação e bootstrap em blocos.
- **Alpha Decay Guard**: Trava de segurança que aborta execuções se a latência fim-a-fim (Sinal → Ordem) superar 4 segundos.
- **HWM (High Water Mark)**: Sistema de proteção de lucro diário com piso adaptativo; trava 50% dos ganhos ao atingir 80% da meta.
- **Interlock de Calibração**: O piloto `DEMO_LIVE` agora exige uma calibração estatística válida (14 dias) salva no Firestore via `CalibrationService`.
- **Cálculo de EV Real**: Integração do Valor Esperado (Expected Value) no veredito do Chairman, combinando confiança da IA com win-rate empírica.
- **Parallel Shadow Trading**: Execução síncrona de ordens Demo e Sombra para auditoria de slippage e latência do gateway.

**Melhorias Arquiteturais:**
- **Estabilização Supreme**: Separação estrita entre a camada de visualização (V4 Dashboard) e o hook de orquestração quantitativa.
- **Persistent Learning**: O sistema agora aprende com falhas passadas através de injeção de contexto "Post-Mortem" em tempo real no prompt da IA.

---

### v5.5.0 - Robustez Arquitetural e Documentação Definitiva

**Melhorias Estratégicas e Arquiteturais:**
- **Portal de Arquitetura Centralizado:** O `README.md` principal foi transformado num guia completo, detalhando a filosofia de design e os ficheiros-chave para cada uma das nossas 7 plataformas de trading.
- **Profissionalização da Plataforma "Deriv Digits":** Integração do gráfico avançado e refatoração do hook de API para maior resiliência.
- **Ativação do "Trailing Stop" nos Multiplicadores:** Lógica de proteção de lucro movida para o hook de estratégia, permitindo o arraste dinâmico do Stop Loss via ATR.

---

### v5.1.0 - Otimização e Foco: Descontinuação da Central de Comando

**Mudanças Estratégicas:**
- **Foco na "Análise de Volatilidade":** Consolidação da lógica preditiva na página de análise estocástica, concentrando recursos computacionais no modelo GBM.
