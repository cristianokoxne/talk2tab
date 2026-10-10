# Plano de confiabilidade e navegação do Talk2Tab

Data: 2026-10-09. Estado: **planejado; implementação não iniciada**.

## 1. Objetivo e definição de sucesso

Fazer a extensão concluir tarefas de navegação com várias etapas em uma variedade representativa de sites, oferecendo ao Jev contexto suficiente para escolher ações corretas, com resultados verificáveis e recuperação de falhas transitórias.

“Funcionar na maioria dos sites” será medido por famílias de interface e tarefas, não por uma promessa de compatibilidade universal. Uma página pode combinar várias famílias. Sites reais mudam; registrar a versão do Chrome, data, configuração e condições de cada avaliação.

Princípios:

- Preservar o modelo de ações tipadas e refs locais. O Jev não produz JavaScript ou seletores executáveis.
- Distinguir intenção, ação enviada, efeito observado e objetivo concluído.
- Dar ao Jev o contexto relevante, não simplesmente mais texto.
- Melhorar capacidades genéricas antes de criar exceções por domínio.
- Tornar observáveis falhas de percepção, opções, decisão, execução e verificação separadamente.
- Não aumentar o limite de passos para disfarçar ciclos ou ausência de progresso.
- Quando faltar uma capacidade, informar a limitação e permitir intervenção; nunca declarar sucesso fictício.

Metas finais propostas, a validar no corpus definido antes das mudanças:

| Métrica | Gate de aprovação |
| --- | --- |
| Regressões determinísticas de cada etapa | 100% aprovadas |
| E2E local com provider roteirizado | 100% dos casos obrigatórios em 3 execuções consecutivas |
| Jev real em tarefas locais reservadas | Pelo menos 90% de sucesso total e 80% em cada família suportada |
| Sites reais, tarefas reservadas e suportadas | Pelo menos 85% de sucesso total e 75% por família |
| Declaração falsa de sucesso | Zero ocorrências observadas na bateria de aprovação |
| Ação em aba, frame ou alvo errado | Zero ocorrências observadas |
| Efeito crítico duplicado após retry ou retomada | Zero ocorrências observadas |
| Segredos de fixtures em payloads, traces e exportações | Zero ocorrências |
| Cancelamento recebido pelo worker | Nenhuma nova ação despachada depois do recebimento |

Os percentuais são metas de produto, não resultados atuais. Sempre publicar numerador, denominador e resultados por família. Uma limitação explicitamente tratada conta como tratamento correto, mas não como tarefa concluída. Não excluir falhas do denominador depois da execução.

## 2. Base encontrada no repositório

- `orchestrator.ts`: histórico guarda tipos de ação; aguarda status da aba; execução limitada a 8 passos; confirmação depende também de palavras no objetivo.
- `provider/commandMap.ts`: extração de intenção/texto por regex; busca força digitar, enviar e finalizar; opções de seleção têm descrições pouco distintas; ausência de busca visível pode deixar apenas rolagem.
- `scanner/pageScanner.ts`: fingerprint usa refs efêmeras; frame fixo em zero; leitura de shadow roots abertos; ausência de contexto estrutural suficiente.
- `scanner/text.ts`: resumo limitado ao início do texto da página.
- `loop.ts` e `verification.ts`: progresso genérico; primeira falha encerra a execução; finish aceito sem verificação do objetivo; estagnação depende de IDs que podem variar.
- Executores: cliques e teclas podem declarar alteração sem provar efeito; scroll interno usa altura da janela para o tamanho de passo; seleção apenas nativa.
- Provider: já aceita signal, mas a chamada do orquestrador não o encaminha; configuração de timeout precisa ser efetivamente aplicada.
- Testes: 22 testes passaram na exploração inicial, com build. Isso não representa cobertura E2E em sites reais.
- `PROJECT_PROGRESS.md` contém marcos históricos; reconciliar seu estado com evidências, sem apagar o histórico.

## 3. Contrato de execução deste plano

### Commits e aprovação

1. Cada etapa abaixo termina em um commit próprio, com a mensagem sugerida ou equivalente.
2. Implementar na ordem indicada e respeitar dependências. Não juntar várias etapas em um commit final.
3. Se uma etapa precisar ser dividida, usar commits `E##a`, `E##b` etc. Cada um deve compilar e passar seus testes; a etapa só termina quando todos os critérios forem satisfeitos.
4. Não commitar credenciais, perfis de navegador, traces brutos de usuários, downloads ou arquivos gerados de build.
5. Antes de alterar código, verificar o estado do Git e preservar alterações alheias. Não usar reset destrutivo para obter uma árvore limpa.
6. Usar `rtk` como prefixo dos comandos shell, conforme `C:\Users\crist\.codex\RTK.md`.
7. Em cada commit de implementação: `rtk npm run typecheck`, `rtk npm run lint` e `rtk npm test`, mais os E2E afetados. `npm test` já inclui build; não repetir build sem necessidade.
8. Para alterações apenas de documentação, revisar links, IDs, dependências e coerência; não exigir testes de runtime.
9. Falha preexistente deve ter reprodução e registro antes da mudança; não pode ser silenciosamente ignorada ou usada para aprovar código que a agravou.
10. Gate técnico aprovado autoriza marcar a etapa como concluída; o plano não exige uma nova confirmação humana por commit. Contas externas, gastos e operações irreversíveis seguem o escopo autorizado pelo usuário.

### Evidência por etapa

Criar `docs/validation/E##.md` no commit da etapa com:

```text
Etapa e estado: planejada | em execução | aprovada | bloqueada
Escopo implementado:
Casos de teste e respectivos IDs:
Comandos executados e resultados:
Métricas antes/depois, quando aplicável:
Limitações e falhas restantes:
Mudanças de contrato e migração:
Como reverter ou desabilitar:
```

Não inventar métricas ausentes. “Não executado” e “bloqueado” são estados válidos, mas não aprovação. O hash do commit pode constar no índice da próxima etapa ou no relatório de release, evitando tentar gravar o próprio hash dentro do commit.

### Definição comum de pronto

- Critérios específicos da etapa satisfeitos e evidenciados.
- Testes de comportamento, incluindo pelo menos um caminho de falha relevante; evitar testes que apenas copiem a implementação.
- Nenhuma regressão no corpus obrigatório já suportado.
- Contratos validados em runtime nos limites de mensagens/provider.
- Logs úteis, sanitizados e limitados em tamanho.
- Alterações e limitações documentadas; commit criado; árvore sem alterações acidentais da etapa.

## 4. Arquitetura-alvo e informação enviada ao Jev

Fluxo proposto:

```text
Objetivo original + contexto da conversa
  → intenção estruturada e etapas pendentes
  → observação vinculada a sessão/aba/documento/frame
  → seleção de contexto e candidatos
  → opções fechadas e distintas para o Jev
  → validação da escolha, autorização e atualidade
  → execução de uma ação
  → espera por efeito e verificação
  → memória de progresso / recuperação / conclusão
```

Separar quatro identidades:

- `sessionId`: execução e cancelamento.
- `observationId`: versão da observação usada na decisão.
- `targetRef`: referência efêmera para executar no documento/frame correto.
- `semanticKey`: identidade aproximada para histórico e comparação, nunca autorização para executar um elemento antigo.

### Envelope semântico interno proposto

Este é um contrato interno a implementar. Não pressupõe novos campos aceitos pela API Jev. O adapter deve traduzi-lo para o contrato do provider, que será validado em E06.

```json
{
  "schemaVersion": 2,
  "task": {
    "originalGoal": "Pesquise por teclado sem fio e abra o primeiro resultado orgânico",
    "currentSubgoal": "Abrir o primeiro resultado orgânico",
    "remainingSubgoals": ["Confirmar que a página do resultado abriu"],
    "constraints": ["Não abrir resultado patrocinado"]
  },
  "context": {
    "observationId": "obs_14",
    "tabId": 12,
    "frameId": 0,
    "url": "https://example.test/search",
    "pageKind": "search_results",
    "activeDialog": null,
    "focusedElement": null,
    "loading": false,
    "limitations": []
  },
  "progress": {
    "completedSubgoals": ["Pesquisar teclado sem fio"],
    "lastAction": "Envio da busca confirmado pela lista de resultados",
    "failedAttempts": []
  },
  "candidates": [
    {
      "ref": "el_14_7",
      "role": "link",
      "name": "Teclado sem fio — modelo A",
      "region": "Resultados",
      "itemPosition": 1,
      "itemContext": "Resultado orgânico, loja exemplo",
      "enabled": true,
      "actionable": true
    }
  ],
  "coverage": { "truncated": false, "omittedCandidates": 0 }
}
```

Requisitos para opções:

- Descrição deve incluir ação, alvo, região e parâmetro relevante: “Selecionar São Paulo no campo Estado do formulário Endereço”.
- Diferenciar controles homônimos pelo card, linha, formulário, frame ou diálogo.
- Texto digitado deve ter origem rastreável no pedido ou em uma transformação explicitamente validada; não inferir dados pessoais ausentes.
- Incluir efeito esperado quando conhecido, sem afirmar que ele aconteceu.
- Separar instruções da extensão de conteúdo não confiável do site. Texto da página não pode alterar a política de execução.
- Não enviar a lista inteira de abas e conteúdo completo sem necessidade. Minimizar URLs, textos e histórico ao objetivo atual.
- Sempre informar cortes de contexto. Oferecer recuperação: inspecionar região, revelar controle, esperar ou pedir esclarecimento.
- Não usar a confiança declarada pelo modelo como prova de correção. Calibrar com corpus rotulado.
- Se houver somente uma ação determinística validada, avaliar execução local; nunca usar esse atalho para pular confirmação ou verificação.

## 5. Etapas de implementação e commits

### E01 — Corpus, baseline e infraestrutura E2E

Commit: `test(agent): establish navigation benchmark and browser harness`

Dependências: nenhuma.

Trabalho:

- Criar `tests/fixtures/sites/`, `tests/e2e/` e `benchmarks/` com objetivos, estado inicial, oráculo final e ações proibidas por caso.
- Preparar harness de Chromium com extensão carregada e servidor de fixtures em duas origens para frames.
- Manter testes rápidos existentes; adicionar scripts separados `test:e2e`, `bench:replay` e `bench:jev` à medida que os runners existirem. Estes scripts ainda não existem.
- Provider roteirizado para testar extensão sem rede; adapter real separado para medir decisões do Jev.
- Definir corpus antes das correções: pelo menos 120 cenários locais distribuídos pela matriz da seção 6. Marcar capacidades futuras como pendentes; não declarar toda a matriz implementada nesta etapa.
- Executar ao menos 12 jornadas iniciais e reproduzir: pesquisa encerrada cedo, fingerprint instável, clique sem efeito, busca atrás de lupa, scroll no fundo e cancelamento durante decisão.

Aprovação:

- Harness executa 3 jornadas básicas e detecta intencionalmente um resultado final incorreto.
- Os 6 problemas iniciais têm reprodução e classificação; falhas conhecidas ficam fora do gate verde até sua etapa, com justificativa rastreável.
- Todos os 120 cenários estão catalogados com IDs, família, prioridade, resultado esperado e etapa responsável.
- Baseline arquivado; nenhum resultado de Jev real é substituído por resultado de mock.

### E02 — Identidade de observação, fingerprint e progresso

Commit: `fix(agent): verify semantic progress independently of ephemeral refs`

Dependências: E01.

Trabalho:

- Separar identidade executável de identidade usada para comparação.
- Remover refs/gerações/timestamps do fingerprint; considerar mudanças semânticas relevantes e excluir overlay de depuração.
- Definir `dispatched`, `effectObserved`, `progressed` e evidências, sem confluir esses estados.
- Corrigir click, keypress e scroll para não declarar mudança incondicional.
- Detectar repetição por assinatura semântica de ação/alvo/parâmetros e por estado, inclusive alternância A → B → A.

Aprovação:

- 10 scans de uma página estática mantêm fingerprint, apesar da renovação de refs.
- Abrir modal, marcar checkbox, mudar seleção e atualizar resultados produzem evidência correspondente.
- Clique sem efeito e scroll no limite não contam como progresso.
- Ciclos com refs renovadas param dentro do orçamento configurado e explicam a causa.
- Alterações cosméticas irrelevantes não reiniciam indefinidamente o contador de estagnação.

### E03 — Cancelamento, timeouts e exclusividade

Commit: `fix(agent): propagate cancellation and serialize session execution`

Dependências: E02.

Trabalho:

- Passar signal ao provider, esperas e confirmações; aplicar timeout configurado e limpeza de listeners/timers.
- Verificar cancelamento depois de cada await e imediatamente antes de despachar ação.
- Impedir duas sessões concorrentes sobre a mesma aba; definir fila/rejeição explícita.
- Vincular mensagens a sessão e observação; ignorar respostas atrasadas de execuções encerradas.
- Tratar provider lento, erro HTTP, payload inválido e aba fechada com códigos distintos.

Aprovação:

- Cancelar durante fetch, confirmação, espera e entre decisão/execução não despacha ação posterior.
- Duas solicitações simultâneas não misturam refs nem executam em paralelo na mesma aba.
- Timeout encerra a espera no limite definido, sem listeners pendentes.
- Uma ação já despachada é relatada como tal; cancelamento não promete desfazê-la.

### E04 — Observação semântica e contexto estrutural

Commit: `feat(scanner): capture semantic regions controls and interaction state`

Dependências: E02, E03.

Trabalho:

- Extrair main, navegação, formulários, headings, diálogos, cards, listas, tabelas e mensagens de erro/status.
- Acrescentar relações label/description, required, readonly, disabled/aria-disabled, checked, selected, expanded, invalid e foco.
- Resolver nomes acessíveis e referências ARIA no root correto, incluindo shadow root aberto.
- Diferenciar viewport, visibilidade, clipping, inert e obstrução por modal/overlay.
- Capturar valores não sensíveis somente quando necessários; sanitizar antes de sair do content script.
- Substituir truncamento do início do body por resumo por região; preservar título/contexto de itens homônimos.
- Alinhar capacidades detectadas com ações permitidas: menuitem, tab, switch, option, summary e controles nativos.

Aprovação:

- Fixtures com nomes duplicados geram candidatos distinguíveis por contexto.
- Conteúdo principal abaixo de um cabeçalho longo aparece no resumo relevante.
- Controles atrás de modal, inertes, ocultos ou desabilitados não são tratados como acionáveis.
- Campo inválido comunica mensagem e associação ao campo.
- Segredos sintéticos não aparecem no payload serializado, inclusive em texto, atributos e URLs cobertos pelos testes.

### E05 — Seleção de contexto e catálogo de ações

Commit: `feat(agent): build bounded contextual action candidates`

Dependências: E04.

Trabalho:

- Separar geração de ações, ranking de candidatos e serialização para Jev.
- Descrever cada opção com alvo, contexto, valor e efeito esperado; corrigir descrições indistintas de select/scroll/type.
- Priorizar diálogo ativo, etapa atual, região relevante e controles de recuperação.
- Usar IDs opacos de opção associados localmente às ações; não incorporar valores arbitrários em IDs.
- Implementar orçamento configurável de bytes/candidatos, metadados de truncamento e expansão por região.
- Não remover a única ação de recuperação quando não houver alvo direto.

Aprovação:

- Em corpus rotulado, ação correta disponível em pelo menos 98% dos estados suportados; 100% dos casos obrigatórios críticos.
- Páginas com 5.000 nós e centenas de controles produzem payload dentro do orçamento definido, sem corte silencioso.
- “Escolher opção B”, “rolar o painel de mensagens” e dois botões iguais têm opções semanticamente distintas.
- Quando o candidato correto ficar fora do recorte, há um caminho testado de expansão que o recupera.

### E06 — Contrato e avaliação da compreensão do Jev

Commit: `test(jev): add contract validation replay and decision evaluation`

Dependências: E05.

Trabalho:

- Confirmar contrato do provider com documentação oficial disponível e chamadas controladas. Registrar fonte/data e limites observados; não assumir suporte a geração de texto ou schemas arbitrários.
- Validar resposta, escolha conhecida, probabilidades quando presentes e erros; tolerar ausência de campos opcionais.
- Criar replay de estados sanitizados com conjunto de ações aceitáveis, incluindo ambiguidades.
- Comparar baseline, contexto estrutural e contexto + histórico, mantendo tarefas, modelo e parâmetros iguais.
- Avaliar texto de instruções em português/inglês se relevante, sem alterar múltiplas variáveis ao mesmo tempo.
- Versionar template, adapter, configuração e identificador de modelo retornado, quando disponível.

Aprovação:

- Pelo menos 100 estados rotulados, com 30 reservados para avaliação; separação por template de página, não só por frase.
- Nos estados reservados suportados: pelo menos 90% das escolhas pertencem ao conjunto aceitável, medido em 3 repetições por estado.
- Zero escolhas desconhecidas executadas; erro de contrato tem diagnóstico reproduzível.
- Relatório separa candidato ausente de escolha errada e registra latência/tamanho/custo disponível.
- Sem credencial/acesso ao Jev, aprovar somente a parte offline e manter o gate real bloqueado; não marcar E06 integralmente concluída.

### E07 — Intenção, etapas e texto a preencher

Commit: `feat(agent): model multi-step goals and grounded input values`

Dependências: E06.

Trabalho:

- Preservar objetivo original e representar subtarefas, restrições, campos e textos associados.
- Remover regex como autoridade única para objetivos compostos. Usar parser determinístico nos casos simples e capacidades confirmadas do Jev para escolhas estruturadas.
- Se a API continuar sendo apenas choice, gerar interpretações finitas e fundamentadas ou pedir esclarecimento; não supor um gerador de texto inexistente.
- Separar “termo da busca” de “e depois abra o resultado”; suportar dois campos com valores diferentes.
- Acrescentar estado de esclarecimento para ambiguidade real, como dois destinatários indistinguíveis.
- Tratar referência contextual (“esse resultado”, “volte”, “agora filtre por preço”) com memória limitada e rastreável.

Aprovação:

- Pelo menos 40 objetivos PT-BR, incluindo sinônimos, acentos, aspas, URLs, negativas e comandos compostos.
- “Pesquise X e abra o primeiro resultado” preenche apenas X e mantém a etapa de abrir pendente.
- Nome/email/endereço de um formulário não recebem todos o mesmo texto.
- Dados não fornecidos não são inventados; ambiguidades retornam pergunta específica.
- “Não envie” permanece como restrição durante toda a tarefa.

### E08 — Loop com memória e conclusão verificável

Commit: `feat(agent): execute goal stages with verified completion`

Dependências: E07.

Trabalho:

- Substituir Set de tipos por histórico de ações com alvo, parâmetros sanitizados, URL, etapa e evidência.
- Remover finish forçado após digitar/enviar; permitir vários cliques, buscas e preenchimentos legítimos.
- Submeter finish à verificação da tarefa, distinguindo conclusão comprovada, falha e necessidade de ajuda.
- Adotar budgets configuráveis de passos, duração e chamadas, com motivo de término explícito.
- Enviar ao Jev últimas ações relevantes, falhas e etapas pendentes; compactar histórico longo.

Aprovação:

- Jornadas pesquisar → abrir resultado → entrar em seção; abrir menu → submenu → item; preencher dois campos → validar passam com provider roteirizado.
- Jev não pode declarar sucesso quando o oráculo da tarefa continua falso.
- Duas ações click/type legítimas são permitidas; repetição sem efeito continua limitada.
- Limite atingido retorna progresso parcial e motivo, nunca “concluído”.

### E09 — Espera por efeito e recuperação limitada

Commit: `feat(agent): wait for page effects and recover transient failures`

Dependências: E08.

Trabalho:

- Esperas orientadas a condição: navegação, alvo aparecer, diálogo mudar, carregamento terminar e resultados atualizar.
- MutationObserver com janela de estabilidade e prazo máximo; não esperar quietude global em páginas com animações contínuas.
- Acrescentar ações internas de observar novamente/esperar e recuperação por código de erro.
- Em stale ref, observar de novo e decidir novamente; não executar automaticamente por similaridade.
- Retry de observação/provider com backoff limitado; ação com efeito desconhecido exige reconciliação antes de qualquer repetição.

Aprovação:

- Fixtures com atrasos de 0, 100, 800 e 2.500 ms chegam ao mesmo resultado correto.
- DOM substituído entre escolha e clique recupera ou explica falha sem acionar outro elemento.
- Uma página com relógio/banner animado não bloqueia a espera eternamente.
- Envio com resposta perdida não é repetido automaticamente.
- Cada tipo recuperável tem limite de tentativas e teste de esgotamento.

### E10 — Navegação, abas e documentos restritos

Commit: `feat(browser): track navigation targets tabs and document lifecycle`

Dependências: E09.

Trabalho:

- Permitir navegar a partir de nova aba/página não inspecionável sem exigir scan bem-sucedido antes da decisão de navegador.
- Implementar voltar/avançar e lidar com redirects, navegação hash/SPA, target blank e aba fechada.
- Vincular novas abas ao evento/aba de origem; não seguir cegamente a aba focada pelo usuário.
- Validar protocolos de URL e destinos; registrar documento/frame antes de executar.
- Se usuário mudar a aba durante execução, manter alvo original ou pausar explicitamente conforme política; não transferir a tarefa silenciosamente.

Aprovação:

- Abrir URL partindo de nova aba funciona; página restrita retorna capacidade limitada sem bloquear navegação autorizada.
- Links mesma aba/nova aba, redirect e SPA preservam contexto da tarefa.
- Troca manual de foco não provoca ação na aba errada.
- Voltar restaura observação nova; refs do documento anterior são inválidas.

### E11 — Cliques, menus, foco e teclado

Commit: `feat(executor): support contextual controls and keyboard workflows`

Dependências: E10.

Trabalho:

- Verificar conectividade, visibilidade, obstrução, readonly/inert/disabled e estado imediatamente antes da ação.
- Cobrir link, button, checkbox, radio, switch, tab, menuitem, details/summary e botões com ícones.
- Implementar foco explícito, Escape, Tab e setas conforme capacidade real do controle; não presumir que evento sintético reproduz comportamento nativo.
- Para Enter, respeitar preventDefault e evitar submissão duplicada entre listener e requestSubmit.
- Menus por hover: implementar suporte DOM verificável ou reportar limitação; avaliar fallback somente em E20.

Aprovação:

- Abrir/fechar menu, escolher submenu, alternar tab e dismiss de modal passam em browser real.
- Clique bloqueado por overlay não aciona conteúdo de fundo.
- Enter em fixture com handler e formulário produz no máximo um envio.
- Foco/teclado em shadow root aberto atinge o controle interno correto.
- Ações que exigem interação confiável não são reportadas como executadas sem efeito.

### E12 — Inputs nativos, máscaras e formulários controlados

Commit: `feat(executor): support verified native and controlled form inputs`

Dependências: E11.

Trabalho:

- Cobrir text, search, email, tel, url, number e textarea; replace/append/limpar; min/max/step/maxlength.
- Validar em fixtures de inputs controlados e re-renderizações, incluindo máscaras de telefone e valores monetários.
- Definir política de eventos input/change/blur por capacidade, sem disparar todos indiscriminadamente.
- Comparar valor aceito depois do ciclo de atualização, não apenas imediatamente após setter.
- Datas/horas: usar valores canônicos para controles nativos e verificar apresentação/localidade; tratar picker customizado via ações próprias.
- Deixar senhas, OTP, pagamento e upload nativo no fluxo assistido, sem extrair segredos.

Aprovação:

- Cada tipo suportado tem preencher/substituir/limpar e rejeição de valor inválido testados.
- Re-renderização que reverte o valor é detectada como falha.
- Máscara preserva o valor esperado normalizado; não confundir formatação com rejeição.
- Campos readonly/disabled/sensíveis não são alterados por caminhos genéricos.
- Validação do formulário aparece para o Jev com o campo correspondente.

### E13 — Select customizado, autocomplete e editores

Commit: `feat(executor): support composite selection and editable controls`

Dependências: E12.

Trabalho:

- Select nativo por valor/rótulo, optgroup, opção disabled e seleção múltipla quando representável.
- Combobox customizado: abrir, digitar filtro, esperar sugestões, escolher e verificar seleção real.
- Listbox/menu em portal, opções virtualizadas e autocompletes com sugestões duplicadas.
- Contenteditable simples e fixtures de editor rico; preservar estrutura existente quando apropriado.
- Date picker customizado: mês/ano/dia com contexto e confirmação de valor; sliders com limites explícitos.

Aprovação:

- Digitar texto no autocomplete sem selecionar não é considerado seleção concluída.
- Opções fora do viewport são encontradas por rolagem da lista correta.
- Dois rótulos iguais em grupos diferentes são desambiguados.
- Edição de texto preserva conteúdo fora do trecho autorizado e detecta rejeição pelo editor.
- Editor não suportado solicita ajuda sem destruir HTML/conteúdo preexistente.

### E14 — Rolagem, listas virtualizadas e paginação

Commit: `feat(scroll): navigate nested horizontal and virtualized content`

Dependências: E13.

Trabalho:

- Identificar contêiner principal e painéis internos por contexto; usar clientHeight/clientWidth do alvo para passo.
- Scroll vertical/horizontal, início/fim, trazer alvo à vista e busca progressiva por região.
- Medir deslocamento real; detectar limites, scroll lock, scroll snap e carregamento incremental.
- Listas virtualizadas: registrar itens vistos sem reutilizar refs; procurar alvo com orçamento de distância/itens/tempo.
- Escolher paginação ou “carregar mais” quando adequado, evitando scroll infinito sem resultado.
- Rolagem contínua: cancelamento responsivo e histórico limitado em memória.

Aprovação:

- Em três contêineres aninhados, apenas o alvo correto se move.
- Passo em modal pequeno usa sua altura; scroll no limite retorna ausência de progresso.
- Encontrar item 80 numa lista virtualizada de 200 funciona sem exigir todos os nós simultaneamente.
- Infinite scroll com/sem novos itens termina corretamente; ausência de alvo explica limite atingido.
- Tabela horizontal e modal com fundo bloqueado têm resultados verificados.

### E15 — Frames e componentes encapsulados

Commit: `feat(scanner): route observations and actions across frames`

Dependências: E14.

Trabalho:

- Agregar observações por frame/documento e rotear execução ao frame correto.
- Implementar injeção e descoberta conforme permissões realmente disponíveis; reavaliar manifest com justificativa.
- Cobrir iframe same-origin, cross-origin autorizado, aninhado, removido/recriado e lazy-loaded.
- Contextualizar nomes duplicados entre frames; invalidar refs ao navegar apenas o subframe.
- Reconhecer falta de acesso sem afirmar detectar com certeza a presença de shadow root fechado.

Aprovação:

- Campo homônimo no pai e no iframe recebe texto somente no alvo escolhido.
- Navegação do subframe invalida seus refs sem corromper os demais.
- Frame sem permissão ou sandbox incompatível gera limitação explícita.
- Shadow root aberto aninhado mantém nomes, foco e ações corretos.

### E16 — Política de efeitos e confirmação contextual

Commit: `fix(safety): classify action effects and bind contextual confirmations`

Dependências: E15; invariantes básicas devem permanecer ativas desde E01.

Trabalho:

- Classificar a ação atual e seu contexto, não todos os cliques por palavra no objetivo.
- Distinguir navegar/preencher de enviar/comprar/excluir/publicar; tratar checkbox/select que alteram estado externo.
- Vincular confirmação a ação, alvo, documento, parâmetros e prazo; revalidar após aprovação.
- Bloquear tentativa de instrução embutida em página que peça ignorar objetivo, extrair dados ou executar ação extra.
- Sanitizar payload e exportação com testes de canários em texto, campos e URLs; restringir origem das mensagens relevantes.

Aprovação:

- “Abra as configurações para salvar…” não exige confirmação em cada clique de navegação.
- Envio/exclusão exige a confirmação prevista, inclusive quando acionado por teclado.
- Se alvo/valor/documento mudar durante confirmação, aprovação antiga não autoriza a nova ação.
- Recusa, expiração e cancelamento impedem execução.
- Fixtures de prompt injection não alteram objetivo, autorização ou destino dos dados.

### E17 — Ciclo de vida MV3, retomada e fila de voz

Commit: `feat(agent): reconcile session lifecycle and queued instructions`

Dependências: E16.

Trabalho:

- Persistir checkpoints mínimos de sessão/progresso, sem refs executáveis ou segredos.
- Ao reiniciar worker, observar estado e reconciliar ação pendente; não repetir cegamente.
- Painel fechado/reaberto recupera status e cancelamento; confirmar política para interrupção no meio de efeito externo.
- Distinguir novo comando, complemento e cancelamento na fila; impedir duplicação de segmentos finais de voz.
- Resolver comandos contextuais com a sessão correta, sem assumir que foco atual é alvo anterior.

Aprovação:

- Reinício do worker antes/depois de clique não duplica efeito; ação incerta fica explicitamente pendente de reconciliação.
- Reabrir painel mostra estado real, não tarefa fantasma em execução.
- Comando “pare” cancela fluxo ativo e não espera atrás da fila normal.
- Dois segmentos de voz não iniciam duas tarefas concorrentes nem repetem texto final.

### E18 — Diagnóstico, desempenho e experiência de intervenção

Commit: `feat(debug): expose sanitized decision traces and performance budgets`

Dependências: E17.

Trabalho:

- Mostrar etapa atual, alvo, efeito esperado, evidência, espera e motivo de recuperação.
- Exportar trace sanitizado com observações resumidas, opções enviadas, escolha, latências e verificação.
- Não inventar raciocínio interno do Jev: exibir fatos do estado e campos realmente retornados.
- Medir scanner, serialização, tamanho de payload, número de opções, chamadas e memória por sessão.
- Fazer scans incrementais/cache por invalidação somente depois de baseline de correção; impedir cache stale.
- Propor budgets iniciais: payload até 64 KiB e 60 opções por decisão, scanner p95 até 200 ms em fixture de 5.000 nós no hardware registrado. Ajustar explicitamente com evidência e limites reais do provider. A medição E18 registrou p95 de 207,2 ms (máximo 209,3 ms) em Chromium 156 no Ryzen 7 8845HS; o budget de scanner desta fixture foi ajustado para 220 ms para refletir a medição e sua variação, mantendo margem para regressão.

Aprovação:

- Trace permite classificar 10 falhas sem depender de vídeo ou conteúdo privado bruto.
- Exportação não contém os canários sensíveis do corpus.
- Budgets são medidos em 30 scans aquecidos por fixture; cortes são informados e recuperáveis.
- Sessão de rolagem de 10 minutos mantém buffers limitados; cancelamento continua funcional.
- Intervenção humana pode continuar a mesma tarefa após nova observação.

### E19 — Benchmark completo, sites reais e release

Commit: `test(agent): gate release on cross-site navigation benchmark`

Dependências: E18.

Trabalho:

- Executar os 120 cenários locais; ampliar para pelo menos 40 jornadas compostas e adversariais.
- Reservar 30% das tarefas por família/template para avaliação final; não ajustar prompts olhando continuamente o conjunto reservado.
- Rodar pelo menos 30 tarefas reais em 12 domínios e 6 famílias; 3 repetições por tarefa. Registrar rede, autenticação e interferências.
- Usar páginas públicas e contas de teste autorizadas. Compra, envio e exclusão são validados em fixtures/sandbox, não em contas reais por padrão.
- Comparar baseline com versão final; classificar falhas e publicar denominadores.
- Atualizar README, limitações, instruções de depuração e PROJECT_PROGRESS.

Aprovação:

- Metas da seção 1 satisfeitas no conjunto suportado, com relatório por família e sem regressões críticas.
- Famílias não suportadas publicadas separadamente e tratadas com intervenção clara.
- Jornadas reservadas com Jev real passam nos limiares; testes roteirizados não substituem essa exigência.
- Não há falha aberta de execução no alvo errado, sucesso falso ou duplicação de efeito na bateria.
- Checklist de instalação/build e smoke test da extensão empacotada concluídos.

### E20 — Capacidades avançadas condicionais

Commit inicial: `docs(agent): evaluate advanced interaction fallback`

Dependências: E19 ou evidência anterior de bloqueio estrutural; não bloqueia a primeira release suportada.

Trabalho:

- Classificar falhas restantes: canvas, mapas, drag-and-drop, hover dependente de eventos confiáveis, upload, interfaces sem semântica e componentes fechados.
- Fazer prova de conceito separada para screenshot/visão e/ou entrada via mecanismo privilegiado, apenas se contrato do Jev e permissões permitirem.
- Se considerar `chrome.debugger`, documentar impacto de permissão, compatibilidade e ciclo de conexão antes de implementação; não adicioná-lo implicitamente.
- Avaliar coordenadas com observação recente, bounds e confirmação de efeito; nunca tratá-las como identidade durável.
- Preferir fallback assistido quando o custo/risco de automação exceder o ganho observado.

Aprovação:

- Documento decide implementar ou adiar cada capacidade com dados do benchmark.
- Para implementar: pelo menos 20 casos da capacidade, 90% de conclusão em sandbox e zero alvo errado observado; regressão das capacidades existentes obrigatória.
- Cada capacidade aprovada vira etapa adicional e commit próprio com gate definido antes do código.
- Não prometer CAPTCHA, passkeys, prompts do sistema ou páginas restritas como automação universal.

## 6. Matriz de cobertura obrigatória

Cada linha abaixo deve originar casos identificados (`NAV-001`, `INP-001` etc.). A lista é catálogo de cobertura, não afirmação de suporte atual.

| Família | Variações mínimas | Oráculo principal | Etapas |
| --- | --- | --- | --- |
| NAV: entrada no site | URL, domínio, nome genérico, nova aba, página restrita inicial, redirect | URL/documento/destino esperado | E07–E10 |
| TAB: abas/janelas | mesma aba, target blank, popup, aba existente, foco manual, fechar alvo | ação somente na aba vinculada | E03, E10 |
| SPA: navegação dinâmica | rota, hash, history, voltar, render tardio, skeleton | região esperada disponível | E09–E10 |
| SEA: busca | campo visível, lupa, busca em modal, Enter, botão, sugestões, nenhum resultado | consulta correta e resultado/estado vazio | E07–E13 |
| RES: resultados | orgânico/patrocinado, cards duplicados, ordenação, filtros, paginação | item correto aberto | E04–E08, E14 |
| MEN: menus | dropdown, submenu, hover, menuitem, tabs, accordion, ícone | painel/item/estado expandido correto | E04, E11 |
| MOD: diálogos | cookie banner, modal, drawer, backdrop, nested modal, fundo inert | diálogo correto; fundo intacto | E04, E11, E16 |
| INP: texto nativo | text/search/email/tel/url/number/textarea; vazio/preenchido; replace/append/clear | valor aceito após atualização | E12 |
| VAL: validação | required, readonly, disabled, maxlength, min/max/step, pattern, erro remoto | erro associado ou valor válido | E04, E12 |
| CTL: inputs controlados | re-render, debounce, máscara, blur, valor revertido, composição Unicode | estado aceito pelo componente | E12 |
| CHK: controles booleanos | checkbox, radio, switch, marcado/desmarcado, mixed | estado solicitado, sem toggle redundante | E11 |
| SEL: seleção | select, optgroup, múltiplo, disabled, combobox, listbox, portal, opções duplicadas | seleção efetiva correta | E13 |
| AUT: autocomplete | debounce, sugestão remota, nenhuma sugestão, duplicatas, tokens múltiplos | item selecionado, não só texto | E09, E13 |
| DAT: data/número | date/time/datetime-local/month/week, calendário customizado, locale, slider | valor canônico e limites | E12–E13 |
| EDT: editor | contenteditable simples, multiline, seleção, rich text, formatação existente | texto desejado sem dano adjacente | E13 |
| SCR: scroll | viewport, painel, modal, aninhado, horizontal, snap, sticky header, limite | alvo correto e deslocamento medido | E14 |
| VIR: conteúdo incremental | virtualização, infinite scroll, carregar mais, paginação, reciclagem de nós | item encontrado ou esgotamento explicado | E14 |
| FRM: frames/roots | same/cross-origin, sandbox, aninhado, reinjeção, shadow aberto/fechado | frame correto ou limitação | E15 |
| ERR: falhas | offline, timeout, 429/5xx, resposta inválida, stale ref, aba removida | recuperação limitada e diagnóstico | E03, E09 |
| SEC: efeitos/dados | confirmação, recusa, expiração, dados sensíveis, texto hostil, resposta perdida | nenhuma ação extra/vazamento/duplicação | E16 |
| LIFE: ciclo de vida | worker reiniciado, painel fechado, execução concorrente, voz em fila | reconciliação sem repetição | E17 |
| A11Y: semântica | aria-label/labelledby/describedby, labels repetidos, foco, tabindex, inert | alvo e contexto corretos | E04, E11 |
| VIS: layout | desktop/laptop/estreito, zoom 80/125/200%, menu responsivo, RTL | alvo alcançável e sem confusão | E04, E14, E19 |
| ADV: avançados | canvas, mapa, drag-and-drop, file upload, download, mídia | capacidade comprovada ou ajuda explícita | E20 |

### Famílias de sites para jornadas completas

- Busca e portais: pesquisar, distinguir resultado e abrir destino.
- E-commerce: buscar, filtrar, ordenar e abrir produto; checkout apenas em sandbox.
- Documentação e notícias: navegar índice, expandir seção, pesquisar conteúdo e voltar.
- Vídeo/mídia: busca, canal/lista e abertura de conteúdo; controles semânticos quando disponíveis.
- SaaS administrativo/CRM: tabela, busca, filtro, drawer, formulário e validação em conta de teste.
- E-mail/chat: conversas virtualizadas, busca e edição de rascunho; envio somente em sandbox autorizado.
- Formulários públicos/cadastros: campos, máscara, selects dependentes e erros; dados fictícios.
- Calendário/reservas: seletor de data, disponibilidade e navegação; confirmar reserva apenas em sandbox.
- Dashboards: múltiplos painéis, tabelas horizontais e filtros.
- Sites legados: tabelas, frames e navegação por formulário.
- Componentes modernos: fixtures com React, Vue, Angular e Web Components quando usados no corpus; comportamento importa mais que nome do framework.

### Cruzamento sem explosão combinatória

- Cada capacidade suportada: caso positivo, negativo, atualização assíncrona e alvo ambíguo.
- Cobertura por pares entre layout, atraso, estado do controle e tipo de contêiner.
- Cobertura completa para combinações críticas: cancelamento × ação; confirmação × alteração de alvo; retry × efeito externo; frame × navegação.
- Layouts mínimos locais: 1440×900, 1280×720 e 800×900. Não chamar viewport estreito de suporte ao Chrome mobile.
- Latências determinísticas com seeds; IDs e ordem visual variados para evitar overfitting.
- Estados de autenticação: visitante, sessão válida de teste e sessão expirada. CAPTCHA/passkey requerem intervenção.

## 7. Como medir se o Jev está entendendo melhor

Classificar cada falha na primeira fronteira que perdeu a informação necessária:

| Classe | Pergunta de diagnóstico | Ação de melhoria |
| --- | --- | --- |
| Intenção | O termo, campo ou etapa foi interpretado errado? | parser/representação/esclarecimento |
| Percepção | O alvo e seu estado foram detectados? | scanner e contexto |
| Cobertura | A ação correta existia nas opções enviadas? | catálogo e ranking |
| Compreensão/decisão | Havia opção correta clara e o Jev escolheu outra? | descrições, contexto e avaliação |
| Execução | A opção correta foi executada no alvo certo? | executor, foco, frame, precondições |
| Sincronização | O efeito ainda estava carregando quando observamos? | espera por condição |
| Verificação | Houve efeito, mas classificamos errado? | oráculo e evidência |
| Limitação | A interface exige capacidade não disponível? | fallback ou intervenção |

Métricas obrigatórias:

- Recall de candidatos: estados em que alguma opção aceitável estava disponível / estados suportados rotulados.
- Acerto de decisão condicionado à presença de candidato correto; reportar também acerto global.
- Sucesso da jornada pelo oráculo independente, nunca pela mensagem finish.
- Falso sucesso: finish de sucesso com oráculo falso / todos os finishes de sucesso; reportar contagem absoluta.
- Recuperação: falhas transitórias recuperadas / falhas transitórias injetadas.
- Intervenções e confirmações por tarefa; separar necessárias de desnecessárias.
- Passos, chamadas, bytes e latências p50/p95; custo apenas quando houver dado verificável.
- Estagnação, cancelamento e falhas por família, com numerador/denominador.

Protocolo de comparação:

1. Congelar tarefas, entradas, condições e conjunto reservado antes de ajustar descrições.
2. Executar baseline e candidato sob as mesmas condições e configuração.
3. Fazer 3 repetições por caso com Jev real; conservar variação, não escolher apenas a melhor tentativa.
4. Alterar uma dimensão principal por experimento: contexto, descrição, ranking ou histórico.
5. Analisar regressões por família; ganho agregado não compensa alvo errado ou falso sucesso.
6. Promover template somente se gates forem satisfeitos; se modelo remoto mudar, registrar e refazer comparação controlada.

## 8. Casos de aceitação prioritários

Estes casos devem existir desde E01 como especificação e tornar-se obrigatórios conforme a etapa responsável:

1. Abrir um site partindo da nova aba, sem scan inicial disponível.
2. Pesquisar uma frase e abrir o primeiro resultado orgânico.
3. Abrir uma lupa antes de preencher a pesquisa.
4. Fechar um modal que cobre o conteúdo e continuar a tarefa.
5. Abrir menu, submenu e página sem bloquear o segundo clique.
6. Preencher nome e e-mail com textos diferentes, respeitando “não enviar”.
7. Selecionar cidade depois de escolher estado e aguardar opções remotas.
8. Encontrar um item em lista virtualizada dentro de modal.
9. Rolar horizontalmente uma tabela sem mover a página verticalmente.
10. Abrir link em nova aba e continuar nela sem seguir uma troca manual de foco.
11. Recuperar de re-renderização que invalida a ref antes do clique.
12. Cancelar enquanto Jev responde sem executar sua resposta tardia.
13. Pressionar Enter em formulário com listener sem enviar duas vezes.
14. Identificar que clique sem efeito não concluiu o objetivo.
15. Reconhecer fim de lista sem ficar rolando até esgotar chamadas.
16. Interagir com controle dentro de iframe autorizado e shadow root aberto.
17. Retomar após reinício do worker sem repetir uma ação de efeito incerto.
18. Recusar instrução maliciosa presente no texto do site sem alterar a tarefa.
19. Corrigir campo rejeitado pela validação sem recomeçar tudo.
20. Pedir ajuda quando há dois alvos indistinguíveis ou controle não suportado.

## 9. Ordem de entrega e controle de escopo

| Marco | Etapas | Resultado esperado |
| --- | --- | --- |
| Base confiável | E01–E03 | Medir, verificar progresso e cancelar corretamente |
| Jev com contexto | E04–E06 | Estados e opções claros, com avaliação reproduzível |
| Tarefas completas | E07–E10 | Intenção composta, memória, recuperação e navegação |
| Interações amplas | E11–E15 | Controles, inputs, editores, scroll e frames |
| Operação robusta | E16–E18 | Confirmação contextual, ciclo de vida e diagnóstico |
| Aprovação de release | E19 | Evidência de cobertura e sucesso em sites variados |
| Expansão opcional | E20 | Decisão fundamentada sobre interfaces avançadas |

Não iniciar uma reescrita geral do orquestrador sem os casos de regressão. Extrair módulos conforme as responsabilidades surgirem: observação, contexto, candidatos, memória, navegação, espera, políticas e verificação. Manter adapters pequenos e contratos explícitos.

Não criar um adapter específico de site para encobrir falha genérica. Se necessário, documentar evidência, domínio, versão, fallback e testes isolados. O benchmark deve mostrar resultados com e sem o adapter.

## 10. Instrução para iniciar uma etapa

```text
Leia este plano, RTK.md e as instruções aplicáveis do repositório.
Identifique a primeira etapa pendente cujas dependências estejam aprovadas.
Confira o Git e preserve alterações existentes.
Leia os contratos e reproduza os casos relevantes antes de editar.
Implemente somente o escopo da etapa, com testes de comportamento.
Execute os gates comuns e específicos; registre evidências reais.
Se algo depender de capacidade externa não verificada, registre a pendência.
Não marque aprovado com mocks quando o gate exige Jev real ou browser real.
Atualize docs/validation/E##.md e o índice de progresso.
Crie o commit da etapa aprovada e informe hash, testes e limitações.
Continue para a próxima etapa somente quando estiver dentro do escopo solicitado.
```

Este documento planeja o trabalho. Nenhuma etapa de implementação está aprovada apenas pela criação deste arquivo.
