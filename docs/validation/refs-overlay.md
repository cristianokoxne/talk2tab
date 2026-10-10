# Overlay de refs do scanner

O mapa lateral já expunha refs reais, inclusive refs de contêineres de rolagem, mas o overlay de depuração desenhava apenas elementos interativos. Em páginas sem controles visíveis, o toggle podia ficar ligado sem renderizar marcador algum.

O overlay agora desenha elementos interativos e contêineres roláveis com estilos distintos, é redesenhado após cada varredura e pode ser ativado antes da primeira observação. O teste E2E confirma refs de controle e scroll, atualização após inserção de um novo controle e remoção ao desligar o toggle.

Validação: `npm test` (135 aprovados), `npm run typecheck`, `npm run lint`, build, `git diff --check` e 24 testes focados de overlay/E2E aprovados.
