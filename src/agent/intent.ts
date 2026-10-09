export interface GoalStage {
  kind: "navigate" | "search" | "open_result" | "fill_field" | "filter" | "click_target";
  description: string;
  value?: string;
  field?: string;
  target?: string;
  status: "pending" | "complete";
}

export interface GoalHistoryEvent {
  type: string;
  actionKey?: string;
  dispatched?: boolean;
  targetLabel?: string;
  valueLength?: number;
  progressed: boolean;
  beforeUrl?: string;
  afterUrl?: string;
  evidence?: string[];
  errorCode?: string;
}

export interface GoalPlan {
  original: string;
  stages: GoalStage[];
  restrictions: string[];
  needsClarification: boolean;
  clarification?: string;
}

const fieldAliases: Record<string, string[]> = {
  nome: ["nome", "name", "display name", "full name"],
  email: ["email", "e-mail", "mail"],
  telefone: ["telefone", "celular", "phone", "mobile"],
  endereco: ["endereço", "endereco", "address", "logradouro"],
  cidade: ["cidade", "city"],
  cep: ["cep", "postal code", "zip code", "zip"],
};

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function cleanValue(value: string): string {
  return value.trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").replace(/[.!?]+$/, "").trim();
}

function targetWasClicked(history: GoalHistoryEvent[], target: string): boolean {
  const tokens = normalize(target).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2 && !["the", "and", "para", "com", "menu", "item"].includes(token));
  return history.some((entry) => entry.type === "click" && entry.progressed && tokens.length > 0 && tokens.every((token) => normalize(entry.targetLabel ?? "").includes(token)));
}

function extractFieldValues(goal: string): Array<{ field: string; value: string }> {
  const values: Array<{ field: string; value: string }> = [];
  const field = "nome|e-?mail|telefone|celular|endereço|endereco|cidade|cep";
  const patterns = [
    new RegExp(`(?:campo\\s+)?(${field})\\s*(?::|\\bé\\b|\\bcom\\b)\\s*(["“'‘]?)(.{1,160}?)(?:["”'’]|(?=\\s+e\\s+(?:${field})\\s*(?::|\\bé\\b|\\bcom\\b))|[!?]|\\.(?=\\s|$)|$)`, "giu"),
    new RegExp(`(?:preencha|informe|digite|escreva|coloque)\\s+(?:o\\s+)?(${field})\\s+(?:com|como)\\s*(["“'‘]?)(.{1,160}?)(?:["”'’]|(?=\\s+e\\s+(?:${field})\\s*(?::|\\bé\\b|\\bcom\\b))|[!?]|\\.(?=\\s|$)|$)`, "giu"),
  ];
  for (const pattern of patterns) {
    for (const match of goal.matchAll(pattern)) {
      const canonicalField = Object.keys(fieldAliases).find((name) => fieldAliases[name].includes(normalize(match[1]))) ?? normalize(match[1]);
      const value = cleanValue(match[3]);
      if (value && !values.some((entry) => entry.field === canonicalField)) values.push({ field: canonicalField, value });
    }
  }
  return values;
}

function searchTerm(goal: string): string | undefined {
  const quoted = goal.match(/(?:pesquise|pesquisar|busque|buscar|procure|ache|busca(?:r)?|search)(?:\s+(?:por|sobre|for))?\s+["“'‘]([^"”'’]{1,240})["”'’]/i);
  if (quoted?.[1]) return cleanValue(quoted[1]);
  const afterSearch = goal.match(/(?:pesquise|pesquisar|busque|buscar|procure|ache|busca(?:r)?|search)(?:\s+(?:por|sobre|for))?\s+(.+?)(?=\s+(?:e\s+(?:depois\s+)?(?:abra|acesse|clique|entre|filtre|ordene)|depois\s+(?:abra|acesse|clique|entre|filtre|ordene)|then\s+(?:open|click|filter|sort))\b|[!?]|\.(?=\s|$)|$)/i);
  return afterSearch?.[1] ? cleanValue(afterSearch[1]) : undefined;
}

export function parseGoal(goal: string): GoalPlan {
  const stages: GoalStage[] = [];
  const fields = extractFieldValues(goal);
  const query = searchTerm(goal);
  const genericDestination = /\b(?:abra|abrir|acesse|acessar|navegue|navegar|open|visit)\b.{0,80}\b(?:site|p[aá]gina|portal|reposit[oó]rio|repo|git)\b/i.test(goal);
  if (query) stages.push({ kind: "search", description: `Pesquisar por “${query}”`, value: query, status: "pending" });
  if (/\b(?:e\s+(?:depois\s+)?|depois\s+|then\s+)(?:abra|acesse|clique|entre|open|click)\b/i.test(goal) && query) {
    stages.push({ kind: "open_result", description: "Abrir o resultado solicitado", value: /primeir[oa]|first/i.test(goal) ? "first" : undefined, status: "pending" });
  }
  const hasExplicitDestination = /https?:\/\/|\b(?:www\.)?[a-z0-9-]+\.(?:com|com\.br|org|net|io|dev|ai|app|gov)(?:\/[^\s]*)?\b|\b(?:google|youtube)\b/i.test(goal);
  const clickCommands = [...goal.matchAll(/(?:^|\s)(?:abra|clique(?:\s+em)?|entre\s+em|acesse|open|click(?:\s+on)?)\s+(?:(?:o|a|os|as|no|na|em|the|to)\s+)?(.+?)(?=\s+(?:e\s+(?:depois\s+)?(?:abra|clique|entre|acesse|open|click)|depois\s+(?:abra|clique|entre|acesse)|then\s+(?:open|click)|[>→])|[,.!?;]|$)/giu)];
  if (!hasExplicitDestination && !genericDestination) {
    for (const match of clickCommands) {
      const target = cleanValue(match[1]);
      if (!target || /resultado|result/i.test(target) && query) continue;
      if (/^https?:\/\//i.test(target)) continue;
      stages.push({ kind: "click_target", description: `Abrir “${target}”`, target, status: "pending" });
    }
  }
  if (fields.length) {
    for (const entry of fields) stages.push({ kind: "fill_field", description: `Preencher ${entry.field}`, field: entry.field, value: entry.value, status: "pending" });
  } else if (!query && /\b(?:preencha|digite|escreva|insira|informe|enter|type)\b/i.test(goal)) {
    const quoted = goal.match(/["“'‘]([^"”'’]{1,240})["”'’]/)?.[1];
    const value = quoted ?? goal.match(/(?:digite|escreva|preencha|insira|informe|enter|type)\s+(.+?)(?:\s+(?:no|na|em|into|in)\s+(?:campo|field)\b|[.!?]|$)/i)?.[1];
    if (value) stages.push({ kind: "fill_field", description: "Preencher o campo indicado", value: cleanValue(value), status: "pending" });
  }
  if (!stages.length && hasExplicitDestination && /\b(?:abra|abrir|acesse|acessar|navegue|navegar|open|visit)\b/i.test(goal)) {
    stages.push({ kind: "navigate", description: "Navegar ao destino solicitado", value: goal, status: "pending" });
  } else if (!stages.length && genericDestination) {
    stages.push({ kind: "navigate", description: "Descobrir e abrir o destino solicitado", value: goal, status: "pending" });
  }
  const restrictions = [...goal.matchAll(/\b(?:n[aã]o|never|don't|do not)\s+(?:envie|enviar|submeta|submit|send|publish|compre|pague|exclua|delete)\b/gi)].map(([text]) => text);
  const recipientAmbiguity = /\b(?:envie|mande|send|email)\b.{0,80}\b(?:para|to)\s+[^,;]{1,50}\s+(?:ou|or)\s+[^,;.!?]{1,50}/i.test(goal);
  return {
    original: goal,
    stages,
    restrictions,
    needsClarification: recipientAmbiguity,
    clarification: recipientAmbiguity ? "Para qual destinatário devo enviar?" : undefined,
  };
}

export function valueForField(goal: string, accessibleName: string): string | undefined {
  const normalizedName = normalize(accessibleName);
  const entries = extractFieldValues(goal);
  for (const entry of entries) {
    const aliases = fieldAliases[entry.field] ?? [entry.field];
    if (aliases.some((alias) => normalizedName.includes(normalize(alias)))) return entry.value;
  }
  if (entries.length) return undefined;
  return parseGoal(goal).stages.find((stage) => stage.kind === "fill_field" || stage.kind === "search")?.value;
}

function completedField(history: GoalHistoryEvent[], field: string): boolean {
  const aliases = fieldAliases[field] ?? [field];
  return history.some((entry) => entry.type === "type" && entry.progressed && aliases.some((alias) => normalize(entry.targetLabel ?? "").includes(normalize(alias))));
}

export function updateGoalProgress(plan: GoalPlan, history: GoalHistoryEvent[]): GoalPlan {
  const stages = plan.stages.map((stage, index) => {
    const priorStages = plan.stages.slice(0, index);
    if (stage.kind === "search") {
      const typed = history.some((entry) => entry.type === "type" && entry.progressed && /search|busca|pesquis/i.test(entry.targetLabel ?? ""));
      const submitted = history.some((entry) => entry.type === "keypress" && entry.progressed)
        || history.some((entry) => entry.type === "click" && entry.progressed && /search|busca|pesquis|submit/i.test(entry.targetLabel ?? ""));
      return { ...stage, status: typed && submitted ? "complete" as const : "pending" as const };
    }
    if (stage.kind === "open_result") {
      const search = history.findIndex((entry) => entry.type === "keypress" && entry.progressed
        || entry.type === "click" && entry.progressed && /search|busca|pesquis|submit/i.test(entry.targetLabel ?? ""));
      const opened = search >= 0 && history.slice(search + 1).some((entry) => entry.type === "click" && entry.progressed && !/search|busca|pesquis|submit/i.test(entry.targetLabel ?? ""));
      return { ...stage, status: opened ? "complete" as const : "pending" as const };
    }
    if (stage.kind === "fill_field") {
      const complete = stage.field ? completedField(history, stage.field) : history.some((entry) => entry.type === "type" && entry.progressed);
      return { ...stage, status: complete ? "complete" as const : "pending" as const };
    }
    if (stage.kind === "navigate") {
      const complete = history.some((entry) => ["navigate", "open_tab", "open_window", "search_web"].includes(entry.type) && entry.progressed);
      return { ...stage, status: complete ? "complete" as const : "pending" as const };
    }
    if (stage.kind === "click_target") {
      return { ...stage, status: targetWasClicked(history, stage.target ?? "") ? "complete" as const : "pending" as const };
    }
    return { ...stage, status: priorStages.every((prior) => prior.status === "complete") ? "pending" as const : "pending" as const };
  });
  return { ...plan, stages };
}
