import type { AgentAction, ElementRef, PageState } from "../types.js";

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
    page: PageState;
    browser: { tabs: BrowserTabSummary[]; completedActions: string[] };
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

function requestedUrl(goal: string, page: PageState): string | undefined {
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
  return `${element.role ?? element.tag} “${label}” (${element.ref})`;
}

function isSearchSubmitControl(element: ElementRef): boolean {
  const label = `${element.name ?? ""} ${element.text ?? ""} ${element.role ?? ""}`.toLowerCase();
  return ["pesquisa", "pesquisar", "buscar", "busca", "search", "submit", "go"].some((term) => label.includes(term));
}

function navigationQuery(goal: string): string {
  return goal
    .replace(/\b(abra|abrir|acesse|acessar|v[aá]|ir|navegue|navegar)\b/gi, "")
    .replace(/\b(site|p[aá]gina|portal|reposit[oó]rio|repo|git|url)\b/gi, "")
    .replace(/\b(o|a|os|as|em|no|na|para|por|do|da|de|uma|um)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function requestedText(goal: string): string | undefined {
  const quoted = goal.match(/["“”'‘’]([^"“”'‘’]{1,240})["“”'‘’]/);
  if (quoted?.[1]) return quoted[1].trim();
  const afterVerb = goal.match(/(?:digite|escreva|preencha|coloque|insira|informe|busque\s+por|busque|pesquise\s+sobre|pesquise|pesquisar\s+por|buscar\s+por|procure\s+por|procure|ache)\s+(.*)$/i);
  if (!afterVerb?.[1]) return undefined;
  return afterVerb[1]
    .replace(/\s+(?:no|na|em|dentro do|dentro da)\s+(?:campo|caixa|input|formul[aá]rio|busca|pesquisa)\b.*$/i, "")
    .trim()
    .replace(/[.!?]+$/, "") || undefined;
}

/** Builds Jev's closed action space. Jev chooses an existing option; it never invents a selector or code. */
export function buildJevCommandMap(goal: string, page: PageState, tabs: BrowserTabSummary[] = [], completedActions: string[] = []): { map: JevCommandMap; options: CommandOption[] } {
  const textToType = requestedText(goal);
  const options: CommandOption[] = [
    { id: "finish_success", action: { type: "finish", status: "success", message: "Objetivo concluído." } },
  ];

  const url = requestedUrl(goal, page);
  const hasNavigationIntent = Boolean(url && /\b(abra|abrir|acesse|acessar|v[aá]|ir)\b/i.test(goal));
  const genericNavigation = !url && /\b(abra|abrir|acesse|acessar|v[aá]|ir|navegue|navegar)\b/i.test(goal) && navigationQuery(goal);
  const hasSearchIntent = Boolean(textToType && /\b(pesquise|pesquisar|busque|buscar|procure|ache)\b/i.test(goal));
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
  for (const tab of tabs) {
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
    if (["button", "link", "checkbox", "radio", "submit"].includes(element.role ?? element.tag)) {
      options.push({ id: `click_${element.ref}`, action: { type: "click", target: { ref: element.ref } } });
    }
    if (textToType && ["input", "textarea", "textbox", "searchbox", "combobox"].includes(element.role ?? element.tag) && element.type !== "password") {
      options.push({ id: `type_${element.ref}`, action: { type: "type", target: { ref: element.ref }, text: textToType, replace: true } });
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
    options.push({ id: "submit_search", action: { type: "keypress", key: "ENTER" } });
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
    } else {
      options.splice(0, options.length, { id: "finish_success", action: { type: "finish", status: "success", message: "Pesquisa concluída." } });
    }
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

  const criteria: Record<string, JevChoiceCriterion> = {};
  for (const option of options) {
    const action = option.action;
    if (action.type === "click") {
      const element = page.elements.find((candidate) => candidate.ref === action.target.ref);
      criteria[option.id] = { description: `Clique em ${element ? elementDescription(element) : action.target.ref}.` };
    } else if (action.type === "type") {
      const element = page.elements.find((candidate) => candidate.ref === action.target.ref);
      criteria[option.id] = { description: `Digite o próximo texto solicitado em ${element ? elementDescription(element) : action.target.ref}.` };
    } else if (action.type === "select") {
      criteria[option.id] = { description: `Selecione a opção correta no controle ${action.target.ref}.` };
    } else if (action.type === "scroll") {
      criteria[option.id] = { description: `Role ${action.direction === "down" ? "para baixo" : "para cima"} para encontrar elementos relevantes.` };
    } else if (action.type === "open_tab") {
      criteria[option.id] = { description: `Abra ${action.url} em uma nova aba e aguarde o carregamento.` };
    } else if (action.type === "open_window") {
      criteria[option.id] = { description: `Abra ${action.url} em uma nova janela e aguarde o carregamento.` };
    } else if (action.type === "navigate") {
      criteria[option.id] = { description: `Navegue a aba atual para ${action.url}.` };
    } else if (action.type === "search_web") {
      criteria[option.id] = { description: `Use a busca web para descobrir o destino: ${action.query}.` };
    } else if (action.type === "switch_tab") {
      const tab = tabs.find((candidate) => candidate.id === action.tabId);
      criteria[option.id] = { description: `Mude para a aba ${tab?.title || action.tabId}.` };
    } else if (action.type === "close_tab") {
      criteria[option.id] = { description: "Feche a aba atual solicitada e continue na aba ativa restante." };
    } else if (action.type === "keypress") {
      criteria[option.id] = { description: "Envie o formulário ou a pesquisa pressionando Enter no campo preenchido." };
    } else {
      criteria[option.id] = { description: "O objetivo do usuário já foi concluído." };
    }
  }

  return {
    map: {
      state: { goal, page, browser: { tabs, completedActions } },
      questions: {
        next_action: {
          type: "choice",
          instructions: "Escolha exatamente uma próxima ação segura para avançar o objetivo. O estado browser.completedActions registra ações globais já concluídas: nunca repita uma ação desse conjunto. Se o objetivo já estiver concluído, escolha finish_success.",
          criteria,
        },
      },
    },
    options,
  };
}
