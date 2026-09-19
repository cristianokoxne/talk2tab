# Project Progress

## Current Status

Última atualização: 2026-09-18 22:10:00 America/Sao_Paulo

Etapa atual: Milestone 3 — Executor de ações

Status: IN_PROGRESS

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
- 2026-09-18 22:08:18 America/Sao_Paulo — executor `type` com eventos nativos, contenteditable e bloqueio de campos sensíveis.
- 2026-09-18 22:05:43 America/Sao_Paulo — DSL inicial de ações e executor seguro de clique por ref.
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

Status: IN_PROGRESS

Started: 2026-09-18 22:10:00 America/Sao_Paulo

Objetivo:
- Executar ações DOM somente por refs efêmeras validadas, começando pelo clique seguro.

### Milestone 4 — Provider OpenAI-compatible

Status: NOT_STARTED

### Milestone 5 — Agent loop

Status: NOT_STARTED

### Milestone 6 — Safety

Status: NOT_STARTED

### Milestone 7 — Voice

Status: NOT_STARTED

### Milestone 8 — Testes e benchmark

Status: NOT_STARTED

### Milestone 9 — Polish e documentação final

Status: NOT_STARTED
