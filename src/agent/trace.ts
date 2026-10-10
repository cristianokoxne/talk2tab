import type { AgentLoopResult, AgentLoopStep } from "./loop.js";

export interface SafeTraceStep {
  step: number;
  actionType: string;
  targetRole?: string;
  targetFrameId?: number;
  expectedEffect: string;
  option?: string;
  availableActions: string[];
  confidence?: number;
  model?: string;
  commandMapMs?: number;
  observationMs?: number;
  callLatencyMs?: number;
  serializationMs?: number;
  payloadBytes?: number;
  optionCount?: number;
  waitMs?: number;
  dispatched?: boolean;
  actionOk?: boolean;
  effectObserved?: boolean;
  progressed?: boolean;
  evidence: string[];
  waitOutcome?: string;
  errorCode?: string;
}

export interface SafeAgentTrace {
  formatVersion: 1;
  status: string;
  summary: string;
  steps: SafeTraceStep[];
  metrics: { stepCount: number; maxPayloadBytes: number; traceBytes: number };
}

function safeNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
}

function safeCode(value: string | undefined): string | undefined {
  const known = new Set(["INVALID_ACTION", "INPUT_EXECUTION_FAILED", "SELECTION_FAILED", "STALE_SCROLL_CONTAINER", "STALE_ELEMENT", "FRAME_UNAVAILABLE", "ELEMENT_NOT_VISIBLE", "ELEMENT_DISABLED", "ELEMENT_UNAVAILABLE", "CLICK_OBSCURED", "UNSUPPORTED_KEY", "ACTION_NOT_AUTHORIZED", "CONFIRMATION_CONTEXT_CHANGED", "USER_CONFIRMATION_REQUIRED", "TAB_SESSION_BUSY"]);
  return value && known.has(value) ? value : value ? "ACTION_FAILED" : undefined;
}

const roles = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "treeitem", "submit", "textbox", "searchbox", "combobox", "listbox", "slider", "spinbutton", "input", "textarea", "select", "a"]);

function expectedEffectFor(actionType: AgentLoopStep["action"]["type"]): string {
  const values: Record<AgentLoopStep["action"]["type"], string> = {
    click: "ativar o controle e observar o efeito",
    type: "preencher o campo (valor omitido do trace)",
    select: "alterar a seleção do controle",
    scroll: "rolar o contêiner observado",
    keypress: "enviar a tecla permitida",
    navigate: "navegar para o destino solicitado",
    search_web: "pesquisar na web",
    open_tab: "abrir uma aba para o destino solicitado",
    open_window: "abrir uma janela para o destino solicitado",
    switch_tab: "mudar para outra aba",
    close_tab: "fechar a aba solicitada",
    go_back: "navegar para trás no histórico",
    go_forward: "navegar para frente no histórico",
    finish: "encerrar a sessão",
    expand_candidates: "mostrar o próximo lote de opções",
  };
  return values[actionType];
}

const actionTypes: AgentLoopStep["action"]["type"][] = ["click", "type", "select", "scroll", "keypress", "navigate", "search_web", "open_tab", "open_window", "switch_tab", "close_tab", "go_back", "go_forward", "finish", "expand_candidates"];

export function sanitizeSafeTraceStep(value: unknown): SafeTraceStep | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Partial<SafeTraceStep>;
  if (!Number.isInteger(input.step) || (input.step ?? 0) < 1 || !actionTypes.includes(input.actionType as AgentLoopStep["action"]["type"])) return undefined;
  const actionType = input.actionType as AgentLoopStep["action"]["type"];
  return {
    step: input.step!, actionType, targetRole: input.targetRole && roles.has(input.targetRole) ? input.targetRole : undefined,
    targetFrameId: Number.isInteger(input.targetFrameId) && (input.targetFrameId ?? -1) >= 0 ? input.targetFrameId : undefined,
    expectedEffect: expectedEffectFor(actionType), option: typeof input.option === "string" && /^choice_\d{3}$/.test(input.option) ? input.option : undefined,
    availableActions: Array.isArray(input.availableActions) ? [...new Set(input.availableActions.filter((item): item is string => typeof item === "string" && actionTypes.includes(item as AgentLoopStep["action"]["type"])))].slice(0, 16) : [],
    confidence: typeof input.confidence === "number" && input.confidence >= 0 && input.confidence <= 1 ? input.confidence : undefined,
    model: typeof input.model === "string" && /^jev-[a-zA-Z0-9.-]{1,48}$/.test(input.model) ? input.model : undefined,
    commandMapMs: safeNumber(input.commandMapMs), observationMs: safeNumber(input.observationMs), callLatencyMs: safeNumber(input.callLatencyMs),
    serializationMs: safeNumber(input.serializationMs), payloadBytes: safeNumber(input.payloadBytes), optionCount: safeNumber(input.optionCount), waitMs: safeNumber(input.waitMs),
    dispatched: typeof input.dispatched === "boolean" ? input.dispatched : undefined,
    actionOk: typeof input.actionOk === "boolean" ? input.actionOk : undefined,
    effectObserved: typeof input.effectObserved === "boolean" ? input.effectObserved : undefined,
    progressed: typeof input.progressed === "boolean" ? input.progressed : undefined,
    evidence: Array.isArray(input.evidence) ? input.evidence.filter((entry): entry is string => typeof entry === "string" && /^[a-z][a-z0-9_]{1,63}$/.test(entry)).slice(0, 8) : [],
    waitOutcome: typeof input.waitOutcome === "string" && ["efeito observado", "ação enviada sem efeito observado", "ação concluída sem mudança semântica observada"].includes(input.waitOutcome) ? input.waitOutcome : undefined,
    errorCode: safeCode(input.errorCode),
  };
}

export function safeTraceStep(step: AgentLoopStep): SafeTraceStep {
  return sanitizeSafeTraceStep({
    step: step.step,
    actionType: step.action.type,
    targetRole: step.targetRole && roles.has(step.targetRole) ? step.targetRole : undefined,
    targetFrameId: Number.isInteger(step.targetFrameId) && (step.targetFrameId ?? -1) >= 0 ? step.targetFrameId : undefined,
    expectedEffect: expectedEffectFor(step.action.type),
    option: typeof step.optionId === "string" && /^choice_\d{3}$/.test(step.optionId) ? step.optionId : undefined,
    availableActions: step.availableActions ?? [],
    confidence: typeof step.confidence === "number" && step.confidence >= 0 && step.confidence <= 1 ? step.confidence : undefined,
    model: typeof step.model === "string" && /^jev-[a-zA-Z0-9.-]{1,48}$/.test(step.model) ? step.model : undefined,
    commandMapMs: safeNumber(step.commandMapMs),
    observationMs: safeNumber(step.observationMs),
    callLatencyMs: safeNumber(step.callLatencyMs),
    serializationMs: safeNumber(step.serializationMs),
    payloadBytes: safeNumber(step.payloadBytes),
    optionCount: safeNumber(step.optionCount),
    waitMs: safeNumber(step.waitMs),
    dispatched: step.result?.dispatched,
    actionOk: step.result?.ok,
    effectObserved: step.verification?.effectObserved,
    progressed: step.verification?.progressed,
    evidence: (step.verification?.evidence ?? []).filter((entry) => /^[a-z][a-z0-9_]{1,63}$/.test(entry)).slice(0, 8),
    waitOutcome: step.verification?.effectObserved ? "efeito observado"
      : step.result?.dispatched ? "ação enviada sem efeito observado"
        : step.result?.ok ? "ação concluída sem mudança semântica observada" : undefined,
    errorCode: safeCode(step.result?.code),
  })!;
}

export function makeSafeTraceFromSteps(statusValue: string, stepsToMerge: SafeTraceStep[]): SafeAgentTrace {
  const statuses = new Set(["success", "failed", "needs_help", "cancelled", "stalled", "max_steps", "max_duration", "max_provider_calls", "running"]);
  const status = statuses.has(statusValue) ? statusValue : "failed";
  const byStep = new Map(stepsToMerge.flatMap((step) => {
    const clean = sanitizeSafeTraceStep(step);
    return clean ? [[clean.step, clean] as const] : [];
  }));
  const steps = [...byStep.values()].sort((a, b) => a.step - b.step).slice(-50);
  const trace: SafeAgentTrace = {
    formatVersion: 1,
    status,
    summary: status === "needs_help" ? "A sessão precisa de intervenção ou reconciliação."
      : status === "success" ? "A sessão terminou com evidência observada."
        : status === "cancelled" ? "A sessão foi cancelada."
          : "A sessão terminou sem confirmação de sucesso.",
    steps,
    metrics: { stepCount: steps.length, maxPayloadBytes: Math.max(0, ...steps.map((step) => step.payloadBytes ?? 0)), traceBytes: 0 },
  };
  trace.metrics.traceBytes = new TextEncoder().encode(JSON.stringify(trace)).length;
  return trace;
}

export function makeSafeAgentTrace(result: AgentLoopResult, previousSteps: SafeTraceStep[] = []): SafeAgentTrace {
  const latest = new Map(previousSteps.map((step) => [step.step, step]));
  for (const step of result.steps) latest.set(step.step, safeTraceStep(step));
  return makeSafeTraceFromSteps(result.status, [...latest.values()]);
}
