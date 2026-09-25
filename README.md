# Voice Browser Agent

> Controle o navegador por linguagem natural e voz — com execução tipada, observável e local-first.

O Voice Browser Agent é uma extensão para Chrome/Chromium que transforma uma intenção como:

> “Encontre meus pedidos e abra o primeiro resultado.”

em um fluxo de observação da página, planejamento de ações e execução no navegador.

A ideia central é separar claramente o que a IA decide do que a extensão pode executar. O modelo não envia JavaScript para o navegador: ele escolhe ações de um conjunto fechado, como `click`, `type`, `select`, `scroll` e `keypress`. A extensão valida a ação, resolve uma referência efêmera do elemento e executa o comando no contexto correto.

## Por que este projeto existe?

Interfaces web estão cada vez mais poderosas, mas ainda exigem que as pessoas encontrem visualmente cada botão, campo e menu. O objetivo deste projeto é explorar uma interface mais natural para tarefas rotineiras:

- falar ou digitar uma intenção;
- deixar o agente entender a estrutura semântica da página;
- executar ações pequenas e verificáveis;
- informar quando a página não pode ser controlada;
- manter o usuário no controle de ações sensíveis.

O projeto segue uma visão local-first: não existe um backend próprio obrigatório, as configurações ficam no navegador e o usuário escolhe o provider de IA. Nesta etapa, o adapter disponível é o Jev/System One.

## Estado atual

Este repositório está em desenvolvimento ativo e ainda não é uma extensão pronta para publicação na Chrome Web Store.

Já funciona:

- extensão Manifest V3 com Chrome Side Panel;
- leitura semântica da página e listagem de elementos interativos;
- refs efêmeras para evitar que o modelo injete seletores arbitrários;
- execução de `click`, `type`, `select`, `scroll` e teclas permitidas;
- loop de agente `observe → decide → execute → observe`;
- limite de passos, cancelamento e detecção de estagnação;
- integração com o provider Jev/System One;
- transcrição de voz local com Transformers.js/Whisper Tiny multilíngue;
- painel de depuração para testar ações manualmente.

Ainda está no roadmap:

- política de risco completa com confirmação explícita para ações externas e críticas;
- verificação semântica orientada ao objetivo;
- mover a inferência de voz para um Web Worker;
- testes E2E e benchmark de tarefas;
- suporte a mais providers, como endpoints OpenAI-compatible, Ollama e LM Studio;
- onboarding, acessibilidade e preparação para distribuição pública.

Consulte [`PROJECT_PROGRESS.md`](PROJECT_PROGRESS.md) para o acompanhamento detalhado das milestones.

## Arquitetura

```text
Chrome / Chromium
├── Side Panel
│   ├── objetivo em texto
│   ├── gravação e transcrição de voz
│   ├── status do agente
│   └── configurações do provider
├── Service Worker
│   ├── orquestração do agente
│   ├── comunicação com o Jev
│   └── operações de abas
└── Content Script
    ├── scanner semântico
    ├── Element Registry
    ├── executores DOM
    └── overlay de depuração
```

O scanner envia ao agente uma representação compacta da página, e não o `outerHTML` inteiro. Cada observação cria refs como `el_12_3`; elas são temporárias e só podem ser resolvidas pelo registry interno da extensão.

## Segurança e limites

Segurança é parte do design, não apenas uma etapa posterior. O projeto não deve:

- executar `eval`, `new Function` ou JavaScript produzido pelo modelo;
- aceitar seletores CSS arbitrários vindos do modelo;
- enviar senhas ou secrets no estado da página;
- afirmar sucesso sem verificar o resultado;
- ignorar cancelamento, limites ou confirmação do usuário;
- tentar contornar CAPTCHA, autenticação ou políticas do navegador.

Como toda extensão, existem páginas que não podem ser controladas normalmente, incluindo `chrome://`, Chrome Web Store em determinados contextos, prompts nativos, CAPTCHA, passkeys e alguns iframes ou shadow roots fechados. Quando isso acontecer, o agente deve reportar a limitação em vez de inventar que concluiu a tarefa.

> Atenção: este é um projeto experimental. Não use a extensão em tarefas financeiras, exclusões, alterações de senha ou qualquer ação irreversível sem revisar cuidadosamente o comportamento atual.

## Requisitos

- Node.js 18 ou superior;
- npm;
- Google Chrome ou outro navegador Chromium;
- uma chave do Jev/System One para usar o agente;
- microfone, caso queira testar o fluxo de voz.

## Instalação e execução local

```bash
git clone https://github.com/cristianokoxne/talk2tab.git
cd talk2tab
npm install
npm run build
```

Depois:

1. abra `chrome://extensions`;
2. ative o **Modo do desenvolvedor**;
3. clique em **Carregar sem compactação**;
4. selecione a pasta `dist/`;
5. abra o Side Panel da extensão;
6. informe a chave do Jev nas configurações;
7. digite uma intenção ou use o botão de voz.

As configurações do provider são salvas no storage local da extensão. Nunca publique chaves de API no repositório. Se você usar um arquivo `.env` localmente, mantenha-o fora do commit.

## Comandos úteis

```bash
npm run build       # compila TypeScript e prepara dist/
npm run typecheck   # verifica tipos sem gerar arquivos
npm run lint        # executa o ESLint
npm test            # build + testes automatizados
npm run test:watch  # testes em modo watch
```

## Como contribuir

Contribuições são bem-vindas, especialmente em áreas que tornam o agente mais seguro, previsível e fácil de testar.

Boas primeiras contribuições:

- adicionar testes para páginas dinâmicas, modais, iframes ou contenteditable;
- melhorar mensagens de erro e estados do Side Panel;
- implementar a política de risco e cartões de confirmação;
- adicionar um provider compatível com a interface existente;
- tornar a transcrição mais responsiva com Web Worker;
- documentar casos em que o navegador bloqueia a automação;
- criar fixtures e tarefas para o benchmark.

Antes de abrir um PR:

```bash
npm run typecheck
npm run lint
npm test
```

Ao alterar permissões, contratos de mensagens, executores ou providers, explique no PR o motivo, os riscos e como a mudança foi validada. PRs não devem adicionar código remoto, execução arbitrária de JavaScript, logging de secrets ou permissões sem justificativa.

## Roadmap resumido

- [x] Bootstrap da extensão e Side Panel
- [x] Scanner semântico e refs efêmeras
- [x] Executores DOM básicos
- [x] Provider Jev/System One
- [x] Loop inicial do agente
- [x] Entrada de voz experimental
- [ ] Safety e confirmação de ações críticas
- [ ] Testes E2E e benchmark
- [ ] Mais providers
- [ ] Publicação e documentação de uso

## Licença

Este projeto é distribuído sob a licença [MIT](LICENSE).

## Ajude a construir

Se a ideia fizer sentido para você, abra uma issue descrevendo um caso de uso, reporte um comportamento inesperado ou envie um PR pequeno. O melhor caminho para o projeto crescer é transformar tarefas reais do navegador em casos reproduzíveis, seguros e testáveis.
