import type { AgentAction, ElementRef, PageState } from "../types.js";
import { parseGoal, updateGoalProgress, valueForField, type GoalHistoryEvent, type GoalPlan } from "../intent.js";

export interface BrowserTabSummary {
  id: number;
  title: string;
  url: string;
  active: boolean;
  windowId: number;
}

export interface JevChoiceCriterion {
  description: string;
}

export interface JevCommandMap {
  state: {
    goal: string;
    goalPlan: GoalPlan;
    page: PageState;
    browser: {
      tabs: BrowserTabSummary[];
      completedActions: string[];
      history: GoalHistoryEvent[];
      coverage: { truncated: boolean; omittedCandidates: number; omittedOptions: number; omittedTabs: number; candidateOffset: number; totalOptions: number; hasMoreOptions: boolean; payloadBytes: number };
    };
  };
  questions: {
    next_action: {
      type: "choice";
      instructions: string;
      criteria: Record<string, JevChoiceCriterion>;
    };
  };
}

export interface CommandOption {
  id: string;
  action: AgentAction;
}

const MAX_OPTIONS = 60;
const MAX_CONTEXT_BYTES = 64 * 1024;

function requestedUrl(goal: string): string | undefined {
  const explicit = goal.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.!?]+$/, "");
  if (explicit) return explicit;
  const domain = goal.match(/\b(?:www\.)?[a-z0-9][a-z0-9-]*\.(?:com(?:\.br)?|org|net|io|dev|ai|app|gov(?:\.br)?)(?:\/[^\s]+)?\b/i)?.[0];
  if (domain) return `https://${domain}`;
  if (/\bgoogle\b/i.test(goal)) return "https://www.google.com/";
  if (/\byoutube\b/i.test(goal)) return "https://www.youtube.com/";
  return undefined;
}

function elementDescription(element: ElementRef): string {
  const label = element.name ?? element.text ?? element.placeholder ?? element.role ?? element.tag;
  const context = element.context ? `, ${element.context}` : "";
  const description = element.description ? `, ajuda: ${element.description}` : "";
  return `${element.role ?? element.tag} “${label}”${context}${description}`;
}

function normalizeForMatching(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function targetRef(action: AgentAction): string | undefined {
  return "target" in action ? action.target?.ref : undefined;
}

function scoreOption(option: CommandOption, goal: string, page: PageState, tabs: BrowserTabSummary[], textToType?: string): number {
  const action = option.action;
  if (action.type === "finish") return -100;
  if (action.type === "navigate" || action.type === "open_tab" || action.type === "open_window" || action.type === "go_back" || action.type === "go_forward") return 30;
  if (action.type === "search_web") return 24;
  if (action.type === "switch_tab") return tabs.find((tab) => tab.id === action.tabId)?.active ? 40 : 0;
  if (action.type === "close_tab") return 4;
  if (action.type === "keypress") return 12;
  if (action.type === "scroll") return -5;
  if (action.type === "expand_candidates") return -20;
  const element = page.elements.find((candidate) => candidate.ref === action.target.ref);
  if (!element) return 0;
  const evidence = normalizeForMatching([element.name, element.text, element.placeholder, element.context, element.description, element.href].filter(Boolean).join(" "));
  const normalizedGoal = normalizeForMatching(goal);
  const terms = normalizedGoal.split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 3);
  let score = terms.reduce((total, term) => total + (evidence.includes(term) ? 3 : 0), 0);
  if (element.context && page.activeDialog && normalizeForMatching(element.context).includes(normalizeForMatching(page.activeDialog))) score += 18;
  if (page.focusedElement === element.ref) score += 8;
  if (action.type === "type") {
    score += 10;
    if (textToType) score += evidence.includes("search") || evidence.includes("busca") || evidence.includes("pesquis") ? 16 : 0;
  }
  if (action.type === "select") {
    const option = element.options?.find((candidate) => candidate.value === action.value);
    if (option && terms.some((term) => normalizeForMatching(option.label).includes(term))) score += 18;
  }
  if (action.type === "click" && element.role === "link") score += 2;
  return score;
}

function compactOptionLabel(element: ElementRef | undefined, value: string): string {
  return element?.options?.find((option) => option.value === value)?.label ?? "opção disponível";
}

function isSearchSubmitControl(element: ElementRef): boolean {
  const label = `${element.name ?? ""} ${element.text ?? ""} ${element.role ?? ""}`.toLowerCase();
  return ["pesquisa", "pesquisar", "buscar", "busca", "search", "submit", "go"].some((term) => label.includes(term));
}

function isProhibitedByGoal(element: ElementRef, plan: GoalPlan): boolean {
  if (!plan.restrictions.length) return false;
  const restriction = plan.restrictions.join(" ").toLowerCase();
  const label = [element.name, element.text, element.role].filter(Boolean).join(" ").toLowerCase();
  return /envie|enviar|submeta|submit|send|publish/.test(restriction)
    && /enviar|envie|send|submit|submeter|publicar|publish/.test(label);
}

function matchesTarget(element: ElementRef, target: string): boolean {
  const tokens = normalizeForMatching(target).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2 && !["the", "and", "para", "com", "menu", "item"].includes(token));
  const label = normalizeForMatching([element.name, element.text, element.context].filter(Boolean).join(" "));
  return tokens.length > 0 && tokens.every((token) => label.includes(token));
}

function navigationQuery(goal: string): string {
  return goal
    .replace(/\b(abra|abrir|acesse|acessar|v[aá]|ir|navegue|navegar)\b/gi, "")
    .replace(/\b(site|p[aá]gina|portal|reposit[oó]rio|repo|git|url)\b/gi, "")
    .replace(/\b(o|a|os|as|em|no|na|para|por|do|da|de|uma|um)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Builds Jev's closed action space. Jev chooses an existing option; it never invents a selector or code. */
export function buildJevCommandMap(goal: string, page: PageState, tabs: BrowserTabSummary[] = [], completedActions: string[] = [], candidateOffset = 0, actionHistory: GoalHistoryEvent[] = []): { map: JevCommandMap; options: CommandOption[] } {
  const goalPlan = parseGoal(goal);
  const progressedPlan = updateGoalProgress(goalPlan, actionHistory);
  const pendingStage = progressedPlan.stages.find((stage) => stage.status === "pending");
  const textToType = goalPlan.stages.find((stage) => stage.kind === "search")?.value
    ?? goalPlan.stages.find((stage) => stage.kind === "fill_field")?.value;
  const options: CommandOption[] = [
    { id: "finish_success", action: { type: "finish", status: "success", message: "Objetivo concluído." } },
  ];
  if (/\b(voltar|volte|retorne|back|go back)\b/i.test(goal)) options.push({ id: "go_back", action: { type: "go_back" } });
  if (/\b(avance|avançar|avanca|pr[oó]xima p[aá]gina|forward|go forward)\b/i.test(goal)) options.push({ id: "go_forward", action: { type: "go_forward" } });

  const url = requestedUrl(goal);
  const hasNavigationIntent = Boolean(url && /\b(abra|abrir|acesse|acessar|v[aá]|ir)\b/i.test(goal));
  const genericNavigation = !url && /\b(abra|abrir|acesse|acessar|v[aá]|ir|navegue|navegar)\b/i.test(goal) && navigationQuery(goal);
  const hasSearchIntent = Boolean(progressedPlan.stages.some((stage) => stage.status === "pending" && (stage.kind === "search" || stage.kind === "open_result")));
  if (url && !completedActions.includes("open_window") && /\b(nova|novo)\s+(janela|window)\b/i.test(goal)) {
    options.push({ id: "open_window", action: { type: "open_window", url } });
  }
  if (url && !completedActions.includes("open_tab") && /\b(nova|novo)\s+(aba|guia|tab)\b/i.test(goal)) {
    options.push({ id: "open_tab", action: { type: "open_tab", url } });
  }
  if (url && !completedActions.includes("navigate") && !/\b(nova|novo)\s+(aba|guia|tab|janela|window)\b/i.test(goal) && /\b(abra|abrir|acesse|acessar|vá|ir)\b/i.test(goal)) {
    options.push({ id: "navigate", action: { type: "navigate", url } });
  }
  if (genericNavigation && !completedActions.includes("search_web")) {
    options.push({ id: "search_web", action: { type: "search_web", query: navigationQuery(goal) } });
  }
  const selectedTabs = [...tabs].sort((a, b) => Number(b.active) - Number(a.active)).slice(0, 20);
  for (const tab of selectedTabs) {
    if (!tab.url || tab.url.startsWith("chrome://")) continue;
    options.push({ id: `switch_tab_${tab.id}`, action: { type: "switch_tab", tabId: tab.id } });
  }
  if (/\b(feche|fechar|encerre)\s+(a\s+)?(aba|guia|janela)\b/i.test(goal)) {
    const active = tabs.find((tab) => tab.active);
    if (active) options.push({ id: `close_tab_${active.id}`, action: { type: "close_tab", tabId: active.id } });
  }

  for (const element of page.elements) {
    if (!element.visible || !element.enabled || element.sensitive) continue;
    const description = elementDescription(element);
    if (!isProhibitedByGoal(element, goalPlan) && ["button", "link", "checkbox", "radio", "switch", "tab", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "treeitem", "submit"].includes(element.role ?? element.tag)) {
      options.push({ id: `click_${element.ref}`, action: { type: "click", target: { ref: element.ref } } });
    }
    const elementText = valueForField(goal, [element.name, element.placeholder, element.context].filter(Boolean).join(" "));
    if (elementText && ["input", "textarea", "textbox", "searchbox", "combobox"].includes(element.role ?? element.tag) && element.type !== "password") {
      options.push({ id: `type_${element.ref}`, action: { type: "type", target: { ref: element.ref }, text: elementText, replace: true } });
    }
    if (["select", "combobox"].includes(element.role ?? element.tag)) {
      for (const option of element.options ?? []) {
        options.push({ id: `select_${element.ref}_${option.value}`, action: { type: "select", target: { ref: element.ref }, value: option.value } });
      }
    }
    const last = options[options.length - 1];
    if (last) void description;
  }

  options.push(
    { id: "scroll_down", action: { type: "scroll", direction: "down", amount: "viewport" } },
    { id: "scroll_up", action: { type: "scroll", direction: "up", amount: "viewport" } },
  );
  for (const container of page.scrollContainers ?? []) {
    options.push({ id: `scroll_down_${container.ref}`, action: { type: "scroll", direction: "down", amount: "viewport", target: { ref: container.ref } } });
    options.push({ id: `scroll_up_${container.ref}`, action: { type: "scroll", direction: "up", amount: "viewport", target: { ref: container.ref } } });
  }

  if (hasSearchIntent) {
    const prohibitsSending = goalPlan.restrictions.some((restriction) => /envie|enviar|submit|send/i.test(restriction));
    if (!prohibitsSending) options.push({ id: "submit_search", action: { type: "keypress", key: "ENTER" } });
    const openResultPending = progressedPlan.stages.some((stage) => stage.kind === "open_result" && stage.status === "pending");
    const searchWasSubmitted = progressedPlan.stages.some((stage) => stage.kind === "search" && stage.status === "complete")
      || completedActions.includes("keypress") || completedActions.includes("click");
    const openOption = options.find((option) => ["navigate", "open_tab", "open_window"].includes(option.action.type));
    if (openOption && !completedActions.includes(openOption.action.type)) {
      options.splice(0, options.length, openOption);
    } else if (!completedActions.includes("type")) {
      const typeOptions = options.filter((option) => option.action.type === "type");
      const recoveryOptions = options.filter((option) => option.action.type === "scroll");
      const fallbackOptions: CommandOption[] = [{ id: "finish_failed", action: { type: "finish", status: "failed", message: "Não encontrei um campo de texto disponível nesta etapa." } }];
      options.splice(0, options.length, ...(typeOptions.length > 0 ? typeOptions : recoveryOptions.length > 0 ? recoveryOptions : fallbackOptions));
    } else if (!completedActions.includes("click") && !completedActions.includes("keypress")) {
      const searchSubmitOptions = options.filter((option) => {
        if (option.action.type !== "click") return false;
        const clickAction = option.action;
        const element = page.elements.find((candidate) => candidate.ref === clickAction.target.ref);
        return element ? isSearchSubmitControl(element) : false;
      });
      const enterOption: CommandOption = { id: "submit_search", action: { type: "keypress", key: "ENTER" } };
      options.splice(0, options.length, ...(searchSubmitOptions.length > 0 ? searchSubmitOptions : [enterOption]));
    } else if (openResultPending && searchWasSubmitted) {
      const resultLinks = options.filter((option) => {
        if (option.action.type !== "click") return false;
        const element = page.elements.find((candidate) => candidate.ref === targetRef(option.action));
        return element?.role === "link";
      });
      const scrollOptions = options.filter((option) => option.action.type === "scroll");
      const noResult: CommandOption = { id: "finish_failed", action: { type: "finish", status: "failed", message: "A pesquisa terminou, mas ainda não encontrei um resultado para abrir." } };
      options.splice(0, options.length, ...(resultLinks.length ? resultLinks : scrollOptions.length ? scrollOptions : [
        noResult,
      ]));
    } else {
      options.splice(0, options.length, { id: "finish_success", action: { type: "finish", status: "success", message: "Pesquisa concluída." } });
    }
  }

  if (goalPlan.needsClarification) {
    const clarification: CommandOption = { id: "clarify_goal", action: { type: "finish", status: "failed", message: goalPlan.clarification ?? "Preciso de um detalhe para continuar." } };
    options.splice(0, options.length, clarification);
  }

  if (pendingStage?.kind === "fill_field") {
    const pendingFieldActions = options.filter((option) => {
      if (option.action.type !== "type") return false;
      const element = page.elements.find((candidate) => candidate.ref === targetRef(option.action));
      return element && valueForField(goal, [element.name, element.placeholder, element.context].filter(Boolean).join(" ")) === pendingStage.value;
    });
    if (pendingFieldActions.length) options.splice(0, options.length, ...pendingFieldActions);
  }
  if (pendingStage?.kind === "click_target") {
    const targetActions = options.filter((option) => {
      if (option.action.type !== "click") return false;
      const element = page.elements.find((candidate) => candidate.ref === targetRef(option.action));
      return element ? matchesTarget(element, pendingStage.target ?? "") : false;
    });
    if (targetActions.length) options.splice(0, options.length, ...targetActions);
    else {
      const recoveryActions = options.filter((option) => option.action.type === "scroll" || option.action.type === "expand_candidates");
      if (recoveryActions.length) options.splice(0, options.length, ...recoveryActions);
      else options.splice(0, options.length, { id: "finish_failed", action: { type: "finish", status: "failed", message: `Não encontrei “${pendingStage.target}” para continuar.` } });
    }
  }
  if (pendingStage?.kind === "navigate") {
    const expectedTypes = pendingStage.value === "back" ? ["go_back"]
      : pendingStage.value === "forward" ? ["go_forward"]
        : ["navigate", "search_web", "open_tab", "open_window"];
    const navigationActions = options.filter((option) => expectedTypes.includes(option.action.type));
    if (navigationActions.length) options.splice(0, options.length, ...navigationActions);
    else options.splice(0, options.length, { id: "finish_failed", action: { type: "finish", status: "failed", message: `Não encontrei uma ação de navegação segura para: ${pendingStage.description}.` } });
  }
  if (progressedPlan.stages.length > 0 && progressedPlan.stages.every((stage) => stage.status === "complete")) {
    options.splice(0, options.length, { id: "finish_success", action: { type: "finish", status: "success", message: "Todas as etapas rastreadas foram concluídas." } });
  } else if (progressedPlan.stages.some((stage) => stage.status === "pending") && !hasSearchIntent && pendingStage?.kind !== "fill_field" && pendingStage?.kind !== "navigate" && pendingStage?.kind !== "click_target") {
    options.splice(0, options.length, { id: "finish_failed", action: { type: "finish", status: "failed", message: `Ainda falta: ${pendingStage?.description ?? "concluir a próxima etapa"}.` } });
  }

  if (!hasSearchIntent && (hasNavigationIntent || Boolean(genericNavigation))) {
    const navigationOption = options.find((option) => ["navigate", "search_web", "open_tab", "open_window"].includes(option.action.type));
    if (navigationOption && !completedActions.includes(navigationOption.action.type)) {
      options.splice(0, options.length, navigationOption);
    } else if (navigationOption) {
      options.splice(0, options.length, { id: "finish_success", action: { type: "finish", status: "success", message: "Navegação concluída." } });
    }
  }

  // An open-only goal is complete once its global browser action happened.
  // Keep only finish_success so the model cannot click around or reopen the same target.
  const openOnlyGoal = /\b(abra|abrir|acesse|acessar)\b.*\b(nova|novo)\s+(aba|guia|janela|tab|window)\b/i.test(goal)
    && !/\b(e|depois|ent[aã]o|para|com)\b.*\b(digite|pesquise|clique|procure|navegue)\b/i.test(goal);
  if (openOnlyGoal && (completedActions.includes("open_window") || completedActions.includes("open_tab"))) {
    options.splice(1);
  }

  const rankedOptions = options.map((option, order) => ({ option, order, score: scoreOption(option, goal, page, tabs, textToType) }))
    .sort((a, b) => b.score - a.score || a.order - b.order);
  const startOffset = Math.min(Math.max(0, candidateOffset), rankedOptions.length);
  let visibleRankedOptions = rankedOptions.slice(startOffset, startOffset + MAX_OPTIONS);
  const hasMoreOptions = startOffset + visibleRankedOptions.length < rankedOptions.length;
  if (hasMoreOptions) visibleRankedOptions = visibleRankedOptions.slice(0, MAX_OPTIONS - 1);
  const chosenRawOptions = visibleRankedOptions.map(({ option }) => option);
  const nextOffset = startOffset + chosenRawOptions.length;
  if (hasMoreOptions) {
    chosenRawOptions.push({ id: "expand_candidates", action: { type: "expand_candidates", nextOffset, remaining: rankedOptions.length - nextOffset } });
  }
  const selectedRefs = new Set(chosenRawOptions.map(({ action }) => targetRef(action)).filter((ref): ref is string => Boolean(ref)));
  const selectedElements = page.elements.filter((element) => selectedRefs.has(element.ref));
  const compactPage: PageState = {
    ...page,
    pageTextSummary: page.pageTextSummary.slice(0, 1600),
    regions: page.regions?.slice(0, 20),
    elements: selectedElements.map((element) => ({
      ...element,
      options: element.options?.map((option, index) => ({ value: `option_${index + 1}`, label: option.label })),
    })),
    scrollContainers: page.scrollContainers?.slice(0, 12),
  };
  const omittedCandidates = Math.max(0, page.elements.length - selectedElements.length);
  const omittedTabs = Math.max(0, tabs.length - selectedTabs.length);
  const criteria: Record<string, JevChoiceCriterion> = {};
  const makeMap = (finalOptions: CommandOption[]): JevCommandMap => {
    const mappedOptions = finalOptions.map((option, index) => ({ ...option, id: `choice_${String(index + 1).padStart(3, "0")}` }));
    const currentHasMoreOptions = finalOptions.some((option) => option.action.type === "expand_candidates");
    const currentActionCount = finalOptions.filter((option) => option.action.type !== "expand_candidates").length;
    const currentOmittedOptions = Math.max(0, rankedOptions.length - currentActionCount);
    const refsInOptions = new Set(finalOptions.map(({ action }) => targetRef(action)).filter((ref): ref is string => Boolean(ref)));
    const pageForOptions = { ...compactPage, elements: compactPage.elements.filter((element) => refsInOptions.has(element.ref)) };
    for (const option of mappedOptions) {
    const action = option.action;
    if (action.type === "click") {
      const element = page.elements.find((candidate) => candidate.ref === action.target.ref);
      criteria[option.id] = { description: `Clique em ${element ? elementDescription(element) : "o controle indicado"}.` };
    } else if (action.type === "type") {
      const element = page.elements.find((candidate) => candidate.ref === action.target.ref);
      criteria[option.id] = { description: `Digite “${action.text.slice(0, 240)}” em ${element ? elementDescription(element) : "o campo indicado"}.` };
    } else if (action.type === "select") {
      const element = page.elements.find((candidate) => candidate.ref === action.target.ref);
      criteria[option.id] = { description: `Selecione “${compactOptionLabel(element, action.value)}” em ${element ? elementDescription(element) : "o controle indicado"}.` };
    } else if (action.type === "scroll") {
      const container = page.scrollContainers?.find((candidate) => candidate.ref === action.target?.ref);
      criteria[option.id] = { description: `Role ${action.direction === "down" ? "para baixo" : "para cima"}${container ? ` em ${container.label}` : " na página"} para revelar conteúdo relevante.` };
    } else if (action.type === "open_tab") {
      criteria[option.id] = { description: `Abra ${action.url} em uma nova aba e aguarde o carregamento.` };
    } else if (action.type === "open_window") {
      criteria[option.id] = { description: `Abra ${action.url} em uma nova janela e aguarde o carregamento.` };
    } else if (action.type === "navigate") {
      criteria[option.id] = { description: `Navegue a aba atual para ${action.url}.` };
    } else if (action.type === "search_web") {
      criteria[option.id] = { description: `Use a busca web para descobrir o destino: ${action.query}.` };
    } else if (action.type === "go_back") {
      criteria[option.id] = { description: "Volte uma página no histórico desta aba." };
    } else if (action.type === "go_forward") {
      criteria[option.id] = { description: "Avance uma página no histórico desta aba." };
    } else if (action.type === "switch_tab") {
      const tab = tabs.find((candidate) => candidate.id === action.tabId);
      criteria[option.id] = { description: `Mude para a aba ${tab?.title || action.tabId}.` };
    } else if (action.type === "close_tab") {
      criteria[option.id] = { description: "Feche a aba atual solicitada e continue na aba ativa restante." };
    } else if (action.type === "keypress") {
      const focused = page.elements.find((element) => element.ref === page.focusedElement);
      criteria[option.id] = { description: `Pressione ${action.key}${focused ? ` no campo ${elementDescription(focused)}` : " no controle com foco"}.` };
    } else if (action.type === "expand_candidates") {
      criteria[option.id] = { description: `Nenhum candidato visível corresponde com clareza. Inspecione o próximo lote de ${Math.min(59, action.remaining)} ações disponíveis.` };
    } else {
      criteria[option.id] = { description: "O objetivo do usuário já foi concluído." };
    }
    }
    const mappedCriteria = Object.fromEntries(mappedOptions.map((option) => [option.id, criteria[option.id]]));
    return {
      state: {
        goal: goal.slice(0, 4000),
        goalPlan: progressedPlan,
        page: pageForOptions,
        browser: {
          tabs: selectedTabs,
          completedActions,
          history: actionHistory.slice(-12).map((entry) => ({ ...entry, targetLabel: entry.targetLabel?.slice(0, 120), evidence: entry.evidence?.slice(0, 8) })),
          coverage: {
            truncated: omittedCandidates > 0 || currentOmittedOptions > 0 || omittedTabs > 0,
            omittedCandidates,
            omittedOptions: currentOmittedOptions,
            omittedTabs,
            candidateOffset: startOffset,
            totalOptions: rankedOptions.length,
            hasMoreOptions: currentHasMoreOptions,
            payloadBytes: 0,
          },
        },
      },
      questions: {
        next_action: {
          type: "choice",
          instructions: "Escolha a ação que melhor avança a etapa atual. Considere alvo, contexto, estado e cobertura. O histórico registra tipos executados, mas a mesma ação pode ser necessária em outro alvo. Se já concluiu o objetivo inteiro, escolha a opção de conclusão.",
          criteria: mappedCriteria,
        },
      },
    };
  };
  let finalOptions = chosenRawOptions;
  let map = makeMap(finalOptions);
  let payloadBytes = new TextEncoder().encode(JSON.stringify(map)).length;
  while (payloadBytes > MAX_CONTEXT_BYTES && finalOptions.length > 1) {
    const expandIndex = finalOptions.findIndex((option) => option.action.type === "expand_candidates");
    const removeIndex = expandIndex === finalOptions.length - 1 ? finalOptions.length - 2 : finalOptions.length - 1;
    finalOptions = finalOptions.filter((_option, index) => index !== removeIndex);
    const expansion = finalOptions.find((option) => option.action.type === "expand_candidates");
    if (expansion?.action.type === "expand_candidates") {
      const visibleActions = finalOptions.filter((option) => option.action.type !== "expand_candidates").length;
      expansion.action.nextOffset = startOffset + visibleActions;
      expansion.action.remaining = Math.max(0, rankedOptions.length - expansion.action.nextOffset);
    }
    map = makeMap(finalOptions);
    payloadBytes = new TextEncoder().encode(JSON.stringify(map)).length;
  }
  if (payloadBytes > MAX_CONTEXT_BYTES) {
    finalOptions = [{ id: "finish_context_limit", action: { type: "finish", status: "failed", message: "O contexto desta página excede o limite seguro de envio." } }];
    compactPage.elements = [];
    compactPage.regions = [];
    map = makeMap(finalOptions);
    map.state.goal = goal.slice(0, 1000);
    payloadBytes = new TextEncoder().encode(JSON.stringify(map)).length;
  }
  map.state.browser.coverage.payloadBytes = payloadBytes;
  map.state.browser.coverage.payloadBytes = new TextEncoder().encode(JSON.stringify(map)).length;

  return {
    map,
    options: finalOptions.map((option, index) => ({ ...option, id: `choice_${String(index + 1).padStart(3, "0")}` })),
  };
}
