# Project Progress

## Current Status

Última atualização: 2026-09-29 America/Sao_Paulo

Etapa atual: Milestone 3 — Executor de ações

Status: COMPLETED

---

## Milestones

### Milestone 1 — Bootstrap da extensão

Status: COMPLETED

Started: 2026-09-15 22:25:37 America/Sao_Paulo

Finished: 2026-09-16 18:40:07 America/Sao_Paulo

Objetivo:
- Entregar manifest MV3, service worker, Side Panel, content script e mensageria tipada para solicitar e receber o título da página ativa.

Estado validado antes da implementação:
- O repositório já tinha entradas TypeScript e arquivos públicos, mas os módulos importados pelo worker e content script não existiam.
- `node_modules` não está instalado, portanto typecheck, lint, testes e build ainda não puderam iniciar.

Implementado:
- Manifest MV3 com Side Panel e contextos de service worker e content script.
- Ação da extensão abre o Side Panel.
- Mensagem `SCAN_PAGE` validada entre Side Panel, worker e content script; o painel exibe título e URL da aba ativa.
- Build TypeScript para `dist/`, cópia dos assets públicos e teste estrutural de bootstrap.

Arquivos principais:
- `src/agent/backgroundEntry.ts`
- `src/agent/orchestrator.ts`
- `src/agent/contentScriptEntry.ts`
- `src/agent/sidepanel.ts`
- `public/manifest.json`

Testes executados:
- `npm run typecheck` — PASS.
- `npm run lint` — PASS.
- `npm test` — PASS (1 teste).
- `npm run build` — PASS.

Não concluído:
- Nada pendente nesta milestone.

Limitações:
- `npm install` reporta 5 vulnerabilidades transitivas (2 moderadas, 1 alta e 2 críticas); não foram aplicadas correções potencialmente disruptivas nesta milestone.

Próxima ação:
- Iniciar a Milestone 2 em uma nova execução.

Smoke test manual:
- PASS em 2026-09-16: extensão carregada unpacked a partir de `dist/` no Chrome; o Side Panel exibiu “Página conectada”, título “YouTube” e `https://www.youtube.com/`.

---

### Milestone 2 — Scanner de página e refs

Status: COMPLETED

Started: 2026-09-16 18:41:15 America/Sao_Paulo

Finished: 2026-09-18 22:02:45 America/Sao_Paulo

Objetivo:
- Produzir um `PageState` semântico e sanitizado, com elementos interativos visíveis identificados por refs efêmeras.

Incrementos concluídos:
- 2026-09-16 18:41:15 America/Sao_Paulo — contratos de Page State e Element Registry por geração.
- 2026-09-16 18:46:09 America/Sao_Paulo — scanner semântico, nomes acessíveis, visibilidade, mascaramento de elementos sensíveis e bundle do content script.
- 2026-09-16 18:46:47 America/Sao_Paulo — Side Panel passa a listar controles visíveis com refs.
- 2026-09-16 18:48:25 America/Sao_Paulo — overlay de depuração opcional destaca os elementos e suas refs na página.
- 2026-09-16 18:52:29 America/Sao_Paulo — controle do overlay reposicionado antes da lista para uso em páginas longas.

Validação final:
- PASS em 2026-09-18 — em páginas reais do YouTube e ChatGPT, o painel listou elementos interativos com refs; o usuário confirmou o overlay de destaque.

Testes finais:
- `npm run typecheck` — PASS.
- `npm run lint` — PASS.
- `npm test` — PASS (3 testes).
- `npm run build` — PASS.

Próxima ação:
- Iniciar a Milestone 3 em uma nova execução.

### Milestone 3 — Executor de ações

Status: COMPLETED

Started: 2026-09-18 22:10:00 America/Sao_Paulo

Finished: 2026-09-18 22:23:59 America/Sao_Paulo

Objetivo:
- Executar ações DOM somente por refs efêmeras validadas, começando pelo clique seguro.

Incrementos concluídos:
- 2026-09-18 22:05:43 America/Sao_Paulo — DSL inicial e executor seguro de clique por ref.
- 2026-09-18 22:08:18 America/Sao_Paulo — executor `type` com eventos nativos, contenteditable e bloqueio de campos sensíveis.
- 2026-09-18 22:12:00 America/Sao_Paulo — executor `select` por valor ou rótulo visível.
- 2026-09-18 22:15:00 America/Sao_Paulo — executor `scroll` com viewport/pixels e limite de segurança.
- 2026-09-18 22:20:00 America/Sao_Paulo — executor `keypress` com whitelist de teclas.
- 2026-09-18 22:25:00 America/Sao_Paulo — painel de teste manual para `click` e `type` por ref.

Validação final:
- PASS — o usuário confirmou o funcionamento do painel de ações no Chrome.
- `npm run typecheck`, `npm run lint`, `npm test` (8 testes) e `npm run build` passaram.

Próxima ação:
- Iniciar a Milestone 4 em uma nova execução.

### Milestone 4 — Provider Jev (System One)

Status: IN_PROGRESS

Implementado nesta etapa:
- Adaptador HTTP nativo para o endpoint System One do Jev, sem OpenAI e sem OpenRouter.
- Mapa fechado de comandos para `click`, `type`, `select`, `scroll` e `finish`.
- Validação da escolha retornada pelo Jev contra as opções geradas localmente.
- Probabilidades e confiança preservadas para futuras decisões de segurança.
- Onboarding obrigatório no Side Panel para inserir e salvar a API key do Jev.
- Storage local restrito a contextos confiáveis da extensão; a chave não é enviada ao content script.
- Testes do mapa e do provider; suíte completa com 10 testes passando.

Pendente:
- Implementar o loop multi-etapas de observar → decidir → executar → verificar (Milestone 5).
- Definir como o texto da ação `type` será fornecido pelo comando/transcrição do usuário.

### Milestone 5 — Agent loop

Status: IN_PROGRESS

Implementado nesta etapa:
- Loop `observe → decide → execute → observe` integrado ao orquestrador.
- Uma ação por decisão do Jev.
- Encerramento por `finish`, falha de execução ou limite máximo de 8 passos.
- Cancelamento explícito por sessão, com `AbortController` e botão no Side Panel.
- Verificação pós-ação determinística de navegação, fingerprint, viewport e resultado do executor.
- Detecção de estagnação após ações repetidas sem progresso.
- Ações `type` só são mapeadas quando há texto explícito no objetivo; `select` usa opções reais da página.
- Histórico resumido das decisões e resultados retornado ao Side Panel.
- Testes de conclusão, cancelamento e limite de segurança; suíte completa com 13 testes passando.

Pendente:
- Verificação semântica orientada ao objetivo, além das mudanças observáveis da página.

### Milestone 6 — Safety

Status: IN_PROGRESS

Implementado nesta etapa:
- Confirmação no Side Panel antes de controles de envio, publicação, compra, pagamento, exclusão, transferência, reserva, assinatura, salvamento, atualização, Enter fora de pesquisa e fechamento de aba.
- A confirmação expira em 60 segundos; recusa, expiração ou cancelamento bloqueiam a ação.

Pendente:
- Ampliar a classificação de risco para sites e controles sem rótulos previsíveis; cobrir mais ações externas e críticas.
- Avaliar e documentar as regras de confirmação com tarefas reais antes de liberar automação contínua.

### Milestone 7 — Voice

Status: IN_PROGRESS

Implementado nesta etapa:
- Migração do Whisper para a Web Speech API do Chrome, com idioma `pt-BR` e reconhecimento contínuo.
- Resultados parciais são exibidos no objetivo; somente segmentos finais alimentam o buffer de comandos.
- Buffer avaliado a cada 3 s, enviado após 1,2 s de pausa ou 5 s de espera, com mínimo de 4 caracteres alfanuméricos e uma palavra de ao menos 4 letras.
- Comandos automáticos enviados ao Jev em fila serial; encerrar a escuta descarrega o último comando válido sem duplicar segmentos anteriores.
- O botão do microfone funciona como toggle; ao iniciar, toca um sinal sonoro e mostra “Ouvindo”, e um segundo clique encerra a captura.
- Confirmação explícita antes de cliques com rótulos de alto impacto, Enter fora de objetivos de pesquisa e fechamento de abas; expiração após 60 s cancela a ação.
- Tratamento de indisponibilidade da API, permissão negada, microfone ausente, falta de fala e falha de rede.
- Remoção do modelo Transformers.js, dos arquivos WASM e das permissões de rede usadas para baixar o Whisper.
- Reconhecimento executado a partir do Side Panel, sem injeção no contexto da página ativa.
- Interface informa que o Chrome pode processar o áudio on-line; a API usa o microfone configurado no Chrome.

Pendente:
- Teste manual no Chrome para validar permissão, escolha efetiva do microfone, idioma, encerramento, fila de voz e confirmação de ações sensíveis.
- Medir latência e comparar resultados em frases representativas de uso real.

### Milestone 8 — Testes e benchmark

Status: NOT_STARTED

### Milestone 9 — Polish e documentação final

Status: NOT_STARTED
